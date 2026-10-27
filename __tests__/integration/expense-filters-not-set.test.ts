import { DatabaseSync } from "node:sqlite";

/**
 * The Transactions filters' "No category / No payment mode / No account / No tags / No merchant"
 * choice (NOT_SET) and "Not classified" avoidability, against a real SQLite engine. The list and
 * its total share one filter builder, so both are checked.
 */
let mockSqlite: DatabaseSync;

const mockAdapter = {
  getAllAsync: async (sql: string, ...params: unknown[]) =>
    mockSqlite.prepare(sql).all(...(params as never[])) as never[],
  getFirstAsync: async (sql: string, ...params: unknown[]) =>
    (mockSqlite.prepare(sql).get(...(params as never[])) ?? null) as never,
};

jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));

import { getExpensesPaginated, getFilteredExpenseSummary } from "../../services/expense-queries";
import { NOT_SET } from "../../services/expense-types";
import type { ExpenseFilters } from "../../services/expense-types";

beforeEach(() => {
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    CREATE TABLE expenses (
      id TEXT PRIMARY KEY, user_id TEXT, amount REAL, currency TEXT, description TEXT, merchant_name TEXT,
      category_id TEXT, payment_mode_id TEXT, account_id TEXT, date TEXT, transaction_time TEXT, due_date TEXT,
      is_right_spend INTEGER, source TEXT, status TEXT, nature TEXT, split_original_amount REAL,
      split_person_id TEXT, split_pct REAL, split_hisaab_entry_id TEXT, split_mode TEXT, deleted_at TEXT, created_at TEXT,
      reclassified_as_transfer INTEGER, refund_of_expense_id TEXT, applied_rule_id TEXT, applied_rule_ids TEXT
    );
    CREATE TABLE expense_tags (expense_id TEXT, tag_id TEXT);
    INSERT INTO expenses (id, user_id, amount, merchant_name, category_id, payment_mode_id, account_id, is_right_spend, status, nature, date)
    VALUES
      ('full', 'u', 100, 'Swiggy', 'food', 'upi', 'hdfc', 1, 'approved', 'realized', '2026-10-01'),
      ('bare', 'u', 200, NULL, NULL, NULL, NULL, NULL, 'approved', 'realized', '2026-10-02'),
      ('blank', 'u', 300, '  ', 'shop', NULL, 'hdfc', 0, 'approved', 'realized', '2026-10-03');
    INSERT INTO expense_tags VALUES ('full', 'trip');
  `);
});

async function ids(filters: ExpenseFilters): Promise<string[]> {
  const rows = await getExpensesPaginated("u", { ...filters, sortBy: "date_asc" }, 50, 0);
  return rows.map((r) => r.id);
}

test.each([
  ["no category", { categoryIds: [NOT_SET] }, ["bare"]],
  ["no category or food", { categoryIds: [NOT_SET, "food"] }, ["full", "bare"]],
  ["no payment mode", { paymentModeIds: [NOT_SET] }, ["bare", "blank"]],
  ["no account", { accountIds: [NOT_SET] }, ["bare"]],
  ["no tags", { tagIds: [NOT_SET] }, ["bare", "blank"]],
  ["tagged trip or none", { tagIds: ["trip", NOT_SET] }, ["full", "bare", "blank"]],
  ["no merchant (empty or blank)", { merchantNames: [NOT_SET] }, ["bare", "blank"]],
  ["not classified", { avoidability: "unclassified" }, ["bare"]],
  ["unavoidable", { avoidability: "unavoidable" }, ["full"]],
] as [string, ExpenseFilters, string[]][])("%s", async (_name, filters, expected) => {
  expect(await ids(filters)).toEqual(expected);
});

test("the total counts the same rows as the list", async () => {
  const filters: ExpenseFilters = { paymentModeIds: [NOT_SET] };
  const summary = await getFilteredExpenseSummary("u", filters, "category");
  expect(summary.count).toBe(2);
  expect(summary.total).toBe(500);
});
