import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 096 - one Scan history for SMS and on-device AI scans.
 *
 * sms_scan_runs:
 *   source  - "sms" (the pattern/template scan, every row before this) or "ai" (Gemini Nano).
 *   label   - what an AI run was asked for, e.g. "Last 90 days · 50 messages".
 *
 * sms_scan_details (AI rows; NULL on SMS rows):
 *   message_ref       - the inbox message's id, so "Add to Catch Up" can find its row later.
 *   ai_result         - the AI's reading as JSON (the ReadSmsOutcome), for the detail card and
 *                       for adding it to Catch Up from the history.
 *   ai_ms             - how long the model took on this message.
 *   added_expense_id  - the Catch Up transaction made from it, once added.
 *   added_note        - why nothing was added, when Arth declined it.
 *
 * Idempotent: PRAGMA table_info guards.
 */
async function addColumn(db: SQLiteDatabase, table: string, column: string, ddl: string): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table});`);
  if (!cols.some((c) => c.name === column)) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`);
  }
}

export const migration: Migration = {
  version: 96,
  name: "scan_history_ai",
  up: async (db: SQLiteDatabase) => {
    await addColumn(db, "sms_scan_runs", "source", "TEXT NOT NULL DEFAULT 'sms'");
    await addColumn(db, "sms_scan_runs", "label", "TEXT");
    await addColumn(db, "sms_scan_details", "message_ref", "TEXT");
    await addColumn(db, "sms_scan_details", "ai_result", "TEXT");
    await addColumn(db, "sms_scan_details", "ai_ms", "INTEGER");
    await addColumn(db, "sms_scan_details", "added_expense_id", "TEXT");
    await addColumn(db, "sms_scan_details", "added_note", "TEXT");
  },
};

export default migration;
