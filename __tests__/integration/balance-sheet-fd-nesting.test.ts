import { DatabaseSync } from "node:sqlite";

/**
 * getBalanceSheetColumn's FD-nesting behavior against a REAL SQLite engine —
 * same approach as the other services/simulator.ts DB tests in this repo. An
 * FD (financial_accounts.account_type='investment', investment_products
 * .valuation='contract') should render as a child of its source savings
 * account's row rather than its own top-level asset row, and its value must
 * still be counted exactly once in totalAssets/netWorth.
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
// Skip the loan-outstanding path entirely — no loan_accounts table in this
// fixture, and this test isn't about loans.
jest.mock("../../services/feature-flags", () => ({
  V15_FLAGS: { v17_loans_v1: false },
}));

import { getBalanceSheetColumn } from "../../services/balance-sheet";

function seed() {
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    CREATE TABLE financial_accounts (
      id TEXT PRIMARY KEY, user_id TEXT, account_type TEXT, account_label TEXT,
      bank_name TEXT, account_identifier TEXT, last_known_balance REAL,
      is_active INTEGER DEFAULT 1, closed_at TEXT
    );
    CREATE TABLE account_month_balances (
      account_id TEXT, month TEXT, opening_balance REAL
    );
    CREATE TABLE expenses (
      id TEXT PRIMARY KEY, account_id TEXT, amount REAL, split_original_amount REAL,
      nature TEXT, status TEXT, deleted_at TEXT, reclassified_as_transfer INTEGER,
      date TEXT, description TEXT
    );
    CREATE TABLE account_transfers (
      id TEXT PRIMARY KEY, from_account_id TEXT, to_account_id TEXT, amount REAL,
      date TEXT, deleted_at TEXT
    );
    CREATE TABLE investment_products (
      id TEXT PRIMARY KEY, financial_account_id TEXT, instrument TEXT, valuation TEXT,
      source_account_id TEXT, status TEXT DEFAULT 'active'
    );
    CREATE TABLE demat_portfolio_snapshots (account_id TEXT, snapshot_date TEXT, portfolio_value REAL);
    CREATE TABLE demat_fund_snapshots (account_id TEXT, snapshot_date TEXT, fund_value REAL);
    CREATE TABLE hisaab_persons (id TEXT PRIMARY KEY, owner_user_id TEXT, is_active INTEGER, initial_balance REAL);
    CREATE TABLE hisaab_entries (id TEXT PRIMARY KEY, hisaab_person_id TEXT, type TEXT, amount REAL, date TEXT, linked_expense_id TEXT);
  `);

  mockSqlite.exec(`
    INSERT INTO financial_accounts (id, user_id, account_type, account_label, bank_name, account_identifier, last_known_balance)
    VALUES ('savings-1', 'u1', 'savings', 'HDFC Savings', 'HDFC', '1234', NULL);
    INSERT INTO financial_accounts (id, user_id, account_type, account_label, bank_name, account_identifier, last_known_balance)
    VALUES ('fd-1', 'u1', 'investment', 'Tax saver FD', 'HDFC', 'FD001', NULL);

    INSERT INTO account_month_balances (account_id, month, opening_balance) VALUES ('savings-1', '2026-05', 100000);
    INSERT INTO account_month_balances (account_id, month, opening_balance) VALUES ('fd-1', '2026-05', 50000);

    INSERT INTO investment_products (id, financial_account_id, instrument, valuation, source_account_id)
    VALUES ('prod-1', 'fd-1', 'fd', 'contract', 'savings-1');
  `);
}

describe("getBalanceSheetColumn — FD nesting", () => {
  it("nests the FD under its source savings row instead of a top-level row", async () => {
    seed();
    const col = await getBalanceSheetColumn("u1", "2026-05-20", "Today", true, null);

    const savingsRow = col.assets.find((r) => r.group === "savings");
    expect(savingsRow).toBeDefined();
    expect(savingsRow!.amount).toBe(100000);

    // No top-level 'investment' row — it should live under savings-1's children.
    expect(col.assets.find((r) => r.group === "investment")).toBeUndefined();
    expect(savingsRow!.children).toHaveLength(1);
    expect(savingsRow!.children![0].group).toBe("investment");
    expect(savingsRow!.children![0].amount).toBe(50000);
    expect(savingsRow!.children![0].accountId).toBe("fd-1");
  });

  it("still counts the nested FD's value exactly once in totalAssets/netWorth", async () => {
    seed();
    const col = await getBalanceSheetColumn("u1", "2026-05-20", "Today", true, null);
    // 100000 (savings) + 50000 (FD, nested) = 150000.
    expect(col.totalAssets).toBe(150000);
    expect(col.netWorth).toBe(150000);
  });

  it("falls back to a top-level row when the FD's source account isn't a savings row in this column", async () => {
    seed();
    // Point the FD at an account that doesn't exist as a savings row this month.
    mockSqlite.prepare("UPDATE investment_products SET source_account_id = 'missing-account' WHERE id = 'prod-1';").run();

    const col = await getBalanceSheetColumn("u1", "2026-05-20", "Today", true, null);
    const savingsRow = col.assets.find((r) => r.group === "savings");
    expect(savingsRow!.children ?? []).toHaveLength(0);
    const fdRow = col.assets.find((r) => r.group === "investment");
    expect(fdRow).toBeDefined();
    expect(fdRow!.amount).toBe(50000);
    expect(col.totalAssets).toBe(150000); // still counted, just not nested
  });

  it("drops a matured FD once its payout is in savings - the money is counted once", async () => {
    seed();
    // FD matured: its account is closed and the payout (principal + interest) landed in savings.
    mockSqlite.exec(`
      UPDATE financial_accounts SET closed_at = '2026-05-10' WHERE id = 'fd-1';
      UPDATE investment_products SET status = 'matured' WHERE id = 'prod-1';
      INSERT INTO expenses (id, account_id, amount, nature, status, date, description)
      VALUES ('payout', 'savings-1', 53000, 'credit', 'approved', '2026-05-10', 'HDFC FD maturity');
    `);
    const col = await getBalanceSheetColumn("u1", "2026-05-20", "Today", true, null);
    const savingsRow = col.assets.find((r) => r.group === "savings")!;
    expect(savingsRow.children ?? []).toHaveLength(0);
    expect(col.assets.find((r) => r.group === "investment")).toBeUndefined();
    expect(savingsRow.amount).toBe(153000);
    expect(col.totalAssets).toBe(153000);
  });

  it("drops an FD marked matured even if its account was left open", async () => {
    seed();
    mockSqlite.exec("UPDATE investment_products SET status = 'matured' WHERE id = 'prod-1';");
    const col = await getBalanceSheetColumn("u1", "2026-05-20", "Today", true, null);
    expect(col.assets.find((r) => r.group === "savings")!.children ?? []).toHaveLength(0);
    expect(col.totalAssets).toBe(100000);
  });
});
