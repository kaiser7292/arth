import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 095 - sub-categories (docs/TRANSACTIONS_DESIGN_SYSTEM_PLAN.md, section 6).
 *
 * categories.parent_id: the category this one sits under, or NULL for a top-level category.
 * One level only - a sub-category never has sub-categories of its own (enforced in
 * services/category.ts, not here). Every existing category stays top-level, so nothing changes
 * until a sub-category is added. Budgets count a sub-category's spending toward its parent.
 *
 * No REFERENCES clause: restore inserts with foreign keys off in table order, and deleting a parent
 * moves its sub-categories up (parent_id = NULL) in the service, which a cascade would get wrong.
 *
 * Idempotent: PRAGMA table_info guard.
 */
export const migration: Migration = {
  version: 95,
  name: "category_parent",
  up: async (db: SQLiteDatabase) => {
    const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(categories);");
    if (!cols.some((c) => c.name === "parent_id")) {
      await db.execAsync("ALTER TABLE categories ADD COLUMN parent_id TEXT;");
    }
    await db.execAsync("CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);");
  },
};

export default migration;
