import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 010: Split-tender purchase groups.
 *
 * One real-world purchase (e.g. ₹2,000 bill) can be paid across 2-3 payment
 * sources (credit card + wallet + cash). Each leg remains its own expense row
 * (so account balances stay correct), but all legs share a purchase_group_id
 * so the UI can present them as a single purchase and duplicate detection can
 * skip siblings.
 *
 * Null = standalone expense (backward compatible). A valid group holds 2-3
 * rows sharing the same purchase_group_id. The cap of 3 is enforced at the
 * service layer, not as a DB constraint.
 */
export default {
  version: 10,
  name: "purchase_group",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      ALTER TABLE expenses ADD COLUMN purchase_group_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_expenses_purchase_group
        ON expenses(purchase_group_id)
        WHERE purchase_group_id IS NOT NULL;
    `);
  },
};
