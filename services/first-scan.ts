/**
 * First-run scan: right after SMS permission in onboarding, read the last 1/3/6 months of bank
 * SMS and show "Here's your money" — accounts found, money in/out, top spend, upcoming dues,
 * FDs and transfers spotted, and how much is waiting for review.
 *
 * The scan gets FIRST_SCAN_WAIT_MS on screen; a phone with years of SMS keeps scanning after
 * onboarding moves on, and the summary appears once as a Home card when it finishes.
 */

import { getDatabase } from "@/database";
import { setSmsStartDate } from "@/services/sms/sms-permissions";
import { settingsStorage } from "@/services/storage";
import { bumpDataVersion } from "@/services/settings";
import { formatLocalDate } from "@/utils/fiscal-year";
import { logger } from "@/utils/logger";

export type LookbackMonths = 1 | 3 | 6;
export const DEFAULT_LOOKBACK: LookbackMonths = 3;
/** How long onboarding waits on the scan before letting it finish in the background. */
export const FIRST_SCAN_WAIT_MS = 45_000;

/** Set when a first scan outlived onboarding: the summary's start date, shown once on Home. */
const FIRST_SCAN_SUMMARY_PENDING_KEY = "first_scan_summary_pending";

/** First day the scan reads from: same day-of-month, `months` back. */
export function lookbackStartDate(months: LookbackMonths, today: Date = new Date()): string {
  const d = new Date(today.getFullYear(), today.getMonth() - months, today.getDate());
  return formatLocalDate(d);
}

export interface FirstScanSummary {
  since: string;
  accountsFound: number;
  moneyIn: number;
  moneyOut: number;
  topMerchant: { name: string; amount: number } | null;
  nextDue: { label: string; dueDate: string; amount: number } | null;
  fdsAndTransfers: number;
  toReview: number;
}

export async function buildFirstScanSummary(userId: string, since: string): Promise<FirstScanSummary> {
  const db = getDatabase();
  const today = formatLocalDate(new Date());
  const live = `user_id = ? AND deleted_at IS NULL AND status != 'rejected' AND date >= ?`;
  const notTransfer = `(reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)`;

  const [accounts, inRow, outRow, top, due, events, review] = await Promise.all([
    db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM financial_accounts WHERE user_id = ? AND is_active = 1 AND closed_at IS NULL;`,
      userId,
    ),
    db.getFirstAsync<{ total: number | null }>(
      `SELECT SUM(amount) AS total FROM expenses WHERE ${live} AND nature = 'credit' AND ${notTransfer}
         AND (money_event IS NULL OR money_event NOT IN ('fd_closure', 'self_transfer'));`,
      userId,
      since,
    ),
    db.getFirstAsync<{ total: number | null }>(
      `SELECT SUM(amount) AS total FROM expenses WHERE ${live} AND nature = 'realized' AND ${notTransfer}
         AND (money_event IS NULL OR money_event NOT IN ('fd_open', 'self_transfer', 'sip'));`,
      userId,
      since,
    ),
    db.getFirstAsync<{ name: string; amount: number }>(
      `SELECT merchant_name AS name, SUM(amount) AS amount FROM expenses
        WHERE ${live} AND nature = 'realized' AND ${notTransfer} AND merchant_name IS NOT NULL AND merchant_name != ''
          AND money_event IS NULL
        GROUP BY merchant_name ORDER BY amount DESC LIMIT 1;`,
      userId,
      since,
    ),
    db.getFirstAsync<{ label: string | null; due_date: string; amount: number }>(
      `SELECT COALESCE(description, merchant_name) AS label, due_date, amount FROM expenses
        WHERE user_id = ? AND deleted_at IS NULL AND status != 'rejected' AND nature = 'forecast'
          AND due_date >= ?
        ORDER BY due_date ASC LIMIT 1;`,
      userId,
      today,
    ),
    db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM expenses WHERE ${live}
         AND (money_event IS NOT NULL OR reclassified_as_transfer = 1);`,
      userId,
      since,
    ),
    db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM expenses WHERE user_id = ? AND deleted_at IS NULL AND status = 'pending_review';`,
      userId,
    ),
  ]);

  return {
    since,
    accountsFound: accounts?.n ?? 0,
    moneyIn: Math.round((inRow?.total ?? 0) * 100) / 100,
    moneyOut: Math.round((outRow?.total ?? 0) * 100) / 100,
    topMerchant: top ? { name: top.name, amount: Math.round(top.amount * 100) / 100 } : null,
    nextDue: due ? { label: due.label ?? "Payment due", dueDate: due.due_date, amount: due.amount } : null,
    fdsAndTransfers: events?.n ?? 0,
    toReview: review?.n ?? 0,
  };
}

/**
 * Start the first scan from `since`. Resolves "done" when it finished within the wait, or
 * "background" when it's still running — it carries on, and when it completes the summary is
 * queued for Home (getPendingFirstScanSummary).
 */
export async function runFirstScan(
  since: string,
  scan: () => Promise<unknown>,
  waitMs: number = FIRST_SCAN_WAIT_MS,
): Promise<"done" | "background"> {
  setSmsStartDate(since);
  let finished = false;
  const work = scan()
    .catch((e) => logger.warn("First scan failed (non-fatal):", e))
    .finally(() => {
      finished = true;
    });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"background">((resolve) => {
    timer = setTimeout(() => resolve("background"), waitMs);
  });
  const outcome = await Promise.race([work.then(() => "done" as const), timeout]);
  if (timer) clearTimeout(timer);
  if (outcome === "background" && !finished) {
    void work.then(() => {
      settingsStorage.set(FIRST_SCAN_SUMMARY_PENDING_KEY, since);
      bumpDataVersion();
    });
  }
  return outcome;
}

export function getPendingFirstScanSince(): string | null {
  return settingsStorage.getString(FIRST_SCAN_SUMMARY_PENDING_KEY) ?? null;
}

export function clearPendingFirstScanSummary(): void {
  settingsStorage.delete(FIRST_SCAN_SUMMARY_PENDING_KEY);
  bumpDataVersion();
}
