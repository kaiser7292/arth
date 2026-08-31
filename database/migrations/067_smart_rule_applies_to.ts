import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 067: Add `applies_to` column to smart_rules.
 *
 * Values: 'expense' (default, matches realized debits only),
 *         'credit'  (matches income/refund credits only),
 *         'any'     (matches both).
 *
 * Existing rules default to 'expense' so their current behaviour is unchanged.
 */
export default {
  version: 67,
  name: "smart_rule_applies_to",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      ALTER TABLE smart_rules ADD COLUMN applies_to TEXT NOT NULL DEFAULT 'expense';
    `);
  },
};
