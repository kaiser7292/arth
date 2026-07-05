/**
 * Account Monthly Balance Service
 *
 * Manages the month-wise balance ledger for all account types.
 *
 * Savings: opening_balance - expenses + credits = closing_balance
 * Credit Card: opening_available - expenses + payments + refunds = closing_available
 *
 * The chain: closing_balance(month N) = opening_balance(month N+1)
 * Exception: user can manually override any month's opening balance.
 *
 * CC payments do NOT reset to credit_limit — they add the payment amount back.
 */

import { getDatabase } from "@/database";
import { getTransfersInTotal, getTransfersOutTotal } from "@/services/account-transfer";
import { bumpDataVersion } from "@/services/settings";
import { round2 } from "@/utils/math";
import { generateUUID } from "@/utils/uuid";

/**
 * Closing balance formula, account-type aware. Single source of truth for the
 * ledger math — used by getClosingBalance, getMonthBalanceSummary,
 * getComputedBalances, and getComputedBalanceComponents.
 *
 * Savings/wallet/pension (balance model): closing = opening − expenses + credits − tOut + tIn + adjNet
 * Credit card (utilized model):         closing = opening + expenses − credits + tOut − tIn + adjNet
 *
 * For a CC, opening seeds at 0 (cycle start, nothing owed). Spends raise
 * closing; payments/refunds lower it. Goal: end cycle at 0 = fully paid back.
 */
export function computeClosing(parts: {
  opening: number;
  expenses: number;
  credits: number;
  transfersOut: number;
  transfersIn: number;
  adjustmentNet: number;
  isCC: boolean;
}): number {
  const { opening, expenses, credits, transfersOut: tOut, transfersIn: tIn, adjustmentNet: adjNet, isCC } = parts;
  return isCC
    ? opening + expenses - credits + tOut - tIn + adjNet
    : opening - expenses + credits - tOut + tIn + adjNet;
}

export interface AccountMonthBalance {
  id: string;
  account_id: string;
  month: string; // YYYY-MM
  opening_balance: number;
  is_manual_override: number;
  created_at: string;
  updated_at: string;
}

export interface MonthBalanceSummary {
  month: string;
  opening_balance: number;
  expenses: number;    // total debits (expenses linked to this account)
  credits: number;     // total credits (credit SMS, refunds)
  transfers_out: number; // money sent to other owned accounts
  transfers_in: number;  // money received from other owned accounts
  closing_balance: number; // computed: opening - expenses + credits - transfers_out + transfers_in
  is_manual_override: boolean;
}

/**
 * Get or create the opening balance record for an account+month.
 * If no record exists, chains from the previous month's closing balance.
 * If no previous month exists, returns null (user must seed).
 */
export async function getOrCreateMonthBalance(
  accountId: string,
  month: string,
): Promise<AccountMonthBalance | null> {
  const db = getDatabase();

  // Check if record already exists
  const existing = await db.getFirstAsync<AccountMonthBalance>(
    "SELECT * FROM account_month_balances WHERE account_id = ? AND month = ?;",
    accountId,
    month,
  );
  if (existing) {
    if (existing.is_manual_override === 0) {
      const prevMonth = getPreviousMonth(month);
      const prevClosing = await getClosingBalance(accountId, prevMonth);
      if (
        prevClosing != null &&
        Math.abs(prevClosing - existing.opening_balance) >= 0.01
      ) {
        const reflowed = round2(prevClosing);
        await db.runAsync(
          `UPDATE account_month_balances
             SET opening_balance = ?, updated_at = datetime('now')
           WHERE id = ?;`,
          reflowed,
          existing.id,
        );
        return { ...existing, opening_balance: reflowed };
      }
    }
    return existing;
  }

  // Try to chain from previous month's closing balance
  const prevMonth = getPreviousMonth(month);
  const prevClosing = await getClosingBalance(accountId, prevMonth);

  if (prevClosing == null) return null; // No chain anchor — user must seed

  // Create new record with chained opening balance
  const id = generateUUID();
  await db.runAsync(
    `INSERT INTO account_month_balances (id, account_id, month, opening_balance)
     VALUES (?, ?, ?, ?);`,
    id,
    accountId,
    month,
    prevClosing,
  );

  return db.getFirstAsync<AccountMonthBalance>(
    "SELECT * FROM account_month_balances WHERE id = ?;",
    id,
  );
}

/**
 * Seed the initial opening balance for an account.
 * This creates the first record in the chain.
 */
export async function seedOpeningBalance(
  accountId: string,
  month: string,
  openingBalance: number,
): Promise<void> {
  const db = getDatabase();

  const rounded = round2(openingBalance);
  await db.runAsync(
    `INSERT INTO account_month_balances (id, account_id, month, opening_balance, is_manual_override)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(account_id, month)
     DO UPDATE SET opening_balance = ?, is_manual_override = 1, updated_at = datetime('now');`,
    generateUUID(),
    accountId,
    month,
    rounded,
    rounded,
  );
  await bumpDataVersion();
}

/**
 * Manually override the opening balance for a specific month.
 * Breaks the chain from the previous month — user takes control.
 *
 * @deprecated prefer adjustOpeningBalance which creates a visible, deletable
 * adjustment transaction instead of silently rewriting the opening value.
 * Kept for first-time seeding callers that need direct override.
 */
export async function overrideOpeningBalance(
  accountId: string,
  month: string,
  openingBalance: number,
): Promise<void> {
  await seedOpeningBalance(accountId, month, openingBalance);
}

