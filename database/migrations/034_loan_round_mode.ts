import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 034 (v17.5.2): loan rounding mode.
 *
 * Indian banks universally round EMI/principal/interest to ₹1 on statements.
 * Non-INR loans may use paise precision. New column `round_mode` lets the
 * engine match the bank's numbers instead of showing ₹0.01-precise drift.
 *
 * Default 'rupee' applied via backfill below for existing INR loans; non-INR
 * stays 'paise'. New loans default per-currency at creation time.
 *
 * Idempotent via PRAGMA check + IF NOT EXISTS.
 */
export default {
  version: 34,
  name: "loan_round_mode",
  up: async (db: SQLiteDatabase) => {
    const cols = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(loan_accounts);",
    );
    const hasRoundMode = cols.some((c) => c.name === "round_mode");
    if (!hasRoundMode) {
      await db.execAsync(
        `ALTER TABLE loan_accounts ADD COLUMN round_mode TEXT NOT NULL DEFAULT 'rupee' CHECK(round_mode IN ('rupee','paise'));`,
      );
      // Backfill: paise for non-INR, rupee otherwise. DEFAULT already gives rupee.
      await db.execAsync(
        `UPDATE loan_accounts SET round_mode = 'paise' WHERE currency != 'INR';`,
      );
    }
  },
};
