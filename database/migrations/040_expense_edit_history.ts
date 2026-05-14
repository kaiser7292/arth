import type { SQLiteDatabase } from "expo-sqlite";

export default {
  version: 40,
  name: "040_expense_edit_history",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS expense_edit_history (
        id TEXT PRIMARY KEY NOT NULL,
        expense_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        edited_at TEXT NOT NULL DEFAULT (datetime('now')),
        undone INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_edit_history_expense ON expense_edit_history(expense_id);
      CREATE INDEX IF NOT EXISTS idx_edit_history_date ON expense_edit_history(edited_at DESC);
    `);
  },
};
