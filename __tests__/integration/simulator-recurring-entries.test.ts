import { DatabaseSync } from "node:sqlite";

/**
 * expandRecurringEntries / createEntry against a REAL SQLite engine (not a mock that only
 * records SQL strings) — same approach as simulator-unlink.test.ts. The thing that can
 * actually be wrong here is cycle-stepping logic (materialising the right dates, stopping
 * at the right boundary, not re-inserting on a second pass), which a mock can't verify.
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
  withTransactionAsync: async (cb: () => Promise<void>) => cb(),
};

jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));
jest.mock("../../services/settings", () => ({ bumpDataVersion: jest.fn() }));
jest.mock("../../utils/uuid", () => ({ generateUUID: () => `gen-${++mockNextId}` }));

import { createEntry, expandRecurringEntries } from "../../services/simulator";

function seed(horizonDate: string) {
  mockNextId = 0;
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    CREATE TABLE simulation_scenarios (
      id TEXT PRIMARY KEY, user_id TEXT, name TEXT, horizon_date TEXT,
      is_default INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, archived_at TEXT
    );
    CREATE TABLE simulation_entries (
      id TEXT PRIMARY KEY, scenario_id TEXT, direction TEXT, amount REAL, date TEXT,
      originally_planned_for TEXT, account_id TEXT, from_account_id TEXT, to_account_id TEXT,
      category_id TEXT, merchant_name TEXT, description TEXT,
      source TEXT, seed_source_id TEXT, fulfilled_expense_id TEXT, status TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      hisaab_person_id TEXT, hisaab_kind TEXT,
      frequency TEXT, repeat_ordinal INTEGER, repeat_weekday INTEGER, repeat_until TEXT
    );
  `);
  mockSqlite
    .prepare("INSERT INTO simulation_scenarios (id, user_id, name, horizon_date) VALUES ('s1','u1','Test',?)")
    .run(horizonDate);
}

function allDates(): string[] {
  return (mockSqlite.prepare("SELECT date FROM simulation_entries ORDER BY date ASC").all() as { date: string }[])
    .map((r) => r.date);
}

describe("recurring simulator entries", () => {
  it("expands a monthly template into one row per cycle up to the scenario horizon", async () => {
    seed("2026-06-30");
    await createEntry("s1", {
      direction: "out",
      amount: 1000,
      date: "2026-01-15",
      source: "manual",
      frequency: "monthly",
    });
    // Template (Jan 15) + Feb/Mar/Apr/May/Jun 15 = 6 rows.
    expect(allDates()).toEqual([
      "2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15", "2026-05-15", "2026-06-15",
    ]);
  });

  it("stops at repeat_until when it is earlier than the scenario horizon", async () => {
    seed("2026-12-31");
    await createEntry("s1", {
      direction: "out",
      amount: 500,
      date: "2026-01-01",
      source: "manual",
      frequency: "monthly",
      repeat_until: "2026-03-01",
    });
    expect(allDates()).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });

  it("is idempotent — running expansion again does not duplicate rows", async () => {
    seed("2026-04-30");
    await createEntry("s1", {
      direction: "out",
      amount: 200,
      date: "2026-01-01",
      source: "manual",
      frequency: "monthly",
    });
    const before = allDates();
    const added = await expandRecurringEntries("s1");
    expect(added).toBe(0);
    expect(allDates()).toEqual(before);
  });

  it("carries account/category/merchant onto each generated cycle", async () => {
    seed("2026-03-31");
    await createEntry("s1", {
      direction: "out",
      amount: 999,
      date: "2026-01-01",
      account_id: "acc-1",
      category_id: "cat-1",
      merchant_name: "Landlord",
      source: "manual",
      frequency: "monthly",
    });
    const rows = mockSqlite
      .prepare("SELECT account_id, category_id, merchant_name, amount FROM simulation_entries ORDER BY date ASC")
      .all() as { account_id: string; category_id: string; merchant_name: string; amount: number }[];
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.account_id).toBe("acc-1");
      expect(r.category_id).toBe("cat-1");
      expect(r.merchant_name).toBe("Landlord");
      expect(r.amount).toBe(999);
    }
  });

  it("rejects nth_weekday without an ordinal/weekday instead of expanding a broken cycle", async () => {
    seed("2026-06-30");
    await expect(
      createEntry("s1", {
        direction: "out",
        amount: 100,
        date: "2026-01-05",
        source: "manual",
        frequency: "nth_weekday",
      }),
    ).rejects.toThrow(/nth_weekday/);
  });

  it("expands a 4th-Monday nth_weekday template using the real recurrence math", async () => {
    seed("2026-06-30");
    await createEntry("s1", {
      direction: "out",
      amount: 100,
      date: "2026-01-26", // 4th Monday of Jan 2026
      source: "manual",
      frequency: "nth_weekday",
      repeat_ordinal: 4,
      repeat_weekday: 1,
    });
    // 4th Monday of each month, Jan-Jun 2026.
    expect(allDates()).toEqual([
      "2026-01-26", "2026-02-23", "2026-03-23", "2026-04-27", "2026-05-25", "2026-06-22",
    ]);
  });

  it("leaves a plain one-off entry (no frequency) alone", async () => {
    seed("2026-06-30");
    await createEntry("s1", {
      direction: "out",
      amount: 50,
      date: "2026-02-01",
      source: "manual",
    });
    expect(allDates()).toEqual(["2026-02-01"]);
  });
});
