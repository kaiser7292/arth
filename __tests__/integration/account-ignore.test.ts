import { DatabaseSync } from "node:sqlite";

/**
 * Ignoring an account found in messages, against the REAL schema: it's hidden, its message-made
 * transactions go to the recycle bin, its future messages are skipped, and Keep undoes all of it.
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

const mockStore = new Map<string, string>();
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: () => undefined,
    getNumber: () => undefined,
    getString: (k: string) => mockStore.get(k),
    set: (k: string, v: string) => mockStore.set(k, String(v)),
    delete: (k: string) => mockStore.delete(k),
    getAllKeys: () => [...mockStore.keys()],
  })),
}));
jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));

import { runMigrations } from "../../database/migrations";
import { getAccountOrigin, ignoreAccount, isIgnoredAccount, keepAccount } from "../../services/account-ignore";

const U = "default-user";
const one = (sql: string) => mockDb.prepare(sql).get() as Record<string, unknown>;

beforeEach(async () => {
  mockStore.clear();
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  mockDb.exec(`
    INSERT OR IGNORE INTO users (id, name) VALUES ('${U}', 'Me');
    INSERT INTO financial_accounts (id, user_id, account_identifier, bank_name, account_type)
      VALUES ('old', '${U}', '4421', 'ICICI Bank', 'credit_card');
    INSERT INTO expenses (id, user_id, amount, date, nature, status, source, merchant_name, account_id, raw_source_text)
      VALUES ('e1', '${U}', 100, '2026-09-01', 'realized', 'pending_review', 'sms_auto', 'A', 'old', 'Spent INR 100 on ICICI Card XX4421'),
             ('e2', '${U}', 200, '2026-09-05', 'realized', 'approved', 'manual', 'B', 'old', NULL);
  `);
});

it("hides the account and its message-made transactions, skips its messages, and Keep undoes it", async () => {
  await ignoreAccount("old");
  expect(one("SELECT is_active a FROM financial_accounts WHERE id = 'old'").a).toBe(0);
  expect(one("SELECT deleted_at d FROM expenses WHERE id = 'e1'").d).not.toBeNull();
  expect(one("SELECT deleted_at d FROM expenses WHERE id = 'e2'").d).toBeNull(); // added by hand: untouched
  expect(isIgnoredAccount("ICICI", "4421")).toBe(true);
  expect(isIgnoredAccount("ICICI Bank", "XX421")).toBe(true); // last 3 digits
  expect(isIgnoredAccount("HDFC Bank", "4421")).toBe(false);

  await keepAccount("old");
  expect(one("SELECT is_active a FROM financial_accounts WHERE id = 'old'").a).toBe(1);
  expect(one("SELECT deleted_at d FROM expenses WHERE id = 'e1'").d).toBeNull();
  expect(isIgnoredAccount("ICICI", "4421")).toBe(false);
});

it("says where an account came from", async () => {
  const o = await getAccountOrigin("old", U);
  expect(o.messages).toBe(1);
  expect(o.sample).toContain("XX4421");
});
