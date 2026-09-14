import { DatabaseSync } from "node:sqlite";

/**
 * duplicateScenarioWithShiftedDates ("copy with updated dates") and the
 * horizon-change re-expansion fix in updateScenario, against a REAL SQLite
 * engine — same approach as simulator-recurring-entries.test.ts. The thing
 * that can actually be wrong here (date-shift math, end-of-month clamping,
 * whether recurring templates regenerate) can't be verified by a mock that
 * only records SQL strings.
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

import { createEntry, duplicateScenarioWithShiftedDates, updateScenario } from "../../services/simulator";

function seed() {
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
      source TEXT, seed_source_id TEXT, fulfilled_expense_id TEXT, status TEXT DEFAULT 'upcoming',
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      hisaab_person_id TEXT, hisaab_kind TEXT,
      frequency TEXT, repeat_ordinal INTEGER, repeat_weekday INTEGER, repeat_until TEXT
    );
    CREATE TABLE simulation_hisaab_inclusions (
      scenario_id TEXT, person_id TEXT, included INTEGER, amount REAL, amount_sign TEXT, pct REAL DEFAULT 100,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function entriesFor(scenarioId: string) {
  return mockSqlite
    .prepare("SELECT * FROM simulation_entries WHERE scenario_id = ? ORDER BY date ASC")
    .all(scenarioId) as Record<string, unknown>[];
}

describe("duplicateScenarioWithShiftedDates", () => {
  it("shifts a plain entry's date by the calendar-month delta between horizons", async () => {
    seed();
    mockSqlite
      .prepare("INSERT INTO simulation_scenarios (id, user_id, name, horizon_date) VALUES ('src','u1','May',?)")
      .run("2026-05-31");
    await createEntry("src", { direction: "out", amount: 1500, date: "2026-05-10", source: "manual" });

    const newId = await duplicateScenarioWithShiftedDates("src", "2026-08-31");
    const rows = entriesFor(newId);
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("2026-08-10"); // +3 months
  });

  it("clamps a 31st-of-the-month date into a shorter target month", async () => {
    seed();
    mockSqlite
      .prepare("INSERT INTO simulation_scenarios (id, user_id, name, horizon_date) VALUES ('src','u1','Jan',?)")
      .run("2026-01-31");
    await createEntry("src", { direction: "out", amount: 2000, date: "2026-01-31", source: "manual" });

    // Jan -> Feb is a 1-month shift; 2026 is not a leap year, so Feb has 28 days.
    const newId = await duplicateScenarioWithShiftedDates("src", "2026-02-28");
    const rows = entriesFor(newId);
    expect(rows[0].date).toBe("2026-02-28");
  });

  it("shifts a recurring template's repeat_until and regenerates cycles for the new horizon", async () => {
    seed();
    mockSqlite
      .prepare("INSERT INTO simulation_scenarios (id, user_id, name, horizon_date) VALUES ('src','u1','Q2',?)")
      .run("2026-06-30");
    await createEntry("src", {
      direction: "out",
      amount: 1000,
      date: "2026-04-15",
      source: "manual",
      frequency: "monthly",
      repeat_until: "2026-06-15",
    });

    // +3 months: horizon 2026-06-30 -> 2026-09-30, template Apr 15 -> Jul 15,
    // repeat_until Jun 15 -> Sep 15. Expect Jul/Aug/Sep 15 cycles (3 rows).
    const newId = await duplicateScenarioWithShiftedDates("src", "2026-09-30");
    const rows = entriesFor(newId);
    expect(rows.map((r) => r.date)).toEqual(["2026-07-15", "2026-08-15", "2026-09-15"]);
  });

  it("carries from_account_id/to_account_id (previously dropped by the old duplicate path)", async () => {
    seed();
    mockSqlite
      .prepare("INSERT INTO simulation_scenarios (id, user_id, name, horizon_date) VALUES ('src','u1','May',?)")
      .run("2026-05-31");
    await createEntry("src", {
      direction: "out",
      amount: 5000,
      date: "2026-05-01",
      source: "manual",
      from_account_id: "acc-a",
      to_account_id: "acc-b",
    });

    const newId = await duplicateScenarioWithShiftedDates("src", "2026-06-30");
    const rows = entriesFor(newId);
    expect(rows[0].from_account_id).toBe("acc-a");
    expect(rows[0].to_account_id).toBe("acc-b");
  });
});

describe("updateScenario horizon change", () => {
  it("re-expands a recurring template's cycles when the horizon moves later", async () => {
    seed();
    mockSqlite
      .prepare("INSERT INTO simulation_scenarios (id, user_id, name, horizon_date) VALUES ('s1','u1','Test',?)")
      .run("2026-03-31");
    await createEntry("s1", {
      direction: "out",
      amount: 800,
      date: "2026-01-15",
      source: "manual",
      frequency: "monthly",
    });
    // Only generated through the original horizon so far.
    expect(entriesFor("s1").map((r) => r.date)).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);

    await updateScenario("s1", { horizon_date: "2026-05-31" });
    expect(entriesFor("s1").map((r) => r.date)).toEqual([
      "2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15", "2026-05-15",
    ]);
  });
});
