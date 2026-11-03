import { DatabaseSync } from "node:sqlite";

/**
 * Money in and out adds up to My Month, month by month, and the review after a sync separates what the
 * market did from money moved in. Real schema, made-up numbers.
 */

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
jest.mock("../../services/broker-sync", () => ({ getConnectedBrokers: async () => [] }));
jest.mock("../../services/kite-connect", () => ({ getLinkedAccountId: () => null }));

import { runMigrations } from "../../database/migrations";
import { getCashFlow, monthsBetween } from "../../services/cash-flow";
import { addOrUpdateFundSnapshot, addOrUpdateSnapshot } from "../../services/financial-account";
import { buildSyncReview, readAccountMove, saveManualValue, type AccountMove } from "../../services/investment-sync-review";
import { getMyMonth } from "../../services/my-month";
import { getMyMonthGroups, getMyMonthRangeGroups } from "../../services/my-month-rows";

const USER = "default-user";
let seq = 0;

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

function tx(values: Record<string, unknown>) {
  insert("expenses", { id: `e${++seq}`, user_id: USER, date: "2026-03-10", status: "approved", nature: "realized", source: "manual", currency: "INR", ...values });
}

beforeEach(async () => {
  mockKv.clear();
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  insert("users", { id: USER });
  insert("financial_accounts", { id: "bank", user_id: USER, account_type: "savings", bank_name: "Bank", account_identifier: "1111" });
  insert("financial_accounts", { id: "d1", user_id: USER, account_type: "demat", bank_name: "Broker", account_identifier: "2222" });
});
afterEach(() => mockDb.close());

describe("monthsBetween", () => {
  it("crosses a year, and is empty the wrong way round", () => {
    expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthsBetween("2026-02", "2026-02")).toEqual(["2026-02"]);
    expect(monthsBetween("2026-03", "2026-02")).toEqual([]);
  });
});

describe("getCashFlow", () => {
  it("each month matches My Month, and came in minus went out is what's left", async () => {
    tx({ nature: "credit", amount: 50000, date: "2026-02-05", credit_kind: "salary" });
    tx({ amount: 20000, date: "2026-02-10" });
    tx({ nature: "credit", amount: 60000, date: "2026-03-05", credit_kind: "salary" });
    tx({ amount: 70000, date: "2026-03-10" });

    const flow = await getCashFlow(USER, "2026-02", "2026-03", "2026-03");
    for (const m of flow.months) {
      const d = await getMyMonth(USER, m.month);
      expect(m.left).toBeCloseTo(d.leftOver, 2);
    }
    expect(flow.cameIn).toBe(110000);
    expect(flow.wentOut).toBe(90000);
    expect(flow.left).toBe(20000);
    expect(flow.months.map((m) => m.left)).toEqual([30000, -10000]);
    expect(flow.income + flow.otherIn + flow.repaid).toBeCloseTo(flow.cameIn, 2);
    expect(flow.invested + flow.spent + flow.forOthers).toBeCloseTo(flow.wentOut, 2);
  });

  it("stops at this month when the period runs past it", async () => {
    const flow = await getCashFlow(USER, "2026-02", "2026-12", "2026-03");
    expect(flow.months.map((m) => m.month)).toEqual(["2026-02", "2026-03"]);
  });

  it("the rows across a period add up to the figure that opens them", async () => {
    tx({ amount: 20000, date: "2026-02-10" });
    tx({ amount: 5000, date: "2026-03-10" });
    const flow = await getCashFlow(USER, "2026-02", "2026-03", "2026-03");
    const [spent] = await getMyMonthRangeGroups(USER, "2026-02", "2026-03", "spent");
    expect(spent.total).toBeCloseTo(flow.spent, 2);
    expect(spent.rows).toHaveLength(2);
    expect((await getMyMonthGroups(USER, "2026-03", "spent"))[0].rows).toHaveLength(1);
  });
});

