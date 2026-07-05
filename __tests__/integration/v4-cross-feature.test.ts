/**
 * V4 Cross-Feature Integration Tests (Phase 4 — V4-4.1)
 *
 * Tests the V4 features working together:
 * 1. SMS pipeline: parse → detect payment mode → set transaction_time → create expense
 * 2. Account-mode link: auto-population from SMS detection
 * 3. Comparison insights: service returns correct structure
 * 4. Expense interface: transaction_time + account_id fields
 */

// ══════════════════════════════════════════
// Mocks
// ══════════════════════════════════════════

const mockGetFirstAsync = jest.fn();
const mockGetAllAsync = jest.fn();
const mockRunAsync = jest.fn(async () => ({ changes: 1, lastInsertRowId: 1 }));

jest.mock("../../database", () => ({
  getDatabase: () => ({
    getFirstAsync: mockGetFirstAsync,
    getAllAsync: mockGetAllAsync,
    runAsync: mockRunAsync,
    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
  }),
}));

let mockUuidCounter = 0;
jest.mock("../../utils/uuid", () => ({
  generateUUID: () => `v4-int-uuid-${++mockUuidCounter}`,
}));

import { inferPaymentMode, extractTime } from "../../services/sms/bank-patterns";
import type { ParsedSMS } from "../../services/sms/bank-patterns";
import { getDateRangeComparison, getComparisonPresets } from "../../services/comparison-insights";
import type { Expense } from "../../services/expense";

beforeEach(() => {
  mockGetFirstAsync.mockReset();
  mockGetAllAsync.mockReset();
  mockRunAsync.mockReset().mockResolvedValue({ changes: 1, lastInsertRowId: 1 });
  mockUuidCounter = 0;
});

// ══════════════════════════════════════════
// 1. Full SMS Pipeline Integration
// ══════════════════════════════════════════

describe("SMS Pipeline — Payment Mode + Time Detection", () => {
  it("ICICI UPI debit: detects UPI mode + extracts time", () => {
    const parsed: Partial<ParsedSMS> = {
      amount: 500,
      type: "upi_debit",
      bank: "ICICI",
      merchant: "Zomato",
      date: "2026-04-13",
    };
    const smsBody = "Dear Customer, Rs.500 has been debited from A/c XX1234 on 13-04-26,15:39:39 via UPI to Zomato";

    const mode = inferPaymentMode(parsed as ParsedSMS, smsBody);
    const time = extractTime(smsBody);

    expect(mode).toBe("upi");
    expect(time).toBe("15:39:39");
  });

  it("HDFC credit card: detects credit_card mode", () => {
    const parsed: Partial<ParsedSMS> = {
      amount: 2500,
      type: "debit",
      bank: "HDFC",
      cardLast4: "9628",
      accountType: "credit_card",
      merchant: "Amazon",
      date: "2026-04-13",
    };
    const smsBody = "HDFC Bank CARD ending 9628 was used for Rs.2500 at Amazon on 13-Apr-2026";

    const mode = inferPaymentMode(parsed as ParsedSMS, smsBody);

    expect(mode).toBe("credit_card");
  });

  it("SBI savings debit: detects net_banking mode", () => {
    const parsed: Partial<ParsedSMS> = {
      amount: 10000,
      type: "debit",
      bank: "SBI",
      accountType: "savings",
      merchant: "Electricity Bill",
      date: "2026-04-13",
    };
    const smsBody = "Rs.10000 debited from A/c XX5678 on 13-Apr-2026 for Electricity Bill";

    const mode = inferPaymentMode(parsed as ParsedSMS, smsBody);

    expect(mode).toBe("net_banking");
  });

  it("NACH/Standing instruction: detects auto_debit mode", () => {
    const parsed: Partial<ParsedSMS> = {
      amount: 5000,
      type: "nach_debit",
      bank: "Axis",
      merchant: "HDFC Life Insurance",
      date: "2026-04-13",
    };
    const smsBody = "NACH debit of Rs.5000 processed from your Axis Bank A/c for HDFC Life Insurance";

    const mode = inferPaymentMode(parsed as ParsedSMS, smsBody);

    expect(mode).toBe("auto_debit");
  });

  it("card debit with AVL BAL indicates debit_card", () => {
    const parsed: Partial<ParsedSMS> = {
      amount: 431,
      type: "debit",
      bank: "Axis",
      cardLast4: "2836",
      availableBalance: 12000,
      merchant: "Big Bazaar",
      date: "2026-04-13",
    };
    const smsBody = "Your Axis Bank CARD xx2836 has been debited for Rs 431. AVL BAL Rs 12000";

    const mode = inferPaymentMode(parsed as ParsedSMS, smsBody);

    expect(mode).toBe("debit_card");
  });
});

// ══════════════════════════════════════════
// 2. Time Extraction Edge Cases
// ══════════════════════════════════════════

describe("Time Extraction — SMS Format Coverage", () => {
  it("extracts time from comma-delimited format", () => {
    expect(extractTime("Txn of Rs 1000 on 11-04-26,15:39:39 at Amazon")).toBe("15:39:39");
  });

  it("extracts time from space-delimited format", () => {
    expect(extractTime("Debited Rs 2000 on 11-04-26 14:22:10 via UPI")).toBe("14:22:10");
  });

  it("extracts time from colon-delimited year format", () => {
    expect(extractTime("Transaction on 2026-04-11:09:15:30 for Rs 500")).toBe("09:15:30");
  });

  it("returns null for date-only SMS", () => {
    expect(extractTime("Rs 1000 debited on 11-Apr-2026")).toBeNull();
  });

  it("returns null for amount-only SMS", () => {
    expect(extractTime("Rs 500 debited from your account")).toBeNull();
  });
});

