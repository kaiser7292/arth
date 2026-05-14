import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 046: Add reclassification flag to expenses table.
 *
 * Instead of soft-deleting expenses/credits when marked as transfer,
 * we now mark them with a flag to keep them visible in the UI.
 *
 * Adds two columns to expenses:
 *   - reclassified_as_transfer — INTEGER (0/1 boolean flag)
 *   - linked_transfer_id      — TEXT (reference to account_transfers.id)
 *
 * Both nullable; NULL = not reclassified. Populated by
 * reclassifyExpenseAsTransfer / reclassifyCreditAsTransfer.
 *
 * Idempotent via PRAGMA table_info guard.
 */
export default {
  version: 46,
  name: "reclassification_flag",
  up: async (db: SQLiteDatabase) => {
    const cols = (await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(expenses);",
    )) as Array<{ name: string }>;
    const hasFlag = cols.some((c) => c.name === "reclassified_as_transfer");
    const hasLinked = cols.some((c) => c.name === "linked_transfer_id");
    
    if (!hasFlag) {
      await db.execAsync(
        "ALTER TABLE expenses ADD COLUMN reclassified_as_transfer INTEGER DEFAULT 0;",
      );
    }
    if (!hasLinked) {
      await db.execAsync(
        "ALTER TABLE expenses ADD COLUMN linked_transfer_id TEXT;",
      );
    }
    
    // Migrate existing reclassified expenses: those that were soft-deleted
    // and have a corresponding transfer with linked_expense_id
    await db.execAsync(`
      UPDATE expenses
      SET reclassified_as_transfer = 1,
          linked_transfer_id = (
            SELECT id FROM account_transfers
            WHERE account_transfers.linked_expense_id = expenses.id
            AND account_transfers.deleted_at IS NULL
            LIMIT 1
          )
      WHERE deleted_at IS NOT NULL
      AND id IN (SELECT linked_expense_id FROM account_transfers WHERE deleted_at IS NULL);
    `);
  },
};