/**
 * Marker string placed in the adjustment transaction's description so we can
 * find and delete it later. Keep stable across app versions.
 *
 * Direction suffixes (+ raises balance, - lowers balance) are parsed by the
 * ledger math helpers so a single nature = 'ledger_adjustment' row can
 * represent either direction without contaminating budget/savings queries.
 */
export const OPENING_ADJUSTMENT_MARKER = "[Opening Adjustment]";
export const OPENING_ADJUSTMENT_MARKER_POS = "[Opening Adjustment +]";
export const OPENING_ADJUSTMENT_MARKER_NEG = "[Opening Adjustment -]";

export const AVAILABLE_ADJUSTMENT_MARKER = "[Balance Adjustment]";
export const AVAILABLE_ADJUSTMENT_MARKER_POS = "[Balance Adjustment +]";
export const AVAILABLE_ADJUSTMENT_MARKER_NEG = "[Balance Adjustment -]";

/**
 * Override the opening balance for a specific month via an adjustment transaction.
 *
 * If the month has no opening row yet (i.e. the account is unseeded for that
 * month), this falls back to seedOpeningBalance — there's no chain to preserve.
 *
 * Otherwise: computes the delta between the desired opening and the current
 * opening, and creates an adjustment transaction (credit or realized expense)
 * dated on the 1st of the month. The raw opening_balance row itself is left
 * alone so the adjustment is visible in transactions and the user can reverse
 * it by deleting the adjustment entry (via deleteOpeningAdjustment).
 *
 * Returns the delta applied (signed — positive means we added a credit,
 * negative means we added an expense).
 */
export async function adjustOpeningBalance(params: {
  accountId: string;
  userId: string;
  month: string;
  desiredOpening: number;
  description?: string;
}): Promise<number> {
  const db = getDatabase();
  const existing = await db.getFirstAsync<AccountMonthBalance>(
    "SELECT * FROM account_month_balances WHERE account_id = ? AND month = ?;",
    params.accountId,
    params.month,
  );

  // No opening row yet → this IS the initial seed. Just write it directly.
  if (!existing) {
    await seedOpeningBalance(params.accountId, params.month, params.desiredOpening);
    return 0;
  }

  const delta = params.desiredOpening - existing.opening_balance;
  if (delta === 0) return 0;

  // Adjustment is a transaction dated on the 1st of the month so it affects
  // this month's running balance from day 1 but does NOT flow into last month.
  // Nature 'ledger_adjustment' means: does not count as spending (budget/savings
  // queries ignore it) but the ledger math adds it signed to the closing balance.
  const txDate = `${params.month}-01`;
  const directionMarker = delta > 0 ? OPENING_ADJUSTMENT_MARKER_POS : OPENING_ADJUSTMENT_MARKER_NEG;
  const desc = params.description
    ? `${directionMarker} ${params.description}`
    : directionMarker;
  const id = generateUUID();
  const now = new Date().toISOString(); // Local time in ISO format

  await db.runAsync(
    `INSERT INTO expenses (id, user_id, amount, currency, description, date, transaction_time, nature, source, status, account_id, created_at)
     VALUES (?, ?, ?, 'INR', ?, ?, '00:00:00', 'ledger_adjustment', 'manual', 'approved', ?, ?);`,
    id,
    params.userId,
    round2(Math.abs(delta)),
    desc,
    txDate,
    params.accountId,
    now,
  );
  await bumpDataVersion();
  return delta;
}

/**
 * Find and soft-delete the opening-adjustment transactions for an account+month.
 * Returns the number of adjustment entries soft-deleted.
 */
export async function deleteOpeningAdjustment(
  accountId: string,
  month: string,
): Promise<number> {
  const db = getDatabase();
  const txDate = `${month}-01`;
  // Match either legacy marker "[Opening Adjustment]%" or new directional forms
  // "[Opening Adjustment +]%" / "[Opening Adjustment -]%" — both start with the
  // same 19-char prefix "[Opening Adjustment".
  const result = await db.runAsync(
    `UPDATE expenses
        SET deleted_at = datetime('now'), updated_at = datetime('now')
      WHERE account_id = ? AND date = ? AND deleted_at IS NULL
        AND description LIKE ?;`,
    accountId,
    txDate,
    `[Opening Adjustment%`,
  );
  if (result.changes > 0) await bumpDataVersion();
  return result.changes;
}

/**
 * Count the open (non-deleted) opening-adjustment entries for an account+month.
 * Used by UI to decide whether to show a "Remove Adjustment" button.
 */
export async function hasOpeningAdjustment(
  accountId: string,
  month: string,
): Promise<boolean> {
  const db = getDatabase();
  const txDate = `${month}-01`;
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM expenses
      WHERE account_id = ? AND date = ? AND deleted_at IS NULL
        AND description LIKE ?;`,
    accountId,
    txDate,
    `[Opening Adjustment%`,
  );
  return (row?.count ?? 0) > 0;
}

/**
 * Get the total expenses linked to an account for a given month.
 * Only realized, approved, non-deleted expenses.
 */
export async function getAccountExpensesTotal(
  accountId: string,
  monthStart: string,
  monthEnd: string,
): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(COALESCE(split_original_amount, amount)) as total FROM expenses
     WHERE account_id = ? AND deleted_at IS NULL
       AND nature = 'realized' AND status = 'approved'
       AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
       AND date >= ? AND date <= ?;`,
    accountId,
    monthStart,
    monthEnd,
  );
  return row?.total ?? 0;
}

/**
 * Get the total credits for an account in a month.
 * Pulls from expenses table where nature='credit' (covers both refunds and
 * manual/SMS credits since migration 005 unified them).
 * Only counts approved credits — pending_review credits from SMS are excluded
 * until the user approves them in the review queue.
 */
