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

import {
  finaliseFDMaturityForExpenses,
  matchMaturityPayout,
  materialiseMaturedInvestments,
} from "../../services/investment-accounts";

function seed(
  eventDate: string,
  principal: number,
  interest: number,
  override: number | null = null,
  source: string | null = "savings-fa",
) {
  mockNextId = 0;
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    CREATE TABLE financial_accounts (
      id TEXT PRIMARY KEY, user_id TEXT, is_active INTEGER DEFAULT 1, bank_name TEXT,
      closed_at TEXT, closed_note TEXT, updated_at TEXT, account_type TEXT
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
    INSERT INTO financial_accounts (id, user_id, bank_name, account_type) VALUES ('fd-fa', 'u1', 'HDFC', 'investment');
    INSERT INTO financial_accounts (id, user_id, bank_name, account_type) VALUES ('savings-fa', 'u1', 'HDFC', 'savings');
  `);
  mockSqlite
    .prepare(`INSERT INTO investment_products VALUES ('prod-1', 'fd-fa', ?, 'active', NULL, ?, NULL);`)
    .run(source, override);
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

// ─── FDs close when the payout is actually credited (bank SMS, single or split) ───

const credit = (id: string, amount: number, date: string, status = "approved") =>
  mockSqlite
    .prepare(
      `INSERT INTO expenses (id, user_id, amount, account_id, date, nature, source, status)
       VALUES (?, 'u1', ?, 'savings-fa', ?, 'credit', 'sms_auto', ?);`,
    )
    .run(id, amount, date, status);
const expense = (id: string) =>
  mockSqlite.prepare("SELECT status, deleted_at FROM expenses WHERE id = ?").get(id) as {
    status: string;
    deleted_at: string | null;
  };

describe("matured FDs close once the payout is credited", () => {
  it("bank SMS arriving AFTER Arth queued its own credit: closes the FD, withdraws the duplicate", async () => {
    seed("2020-01-01", 100000, 7000);
    await materialiseMaturedInvestments("u1"); // queues Arth's placeholder
    const placeholder = scheduleRow().linked_expense_id!;
    credit("sms-credit", 107000, "2020-01-02"); // the real credit, approved
    await finaliseFDMaturityForExpenses(["sms-credit"]);

    expect(fdClosedAt()).not.toBeNull();
    expect(productStatus()).toBe("matured");
    expect(scheduleRow()).toMatchObject({ status: "materialised", linked_expense_id: "sms-credit" });
    expect(expense(placeholder)).toMatchObject({ status: "rejected" });
    expect(expense(placeholder).deleted_at).not.toBeNull();
  });

  it("late bank SMS still pending: swaps it in for the placeholder, closes once it's approved", async () => {
    seed("2020-01-01", 100000, 7000);
    await materialiseMaturedInvestments("u1");
    credit("sms-credit", 107000, "2020-01-02", "pending_review");
    await materialiseMaturedInvestments("u1"); // next app open
    expect(scheduleRow()).toMatchObject({ status: "scheduled", linked_expense_id: "sms-credit" });
    expect(fdClosedAt()).toBeNull();

    mockSqlite.exec("UPDATE expenses SET status = 'approved' WHERE id = 'sms-credit'");
    await finaliseFDMaturityForExpenses(["sms-credit"]);
    expect(fdClosedAt()).not.toBeNull();
  });

  it("principal and interest credited separately: closes the FD, queues nothing", async () => {
    seed("2020-01-01", 100000, 7000);
    credit("principal", 100000, "2020-01-01");
    credit("interest", 7000, "2020-01-01");
    await materialiseMaturedInvestments("u1");
    expect(fdClosedAt()).not.toBeNull();
    expect(count("expenses")).toBe(2);
  });

  it("interest paid net of TDS (10%): still closes", async () => {
    seed("2020-01-01", 100000, 7000);
    credit("principal", 100000, "2020-01-01");
    credit("interest-net", 6300, "2020-01-02");
    await materialiseMaturedInvestments("u1");
    expect(fdClosedAt()).not.toBeNull();
  });

  it("single maturity credit net of TDS: closes", async () => {
    seed("2020-01-01", 100000, 7000);
    credit("maturity-net", 106300, "2020-01-01");
    await materialiseMaturedInvestments("u1");
    expect(fdClosedAt()).not.toBeNull();
  });

  it("waits while one half of a split payout is still pending", async () => {
    seed("2020-01-01", 100000, 7000);
    credit("principal", 100000, "2020-01-01");
    credit("interest", 7000, "2020-01-01", "pending_review");
    await materialiseMaturedInvestments("u1");
    expect(fdClosedAt()).toBeNull();
    mockSqlite.exec("UPDATE expenses SET status = 'approved' WHERE id = 'interest'");
    await finaliseFDMaturityForExpenses(["interest"]);
    expect(fdClosedAt()).not.toBeNull();
  });

  it("only the principal arrived: stays open and queues the payout for review", async () => {
    seed("2020-01-01", 100000, 7000);
    credit("principal", 100000, "2020-01-01");
    await materialiseMaturedInvestments("u1");
    expect(fdClosedAt()).toBeNull();
  });

  it("FD with no source account: finds the payout on a savings account", async () => {
    seed("2020-01-01", 100000, 7000, null, null);
    credit("sms-credit", 107000, "2020-01-03");
    await materialiseMaturedInvestments("u1");
    expect(fdClosedAt()).not.toBeNull();
  });

  it("ignores a matching amount far from the maturity date", async () => {
    seed("2020-01-01", 100000, 7000);
    credit("unrelated", 107000, "2020-03-01");
    await materialiseMaturedInvestments("u1");
    expect(fdClosedAt()).toBeNull();
  });

  it("closes the account of an FD already marked matured but left open", async () => {
    seed("2020-01-01", 100000, 7000);
    mockSqlite.exec("UPDATE investment_products SET status = 'matured'");
    mockSqlite.exec("UPDATE investment_schedule_entries SET status = 'materialised'");
    await materialiseMaturedInvestments("u1");
    expect(fdClosedAt()).not.toBeNull();
  });
});

describe("matchMaturityPayout", () => {
  const c = (id: string, amount: number) => ({ id, amount, date: "2020-01-01", status: "approved" });
  const exp = { principal: 100000, interest: 7000, maturity: 107000 };

  it("prefers a single full credit over a split", () => {
    expect(matchMaturityPayout([c("p", 100000), c("i", 7000), c("full", 107000)], exp)?.map((x) => x.id)).toEqual(["full"]);
  });

  it("doesn't pair the principal with an unrelated small credit", () => {
    expect(matchMaturityPayout([c("p", 100000), c("tiny", 500)], exp)).toBeNull();
  });
});

