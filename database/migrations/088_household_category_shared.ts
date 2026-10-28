import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 088 — household categories: mapping and "shared by default" are now separate.
 *
 * The household's category list is Arth's default categories (so everyone's defaults map by name),
 * and shared_default marks the ones whose spends are shared and split as they're approved (Rent &
 * Utilities, Grocery & Supplies to start with). Existing rows keep behaving as before: shared (1).
 *
 * Idempotent: the column add is guarded.
 */
export const migration: Migration = {
  version: 88,
  name: "household_category_shared",
  up: async (db: SQLiteDatabase) => {
    const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(household_categories);");
    if (!cols.some((c) => c.name === "shared_default")) {
      await db.execAsync("ALTER TABLE household_categories ADD COLUMN shared_default INTEGER NOT NULL DEFAULT 1;");
    }
  },
};

export default migration;
