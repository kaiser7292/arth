import { DatabaseSync } from "node:sqlite";

/**
 * Smart rules on SMS-detected transactions, against a REAL SQLite engine.
 *
 * Regression for: a rule showed as "applied" (applied_rule_id stamped, scan
 * run listed it) but its actions never landed — the SMS debit path dropped
 * set_description / is_right_spend / tags, and SMS credits/refunds never
 * evaluated rules at all.
 *
 * Everything around the rule step (account discovery, categorizer, merchant
 * alias, transfer detection) is mocked; smart-rules + tags run for real.
 */
let mockSqlite: DatabaseSync;

const mockAdapter = {
  runAsync: async (sql: string, ...params: unknown[]) => {
    mockSqlite.prepare(sql).run(...(params as never[]));
    return { changes: 0, lastInsertRowId: 0 };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) =>
    mockSqlite.prepare(sql).all(...(params as never[])) as never[],
  getFirstAsync: async (sql: string, ...params: unknown[]) =>
    (mockSqlite.prepare(sql).get(...(params as never[])) ?? null) as never,
};

jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));
jest.mock("../../services/settings", () => ({ bumpDataVersion: jest.fn() }));
jest.mock("../../services/feature-flags", () => ({ getFlag: () => true }));
jest.mock("../../services/account-master", () => ({
  autoPopulateAccountMode: jest.fn(),
  findPaymentModeByType: jest.fn(async () => null),
}));
const mockAutoDetectTransfer = jest.fn(async (): Promise<string | null> => null);
const mockCreateTransfer = jest.fn(async () => "transfer-1");
jest.mock("../../services/account-transfer", () => ({
  autoDetectTransfer: (...args: unknown[]) => mockAutoDetectTransfer(...(args as [])),
  createTransfer: (...args: unknown[]) => mockCreateTransfer(...(args as [])),
}));
jest.mock("../../services/expense", () => ({
  findMatchingForecast: jest.fn(async () => null),
  findRefundTarget: jest.fn(async () => null),
}));
jest.mock("../../services/expense-forecasts", () => ({
  findMatchingRepaymentForecast: jest.fn(async () => null),
  markRepaymentAsPaid: jest.fn(),
}));
jest.mock("../../services/financial-account", () => ({
  discoverOrUpdateAccount: jest.fn(async () => "acct-1"),
  handlePaymentReceived: jest.fn(),
  linkExpenseToAccount: jest.fn(),
  updateAccountDues: jest.fn(),
  updateNachInfo: jest.fn(),
}));
jest.mock("../../services/merchant-alias", () => ({
  cleanMerchantName: (m: string) => m,
  normalizeMerchantName: async (_u: string, m: string | null) => m,
}));
jest.mock("../../services/smart-categorizer", () => ({
  categorizeByMerchant: jest.fn(async () => ({ categoryId: null })),
}));
jest.mock("../../services/expense-splits", () => ({ splitExistingExpense: jest.fn() }));
jest.mock("../../services/sms/sms-parser", () => ({
  markSmsFailed: jest.fn(),
  markSmsIgnored: jest.fn(),
  markSmsProcessed: jest.fn(),
}));

import { createExpenseFromSms } from "../../services/sms/sms-to-expense";
import type { ParsedSMS } from "../../services/sms/bank-patterns";

