import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 050: Rate-aware loan corrections.
 *
 * Adds optional `interest_rate_pa` to loan_corrections so a single correction
 * event can capture rate changes (floating-rate repricing) alongside the
 * existing outstanding / EMI / tenure overrides. Null = rate unchanged
 * (existing corrections keep working).
 *
 * Idempotent via PRAGMA table_info guard.
 */
export default {
  version: 50,
  name: "loan_correction_rate",
  up: async (db: SQLiteDatabase) => {
    const cols = (await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(loan_corrections);",
    )) as Array<{ name: string }>;
    const hasRate = cols.some((c) => c.name === "interest_rate_pa");
    if (!hasRate) {
      await db.execAsync(
        "ALTER TABLE loan_corrections ADD COLUMN interest_rate_pa REAL;",
      );
    }
  },
};
