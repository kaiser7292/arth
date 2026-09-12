import { DatabaseSync } from "node:sqlite";

/**
 * convertLegacyAccountToInvestment / migrateLegacyDematPensionAccounts against
 * a REAL SQLite engine. The thing that matters here: a demat account's
 * fund_balance and account_number must survive the flip — the bug this
 * function was written to avoid (services/financial-account.ts's
 * updateAccountType clears those fields for any type other than 'demat',
 * which would silently destroy real idle-cash data on this exact conversion).
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
  withTransactionAsync: async (cb: () => Promise<void>) => cb(),
};

jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));
jest.mock("../../services/settings", () => ({ bumpDataVersion: jest.fn() }));
jest.mock("../../utils/uuid", () => ({ generateUUID: () => `gen-${++mockNextId}` }));

import { convertLegacyAccountToInvestment, migrateLegacyDematPensionAccounts } from "../../services/investment-accounts";

function seed() {
  mockNextId = 0;
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    CREATE TABLE financial_accounts (
      id TEXT PRIMARY KEY, user_id TEXT, account_type TEXT, fund_balance REAL,
      account_number TEXT, is_active INTEGER DEFAULT 1, updated_at TEXT
    );
    CREATE TABLE investment_products (
      id TEXT PRIMARY KEY, financial_account_id TEXT UNIQUE, instrument TEXT, valuation TEXT,
      status TEXT, created_at TEXT, updated_at TEXT
    );
  `);
  mockSqlite.exec(`
    INSERT INTO financial_accounts (id, user_id, account_type, fund_balance, account_number) VALUES
      ('demat-1', 'u1', 'demat', 15000, '1234567890'),
      ('pension-1', 'u1', 'pension', NULL, NULL),
      ('savings-1', 'u1', 'savings', NULL, NULL);
  `);
}

describe("convertLegacyAccountToInvestment", () => {
  it("flips account_type to investment and preserves fund_balance/account_number for a demat account", async () => {
    seed();
    await convertLegacyAccountToInvestment("demat-1", "equity", "market");

    const account = mockSqlite.prepare("SELECT account_type, fund_balance, account_number FROM financial_accounts WHERE id='demat-1'").get() as {
      account_type: string; fund_balance: number; account_number: string;
    };
    expect(account.account_type).toBe("investment");
    expect(account.fund_balance).toBe(15000);
    expect(account.account_number).toBe("1234567890");

    const product = mockSqlite.prepare("SELECT instrument, valuation, status FROM investment_products WHERE financial_account_id='demat-1'").get() as {
      instrument: string; valuation: string; status: string;
    };
    expect(product).toEqual({ instrument: "equity", valuation: "market", status: "active" });
  });

  it("converts a pension account to instrument='epf', valuation='contribution'", async () => {
    seed();
    await convertLegacyAccountToInvestment("pension-1", "epf", "contribution");
    const product = mockSqlite.prepare("SELECT instrument, valuation FROM investment_products WHERE financial_account_id='pension-1'").get() as {
      instrument: string; valuation: string;
    };
    expect(product).toEqual({ instrument: "epf", valuation: "contribution" });
  });

  it("is idempotent — running it twice does not create a second product row or error", async () => {
    seed();
    await convertLegacyAccountToInvestment("demat-1", "equity", "market");
    await convertLegacyAccountToInvestment("demat-1", "equity", "market");
    const count = (mockSqlite.prepare("SELECT COUNT(*) as c FROM investment_products WHERE financial_account_id='demat-1'").get() as { c: number }).c;
    expect(count).toBe(1);
  });
});

describe("migrateLegacyDematPensionAccounts", () => {
  it("converts every demat/pension account for the user and leaves other types alone", async () => {
    seed();
    const count = await migrateLegacyDematPensionAccounts("u1");
    expect(count).toBe(2);

    const types = mockSqlite.prepare("SELECT id, account_type FROM financial_accounts ORDER BY id").all() as {
      id: string; account_type: string;
    }[];
    expect(types).toEqual([
      { id: "demat-1", account_type: "investment" },
      { id: "pension-1", account_type: "investment" },
      { id: "savings-1", account_type: "savings" },
    ]);
  });

  it("is idempotent across repeated calls (e.g. every app open)", async () => {
    seed();
    await migrateLegacyDematPensionAccounts("u1");
    const second = await migrateLegacyDematPensionAccounts("u1");
    expect(second).toBe(0);
  });
});
