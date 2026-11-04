import { DatabaseSync } from "node:sqlite";

/** The start date against the real schema (every migration), with made-up numbers. */

let mockDb: DatabaseSync;
const mockAdapter = {
  execAsync: async (sql: string) => { mockDb.exec(sql); },
  runAsync: async (sql: string, ...params: unknown[]) => {
    const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
    const r = mockDb.prepare(sql).run(...(flat as never[]));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) => {
    const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
    return mockDb.prepare(sql).all(...(flat as never[]));
  },
  getFirstAsync: async (sql: string, ...params: unknown[]) => {
    const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
    return mockDb.prepare(sql).get(...(flat as never[])) ?? null;
  },
  withTransactionAsync: async (fn: () => Promise<void>) => {
    mockDb.exec("BEGIN");
    try { await fn(); mockDb.exec("COMMIT"); } catch (e) { mockDb.exec("ROLLBACK"); throw e; }
  },
};

const mockKv = new Map<string, unknown>();
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: (k: string) => mockKv.get(k) as boolean | undefined,
    getNumber: (k: string) => mockKv.get(k) as number | undefined,
    getString: (k: string) => mockKv.get(k) as string | undefined,
    set: (k: string, v: unknown) => void mockKv.set(k, v),
    delete: (k: string) => void mockKv.delete(k),
    contains: (k: string) => mockKv.has(k),
    getAllKeys: () => [...mockKv.keys()],
  })),
}));
jest.mock("../../database", () => ({
  getDatabase: () => mockAdapter,
  initDatabase: async () => mockAdapter,
}));

import { runMigrations } from "../../database/migrations";
import { getMonthBalanceSummary } from "../../services/account-balance";
import { getDeletedCredits, restoreAllCredits } from "../../services/account-credit";
import { getDeletedExpenses, purgeOldDeletedExpenses, restoreAllDeletedExpenses } from "../../services/expense-crud";
import { getExpenseTotal } from "../../services/expense-queries";
import { hisaabExcludeDeletedLinkSql } from "../../services/hisaab";
import { backlogSinceMs } from "../../services/sms/backlog-days";
import { createExpenseFromSms } from "../../services/sms/sms-to-expense";
import {
  applyStartDate,
  clearStartDate,
  countIgnoredBefore,
  getStartBalanceAccounts,
  isBeforeStartDate,
  saveStartBalance,
  setStartDate,
} from "../../services/start-date";
import type { ParsedSMS } from "../../services/sms/bank-patterns";

const USER = "default_user";
const START = "2026-08-01";

function insert(table: string, values: Record<string, unknown>) {
  const cols = mockDb.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[];
  const row: Record<string, unknown> = { ...values };
  for (const c of cols) {
    if (c.notnull && c.dflt_value == null && !c.pk && !(c.name in row)) row[c.name] = c.type.toUpperCase().includes("INT") || c.type.toUpperCase() === "REAL" ? 0 : "x";
  }
  const keys = Object.keys(row);
  mockDb.exec("PRAGMA foreign_keys = OFF");
  mockDb.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...(keys.map((k) => row[k]) as never[]));
  mockDb.exec("PRAGMA foreign_keys = ON");
}

const account = (id: string, account_type: string) =>
  insert("financial_accounts", { id, user_id: USER, account_type, bank_name: "Sample Bank", account_identifier: id, is_active: 1 });

const tx = (id: string, date: string, values: Record<string, unknown> = {}) =>
  insert("expenses", { id, user_id: USER, date, amount: 100, status: "approved", nature: "realized", source: "manual", currency: "INR", ...values });

const transfer = (id: string, date: string, from = "bank", to = "wallet") =>
  insert("account_transfers", { id, user_id: USER, from_account_id: from, to_account_id: to, amount: 50, date, source: "manual" });

const hidden = (table: string, id: string) =>
  (mockDb.prepare(`SELECT deleted_at FROM ${table} WHERE id = ?`).get(id) as { deleted_at: string | null }).deleted_at != null;

beforeEach(async () => {
  mockKv.clear();
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  account("bank", "savings");
  account("wallet", "wallet");
  account("card", "credit_card");
  account("demat", "demat");
  account("pension", "pension");
});

