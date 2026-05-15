import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 047: SMS Scan Runs logging tables.
 *
 * Two tables:
 * - sms_scan_runs: one row per scan (manual or auto), captures pipeline counts
 * - sms_scan_details: per-SMS classification within a scan run, references
 *   pending_sms.id to avoid duplicating body/address/date
 */
export default {
  version: 47,
  name: "sms_scan_runs",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sms_scan_runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        is_manual INTEGER NOT NULL DEFAULT 0,
        start_date TEXT,
        end_date TEXT,
        account_ids TEXT,
        sms_read_count INTEGER NOT NULL DEFAULT 0,
        hardcoded_match_count INTEGER NOT NULL DEFAULT 0,
        template_match_count INTEGER NOT NULL DEFAULT 0,
        filtered_count INTEGER NOT NULL DEFAULT 0,
        unrecognized_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        expense_created_count INTEGER NOT NULL DEFAULT 0,
        credit_created_count INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sms_scan_details (
        id TEXT PRIMARY KEY,
        scan_run_id TEXT NOT NULL,
        pending_sms_id TEXT,
        sms_address TEXT,
        sms_body_preview TEXT,
        sms_date INTEGER,
        category TEXT NOT NULL,
        matched_template_id TEXT,
        filter_reason TEXT,
        parsed_amount REAL,
        parsed_merchant TEXT,
        parsed_type TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (scan_run_id) REFERENCES sms_scan_runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_scan_details_run
        ON sms_scan_details(scan_run_id);

      CREATE INDEX IF NOT EXISTS idx_scan_runs_created
        ON sms_scan_runs(created_at);
    `);
  },
};
