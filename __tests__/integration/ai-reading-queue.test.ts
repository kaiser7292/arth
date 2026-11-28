import { DatabaseSync } from "node:sqlite";

/** The on-device AI queue (services/ai/reading-queue.ts) on the real schema, with the model faked. */
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
  withTransactionAsync: async (fn: () => Promise<void>) => fn(),
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
jest.mock("../../services/ai/ai-reading", () => ({ isAiReadingOn: () => true }));
jest.mock("../../services/ai/nano", () => ({
  getNanoStatus: jest.fn(async () => "available"),
  NanoUnavailableError: class extends Error {},
}));
jest.mock("../../services/ai/tasks/read-sms", () => ({ readSmsWithNano: jest.fn() }));
jest.mock("../../services/ai/money-map", () => ({ loadMoneyMap: jest.fn(async () => ({ accounts: [], byRef: new Map() })) }));
jest.mock("../../services/ai/add-ai-read", () => ({ addAiReadToCatchUp: jest.fn() }));
jest.mock("../../services/sms/sms-scan-logging", () => ({ saveScanRun: jest.fn(async () => "run-1"), markScanDetailAdded: jest.fn() }));
jest.mock("../../services/transfer-detect", () => ({ settleTransfersAfterScan: jest.fn(async () => 0) }));

import { runMigrations } from "../../database/migrations";
import { seedDefaultUser } from "../../database/seed";
import { addAiReadToCatchUp } from "../../services/ai/add-ai-read";
import { getNanoStatus } from "../../services/ai/nano";
import { readSmsWithNano } from "../../services/ai/tasks/read-sms";
import { saveScanRun } from "../../services/sms/sms-scan-logging";
import {
  __resetAiQueue,
  aiFieldsOf,
  countOlderUnread,
  countQueued,
  queueOlderUnread,
  runAiQueue,
} from "../../services/ai/reading-queue";

import { AppState } from "react-native";

const read = readSmsWithNano as jest.Mock;
// Arth on screen: the queue only reads while it is.
Object.defineProperty(AppState, "currentState", { get: () => "active", configurable: true });
const add = addAiReadToCatchUp as jest.Mock;

let U = "";
/** An unrecognised message, as the scan saves it. */
function unread(id: string, smsDate: number, aiStatus: string | null = "queued") {
  mockDb
    .prepare(
      `INSERT INTO pending_sms (id, user_id, sms_id, address, body, sms_date, status, error_message, ai_status)
       VALUES (?, ?, ?, 'AX-TESTBK', ?, ?, 'failed', 'unrecognised', ?)`,
    )
    .run(id, U, `sms-${id}`, `Rs 100 debited from A/c XX1234 (${id})`, smsDate, aiStatus);
}
const status = (id: string) => (mockDb.prepare(`SELECT ai_status FROM pending_sms WHERE id = ?`).get(id) as { ai_status: string | null }).ai_status;

const reading = {
  type: "debit",
  amount: 100,
  last4: "1234",
  merchant: "TEST STORE",
  balance: null,
  event: "spend",
  from: null,
  to: null,
  channel: null,
  auto: null,
  ref: null,
  scheme: null,
  time: null,
  fx: null,
};

beforeEach(async () => {
  __resetAiQueue();
  mockDb = new DatabaseSync(":memory:");
  mockStore.clear();
  await runMigrations(mockAdapter as never);
  U = await seedDefaultUser(mockAdapter as never);
  read.mockReset();
  add.mockReset();
  (saveScanRun as jest.Mock).mockClear();
  (getNanoStatus as jest.Mock).mockResolvedValue("available");
});

it("adds what the AI reads, marks it Read by AI, and records every outcome", async () => {
  unread("m1", 3000);
  unread("m2", 2000);
  unread("m3", 1000);
  read
    .mockResolvedValueOnce({ outcome: { kind: "transaction", result: reading, warnings: [] }, raw: "{}", ms: 5 })
    .mockResolvedValueOnce({ outcome: { kind: "not_transaction" }, raw: "{}", ms: 5 })
    .mockResolvedValueOnce({ outcome: { kind: "rejected", problems: ["Amount isn't in the SMS"] }, raw: "{}", ms: 5 });
  // What processParseResults does for a new transaction: the expense, and the message linked to it.
  add.mockImplementation(async (pendingSmsId: string) => {
    mockDb
      .prepare(
        `INSERT INTO expenses (id, user_id, amount, currency, date, nature, status, source) VALUES ('e1', ?, 100, 'INR', '2026-11-01', 'realized', 'pending_review', 'sms_auto')`,
      )
      .run(U);
    mockDb.prepare(`UPDATE pending_sms SET status = 'processed', expense_id = 'e1' WHERE id = ?`).run(pendingSmsId);
    return { expenseId: "e1", error: null };
  });

  const state = await runAiQueue({ label: "Test" });

  expect(state).toMatchObject({ running: false, total: 3, done: 3, added: 1, notMoney: 1, leftOut: 1, errors: 0 });
  expect([status("m1"), status("m2"), status("m3")]).toEqual(["added", "not_txn", "rejected"]);
  const e = mockDb.prepare(`SELECT parse_source, ai_fields FROM expenses WHERE id = 'e1'`).get() as { parse_source: string; ai_fields: string };
  expect(e.parse_source).toBe("ai");
  expect(JSON.parse(e.ai_fields)).toEqual(["amount", "merchant", "account", "event"]);
  expect(saveScanRun).toHaveBeenCalledWith(expect.objectContaining({ source: "ai", label: "Test", expenseCreatedCount: 1 }));
  expect(await countQueued()).toBe(0);
});

