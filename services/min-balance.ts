/**
 * v15.5.0 — Savings account min-balance breach detection + acknowledgement.
 *
 * Pure detection logic + device-local MMKV for per-month acks. The detector
 * reads pre-computed balances (that the Home screen already loads) so it
 * never introduces its own DB round-trips.
 *
 * Design principles:
 *   - Savings-only. CC, wallet, loan, demat are filtered out.
 *   - min_balance = 0 means feature off for that account (default).
 *   - Null computed balance = skip (no meaningful signal).
 *   - Ack is per-account, per-month. Key: `min_balance_ack_${id}_${YYYY-MM}`.
 *   - NOT included in backup — ack state and min_balance config are
 *     semantically different: min_balance travels (it's on financial_accounts
 *     which is in BACKUP_TABLES), ack state stays on-device.
 *
 * See also: docs/internal/2026-04-30_v15.5-sms-template-tagger-plan.md.
 */

import type { FinancialAccount } from "@/services/financial-account";
import { minBalanceAcksStorage as storage } from "@/services/storage";

export interface BreachedAccount {
  account: FinancialAccount;
  currentBalance: number;
  threshold: number;
  /** Positive number — how far below min the balance is. */
  shortfall: number;
}

/**
 * Find all savings accounts whose current balance is below their
 * user-configured min_balance. Pure function — caller feeds in the
 * accounts and a precomputed balance map (e.g. from getComputedBalances).
 */
export function detectBreaches(
  accounts: FinancialAccount[],
  balances: Record<string, number | null>,
): BreachedAccount[] {
  const result: BreachedAccount[] = [];
  for (const a of accounts) {
    if (a.account_type !== "savings") continue;
    if (a.min_balance == null || a.min_balance <= 0) continue;
    const bal = balances[a.id];
    if (bal == null) continue;
    if (bal < a.min_balance) {
      result.push({
        account: a,
        currentBalance: bal,
        threshold: a.min_balance,
        shortfall: a.min_balance - bal,
      });
    }
  }
  return result;
}

// ─── Per-month acknowledgement (MMKV, device-local) ───

function ackKey(accountId: string, monthYYYYMM: string): string {
  return `min_balance_ack_${accountId}_${monthYYYYMM}`;
}

export function isAcknowledged(accountId: string, monthYYYYMM: string): boolean {
  return storage.getBoolean(ackKey(accountId, monthYYYYMM)) ?? false;
}

export function acknowledgeBreach(
  accountId: string,
  monthYYYYMM: string,
): void {
  storage.set(ackKey(accountId, monthYYYYMM), true);
}

/**
 * Remove the ack (e.g. if the user wants the alert back). Not wired into
 * UI yet; exported for completeness so future "undo dismiss" flows can use it.
 */
export function clearAcknowledgement(
  accountId: string,
  monthYYYYMM: string,
): void {
  storage.delete(ackKey(accountId, monthYYYYMM));
}

/**
 * Filter a list of breaches to only those the user hasn't ack'd yet for
 * this month. Convenience composition of detectBreaches + isAcknowledged.
 */
export function unacknowledgedBreaches(
  breaches: BreachedAccount[],
  monthYYYYMM: string,
): BreachedAccount[] {
  return breaches.filter((b) => !isAcknowledged(b.account.id, monthYYYYMM));
}
