import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 056: Snapshot amount on recurring_expense_rules.
 *
 * Previously, auto-matching fetched the source expense's current amount live.
 * If the user edited the expense after setting the reminder, the match amount
 * would drift from the original SMS amount.
 *
 * Storing the amount on the rule itself locks it in at creation time.
 * Backfill joins source expense for any existing rows.
 */
export default {
  version: 56,
  name: "recurring_rule_amount",
  up: async (db: SQLiteDatabase) => {
    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(recurring_expense_rules);`,
    );
    if (!cols.some((c) => c.name === "amount")) {
      await db.execAsync(
        `ALTER TABLE recurring_expense_rules ADD COLUMN amount REAL;`,
      );
    }
    // Backfill existing rules using the pre-split total so matching works
    // against full SMS amounts (split_original_amount takes precedence).
    await db.execAsync(`
      UPDATE recurring_expense_rules
      SET amount = (
        SELECT COALESCE(e.split_original_amount, e.amount)
        FROM expenses e
        WHERE e.id = recurring_expense_rules.source_expense_id
      )
      WHERE amount IS NULL;
    `);
  },
};
