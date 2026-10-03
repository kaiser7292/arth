import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 079 — merchant_mappings.match_mode.
 *
 * Keyword rules have always matched anywhere inside the merchant name ("contains"), which suits
 * app brands that SMS glue to other text (PYU*SWIGGY, SWIGGYINSTAMART). Store brands imported from
 * OpenStreetMap's Name Suggestion Index include short everyday words (More, Metro, Liberty) that
 * would match far too much that way, so they use 'word': the keyword must stand as whole words.
 *
 * Idempotent via PRAGMA table_info guard (plain ALTER, matches migration 078).
 */
export const migration: Migration = {
  version: 79,
  name: "merchant_mapping_match_mode",
  up: async (db: SQLiteDatabase) => {
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(merchant_mappings);`);
    if (!columns.some((c) => c.name === "match_mode")) {
      await db.execAsync(`ALTER TABLE merchant_mappings ADD COLUMN match_mode TEXT NOT NULL DEFAULT 'contains';`);
    }
  },
};

export default migration;
