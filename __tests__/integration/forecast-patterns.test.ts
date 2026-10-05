import { DatabaseSync } from "node:sqlite";

/**
 * Month-end projection + learned bill patterns on the real schema, shaped like the 2026-10 bug
 * report: big transfers between own accounts every month (which the old baseline counted as
 * spending), a steady Netflix bill, an old auto pattern with a runaway count, a confirmed bill
 * that stopped, and a few days of October spending.
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
import { getActiveClassifications } from "../../services/analytics/classifier";
import { forecastMonthEndRealistic, getHistoricalVariableAvg } from "../../services/analytics/forecast-engine-v2";
import { getPatternsToConfirm, rebuildPatterns } from "../../services/analytics/pattern-learner";
import { getSpendingRows } from "../../services/analytics/spending-rows";

let U = "";
let seq = 0;
function spend(date: string, amount: number, merchant: string, extra: Record<string, unknown> = {}) {
  const cols = {
    id: `e${++seq}`, user_id: U, amount, date, nature: "realized", status: "approved", source: "manual",
    currency: "INR", merchant_name: merchant, ...extra,
  };
  const keys = Object.keys(cols);
  mockDb.prepare(`INSERT INTO expenses (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...(Object.values(cols) as never[]));
}
function classification(merchant: string, source: string, lastSeen: string, count: number) {
  mockDb
    .prepare(
      `INSERT INTO expense_classifications (id, user_id, merchant_normalized, amount_range_low, amount_range_high,
         classification, frequency, expected_day_of_month, confidence, source, occurrence_count, last_seen_date, is_active)
       VALUES (?, ?, ?, 1500, 1500, 'fixed', 'monthly', 1, 0.95, ?, ?, ?, 1)`,
    )
    .run(`c-${merchant}`, U, merchant, source, count, lastSeen);
}

const PAST = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] }).setSystemTime(new Date(2026, 9, 5, 10, 0));
});
afterAll(() => jest.useRealTimers());

beforeEach(async () => {
  mockDb = new DatabaseSync(":memory:");
  mockStore.clear();
  seq = 0;
  await runMigrations(mockAdapter as never);
  U = await seedDefaultUser(mockAdapter as never);
  for (const m of PAST) {
    spend(`${m}-05`, 649, "NETFLIX");
    for (let d = 2; d <= 26; d += 3) spend(`${m}-${String(d).padStart(2, "0")}`, 3000 + d * 10, `SHOP${d % 4}`);
    // Money moved to your own account — not spending.
    spend(`${m}-15`, 200000, "SELF", { reclassified_as_transfer: 1 });
    // Not reviewed yet — not spending either.
    spend(`${m}-20`, 50000, "UNKNOWN", { status: "pending_review" });
  }
  for (let d = 1; d <= 5; d++) spend(`2026-10-0${d}`, 1600, "SHOP1");
});

describe("historical baseline", () => {
  it("leaves out transfers and unreviewed items, and uses the middle month", async () => {
    const avg = await getHistoricalVariableAvg(U, 5, "2026-10", []);
    // 9 shop payments a month (~₹28k) + Netflix; nothing near the ₹2 lakh transfers.
    expect(avg).toBeGreaterThan(25000);
    expect(avg).toBeLessThan(35000);
  });
});

describe("month-end projection", () => {
  async function project(month: string) {
    await rebuildPatterns(U);
    const classifications = await getActiveClassifications(U);
    const { startDate, endDate } = { startDate: `${month}-01`, endDate: `${month}-31` };
    const expenses = await getSpendingRows(U, startDate, endDate);
    const hist = await getHistoricalVariableAvg(U, 5, month, classifications);
    return forecastMonthEndRealistic({ userId: U, month, expenses, classifications, budgets: [], historicalVariableAvg: hist, dataMonths: 6 });
  }

  it("projects the current month near a normal month, not double", async () => {
    const f = await project("2026-10");
    expect(f.variable.daysElapsed).toBe(5);
    expect(f.variable.daysLeft).toBe(27);
    // Netflix not paid yet this month → pending.
    expect(f.fixedPending.items.map((i) => i.merchant)).toContain("netflix");
    expect(f.projectedTotal).toBeGreaterThan(25000);
    expect(f.projectedTotal).toBeLessThan(60000);
  });

  it("a past month's projection is what was spent", async () => {
    const f = await project("2026-09");
    const spent = (await getSpendingRows(U, "2026-09-01", "2026-09-30")).reduce((s, e) => s + e.amount, 0);
    expect(f.fixedPending.total).toBe(0);
    expect(f.projectedTotal).toBe(Math.round(spent));
  });
});

describe("pattern rebuild", () => {
  it("learns the steady bill, drops runaway stale auto patterns, pauses a stopped confirmed one", async () => {
    classification("OLDGYM", "auto_detected", "2026-06-01", 2416);
    classification("MAGAZINE", "user_confirmed", "2026-05-01", 4);

    await rebuildPatterns(U);
    const rows = mockDb.prepare(`SELECT merchant_normalized AS m, source, is_active, deactivated_reason AS why, occurrence_count AS n, classification AS c, frequency AS f FROM expense_classifications`).all() as Record<string, unknown>[];

    expect(rows.find((r) => r.m === "OLDGYM")).toBeUndefined();
    expect(rows.find((r) => r.m === "MAGAZINE")).toMatchObject({ is_active: 0, why: "paused" });
    expect(rows.find((r) => r.m === "netflix")).toMatchObject({ c: "fixed", f: "monthly", n: 5, is_active: 1 });

    // Idempotent: a second run changes nothing (no runaway counts).
    await rebuildPatterns(U);
    const again = mockDb.prepare(`SELECT occurrence_count AS n FROM expense_classifications WHERE merchant_normalized = 'netflix'`).get() as { n: number };
    expect(again.n).toBe(5);

    expect((await getPatternsToConfirm(U)).map((c) => c.merchant_normalized)).toContain("netflix");
  });
});