it("gives up after three failures in a row and keeps every message for later", async () => {
  for (let i = 1; i <= 5; i++) unread(`m${i}`, 10000 - i);
  read.mockRejectedValue(new Error("No answer in 8 s"));

  const state = await runAiQueue();

  expect(read).toHaveBeenCalledTimes(3);
  expect(state.gaveUp).toBe(true);
  // Nothing was given up on: those three get another try, the rest weren't read yet.
  expect(await countQueued()).toBe(5);
  expect(mockDb.prepare(`SELECT COUNT(*) AS n FROM pending_sms WHERE ai_status = 'error'`).get()).toEqual({ n: 0 });
});

it("a single failure between answers is recorded against that message", async () => {
  unread("a", 3000);
  unread("b", 2000);
  read
    .mockRejectedValueOnce(new Error("No answer in 8 s"))
    .mockResolvedValueOnce({ outcome: { kind: "not_transaction" }, raw: "{}", ms: 5 });

  await runAiQueue();

  // One more try later, after the fresh ones.
  expect([status("a"), status("b")]).toEqual(["retry", "not_txn"]);
});

it("a message that fails twice is given up on, and second tries wait behind fresh messages", async () => {
  unread("tried", 9000, "retry");
  unread("fresh", 1000);
  read
    .mockResolvedValueOnce({ outcome: { kind: "not_transaction" }, raw: "{}", ms: 5 })
    .mockRejectedValueOnce(new Error("No answer in 8 s"));

  await runAiQueue();

  // The fresh one was read first, though it's older.
  expect(read.mock.calls[0][0]).toContain("(fresh)");
  expect([status("fresh"), status("tried")]).toEqual(["not_txn", "error"]);
  expect(await countQueued()).toBe(0);
});

it("three failures in a row don't block the queue for good", async () => {
  for (let i = 1; i <= 4; i++) unread(`m${i}`, 10000 - i);
  read.mockRejectedValue(new Error("No answer in 8 s"));
  await runAiQueue();
  expect([status("m1"), status("m2"), status("m3"), status("m4")]).toEqual(["retry", "retry", "retry", "queued"]);
  // Next run starts with the one not tried yet.
  read.mockReset();
  read.mockResolvedValue({ outcome: { kind: "not_transaction" }, raw: "{}", ms: 5 });
  await runAiQueue();
  expect(read.mock.calls[0][0]).toContain("(m4)");
});

it("a message on an ignored account leaves the couldn't-read list", async () => {
  unread("m1", 1000);
  read.mockResolvedValue({ outcome: { kind: "ignored", account: {} }, raw: "", ms: 0 });
  await runAiQueue();
  const row = mockDb.prepare(`SELECT status, ai_status FROM pending_sms WHERE id = 'm1'`).get();
  expect(row).toEqual({ status: "ignored", ai_status: "ignored" });
});

it("leaves a message a template read while the model was answering", async () => {
  unread("m1", 1000);
  read.mockImplementation(async () => {
    mockDb
      .prepare(
        `INSERT INTO expenses (id, user_id, amount, currency, date, nature, status, source) VALUES ('t1', ?, 100, 'INR', '2026-11-01', 'realized', 'pending_review', 'sms_auto')`,
      )
      .run(U);
    mockDb.prepare(`UPDATE pending_sms SET status = 'processed', expense_id = 't1' WHERE id = 'm1'`).run();
    return { outcome: { kind: "transaction", result: reading, warnings: [] }, raw: "{}", ms: 5 };
  });
  await runAiQueue();
  expect(add).not.toHaveBeenCalled();
});

it("does nothing on a phone without the model, and leaves the queue as it was", async () => {
  unread("m1", 1000);
  (getNanoStatus as jest.Mock).mockResolvedValue("unavailable");

  const state = await runAiQueue();

  expect(state.unavailable).toBe("unavailable");
  expect(read).not.toHaveBeenCalled();
  expect(status("m1")).toBe("queued");
});

it("skips messages a template has read since they were queued", async () => {
  unread("m1", 1000);
  mockDb
    .prepare(
      `INSERT INTO expenses (id, user_id, amount, currency, date, nature, status, source) VALUES ('x', ?, 100, 'INR', '2026-11-01', 'realized', 'pending_review', 'sms_auto')`,
    )
    .run(U);
  mockDb.prepare(`UPDATE pending_sms SET status = 'processed', expense_id = 'x' WHERE id = 'm1'`).run();
  expect(await countQueued()).toBe(0);
  await runAiQueue();
  expect(read).not.toHaveBeenCalled();
});

it("a second caller joins the run already going", async () => {
  unread("m1", 1000);
  read.mockResolvedValue({ outcome: { kind: "not_transaction" }, raw: "{}", ms: 5 });
  const [a, b] = [runAiQueue(), runAiQueue()];
  expect(a).toBe(b);
  await a;
  expect(read).toHaveBeenCalledTimes(1);
});

it("older unread messages can be queued from a date", async () => {
  unread("old", 1000, null);
  unread("older", 10, null);
  expect(await countOlderUnread(500)).toBe(1);
  expect(await queueOlderUnread(500)).toBe(1);
  expect(status("old")).toBe("queued");
  expect(status("older")).toBeNull();
});

it("aiFieldsOf lists only what the AI filled", () => {
  expect(aiFieldsOf({ ...reading, merchant: null, last4: null, event: null } as never)).toEqual(["amount"]);
});
