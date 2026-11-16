import { DatabaseSync } from "node:sqlite";

/**
 * Month headings in the Transactions list: per-month totals for the list's filters, from the
 * database. The list is paged, so these must not depend on which rows happen to be loaded.
 */
let mockSqlite: DatabaseSync;

const mockAdapter = {
  getAllAsync: async (sql: string, ...params: unknown[]) =>
    mockSqlite.prepare(sql).all(...(params as never[])) as never[],
  getFirstAsync: async (sql: string, ...params: unknown[]) =>
    (mockSqlite.prepare(sql).get(...(params as never[])) ?? null) as never,
};

jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));

import { getExpensesPaginated, getFilteredExpenseSummary, getFilteredMonthTotals } from "../../services/expense-queries";

beforeEach(() => {
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    CREATE TABLE expenses (
      id TEXT PRIMARY KEY, user_id TEXT, amount REAL, currency TEXT, description TEXT, merchant_name TEXT,
      category_id TEXT, payment_mode_id TEXT, account_id TEXT, date TEXT, transaction_time TEXT, due_date TEXT,
      is_right_spend INTEGER, source TEXT, status TEXT, nature TEXT, split_original_amount REAL,
      split_person_id TEXT, split_pct REAL, split_hisaab_entry_id TEXT, split_mode TEXT, deleted_at TEXT, created_at TEXT, credit_kind TEXT,
      reclassified_as_transfer INTEGER, refund_of_expense_id TEXT, applied_rule_id TEXT, applied_rule_ids TEXT, money_event TEXT
    );
    CREATE TABLE expense_tags (expense_id TEXT, tag_id TEXT);
    CREATE TABLE expense_loan_links (expense_id TEXT);
    CREATE TABLE expense_investment_links (expense_id TEXT);
    INSERT INTO expenses (id, user_id, amount, category_id, status, nature, date, refund_of_expense_id, split_original_amount, deleted_at)
    VALUES
      ('oct-a', 'u', 100, 'food', 'approved', 'realized', '2026-10-03', NULL, NULL, NULL),
      ('oct-b', 'u', 300, 'shop', 'approved', 'realized', '2026-10-20', NULL, NULL, NULL),
      ('oct-split', 'u', 50, 'food', 'approved', 'realized', '2026-10-21', NULL, 200, NULL),
      ('oct-pay', 'u', 1000, NULL, 'approved', 'credit', '2026-10-01', NULL, NULL, NULL),
      ('nov-a', 'u', 80, 'food', 'approved', 'realized', '2026-11-02', NULL, NULL, NULL),
      ('nov-refund', 'u', 100, NULL, 'approved', 'credit', '2026-11-05', 'oct-b', NULL, NULL),
      ('nov-gone', 'u', 999, 'food', 'approved', 'realized', '2026-11-06', NULL, NULL, '2026-11-07'),
      ('nov-rejected', 'u', 999, 'food', 'rejected', 'realized', '2026-11-08', NULL, NULL, NULL);
  `);
});

test("spending list: one total per month, after refunds and your share of splits", async () => {
  const months = await getFilteredMonthTotals("u", { nature: "realized" });
  expect([...months.keys()].sort()).toEqual(["2026-10", "2026-11"]);
  // 100 + (300 − 100 refunded) + 50 (your share of a 200 bill)
  expect(months.get("2026-10")).toEqual({ month: "2026-10", spent: 350, received: 0, count: 3 });
  expect(months.get("2026-11")).toEqual({ month: "2026-11", spent: 80, received: 0, count: 1 });
});

test("All: spends as paid and credits as received, each in its own month", async () => {
  const months = await getFilteredMonthTotals("u", { nature: "all" });
  // On All the refund is its own row, so the spend isn't reduced by it as well.
  expect(months.get("2026-10")).toMatchObject({ spent: 450, received: 1000, count: 4 });
  expect(months.get("2026-11")).toMatchObject({ spent: 80, received: 100, count: 2 });
});

test("follows the list's filters", async () => {
  const months = await getFilteredMonthTotals("u", { nature: "realized", categoryIds: ["food"], startDate: "2026-10-01", endDate: "2026-10-31" });
  expect([...months.keys()]).toEqual(["2026-10"]);
  expect(months.get("2026-10")).toMatchObject({ spent: 150, count: 2 });
});

test("a half-loaded month still shows its whole total", async () => {
  // First page holds only part of October.
  const page = await getExpensesPaginated("u", { nature: "realized", sortBy: "date_desc" }, 2, 0);
  expect(page.map((e) => e.id)).toEqual(["nov-a", "oct-split"]);
  const months = await getFilteredMonthTotals("u", { nature: "realized" });
  expect(months.get("2026-10")?.count).toBe(3);
});

test("the months add up to the list's total", async () => {
  const filters = { nature: "realized" as const };
  const months = await getFilteredMonthTotals("u", filters);
  const summary = await getFilteredExpenseSummary("u", filters, "category");
  const sum = [...months.values()].reduce((s, m) => s + m.spent, 0);
  expect(sum).toBeCloseTo(summary.total, 2);
  expect([...months.values()].reduce((s, m) => s + m.count, 0)).toBe(summary.count);
});
