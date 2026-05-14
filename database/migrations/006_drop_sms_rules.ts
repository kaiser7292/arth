import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 006: Drop the sms_rules table.
 *
 * The table was created by migration 001 but never read or written by any service.
 * No FKs reference it (verified via grep) — safe to drop.
 * Idempotent via IF EXISTS.
 */
export default {
  version: 6,
  name: "drop_sms_rules",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`DROP TABLE IF EXISTS sms_rules;`);
  },
};
