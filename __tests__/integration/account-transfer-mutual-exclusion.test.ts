import { DatabaseSync } from "node:sqlite";

/**
 * reclassifyExpenseAsTransfer must refuse when the expense is already linked
 * to an investment bucket or a loan payment — Mark as Transfer / Mark as
 * Fixed Deposit, Mark as Investment, and Mark as Loan Payment are mutually
 * exclusive (three contradictory categorizations of one transaction would
 * otherwise double-count it). expense-investment-link.ts and
 * expense-loan-link.ts already refused the reverse direction; this is the
 * missing guard on the transfer side. Both new guards throw BEFORE
 * createTransfer is ever reached, so this fixture only needs the tables the
 * guard itself touches.
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

import { reclassifyExpenseAsTransfer } from "../../services/account-transfer";

function seed() {
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    CREATE TABLE expenses (
      id TEXT PRIMARY KEY, user_id TEXT, account_id TEXT, amount REAL, date TEXT,
      merchant_name TEXT, raw_source_text TEXT, source TEXT,
      split_mode TEXT, split_person_id TEXT, matched_forecast_id TEXT, fulfills_rule_id TEXT,
      updated_at TEXT, nature TEXT DEFAULT 'realized', deleted_at TEXT
    );
    CREATE TABLE expense_investment_links (id TEXT PRIMARY KEY, expense_id TEXT);
    CREATE TABLE expense_loan_links (id TEXT PRIMARY KEY, expense_id TEXT);
  `);
  mockSqlite
    .prepare(
      `INSERT INTO expenses (id, user_id, account_id, amount, date, updated_at)
       VALUES ('exp-1', 'u1', 'savings-fa', 500, '2026-01-01', 'now');`,
    )
    .run();
}

describe("reclassifyExpenseAsTransfer — mutual exclusion", () => {
  it("refuses when the expense is already linked to an investment bucket", async () => {
    seed();
    mockSqlite.prepare("INSERT INTO expense_investment_links (id, expense_id) VALUES ('l1', 'exp-1');").run();
    await expect(reclassifyExpenseAsTransfer("exp-1", "target-fa")).rejects.toThrow(/already marked as an investment/i);
  });

  it("refuses when the expense is already linked to a loan payment", async () => {
    seed();
    mockSqlite.prepare("INSERT INTO expense_loan_links (id, expense_id) VALUES ('l1', 'exp-1');").run();
    await expect(reclassifyExpenseAsTransfer("exp-1", "target-fa")).rejects.toThrow(/already linked to a loan payment/i);
  });
});
