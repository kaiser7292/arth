import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 052: Missing sms_template_patterns columns.
 *
 * TABLE_SCHEMAS.ts has long whitelisted `example_match`, `created_at`, and
 * `updated_at` for sms_template_patterns, but no migration ever actually
 * created them — migration 015's CREATE TABLE doesn't have them, and
 * neither 018 nor 021 (the two migrations that extend this table) add
 * them. On a fresh install the column never existed, so a restored backup
 * containing these fields would fail with "no such column" on insert.
 *
 * Idempotent via PRAGMA table_info guard.
 */
export default {
  version: 52,
  name: "sms_template_patterns_timestamps",
  up: async (db: SQLiteDatabase) => {
    const cols = (await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(sms_template_patterns);",
    )) as Array<{ name: string }>;
    const hasCol = (name: string) => cols.some((c) => c.name === name);

    if (!hasCol("example_match")) {
      await db.execAsync(
        "ALTER TABLE sms_template_patterns ADD COLUMN example_match TEXT;",
      );
    }
    if (!hasCol("created_at")) {
      await db.execAsync(
        "ALTER TABLE sms_template_patterns ADD COLUMN created_at TEXT DEFAULT (datetime('now'));",
      );
    }
    if (!hasCol("updated_at")) {
      await db.execAsync(
        "ALTER TABLE sms_template_patterns ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));",
      );
    }
    if (!hasCol("deleted_at")) {
      await db.execAsync(
        "ALTER TABLE sms_template_patterns ADD COLUMN deleted_at TEXT DEFAULT NULL;",
      );
    }
  },
};
