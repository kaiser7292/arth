/**
 * Tests for the Recurring Transaction Detection service.
 *
 * Tests cover:
 * - Frequency classification from interval days
 * - Next date calculation per frequency
 * - Full detection algorithm (grouping, tolerance, interval classification)
 * - Confirm / dismiss operations
 * - Upcoming recurring query
 * - New expense matching to existing recurring
 */

import {
  classifyFrequency,
  calculateNextDate,
} from "../../services/recurring-detector";

// ─── Mock database ───

let executedRuns: { sql: string; params: unknown[] }[] = [];
let mockFirstRows: Record<string, unknown> = {};
let mockAllRows: unknown[] = [];

const mockDb = {
  getAllAsync: jest.fn(async () => mockAllRows),
  getFirstAsync: jest.fn(async (sql: string) => {
    return mockFirstRows[sql] ?? null;
  }),
  runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    executedRuns.push({ sql, params });
    return { changes: 1, lastInsertRowId: 1 };
  }),
};

jest.mock("../../database", () => ({
  getDatabase: () => mockDb,
}));

let mockUuidCounter = 0;
jest.mock("../../utils/uuid", () => ({
  generateUUID: () => `test-rec-uuid-${++mockUuidCounter}`,
}));

// Mock normalizeMerchant
jest.mock("../../services/smart-categorizer", () => ({
  normalizeMerchant: (s: string) => s.toLowerCase().trim(),
}));

import {
  detectRecurringTransactions,
  getRecurringTransactions,
  confirmRecurring,
  dismissRecurring,
  getUpcomingRecurring,
  checkNewExpenseForRecurring,
} from "../../services/recurring-detector";