export async function getAccountCreditsTotal(
  accountId: string,
  monthStart: string,
  monthEnd: string,
): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(amount) as total FROM expenses
     WHERE account_id = ? AND deleted_at IS NULL
       AND nature = 'credit' AND status = 'approved'
       AND date >= ? AND date <= ?;`,
    accountId,
    monthStart,
    monthEnd,
  );
  return row?.total ?? 0;
}

/**
 * Net signed total of ledger_adjustment rows for an account in a date range.
 * Direction is parsed from the description marker prefix:
 *   [Opening Adjustment +] / [Balance Adjustment +]   → +amount
 *   [Opening Adjustment -] / [Balance Adjustment -]   → -amount
 * Rows lacking a direction marker default to + (treat as "raise balance") for
 * safety — same-sign as a credit — though this shouldn't happen in practice.
 */
export async function getAccountAdjustmentNet(
  accountId: string,
  monthStart: string,
  monthEnd: string,
): Promise<number> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ amount: number; description: string | null }>(
    `SELECT amount, description FROM expenses
     WHERE account_id = ? AND deleted_at IS NULL
       AND nature = 'ledger_adjustment' AND status = 'approved'
       AND date >= ? AND date <= ?;`,
    accountId,
    monthStart,
    monthEnd,
  );
  let net = 0;
  for (const r of rows) {
    const desc = r.description ?? "";
    const isNeg = desc.includes(" -]");
    net += isNeg ? -r.amount : r.amount;
  }
  return net;
}

/** Absolute total of ledger adjustments for display as a drift indicator. */
export async function getAccountAdjustmentAbsTotal(
  accountId: string,
  monthStart: string,
  monthEnd: string,
): Promise<{ total: number; count: number }> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ total: number | null; count: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM expenses
     WHERE account_id = ? AND deleted_at IS NULL
       AND nature = 'ledger_adjustment' AND status = 'approved'
       AND date >= ? AND date <= ?;`,
    accountId,
    monthStart,
    monthEnd,
  );
  return { total: row?.total ?? 0, count: row?.count ?? 0 };
}

/**
 * Global adjustment drift for a user across all accounts in a date range.
 * Used as a fallback; most callers should use the type-scoped variant.
 */
