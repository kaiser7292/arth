import { DatabaseSync } from "node:sqlite";

/**
 * Fix my data's history and Undo rules: every fix is listed, only the newest AI fix can be undone
 * (while its copy exists), and Undo first counts what it would also take away. Made-up values.
 */

let mockDb: DatabaseSync;
const mockFlat = (params: unknown[]) =>
  (params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params) as never[];
const mockAdapter = {
  execAsync: async (sql: string) => {
    mockDb.exec(sql);
  },
  runAsync: async (sql: string, ...params: unknown[]) => {
    const r = mockDb.prepare(sql).run(...mockFlat(params));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).all(...mockFlat(params)),
  getFirstAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).get(...mockFlat(params)) ?? null,
  withTransactionAsync: async (fn: () => Promise<void>) => fn(),
};

const mockStore = new Map<string, string>();
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: () => undefined,
    getNumber: () => undefined,
    getString: (k: string) => mockStore.get(k),
    set: (k: string, v: unknown) => mockStore.set(k, String(v)),
    delete: (k: string) => mockStore.delete(k),
    getAllKeys: () => [...mockStore.keys()],
    contains: (k: string) => mockStore.has(k),
    addOnValueChangedListener: () => ({ remove: () => {} }),
  })),
}));
jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));
const mockFiles = new Map<string, string>();
jest.mock("expo-file-system", () => ({
  Paths: { cache: "cache", document: "document" },
  File: class {
    name: string;
    constructor(_dir: string, name: string) {
      this.name = name;
    }
    get exists() {
      return mockFiles.has(this.name);
    }
    delete() {
      mockFiles.delete(this.name);
    }
    write(text: string) {
      mockFiles.set(this.name, text);
    }
    async text() {
      return mockFiles.get(this.name) ?? "";
    }
  },
}));

import { runMigrations } from "../../database/migrations";
import { addFixHistory, getFixHistory, getUndoable, takeSnapshot, undoChangesSince } from "../../services/corrections/snapshot";

const entry = (kind: "ai" | "match", at: string) => ({ kind, at, title: `${kind} ${at}`, changes: 3, groups: [], moved: [], failed: 0 });

beforeAll(async () => {
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  mockDb.exec("PRAGMA foreign_keys = OFF; PRAGMA ignore_check_constraints = ON;");
});
beforeEach(() => {
  mockStore.clear();
  mockFiles.clear();
});

describe("fixes done", () => {
  it("lists every fix, newest first", () => {
    addFixHistory(entry("ai", "2026-11-01T10:00:00.000Z"));
    addFixHistory(entry("match", "2026-11-02T10:00:00.000Z"));
    expect(getFixHistory().map((e) => e.kind)).toEqual(["match", "ai"]);
  });

  it("lets only the newest AI fix be undone, and only while its copy exists", async () => {
    addFixHistory(entry("ai", "2026-11-01T10:00:00.000Z"));
    expect(getUndoable()).toBeNull(); // no copy on the phone
    await takeSnapshot();
    addFixHistory(entry("ai", "2026-11-03T10:00:00.000Z"));
    addFixHistory(entry("match", "2026-11-04T10:00:00.000Z")); // a bank match doesn't take its place
    expect(getUndoable()?.at).toBe("2026-11-03T10:00:00.000Z");
  });

  it("carries over a correction applied before the history existed", () => {
    mockStore.set("fix_my_data_last", JSON.stringify({ appliedAt: "2026-10-30T08:00:00.000Z", changes: 12 }));
    expect(getFixHistory()[0]).toMatchObject({ kind: "ai", changes: 12, title: "12 corrections from your AI" });
    expect(mockStore.has("fix_my_data_last")).toBe(false);
  });

  it("counts what undo would also take away", async () => {
    mockDb.exec("DELETE FROM expenses;");
    const add = (id: string, created: string, updated: string) =>
      mockDb
        .prepare(
          "INSERT INTO expenses (id, user_id, amount, date, nature, status, source, created_at, updated_at) VALUES (?, 'u', 10, '2026-11-01', 'realized', 'approved', 'manual', ?, ?)",
        )
        .run(id, created, updated);
    add("old", "2026-10-01 09:00:00", "2026-10-01 09:00:00");
    add("edited", "2026-10-01 09:00:00", "2026-11-05 09:00:00");
    add("new", "2026-11-05 09:00:00", "2026-11-05 09:00:00");
    expect(await undoChangesSince("2026-11-03T10:00:00.000Z")).toEqual({ added: 1, changed: 1 });
  });
});
