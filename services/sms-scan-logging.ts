/**
 * SMS Scan Logging Service
 *
 * Logs SMS scan runs and details to the database for the "SMS Scan Runs" UI.
 * This enables users to view scan history and drill down into individual SMS
 * to see how they were processed (hardcoded vs template match, filtered, etc.).
 */

import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { DEFAULT_USER_ID } from "@/constants/app";

export interface ScanRunInput {
  userId: string;
  isManual: boolean;
  startDate: string | null;
  endDate: string | null;
  accountIds: string[] | null;
  smsReadCount: number;
  smsParsedCount: number;
  smsFilteredCount: number;
  smsHardcodedMatchCount: number;
  smsTemplateMatchCount: number;
  smsUnrecognizedCount: number;
  smsSkippedCount: number;
  expenseCreatedCount: number;
  creditCreatedCount: number;
  errorMessage?: string;
}

export interface ScanDetailInput {
  scanRunId: string;
  smsId: string;
  smsAddress: string | null;
  smsBody: string;
  smsDate: number;
  parseSource: "hardcoded" | "template" | "unrecognized" | "skipped" | null;
  parseResult: string | null; // JSON string
  filterReason: string | null;
}

export interface ScanRun {
  id: string;
  user_id: string;
  run_timestamp: number;
  is_manual: number;
  start_date: string | null;
  end_date: string | null;
  account_ids: string | null;
  sms_read_count: number;
  sms_parsed_count: number;
  sms_filtered_count: number;
  sms_hardcoded_match_count: number;
  sms_template_match_count: number;
  sms_unrecognized_count: number;
  sms_skipped_count: number;
  expense_created_count: number;
  credit_created_count: number;
  error_message: string | null;
  created_at: string;
}

export interface ScanDetail {
  id: string;
  scan_run_id: string;
  sms_id: string;
  sms_address: string | null;
  sms_body: string;
  sms_date: number;
  parse_source: string | null;
  parse_result: string | null;
  filter_reason: string | null;
  created_at: string;
}

/**
 * Log a scan run to the database.
 * Returns the scan run ID.
 */
export async function logScanRun(input: ScanRunInput): Promise<string> {
  const db = getDatabase();
  const id = generateUUID();
  const now = new Date().toISOString();

  await db.runAsync(
    `INSERT INTO sms_scan_runs 
     (id, user_id, run_timestamp, is_manual, start_date, end_date, account_ids,
      sms_read_count, sms_parsed_count, sms_filtered_count,
      sms_hardcoded_match_count, sms_template_match_count,
      sms_unrecognized_count, sms_skipped_count,
      expense_created_count, credit_created_count, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    id,
    input.userId,
    Date.now(),
    input.isManual ? 1 : 0,
    input.startDate,
    input.endDate,
    input.accountIds ? JSON.stringify(input.accountIds) : null,
    input.smsReadCount,
    input.smsParsedCount,
    input.smsFilteredCount,
    input.smsHardcodedMatchCount,
    input.smsTemplateMatchCount,
    input.smsUnrecognizedCount,
    input.smsSkippedCount,
    input.expenseCreatedCount,
    input.creditCreatedCount,
    input.errorMessage ?? null,
    now,
  );

  return id;
}

/**
 * Log scan details (per-SMS) to the database.
 * Uses a transaction for efficiency when logging many SMS.
 */
export async function logScanDetails(details: ScanDetailInput[]): Promise<void> {
  if (details.length === 0) return;

  const db = getDatabase();
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    for (const detail of details) {
      const id = generateUUID();
      await db.runAsync(
        `INSERT INTO sms_scan_details 
         (id, scan_run_id, sms_id, sms_address, sms_body, sms_date,
          parse_source, parse_result, filter_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        id,
        detail.scanRunId,
        detail.smsId,
        detail.smsAddress,
        detail.smsBody,
        detail.smsDate,
        detail.parseSource,
        detail.parseResult,
        detail.filterReason,
        now,
      );
    }
  });
}

/**
 * Get all scan runs for a user, ordered by timestamp descending.
 */
export async function getScanRuns(userId: string = DEFAULT_USER_ID): Promise<ScanRun[]> {
  const db = getDatabase();
  return db.getAllAsync<ScanRun>(
    `SELECT * FROM sms_scan_runs
     WHERE user_id = ?
     ORDER BY run_timestamp DESC
     LIMIT 100;`,
    userId,
  );
}

/**
 * Get a specific scan run by ID.
 */
export async function getScanRun(scanRunId: string): Promise<ScanRun | null> {
  const db = getDatabase();
  return db.getFirstAsync<ScanRun>(
    `SELECT * FROM sms_scan_runs WHERE id = ?;`,
    scanRunId,
  );
}

/**
 * Get scan details for a specific scan run, optionally filtered by parse source.
 */
export async function getScanDetails(
  scanRunId: string,
  parseSource?: string,
): Promise<ScanDetail[]> {
  const db = getDatabase();

  if (parseSource) {
    return db.getAllAsync<ScanDetail>(
      `SELECT * FROM sms_scan_details
       WHERE scan_run_id = ? AND parse_source = ?
       ORDER BY sms_date DESC;`,
      scanRunId,
      parseSource,
    );
  }

  return db.getAllAsync<ScanDetail>(
    `SELECT * FROM sms_scan_details
     WHERE scan_run_id = ?
     ORDER BY sms_date DESC;`,
    scanRunId,
  );
}

/**
 * Get scan details grouped by parse source for a specific scan run.
 */
export async function getScanDetailsBySource(
  scanRunId: string,
): Promise<Record<string, number>> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ parse_source: string; count: number }>(
    `SELECT parse_source, COUNT(*) as count
     FROM sms_scan_details
     WHERE scan_run_id = ?
     GROUP BY parse_source;`,
    scanRunId,
  );

  const result: Record<string, number> = {};
  for (const row of rows) {
    if (row.parse_source) {
      result[row.parse_source] = row.count;
    }
  }
  return result;
}

/**
 * Delete a scan run and its details (cascade delete).
 */
export async function deleteScanRun(scanRunId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(`DELETE FROM sms_scan_runs WHERE id = ?;`, scanRunId);
}

/**
 * Clean up old scan runs (older than 90 days).
 */
export async function cleanupOldScanRuns(userId: string = DEFAULT_USER_ID): Promise<number> {
  const db = getDatabase();
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;

  const result = await db.runAsync(
    `DELETE FROM sms_scan_runs
     WHERE user_id = ? AND run_timestamp < ?;`,
    userId,
    ninetyDaysAgo,
  );

  return result.changes;
}
