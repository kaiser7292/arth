import { DatabaseSync } from "node:sqlite";

/**
 * listHisaabInclusions must recompute amount/amount_sign LIVE from a stored
 * pct against the person's CURRENT hisaab balance — not read a frozen
 * snapshot — so a scenario keeps reflecting reality after a new hisaab entry
 * is added, without the user reopening HisaabInclusionSheet to re-save.
 * Real SQLite, since the thing worth checking is the actual recompute math.
 */
let mockSqlite: DatabaseSync;

const mockAdapter = {
  runAsync: async (sql: string, ...params: unknown[]) => {
    mockSqlite.prepare(sql).run(...(params as never[]));
    return { changes: 0, lastInsertRowId: 0 };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) =>
    mockSqlite.prepare(sql).all(...(params as never[])) as never[],
  getFirstAsync: async (sql: string, ...params: unknown[]) =>
    (mockSqlite.prepare(sql).get(...(params as never[])) ?? null) as never,
};

jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));
jest.mock("../../services/settings", () => ({ bumpDataVersion: jest.fn() }));

import { listHisaabInclusions, upsertHisaabInclusion } from "../../services/simulator";

function seed() {
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    CREATE TABLE hisaab_persons (id TEXT PRIMARY KEY, owner_user_id TEXT, is_active INTEGER, name TEXT, initial_balance REAL);
    CREATE TABLE hisaab_entries (
      id TEXT PRIMARY KEY, hisaab_person_id TEXT, type TEXT, amount REAL, linked_expense_id TEXT
    );
    CREATE TABLE expenses (id TEXT PRIMARY KEY, deleted_at TEXT);
    CREATE TABLE simulation_hisaab_inclusions (
      scenario_id TEXT, person_id TEXT, included INTEGER, amount REAL, amount_sign TEXT, pct REAL,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (scenario_id, person_id)
    );
    INSERT INTO hisaab_persons (id, owner_user_id, is_active, name, initial_balance) VALUES ('p1', 'u1', 1, 'Rahul', 0);
    INSERT INTO hisaab_entries (id, hisaab_person_id, type, amount) VALUES ('e1', 'p1', 'debit', 1000);
  `);
}

describe("listHisaabInclusions — live balance tracking", () => {
  it("recomputes the amount from a NEW hisaab entry added after inclusion, without re-saving", async () => {
    seed();
    // Rahul owes 1000; include him at 100%.
    await upsertHisaabInclusion({ scenarioId: "s1", personId: "p1", included: true, amount: 1000, sign: "positive", pct: 100 });
    let rows = await listHisaabInclusions("s1");
    expect(rows[0].amount).toBe(1000);
    expect(rows[0].amount_sign).toBe("positive");

    // Balance changes on the real ledger — a new debit — WITHOUT touching the inclusion sheet.
    mockSqlite.prepare("INSERT INTO hisaab_entries (id, hisaab_person_id, type, amount) VALUES ('e2', 'p1', 'debit', 500);").run();

    rows = await listHisaabInclusions("s1");
    expect(rows[0].amount).toBe(1500); // live, not the frozen 1000
  });

  it("scales a partial (pct < 100) inclusion proportionally as the balance changes", async () => {
    seed();
    // Include only 50% of what Rahul owes.
    await upsertHisaabInclusion({ scenarioId: "s1", personId: "p1", included: true, amount: 500, sign: "positive", pct: 50 });
    let rows = await listHisaabInclusions("s1");
    expect(rows[0].amount).toBe(500); // 50% of 1000

    mockSqlite.prepare("INSERT INTO hisaab_entries (id, hisaab_person_id, type, amount) VALUES ('e2', 'p1', 'debit', 1000);").run();
    rows = await listHisaabInclusions("s1");
    expect(rows[0].amount).toBe(1000); // 50% of the new 2000 balance
  });

  it("flips the sign automatically when the balance crosses zero", async () => {
    seed();
    await upsertHisaabInclusion({ scenarioId: "s1", personId: "p1", included: true, amount: 1000, sign: "positive", pct: 100 });

    // Rahul pays back more than he owed — balance flips negative (now "I owe him").
    mockSqlite.prepare("INSERT INTO hisaab_entries (id, hisaab_person_id, type, amount) VALUES ('e2', 'p1', 'credit', 1500);").run();

    const rows = await listHisaabInclusions("s1");
    expect(rows[0].amount_sign).toBe("negative");
    expect(rows[0].amount).toBe(500);
  });

  it("excludes soft-deleted expenses' linked entries from the live balance", async () => {
    seed();
    mockSqlite.exec(`
      INSERT INTO expenses (id, deleted_at) VALUES ('exp-del', datetime('now'));
      INSERT INTO hisaab_entries (id, hisaab_person_id, type, amount, linked_expense_id) VALUES ('e2', 'p1', 'debit', 9999, 'exp-del');
    `);
    await upsertHisaabInclusion({ scenarioId: "s1", personId: "p1", included: true, amount: 1000, sign: "positive", pct: 100 });
    const rows = await listHisaabInclusions("s1");
    expect(rows[0].amount).toBe(1000); // the 9999 entry's linked expense is deleted — excluded
  });
});