export async function getUserAdjustmentAbsTotal(
  userId: string,
  monthStart: string,
  monthEnd: string,
): Promise<{ total: number; count: number }> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ total: number | null; count: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM expenses
     WHERE user_id = ? AND deleted_at IS NULL
       AND nature = 'ledger_adjustment' AND status = 'approved'
       AND date >= ? AND date <= ?;`,
    userId,
    monthStart,
    monthEnd,
  );
  return { total: row?.total ?? 0, count: row?.count ?? 0 };
}

/**
 * Adjustment drift filtered by account type (e.g. only credit_card or only savings).
 * Used by the reconciliation screens' overall summary to show how much course-
 * correction was done for that specific account type this month.
 */
export async function getAdjustmentAbsTotalByAccountType(
  userId: string,
  accountType: "credit_card" | "savings" | "loan" | "wallet" | "pension",
  monthStart: string,
  monthEnd: string,
): Promise<{ total: number; count: number }> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ total: number | null; count: number }>(
    `SELECT COALESCE(SUM(e.amount), 0) as total, COUNT(*) as count
     FROM expenses e
     INNER JOIN financial_accounts fa ON fa.id = e.account_id
     WHERE e.user_id = ? AND e.deleted_at IS NULL
       AND e.nature = 'ledger_adjustment' AND e.status = 'approved'
       AND e.date >= ? AND e.date <= ?
       AND fa.account_type = ?;`,
    userId,
    monthStart,
    monthEnd,
    accountType,
  );
  return { total: row?.total ?? 0, count: row?.count ?? 0 };
}

/**
 * Compute the closing balance for an account in a given month.
 *
 * Savings/wallet model (balance = money you have):
 *   closing = opening − expenses + credits − transfers_out + transfers_in + adj_net
 *
 * Credit-card model (balance = money you owe / "utilized"):
 *   closing = opening + expenses − credits + transfers_out − transfers_in + adj_net
 *
 * For a CC, opening seeds at 0 (cycle start, nothing owed). Spends raise
 * closing; payments/refunds lower it. Goal: end cycle at 0 = fully paid back.
 */
export async function getClosingBalance(
  accountId: string,
  month: string,
): Promise<number | null> {
  const db = getDatabase();

  const record = await db.getFirstAsync<AccountMonthBalance>(
    "SELECT * FROM account_month_balances WHERE account_id = ? AND month = ?;",
    accountId,
    month,
  );
  if (!record) return null;

  const account = await db.getFirstAsync<{ account_type: string }>(
    "SELECT account_type FROM financial_accounts WHERE id = ?;",
    accountId,
  );
  const isCC = account?.account_type === "credit_card";

  const { startDate, endDate } = getMonthDateRange(month);
  const expenses = await getAccountExpensesTotal(accountId, startDate, endDate);
  const credits = await getAccountCreditsTotal(accountId, startDate, endDate);
  const tOut = await getTransfersOutTotal(accountId, startDate, endDate);
  const tIn = await getTransfersInTotal(accountId, startDate, endDate);
  const adjustmentNet = await getAccountAdjustmentNet(accountId, startDate, endDate);

  return computeClosing({
    opening: record.opening_balance,
    expenses,
    credits,
    transfersOut: tOut,
    transfersIn: tIn,
    adjustmentNet,
    isCC,
  });
}

/**
 * Get the full monthly balance summary for display.
 */
export async function getMonthBalanceSummary(
  accountId: string,
  month: string,
): Promise<MonthBalanceSummary | null> {
  const record = await getOrCreateMonthBalance(accountId, month);
  if (!record) return null;

  const db = getDatabase();
  const account = await db.getFirstAsync<{ account_type: string }>(
    "SELECT account_type FROM financial_accounts WHERE id = ?;",
    accountId,
  );
  const isCC = account?.account_type === "credit_card";

  const { startDate, endDate } = getMonthDateRange(month);
  const expenses = await getAccountExpensesTotal(accountId, startDate, endDate);
  const credits = await getAccountCreditsTotal(accountId, startDate, endDate);
  const transfers_out = await getTransfersOutTotal(accountId, startDate, endDate);
  const transfers_in = await getTransfersInTotal(accountId, startDate, endDate);
  const adjustmentNet = await getAccountAdjustmentNet(accountId, startDate, endDate);

  const closing_balance = computeClosing({
    opening: record.opening_balance,
    expenses,
    credits,
    transfersOut: transfers_out,
    transfersIn: transfers_in,
    adjustmentNet,
    isCC,
  });

  return {
    month,
    opening_balance: record.opening_balance,
    expenses,
    credits,
    transfers_out,
    transfers_in,
    closing_balance,
    is_manual_override: record.is_manual_override === 1,
  };
}

/**
 * Get multiple months of balance history for an account.
 * Returns them in reverse chronological order.
 */
export async function getBalanceHistory(
  accountId: string,
  monthCount: number = 6,
): Promise<MonthBalanceSummary[]> {
  const result: MonthBalanceSummary[] = [];
  let month = getCurrentMonth();

  for (let i = 0; i < monthCount; i++) {
    const summary = await getMonthBalanceSummary(accountId, month);
    if (!summary) break; // No more chain
    result.push(summary);
    month = getPreviousMonth(month);
  }

  return result;
}

/**
 * Get the "current balance" for an account — opening balance for current month
 * minus expenses so far plus credits.
 * Returns null if no opening balance has been seeded.
 */
export async function getCurrentBalance(
  accountId: string,
): Promise<number | null> {
  const month = getCurrentMonth();
  const summary = await getMonthBalanceSummary(accountId, month);
  return summary?.closing_balance ?? null;
}

/**
 * Get computed current balances for multiple accounts at once.
 * Returns a map of accountId -> current balance.
 * Batched: 5 aggregate queries total (openings, expenses, credits, transfers out, transfers in)
 * instead of 5×N sequential queries. Falls back to individual lookup for accounts
 * that have no opening balance for the current month (getOrCreateMonthBalance has side effects).
 */
export async function getComputedBalances(
  accountIds: string[],
): Promise<Record<string, number | null>> {
  const result: Record<string, number | null> = {};
  if (accountIds.length === 0) return result;

  const db = getDatabase();
  const month = getCurrentMonth();
  const { startDate, endDate } = getMonthDateRange(month);
  const placeholders = accountIds.map(() => "?").join(",");

  // Auto-seed unseeded credit cards with opening = credit_limit (silent, idempotent).
  await autoSeedCreditCards(accountIds, month);

  // 1. Opening balances for current month (no side-effects — only reads existing rows)
  const openings = await db.getAllAsync<{ account_id: string; opening_balance: number }>(
    `SELECT account_id, opening_balance FROM account_month_balances
     WHERE month = ? AND account_id IN (${placeholders});`,
    month,
    ...accountIds,
  );
  const openingMap = new Map(openings.map((r) => [r.account_id, r.opening_balance]));

  // 2. Expense totals grouped by account
  const expenseRows = await db.getAllAsync<{ account_id: string; total: number | null }>(
    `SELECT account_id, SUM(COALESCE(split_original_amount, amount)) as total FROM expenses
     WHERE account_id IN (${placeholders}) AND deleted_at IS NULL
       AND nature = 'realized' AND status = 'approved'
       AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
       AND date >= ? AND date <= ?
     GROUP BY account_id;`,
    ...accountIds,
    startDate,
    endDate,
  );
  const expenseMap = new Map(expenseRows.map((r) => [r.account_id, r.total ?? 0]));

  // 3. Credit totals grouped by account
  const creditRows = await db.getAllAsync<{ account_id: string; total: number | null }>(
    `SELECT account_id, SUM(amount) as total FROM expenses
     WHERE account_id IN (${placeholders}) AND deleted_at IS NULL
       AND nature = 'credit' AND status = 'approved'
       AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
       AND date >= ? AND date <= ?
     GROUP BY account_id;`,
    ...accountIds,
    startDate,
    endDate,
  );
  const creditMap = new Map(creditRows.map((r) => [r.account_id, r.total ?? 0]));

  // 4. Transfers OUT grouped by from_account_id
  const transfersOut = await db.getAllAsync<{ from_account_id: string; total: number | null }>(
    `SELECT from_account_id, SUM(amount) as total FROM account_transfers
     WHERE from_account_id IN (${placeholders}) AND deleted_at IS NULL
       AND date >= ? AND date <= ?
     GROUP BY from_account_id;`,
    ...accountIds,
    startDate,
    endDate,
  );
  const transfersOutMap = new Map(transfersOut.map((r) => [r.from_account_id, r.total ?? 0]));

  // 5. Transfers IN grouped by to_account_id
  const transfersIn = await db.getAllAsync<{ to_account_id: string; total: number | null }>(
    `SELECT to_account_id, SUM(amount) as total FROM account_transfers
     WHERE to_account_id IN (${placeholders}) AND deleted_at IS NULL
       AND date >= ? AND date <= ?
     GROUP BY to_account_id;`,
    ...accountIds,
    startDate,
    endDate,
  );
  const transfersInMap = new Map(transfersIn.map((r) => [r.to_account_id, r.total ?? 0]));

  // 6. Ledger adjustments (net signed) grouped by account — direction parsed from description marker.
  const adjustmentRows = await db.getAllAsync<{ account_id: string; amount: number; description: string | null }>(
    `SELECT account_id, amount, description FROM expenses
     WHERE account_id IN (${placeholders}) AND deleted_at IS NULL
       AND nature = 'ledger_adjustment' AND status = 'approved'
       AND date >= ? AND date <= ?;`,
    ...accountIds,
    startDate,
    endDate,
  );
  const adjustmentMap = new Map<string, number>();
  for (const r of adjustmentRows) {
    const desc = r.description ?? "";
    const isNeg = desc.includes(" -]");
    const delta = isNeg ? -r.amount : r.amount;
    adjustmentMap.set(r.account_id, (adjustmentMap.get(r.account_id) ?? 0) + delta);
  }

  // Load account types to pick the right sign convention per account.
  const types = await db.getAllAsync<{ id: string; account_type: string }>(
    `SELECT id, account_type FROM financial_accounts WHERE id IN (${placeholders});`,
    ...accountIds,
  );
  const typeMap = new Map(types.map((r) => [r.id, r.account_type]));

  for (const id of accountIds) {
    const opening = openingMap.get(id);
    if (opening === undefined) {
      result[id] = null;
      continue;
    }
    const expenses = expenseMap.get(id) ?? 0;
    const credits = creditMap.get(id) ?? 0;
    const tOut = transfersOutMap.get(id) ?? 0;
    const tIn = transfersInMap.get(id) ?? 0;
    const adjNet = adjustmentMap.get(id) ?? 0;
    const isCC = typeMap.get(id) === "credit_card";
    result[id] = computeClosing({
      opening,
      expenses,
      credits,
      transfersOut: tOut,
      transfersIn: tIn,
      adjustmentNet: adjNet,
      isCC,
    });
  }

  return result;
}

export interface BalanceComponents {
  opening: number;
  expenses: number;
  credits: number;
  transfersOut: number;
  transfersIn: number;
  adjustmentNet: number;
  closing: number;
}

/**
 * For any credit-card account in the list that has no opening row for the given
 * month, silently seed it with opening = 0 (nothing owed at cycle start).
 * Also migrates any prior auto-seeded row that still has opening = credit_limit
 * (from v12.6.0) down to 0, so the math matches the new "utilized" convention.
 *
 * Goal state: end of cycle at closing = 0 = fully paid back.
 */
async function autoSeedCreditCards(accountIds: string[], month: string): Promise<void> {
  if (accountIds.length === 0) return;
  const db = getDatabase();
  const placeholders = accountIds.map(() => "?").join(",");

  const ccs = await db.getAllAsync<{ id: string; credit_limit: number | null }>(
    `SELECT id, credit_limit FROM financial_accounts
     WHERE id IN (${placeholders})
       AND account_type = 'credit_card'
       AND is_active = 1;`,
    ...accountIds,
  );
  if (ccs.length === 0) return;

  for (const cc of ccs) {
    const existing = await db.getFirstAsync<{ opening_balance: number; is_manual_override: number }>(
      `SELECT opening_balance, is_manual_override FROM account_month_balances
       WHERE account_id = ? AND month = ?;`,
      cc.id,
      month,
    );
    if (!existing) {
      await db.runAsync(
        `INSERT INTO account_month_balances (id, account_id, month, opening_balance, is_manual_override)
         VALUES (?, ?, ?, 0, 0)
         ON CONFLICT(account_id, month) DO NOTHING;`,
        generateUUID(),
        cc.id,
        month,
      );
      continue;
    }
    // One-time migration: a v12.6.0 auto-seed set opening = credit_limit.
    // If the row is not a manual override AND opening matches the limit,
    // reset it to 0 so the new utilized-model math lands correctly.
    if (
      existing.is_manual_override === 0 &&
      cc.credit_limit != null &&
      Math.abs(existing.opening_balance - cc.credit_limit) < 0.01
    ) {
      await db.runAsync(
        `UPDATE account_month_balances SET opening_balance = 0, updated_at = datetime('now')
         WHERE account_id = ? AND month = ?;`,
        cc.id,
        month,
      );
    }
  }
}

/**
 * Like getComputedBalances but returns each component of the current-month ledger
 * math instead of just the final closing. Used by reconciliation screens that need
 * to show the user *why* closing != sum of expenses.
 */
export async function getComputedBalanceComponents(
  accountIds: string[],
): Promise<Record<string, BalanceComponents | null>> {
  const result: Record<string, BalanceComponents | null> = {};
  if (accountIds.length === 0) return result;

  const db = getDatabase();
  const month = getCurrentMonth();
  const { startDate, endDate } = getMonthDateRange(month);
  const placeholders = accountIds.map(() => "?").join(",");

  // Auto-seed unseeded credit cards with opening = credit_limit so the ledger
  // math works from the first use. Silent, idempotent, no UI prompt.
  await autoSeedCreditCards(accountIds, month);

  const openings = await db.getAllAsync<{ account_id: string; opening_balance: number }>(
    `SELECT account_id, opening_balance FROM account_month_balances
     WHERE month = ? AND account_id IN (${placeholders});`,
    month,
    ...accountIds,
  );
  const openingMap = new Map(openings.map((r) => [r.account_id, r.opening_balance]));

  const expenseRows = await db.getAllAsync<{ account_id: string; total: number | null }>(
    `SELECT account_id, SUM(COALESCE(split_original_amount, amount)) as total FROM expenses
     WHERE account_id IN (${placeholders}) AND deleted_at IS NULL
       AND nature = 'realized' AND status = 'approved'
       AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
       AND date >= ? AND date <= ?
     GROUP BY account_id;`,
    ...accountIds,
    startDate,
    endDate,
  );
  const expenseMap = new Map(expenseRows.map((r) => [r.account_id, r.total ?? 0]));

  const creditRows = await db.getAllAsync<{ account_id: string; total: number | null }>(
    `SELECT account_id, SUM(amount) as total FROM expenses
     WHERE account_id IN (${placeholders}) AND deleted_at IS NULL
       AND nature = 'credit' AND status = 'approved'
       AND date >= ? AND date <= ?
     GROUP BY account_id;`,
    ...accountIds,
    startDate,
    endDate,
  );
  const creditMap = new Map(creditRows.map((r) => [r.account_id, r.total ?? 0]));

  const transfersOut = await db.getAllAsync<{ from_account_id: string; total: number | null }>(
    `SELECT from_account_id, SUM(amount) as total FROM account_transfers
     WHERE from_account_id IN (${placeholders}) AND deleted_at IS NULL
       AND date >= ? AND date <= ?
     GROUP BY from_account_id;`,
    ...accountIds,
    startDate,
    endDate,
  );
  const transfersOutMap = new Map(transfersOut.map((r) => [r.from_account_id, r.total ?? 0]));

  const transfersIn = await db.getAllAsync<{ to_account_id: string; total: number | null }>(
    `SELECT to_account_id, SUM(amount) as total FROM account_transfers
     WHERE to_account_id IN (${placeholders}) AND deleted_at IS NULL
       AND date >= ? AND date <= ?
     GROUP BY to_account_id;`,
    ...accountIds,
    startDate,
    endDate,
  );
  const transfersInMap = new Map(transfersIn.map((r) => [r.to_account_id, r.total ?? 0]));

  const adjustmentRows = await db.getAllAsync<{ account_id: string; amount: number; description: string | null }>(
    `SELECT account_id, amount, description FROM expenses
     WHERE account_id IN (${placeholders}) AND deleted_at IS NULL
       AND nature = 'ledger_adjustment' AND status = 'approved'
       AND date >= ? AND date <= ?;`,
    ...accountIds,
    startDate,
    endDate,
  );
  const adjustmentMap = new Map<string, number>();
  for (const r of adjustmentRows) {
    const desc = r.description ?? "";
    const isNeg = desc.includes(" -]");
    const delta = isNeg ? -r.amount : r.amount;
    adjustmentMap.set(r.account_id, (adjustmentMap.get(r.account_id) ?? 0) + delta);
  }

  const types = await db.getAllAsync<{ id: string; account_type: string }>(
    `SELECT id, account_type FROM financial_accounts WHERE id IN (${placeholders});`,
    ...accountIds,
  );
  const typeMap = new Map(types.map((r) => [r.id, r.account_type]));

  for (const id of accountIds) {
    const opening = openingMap.get(id);
    if (opening === undefined) {
      result[id] = null;
      continue;
    }
    const expenses = expenseMap.get(id) ?? 0;
    const credits = creditMap.get(id) ?? 0;
    const tOut = transfersOutMap.get(id) ?? 0;
    const tIn = transfersInMap.get(id) ?? 0;
    const adjNet = adjustmentMap.get(id) ?? 0;
    const isCC = typeMap.get(id) === "credit_card";
    const closing = computeClosing({
      opening,
      expenses,
      credits,
      transfersOut: tOut,
      transfersIn: tIn,
      adjustmentNet: adjNet,
      isCC,
    });
    result[id] = {
      opening,
      expenses,
      credits,
      transfersOut: tOut,
      transfersIn: tIn,
      adjustmentNet: adjNet,
      closing,
    };
  }

  return result;
}

/**
 * Check if an account has been seeded (has at least one month balance record).
 */
export async function isAccountSeeded(accountId: string): Promise<boolean> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM account_month_balances WHERE account_id = ?;",
    accountId,
  );
  return (row?.count ?? 0) > 0;
}

/**
 * Get the earliest seeded month for an account.
 */
export async function getEarliestMonth(accountId: string): Promise<string | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ month: string }>(
    "SELECT MIN(month) as month FROM account_month_balances WHERE account_id = ?;",
    accountId,
  );
  return row?.month ?? null;
}

/**
 * Earliest month across a set of accounts, considering both seeded openings
 * and transaction activity. Used for period-selector bounds when siblings
 * (shared-limit cards) share history.
 */
export async function getEarliestMonthForAccounts(
  accountIds: string[],
): Promise<string | null> {
  if (accountIds.length === 0) return null;
  const db = getDatabase();
  const placeholders = accountIds.map(() => "?").join(",");
  const row = await db.getFirstAsync<{ min_month: string | null }>(
    `SELECT MIN(month) as min_month FROM (
       SELECT month FROM account_month_balances WHERE account_id IN (${placeholders})
       UNION ALL
       SELECT substr(MIN(date), 1, 7) as month FROM expenses
         WHERE account_id IN (${placeholders}) AND deleted_at IS NULL
       UNION ALL
       SELECT substr(MIN(date), 1, 7) as month FROM account_transfers
         WHERE (from_account_id IN (${placeholders}) OR to_account_id IN (${placeholders})) AND deleted_at IS NULL
     );`,
    ...accountIds,
    ...accountIds,
    ...accountIds,
    ...accountIds,
  );
  return row?.min_month ?? null;
}

/**
 * Delete the opening balance record for a specific month.
 * This breaks the chain — the month will recompute from the previous month on next access.
 */
export async function resetMonthBalance(
  accountId: string,
  month: string,
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "DELETE FROM account_month_balances WHERE account_id = ? AND month = ?;",
    accountId,
    month,
  );
  await bumpDataVersion();
}

/**
 * Adjust an account's available balance to a user-declared actual.
 *
 * For standalone accounts: delta = target − this account's closing.
 *
 * For shared-pool credit cards (same bank, same credit_limit, both CC):
 * the "actual available" represents the POOL's available, not just this card's.
 * We compute delta against the POOL's aggregate available and write the
 * adjustment to this account. This keeps the pool math consistent regardless
 * of which sibling the user taps to adjust.
 *
 * Auto-seeds the current month with opening = credit_limit if unseeded,
 * so the math engages immediately.
 *
 * Before writing, any existing manual balance-adjustment entries on this
 * account (and siblings, for pool cards) dated in the current month are
 * soft-deleted, so repeated adjustments don't stack.
 *
 * Returns the signed delta applied (positive = available went up,
 * negative = available went down, zero = already matched).
 */
export async function adjustAccountAvailable(params: {
  accountId: string;
  userId: string;
  actualAvailable: number;
  description?: string;
}): Promise<number> {
  const db = getDatabase();
  const today = new Date().toISOString().split("T")[0];
  const month = today.substring(0, 7);
  const { startDate, endDate } = getMonthDateRange(month);

  // Determine the relevant account set: siblings for shared CC pools, else just self.
  const account = await db.getFirstAsync<{
    id: string;
    account_type: string;
    bank_name: string | null;
    user_id: string;
    credit_limit: number | null;
  }>(
    `SELECT id, account_type, bank_name, user_id, credit_limit
     FROM financial_accounts WHERE id = ?;`,
    params.accountId,
  );
  if (!account) throw new Error(`Account ${params.accountId} not found`);

  let relevantIds: string[] = [params.accountId];
  if (account.account_type === "credit_card" && account.bank_name) {
    const siblings = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM financial_accounts
       WHERE user_id = ? AND account_type = 'credit_card'
         AND is_active = 1 AND bank_name = ?;`,
      account.user_id,
      account.bank_name,
    );
    if (siblings.length > 1) {
      relevantIds = siblings.map((s) => s.id);
    }
  }

  // Auto-seed every relevant CC for this month (opening = credit_limit).
  await autoSeedCreditCards(relevantIds, month);

  // Remove any prior manual balance-adjustment entries for this month on the
  // relevant account set — otherwise repeated Adjust operations stack.
  const placeholders = relevantIds.map(() => "?").join(",");
  await db.runAsync(
    `UPDATE expenses SET deleted_at = datetime('now'), updated_at = datetime('now')
     WHERE account_id IN (${placeholders})
       AND deleted_at IS NULL
       AND nature = 'ledger_adjustment'
       AND source = 'manual'
       AND (description LIKE ? OR description LIKE ?)
       AND date >= ? AND date <= ?;`,
    ...relevantIds,
    `${AVAILABLE_ADJUSTMENT_MARKER_POS}%`,
    `${AVAILABLE_ADJUSTMENT_MARKER_NEG}%`,
    startDate,
    endDate,
  );

  // Compute current closing across the relevant set.
  //
  // CC pools use the batched getComputedBalances — one round-trip for all
  // siblings. Works because autoSeedCreditCards (called inside) guarantees
  // an opening-balance row for the current month.
  //
  // Savings / wallet uses getMonthBalanceSummary, which chains via
  // getOrCreateMonthBalance from the previous month's closing. The batched
  // path would return null for accounts where the current month hasn't been
  // touched yet, producing a wrong delta. One sibling here, so no perf cost.
  let currentClosing = 0;
  if (account.account_type === "credit_card") {
    const balanceMap = await getComputedBalances(relevantIds);
    for (const id of relevantIds) {
      const c = balanceMap[id];
      if (c != null) currentClosing += c;
    }
  } else {
    const summary = await getMonthBalanceSummary(params.accountId, month);
    if (summary) {
      currentClosing = summary.closing_balance;
    } else {
      const unseeded = await computeUnseededBalance(params.accountId, month);
      currentClosing = unseeded.closing;
    }
  }

  // Desired closing:
  //   CC: desired_utilized = credit_limit − user-entered actual-available
  //   Savings: desired_balance = user-entered actual-available
  // Delta = desiredClosing − currentClosing. Written as one adjustment on the
  // target account. For CC, "+" raises utilized (lowers available); "−" lowers
  // utilized (raises available).
  const isCC = account.account_type === "credit_card";
  const limit = isCC ? (account.credit_limit ?? 0) : 0;
  const desiredClosing = isCC ? limit - params.actualAvailable : params.actualAvailable;
  const delta = desiredClosing - currentClosing;
  if (Math.abs(delta) < 0.005) {
    await bumpDataVersion();
    return 0;
  }

  const directionMarker = delta > 0 ? AVAILABLE_ADJUSTMENT_MARKER_POS : AVAILABLE_ADJUSTMENT_MARKER_NEG;
  const userDesc = params.description?.trim();
  const desc = userDesc ? `${directionMarker} ${userDesc}` : directionMarker;
  const id = generateUUID();
  const now = new Date().toISOString(); // Local time in ISO format
  await db.runAsync(
    `INSERT INTO expenses (id, user_id, amount, currency, description, date, transaction_time, nature, source, status, account_id, created_at)
     VALUES (?, ?, ?, 'INR', ?, ?, '00:00:00', 'ledger_adjustment', 'manual', 'approved', ?, ?);`,
    id,
    params.userId,
    round2(Math.abs(delta)),
    desc,
    today,
    params.accountId,
    now,
  );
  await bumpDataVersion();
  // Sign is the "available" delta the user sees: positive = available went up.
  return isCC ? -delta : delta;
}

