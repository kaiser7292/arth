import { DatabaseSync } from "node:sqlite";

/** First-run scan summary + background hand-off, on the real schema. */
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

import { runMigrations } from "../../database/migrations";
import { seedDefaultUser } from "../../database/seed";
import {
  buildFirstScanSummary,
  getPendingFirstScanSince,
  lookbackStartDate,
  runFirstScan,
} from "../../services/first-scan";

let U = "";
function add(id: string, nature: string, amount: number, date: string, extra: Record<string, unknown> = {}) {
  const cols = { id, user_id: U, amount, date, nature, status: "approved", source: "sms_auto", currency: "INR", ...extra };
  const keys = Object.keys(cols);
  mockDb
    .prepare(`INSERT INTO expenses (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
    .run(...(Object.values(cols) as never[]));
}

beforeEach(async () => {
  mockDb = new DatabaseSync(":memory:");
  mockStore.clear();
  await runMigrations(mockAdapter as never);
  U = await seedDefaultUser(mockAdapter as never);
});

it("lookbackStartDate goes back whole months", () => {
  expect(lookbackStartDate(3, new Date(2026, 9, 3))).toBe("2026-07-03");
  expect(lookbackStartDate(1, new Date(2026, 0, 15))).toBe("2025-12-15");
});

it("summary counts money in/out without transfers, FDs or SIPs", async () => {
  add("salary", "credit", 90000, "2026-09-01");
  add("swiggy1", "realized", 500, "2026-09-02", { merchant_name: "SWIGGY" });
  add("swiggy2", "realized", 700, "2026-09-03", { merchant_name: "SWIGGY" });
  add("amazon", "realized", 1000, "2026-09-04", { merchant_name: "AMAZON" });
  add("fd", "realized", 20000, "2026-09-05", { money_event: "fd_open", status: "pending_review" });
  add("xfer", "realized", 30000, "2026-09-06", { reclassified_as_transfer: 1 });
  add("old", "realized", 999, "2026-01-01", { merchant_name: "OLD" });

  const s = await buildFirstScanSummary(U, "2026-07-03");
  expect(s.moneyIn).toBe(90000);
  expect(s.moneyOut).toBe(2200);
  expect(s.topMerchant).toEqual({ name: "SWIGGY", amount: 1200 });
  expect(s.fdsAndTransfers).toBe(2);
  expect(s.toReview).toBe(1);
});

it("a scan that outlives the wait finishes in the background and queues the Home summary", async () => {
  let finish: () => void = () => {};
  const scan = () => new Promise<void>((r) => (finish = r));
  expect(await runFirstScan("2026-07-03", scan, 10)).toBe("background");
  expect(getPendingFirstScanSince()).toBeNull();
  finish();
  await new Promise((r) => setTimeout(r, 0));
  expect(getPendingFirstScanSince()).toBe("2026-07-03");
});

it("a quick scan is done in the foreground", async () => {
  expect(await runFirstScan("2026-07-03", async () => {}, 1000)).toBe("done");
  expect(getPendingFirstScanSince()).toBeNull();
});
