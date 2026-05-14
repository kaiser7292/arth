import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 028 (v17.0.0): expense → investment bucket linking.
 *
 * Lets user mark any realized expense as an investment contribution that
 * credits an Investment Bucket without requiring a demat-transfer path.
 *
 * One-to-one with expenses (UNIQUE on expense_id). Bucket recompute sums
 * contributions from both demat transfers (v14.4.0) and expense links.
 *
 * Safe for repeat runs: guards with IF NOT EXISTS.
 */
export default {
  version: 28,
  name: "expense_investment_links",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS expense_investment_links (
        id TEXT PRIMARY KEY,
        expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
        investment_bucket_id TEXT NOT NULL REFERENCES investment_buckets(id) ON DELETE CASCADE,
        contribution_amount REAL NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_exp_inv_link_exp ON expense_investment_links(expense_id);
      CREATE INDEX IF NOT EXISTS idx_exp_inv_link_bucket ON expense_investment_links(investment_bucket_id);
    `);
  },
};
