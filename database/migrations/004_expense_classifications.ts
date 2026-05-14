import type { SQLiteDatabase } from "expo-sqlite";

export default {
  version: 4,
  name: "004_expense_classifications",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS expense_classifications (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        merchant_normalized TEXT NOT NULL,
        category_id TEXT,
        amount_range_low REAL NOT NULL DEFAULT 0,
        amount_range_high REAL NOT NULL DEFAULT 0,
        classification TEXT NOT NULL DEFAULT 'variable',
        frequency TEXT,
        expected_day_of_month INTEGER,
        confidence REAL NOT NULL DEFAULT 0.5,
        source TEXT NOT NULL DEFAULT 'auto_detected',
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        last_seen_date TEXT NOT NULL,
        last_confirmed_date TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        deactivated_reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_ec_user_active
        ON expense_classifications(user_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_ec_merchant
        ON expense_classifications(user_id, merchant_normalized);
    `);
  },
};
