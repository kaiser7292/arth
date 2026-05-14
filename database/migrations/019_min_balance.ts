import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 019: Savings account minimum-balance threshold.
 *
 * Adds a single additive column to financial_accounts. Default 0 means
 * the feature is OFF for every existing account; users opt-in by editing
 * an account and setting a positive threshold. CC / wallet / loan / demat
 * accounts ignore this column — only savings consult it (enforced in
 * services/min-balance.ts, not here).
 *
 * Idempotent via PRAGMA table_info guard.
 */
export default {
  version: 19,
  name: "min_balance",
  up: async (db: SQLiteDatabase) => {
    const cols = (await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(financial_accounts);",
    )) as Array<{ name: string }>;
    const hasMinBalance = cols.some((c) => c.name === "min_balance");
    if (!hasMinBalance) {
      await db.execAsync(
        "ALTER TABLE financial_accounts ADD COLUMN min_balance REAL NOT NULL DEFAULT 0;",
      );
    }
  },
};
