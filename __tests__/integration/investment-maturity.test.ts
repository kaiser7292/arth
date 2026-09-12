import { DatabaseSync } from "node:sqlite";

/**
 * materialiseMaturedInvestments against a REAL SQLite engine (not a mock that
 * only records SQL strings) — same approach as simulator-unlink.test.ts and
 * this session's other DB-adjacent tests. The thing that can actually be
 * wrong here is idempotency (running the pass twice must not double-create
 * the transfer/expense pair) and the status transitions, which a mock can't
 * verify.
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

import { materialiseMaturedInvestments } from "../../services/investment-accounts";

function seed(eventDate: string, principal: number, interest: number) {
  mockNextId = 0;
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    CREATE TABLE financial_accounts (
      id TEXT PRIMARY KEY, user_id TEXT, is_active INTEGER DEFAULT 1, bank_name TEXT
    );
    CREATE TABLE investment_products (
      id TEXT PRIMARY KEY, financial_account_id TEXT, source_account_id TEXT, status TEXT,
      updated_at TEXT
    );
    CREATE TABLE investment_schedule_entries (
      id TEXT PRIMARY KEY, product_id TEXT, event_num INTEGER, event_date TEXT, kind TEXT,
      principal_component REAL, interest_component REAL, status TEXT DEFAULT 'scheduled',
      linked_expense_id TEXT, linked_transfer_id TEXT
    );
    CREATE TABLE account_transfers (
      id TEXT PRIMARY KEY, user_id TEXT, from_account_id TEXT, to_account_id TEXT,
      amount REAL, description TEXT, date TEXT, linked_forecast_id TEXT, linked_expense_id TEXT,
      source TEXT, raw_source_text TEXT, source_sms_address TEXT, created_at TEXT
    );
    CREATE TABLE expenses (
      id TEXT PRIMARY KEY, user_id TEXT, amount REAL, currency TEXT, description TEXT,
      account_id TEXT, date TEXT, nature TEXT, source TEXT, status TEXT, created_at TEXT
    );
  `);
  mockSqlite.exec(`
    INSERT INTO financial_accounts VALUES ('fd-fa', 'u1', 1, 'HDFC');
    INSERT INTO financial_accounts VALUES ('savings-fa', 'u1', 1, 'HDFC');
    INSERT INTO investment_products VALUES ('prod-1', 'fd-fa', 'savings-fa', 'active', NULL);
  `);
  mockSqlite
    .prepare(
      `INSERT INTO investment_schedule_entries
       (id, product_id, event_num, event_date, kind, principal_component, interest_component, status)
       VALUES ('se-1', 'prod-1', 1, ?, 'maturity', ?, ?, 'scheduled');`,
    )
    .run(eventDate, principal, interest);
}

describe("materialiseMaturedInvestments", () => {
  it("does nothing for a schedule entry that isn't due yet", async () => {
    seed("2099-01-01", 100000, 7000);
    const count = await materialiseMaturedInvestments("u1");
    expect(count).toBe(0);
    const row = mockSqlite.prepare("SELECT status FROM investment_schedule_entries WHERE id='se-1'").get() as { status: string };
    expect(row.status).toBe("scheduled");
  });

  it("creates a transfer for principal and a pending_review credit for interest, and flips the product to matured", async () => {
    seed("2020-01-01", 100000, 7000);
    const count = await materialiseMaturedInvestments("u1");
    expect(count).toBe(1);

    const schedRow = mockSqlite
      .prepare("SELECT status, linked_expense_id, linked_transfer_id FROM investment_schedule_entries WHERE id='se-1'")
      .get() as { status: string; linked_expense_id: string; linked_transfer_id: string };
    expect(schedRow.status).toBe("materialised");
    expect(schedRow.linked_expense_id).toBeTruthy();
    expect(schedRow.linked_transfer_id).toBeTruthy();

    const transfers = mockSqlite.prepare("SELECT * FROM account_transfers").all() as {
      from_account_id: string; to_account_id: string; amount: number;
    }[];
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ from_account_id: "fd-fa", to_account_id: "savings-fa", amount: 100000 });

    const expenses = mockSqlite.prepare("SELECT * FROM expenses").all() as {
      amount: number; nature: string; status: string; account_id: string;
    }[];
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ amount: 7000, nature: "credit", status: "pending_review", account_id: "savings-fa" });

    const product = mockSqlite.prepare("SELECT status FROM investment_products WHERE id='prod-1'").get() as { status: string };
    expect(product.status).toBe("matured");
  });

  it("is idempotent — running it twice does not create a second transfer/expense pair", async () => {
    seed("2020-01-01", 100000, 7000);
    await materialiseMaturedInvestments("u1");
    const secondRunCount = await materialiseMaturedInvestments("u1");
    expect(secondRunCount).toBe(0);
    expect((mockSqlite.prepare("SELECT COUNT(*) as c FROM account_transfers").get() as { c: number }).c).toBe(1);
    expect((mockSqlite.prepare("SELECT COUNT(*) as c FROM expenses").get() as { c: number }).c).toBe(1);
  });

  it("skips the interest leg when interest is zero (e.g. a zero-rate placeholder) but still moves principal", async () => {
    seed("2020-01-01", 100000, 0);
    const count = await materialiseMaturedInvestments("u1");
    expect(count).toBe(1);
    expect((mockSqlite.prepare("SELECT COUNT(*) as c FROM account_transfers").get() as { c: number }).c).toBe(1);
    expect((mockSqlite.prepare("SELECT COUNT(*) as c FROM expenses").get() as { c: number }).c).toBe(0);
  });
});
