import { DatabaseSync } from "node:sqlite";

/**
 * materialiseMaturedInvestments / finaliseFDMaturityForExpenses against a REAL
 * SQLite engine (not a mock that only records SQL strings). The things that
 * can actually be wrong here are idempotency, the duplicate-credit merge, and
 * the status transitions on approval, which a mock can't verify.
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

import { finaliseFDMaturityForExpenses, materialiseMaturedInvestments } from "../../services/investment-accounts";

function seed(eventDate: string, principal: number, interest: number, override: number | null = null) {
  mockNextId = 0;
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    CREATE TABLE financial_accounts (
      id TEXT PRIMARY KEY, user_id TEXT, is_active INTEGER DEFAULT 1, bank_name TEXT,
      closed_at TEXT, closed_note TEXT, updated_at TEXT
    );
    CREATE TABLE investment_products (
      id TEXT PRIMARY KEY, financial_account_id TEXT, source_account_id TEXT, status TEXT,
      updated_at TEXT, maturity_amount_override REAL, investment_bucket_id TEXT
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
      account_id TEXT, date TEXT, nature TEXT, source TEXT, status TEXT, created_at TEXT,
      deleted_at TEXT
    );
  `);
  mockSqlite.exec(`
    INSERT INTO financial_accounts (id, user_id, bank_name) VALUES ('fd-fa', 'u1', 'HDFC');
    INSERT INTO financial_accounts (id, user_id, bank_name) VALUES ('savings-fa', 'u1', 'HDFC');
  `);
  mockSqlite
    .prepare(`INSERT INTO investment_products VALUES ('prod-1', 'fd-fa', 'savings-fa', 'active', NULL, ?, NULL);`)
    .run(override);
  mockSqlite
    .prepare(
      `INSERT INTO investment_schedule_entries
       (id, product_id, event_num, event_date, kind, principal_component, interest_component, status)
       VALUES ('se-1', 'prod-1', 1, ?, 'maturity', ?, ?, 'scheduled');`,
    )
    .run(eventDate, principal, interest);
}

const scheduleRow = () =>
  mockSqlite.prepare("SELECT status, linked_expense_id FROM investment_schedule_entries WHERE id='se-1'").get() as {
    status: string;
    linked_expense_id: string | null;
  };
const productStatus = () =>
  (mockSqlite.prepare("SELECT status FROM investment_products WHERE id='prod-1'").get() as { status: string }).status;
const fdClosedAt = () =>
  (mockSqlite.prepare("SELECT closed_at FROM financial_accounts WHERE id='fd-fa'").get() as { closed_at: string | null }).closed_at;
const count = (table: string) => (mockSqlite.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;

describe("materialiseMaturedInvestments", () => {
  it("does nothing for a schedule entry that isn't due yet", async () => {
    seed("2099-01-01", 100000, 7000);
    expect(await materialiseMaturedInvestments("u1")).toBe(0);
    expect(scheduleRow()).toMatchObject({ status: "scheduled", linked_expense_id: null });
  });

  it("queues ONE pending_review credit for the full maturity amount and moves no money", async () => {
    seed("2020-01-01", 100000, 7000);
    expect(await materialiseMaturedInvestments("u1")).toBe(1);

    expect(count("account_transfers")).toBe(0);
    const expenses = mockSqlite.prepare("SELECT * FROM expenses").all() as {
      id: string; amount: number; nature: string; status: string; account_id: string;
    }[];
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ amount: 107000, nature: "credit", status: "pending_review", account_id: "savings-fa" });

    // Not finalised until the credit is approved.
    expect(scheduleRow()).toMatchObject({ status: "scheduled", linked_expense_id: expenses[0].id });
    expect(productStatus()).toBe("active");
    expect(fdClosedAt()).toBeNull();
  });

  it("uses the corrected maturity amount when one is set", async () => {
    seed("2020-01-01", 100000, 7000, 106500);
    await materialiseMaturedInvestments("u1");
    expect((mockSqlite.prepare("SELECT amount FROM expenses").get() as { amount: number }).amount).toBe(106500);
  });

  it("is idempotent — running it twice does not queue a second credit", async () => {
    seed("2020-01-01", 100000, 7000);
    await materialiseMaturedInvestments("u1");
    expect(await materialiseMaturedInvestments("u1")).toBe(0);
    expect(count("expenses")).toBe(1);
  });

  it("links the bank's already-scanned SMS credit instead of creating a duplicate", async () => {
    seed("2020-01-01", 100000, 7000);
    mockSqlite.exec(`
      INSERT INTO expenses (id, user_id, amount, account_id, date, nature, source, status)
      VALUES ('sms-credit', 'u1', 106950, 'savings-fa', '2020-01-02', 'credit', 'sms_auto', 'pending_review');
    `);
    await materialiseMaturedInvestments("u1");
    expect(count("expenses")).toBe(1);
    expect(scheduleRow()).toMatchObject({ status: "scheduled", linked_expense_id: "sms-credit" });
  });

  it("finalises immediately when the matching SMS credit was already approved", async () => {
    seed("2020-01-01", 100000, 7000);
    mockSqlite.exec(`
      INSERT INTO expenses (id, user_id, amount, account_id, date, nature, source, status)
      VALUES ('sms-credit', 'u1', 107000, 'savings-fa', '2020-01-01', 'credit', 'sms_auto', 'approved');
    `);
    await materialiseMaturedInvestments("u1");
    expect(scheduleRow().status).toBe("materialised");
    expect(productStatus()).toBe("matured");
    expect(fdClosedAt()).not.toBeNull();
  });
});

describe("finaliseFDMaturityForExpenses", () => {
  it("does nothing while the maturity credit is still pending", async () => {
    seed("2020-01-01", 100000, 7000);
    await materialiseMaturedInvestments("u1");
    const { linked_expense_id } = scheduleRow();
    await finaliseFDMaturityForExpenses([linked_expense_id!]);
    expect(scheduleRow().status).toBe("scheduled");
    expect(fdClosedAt()).toBeNull();
  });

  it("marks the FD matured and closes its account once the credit is approved", async () => {
    seed("2020-01-01", 100000, 7000);
    await materialiseMaturedInvestments("u1");
    const { linked_expense_id } = scheduleRow();
    mockSqlite.prepare("UPDATE expenses SET status = 'approved' WHERE id = ?").run(linked_expense_id!);

    await finaliseFDMaturityForExpenses([linked_expense_id!]);
    expect(scheduleRow().status).toBe("materialised");
    expect(productStatus()).toBe("matured");
    expect(fdClosedAt()).not.toBeNull();
  });

  it("ignores ordinary credits not linked to any FD", async () => {
    seed("2020-01-01", 100000, 7000);
    await finaliseFDMaturityForExpenses(["unrelated"]);
    expect(scheduleRow().status).toBe("scheduled");
  });
});