/**
 * Delete ALL balance records for an account + soft-delete all manual credits.
 * Resets the account to unseeded state.
 */
export async function clearAccountLedger(
  accountId: string,
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "DELETE FROM account_month_balances WHERE account_id = ?;",
    accountId,
  );
  // Soft-delete manual credits (nature='credit' + source='manual') — SMS credits kept
  await db.runAsync(
    `UPDATE expenses SET deleted_at = datetime('now')
     WHERE account_id = ? AND nature = 'credit' AND source = 'manual' AND deleted_at IS NULL;`,
    accountId,
  );
  await bumpDataVersion();
}

// ── Ledger helpers ──

/**
 * Get individual approved expenses for an account in a date range.
 * Matches the same filter as getAccountExpensesTotal so row sum = total.
 */
export async function getLedgerExpenses(
  accountId: string,
  startDate: string,
  endDate: string,
): Promise<Array<{
  id: string;
  account_id: string | null;
  amount: number;
  split_original_amount: number | null;
  split_person_id: string | null;
  description: string | null;
  reclassified_as_transfer: number | null;
  linked_transfer_id: string | null;
  merchant_name: string | null;
  date: string;
  source: string;
  refund_of_expense_id: string | null;
  nature: "realized" | "ledger_adjustment";
}>> {
  const db = getDatabase();
  return db.getAllAsync(
    `SELECT id, account_id, amount, split_original_amount, split_person_id, description, merchant_name, date, source, refund_of_expense_id, nature, reclassified_as_transfer, linked_transfer_id
     FROM expenses
     WHERE account_id = ? AND deleted_at IS NULL
       AND nature IN ('realized', 'ledger_adjustment') AND status = 'approved'
       AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
       AND date >= ? AND date <= ?
     ORDER BY date DESC, created_at DESC;`,
    accountId,
    startDate,
    endDate,
  );
}

