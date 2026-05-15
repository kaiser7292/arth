import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 048: Add source_sms_address to expenses.
 *
 * The expenses table already has raw_source_text but the matching DLT
 * sender ID column was only added to account_transfers (migration 023).
 * Queries like getCreditsForMonth select source_sms_address from
 * expenses, which fails on databases that have never had this column,
 * crashing screens that load credits.
 *
 * Idempotent via PRAGMA table_info guard.
 */
export default {
  version: 48,
  name: "expenses_source_sms_address",
  up: async (db: SQLiteDatabase) => {
    const cols = (await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(expenses);",
    )) as Array<{ name: string }>;
    const hasAddr = cols.some((c) => c.name === "source_sms_address");
    if (!hasAddr) {
      await db.execAsync(
        "ALTER TABLE expenses ADD COLUMN source_sms_address TEXT;",
      );
    }
  },
};
