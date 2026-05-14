import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 013: User-explicit recurring expense rules.
 *
 * A rule is a template attached to one "source" expense that says
 * "this expense repeats on this cadence". The rule materializes exactly one
 * forecast row at a time — when the user realizes that forecast, the next
 * cycle gets created via an onForecastRealized hook.
 *
 * Schema:
 *   - recurring_expense_rules table: one row per source expense
 *   - expenses.recurring_rule_id column: plain TEXT stamp (not an FK) pointing
 *     at the rule that produced this forecast. Kept as a plain column to avoid
 *     a circular FK with recurring_expense_rules.source_expense_id → expenses;
 *     orphan-cleanup is handled in the application's rule-delete path.
 */
export default {
  version: 13,
  name: "recurring_expense_rules",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS recurring_expense_rules (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id),
        source_expense_id TEXT NOT NULL UNIQUE REFERENCES expenses(id) ON DELETE CASCADE,
        frequency TEXT NOT NULL CHECK(frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
        start_date TEXT NOT NULL,
        end_date TEXT,
        last_materialized_date TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_recurring_rules_user_active
        ON recurring_expense_rules(user_id, is_active);

      ALTER TABLE expenses ADD COLUMN recurring_rule_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_expenses_recurring_rule
        ON expenses(recurring_rule_id)
        WHERE recurring_rule_id IS NOT NULL;
    `);
  },
};