describe("readAccountMove", () => {
  const TODAY = "2026-03-10";

  it("compares with the last value before today, holdings and idle cash together", async () => {
    await addOrUpdateSnapshot("d1", "2026-03-06", 100000);
    await addOrUpdateFundSnapshot("d1", "2026-03-06", 5000);
    await addOrUpdateSnapshot("d1", TODAY, 110000);
    expect(await readAccountMove("d1", TODAY)).toEqual({ current: 115000, previous: 105000, previousDate: "2026-03-06", added: 0, updatedToday: true });
  });

  it("a first value has nothing to compare with", async () => {
    await addOrUpdateSnapshot("d1", TODAY, 110000);
    expect(await readAccountMove("d1", TODAY)).toMatchObject({ previous: null, previousDate: null, current: 110000 });
  });

  it("counts money moved in since the last value, not before it, and not deleted transfers", async () => {
    await addOrUpdateSnapshot("d1", "2026-03-06", 100000);
    const transfer = (id: string, from: string, to: string, amount: number, date: string, deleted_at: string | null = null) =>
      insert("account_transfers", { id, user_id: USER, from_account_id: from, to_account_id: to, amount, date, deleted_at });
    transfer("t1", "bank", "d1", 20000, "2026-03-08");
    transfer("t2", "d1", "bank", 3000, "2026-03-09");
    transfer("t3", "bank", "d1", 999, "2026-03-05");
    transfer("t4", "bank", "d1", 999, "2026-03-09", "2026-03-09");
    expect((await readAccountMove("d1", TODAY)).added).toBe(17000);
  });
});

describe("saveManualValue", () => {
  const TODAY = "2026-03-10";

  it("a typed total keeps idle cash as it was", async () => {
    await addOrUpdateFundSnapshot("d1", "2026-03-06", 5000);
    await saveManualValue("d1", 50000, TODAY);
    expect((await readAccountMove("d1", TODAY)).current).toBe(50000);
    expect(mockDb.prepare(`SELECT portfolio_value AS v, source FROM demat_portfolio_snapshots`).get()).toMatchObject({ v: 45000, source: "manual" });
  });

  it("a total below idle cash still reads back as typed", async () => {
    await addOrUpdateFundSnapshot("d1", "2026-03-06", 5000);
    await saveManualValue("d1", 2000, TODAY);
    expect((await readAccountMove("d1", TODAY)).current).toBe(2000);
  });
});

describe("buildSyncReview", () => {
  const move = (current: number, previous: number | null, added = 0, previousDate: string | null = "2026-03-09"): AccountMove => ({
    current,
    previous,
    previousDate: previous == null ? null : previousDate,
    added,
    updatedToday: true,
  });
  const entry = (id: string, m: AccountMove, updated = true, failed = false) => ({ account: { id, name: id, broker: null }, move: m, updated, failed });

  it("adds up the moves, largest first, up and down cancelling", () => {
    const r = buildSyncReview([entry("a", move(10100, 10000)), entry("b", move(19000, 20000))]);
    expect(r.change).toBe(-900);
    expect(r.changePct).toBeCloseTo(-3, 6);
    expect(r.lines.map((l) => l.id)).toEqual(["b", "a"]);
    expect(r.since).toBe("2026-03-09");
    expect(r.compared).toBe(2);
    expect(r.total).toBe(29100);
  });

  it("money moved in isn't a gain", () => {
    const r = buildSyncReview([entry("a", move(30500, 10000, 20000))]);
    expect(r.change).toBe(500);
    expect(r.added).toBe(20000);
    expect(r.lines[0].change).toBe(500);
  });

  it("skipped, failed and first values are left out of the change, but counted in the total", () => {
    const r = buildSyncReview([
      entry("moved", move(1100, 1000)),
      entry("skipped", move(5000, 5000), false),
      entry("failed", move(7000, 7000), false, true),
      entry("first", move(900, null)),
    ]);
    expect(r.change).toBe(100);
    expect(r.compared).toBe(1);
    expect(r.total).toBe(14000);
    expect(r.lines.map((l) => l.status)).toEqual(["moved", "first", "skipped", "failed"]);
  });

  it("gives no shared date when accounts were last updated on different days", () => {
    const r = buildSyncReview([entry("a", move(110, 100, 0, "2026-03-09")), entry("b", move(220, 200, 0, "2026-03-02"))]);
    expect(r.since).toBeNull();
  });

  it("a previous value of zero has no percentage", () => {
    const r = buildSyncReview([entry("a", move(500, 0))]);
    expect(r.lines[0].changePct).toBeNull();
    expect(r.changePct).toBeNull();
    expect(r.change).toBe(500);
  });
});
