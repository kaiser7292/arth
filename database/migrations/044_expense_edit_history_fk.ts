import type { SQLiteDatabase } from "expo-sqlite";

/**
 * v17.5.x — Rebuild expense_edit_history with a proper REFERENCES FK
 * to expenses(id) ON DELETE CASCADE.
 *
 * SQLite does not support ALTER TABLE ADD CONSTRAINT, so we recreate the table
 * using the standard rename pattern:
 *   1. CREATE new table with FK
 *   2. INSERT ... SELECT from old table
 *   3. DROP old table
 *   4. RENAME new table
 *
 * Note: PRAGMA foreign_keys must be run outside transactions.
 */
export default {
  version: 44,
  name: "expense_edit_history_fk",
  up: async (db: SQLiteDatabase): Promise<void> => {
    // Check if old table exists
    const tableExists = await db.getFirstAsync<{ count: number }>(
      `SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='expense_edit_history';`
    );
    
    if (!tableExists || tableExists.count === 0) {
      // Table doesn't exist, just create it fresh with FK
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS expense_edit_history (
          id TEXT PRIMARY KEY NOT NULL,
          expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
          field_name TEXT NOT NULL,
          old_value TEXT,
          new_value TEXT,
          edited_at TEXT NOT NULL DEFAULT (datetime('now')),
          undone INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_edit_history_expense ON expense_edit_history(expense_id);
        CREATE INDEX IF NOT EXISTS idx_edit_history_date ON expense_edit_history(edited_at DESC);
      `);
      return;
    }

    // Table exists, need to migrate
    // PRAGMA foreign_keys must be outside transaction
    await db.execAsync(`PRAGMA foreign_keys = OFF;`);
    
    try {
      await db.withTransactionAsync(async () => {
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS expense_edit_history_new (
            id TEXT PRIMARY KEY NOT NULL,
            expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
            field_name TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            edited_at TEXT NOT NULL DEFAULT (datetime('now')),
            undone INTEGER NOT NULL DEFAULT 0
          );
        `);
        await db.execAsync(
          `INSERT INTO expense_edit_history_new SELECT id, expense_id, field_name, old_value, new_value, edited_at, undone FROM expense_edit_history;`
        );
        await db.execAsync(`DROP TABLE expense_edit_history;`);
        await db.execAsync(`ALTER TABLE expense_edit_history_new RENAME TO expense_edit_history;`);
        await db.execAsync(`
          CREATE INDEX IF NOT EXISTS idx_edit_history_expense ON expense_edit_history(expense_id);
          CREATE INDEX IF NOT EXISTS idx_edit_history_date ON expense_edit_history(edited_at DESC);
        `);
      });
    } finally {
      await db.execAsync(`PRAGMA foreign_keys = ON;`);
    }
  },
};
