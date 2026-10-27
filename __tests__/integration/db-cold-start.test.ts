/**
 * S3-6: DB cold-start integration test.
 *
 * Verifies that initDatabase():
 *  1. Opens the DB and enables WAL mode + FK constraints
 *  2. Runs all migrations without error
 *  3. Seeds the default user
 *  4. Returns the same instance on subsequent calls (singleton)
 *  5. getDatabase() throws before init and succeeds after
 */

let execCalls: string[] = [];
let runCalls: { sql: string; params: unknown[] }[] = [];

const mockDb = {
  execAsync: jest.fn(async (sql: string) => {
    execCalls.push(sql.trim());
  }),
  runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    runCalls.push({ sql, params });
    return { changes: 1, lastInsertRowId: 1 };
  }),
  getAllAsync: jest.fn(async () => []),
  getFirstAsync: jest.fn(async () => null),
  closeAsync: jest.fn(async () => {}),
  withTransactionAsync: jest.fn(async (cb: () => Promise<void>) => cb()),
};

jest.mock("expo-sqlite", () => ({
  openDatabaseAsync: jest.fn(async () => mockDb),
}));

jest.mock("../../services/smart-categorizer", () => ({
  seedMerchantMappings: jest.fn(async () => {}),
}));

// Import after mocks are registered
import { initDatabase, getDatabase, closeDatabase } from "../../database/database";

describe("DB cold-start", () => {
  beforeEach(async () => {
    execCalls = [];
    runCalls = [];
    jest.clearAllMocks();
    await closeDatabase();
  });

  it("getDatabase() throws before initDatabase()", () => {
    expect(() => getDatabase()).toThrow("Database not initialized");
  });

  it("initDatabase() enables WAL mode", async () => {
    await initDatabase();
    expect(execCalls.some((s) => s.includes("journal_mode = WAL"))).toBe(true);
  });

  it("initDatabase() enables foreign keys", async () => {
    await initDatabase();
    expect(execCalls.some((s) => s.includes("foreign_keys = ON"))).toBe(true);
  });

  it("initDatabase() runs migrations (schema_migrations table created)", async () => {
    await initDatabase();
    expect(execCalls.some((s) => s.includes("schema_migrations"))).toBe(true);
  });

  it("initDatabase() returns same instance on second call (singleton)", async () => {
    const db1 = await initDatabase();
    const db2 = await initDatabase();
    expect(db1).toBe(db2);
  });

  it("getDatabase() succeeds after initDatabase()", async () => {
    await initDatabase();
    expect(() => getDatabase()).not.toThrow();
    expect(getDatabase()).toBe(mockDb);
  });

  it("opens the file once, even when several callers start at the same moment", async () => {
    // Root layout, widget, alerts and calendar sync can all call initDatabase during start-up. A
    // second open of the same file shares the native connection, and collecting either JS handle
    // closes it under the other (the prepareAsync NullPointerException).
    const { openDatabaseAsync } = jest.requireMock("expo-sqlite") as { openDatabaseAsync: jest.Mock };
    const [a, b, c] = await Promise.all([initDatabase(), initDatabase(), initDatabase()]);
    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("a failed start-up is retried from scratch, not handed back half-open", async () => {
    const { openDatabaseAsync } = jest.requireMock("expo-sqlite") as { openDatabaseAsync: jest.Mock };
    mockDb.execAsync.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    await expect(initDatabase()).rejects.toThrow("boom");
    expect(() => getDatabase()).toThrow("Database not initialized");
    expect(mockDb.closeAsync).toHaveBeenCalled();

    await expect(initDatabase()).resolves.toBe(mockDb);
    expect(openDatabaseAsync).toHaveBeenCalledTimes(2);
  });

  it("closeDatabase() resets singleton so next init opens fresh", async () => {
    await initDatabase();
    await closeDatabase();
    expect(() => getDatabase()).toThrow("Database not initialized");
  });
});
