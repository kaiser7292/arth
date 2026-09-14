import { DatabaseSync } from "node:sqlite";

/**
 * createFDAccountShell / completeFDDetails against a REAL SQLite engine.
 * The thing that matters here: "Mark as Fixed Deposit" (app/expense/[id].tsx)
 * needs to create an FD account with NO deposit transfer of its own (the
 * SMS-detected expense becomes that transfer via reclassifyExpenseAsTransfer
 * instead), and with rate/maturity optional — a debit alert rarely carries
 * them. completeFDDetails must then fill them in exactly once and generate
 * the schedule only at that point, never twice.
 */
let mockSqlite: DatabaseSync;
let mockNextId = 0;

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
jest.mock("../../utils/uuid", () => ({ generateUUID: () => `gen-${++mockNextId}` }));

import { createFDAccountShell, completeFDDetails, isFDIncomplete, type InvestmentProduct } from "../../services/investment-accounts";

function seed() {
  mockNextId = 0;
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    CREATE TABLE financial_accounts (
      id TEXT PRIMARY KEY, user_id TEXT, account_identifier TEXT, bank_name TEXT,
      account_type TEXT, account_label TEXT, discovered_from_sms INTEGER,
      last_known_balance REAL, last_balance_date TEXT, fund_balance REAL, account_number TEXT,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE investment_products (
      id TEXT PRIMARY KEY, financial_account_id TEXT, instrument TEXT, valuation TEXT,
      principal REAL, interest_rate_pa REAL, interest_method TEXT, compounding_freq TEXT,
      start_date TEXT, maturity_date TEXT, payout_mode TEXT, source_account_id TEXT,
      auto_credit_on_maturity INTEGER, status TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE investment_schedule_entries (
      id TEXT PRIMARY KEY, product_id TEXT, event_num INTEGER, event_date TEXT, kind TEXT,
      principal_component REAL, interest_component REAL, status TEXT,
      linked_expense_id TEXT, linked_transfer_id TEXT
    );
    CREATE TABLE account_transfers (
      id TEXT PRIMARY KEY, user_id TEXT, from_account_id TEXT, to_account_id TEXT,
      amount REAL, description TEXT, date TEXT, linked_forecast_id TEXT, linked_expense_id TEXT,
      source TEXT, raw_source_text TEXT, source_sms_address TEXT, created_at TEXT
    );
  `);
  mockSqlite.exec(`INSERT INTO financial_accounts (id, user_id, account_identifier, bank_name, account_type) VALUES ('savings-fa', 'u1', '1234', 'HDFC', 'savings');`);
}

describe("createFDAccountShell", () => {
  it("creates the account and product with no deposit transfer, when rate/maturity are omitted", async () => {
    seed();
    const fdAccountId = await createFDAccountShell({
      user_id: "u1",
      bank_name: "HDFC",
      account_identifier: "FD001",
      principal: 100000,
      start_date: "2026-01-01",
      source_account_id: "savings-fa",
    });

    const transfers = mockSqlite.prepare("SELECT * FROM account_transfers").all();
    expect(transfers).toHaveLength(0);

    const product = mockSqlite
      .prepare("SELECT * FROM investment_products WHERE financial_account_id = ?")
      .get(fdAccountId) as unknown as InvestmentProduct;
    expect(product).toMatchObject({ instrument: "fd", valuation: "contract", status: "active", principal: 100000 });
    expect(product.interest_rate_pa).toBeNull();
    expect(product.maturity_date).toBeNull();
    expect(isFDIncomplete(product)).toBe(true);

    const schedule = mockSqlite.prepare("SELECT * FROM investment_schedule_entries WHERE product_id = ?").all(product.id);
    expect(schedule).toHaveLength(0);
  });

  it("generates the schedule immediately when both rate and maturity are provided", async () => {
    seed();
    const fdAccountId = await createFDAccountShell({
      user_id: "u1",
      bank_name: "HDFC",
      account_identifier: "FD002",
      principal: 50000,
      start_date: "2026-01-01",
      source_account_id: "savings-fa",
      interest_rate_pa: 7,
      interest_method: "simple",
      maturity_date: "2027-01-01",
    });

    const product = mockSqlite
      .prepare("SELECT * FROM investment_products WHERE financial_account_id = ?")
      .get(fdAccountId) as unknown as InvestmentProduct;
    expect(isFDIncomplete(product)).toBe(false);

    const schedule = mockSqlite.prepare("SELECT * FROM investment_schedule_entries WHERE product_id = ?").all(product.id);
    expect(schedule).toHaveLength(1);
  });

  it("rejects a rate without a maturity date, and vice versa", async () => {
    seed();
    await expect(
      createFDAccountShell({
        user_id: "u1", bank_name: "HDFC", account_identifier: "FD003", principal: 10000,
        start_date: "2026-01-01", source_account_id: "savings-fa", interest_rate_pa: 6,
      }),
    ).rejects.toThrow(/both/i);

    await expect(
      createFDAccountShell({
        user_id: "u1", bank_name: "HDFC", account_identifier: "FD004", principal: 10000,
        start_date: "2026-01-01", source_account_id: "savings-fa", maturity_date: "2027-01-01",
      }),
    ).rejects.toThrow(/both/i);
  });
});

describe("completeFDDetails", () => {
  it("fills in rate/maturity and generates the schedule exactly once", async () => {
    seed();
    const fdAccountId = await createFDAccountShell({
      user_id: "u1",
      bank_name: "HDFC",
      account_identifier: "FD005",
      principal: 75000,
      start_date: "2026-01-01",
      source_account_id: "savings-fa",
    });

    await completeFDDetails(fdAccountId, {
      interest_rate_pa: 7.5,
      interest_method: "compound",
      compounding_freq: "quarterly",
      maturity_date: "2027-01-01",
    });

    const product = mockSqlite
      .prepare("SELECT * FROM investment_products WHERE financial_account_id = ?")
      .get(fdAccountId) as unknown as InvestmentProduct;
    expect(isFDIncomplete(product)).toBe(false);
    expect(product.interest_rate_pa).toBe(7.5);

    const schedule = mockSqlite.prepare("SELECT * FROM investment_schedule_entries WHERE product_id = ?").all(product.id);
    expect(schedule).toHaveLength(1);

    await expect(
      completeFDDetails(fdAccountId, {
        interest_rate_pa: 8,
        interest_method: "simple",
        maturity_date: "2028-01-01",
      }),
    ).rejects.toThrow(/already been generated/);
  });

  it("rejects completing an account that isn't a fixed deposit", async () => {
    seed();
    await expect(
      completeFDDetails("savings-fa", {
        interest_rate_pa: 7,
        interest_method: "simple",
        maturity_date: "2027-01-01",
      }),
    ).rejects.toThrow(/not a fixed deposit/i);
  });
});
