/**
 * Duplicate detection unit tests.
 *
 * Covers the sign-aware guardrail (a +500 and a -500 must not cluster) and
 * the split-tender sibling exclusion (two legs of one purchase_group_id must
 * not be flagged as duplicates).
 */

import type { Expense } from "../../services/expense";

let mockExpenses: Expense[] = [];

const mockDb = {
  getAllAsync: jest.fn(async (_sql: string) => mockExpenses),
  getFirstAsync: jest.fn(async () => null),
  runAsync: jest.fn(async () => ({ changes: 0, lastInsertRowId: 0 })),
};

jest.mock("../../database", () => ({
  getDatabase: () => mockDb,
}));

jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(() => undefined),
    set: jest.fn(),
  })),
}));

import { scanForDuplicates } from "../../services/duplicate-detection";

function makeExpense(partial: Partial<Expense> & { id: string; amount: number; date: string }): Expense {
  const base: Expense = {
    id: partial.id,
    user_id: "user-1",
    amount: partial.amount,
    currency: "INR",
    fx_rate: null,
    description: null,
    merchant_name: "Acme Cafe",
    raw_merchant_name: null,
    category_id: null,
    payment_mode_id: null,
    date: partial.date,
    transaction_time: "00:00:00",
    is_right_spend: null,
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
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  return { ...base, ...partial };
}

beforeEach(() => {
  mockExpenses = [];
});

describe("duplicate-detection sign guardrail", () => {
  it("does NOT cluster a +500 and a -500 at the same merchant/date/account", async () => {
    mockExpenses = [
      makeExpense({ id: "a", amount: 500, date: "2026-04-28", account_id: "acct-1" }),
      makeExpense({ id: "b", amount: -500, date: "2026-04-28", account_id: "acct-1" }),
    ];
    const result = await scanForDuplicates("user-1");
    expect(result.groups).toHaveLength(0);
  });

  it("DOES cluster two +500 charges at the same merchant/date/account", async () => {
    mockExpenses = [
      makeExpense({ id: "a", amount: 500, date: "2026-04-28", account_id: "acct-1" }),
      makeExpense({ id: "b", amount: 500, date: "2026-04-28", account_id: "acct-1" }),
    ];
    const result = await scanForDuplicates("user-1");
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].expenses.map((e) => e.id).sort()).toEqual(["a", "b"]);
  });
});

describe("duplicate-detection split-tender exclusion", () => {
  it("does NOT cluster two siblings of the same purchase_group_id", async () => {
    mockExpenses = [
      makeExpense({
        id: "leg-1",
        amount: 500,
        date: "2026-04-28",
        account_id: "acct-card",
        purchase_group_id: "grp-1",
      }),
      makeExpense({
        id: "leg-2",
        amount: 500,
        date: "2026-04-28",
        account_id: "acct-wallet",
        purchase_group_id: "grp-1",
      }),
    ];
    const result = await scanForDuplicates("user-1");
    expect(result.groups).toHaveLength(0);
  });

  it("still clusters two unrelated ₹500 charges even when another pair shares a group", async () => {
    mockExpenses = [
      // Split-tender legs at "Acme Cafe"
      makeExpense({
        id: "leg-1",
        amount: 500,
        date: "2026-04-28",
        account_id: "acct-card",
        merchant_name: "Acme Cafe",
        purchase_group_id: "grp-1",
      }),
      makeExpense({
        id: "leg-2",
        amount: 500,
        date: "2026-04-28",
        account_id: "acct-wallet",
        merchant_name: "Acme Cafe",
        purchase_group_id: "grp-1",
      }),
      // Two genuine duplicates at a different merchant and different account —
      // so they can't be mistaken for siblings of the split-tender group.
      makeExpense({
        id: "dup-1",
        amount: 500,
        date: "2026-04-28",
        account_id: "acct-hdfc",
        merchant_name: "Starbucks",
      }),
      makeExpense({
        id: "dup-2",
        amount: 500,
        date: "2026-04-28",
        account_id: "acct-hdfc",
        merchant_name: "Starbucks",
      }),
    ];
    const result = await scanForDuplicates("user-1");
    // Exactly one duplicate group: {dup-1, dup-2}. No group should include leg-1 or leg-2.
    expect(result.groups).toHaveLength(1);
    const dupIds = result.groups[0].expenses.map((e) => e.id).sort();
    expect(dupIds).toEqual(["dup-1", "dup-2"]);
  });
});

describe("duplicate-detection refund exclusion", () => {
  it("does NOT cluster a refund with its original expense (same-day)", async () => {
    mockExpenses = [
      makeExpense({
        id: "orig",
        amount: 500,
        date: "2026-04-28",
        account_id: "acct-hdfc",
        merchant_name: "Amazon",
        nature: "realized",
      }),
      makeExpense({
        id: "rfnd",
        amount: 500,
        date: "2026-04-28",
        account_id: "acct-hdfc",
        merchant_name: "Amazon",
        nature: "credit",
        refund_of_expense_id: "orig",
      }),
    ];
    const result = await scanForDuplicates("user-1");
    expect(result.groups).toHaveLength(0);
  });

  it("does NOT cluster a refund with its original expense across the same month", async () => {
    // This is the exact bug the user reported: same merchant, same amount,
    // same month, different dates — was being flagged as a monthly duplicate.
    mockExpenses = [
      makeExpense({
        id: "orig",
        amount: 2000,
        date: "2026-04-05",
        account_id: "acct-hdfc",
        merchant_name: "Amazon",
        nature: "realized",
      }),
      makeExpense({
        id: "rfnd",
        amount: 2000,
        date: "2026-04-12",
        account_id: "acct-hdfc",
        merchant_name: "Amazon",
        nature: "credit",
        refund_of_expense_id: "orig",
      }),
    ];
    const result = await scanForDuplicates("user-1");
    expect(result.groups).toHaveLength(0);
  });

  it("does NOT cluster two refunds that happen to share amount/merchant/month", async () => {
    // Each refund is tied to its own original — never flag refunds as dupes.
    mockExpenses = [
      makeExpense({
        id: "rfnd-1",
        amount: 750,
        date: "2026-04-10",
        account_id: "acct-hdfc",
        merchant_name: "Swiggy",
        nature: "credit",
        refund_of_expense_id: "orig-1",
      }),
      makeExpense({
        id: "rfnd-2",
        amount: 750,
        date: "2026-04-22",
        account_id: "acct-hdfc",
        merchant_name: "Swiggy",
        nature: "credit",
        refund_of_expense_id: "orig-2",
      }),
    ];
    const result = await scanForDuplicates("user-1");
    expect(result.groups).toHaveLength(0);
  });

  it("STILL clusters two real realized duplicates in the same month (refund filter doesn't over-reach)", async () => {
    // Sanity check: the refund filter only excludes refunds, not legitimate
    // same-merchant same-amount duplicates on different days.
    mockExpenses = [
      makeExpense({
        id: "a",
        amount: 300,
        date: "2026-04-05",
        account_id: "acct-hdfc",
        merchant_name: "Starbucks",
        nature: "realized",
      }),
      makeExpense({
        id: "b",
        amount: 300,
        date: "2026-04-18",
        account_id: "acct-hdfc",
        merchant_name: "Starbucks",
        nature: "realized",
      }),
    ];
    const result = await scanForDuplicates("user-1");
    expect(result.groups).toHaveLength(1);
    const ids = result.groups[0].expenses.map((e) => e.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });
});
