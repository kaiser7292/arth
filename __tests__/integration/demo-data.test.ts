import { DatabaseSync } from "node:sqlite";

/**
 * Sample data for store screenshots, run against the REAL schema (every migration on a real
 * SQLite engine) through the real services. Guards: demo builds only, empty database only.
 */
let mockDb: DatabaseSync;
const mockAdapter = {
  execAsync: async (sql: string) => {
    mockDb.exec(sql);
  },
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
    try {
      await fn();
      mockDb.exec("COMMIT");
    } catch (e) {
      mockDb.exec("ROLLBACK");
      throw e;
    }
  },
};

jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: () => undefined,
    getNumber: () => undefined,
    getString: () => undefined,
    set: () => {},
    delete: () => {},
    getAllKeys: () => [],
    contains: () => false,
  })),
}));
let mockDemo = true;
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { get expoConfig() { return { extra: { demoData: mockDemo } }; } },
}));

import { runMigrations } from "../../database/migrations";
import { seedDefaultUser } from "../../database/seed";
import { isDemoBuild, seedDemoData } from "../../services/demo-data";

const count = (sql: string) => (mockDb.prepare(sql).get() as { n: number }).n;

beforeEach(async () => {
  mockDemo = true;
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  await seedDefaultUser(mockAdapter as never); // the app does this on every launch
});

describe("seedDemoData", () => {
  it("creates a believable, fictional dataset through the real services", async () => {
    await seedDemoData();

    expect(count("SELECT COUNT(*) AS n FROM financial_accounts WHERE account_type IN ('savings','credit_card','wallet')")).toBe(5);
    expect(count("SELECT COUNT(*) AS n FROM expenses WHERE nature = 'realized'")).toBeGreaterThan(60);
    expect(count("SELECT COUNT(*) AS n FROM expenses WHERE nature = 'credit'")).toBeGreaterThanOrEqual(3);
    expect(count("SELECT COUNT(*) AS n FROM expenses WHERE status != 'approved'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM account_transfers")).toBeGreaterThan(2);
    expect(count("SELECT COUNT(*) AS n FROM budgets")).toBe(9);
    expect(count("SELECT COUNT(*) AS n FROM loan_accounts")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM hisaab_persons")).toBe(3);
    expect(count("SELECT COUNT(*) AS n FROM life_milestones")).toBe(2);
    // every transaction is categorised and on an account
    expect(count("SELECT COUNT(*) AS n FROM expenses WHERE nature = 'realized' AND (category_id IS NULL OR account_id IS NULL)")).toBe(0);
    // nothing dated in the future
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(count(`SELECT COUNT(*) AS n FROM expenses WHERE date > '${todayIso}'`)).toBe(0);

    // screens that looked unfinished in the first screenshots
    expect(count("SELECT COUNT(*) AS n FROM account_month_balances")).toBeGreaterThanOrEqual(3); // no "No opening balance set"
    expect(count(`SELECT COUNT(*) AS n FROM loan_schedule_entries WHERE due_date <= '${todayIso}' AND status = 'scheduled'`)).toBe(0); // no overdue EMI
    expect(count("SELECT COUNT(*) AS n FROM expense_loan_links")).toBeGreaterThanOrEqual(3);
    expect(count("SELECT COUNT(*) AS n FROM salary_profiles WHERE computed_monthly_in_hand > 0")).toBe(1); // "Set your income" done
    expect(count("SELECT COUNT(*) AS n FROM investment_buckets")).toBe(2); // "Add investment goals" done
    expect(count(
      "SELECT COUNT(*) AS n FROM expenses e JOIN financial_accounts a ON a.id = e.account_id WHERE a.account_type = 'wallet'",
    )).toBeGreaterThan(0);
  });

  it("keeps every account's balance believable", async () => {
    await seedDemoData();
    const rows = mockDb.prepare(`
      SELECT a.bank_name, a.account_type,
        COALESCE((SELECT opening_balance FROM account_month_balances b WHERE b.account_id = a.id ORDER BY month LIMIT 1), 0)
        + COALESCE((SELECT SUM(amount) FROM expenses WHERE account_id = a.id AND nature = 'credit'), 0)
        - COALESCE((SELECT SUM(amount) FROM expenses WHERE account_id = a.id AND nature = 'realized'), 0)
        - COALESCE((SELECT SUM(amount) FROM account_transfers WHERE from_account_id = a.id), 0)
        + COALESCE((SELECT SUM(amount) FROM account_transfers WHERE to_account_id = a.id), 0) AS closing
      FROM financial_accounts a WHERE a.account_type IN ('savings', 'wallet')
    `).all() as { bank_name: string; closing: number }[];
    for (const r of rows) expect([r.bank_name, r.closing > 0]).toEqual([r.bank_name, true]);
  });

  it("gives the current month only its share of spending (screenshots taken on the 2nd)", async () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 2, 10), doNotFake: ["nextTick", "setImmediate", "queueMicrotask", "setTimeout", "setInterval"] });
    try {
      await seedDemoData();
      const thisMonth = count("SELECT COUNT(*) AS n FROM expenses WHERE nature = 'realized' AND date >= '2026-10-01'");
      const lastMonth = count("SELECT COUNT(*) AS n FROM expenses WHERE nature = 'realized' AND date >= '2026-09-01' AND date < '2026-10-01'");
      expect(thisMonth).toBeLessThan(lastMonth / 5);
      expect(count("SELECT COUNT(*) AS n FROM expenses WHERE date > '2026-10-02'")).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("refuses outside a demo build", async () => {
    mockDemo = false;
    expect(isDemoBuild()).toBe(false);
    await expect(seedDemoData()).rejects.toThrow(/demo builds/);
    expect(count("SELECT COUNT(*) AS n FROM financial_accounts")).toBe(0);
  });

  it("refuses when the install already has transactions", async () => {
    await seedDemoData();
    const before = count("SELECT COUNT(*) AS n FROM expenses");
    await expect(seedDemoData()).rejects.toThrow(/already has transactions/);
    expect(count("SELECT COUNT(*) AS n FROM expenses")).toBe(before);
  });
});
