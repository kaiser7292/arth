import { DatabaseSync } from "node:sqlite";

/**
 * createFDAccount against a REAL SQLite engine. The thing that matters here:
 * the deposit must land as a real account_transfers row, not just the
 * last_known_balance scalar createManualAccount sets — otherwise the FD
 * account has no ledger entry establishing its balance, and the standard
 * balance-chain (which account-ledger.tsx and the balance sheet both use)
 * would compute it as unseeded-from-zero and go negative once the maturity
 * transfer moves principal back out. See services/investment-accounts.ts's
 * comment on this for the full reasoning.
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

import { createFDAccount } from "../../services/investment-accounts";

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

describe("createFDAccount", () => {
  it("records the deposit as a real transfer from the source account, not just a scalar", async () => {
    seed();
    const fdAccountId = await createFDAccount({
      user_id: "u1",
      bank_name: "HDFC",
      account_identifier: "FD001",
      principal: 100000,
      interest_rate_pa: 7,
      interest_method: "simple",
      start_date: "2026-01-01",
      maturity_date: "2027-01-01",
      source_account_id: "savings-fa",
    });

    const transfers = mockSqlite.prepare("SELECT * FROM account_transfers").all() as {
      from_account_id: string; to_account_id: string; amount: number; date: string;
    }[];
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ from_account_id: "savings-fa", to_account_id: fdAccountId, amount: 100000, date: "2026-01-01" });
  });

  it("creates the investment_products row and a single scheduled maturity entry", async () => {
    seed();
    const fdAccountId = await createFDAccount({
      user_id: "u1",
      bank_name: "HDFC",
      account_identifier: "FD002",
      principal: 50000,
      interest_rate_pa: 6.5,
      interest_method: "compound",
      compounding_freq: "quarterly",
      start_date: "2026-01-01",
      maturity_date: "2027-01-01",
      source_account_id: "savings-fa",
    });

    const product = mockSqlite
      .prepare("SELECT * FROM investment_products WHERE financial_account_id = ?")
      .get(fdAccountId) as { instrument: string; valuation: string; status: string; principal: number };
    expect(product).toMatchObject({ instrument: "fd", valuation: "contract", status: "active", principal: 50000 });

    const schedule = mockSqlite.prepare("SELECT * FROM investment_schedule_entries WHERE product_id = ?").all(product && (mockSqlite.prepare("SELECT id FROM investment_products WHERE financial_account_id = ?").get(fdAccountId) as { id: string }).id) as {
      kind: string; status: string; event_date: string;
    }[];
    expect(schedule).toHaveLength(1);
    expect(schedule[0]).toMatchObject({ kind: "maturity", status: "scheduled", event_date: "2027-01-01" });
  });

  it("rejects a maturity date that isn't after the start date", async () => {
    seed();
    await expect(
      createFDAccount({
        user_id: "u1",
        bank_name: "HDFC",
        account_identifier: "FD003",
        principal: 10000,
        interest_rate_pa: 6,
        interest_method: "simple",
        start_date: "2026-01-01",
        maturity_date: "2026-01-01",
        source_account_id: "savings-fa",
      }),
    ).rejects.toThrow(/after the start date/);
  });

  it("rejects compound interest with no compounding frequency", async () => {
    seed();
    await expect(
      createFDAccount({
        user_id: "u1",
        bank_name: "HDFC",
        account_identifier: "FD004",
        principal: 10000,
        interest_rate_pa: 6,
        interest_method: "compound",
        start_date: "2026-01-01",
        maturity_date: "2027-01-01",
        source_account_id: "savings-fa",
      }),
    ).rejects.toThrow(/[Cc]ompounding/);
  });
});
