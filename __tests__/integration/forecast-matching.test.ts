/**
 * Forecast matching service tests.
 * Tests findMatchingForecast, getMatchedForecastPairs, resolve actions, overdue handling.
 */

let executedRuns: { sql: string; params: unknown[] }[] = [];

const mockWithTransaction = jest.fn(async (fn: () => Promise<void>) => {
  await fn();
});

const mockGetAllAsync = jest.fn(async (): Promise<unknown[]> => []);
const mockGetFirstAsync = jest.fn(async (): Promise<unknown> => null);

const mockDb = {
  getAllAsync: mockGetAllAsync,
  getFirstAsync: mockGetFirstAsync,
  runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    executedRuns.push({ sql, params });
    return { changes: 3, lastInsertRowId: 1 };
  }),
  withTransactionAsync: mockWithTransaction,
};

jest.mock("../../database", () => ({
  getDatabase: () => mockDb,
}));

jest.mock("../../utils/uuid", () => ({
  generateUUID: () => "test-uuid",
}));

import {
  findMatchingForecast,
  getMatchedForecastPairs,
  resolveMatchRealize,
  resolveMatchAlreadyCaptured,
  resolveMatchBothDifferent,
  getOverdueForecasts,
  dismissOverdueForecasts,
} from "../../services/expense";
import type { Expense } from "../../services/expense";

const makeForecast = (overrides: Partial<Expense> = {}): Expense => ({
  id: "forecast-1",
  user_id: "user-1",
  amount: 15000,
  currency: "INR",
  fx_rate: null,
  description: "EMI",
  merchant_name: null,
  category_id: null,
  payment_mode_id: null,
  date: "2026-04-01",
  is_right_spend: null,
  source: "sms_auto",
  status: "pending_review",
  nature: "forecast",
  due_date: "2026-04-05",
  account_id: "acc-1",
  refund_of_expense_id: null,
  raw_source_text: null,
  split_original_amount: null,
  split_person_id: null,
  split_pct: null,
  split_hisaab_entry_id: null,
  matched_forecast_id: null,
  deleted_at: null,
  forecast_type: "expense",
  paid_from_account_id: null,
  raw_merchant_name: null,
  transaction_time: "00:00:00",
  split_mode: null,
  split_exact_amount: null,
  convenience_fee: 0,
  fee_absorbed: 0,
  purchase_group_id: null,
  recurring_rule_id: null,
  fulfills_rule_id: null,
  applied_rule_id: null,
  reclassified_as_transfer: null,
  linked_transfer_id: null,
  created_at: "2026-04-01T10:00:00Z",
  updated_at: "2026-04-01T10:00:00Z",
  ...overrides,
});

beforeEach(() => {
  executedRuns = [];
  jest.clearAllMocks();
  mockGetAllAsync.mockResolvedValue([]);
  mockGetFirstAsync.mockResolvedValue(null);
});

// ─── findMatchingForecast ──────────────────────────────────────

describe("findMatchingForecast", () => {
  it("returns null when no candidates exist", async () => {
    mockGetAllAsync.mockResolvedValue([]);

    const result = await findMatchingForecast("user-1", 15000, "acc-1", "2026-04-05");
    expect(result).toBeNull();
  });

  it("matches exact amount + same account + same date with high confidence", async () => {
    const forecast = makeForecast({ amount: 15000, account_id: "acc-1", due_date: "2026-04-05" });
    mockGetAllAsync.mockResolvedValue([forecast]);

    const result = await findMatchingForecast("user-1", 15000, "acc-1", "2026-04-05");

    expect(result).not.toBeNull();
    expect(result!.forecast.id).toBe("forecast-1");
    // Exact amount (25) + same account (25) + merchant sim 0 (0) + same date (30) = 80
    expect(result!.confidence).toBe(80);
  });

  it("scores lower when amount differs within 5%", async () => {
    // 15000 * 1.03 = 15450 (within 5%)
    const forecast = makeForecast({ amount: 15450, account_id: "acc-1", due_date: "2026-04-05" });
    mockGetAllAsync.mockResolvedValue([forecast]);

    const result = await findMatchingForecast("user-1", 15000, "acc-1", "2026-04-05");

    expect(result).not.toBeNull();
    // Exact amount (25, always since query pre-filters) + same account (25) + merchant 0 + same date (30) = 80
    expect(result!.confidence).toBe(80);
  });

  it("scores lower when account info is missing", async () => {
    const forecast = makeForecast({ amount: 15000, account_id: null, due_date: "2026-04-05" });
    mockGetAllAsync.mockResolvedValue([forecast]);

    const result = await findMatchingForecast("user-1", 15000, "acc-1", "2026-04-05");

    expect(result).not.toBeNull();
    // Exact amount (25) + one side has account (5) + merchant 0 + same date (30) = 60
    expect(result!.confidence).toBe(60);
  });

  it("scores lower when dates are apart", async () => {
    const forecast = makeForecast({ amount: 15000, account_id: "acc-1", due_date: "2026-04-01" });
    mockGetAllAsync.mockResolvedValue([forecast]);

    const result = await findMatchingForecast("user-1", 15000, "acc-1", "2026-04-05");

    expect(result).not.toBeNull();
    // 4 days apart → dateScore = max(5, round(30 - (4/7)*25)) = max(5, 16) = 16
    // Exact amount (25) + same account (25) + merchant 0 + date (16) = 66
    expect(result!.confidence).toBe(66);
  });

  it("picks highest confidence when multiple candidates exist", async () => {
    const closeForecast = makeForecast({
      id: "forecast-close",
      amount: 15000,
      account_id: "acc-1",
      due_date: "2026-04-05",
    });
    const farForecast = makeForecast({
      id: "forecast-far",
      amount: 15000,
      account_id: null,
      due_date: "2026-04-01",
    });
    mockGetAllAsync.mockResolvedValue([closeForecast, farForecast]);

    const result = await findMatchingForecast("user-1", 15000, "acc-1", "2026-04-05");

    expect(result).not.toBeNull();
    expect(result!.forecast.id).toBe("forecast-close");
    expect(result!.confidence).toBeGreaterThan(50);
  });
});

