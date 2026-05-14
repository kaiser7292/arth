/**
 * Balance Source — helpers for "where did this account's auto-detected balance
 * come from?" and "is there a newer SMS we should apply?"
 *
 * Powers the Balance Source card on account-detail + the silent auto-apply
 * that runs on every account-detail focus.
 */

import { getDatabase } from "@/database";
import { parseBankSMS } from "@/services/sms/bank-patterns";
import type { FinancialAccount } from "@/services/financial-account";
import { updateAccountFromSMS } from "@/services/financial-account";
import { getMonthBalanceSummary, isAccountSeeded } from "@/services/account-balance";
import { formatLocalDate } from "@/utils/fiscal-year";

export interface PendingSmsRow {
  id: string;
  sms_id: string;
  address: string;
  body: string;
  sms_date: number; // epoch ms
  status: "pending" | "processed" | "ignored" | "failed";
}

export interface BalanceSourceInfo {
  /** The "authoritative" number — derived from the ledger. */
  calculatedBalance: number | null;
  /** Latest SMS-reported balance (may be stale). */
  autoDetectedBalance: number | null;
  /** Date of the SMS that supplied autoDetectedBalance ("YYYY-MM-DD"). */
  autoDetectedDate: string | null;
  /** The source SMS row (null if we don't have a reference stored or it's been purged). */
  sourceSms: PendingSmsRow | null;
  /** True when a payment/credit was recorded after the last balance SMS
   *  across this account + its shared-pool siblings. When stale, the UI
   *  crosses out auto-detected and trusts calculated. */
  isStale: boolean;
  /** Siblings in the shared credit-limit pool (empty for non-CC / standalone). */
  poolSiblingIds: string[];
  /** For pool accounts: the sibling id that actually supplied the latest balance. */
  sourceAccountId: string;
}

/**
 * Identify shared-pool siblings for a CC account.
 * Grouping rule matches credit-cards.tsx: same bank_name, CC type, active.
 * Returns an empty array for non-CC accounts or standalone cards.
 */
