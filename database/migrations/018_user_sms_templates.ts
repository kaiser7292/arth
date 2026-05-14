import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 018: User-authored SMS templates.
 *
 * Extends sms_template_patterns (migration 015) with four additive columns
 * so users can teach Artha to parse SMS from banks the app doesn't
 * hardcode. Existing system-seeded rows get `source='system'` by default.
 *
 * New columns:
 *   - source TEXT NOT NULL DEFAULT 'system'  — 'system' | 'user'
 *   - user_id TEXT                            — NULL for system, the owner id for user rows
 *   - sample_sms TEXT                         — one real SMS that generated the template, for audit + edit
 *   - created_from_sms_id TEXT                — pending_sms.id if template was born from Review Queue
 *
 * Matcher precedence: system rows still run first (priority ASC), then
 * user rows. User templates can never override a working hardcoded parse.
 */
export default {
  version: 18,
  name: "user_sms_templates",
  up: async (db: SQLiteDatabase) => {
    // sms_template_patterns already exists from migration 015. We add
    // columns via ALTER TABLE — idempotent guard via PRAGMA table_info so
    // re-running this migration never fails.
    const cols = (await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(sms_template_patterns);",
    )) as Array<{ name: string }>;
    const hasCol = (name: string) => cols.some((c) => c.name === name);

    if (!hasCol("source")) {
      await db.execAsync(
        "ALTER TABLE sms_template_patterns ADD COLUMN source TEXT NOT NULL DEFAULT 'system';",
      );
    }
    if (!hasCol("user_id")) {
      await db.execAsync(
        "ALTER TABLE sms_template_patterns ADD COLUMN user_id TEXT;",
      );
    }
    if (!hasCol("sample_sms")) {
      await db.execAsync(
        "ALTER TABLE sms_template_patterns ADD COLUMN sample_sms TEXT;",
      );
    }
    if (!hasCol("created_from_sms_id")) {
      await db.execAsync(
        "ALTER TABLE sms_template_patterns ADD COLUMN created_from_sms_id TEXT;",
      );
    }

    // New index on source so the matcher can cheaply filter user rows
    // without scanning the whole table.
    await db.execAsync(
      "CREATE INDEX IF NOT EXISTS idx_sms_templates_source ON sms_template_patterns(source);",
    );
  },
};