/**
 * Find the earliest transaction date linked to an account.
 * Checks expenses (both debits and credits — unified since migration 005) and transfers.
 * Returns the YYYY-MM-DD date string, or null if no activity.
 */
export async function getEarliestAccountActivity(
  accountId: string,
): Promise<string | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ min_date: string | null }>(
    `SELECT MIN(date) as min_date FROM (
       SELECT date FROM expenses WHERE account_id = ? AND deleted_at IS NULL
       UNION ALL
       SELECT date FROM account_transfers WHERE (from_account_id = ? OR to_account_id = ?) AND deleted_at IS NULL
     );`,
    accountId,
    accountId,
    accountId,
  );
  return row?.min_date ?? null;
}

export interface UnseededBalanceSummary {
  opening: number;
  expenses: number;
  credits: number;
  closing: number;
}

/**
 * Compute balance for an unseeded account by chaining from the first
 * month of activity (opening = 0) forward to the target month.
 * Each month: closing = opening - expenses + credits.
 * Next month's opening = previous month's closing.
 */
export async function computeUnseededBalance(
  accountId: string,
  targetMonth: string,
): Promise<UnseededBalanceSummary> {
  const earliestDate = await getEarliestAccountActivity(accountId);
  if (!earliestDate) {
    return { opening: 0, expenses: 0, credits: 0, closing: 0 };
  }

  const firstMonth = earliestDate.substring(0, 7); // YYYY-MM

  if (targetMonth < firstMonth) {
    return { opening: 0, expenses: 0, credits: 0, closing: 0 };
  }

  // Chain forward from first month (opening = 0) to target month
  let runningBalance = 0;
  let currentMonth = firstMonth;

  while (currentMonth <= targetMonth) {
    const range = getMonthDateRange(currentMonth);
    const expenses = await getAccountExpensesTotal(accountId, range.startDate, range.endDate);
    const credits = await getAccountCreditsTotal(accountId, range.startDate, range.endDate);
    const tOut = await getTransfersOutTotal(accountId, range.startDate, range.endDate);
    const tIn = await getTransfersInTotal(accountId, range.startDate, range.endDate);
    const adjNet = await getAccountAdjustmentNet(accountId, range.startDate, range.endDate);

    if (currentMonth === targetMonth) {
      return {
        opening: runningBalance,
        expenses,
        credits,
        closing: runningBalance - expenses + credits - tOut + tIn + adjNet,
      };
    }

    runningBalance = runningBalance - expenses + credits - tOut + tIn + adjNet;
    currentMonth = getNextMonth(currentMonth);
  }

  return { opening: 0, expenses: 0, credits: 0, closing: 0 };
}

// ── Helpers ──

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getPreviousMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(year, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthDateRange(month: string): { startDate: string; endDate: string } {
  const [year, m] = month.split("-").map(Number);
  const startDate = `${year}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(year, m, 0).getDate();
  const endDate = `${year}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { startDate, endDate };
}

function getNextMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(year, m, 1); // m is 1-based, so this gives next month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
