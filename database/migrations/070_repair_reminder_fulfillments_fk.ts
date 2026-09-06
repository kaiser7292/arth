import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Repair reminder_fulfillments' foreign key, which points at a table that no longer exists.
 *
 * THE MECHANISM
 *
 * 014 created reminder_fulfillments with `rule_id ... REFERENCES recurring_expense_rules(id)`.
 *
 * 065 rebuilt recurring_expense_rules the usual way — rename, create, copy, drop — because SQLite
 * cannot ALTER a CHECK constraint. Since 3.25, `ALTER TABLE ... RENAME TO` also REWRITES every
 * reference to that table in other objects, so the moment recurring_expense_rules became
 * recurring_expense_rules_old, reminder_fulfillments' foreign key was rewritten to follow it.
 * 065 then dropped recurring_expense_rules_old, leaving the key pointing at nothing.
 *
 * `PRAGMA foreign_keys = OFF`, which 065 does set, disables ENFORCEMENT. It does not stop the
 * rewrite. Only `PRAGMA legacy_alter_table = ON` does that, and 065 did not set it.
 *
 * The result: SELECTs are fine, and so is anything that only touches recurring_expense_rules -
 * which is why reminders still listed and Skip still worked. But an INSERT into
 * reminder_fulfillments has to resolve the key, and fails with
 * "no such table: main.recurring_expense_rules_old". That INSERT is the first statement of
 * fulfillReminder, so linking an expense to a reminder could never succeed.
 *
 * This affects fresh installs too, since 014 always runs before 065. 065 is fixed separately so
 * new databases never acquire the problem; this migration repairs the ones that already have it.
 *
 * THE REPAIR
 *
 * Rebuild the table with a correct key, preserving every row. legacy_alter_table is ON for our own
 * rename so this cannot repeat the mistake it is fixing.
 */
export default {
  version: 70,
  name: "repair_reminder_fulfillments_fk",
  up: async (db: SQLiteDatabase) => {
    const table = await db.getFirstAsync<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reminder_fulfillments';",
    );
    // Nothing to repair if the table is absent (069 recreates it) or the key is already correct.
    if (!table?.sql || !table.sql.includes("recurring_expense_rules_old")) return;

    await db.execAsync("PRAGMA foreign_keys = OFF;");
    await db.execAsync("PRAGMA legacy_alter_table = ON;");
    try {
      await db.execAsync(`
        ALTER TABLE reminder_fulfillments RENAME TO reminder_fulfillments_broken_fk;

        CREATE TABLE reminder_fulfillments (
          id TEXT PRIMARY KEY NOT NULL,
          rule_id TEXT NOT NULL REFERENCES recurring_expense_rules(id) ON DELETE CASCADE,
          expense_id TEXT NOT NULL UNIQUE,
          cycle_due_date TEXT NOT NULL,
          fulfilled_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT INTO reminder_fulfillments (id, rule_id, expense_id, cycle_due_date, fulfilled_at)
        SELECT id, rule_id, expense_id, cycle_due_date, fulfilled_at
        FROM reminder_fulfillments_broken_fk;

        DROP TABLE reminder_fulfillments_broken_fk;

        CREATE INDEX IF NOT EXISTS idx_reminder_fulfillments_rule
          ON reminder_fulfillments(rule_id, cycle_due_date DESC);
      `);
    } finally {
      await db.execAsync("PRAGMA legacy_alter_table = OFF;");
      await db.execAsync("PRAGMA foreign_keys = ON;");
    }
  },
};
