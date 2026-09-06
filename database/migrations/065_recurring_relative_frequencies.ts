import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 065: Add relative-date repeat types to recurring reminders.
 *
 * New frequency values: 'last_day_of_month', 'nth_weekday'.
 * New columns on recurring_expense_rules:
 *   - repeat_ordinal: for nth_weekday — 1/2/3/4 or -1 (last).
 *   - repeat_weekday: for nth_weekday — 0=Sun … 6=Sat.
 *
 * SQLite can't ALTER a CHECK constraint, so we recreate the table via
 * the standard rename → create → copy → drop pattern with foreign_keys OFF.
 *
 * legacy_alter_table MUST be ON for the rename. Since SQLite 3.25, RENAME TO also rewrites
 * every reference to the table in OTHER objects - so without it, reminder_fulfillments'
 * foreign key followed recurring_expense_rules to ..._old, and the DROP below then left it
 * pointing at nothing. Inserting a fulfillment failed from then on with
 * "no such table: main.recurring_expense_rules_old", which is what broke linking an expense
 * to a reminder. foreign_keys OFF does not prevent this: it disables enforcement, not the
 * rewrite. Migration 070 repairs databases that ran this before the pragma was added.
 */
export default {
  version: 65,
  name: "recurring_relative_frequencies",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync("PRAGMA foreign_keys = OFF;");
    await db.execAsync("PRAGMA legacy_alter_table = ON;");
    try {
      await db.execAsync(`
        ALTER TABLE recurring_expense_rules RENAME TO recurring_expense_rules_old;

        CREATE TABLE recurring_expense_rules (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id),
          source_expense_id TEXT NOT NULL UNIQUE REFERENCES expenses(id) ON DELETE CASCADE,
          frequency TEXT NOT NULL CHECK(frequency IN (
            'weekly','monthly','quarterly','yearly','last_day_of_month','nth_weekday'
          )),
          start_date TEXT NOT NULL,
          end_date TEXT,
          last_materialized_date TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          next_due_date TEXT,
          amount REAL,
          repeat_ordinal INTEGER,
          repeat_weekday INTEGER
        );

        INSERT INTO recurring_expense_rules
          (id, user_id, source_expense_id, frequency, start_date, end_date,
           last_materialized_date, is_active, notes, created_at, updated_at,
           next_due_date, amount)
        SELECT
          id, user_id, source_expense_id, frequency, start_date, end_date,
          last_materialized_date, is_active, notes, created_at, updated_at,
          next_due_date, amount
        FROM recurring_expense_rules_old;

        DROP TABLE recurring_expense_rules_old;

        CREATE INDEX IF NOT EXISTS idx_recurring_rules_user_active
          ON recurring_expense_rules(user_id, is_active);
        CREATE INDEX IF NOT EXISTS idx_recurring_rules_next_due
          ON recurring_expense_rules(next_due_date)
          WHERE is_active = 1;
      `);
    } finally {
      await db.execAsync("PRAGMA legacy_alter_table = OFF;");
      await db.execAsync("PRAGMA foreign_keys = ON;");
    }
  },
};