async function getPoolSiblingIds(account: FinancialAccount): Promise<string[]> {
  if (account.account_type !== "credit_card") return [];
  const db = getDatabase();
  const siblings = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM financial_accounts
      WHERE user_id = ? AND account_type = 'credit_card' AND is_active = 1 AND bank_name = ?;`,
    account.user_id,
    account.bank_name,
  );
  // If only one card (self), no pool.
  if (siblings.length <= 1) return [];
  return siblings.map((s) => s.id);
}

/**
 * Compute balance source info for an account.
 * For shared-pool credit cards, looks across all siblings to pick the most
 * pessimistic (lowest) balance and the freshest date; also checks staleness
 * against any sibling's payment activity.
 */
export async function getBalanceSourceInfo(
  accountId: string,
): Promise<BalanceSourceInfo | null> {
  const db = getDatabase();
  const account = await db.getFirstAsync<FinancialAccount>(
    "SELECT * FROM financial_accounts WHERE id = ?;",
    accountId,
  );
  if (!account) return null;

  const poolSiblings = await getPoolSiblingIds(account);
  const relevantIds = poolSiblings.length > 0 ? poolSiblings : [account.id];

  // Pull each relevant account's SMS-reported balance + date to find the "winner".
  // Rule: latest-dated SMS wins. Tiebreakers (same day): pending_sms.sms_date DESC
  // (finer epoch-ms timestamp), then financial_accounts.updated_at DESC.
  type BalanceRow = {
    id: string;
    last_known_balance: number | null;
    last_balance_date: string | null;
    last_balance_sms_id: string | null;
  };
  const placeholders = relevantIds.map(() => "?").join(",");

  const winner = await db.getFirstAsync<BalanceRow>(
    `SELECT fa.id, fa.last_known_balance, fa.last_balance_date, fa.last_balance_sms_id
       FROM financial_accounts fa
       LEFT JOIN pending_sms ps ON ps.id = fa.last_balance_sms_id
      WHERE fa.id IN (${placeholders})
        AND fa.last_known_balance IS NOT NULL
      ORDER BY fa.last_balance_date DESC,
               ps.sms_date DESC,
               fa.updated_at DESC
      LIMIT 1;`,
    ...relevantIds,
  );

  const autoDetectedBalance: number | null = winner?.last_known_balance ?? null;
  const sourceRow: BalanceRow | null = winner ?? null;

  // Freshest date across the pool — independent of the winner row. Used by the
  // staleness check below to see whether any expense/credit arrived after the
  // latest balance SMS.
  const freshestRow = await db.getFirstAsync<{ d: string | null }>(
    `SELECT MAX(last_balance_date) as d FROM financial_accounts WHERE id IN (${placeholders});`,
    ...relevantIds,
  );
  const freshestDate: string | null = freshestRow?.d ?? null;

  // Staleness (hybrid rule): auto-detected balance is stale if any of:
  //  (a) An SMS-parsed realized expense (source='sms_auto') dated STRICTLY AFTER
  //      the last balance SMS exists on any pool sibling. Main case — a purchase
  //      SMS that didn't include a balance.
  //  (b) Any credit (sms_auto or manual) dated STRICTLY AFTER the last balance
  //      SMS. Covers credits that arrived without a balance and manual credits.
  //  (c) Any transfer (in or out) on any pool sibling dated STRICTLY AFTER the
  //      last balance SMS. CC payment-received SMS flows can reclassify the
  //      savings debit as a transfer, which is invisible to the expenses-only
  //      check — this branch catches those.
  // Pending-review rows count too — a debit/credit SMS arriving after the last
  // balance SMS is evidence of staleness even before the user approves it.
  // Same-day (date == last_balance_date) is treated as fresh because SMS date
  // resolution is day-only; same-day transactions are typically reflected in
  // the balance SMS that accompanied them.
  let isStale = false;
  if (freshestDate) {
    const [expenseStale, transferStale] = await Promise.all([
      db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM expenses
          WHERE account_id IN (${placeholders})
            AND status IN ('approved', 'pending_review')
            AND deleted_at IS NULL
            AND date > ?
            AND (
              (source = 'sms_auto' AND nature = 'realized')
              OR
              nature = 'credit'
            );`,
        ...relevantIds,
        freshestDate,
      ),
      db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM account_transfers
          WHERE (to_account_id IN (${placeholders}) OR from_account_id IN (${placeholders}))
            AND deleted_at IS NULL
            AND date > ?;`,
        ...relevantIds,
        ...relevantIds,
        freshestDate,
      ),
    ]);
    if ((expenseStale?.count ?? 0) > 0 || (transferStale?.count ?? 0) > 0) isStale = true;
  }

  // Fetch the source SMS (may be null: not referenced, purged, or pre-migration-008).
  let sourceSms: PendingSmsRow | null = null;
  if (sourceRow?.last_balance_sms_id) {
    sourceSms = await db.getFirstAsync<PendingSmsRow>(
      "SELECT id, sms_id, address, body, sms_date, status FROM pending_sms WHERE id = ?;",
      sourceRow.last_balance_sms_id,
    ) ?? null;
  }

  // Calculated balance from ledger (pool-aware: sum across siblings).
  const month = formatLocalDate(new Date()).substring(0, 7);
  let calculated = 0;
  let anySeeded = false;
  for (const id of relevantIds) {
    const seeded = await isAccountSeeded(id);
    if (!seeded) continue;
    anySeeded = true;
    const summary = await getMonthBalanceSummary(id, month);
    if (summary) {
      // For CC, closing_balance is UTILIZED (opening + expenses − credits + adjNet).
      // We sum across siblings to get pool-level utilized, then convert to
      // available credit at the end so the comparison against the SMS-reported
      // auto-detected balance (which is also "available credit") is apples-
      // to-apples. For non-CC (savings/wallet/loan), closing IS the balance
      // and is used directly.
      calculated += summary.closing_balance;
    }
  }

  // CC-specific: flip pool utilized → pool available. For shared-limit pools,
  // the max sibling limit IS the shared limit (both siblings carry the same
  // limit on the shared card). For a standalone card, relevantIds has one
  // element, so max == that card's limit. Same math as the credit-cards
  // reconciliation page (sharedLimit − utilized).
  if (account.account_type === "credit_card" && anySeeded) {
    const limitRows = await db.getAllAsync<{ credit_limit: number | null }>(
      `SELECT credit_limit FROM financial_accounts WHERE id IN (${placeholders});`,
      ...relevantIds,
    );
    const sharedLimit = Math.max(0, ...limitRows.map((r) => r.credit_limit ?? 0));
    calculated = sharedLimit - calculated;
  }

  return {
    calculatedBalance: anySeeded ? calculated : null,
    autoDetectedBalance,
    autoDetectedDate: sourceRow?.last_balance_date ?? freshestDate,
    sourceSms,
    isStale,
    poolSiblingIds: poolSiblings,
    sourceAccountId: sourceRow?.id ?? account.id,
  };
}

export interface AutoApplyResult {
  applied: boolean;
  reason:
    | "no_newer_sms"
    | "applied_silently"
    | "parse_failed"
    | "no_balance_in_sms"
    | "error";
  /** When !applied but a candidate SMS exists, surface it so UI can offer manual action. */
  candidateSms: PendingSmsRow | null;
  errorMessage: string | null;
}

/**
 * Scan pending_sms for a fresher balance-bearing SMS for the account (or any pool sibling).
 * If found and parseable, silently applies via updateAccountFromSMS. If found but unparseable
 * or no balance extractable, returns the candidate so UI can prompt the user.
 */
export async function findAndApplyLatestBalanceSms(
  accountId: string,
): Promise<AutoApplyResult> {
  const db = getDatabase();
  const account = await db.getFirstAsync<FinancialAccount>(
    "SELECT * FROM financial_accounts WHERE id = ?;",
    accountId,
  );
  if (!account) {
    return { applied: false, reason: "error", candidateSms: null, errorMessage: "Account not found" };
  }

  const poolSiblings = await getPoolSiblingIds(account);
  const relevantIds = poolSiblings.length > 0 ? poolSiblings : [account.id];

  // Find the freshest last_balance_date we already have across relevant accounts.
  const placeholders = relevantIds.map(() => "?").join(",");
  const freshestRow = await db.getFirstAsync<{ d: string | null }>(
    `SELECT MAX(last_balance_date) as d FROM financial_accounts WHERE id IN (${placeholders});`,
    ...relevantIds,
  );
  const currentFreshest = freshestRow?.d ?? "1970-01-01";
  const currentFreshestMs = new Date(currentFreshest + "T00:00:00").getTime();

  // Scan pending_sms: bank name match (address contains bank's short code — loose),
  // body mentions any last4 from the pool, sms_date > currentFreshest.
  // We lookup last4 set from relevant accounts.
  const last4Rows = await db.getAllAsync<{ account_identifier: string }>(
    `SELECT account_identifier FROM financial_accounts WHERE id IN (${placeholders});`,
    ...relevantIds,
  );
  const last4Set = new Set(last4Rows.map((r) => r.account_identifier));
  if (last4Set.size === 0) {
    return { applied: false, reason: "no_newer_sms", candidateSms: null, errorMessage: null };
  }

  // Fetch candidate SMS (any status — processed SMS with balance info are valid
  // historical data). Filter by date server-side; last4 match happens client-side.
  const candidates = await db.getAllAsync<PendingSmsRow>(
    `SELECT id, sms_id, address, body, sms_date, status
       FROM pending_sms
      WHERE address LIKE ?
        AND sms_date > ?
      ORDER BY sms_date DESC
      LIMIT 50;`,
    `%${account.bank_name.substring(0, 4)}%`,
    currentFreshestMs,
  );

  const matched = candidates.find((c) =>
    Array.from(last4Set).some((l4) => c.body.includes(l4)),
  );
  if (!matched) {
    return { applied: false, reason: "no_newer_sms", candidateSms: null, errorMessage: null };
  }

  // Try to parse; skip if no balance extractable.
  const parsed = parseBankSMS(matched.body);
  if (!parsed) {
    return {
      applied: false,
      reason: "parse_failed",
      candidateSms: matched,
      errorMessage: "SMS couldn't be parsed.",
    };
  }
  const balanceValue = parsed.availableBalance ?? parsed.availableCreditLimit ?? null;
  if (balanceValue == null) {
    return {
      applied: false,
      reason: "no_balance_in_sms",
      candidateSms: matched,
      errorMessage: "Newer SMS didn't contain a balance value.",
    };
  }

  // Apply. Target: the matched account within the pool (if any) based on last4.
  const targetLast4 = Array.from(last4Set).find((l4) => matched.body.includes(l4));
  const targetRow = last4Rows.find((r) => r.account_identifier === targetLast4);
  const targetId = last4Rows.length > 0 && targetRow
    ? (await db.getFirstAsync<{ id: string }>(
        `SELECT id FROM financial_accounts
          WHERE user_id = ? AND account_identifier = ? AND bank_name = ? AND is_active = 1;`,
        account.user_id,
        targetRow.account_identifier,
        account.bank_name,
      ))?.id ?? account.id
    : account.id;

  try {
    // Stamp the parser's date with the SMS's own date when available.
    const smsDateStr = formatLocalDate(new Date(matched.sms_date));
    const parsedWithDate = { ...parsed, date: parsed.date ?? smsDateStr };
    await updateAccountFromSMS(targetId, parsedWithDate, matched.id);
    return { applied: true, reason: "applied_silently", candidateSms: matched, errorMessage: null };
  } catch (e) {
    return {
      applied: false,
      reason: "error",
      candidateSms: matched,
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }
}
