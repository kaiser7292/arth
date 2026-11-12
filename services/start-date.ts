/**
 * "Ignore transactions before this date", for history that is incomplete and would skew the figures.
 *
 * Older expenses, credits and transfers are hidden, not deleted: they carry START_DATE_HIDDEN in
 * deleted_at, which every query already skips, and clearing or moving the date brings them back.
 *
 * Left alone, because the money is still real and their totals read these rows: anything linked to a
 * loan or an investment, and anything on a demat, investment, pension or loan account. Hisaab entries
 * stay too, even when their expense is hidden (see hisaabExcludeDeletedLinkSql).
 *
 * Bank and wallet balances would now start from nothing on that date, so the Start date screen asks
 * for each one's balance on the day.
 */

import { getDatabase } from "@/database";
import { computeUnseededBalance, getEarliestAccountActivity, getOrCreateMonthBalance, seedOpeningBalance } from "@/services/account-balance";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { bumpDataVersion } from "@/services/settings";
import { settingsStorage } from "@/services/storage";
import { START_DATE_HIDDEN } from "@/utils/start-date-marker";

const KEY = "ignore_before_date";

const KEPT_ACCOUNTS = `(SELECT id FROM financial_accounts WHERE account_type IN ('demat', 'investment', 'pension', 'loan'))`;

/** The expenses the start date can hide. */
const EXPENSE_CAN_HIDE = `nature IN ('realized', 'credit', 'ledger_adjustment')
  AND (account_id IS NULL OR account_id NOT IN ${KEPT_ACCOUNTS})
  AND NOT EXISTS (SELECT 1 FROM expense_investment_links il WHERE il.expense_id = expenses.id)
  AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id)`;

/** The transfers the start date can hide. */
const TRANSFER_CAN_HIDE = `linked_contribution_id IS NULL
  AND from_account_id NOT IN ${KEPT_ACCOUNTS}
  AND to_account_id NOT IN ${KEPT_ACCOUNTS}`;

/** The date (YYYY-MM-DD) before which transactions are ignored, or null when everything counts. */
export function getStartDate(): string | null {
  return settingsStorage.getString(KEY) ?? null;
}

export function isBeforeStartDate(date: string | null | undefined): boolean {
  const start = getStartDate();
  return !!start && !!date && date < start;
}

/** Start of the day it begins, epoch ms, or 0 when everything counts. */
export function startDateMs(): number {
  const start = getStartDate();
  if (!start) return 0;
  const [y, m, d] = start.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** How many transactions a start date would ignore, including any it ignores already. */
export async function countIgnoredBefore(userId: string, date: string): Promise<number> {
  const db = getDatabase();
  const live = `(deleted_at IS NULL OR deleted_at = '${START_DATE_HIDDEN}')`;
  const expenses = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM expenses WHERE user_id = ? AND date < ? AND ${live} AND status != 'rejected' AND ${EXPENSE_CAN_HIDE};`,
    userId,
    date,
  );
  const transfers = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM account_transfers WHERE user_id = ? AND date < ? AND ${live} AND ${TRANSFER_CAN_HIDE};`,
    userId,
    date,
  );
  return (expenses?.n ?? 0) + (transfers?.n ?? 0);
}

/**
 * Hide what's before the date and bring back what isn't. Safe to run any time, so it also runs on
 * app start: that catches rows from a restored backup or a date edited to before the start date.
 */
export async function applyStartDate(userId: string): Promise<void> {
  const start = getStartDate();
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    for (const table of ["expenses", "account_transfers"]) {
      await db.runAsync(
        `UPDATE ${table} SET deleted_at = NULL WHERE user_id = ? AND deleted_at = ?${start ? " AND date >= ?" : ""};`,
        ...(start ? [userId, START_DATE_HIDDEN, start] : [userId, START_DATE_HIDDEN]),
      );
    }
    if (!start) return;
    await db.runAsync(
      `UPDATE expenses SET deleted_at = ? WHERE user_id = ? AND deleted_at IS NULL AND date < ? AND ${EXPENSE_CAN_HIDE};`,
      START_DATE_HIDDEN,
      userId,
      start,
    );
    await db.runAsync(
      `UPDATE account_transfers SET deleted_at = ? WHERE user_id = ? AND deleted_at IS NULL AND date < ? AND ${TRANSFER_CAN_HIDE};`,
      START_DATE_HIDDEN,
      userId,
      start,
    );
  });
}

export async function setStartDate(userId: string, date: string): Promise<void> {
  settingsStorage.set(KEY, date);
  await applyStartDate(userId);
  bumpDataVersion();
}

/** Count everything again. Balances entered for the start date stay, since they were true on that day. */
export async function clearStartDate(userId: string): Promise<void> {
  settingsStorage.delete(KEY);
  await applyStartDate(userId);
  bumpDataVersion();
}

/** The accounts whose balance depends on hidden rows. Card balances reset each month anyway. */
export async function getStartBalanceAccounts(userId: string): Promise<FinancialAccount[]> {
  const accounts = await getActiveAccounts(userId);
  return accounts.filter((a) => (a.account_type as string) === "savings" || (a.account_type as string) === "bank" || a.account_type === "wallet");
}

/** The account's balance on the start date becomes the opening balance of that month. */
export async function saveStartBalance(accountId: string, date: string, balance: number): Promise<void> {
  await seedOpeningBalance(accountId, date.slice(0, 7), balance);
}

/**
 * Onboarding: what's in the account right now becomes where it starts. The opening balance goes
 * on the first month the account shows any (visible) activity, set so that adding everything since
 * lands exactly on today's figure. With history kept, that's the first scanned month; started
 * fresh, the older rows are hidden, so it's this month. From here every expense and credit moves
 * it on.
 */
export async function saveBalanceToday(accountId: string, balance: number, today: string): Promise<void> {
  const currentMonth = today.slice(0, 7);
  const earliest = await getEarliestAccountActivity(accountId);
  const firstMonth = earliest && earliest.slice(0, 7) < currentMonth ? earliest.slice(0, 7) : currentMonth;
  // Closing today with an opening of 0 on that first month: everything that moved since.
  const moved = earliest ? (await computeUnseededBalance(accountId, currentMonth)).closing : 0;
  await seedOpeningBalance(accountId, firstMonth, balance - moved);
  // Lay the chain one month at a time up to now (each month opens on the one before's closing), so
  // no month in between is left without an opening.
  let m = firstMonth;
  while (m < currentMonth) {
    const [y, mo] = m.split("-").map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
    await getOrCreateMonthBalance(accountId, m);
  }
}
