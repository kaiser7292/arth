/**
 * S3-2: Schema verification test for migration 042.
 * Confirms that from_account_id and to_account_id are added to
 * simulation_entries when the migration runs.
 */

let mockTableInfo: { name: string }[] = [];
let migrationRan = false;

const mockDb = {
  execAsync: jest.fn(async () => {
    migrationRan = true;
  }),
  getAllAsync: jest.fn(async () => mockTableInfo),
  runAsync: jest.fn(async () => ({ changes: 1, lastInsertRowId: 1 })),
};

jest.mock("expo-sqlite", () => ({
  openDatabaseAsync: jest.fn(async () => mockDb),
}));

import migration042 from "../../database/migrations/042_simulator_transfers";

describe("Migration 042 — simulator_transfers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    migrationRan = false;
  });

  it("adds from_account_id column to simulation_entries", async () => {
    await migration042.up(mockDb as never);

    const calls = (mockDb.execAsync as jest.Mock).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join(" ");

    expect(calls).toContain("from_account_id");
    expect(migrationRan).toBe(true);
  });

  it("adds to_account_id column to simulation_entries", async () => {
    await migration042.up(mockDb as never);

    const calls = (mockDb.execAsync as jest.Mock).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join(" ");

    expect(calls).toContain("to_account_id");
  });

  it("has correct version number 42", () => {
    expect(migration042.version).toBe(42);
  });

  it("has correct name", () => {
    expect(migration042.name).toBe("simulator_transfers");
  });
});
