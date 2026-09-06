import { DatabaseSync } from "node:sqlite";

/**
 * unlinkEntryFulfillment against a REAL SQLite engine, not a mock that records SQL strings.
 *
 * The point is to execute the behaviour rather than assert on the text of the queries. A mock can
 * only confirm that a statement was issued; it cannot tell you the entry ends up in the right
 * state, that a surviving link is picked up, or that the un-fulfil branch fires at the right
 * moment. Those are the three things that can actually be wrong here.
 *
 * node:sqlite is synchronous, so this adapter presents the small slice of the expo-sqlite surface
 * the service uses. withTransactionAsync just runs the callback: these assertions are about the
 * end state, not about rollback.
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
  withTransactionAsync: async (cb: () => Promise<void>) => cb(),
};

jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));
jest.mock("../../services/settings", () => ({ bumpDataVersion: jest.fn() }));

jest.mock("../../utils/uuid", () => ({ generateUUID: () => "unused-in-this-suite" }));

import { unlinkEntryFulfillment } from "../../services/simulator";

const TODAY = new Date().toISOString().slice(0, 10);
const PAST = "2020-01-01";
const FUTURE = "2099-01-01";

function seed(entryDate: string, expenseIds: string[]) {
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    CREATE TABLE simulation_entries (
      id TEXT PRIMARY KEY, date TEXT NOT NULL, status TEXT NOT NULL,
      fulfilled_expense_id TEXT, updated_at TEXT
    );
    CREATE TABLE simulation_entry_fulfillments (
      id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, expense_id TEXT NOT NULL
    );
  `);
  mockSqlite
    .prepare(
      "INSERT INTO simulation_entries (id, date, status, fulfilled_expense_id) VALUES (?,?,?,?)",
    )
    .run("e1", entryDate, "fulfilled", expenseIds[0] ?? null);
  expenseIds.forEach((x, i) =>
    mockSqlite
      .prepare("INSERT INTO simulation_entry_fulfillments (id, entry_id, expense_id) VALUES (?,?,?)")
      .run(`f${i}`, "e1", x),
  );
}

const entry = () =>
  mockSqlite.prepare("SELECT status, fulfilled_expense_id FROM simulation_entries WHERE id='e1'").get() as {
    status: string;
    fulfilled_expense_id: string | null;
  };

const links = () =>
  (mockSqlite.prepare("SELECT expense_id FROM simulation_entry_fulfillments WHERE entry_id='e1'").all() as {
    expense_id: string;
  }[]).map((r) => r.expense_id);

describe("unlinkEntryFulfillment", () => {
  it("removes only the transaction asked for", async () => {
    seed(FUTURE, ["x1", "x2", "x3"]);
    await unlinkEntryFulfillment("e1", "x2");
    expect(links().sort()).toEqual(["x1", "x3"]);
  });

  it("keeps the entry fulfilled while other links remain", async () => {
    seed(FUTURE, ["x1", "x2"]);
    await unlinkEntryFulfillment("e1", "x1");
    expect(entry().status).toBe("fulfilled");
  });

  it("re-points fulfilled_expense_id when the one it named is removed", async () => {
    // The pointer is denormalised, so removing the link it names must not leave it dangling.
    seed(FUTURE, ["x1", "x2"]);
    expect(entry().fulfilled_expense_id).toBe("x1");
    await unlinkEntryFulfillment("e1", "x1");
    expect(entry().fulfilled_expense_id).toBe("x2");
  });

  it("un-fulfils to upcoming when the last link goes and the date is ahead", async () => {
    seed(FUTURE, ["x1"]);
    await unlinkEntryFulfillment("e1", "x1");
    expect(entry()).toEqual({ status: "upcoming", fulfilled_expense_id: null });
  });

  it("un-fulfils to stale when the last link goes and the date has passed", async () => {
    // Matches how autoMatchEntries classifies an entry it could not match.
    seed(PAST, ["x1"]);
    await unlinkEntryFulfillment("e1", "x1");
    expect(entry()).toEqual({ status: "stale", fulfilled_expense_id: null });
  });

  it("treats an entry dated today as still upcoming", async () => {
    seed(TODAY, ["x1"]);
    await unlinkEntryFulfillment("e1", "x1");
    expect(entry().status).toBe("upcoming");
  });

  it("is a no-op for a transaction that was never linked", async () => {
    seed(FUTURE, ["x1"]);
    await unlinkEntryFulfillment("e1", "not-linked");
    expect(links()).toEqual(["x1"]);
    expect(entry().status).toBe("fulfilled");
  });
});
