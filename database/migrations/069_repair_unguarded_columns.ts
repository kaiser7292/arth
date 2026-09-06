import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Repair columns that earlier migrations may have failed to add.
 *
 * SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, which is why CLAUDE.md's database
 * checklist requires every ALTER to sit behind a `PRAGMA table_info` guard. Seven migrations
 * predate that rule and add columns unguarded, several of them inside the same `execAsync` as a
 * CREATE TABLE:
 *
 *   010 expenses.purchase_group_id
 *   011 account_transfers.demat_target / investment_bucket_id / linked_contribution_id
 *   013 expenses.recurring_rule_id
 *   014 recurring_expense_rules.next_due_date, expenses.fulfills_rule_id
 *   042 simulation_entries.from_account_id / to_account_id
 *   043 loan_corrections.deleted_at
 *   067 smart_rules.applies_to
 *
 * A duplicate-column error on the first statement of such a batch aborts the whole batch, so
 * anything after it - including a CREATE TABLE - silently never runs. The result on the device is
 * "no such column" at runtime, long after the migration was recorded.
 *
 * This is the shape reported as "Couldn't link reminder. Something went wrong with your app data",
 * which is the message the app shows for exactly "no such table" / "no such column". I could not
 * reproduce which column is missing from source alone - every one of them is created by some
 * migration and listed in TABLE_SCHEMAS - so rather than guess, this restores all of them.
 *
 * On a healthy database every check below finds the column already present and does nothing.
 */
const COLUMNS: { table: string; column: string; type: string }[] = [
  { table: "expenses", column: "purchase_group_id", type: "TEXT" },
  { table: "expenses", column: "recurring_rule_id", type: "TEXT" },
  { table: "expenses", column: "fulfills_rule_id", type: "TEXT" },
  { table: "recurring_expense_rules", column: "next_due_date", type: "TEXT" },
  { table: "account_transfers", column: "demat_target", type: "TEXT" },
  { table: "account_transfers", column: "investment_bucket_id", type: "TEXT" },
  { table: "account_transfers", column: "linked_contribution_id", type: "TEXT" },
  { table: "simulation_entries", column: "from_account_id", type: "TEXT" },
  { table: "simulation_entries", column: "to_account_id", type: "TEXT" },
  { table: "loan_corrections", column: "deleted_at", type: "TEXT" },
  { table: "smart_rules", column: "applies_to", type: "TEXT" },
];

async function tableExists(db: SQLiteDatabase, table: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?;",
    table,
  );
  return !!row;
}

export default {
  version: 69,
  name: "repair_unguarded_columns",
  up: async (db: SQLiteDatabase) => {
    for (const { table, column, type } of COLUMNS) {
      if (!(await tableExists(db, table))) continue;
      const cols = await db.getAllAsync<{ name: string }>(
        `PRAGMA table_info(${table});`,
      );
      if (cols.some((c) => c.name === column)) continue;
      // One statement per runAsync: a failure here must not take its neighbours with it.
      await db.runAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
    }

    // 014 created this table in the same batch as its two unguarded ALTERs, so it is the one
    // most likely to have been skipped. IF NOT EXISTS makes this a no-op when it is present.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS reminder_fulfillments (
        id TEXT PRIMARY KEY NOT NULL,
        rule_id TEXT NOT NULL REFERENCES recurring_expense_rules(id) ON DELETE CASCADE,
        expense_id TEXT NOT NULL UNIQUE,
        cycle_due_date TEXT NOT NULL,
        fulfilled_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_reminder_fulfillments_rule
        ON reminder_fulfillments(rule_id, cycle_due_date DESC);
    `);
  },
};
