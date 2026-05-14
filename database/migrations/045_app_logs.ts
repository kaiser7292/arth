import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 045: Create app_logs table for production crash/error logging.
 * Rolling window — only the most recent 200 rows are kept (enforced in writeAppLog).
 */
export default {
  version: 45,
  name: "app_logs",
  up: async (db: SQLiteDatabase): Promise<void> => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS app_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        context TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_app_logs_created ON app_logs(created_at DESC);
    `);
  },
};
