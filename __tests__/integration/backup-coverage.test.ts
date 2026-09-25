import { DatabaseSync } from "node:sqlite";

/**
 * Backup coverage guard: builds the REAL schema by running every migration on a real SQLite
 * engine, then checks that the backup would carry all of it.
 *
 *   - every table is in BACKUP_TABLES, or in NOT_BACKED_UP with a reason
 *   - every column of a backed-up table is in TABLE_SCHEMAS (restore drops any column that
 *     isn't - silently; see CLAUDE.md "Database Changes Checklist")
 *
 * Adding a table or column without covering the backup fails this test, so it can't be missed.
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
  getAllAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).all(...(params as never[])),
  getFirstAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).get(...(params as never[])) ?? null,
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

jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: () => undefined,
    getNumber: () => undefined,
    getString: () => undefined,
    set: () => {},
    delete: () => {},
    getAllKeys: () => [],
  })),
}));

import { runMigrations } from "../../database/migrations";
import { TABLE_SCHEMAS } from "../../database/TABLE_SCHEMAS";
import { BACKUP_TABLES } from "../../services/backup";

/** Tables deliberately NOT in the backup, and why. Anything else must be backed up. */
const NOT_BACKED_UP: Record<string, string> = {
  schema_migrations: "rebuilt by running migrations on the restoring device",
  sqlite_sequence: "SQLite internal",
};

let tables: string[] = [];
const columns = new Map<string, string[]>();

beforeAll(async () => {
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  tables = (
    mockDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]
  ).map((r) => r.name);
  for (const t of tables) {
    columns.set(
      t,
      (mockDb.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name),
    );
  }
});

describe("backup covers the whole database", () => {
  it("built a real schema", () => {
    expect(tables.length).toBeGreaterThan(40);
  });

  it("backs up every table (or says why not)", () => {
    const missing = tables.filter((t) => !BACKUP_TABLES.includes(t) && !(t in NOT_BACKED_UP));
    expect(missing).toEqual([]);
  });

  it("lists every column of every backed-up table in the restore whitelist", () => {
    const gaps: string[] = [];
    for (const t of BACKUP_TABLES) {
      const cols = columns.get(t);
      if (!cols) continue; // checked below
      const allowed = new Set(TABLE_SCHEMAS[t] ?? []);
      for (const c of cols) if (!allowed.has(c)) gaps.push(`${t}.${c}`);
    }
    expect(gaps).toEqual([]);
  });

  it("every backed-up table actually exists and has a whitelist", () => {
    expect(BACKUP_TABLES.filter((t) => !tables.includes(t))).toEqual([]);
    expect(BACKUP_TABLES.filter((t) => !TABLE_SCHEMAS[t])).toEqual([]);
  });
});
