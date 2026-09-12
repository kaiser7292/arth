import { DatabaseSync } from "node:sqlite";

/**
 * tryMatchExpenseToEMI's optional loanAccountId filter (added for the "Mark as
 * loan repayment" smart-rule action) against a REAL SQLite engine. The thing
 * that can actually be wrong here is the WHERE-clause/param-binding change —
 * a mock that records SQL strings can't catch a param shifted out of order.
 *
 * The canonical link path (services/expense-loan-link.ts) is reached via a
 * dynamic import, which this Jest/Babel setup can't intercept with jest.mock
 * (dynamic import needs --experimental-vm-modules) — it always fails here and
 * the function falls back to its own direct UPDATE of loan_schedule_entries.
 * That fallback is exactly what's asserted on below; it still exercises the
 * candidate-selection query this test is actually about.
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

import { tryMatchExpenseToEMI } from "../../services/loan-sms-matcher";

function seed() {
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    CREATE TABLE expenses (id TEXT PRIMARY KEY, amount REAL, date TEXT, nature TEXT, deleted_at TEXT);
    CREATE TABLE financial_accounts (id TEXT PRIMARY KEY, user_id TEXT, bank_name TEXT, account_identifier TEXT);
    CREATE TABLE loan_accounts (id TEXT PRIMARY KEY, financial_account_id TEXT, status TEXT);
    CREATE TABLE loan_schedule_entries (
      id TEXT PRIMARY KEY, loan_account_id TEXT, installment_num INTEGER,
      due_date TEXT, emi_amount REAL, status TEXT,
      linked_expense_id TEXT, paid_date TEXT, paid_amount REAL
    );
  `);
  // Two active loans for the same user, both with an EMI due around the same
  // date and amount — genuinely ambiguous without a loanAccountId filter.
  mockSqlite.exec(`
    INSERT INTO financial_accounts VALUES ('fa-car', 'u1', 'Car Loan Bank', '1111');
    INSERT INTO financial_accounts VALUES ('fa-home', 'u1', 'Home Loan Bank', '2222');
    INSERT INTO loan_accounts VALUES ('loan-car', 'fa-car', 'active');
    INSERT INTO loan_accounts VALUES ('loan-home', 'fa-home', 'active');
    INSERT INTO loan_schedule_entries VALUES ('se-car-1', 'loan-car', 1, '2026-03-05', 10000, 'scheduled', NULL, NULL, NULL);
    INSERT INTO loan_schedule_entries VALUES ('se-home-1', 'loan-home', 1, '2026-03-04', 10000, 'scheduled', NULL, NULL, NULL);
    INSERT INTO expenses VALUES ('exp-1', 10000, '2026-03-05', 'realized', NULL);
  `);
}

function scheduleStatus(id: string): { status: string; linked_expense_id: string | null } {
  return mockSqlite
    .prepare("SELECT status, linked_expense_id FROM loan_schedule_entries WHERE id = ?")
    .get(id) as { status: string; linked_expense_id: string | null };
}

describe("tryMatchExpenseToEMI — loanAccountId scoping", () => {
  it("without a loanAccountId, matches the closest candidate across all active loans", async () => {
    seed();
    const matched = await tryMatchExpenseToEMI("exp-1", "u1");
    expect(matched).toBe("se-car-1"); // exact date match beats se-home-1 (1 day off)
    expect(scheduleStatus("se-car-1")).toEqual({ status: "paid", linked_expense_id: "exp-1" });
    expect(scheduleStatus("se-home-1").status).toBe("scheduled");
  });

  it("with a loanAccountId, only considers that loan even when another loan matches more closely", async () => {
    seed();
    const matched = await tryMatchExpenseToEMI("exp-1", "u1", "loan-home");
    expect(matched).toBe("se-home-1");
    expect(scheduleStatus("se-home-1")).toEqual({ status: "paid", linked_expense_id: "exp-1" });
    expect(scheduleStatus("se-car-1").status).toBe("scheduled"); // untouched — not the rule's chosen loan
  });

  it("with a loanAccountId that has no eligible installment, returns null instead of falling back to another loan", async () => {
    seed();
    mockSqlite.exec(`
      INSERT INTO financial_accounts VALUES ('fa-other', 'u1', 'Other Bank', '3333');
      INSERT INTO loan_accounts VALUES ('loan-other', 'fa-other', 'active');
    `);
    const matched = await tryMatchExpenseToEMI("exp-1", "u1", "loan-other");
    expect(matched).toBeNull();
    expect(scheduleStatus("se-car-1").status).toBe("scheduled");
    expect(scheduleStatus("se-home-1").status).toBe("scheduled");
  });
});
