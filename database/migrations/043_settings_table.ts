import type { Migration } from "./index";

/**
 * Migration 043: Create settings table
 *
 * A proper key-value settings table for per-user app configuration.
 * Used by the notification collector and potentially other features.
 */
const migration043: Migration = {
  version: 43,
  name: "settings_table",
  up: async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS settings (
        user_id INTEGER NOT NULL DEFAULT 1,
        key TEXT NOT NULL,
        value TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, key)
      );
    `);

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_settings_user_key
      ON settings(user_id, key);
    `);
  },
};

export default migration043;
