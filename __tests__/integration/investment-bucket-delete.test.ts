import { DatabaseSync } from "node:sqlite";

/**
 * Deleting an investment bucket against a real SQLite engine with foreign keys on. Transfers
 * tagged with the bucket (or linked to one of its contributions) used to make the delete fail,
 * and the screen swallowed the error. Now they're detached, and the confirmation can say what
 * changes.
 */
let mockSqlite: DatabaseSync;

const mockAdapter = {
  runAsync: async (sql: string, ...params: unknown[]) => {
    const r = mockSqlite.prepare(sql).run(...(params as never[]));
    return { changes: Number(r.changes), lastInsertRowId: 0 };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) =>
    mockSqlite.prepare(sql).all(...(params as never[])) as never[],
  getFirstAsync: async (sql: string, ...params: unknown[]) =>
    (mockSqlite.prepare(sql).get(...(params as never[])) ?? null) as never,
  withTransactionAsync: async (cb: () => Promise<void>) => {
    mockSqlite.exec("BEGIN");
    try {
      await cb();
      mockSqlite.exec("COMMIT");
    } catch (e) {
      mockSqlite.exec("ROLLBACK");
      throw e;
    }
  },
};

jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));
jest.mock("../../services/settings", () => ({
  getFYStartMonth: () => 4,
  bumpDataVersion: jest.fn(),
}));

import { deleteInvestmentBucket, getInvestmentBucketUsage } from "../../services/yearly-plan";

beforeEach(() => {
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE investment_buckets (id TEXT PRIMARY KEY, name TEXT, linked_milestone_id TEXT);
    CREATE TABLE investment_contributions (
      id TEXT PRIMARY KEY, investment_bucket_id TEXT NOT NULL REFERENCES investment_buckets(id), amount REAL
    );
    CREATE TABLE account_transfers (
      id TEXT PRIMARY KEY, amount REAL, deleted_at TEXT,
      investment_bucket_id TEXT REFERENCES investment_buckets(id),
      linked_contribution_id TEXT REFERENCES investment_contributions(id)
    );
    CREATE TABLE expense_investment_links (
      id TEXT PRIMARY KEY, expense_id TEXT,
      investment_bucket_id TEXT NOT NULL REFERENCES investment_buckets(id) ON DELETE CASCADE
    );
    CREATE TABLE smart_rules (id TEXT PRIMARY KEY, action_link_to_investment_bucket_id TEXT);
    CREATE TABLE investment_products (
      id TEXT PRIMARY KEY,
      investment_bucket_id TEXT REFERENCES investment_buckets(id) ON DELETE SET NULL
    );

    INSERT INTO investment_buckets VALUES ('b', 'Retirement', NULL), ('other', 'Car', NULL);
    INSERT INTO investment_contributions VALUES ('c1', 'b', 5000), ('c2', 'b', 5000), ('keep', 'other', 100);
    INSERT INTO account_transfers VALUES
      ('t1', 5000, NULL, 'b', 'c1'),
      ('t2', 5000, '2026-10-01', 'b', NULL),
      ('t3', 100, NULL, 'other', 'keep');
    INSERT INTO expense_investment_links VALUES ('l1', 'e1', 'b');
    INSERT INTO smart_rules VALUES ('r1', 'b'), ('r2', 'other');
    INSERT INTO investment_products VALUES ('fd', 'b');
  `);
});

test("the old delete is refused by the database while a transfer points at the bucket", () => {
  expect(() => {
    mockSqlite.exec("DELETE FROM investment_contributions WHERE investment_bucket_id = 'b'");
  }).toThrow(/FOREIGN KEY/);
});

test("usage counts everything the confirmation mentions", async () => {
  expect(await getInvestmentBucketUsage("b")).toEqual({
    contributions: 2,
    transfers: 2, // one live, one in the recycle bin
    linkedExpenses: 1,
    rules: 1,
    fixedDeposits: 1,
  });
});

test("delete removes the bucket and its contributions, and detaches the rest", async () => {
  await deleteInvestmentBucket("b");
  const one = (sql: string) => mockSqlite.prepare(sql).get() as Record<string, unknown>;

  expect(one("SELECT COUNT(*) AS n FROM investment_buckets WHERE id = 'b'").n).toBe(0);
  expect(one("SELECT COUNT(*) AS n FROM investment_contributions WHERE investment_bucket_id = 'b'").n).toBe(0);
  // Transfers keep their money movement, without the bucket.
  expect(one("SELECT investment_bucket_id, linked_contribution_id, amount FROM account_transfers WHERE id = 't1'")).toEqual({
    investment_bucket_id: null,
    linked_contribution_id: null,
    amount: 5000,
  });
  expect(one("SELECT investment_bucket_id FROM account_transfers WHERE id = 't2'").investment_bucket_id).toBeNull();
  expect(one("SELECT COUNT(*) AS n FROM expense_investment_links").n).toBe(0);
  expect(one("SELECT action_link_to_investment_bucket_id AS b FROM smart_rules WHERE id = 'r1'").b).toBeNull();
  expect(one("SELECT investment_bucket_id AS b FROM investment_products WHERE id = 'fd'").b).toBeNull();

  // Another bucket is untouched.
  expect(one("SELECT investment_bucket_id AS b, linked_contribution_id AS c FROM account_transfers WHERE id = 't3'")).toEqual({
    b: "other",
    c: "keep",
  });
  expect(one("SELECT action_link_to_investment_bucket_id AS b FROM smart_rules WHERE id = 'r2'").b).toBe("other");
});
