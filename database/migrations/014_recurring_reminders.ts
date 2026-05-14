import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 014: Pivot recurring rules from "materialize forecasts" to
 * "reminders linked to realized expenses".
 *
 * v14.6.0 model: rules auto-created forecast expenses with predicted amounts.
 * Problem: utility/rent amounts are often variable; the forecasts polluted
 * the ledger and hisaab with placeholder values the user then had to edit.
 *
 * v14.7.0 model: rules are reminders. When an expense (SMS-detected or
 * manually added) actually happens, the user links it to the reminder. That
 * link advances next_due_date to the next cycle. Reminder cards show
 * Pending / Fulfilled / Overdue states.
 *
 * Schema changes:
 *   1. recurring_expense_rules.next_due_date — the next reminder date (single
 *      source of truth; replaces last_materialized_date as the driver).
 *   2. expenses.fulfills_rule_id — plain stamp pointing at the rule this
 *      realized expense fulfills (at most one rule per expense).
 *   3. New table reminder_fulfillments — history of every cycle that has
 *      been linked to an expense. (rule_id, expense_id, cycle_due_date,
 *      fulfilled_at). expense_id is UNIQUE so one expense = one cycle.
 *
 * Cleanup:
 *   - Soft-delete every UNREALIZED forecast that was auto-materialized from
 *     a rule in v14.6.0. Realized expenses stay (history is preserved).
 *   - Backfill next_due_date from last_materialized_date (if set) or
 *     start_date.
 *
 * Legacy column `last_materialized_date` stays in schema for backup-compat
 * but is write-never after this migration.
 * Legacy column `recurring_rule_id` on expenses: the remaining non-deleted
 * rows with this set are now realized expenses that the user (or migration)
 * didn't delete — we clear the stamp so it's not confused with fulfills_rule_id.
 */
export default {
  version: 14,
  name: "recurring_reminders",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      ALTER TABLE recurring_expense_rules ADD COLUMN next_due_date TEXT;
      ALTER TABLE expenses ADD COLUMN fulfills_rule_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_recurring_rules_next_due
        ON recurring_expense_rules(next_due_date)
        WHERE is_active = 1;
      CREATE INDEX IF NOT EXISTS idx_expenses_fulfills_rule
        ON expenses(fulfills_rule_id)
        WHERE fulfills_rule_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS reminder_fulfillments (
        id TEXT PRIMARY KEY NOT NULL,
        rule_id TEXT NOT NULL REFERENCES recurring_expense_rules(id) ON DELETE CASCADE,
        expense_id TEXT NOT NULL UNIQUE,
        cycle_due_date TEXT NOT NULL,
        fulfilled_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_reminder_fulfillments_rule
        ON reminder_fulfillments(rule_id, cycle_due_date DESC);
    `);

    // Backfill next_due_date for existing rules.
    await db.runAsync(
      `UPDATE recurring_expense_rules
       SET next_due_date = COALESCE(last_materialized_date, start_date)
       WHERE next_due_date IS NULL;`,
    );

    // Soft-delete unrealized recurring-sourced forecasts. Don't touch forecasts
    // that were already realized (nature has moved to 'realized'). Leaving
    // realized expenses in place preserves history.
    await db.runAsync(
      `UPDATE expenses
       SET deleted_at = datetime('now'), updated_at = datetime('now')
       WHERE nature = 'forecast'
         AND recurring_rule_id IS NOT NULL
         AND deleted_at IS NULL
         AND status != 'rejected';`,
    );

    // Clear the legacy recurring_rule_id stamp — v14.7.0 uses
    // fulfills_rule_id on realized expenses instead. (The column itself
    // stays for backup-compat.)
    await db.runAsync(
      `UPDATE expenses SET recurring_rule_id = NULL WHERE recurring_rule_id IS NOT NULL;`,
    );
  },
};
