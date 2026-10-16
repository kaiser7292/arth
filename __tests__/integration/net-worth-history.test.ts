import { DatabaseSync } from "node:sqlite";

/**
 * computeNetWorthHistory against a real SQLite engine (same harness as
 * balance-sheet-fd-nesting.test.ts). Covers the three things that would put
 * fake drops in the trend line - missing opening rows, closed accounts, demat
 * months with no snapshot - and that the change split always adds up.
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
  withTransactionAsync: async (cb: () => Promise<void>) => cb(),
};

jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));
jest.mock("../../services/feature-flags", () => ({ V15_FLAGS: { v17_loans_v1: false } }));
jest.mock("../../services/settings", () => ({ getDataVersion: () => 0 }));

import { changeBetween, computeNetWorthHistory } from "../../services/net-worth-history";

function seed(sql = "") {
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    CREATE TABLE financial_accounts (
      id TEXT PRIMARY KEY, user_id TEXT, account_type TEXT, last_known_balance REAL,
      last_balance_date TEXT, created_at TEXT, is_active INTEGER DEFAULT 1, closed_at TEXT
    );
    CREATE TABLE account_month_balances (
      account_id TEXT, month TEXT, opening_balance REAL, is_manual_override INTEGER DEFAULT 0
    );
    CREATE TABLE expenses (
      id TEXT PRIMARY KEY, account_id TEXT, amount REAL, split_original_amount REAL,
      nature TEXT, status TEXT DEFAULT 'approved', deleted_at TEXT, reclassified_as_transfer INTEGER,
      date TEXT, description TEXT
    );
    CREATE TABLE account_transfers (
      id TEXT PRIMARY KEY, from_account_id TEXT, to_account_id TEXT, amount REAL, date TEXT, deleted_at TEXT
    );
    CREATE TABLE investment_products (
      id TEXT PRIMARY KEY, financial_account_id TEXT, instrument TEXT, valuation TEXT,
      source_account_id TEXT, status TEXT DEFAULT 'active', maturity_date TEXT, updated_at TEXT
    );
    CREATE TABLE demat_portfolio_snapshots (account_id TEXT, snapshot_date TEXT, portfolio_value REAL);
    CREATE TABLE demat_fund_snapshots (account_id TEXT, snapshot_date TEXT, fund_value REAL);
    CREATE TABLE hisaab_persons (id TEXT PRIMARY KEY, owner_user_id TEXT, is_active INTEGER, initial_balance REAL,
      created_at TEXT, exclude_from_net_worth INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE hisaab_entries (id TEXT PRIMARY KEY, hisaab_person_id TEXT, type TEXT, amount REAL, date TEXT, linked_expense_id TEXT);
  `);
  mockSqlite.exec(sql);
}

const byMonth = async (today: string) => {
  const { points } = await computeNetWorthHistory("u1", today);
  return { points, at: (m: string) => points.find((p) => p.month === m)! };
};

describe("computeNetWorthHistory", () => {
  it("carries the balance forward through months with no opening-balance row", async () => {
    seed(`
      INSERT INTO financial_accounts (id, user_id, account_type) VALUES ('s1', 'u1', 'savings');
      INSERT INTO account_month_balances (account_id, month, opening_balance) VALUES ('s1', '2026-01', 100000);
      INSERT INTO expenses (id, account_id, amount, nature, date) VALUES ('e1', 's1', 10000, 'realized', '2026-02-10');
      INSERT INTO expenses (id, account_id, amount, nature, date) VALUES ('c1', 's1', 50000, 'credit', '2026-04-01');
    `);
    const { points, at } = await byMonth("2026-04-15");
    expect(points.map((p) => p.month)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(at("2026-01").netWorth).toBe(100000);
    expect(at("2026-02").netWorth).toBe(90000);
    expect(at("2026-03").netWorth).toBe(90000); // no row, no activity - not a drop to zero
    expect(at("2026-04").netWorth).toBe(140000);
  });

  it("re-anchors a non-override row to the previous closing but keeps a manual override", async () => {
    seed(`
      INSERT INTO financial_accounts (id, user_id, account_type) VALUES ('s1', 'u1', 'savings');
      INSERT INTO account_month_balances VALUES ('s1', '2026-01', 1000, 0);
      INSERT INTO account_month_balances VALUES ('s1', '2026-02', 5555, 0);
      INSERT INTO account_month_balances VALUES ('s1', '2026-03', 7000, 1);
    `);
    const { at } = await byMonth("2026-03-20");
    expect(at("2026-02").netWorth).toBe(1000);
    expect(at("2026-03").netWorth).toBe(7000);
  });

  it("counts a closed account in the months it was open, not after", async () => {
    seed(`
      INSERT INTO financial_accounts (id, user_id, account_type, closed_at) VALUES ('s1', 'u1', 'savings', '2026-03-05');
      INSERT INTO financial_accounts (id, user_id, account_type) VALUES ('s2', 'u1', 'savings');
      INSERT INTO account_month_balances VALUES ('s1', '2026-01', 20000, 0);
      INSERT INTO account_month_balances VALUES ('s2', '2026-01', 30000, 0);
    `);
    const { at } = await byMonth("2026-04-10");
    expect(at("2026-01").netWorth).toBe(50000);
    expect(at("2026-02").netWorth).toBe(50000);
    expect(at("2026-03").netWorth).toBe(30000);
    expect(at("2026-04").netWorth).toBe(30000);
  });

  it("chains an unseeded account backwards from its SMS balance", async () => {
    seed(`
      INSERT INTO financial_accounts (id, user_id, account_type, last_known_balance, last_balance_date, created_at)
      VALUES ('s1', 'u1', 'savings', 80000, '2026-03-20', '2026-03-01 10:00:00');
      INSERT INTO expenses (id, account_id, amount, nature, date) VALUES ('e1', 's1', 5000, 'realized', '2026-02-10');
      INSERT INTO expenses (id, account_id, amount, nature, date) VALUES ('c1', 's1', 20000, 'credit', '2026-03-02');
    `);
    const { at } = await byMonth("2026-03-25");
    expect(at("2026-03").netWorth).toBe(80000);
    expect(at("2026-02").netWorth).toBe(60000); // 80000 − March's +20000
    expect(at("2026-02").estimated).toBe(false);
  });

  it("carries a demat snapshot forward and keeps money moved in out of market gains", async () => {
    seed(`
      INSERT INTO financial_accounts (id, user_id, account_type) VALUES ('s1', 'u1', 'savings');
      INSERT INTO financial_accounts (id, user_id, account_type) VALUES ('d1', 'u1', 'demat');
      INSERT INTO account_month_balances VALUES ('s1', '2026-01', 100000, 0);
      INSERT INTO demat_portfolio_snapshots VALUES ('d1', '2026-01-31', 50000);
      INSERT INTO account_transfers VALUES ('t1', 's1', 'd1', 20000, '2026-02-05', NULL);
      INSERT INTO demat_portfolio_snapshots VALUES ('d1', '2026-02-28', 75000);
    `);
    const { points, at } = await byMonth("2026-05-10");
    expect(at("2026-02").change.marketGains).toBe(5000); // 75000 − 50000 − 20000 moved in
    expect(at("2026-02").change.saved).toBe(0); // savings −20000, +20000 moved into investments
    expect(at("2026-04").market).toBe(75000); // carried forward, no snapshot in April
    expect(at("2026-04").investments).toBe(75000);
    expect(at("2026-04").liquidCash).toBe(80000);
    expect(at("2026-04").estimated).toBe(true);

    const total = changeBetween(points, 0, points.length - 1);
    const delta = points[points.length - 1].netWorth - points[0].netWorth;
    expect(total.saved + total.marketGains + total.loansPaidDown + total.other).toBeCloseTo(delta, 2);
  });

  it("treats credit-card dues as a liability and Hisaab balances by sign", async () => {
    seed(`
      INSERT INTO financial_accounts (id, user_id, account_type) VALUES ('s1', 'u1', 'savings');
      INSERT INTO financial_accounts (id, user_id, account_type) VALUES ('cc1', 'u1', 'credit_card');
      INSERT INTO account_month_balances VALUES ('s1', '2026-01', 100000, 0);
      INSERT INTO account_month_balances VALUES ('cc1', '2026-01', 0, 1);
      INSERT INTO expenses (id, account_id, amount, nature, date) VALUES ('e1', 'cc1', 12000, 'realized', '2026-01-10');
      INSERT INTO hisaab_persons VALUES ('p1', 'u1', 1, 0, '2026-01-01', 0);
      INSERT INTO hisaab_entries VALUES ('h1', 'p1', 'debit', 3000, '2026-01-12', NULL);
    `);
    const { at } = await byMonth("2026-01-31");
    expect(at("2026-01").cards).toBe(12000);
    expect(at("2026-01").hisaab).toBe(3000);
    expect(at("2026-01").netWorth).toBe(91000);
    // The Balance Sheet's sections.
    expect(at("2026-01").liquidCash).toBe(100000);
    expect(at("2026-01").receivables).toBe(3000);
    expect(at("2026-01").payables).toBe(0);
  });

  it("returns no points when there is no data", async () => {
    seed();
    const { points } = await computeNetWorthHistory("u1", "2026-05-01");
    expect(points).toEqual([]);
  });
});
