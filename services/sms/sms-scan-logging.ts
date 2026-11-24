/**
 * SMS Scan Run logging service.
 *
 * Records pipeline metrics per scan (manual or auto) for the SMS Scan Runs UI.
 * Each scan produces one sms_scan_runs row + N sms_scan_details rows.
 *
 * Design decisions:
 * - sms_scan_details references pending_sms.id when available (no body duplication)
 * - Stores a 120-char body preview for display purposes (avoids JOIN overhead in list)
 * - Retention: 30 most recent runs kept per source (SMS scans and AI scans each keep their own 30,
 *   so a few AI test runs never push the SMS history out); older are purged on each new save
 * - source "ai": an on-device AI (Gemini Nano) scan from the AI lab. Its details use the ai_*
 *   categories and keep the AI's reading as JSON in ai_result (migration 096)
 */

import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { logger } from "@/utils/logger";

export type ScanDetailCategory =
  | "hardcoded"
  | "template"
  | "filtered"
  | "unrecognized"
  | "skipped"
  // On-device AI scans (source "ai"):
  | "ai_transaction"
  | "ai_not_money"
  | "ai_ignored"
  | "ai_rejected"
  | "ai_error";

export type ScanSource = "sms" | "ai";

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
  /** AI scans: the inbox message's id. */
  messageRef?: string | null;
  /** AI scans: the AI's reading (a ReadSmsOutcome), stored as JSON. */
  aiResult?: unknown;
  aiMs?: number | null;
  addedExpenseId?: string | null;
  addedNote?: string | null;
}

export interface ScanRunInput {
  userId: string;
  /** Default "sms". */
  source?: ScanSource;
  /** What an AI run was asked for, e.g. "Last 90 days · 50 messages". */
  label?: string | null;
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
  source: ScanSource;
  label: string | null;
  /** Messages per detail category, for the run's card without loading its details. */
  category_counts: Partial<Record<ScanDetailCategory, number>>;
  /** AI runs: messages added to Catch Up from this run. */
  added_count: number;
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
  message_ref: string | null;
  ai_result: string | null;
  ai_ms: number | null;
  added_expense_id: string | null;
  added_note: string | null;
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
          duration_ms, error, source, label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
        input.source ?? "sms",
        input.label ?? null,
      );

      if (input.details.length > 0) {
        const CHUNK_SIZE = 50;
        for (let i = 0; i < input.details.length; i += CHUNK_SIZE) {
          const chunk = input.details.slice(i, i + CHUNK_SIZE);
          const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
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
              d.messageRef ?? null,
              d.aiResult != null ? JSON.stringify(d.aiResult) : null,
              d.aiMs ?? null,
              d.addedExpenseId ?? null,
              d.addedNote ?? null,
            );
          }
          await db.runAsync(
            `INSERT INTO sms_scan_details (id, scan_run_id, pending_sms_id, sms_address,
              sms_body_preview, sms_date, category, matched_template_id, filter_reason,
              parsed_amount, parsed_merchant, parsed_type, applied_rule_ids,
              message_ref, ai_result, ai_ms, added_expense_id, added_note)
             VALUES ${placeholders};`,
            ...values,
          );
        }
      }
    });

    purgeOldRuns(input.userId, input.source ?? "sms").catch((e) =>
      logger.warn("Failed to purge old scan runs (non-fatal):", e),
    );
  } catch (e) {
    logger.warn("Failed to save scan run (non-fatal):", e);
  }

  return runId;
}

async function purgeOldRuns(userId: string, source: ScanSource): Promise<void> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM sms_scan_runs WHERE user_id = ? AND source = ?
     ORDER BY created_at DESC LIMIT -1 OFFSET ?;`,
    userId,
    source,
    MAX_RUNS_KEPT,
  );
  if (rows.length === 0) return;
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  // Details explicitly too: ON DELETE CASCADE only fires with foreign keys on.
  await db.runAsync(`DELETE FROM sms_scan_details WHERE scan_run_id IN (${placeholders});`, ...ids);
  await db.runAsync(
    `DELETE FROM sms_scan_runs WHERE id IN (${placeholders});`,
    ...ids,
  );
}

/** Newest first. Both sources by default: SMS and AI runs each keep 30, so the default fits both. */
export async function getScanRuns(userId: string, limit = 60, source?: ScanSource): Promise<ScanRunRow[]> {
  const db = getDatabase();
  const runs = await db.getAllAsync<Omit<ScanRunRow, "category_counts" | "added_count">>(
    `SELECT * FROM sms_scan_runs WHERE user_id = ?${source ? " AND source = ?" : ""}
     ORDER BY created_at DESC LIMIT ?;`,
    ...(source ? [userId, source, limit] : [userId, limit]),
  );
  if (runs.length === 0) return [];
  const ids = runs.map((r) => r.id);
  const marks = ids.map(() => "?").join(",");
  const counts = await db.getAllAsync<{ scan_run_id: string; category: ScanDetailCategory; n: number; added: number }>(
    `SELECT scan_run_id, category, COUNT(*) AS n,
            SUM(CASE WHEN added_expense_id IS NOT NULL THEN 1 ELSE 0 END) AS added
     FROM sms_scan_details WHERE scan_run_id IN (${marks})
     GROUP BY scan_run_id, category;`,
    ...ids,
  );
  const byRun = new Map<string, { cats: Partial<Record<ScanDetailCategory, number>>; added: number }>();
  for (const c of counts) {
    const entry = byRun.get(c.scan_run_id) ?? { cats: {}, added: 0 };
    entry.cats[c.category] = c.n;
    entry.added += c.added ?? 0;
    byRun.set(c.scan_run_id, entry);
  }
  return runs.map((r) => ({
    ...r,
    source: (r.source ?? "sms") as ScanSource,
    category_counts: byRun.get(r.id)?.cats ?? {},
    added_count: byRun.get(r.id)?.added ?? 0,
  }));
}

/** An AI-read message was added to Catch Up (or Arth declined it): record it on its history row. */
export async function markScanDetailAdded(
  scanRunId: string,
  messageRef: string,
  added: { expenseId: string | null; note: string | null },
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE sms_scan_details SET added_expense_id = ?, added_note = ?
     WHERE scan_run_id = ? AND message_ref = ?;`,
    added.expenseId,
    added.note,
    scanRunId,
    messageRef,
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
  await db.runAsync(`DELETE FROM sms_scan_details WHERE scan_run_id = ?;`, scanRunId);
  await db.runAsync(`DELETE FROM sms_scan_runs WHERE id = ?;`, scanRunId);
}
