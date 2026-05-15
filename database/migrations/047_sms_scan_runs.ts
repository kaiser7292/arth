import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 047: SMS Scan Runs logging.
 *
 * Adds two new tables to track SMS scan history and details:
 *   - sms_scan_runs: High-level scan run metadata (timestamp, criteria, counts)
 *   - sms_scan_details: Per-SMS details (parse source, filter reason, etc.)
 *
 * This enables the "SMS Scan Runs" UI page where users can view scan history
 * and drill down into individual SMS to see how they were processed.
 */
export default {
  version: 47,
  name: "sms_scan_runs",
  up: async (db: SQLiteDatabase) => {
    // Create sms_scan_runs table
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sms_scan_runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        run_timestamp INTEGER NOT NULL,
        is_manual INTEGER NOT NULL,
        start_date TEXT,
        end_date TEXT,
        account_ids TEXT,
        sms_read_count INTEGER NOT NULL,
        sms_parsed_count INTEGER NOT NULL,
        sms_filtered_count INTEGER NOT NULL,
        sms_hardcoded_match_count INTEGER NOT NULL,
        sms_template_match_count INTEGER NOT NULL,
        sms_unrecognized_count INTEGER NOT NULL,
        sms_skipped_count INTEGER NOT NULL,
        expense_created_count INTEGER NOT NULL,
        credit_created_count INTEGER NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL
      );
    `);

    // Create index for querying scan runs by user and timestamp
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_sms_scan_runs_user_timestamp 
      ON sms_scan_runs(user_id, run_timestamp DESC);
    `);

    // Create sms_scan_details table
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sms_scan_details (
        id TEXT PRIMARY KEY,
        scan_run_id TEXT NOT NULL,
        sms_id TEXT NOT NULL,
        sms_address TEXT,
        sms_body TEXT,
        sms_date INTEGER,
        parse_source TEXT,
        parse_result TEXT,
        filter_reason TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (scan_run_id) REFERENCES sms_scan_runs(id) ON DELETE CASCADE
      );
    `);

    // Create index for querying details by scan run
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_sms_scan_details_run_id 
      ON sms_scan_details(scan_run_id);
    `);

    // Create index for querying details by parse source
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_sms_scan_details_parse_source 
      ON sms_scan_details(parse_source);
    `);
  },
};