beforeEach(() => {
  executedRuns = [];
  mockFirstRows = {};
  mockAllRows = [];
  mockUuidCounter = 0;
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════
// classifyFrequency (pure function)
// ═══════════════════════════════════════════════

describe("classifyFrequency", () => {
  it("classifies ~7 days as weekly", () => {
    expect(classifyFrequency(7)).toBe("weekly");
    expect(classifyFrequency(5)).toBe("weekly");
    expect(classifyFrequency(10)).toBe("weekly");
  });

  it("classifies ~30 days as monthly", () => {
    expect(classifyFrequency(28)).toBe("monthly");
    expect(classifyFrequency(30)).toBe("monthly");
    expect(classifyFrequency(31)).toBe("monthly");
  });

  it("classifies ~90 days as quarterly", () => {
    expect(classifyFrequency(85)).toBe("quarterly");
    expect(classifyFrequency(90)).toBe("quarterly");
    expect(classifyFrequency(95)).toBe("quarterly");
  });

  it("classifies ~365 days as yearly", () => {
    expect(classifyFrequency(355)).toBe("yearly");
    expect(classifyFrequency(365)).toBe("yearly");
    expect(classifyFrequency(375)).toBe("yearly");
  });

  it("returns null for unrecognized intervals", () => {
    expect(classifyFrequency(15)).toBeNull();
    expect(classifyFrequency(45)).toBeNull();
    expect(classifyFrequency(200)).toBeNull();
    expect(classifyFrequency(3)).toBeNull();
  });
});

// ═══════════════════════════════════════════════
// calculateNextDate (pure function)
// ═══════════════════════════════════════════════

describe("calculateNextDate", () => {
  it("adds 7 days for weekly", () => {
    expect(calculateNextDate("2026-04-01", "weekly")).toBe("2026-04-08");
  });

  it("adds 1 month for monthly", () => {
    expect(calculateNextDate("2026-04-10", "monthly")).toBe("2026-05-10");
  });

  it("adds 3 months for quarterly", () => {
    expect(calculateNextDate("2026-01-15", "quarterly")).toBe("2026-04-15");
  });

  it("adds 1 year for yearly", () => {
    expect(calculateNextDate("2026-04-10", "yearly")).toBe("2027-04-10");
  });
});

// ═══════════════════════════════════════════════
// detectRecurringTransactions
// ═══════════════════════════════════════════════

describe("detectRecurringTransactions", () => {
  it("detects monthly recurring from 3 consistent expenses", async () => {
    // Mock: 3 Netflix expenses ~30 days apart
    mockAllRows = [
      { id: "e1", amount: 199, merchant_name: "NETFLIX", date: "2026-01-10", category_id: "cat-1", account_id: "acc-1" },
      { id: "e2", amount: 199, merchant_name: "NETFLIX", date: "2026-02-10", category_id: "cat-1", account_id: "acc-1" },
      { id: "e3", amount: 199, merchant_name: "NETFLIX", date: "2026-03-10", category_id: "cat-1", account_id: "acc-1" },
    ];
    // No existing recurring
    mockDb.getFirstAsync.mockResolvedValue(null);

    const count = await detectRecurringTransactions("user-1");

    expect(count).toBe(1);
    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO recurring_transactions"));
    expect(insert).toBeDefined();
    expect(insert!.params[2]).toBe("netflix"); // merchant_normalized
    expect(insert!.params[3]).toBe(199); // amount (median)
    expect(insert!.params[4]).toBe("monthly"); // frequency
  });

  it("skips groups with fewer than 2 occurrences", async () => {
    mockAllRows = [
      { id: "e1", amount: 5000, merchant_name: "RANDOM SHOP", date: "2026-03-01", category_id: null, account_id: null },
    ];

    const count = await detectRecurringTransactions("user-1");
    expect(count).toBe(0);
  });

  it("skips groups where amounts vary more than 5%", async () => {
    mockAllRows = [
      { id: "e1", amount: 100, merchant_name: "VARIED", date: "2026-01-10", category_id: null, account_id: null },
      { id: "e2", amount: 200, merchant_name: "VARIED", date: "2026-02-10", category_id: null, account_id: null },
    ];

    const count = await detectRecurringTransactions("user-1");
    expect(count).toBe(0);
  });

  it("detects recurring zero-amount transactions without division by zero", async () => {
    // Mock: 3 free subscription renewals (Rs 0) ~30 days apart
    mockAllRows = [
      { id: "e1", amount: 0, merchant_name: "FREE TRIAL", date: "2026-01-10", category_id: "cat-1", account_id: "acc-1" },
      { id: "e2", amount: 0, merchant_name: "FREE TRIAL", date: "2026-02-10", category_id: "cat-1", account_id: "acc-1" },
      { id: "e3", amount: 0, merchant_name: "FREE TRIAL", date: "2026-03-10", category_id: "cat-1", account_id: "acc-1" },
    ];
    mockDb.getFirstAsync.mockResolvedValue(null);

    const count = await detectRecurringTransactions("user-1");

    expect(count).toBe(1);
    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO recurring_transactions"));
    expect(insert).toBeDefined();
    expect(insert!.params[3]).toBe(0); // amount (median)
    expect(insert!.params[4]).toBe("monthly"); // frequency
  });

  it("skips groups with unrecognized intervals", async () => {
    // 2 expenses 15 days apart — not weekly, monthly, quarterly, or yearly
    mockAllRows = [
      { id: "e1", amount: 500, merchant_name: "BIWEEKLY", date: "2026-03-01", category_id: null, account_id: null },
      { id: "e2", amount: 500, merchant_name: "BIWEEKLY", date: "2026-03-16", category_id: null, account_id: null },
    ];

    const count = await detectRecurringTransactions("user-1");
    expect(count).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// getRecurringTransactions
// ═══════════════════════════════════════════════

describe("getRecurringTransactions", () => {
  it("queries active recurring items ordered by next date", async () => {
    await getRecurringTransactions("user-1");

    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("is_active = 1"),
      "user-1",
    );
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY next_expected_date ASC"),
      "user-1",
    );
  });
});

// ═══════════════════════════════════════════════
// confirmRecurring / dismissRecurring
// ═══════════════════════════════════════════════

describe("confirmRecurring", () => {
  it("sets is_confirmed to 1", async () => {
    await confirmRecurring("rec-1");

    const update = executedRuns.find((r) => r.sql.includes("UPDATE recurring_transactions"));
    expect(update).toBeDefined();
    expect(update!.sql).toContain("is_confirmed = 1");
    expect(update!.params).toEqual(["rec-1"]);
  });
});

describe("dismissRecurring", () => {
  it("sets is_active to 0", async () => {
    await dismissRecurring("rec-1");

    const update = executedRuns.find((r) => r.sql.includes("UPDATE recurring_transactions"));
    expect(update).toBeDefined();
    expect(update!.sql).toContain("is_active = 0");
    expect(update!.params).toEqual(["rec-1"]);
  });
});

// ═══════════════════════════════════════════════
// checkNewExpenseForRecurring
// ═══════════════════════════════════════════════

describe("checkNewExpenseForRecurring", () => {
  it("does nothing when merchant is null", async () => {
    await checkNewExpenseForRecurring("user-1", null, 199, "2026-04-10", null, null);
    expect(mockDb.getFirstAsync).not.toHaveBeenCalled();
  });

  it("updates existing recurring with new occurrence", async () => {
    mockDb.getFirstAsync.mockResolvedValueOnce({
      id: "rec-1",
      amount: 199,
      frequency: "monthly",
      occurrence_count: 3,
    });

    await checkNewExpenseForRecurring("user-1", "NETFLIX", 199, "2026-04-10", "cat-1", "acc-1");

    const update = executedRuns.find((r) => r.sql.includes("UPDATE recurring_transactions"));
    expect(update).toBeDefined();
    expect(update!.params).toContain("2026-04-10"); // last_seen_date
    expect(update!.params).toContain("2026-05-10"); // next_expected_date
    expect(update!.params).toContain(4); // occurrence_count incremented
  });

  it("matches zero-amount recurring without division by zero", async () => {
    mockDb.getFirstAsync.mockResolvedValueOnce({
      id: "rec-1",
      amount: 0,
      frequency: "monthly",
      occurrence_count: 3,
    });

    await checkNewExpenseForRecurring("user-1", "FREE TRIAL", 0, "2026-04-10", "cat-1", "acc-1");

    const update = executedRuns.find((r) => r.sql.includes("UPDATE recurring_transactions"));
    expect(update).toBeDefined();
    expect(update!.params).toContain(4); // occurrence_count incremented
  });

  it("rejects non-zero amount when recurring is zero-amount", async () => {
    mockDb.getFirstAsync.mockResolvedValueOnce({
      id: "rec-1",
      amount: 0,
      frequency: "monthly",
      occurrence_count: 3,
    });

    await checkNewExpenseForRecurring("user-1", "FREE TRIAL", 100, "2026-04-10", null, null);

    const update = executedRuns.find((r) => r.sql.includes("UPDATE recurring_transactions"));
    expect(update).toBeUndefined();
  });

  it("skips update when amount is outside 5% tolerance", async () => {
    mockDb.getFirstAsync.mockResolvedValueOnce({
      id: "rec-1",
      amount: 199,
      frequency: "monthly",
      occurrence_count: 3,
    });

    // Amount 500 is way outside 5% of 199
    await checkNewExpenseForRecurring("user-1", "NETFLIX", 500, "2026-04-10", null, null);

    const update = executedRuns.find((r) => r.sql.includes("UPDATE recurring_transactions"));
    expect(update).toBeUndefined();
  });
});
