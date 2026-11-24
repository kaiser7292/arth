import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 097 - on-device AI reads the messages Arth's patterns and templates can't
 * (docs/GEMINI_NANO_PROPOSAL.md, Phase 1).
 *
 * expenses:
 *   parse_source - "ai" when Gemini Nano read the message this transaction came from. NULL for
 *                  everything else (pattern, template, manual), so existing rows need no backfill.
 *   ai_fields    - JSON list of what the AI filled ("amount", "merchant", "account", "event"...),
 *                  for the "Read by AI" mark in Catch Up.
 *
 * pending_sms:
 *   ai_status - where an unrecognised message is with the AI: "queued" (waiting for Arth to be
 *               open), then "added", "not_txn", "ignored", "rejected", "duplicate", "retry" (failed
 *               once, read again later) or "error".
 *               NULL: not for the AI (read by a pattern, or the AI was off).
 *
 * One guarded ALTER per statement; idempotent through PRAGMA table_info.
 */
async function addColumn(db: SQLiteDatabase, table: string, column: string, ddl: string): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table});`);
  if (!cols.some((c) => c.name === column)) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`);
  }
}

export const migration: Migration = {
  version: 97,
  name: "ai_reading",
  up: async (db: SQLiteDatabase) => {
    await addColumn(db, "expenses", "parse_source", "TEXT");
    await addColumn(db, "expenses", "ai_fields", "TEXT");
    await addColumn(db, "pending_sms", "ai_status", "TEXT");
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_pending_sms_ai_status ON pending_sms(user_id, ai_status) WHERE ai_status IS NOT NULL;`,
    );
  },
};

export default migration;
