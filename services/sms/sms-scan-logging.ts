/**
 * SMS Scan Run logging service.
 *
 * Records pipeline metrics per scan (manual or auto) for the SMS Scan Runs UI.
 * Each scan produces one sms_scan_runs row + N sms_scan_details rows.
 *
 * Design decisions:
 * - sms_scan_details references pending_sms.id when available (no body duplication)
 * - Stores a 120-char body preview for display purposes (avoids JOIN overhead in list)
 * - Retention: 30 most recent runs kept; older are purged on each new save
 */

import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { logger } from "@/utils/logger";

export type ScanDetailCategory =
  | "hardcoded"
  | "template"
  | "filtered"
  | "unrecognized"
  | "skipped";

export interface ScanDetail {
  pendingSmsId?: string | null;
  smsAddress?: string | null;
  smsBodyPreview?: string | null;
  smsDate?: number | null;
  category: ScanDetailCategory;
  matchedTemplateId?: string | null;
  filterReason?: string | null;
  parsedAmount?: number | null;
  parsedMerchant?: string | null;
  parsedType?: string | null;
  appliedRuleIds?: string[] | null;
}

export interface ScanRunInput {
  userId: string;
  isManual: boolean;
  startDate?: string | null;
  endDate?: string | null;
  accountIds?: string[] | null;
  smsReadCount: number;
  hardcodedMatchCount: number;
  templateMatchCount: number;
  filteredCount: number;
  unrecognizedCount: number;
  skippedCount: number;
  expenseCreatedCount: number;
  creditCreatedCount: number;
  durationMs?: number | null;
  error?: string | null;
  details: ScanDetail[];
}

export interface ScanRunRow {
  id: string;
  user_id: string;
  is_manual: number;
  start_date: string | null;
  end_date: string | null;
  account_ids: string | null;
  sms_read_count: number;
  hardcoded_match_count: number;
  template_match_count: number;
  filtered_count: number;
  unrecognized_count: number;
  skipped_count: number;
  expense_created_count: number;
  credit_created_count: number;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}

export interface ScanDetailRow {
  id: string;
  scan_run_id: string;
  pending_sms_id: string | null;
  sms_address: string | null;
  sms_body_preview: string | null;
  sms_date: number | null;
  category: string;
  matched_template_id: string | null;
  filter_reason: string | null;
  parsed_amount: number | null;
  parsed_merchant: string | null;
  parsed_type: string | null;
  /** JSON-encoded array of smart rule IDs that fired for this SMS. */
  applied_rule_ids: string | null;
  created_at: string;
}

const MAX_RUNS_KEPT = 30;
const BODY_PREVIEW_LENGTH = 500;

function truncateBody(body: string | null | undefined): string | null {
  if (!body) return null;
  return body.length > BODY_PREVIEW_LENGTH
    ? body.slice(0, BODY_PREVIEW_LENGTH) + "…"
    : body;
}

export async function saveScanRun(input: ScanRunInput): Promise<string> {
  const db = getDatabase();
  const runId = generateUUID();

  try {
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `INSERT INTO sms_scan_runs (id, user_id, is_manual, start_date, end_date, account_ids,
          sms_read_count, hardcoded_match_count, template_match_count, filtered_count,
          unrecognized_count, skipped_count, expense_created_count, credit_created_count,
          duration_ms, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        runId,
        input.userId,
        input.isManual ? 1 : 0,
        input.startDate ?? null,
        input.endDate ?? null,
        input.accountIds && input.accountIds.length > 0
          ? JSON.stringify(input.accountIds)
          : null,
        input.smsReadCount,
        input.hardcodedMatchCount,
        input.templateMatchCount,
        input.filteredCount,
        input.unrecognizedCount,
        input.skippedCount,
        input.expenseCreatedCount,
        input.creditCreatedCount,
        input.durationMs ?? null,
        input.error ?? null,
      );

      if (input.details.length > 0) {
        const CHUNK_SIZE = 50;
        for (let i = 0; i < input.details.length; i += CHUNK_SIZE) {
          const chunk = input.details.slice(i, i + CHUNK_SIZE);
          const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
          const values: (string | number | null)[] = [];
          for (const d of chunk) {
            values.push(
              generateUUID(),
              runId,
              d.pendingSmsId ?? null,
              d.smsAddress ?? null,
              truncateBody(d.smsBodyPreview),
              d.smsDate ?? null,
              d.category,
              d.matchedTemplateId ?? null,
              d.filterReason ?? null,
              d.parsedAmount ?? null,
              d.parsedMerchant ?? null,
              d.parsedType ?? null,
              d.appliedRuleIds && d.appliedRuleIds.length > 0 ? JSON.stringify(d.appliedRuleIds) : null,
            );
          }
          await db.runAsync(
            `INSERT INTO sms_scan_details (id, scan_run_id, pending_sms_id, sms_address,
              sms_body_preview, sms_date, category, matched_template_id, filter_reason,
              parsed_amount, parsed_merchant, parsed_type, applied_rule_ids)
             VALUES ${placeholders};`,
            ...values,
          );
        }
      }
    });

    purgeOldRuns(input.userId).catch((e) =>
      logger.warn("Failed to purge old scan runs (non-fatal):", e),
    );
  } catch (e) {
    logger.warn("Failed to save scan run (non-fatal):", e);
  }

  return runId;
}

async function purgeOldRuns(userId: string): Promise<void> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM sms_scan_runs WHERE user_id = ?
     ORDER BY created_at DESC LIMIT -1 OFFSET ?;`,
    userId,
    MAX_RUNS_KEPT,
  );
  if (rows.length === 0) return;
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  await db.runAsync(
    `DELETE FROM sms_scan_runs WHERE id IN (${placeholders});`,
    ...ids,
  );
}

export async function getScanRuns(userId: string, limit = 30): Promise<ScanRunRow[]> {
  const db = getDatabase();
  return db.getAllAsync<ScanRunRow>(
    `SELECT * FROM sms_scan_runs WHERE user_id = ?
     ORDER BY created_at DESC LIMIT ?;`,
    userId,
    limit,
  );
}

export async function getScanRunDetails(
  scanRunId: string,
): Promise<ScanDetailRow[]> {
  const db = getDatabase();
  return db.getAllAsync<ScanDetailRow>(
    `SELECT * FROM sms_scan_details WHERE scan_run_id = ?
     ORDER BY category, sms_date DESC;`,
    scanRunId,
  );
}

export async function deleteScanRun(scanRunId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(`DELETE FROM sms_scan_runs WHERE id = ?;`, scanRunId);
}