describe("ignoring transactions before a date", () => {
  it("hides older expenses, credits and transfers, and nothing from the date on", async () => {
    tx("old", "2026-07-31");
    tx("oldIn", "2026-07-10", { nature: "credit", account_id: "bank" });
    tx("same", START);
    transfer("oldT", "2026-07-15");
    transfer("newT", START);
    await setStartDate(USER, START);
    expect(["old", "oldIn"].map((id) => hidden("expenses", id))).toEqual([true, true]);
    expect(hidden("expenses", "same")).toBe(false);
    expect(hidden("account_transfers", "oldT")).toBe(true);
    expect(hidden("account_transfers", "newT")).toBe(false);
    expect(await getExpenseTotal(USER, "2026-01-01", "2026-12-31")).toBe(100);
  });

  it("says how many it will ignore, and the same again once it has", async () => {
    tx("old", "2026-07-31");
    tx("gone", "2026-07-31", { status: "rejected" });
    transfer("oldT", "2026-07-15");
    expect(await countIgnoredBefore(USER, START)).toBe(2);
    await setStartDate(USER, START);
    expect(await countIgnoredBefore(USER, START)).toBe(2);
  });

  it("brings everything back when cleared, and the right rows when moved", async () => {
    tx("june", "2026-06-15");
    tx("july", "2026-07-15");
    transfer("julyT", "2026-07-15");
    await setStartDate(USER, START);
    await setStartDate(USER, "2026-07-01");
    expect(hidden("expenses", "june")).toBe(true);
    expect(hidden("expenses", "july")).toBe(false);
    expect(hidden("account_transfers", "julyT")).toBe(false);
    await clearStartDate(USER);
    expect(hidden("expenses", "june")).toBe(false);
    expect(isBeforeStartDate("2020-01-01")).toBe(false);
  });

  it("leaves alone a row the user deleted, even after clearing", async () => {
    tx("binned", "2026-07-15", { deleted_at: "2026-10-01T00:00:00.000Z" });
    await setStartDate(USER, START);
    await clearStartDate(USER);
    expect(hidden("expenses", "binned")).toBe(true);
  });

  it("keeps out of the recycle bin, and survives emptying and restoring it", async () => {
    tx("old", "2026-07-15");
    tx("oldIn", "2026-07-15", { nature: "credit" });
    tx("binned", "2026-09-15", { deleted_at: "2026-10-01T00:00:00.000Z" });
    await setStartDate(USER, START);
    expect((await getDeletedExpenses(USER)).map((e) => e.id)).toEqual(["binned"]);
    expect(await getDeletedCredits(USER)).toEqual([]);
    await restoreAllDeletedExpenses(USER);
    await restoreAllCredits(USER);
    expect(hidden("expenses", "old")).toBe(true);
    expect(hidden("expenses", "oldIn")).toBe(true);
    await purgeOldDeletedExpenses(USER, 30);
    await purgeOldDeletedExpenses(USER, 0);
    const left = mockDb.prepare("SELECT COUNT(*) AS n FROM expenses WHERE id IN ('old', 'oldIn')").get() as { n: number };
    expect(left.n).toBe(2);
  });

  it("leaves loans, investments and pension alone", async () => {
    tx("emi", "2026-07-15");
    insert("expense_loan_links", { id: "l1", expense_id: "emi", loan_account_id: "x", link_kind: "emi" });
    tx("sip", "2026-07-15");
    insert("expense_investment_links", { id: "l2", expense_id: "sip", investment_bucket_id: "x" });
    tx("epf", "2026-07-15", { nature: "credit", account_id: "pension" });
    transfer("toDemat", "2026-07-15", "bank", "demat");
    await setStartDate(USER, START);
    expect(["emi", "sip", "epf"].map((id) => hidden("expenses", id))).toEqual([false, false, false]);
    expect(hidden("account_transfers", "toDemat")).toBe(false);
  });

  it("keeps a Hisaab entry when its expense is before the date, but not when it was deleted", async () => {
    insert("hisaab_persons", { id: "p", owner_user_id: USER, name: "Sample Person" });
    tx("shared", "2026-07-15");
    tx("binned", "2026-09-15", { deleted_at: "2026-10-01T00:00:00.000Z" });
    insert("hisaab_entries", { id: "h1", hisaab_person_id: "p", linked_expense_id: "shared", amount: 40, date: "2026-07-15", type: "debit" });
    insert("hisaab_entries", { id: "h2", hisaab_person_id: "p", linked_expense_id: "binned", amount: 40, date: "2026-09-15", type: "debit" });
    await setStartDate(USER, START);
    const rows = mockDb.prepare(`SELECT id FROM hisaab_entries e WHERE ${hisaabExcludeDeletedLinkSql("e")}`).all() as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(["h1"]);
  });

  it("starts a bank balance from what the user says it was on the day", async () => {
    tx("old", "2026-07-15", { account_id: "bank", amount: 9000 });
    tx("after", "2026-08-10", { account_id: "bank", amount: 200 });
    await setStartDate(USER, START);
    await saveStartBalance("bank", START, 5000);
    const summary = await getMonthBalanceSummary("bank", "2026-08");
    expect(summary?.opening_balance).toBe(5000);
    expect(summary?.closing_balance).toBe(4800);
  });

  it("asks for bank and wallet balances only", async () => {
    const accounts = await getStartBalanceAccounts(USER);
    expect(accounts.map((a) => a.id).sort()).toEqual(["bank", "wallet"]);
  });

  it("picks up older rows on the next run, such as ones added after the date was set", async () => {
    await setStartDate(USER, START);
    tx("late", "2026-07-15");
    await applyStartDate(USER);
    expect(hidden("expenses", "late")).toBe(true);
  });

  it("drops an older message, and lets a later scan read it again", async () => {
    await setStartDate(USER, START);
    insert("pending_sms", { id: "s1", user_id: USER, sms_id: "m1", address: "SAMPLE", body: "x", sms_date: 1, status: "pending" });
    const parsed = { amount: 100, type: "debit", date: "2026-07-15", bank: "Sample Bank" } as unknown as ParsedSMS;
    const r = await createExpenseFromSms(USER, "s1", parsed, "x");
    expect(r.expenseId).toBeNull();
    expect(mockDb.prepare("SELECT id FROM pending_sms WHERE id = 's1'").get()).toBeUndefined();
    expect((mockDb.prepare("SELECT COUNT(*) AS n FROM expenses").get() as { n: number }).n).toBe(0);
  });

  it("doesn't list unread messages from before the date", async () => {
    await setStartDate(USER, "2099-01-01");
    expect(backlogSinceMs()).toBe(new Date(2099, 0, 1).getTime());
    await clearStartDate(USER);
    expect(backlogSinceMs(30)).toBeLessThan(Date.now());
  });
});
