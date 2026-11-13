import { DatabaseSync } from "node:sqlite";

/**
 * Update balances against the REAL schema: typing the real balance (or what a card owes) adds one
 * adjustment so Arth's figure becomes exactly that; the Home balance check shows after 3 quiet days
 * until closed. Made-up values.
 */

let mockDb: DatabaseSync;
const mockFlat = (params: unknown[]) =>
  (params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params) as never[];
const mockAdapter = {
  execAsync: async (sql: string) => {
    mockDb.exec(sql);
  },
  runAsync: async (sql: string, ...params: unknown[]) => {
    const r = mockDb.prepare(sql).run(...mockFlat(params));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).all(...mockFlat(params)),
  getFirstAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).get(...mockFlat(params)) ?? null,
  withTransactionAsync: async (fn: () => Promise<void>) => fn(),
};

const mockStore = new Map<string, string>();
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: () => undefined,
    getNumber: () => undefined,
    getString: (k: string) => mockStore.get(k),
    set: (k: string, v: unknown) => mockStore.set(k, String(v)),
    delete: (k: string) => mockStore.delete(k),
    getAllKeys: () => [...mockStore.keys()],
    contains: (k: string) => mockStore.has(k),
    addOnValueChangedListener: () => ({ remove: () => {} }),
  })),
}));
jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));

import { runMigrations } from "../../database/migrations";
import { dismissBalanceNudge, getBalanceLines, getBalanceNudge, saveBalanceUpdates } from "../../services/balance-update";
import { todayIso } from "../../utils/date";

const USER = "default-user";

function insert(table: string, values: Record<string, unknown>) {
  const cols = mockDb.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number; dflt_value: unknown }[];
  const row: Record<string, unknown> = { ...values };
  for (const c of cols) {
    if (c.name in row || !c.notnull || c.dflt_value != null) continue;
    row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : `x-${table}-${c.name}`;
  }
  const names = Object.keys(row);
  mockDb.prepare(`INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...(Object.values(row) as never[]));
}

const daysAgo = (n: number) => {
  const d = new Date(`${todayIso()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const spend = (id: string, account: string, amount: number, date: string, nature = "realized") =>
  insert("expenses", { id, user_id: USER, amount, date, nature, status: "approved", source: "manual", account_id: account });

const line = async (id: string) => (await getBalanceLines(USER)).find((l) => l.accountIds.includes(id))!;

beforeAll(async () => {
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  mockDb.exec("PRAGMA foreign_keys = OFF; PRAGMA ignore_check_constraints = ON;");
});
beforeEach(() => {
  mockStore.clear();
  mockDb.exec("DELETE FROM expenses; DELETE FROM financial_accounts; DELETE FROM account_month_balances; DELETE FROM account_transfers;");
  insert("financial_accounts", { id: "sav", user_id: USER, bank_name: "HDFC", account_type: "savings", account_identifier: "4521", is_active: 1 });
  insert("financial_accounts", { id: "card", user_id: USER, bank_name: "ICICI", account_type: "credit_card", account_identifier: "7788", is_active: 1, credit_limit: 100000 });
  insert("financial_accounts", { id: "card2", user_id: USER, bank_name: "SBI", account_type: "credit_card", account_identifier: "1122", is_active: 1 });
  insert("account_month_balances", { id: "m1", account_id: "sav", month: todayIso().slice(0, 7), opening_balance: 10000, is_manual_override: 1 });
});

describe("update balances", () => {
  it("makes a bank balance exactly what the user typed, with one adjustment and their note", async () => {
    spend("e1", "sav", 1500, daysAgo(0));
    expect((await line("sav")).current).toBe(8500);
    const n = await saveBalanceUpdates(USER, [{ line: await line("sav"), value: 8100, note: "ATM cash" }]);
    expect(n).toBe(1);
    expect((await line("sav")).current).toBe(8100);
    const adj = mockDb.prepare("SELECT amount, description FROM expenses WHERE nature = 'ledger_adjustment'").get() as { amount: number; description: string };
    expect(adj.amount).toBe(400);
    expect(adj.description).toContain("ATM cash");
  });

  it("sets what a card owes, with or without a limit", async () => {
    spend("c1", "card", 3000, daysAgo(0));
    spend("c2", "card2", 500, daysAgo(0));
    await saveBalanceUpdates(USER, [
      { line: await line("card"), value: 4200 },
      { line: await line("card2"), value: 900 },
    ]);
    expect((await line("card")).current).toBe(4200);
    expect((await line("card2")).current).toBe(900);
  });

  it("leaves a figure that already matches alone", async () => {
    expect(await saveBalanceUpdates(USER, [{ line: await line("sav"), value: 10000.4 }])).toBe(0);
    expect(mockDb.prepare("SELECT COUNT(*) AS n FROM expenses").get()).toEqual({ n: 0 });
  });
});

describe("the Home balance check", () => {
  it("shows after 3 quiet days, and not before", async () => {
    spend("e1", "sav", 100, daysAgo(2));
    expect(await getBalanceNudge(USER)).toBeNull();
    mockDb.exec("DELETE FROM expenses;");
    spend("e2", "sav", 100, daysAgo(4));
    expect(await getBalanceNudge(USER)).toEqual({ quietDays: 4 });
  });

  it("stays closed for this quiet spell, and comes back after the next one", async () => {
    spend("e1", "sav", 100, daysAgo(5));
    await dismissBalanceNudge(USER);
    expect(await getBalanceNudge(USER)).toBeNull();
    spend("e2", "sav", 100, daysAgo(3));
    expect(await getBalanceNudge(USER)).toEqual({ quietDays: 3 });
  });
});