// ══════════════════════════════════════════
// 3. Comparison Insights Integration
// ══════════════════════════════════════════

describe("Comparison Insights — Full Pipeline", () => {
  it("presets generate valid date ranges usable by getDateRangeComparison", async () => {
    const presets = getComparisonPresets();

    // Use the "This Month vs Last Month" preset with the comparison function
    const monthPreset = presets.find((p) => p.label === "This Month vs Last Month")!;

    mockGetFirstAsync.mockResolvedValue({ total: 0, count: 0 });
    mockGetAllAsync.mockResolvedValue([]);

    const result = await getDateRangeComparison(
      "user-1",
      monthPreset.range1Start,
      monthPreset.range1End,
      monthPreset.range2Start,
      monthPreset.range2End,
    );

    expect(result.range1.start).toBe(monthPreset.range1Start);
    expect(result.range2.end).toBe(monthPreset.range2End);
    expect(result.delta).toBeDefined();
    expect(result.byCategory).toBeDefined();
    expect(result.byMerchant).toBeDefined();
    expect(result.byPaymentMode).toBeDefined();
  });

  it("category breakdown maps IDs to names correctly", async () => {
    mockGetFirstAsync.mockResolvedValue({ total: 0, count: 0 });
    mockGetAllAsync
      .mockResolvedValueOnce([
        { category_id: "c-food", category_name: "Food & Dining", range_tag: "r1", total: 2000 },
        { category_id: "c-food", category_name: "Food & Dining", range_tag: "r2", total: 2500 },
        { category_id: "c-transport", category_name: "Transport", range_tag: "r1", total: 800 },
        { category_id: "c-transport", category_name: "Transport", range_tag: "r2", total: 500 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await getDateRangeComparison(
      "user-1", "2026-04-01", "2026-04-07", "2026-04-08", "2026-04-14",
    );

    expect(result.byCategory.some((c) => c.categoryName === "Food & Dining")).toBe(true);
    expect(result.byCategory.some((c) => c.categoryName === "Transport")).toBe(true);
  });

  it("merchant comparison works with lowercase normalization", async () => {
    mockGetFirstAsync.mockResolvedValue({ total: 0, count: 0 });
    mockGetAllAsync
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { merchant_name: "Zomato", range_tag: "r1", total: 500 },
        { merchant_name: "zomato", range_tag: "r2", total: 700 },
      ])
      .mockResolvedValueOnce([]);

    const result = await getDateRangeComparison(
      "user-1", "2026-04-01", "2026-04-07", "2026-04-08", "2026-04-14",
    );

    // Both "Zomato" and "zomato" should merge into one entry
    expect(result.byMerchant).toHaveLength(1);
    expect(result.byMerchant[0].range1Total).toBe(500);
    expect(result.byMerchant[0].range2Total).toBe(700);
    expect(result.byMerchant[0].delta).toBe(200);
  });
});

// ══════════════════════════════════════════
// 4. Expense Interface — V4 Fields
// ══════════════════════════════════════════

describe("Expense Interface — V4 Fields", () => {
  it("Expense has all V4 fields: transaction_time, account_id", () => {
    const expense: Expense = {
      id: "exp-1",
      user_id: "user-1",
      amount: 500,
      currency: "INR",
      fx_rate: null,
      description: "Test",
      merchant_name: "Zomato",
      raw_merchant_name: null,
      category_id: "c1",
      payment_mode_id: "pm1",
      date: "2026-04-13",
      transaction_time: "15:39:39",
      is_right_spend: 1,
      source: "sms_auto",
      status: "approved",
      nature: "realized",
      due_date: null,
      account_id: "acct-1",
      refund_of_expense_id: null,
      raw_source_text: "SMS text here",
      split_original_amount: null,
      split_person_id: null,
      split_pct: null,
      split_hisaab_entry_id: null,
      matched_forecast_id: null,
      deleted_at: null,
      forecast_type: "expense",
      paid_from_account_id: null,
      convenience_fee: 0,
      fee_absorbed: 0,
      purchase_group_id: null,
      recurring_rule_id: null,
      fulfills_rule_id: null,
      split_mode: null,
      split_exact_amount: null,
      applied_rule_id: null,
      reclassified_as_transfer: null,
      linked_transfer_id: null,
      created_at: "2026-04-13T00:00:00",
      updated_at: "2026-04-13T00:00:00",
    };

    expect(expense.transaction_time).toBe("15:39:39");
    expect(expense.account_id).toBe("acct-1");
  });

  it("manual expense gets default time and no account", () => {
    const expense: Expense = {
      id: "exp-2",
      user_id: "user-1",
      amount: 200,
      currency: "INR",
      fx_rate: null,
      description: "Coffee",
      merchant_name: null,
      category_id: "c-food",
      payment_mode_id: "pm-cash",
      date: "2026-04-13",
      raw_merchant_name: null,
      transaction_time: "00:00:00",
      is_right_spend: 1,
      source: "manual",
      status: "approved",
      nature: "realized",
      due_date: null,
      account_id: null,
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
      convenience_fee: 0,
      fee_absorbed: 0,
      purchase_group_id: null,
      recurring_rule_id: null,
      fulfills_rule_id: null,
      split_mode: null,
      split_exact_amount: null,
      applied_rule_id: null,
      reclassified_as_transfer: null,
      linked_transfer_id: null,
      created_at: "2026-04-13T00:00:00",
      updated_at: "2026-04-13T00:00:00",
    };

    expect(expense.transaction_time).toBe("00:00:00");
    expect(expense.account_id).toBeNull();
    expect(expense.source).toBe("manual");
  });
});
