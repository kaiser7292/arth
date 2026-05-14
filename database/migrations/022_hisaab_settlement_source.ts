import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 022: Hisaab settlement source tracking.
 *
 * Adds a `settlement_source` column to hisaab_entries so we can distinguish
 * two shapes of settlement entries:
 *   - 'created' — the old shape: recordSettlement() created both the
 *                 settlement entry AND the linked account credit. Deleting
 *                 this settlement should cascade-delete the credit.
 *   - 'linked'  — the v15.12.0 shape: linkCreditAsSettlement() took a
 *                 pre-existing credit (real bank transaction) and stamped a
 *                 settlement entry onto it. Deleting this settlement should
 *                 only unlink the credit, never delete the underlying bank row.
 *
 * Only meaningful for rows with type='settlement'; debits/credits ignore it.
 * Default 'created' preserves existing deleteEntry behavior for all pre-v15.12
 * rows without a migration pass.
 *
 * Idempotent via PRAGMA table_info guard.
 */
export default {
  version: 22,
  name: "hisaab_settlement_source",
  up: async (db: SQLiteDatabase) => {
    const cols = (await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(hisaab_entries);",
    )) as Array<{ name: string }>;
    const hasSource = cols.some((c) => c.name === "settlement_source");
    if (!hasSource) {
      await db.execAsync(
        "ALTER TABLE hisaab_entries ADD COLUMN settlement_source TEXT NOT NULL DEFAULT 'created';",
      );
    }
  },
};