function seed() {
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    CREATE TABLE expenses (
      id TEXT PRIMARY KEY, user_id TEXT, amount REAL, currency TEXT, description TEXT,
      merchant_name TEXT, raw_merchant_name TEXT, category_id TEXT, payment_mode_id TEXT,
      account_id TEXT, date TEXT, transaction_time TEXT, nature TEXT, is_right_spend INTEGER,
      source TEXT, status TEXT, raw_source_text TEXT, matched_forecast_id TEXT,
      refund_of_expense_id TEXT, applied_rule_id TEXT, applied_rule_ids TEXT,
      deleted_at TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE smart_rules (
      id TEXT PRIMARY KEY, user_id TEXT, name TEXT, priority INTEGER, is_active INTEGER,
      match_mode TEXT, applies_to TEXT, conditions TEXT, actions TEXT,
      action_link_to_investment_bucket_id TEXT, apply_count INTEGER DEFAULT 0,
      last_applied_at TEXT, pending_retroactive INTEGER DEFAULT 0, deleted_at TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE expense_tags (expense_id TEXT, tag_id TEXT, PRIMARY KEY (expense_id, tag_id));
    CREATE TABLE investment_schedule_entries (id TEXT, linked_expense_id TEXT, status TEXT);
    CREATE TABLE financial_accounts (id TEXT PRIMARY KEY, account_identifier TEXT);
  `);
}

function addRule(id: string, priority: number, appliesTo: string, conditions: unknown[], actions: unknown[]) {
  mockSqlite
    .prepare(
      `INSERT INTO smart_rules (id, user_id, name, priority, is_active, match_mode, applies_to, conditions, actions, created_at, updated_at)
       VALUES (?, 'u1', ?, ?, 1, 'all', ?, ?, ?, '2026-01-01', '2026-01-01');`,
    )
    .run(id, `Rule ${id}`, priority, appliesTo, JSON.stringify(conditions), JSON.stringify(actions));
}

function expenseRow(id: string) {
  return mockSqlite.prepare(`SELECT * FROM expenses WHERE id = ?;`).get(id) as Record<string, unknown>;
}

function tagsOf(id: string): string[] {
  return (mockSqlite.prepare(`SELECT tag_id FROM expense_tags WHERE expense_id = ? ORDER BY tag_id;`).all(id) as { tag_id: string }[])
    .map((r) => r.tag_id);
}

const merchantIs = (m: string) => ({ field: "merchant", operator: "contains", value: m });

function debit(overrides: Partial<ParsedSMS> = {}): ParsedSMS {
  return {
    type: "debit",
    amount: 500,
    merchant: "SWIGGY",
    bank: "HDFC",
    cardLast4: "1234",
    date: "2026-09-20",
    ...overrides,
  } as ParsedSMS;
}

beforeEach(() => {
  seed();
  mockAutoDetectTransfer.mockReset().mockResolvedValue(null);
  mockCreateTransfer.mockClear();
});

describe("SMS debit — every rule action lands", () => {
  it("applies description, right-spend and tags, not just category", async () => {
    addRule("r1", 10, "expense", [merchantIs("SWIGGY")], [
      { type: "category", category_id: "cat-food" },
      { type: "set_description", description_template: "Dinner order" },
      { type: "is_right_spend", is_right_spend: false },
      { type: "tags", tag_ids: ["tag-a", "tag-b"] },
    ]);

    const res = await createExpenseFromSms("u1", "sms-1", debit(), "Rs 500 debited at SWIGGY");
    const row = expenseRow(res.expenseId!);

    expect(res.appliedRuleIds).toEqual(["r1"]);
    expect(row.category_id).toBe("cat-food");
    expect(row.description).toBe("Dinner order");
    expect(row.is_right_spend).toBe(0);
    expect(row.status).toBe("pending_review");
    expect(tagsOf(res.expenseId!)).toEqual(["tag-a", "tag-b"]);
  });

  it("stamps the FIRST matched rule as applied_rule_id (same as manual entry) and records all", async () => {
    addRule("r-low", 10, "expense", [merchantIs("SWIGGY")], [{ type: "tags", tag_ids: ["t1"] }]);
    addRule("r-high", 20, "expense", [merchantIs("SWIGGY")], [{ type: "tags", tag_ids: ["t2"] }]);

    const res = await createExpenseFromSms("u1", "sms-2", debit(), "body");
    const row = expenseRow(res.expenseId!);

    expect(row.applied_rule_id).toBe("r-low");
    expect(JSON.parse(row.applied_rule_ids as string)).toEqual(["r-low", "r-high"]);
    expect(tagsOf(res.expenseId!)).toEqual(["t1", "t2"]);
  });

  it("mark_auto approves the expense", async () => {
    addRule("r1", 10, "expense", [merchantIs("SWIGGY")], [{ type: "mark_auto" }]);
    const res = await createExpenseFromSms("u1", "sms-3", debit(), "body");
    expect(expenseRow(res.expenseId!).status).toBe("approved");
  });

  it("does not convert a rule-categorized debit into a self-transfer", async () => {
    mockAutoDetectTransfer.mockResolvedValue("acct-2");
    addRule("r1", 10, "expense", [merchantIs("LANDLORD")], [{ type: "category", category_id: "cat-rent" }]);

    const res = await createExpenseFromSms(
      "u1", "sms-4", debit({ merchant: "LANDLORD", paymentMode: "net_banking" } as Partial<ParsedSMS>), "body",
    );

    expect(expenseRow(res.expenseId!).deleted_at).toBeNull();
    expect(mockCreateTransfer).not.toHaveBeenCalled();
  });

  it("still detects self-transfers when no rule classified the debit", async () => {
    mockAutoDetectTransfer.mockResolvedValue("acct-2");

    const res = await createExpenseFromSms(
      "u1", "sms-5", debit({ merchant: "SELF", paymentMode: "net_banking" } as Partial<ParsedSMS>), "body",
    );

    expect(expenseRow(res.expenseId!).deleted_at).not.toBeNull();
    expect(mockCreateTransfer).toHaveBeenCalledTimes(1);
  });
});

describe("SMS credits and refunds — rules now evaluated", () => {
  it("applies a credit rule to a credit SMS", async () => {
    addRule("rc", 10, "credit", [merchantIs("ACME PAYROLL")], [
      { type: "category", category_id: "cat-salary" },
      { type: "set_description", description_template: "Salary" },
      { type: "tags", tag_ids: ["tag-income"] },
    ]);

    const res = await createExpenseFromSms(
      "u1", "sms-6", debit({ type: "credit", merchant: "ACME PAYROLL", amount: 90000 } as Partial<ParsedSMS>), "credited",
    );
    const row = expenseRow(res.expenseId!);

    expect(res.appliedRuleIds).toEqual(["rc"]);
    expect(row.nature).toBe("credit");
    expect(row.category_id).toBe("cat-salary");
    expect(row.description).toBe("Salary");
    expect(row.applied_rule_id).toBe("rc");
    expect(tagsOf(res.expenseId!)).toEqual(["tag-income"]);
  });

  it("does not apply expense-only rules to credits", async () => {
    addRule("re", 10, "expense", [merchantIs("ACME")], [{ type: "category", category_id: "cat-x" }]);

    const res = await createExpenseFromSms(
      "u1", "sms-7", debit({ type: "credit", merchant: "ACME" } as Partial<ParsedSMS>), "credited",
    );

    expect(res.appliedRuleIds).toBeNull();
    expect(expenseRow(res.expenseId!).category_id).toBeNull();
  });

  it("applies a credit rule to a refund SMS", async () => {
    addRule("rr", 10, "any", [merchantIs("AMAZON")], [{ type: "category", category_id: "cat-shopping" }]);

    const res = await createExpenseFromSms(
      "u1", "sms-8", debit({ type: "refund", merchant: "AMAZON" } as Partial<ParsedSMS>), "refund",
    );

    expect(res.appliedRuleIds).toEqual(["rr"]);
    expect(expenseRow(res.expenseId!).category_id).toBe("cat-shopping");
  });
});
