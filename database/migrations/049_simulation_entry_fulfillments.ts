import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 049: Multi-transaction linking for simulator entries.
 *
 * Adds a junction table so a single planned entry can be fulfilled by
 * multiple real transactions (e.g., rent split into two payments).
 * The existing `fulfilled_expense_id` column on simulation_entries is
 * kept for backward compat — new code reads from this junction table
 * with a fallback to the legacy column.
 */
export default {
  version: 49,
  name: "simulation_entry_fulfillments",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS simulation_entry_fulfillments (
        id TEXT PRIMARY KEY NOT NULL,
        entry_id TEXT NOT NULL REFERENCES simulation_entries(id) ON DELETE CASCADE,
        expense_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_sef_entry ON simulation_entry_fulfillments(entry_id);
      CREATE INDEX IF NOT EXISTS idx_sef_expense ON simulation_entry_fulfillments(expense_id);
    `);
  },
};