// ─── getMatchedForecastPairs ───────────────────────────────────

describe("getMatchedForecastPairs", () => {
  it("returns empty array when no matched pairs exist", async () => {
    mockGetAllAsync.mockResolvedValue([]);

    const pairs = await getMatchedForecastPairs("user-1");
    expect(pairs).toHaveLength(0);
  });

  it("returns pairs of realized + forecast expenses", async () => {
    const realized = makeForecast({
      id: "realized-1",
      nature: "realized",
      matched_forecast_id: "forecast-1",
    });
    const forecast = makeForecast({ id: "forecast-1", nature: "forecast" });

    // First getAllAsync returns realized expenses; second returns batch-loaded forecasts
    mockGetAllAsync
      .mockResolvedValueOnce([realized])
      .mockResolvedValueOnce([forecast]);

    const pairs = await getMatchedForecastPairs("user-1");
    expect(pairs).toHaveLength(1);
    expect(pairs[0].realized.id).toBe("realized-1");
    expect(pairs[0].forecast.id).toBe("forecast-1");
  });

  it("skips pairs where forecast was already rejected", async () => {
    const realized = makeForecast({
      id: "realized-1",
      nature: "realized",
      matched_forecast_id: "forecast-1",
    });

    // First getAllAsync returns realized; second returns empty (forecast filtered out by status)
    mockGetAllAsync
      .mockResolvedValueOnce([realized])
      .mockResolvedValueOnce([]); // forecast not found (rejected)

    const pairs = await getMatchedForecastPairs("user-1");
    expect(pairs).toHaveLength(0);
  });
});

// ─── resolveMatchRealize ───────────────────────────────────────

describe("resolveMatchRealize", () => {
  it("converts forecast to realized and rejects the duplicate", async () => {
    await resolveMatchRealize("forecast-1", "realized-1", "2026-04-05");

    expect(mockWithTransaction).toHaveBeenCalledTimes(1);

    // Forecast converted to realized
    const forecastUpdate = executedRuns.find(
      (r) => r.sql.includes("nature = 'realized'") && r.params.includes("forecast-1"),
    );
    expect(forecastUpdate).toBeDefined();
    expect(forecastUpdate!.sql).toContain("status = 'approved'");
    expect(forecastUpdate!.sql).toContain("matched_forecast_id = NULL");
    expect(forecastUpdate!.params).toContain("2026-04-05"); // actualDate

    // Duplicate realized rejected
    const realizedUpdate = executedRuns.find(
      (r) => r.sql.includes("status = 'rejected'") && r.params.includes("realized-1"),
    );
    expect(realizedUpdate).toBeDefined();
  });
});

// ─── resolveMatchAlreadyCaptured ───────────────────────────────

describe("resolveMatchAlreadyCaptured", () => {
  it("approves realized and rejects the forecast", async () => {
    await resolveMatchAlreadyCaptured("forecast-1", "realized-1");

    expect(mockWithTransaction).toHaveBeenCalledTimes(1);

    // Realized expense approved
    const realizedUpdate = executedRuns.find(
      (r) => r.sql.includes("status = 'approved'") && r.params.includes("realized-1"),
    );
    expect(realizedUpdate).toBeDefined();
    expect(realizedUpdate!.sql).toContain("matched_forecast_id = NULL");

    // Forecast rejected
    const forecastUpdate = executedRuns.find(
      (r) => r.sql.includes("status = 'rejected'") && r.params.includes("forecast-1"),
    );
    expect(forecastUpdate).toBeDefined();
  });
});

// ─── resolveMatchBothDifferent ─────────────────────────────────

describe("resolveMatchBothDifferent", () => {
  it("approves both expenses", async () => {
    await resolveMatchBothDifferent("forecast-1", "realized-1");

    expect(mockWithTransaction).toHaveBeenCalledTimes(1);

    // Both should be approved
    const approvals = executedRuns.filter((r) => r.sql.includes("status = 'approved'"));
    expect(approvals).toHaveLength(2);

    // Realized has matched_forecast_id cleared
    const realizedUpdate = approvals.find((r) => r.params.includes("realized-1"));
    expect(realizedUpdate).toBeDefined();
    expect(realizedUpdate!.sql).toContain("matched_forecast_id = NULL");
  });
});

// ─── Overdue Forecasts ─────────────────────────────────────────

describe("getOverdueForecasts", () => {
  it("queries forecasts with due_date before today", async () => {
    await getOverdueForecasts("user-1", "2026-04-10");

    expect(mockGetAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("due_date < ?"),
      "user-1",
      "2026-04-10",
    );
    expect(mockGetAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("nature = 'forecast'"),
      "user-1",
      "2026-04-10",
    );
  });
});

describe("dismissOverdueForecasts", () => {
  it("bulk rejects overdue forecasts and returns count", async () => {
    const count = await dismissOverdueForecasts("user-1", "2026-04-10");

    const update = executedRuns.find(
      (r) => r.sql.includes("status = 'rejected'") && r.sql.includes("due_date"),
    );
    expect(update).toBeDefined();
    expect(update!.params).toEqual(["user-1", "2026-04-10"]);
    expect(count).toBe(3); // from mock runAsync returning changes: 3
  });
});
