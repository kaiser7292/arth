import { DatabaseSync } from "node:sqlite";

/**
 * EPFO total-balance replies, end to end on the real schema, parser and SMS-to-expense path: the
 * pension account is created if there isn't one, and brought to each newer total with one
 * adjustment; an older reply read later changes nothing. Member details are made up.
 */
let mockDb: DatabaseSync;
const flat = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params);
const mockAdapter = {
  execAsync: async (sql: string) => {
    mockDb.exec(sql);
  },
  runAsync: async (sql: string, ...params: unknown[]) => {
    const r = mockDb.prepare(sql).run(...(flat(params) as never[]));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).all(...(flat(params) as never[])),
  getFirstAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).get(...(flat(params) as never[])) ?? null,
  withTransactionAsync: async (fn: () => Promise<void>) => {
    mockDb.exec("BEGIN");
    try {
      await fn();
      mockDb.exec("COMMIT");
    } catch (e) {
      mockDb.exec("ROLLBACK");
      throw e;
    }
  },
};

const mockStore = new Map<string, string | number | boolean>();
jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: (k: string) => mockStore.get(k) as boolean | undefined,
    getNumber: (k: string) => mockStore.get(k) as number | undefined,
    getString: (k: string) => mockStore.get(k) as string | undefined,
    set: (k: string, v: string | number | boolean) => mockStore.set(k, v),
    delete: (k: string) => mockStore.delete(k),
    getAllKeys: () => [...mockStore.keys()],
    contains: (k: string) => mockStore.has(k),
  })),
}));

import { runMigrations } from "../../database/migrations";
import { seedDefaultUser } from "../../database/seed";
import { computeUnseededBalance } from "../../services/account-balance";
import { parseSmsBatch } from "../../services/sms/sms-parser";
import { createExpenseFromSms } from "../../services/sms/sms-to-expense";
import { todayIso } from "../../utils/date";

let U = "";
let seq = 0;
const DAY = 86400000;

const epfo = (total: string) =>
  `Dear Member,Your UAN:XXXXXXXX4321,NAME:TEST MEMBER,DOB:01-JAN-1990,AADHAAR:12**34567,PAN:AB***9Z,Bank Details:Available, TOTAL BALANCE:${total}. Team EPFO`;

async function receive(body: string, date: number): Promise<void> {
  seq++;
  const res = await parseSmsBatch(U, [{ _id: `sms-${seq}`, address: "AD-EPFOHO", body, date } as never]);
  const item = res.items[0];
  if (!item) throw new Error(`Not parsed: ${body}`);
  await createExpenseFromSms(U, item.pendingSmsId, item.parsed, item.rawBody, item.smsDate);
}

const pensionAccounts = () =>
  mockDb.prepare("SELECT * FROM financial_accounts WHERE bank_name = 'EPFO'").all() as { id: string; account_type: string; account_identifier: string }[];
const balance = async (id: string) => (await computeUnseededBalance(id, todayIso().slice(0, 7))).closing;
const adjustments = () => mockDb.prepare("SELECT amount FROM expenses WHERE nature = 'ledger_adjustment' AND deleted_at IS NULL").all() as { amount: number }[];

beforeEach(async () => {
  mockDb = new DatabaseSync(":memory:");
  mockStore.clear();
  seq = 0;
  await runMigrations(mockAdapter as never);
  U = await seedDefaultUser(mockAdapter as never);
});

describe("EPFO total balance", () => {
  it("creates the pension account when there isn't one, and enters the total", async () => {
    await receive(epfo("250000"), Date.now() - DAY);
    const accounts = pensionAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ account_type: "investment", account_identifier: "4321" });
    const product = mockDb.prepare("SELECT instrument, valuation FROM investment_products WHERE financial_account_id = ?").get(accounts[0].id);
    expect(product).toEqual({ instrument: "epf", valuation: "contribution" });
    expect(await balance(accounts[0].id)).toBe(250000);
  });

  it("adds or takes away the difference on each newer total", async () => {
    await receive(epfo("250000"), Date.now() - 2 * DAY);
    await receive(epfo("262000"), Date.now() - DAY);
    const [pf] = pensionAccounts();
    expect(await balance(pf.id)).toBe(262000);
    await receive(epfo("255000"), Date.now());
    expect(await balance(pf.id)).toBe(255000);
  });

  it("ignores an older total read later", async () => {
    await receive(epfo("262000"), Date.now() - DAY);
    const before = adjustments().length;
    await receive(epfo("240000"), Date.now() - 20 * DAY);
    const [pf] = pensionAccounts();
    expect(await balance(pf.id)).toBe(262000);
    expect(adjustments()).toHaveLength(before);
  });

  it("keeps nothing personal from the message on the account", async () => {
    await receive(epfo("250000"), Date.now());
    expect(JSON.stringify(pensionAccounts())).not.toMatch(/TEST MEMBER|1990|AB\*\*\*9Z|34567/);
  });
});
