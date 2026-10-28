import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 089 — the other members' categories, as I've mapped them.
 *
 * When someone in my household files a shared bill under a category I don't have ("Pets"), I can
 * map it to one of mine or create it; "Paid by …" shares of their bills then go there.
 * local_category_id NULL = not decided yet. Deleting my category clears the row
 * (services/category.ts, data-cleanup.ts).
 *
 * Idempotent: IF NOT EXISTS.
 */
export const migration: Migration = {
  version: 89,
  name: "household_their_categories",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS household_their_categories (
        household_id TEXT NOT NULL REFERENCES households(id),
        name TEXT NOT NULL,
        local_category_id TEXT REFERENCES categories(id),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (household_id, name)
      );
    `);
  },
};

export default migration;
