/**
 * What counts as spending — the same rule the Budget tab uses — in one place, for the
 * forecast, its historical baseline, the yearly projection and pattern learning.
 *
 * Spending = approved debits that aren't: deleted, a transfer between your own accounts
 * (reclassified_as_transfer), an investment (expense_investment_links) or a loan payment
 * (expense_loan_links). `amount` comes back refund-adjusted.
 *
 * Before this, the forecast's historical average used every debit — transfers, loan EMIs,
 * unreviewed items — while the current month used this rule, so the baseline came out far
 * higher than the month it was compared with (2026-10 bug: ₹8k spent projected to ₹2.2 lakh).
 */

import { getDatabase } from "@/database";
import { effectiveAmountSql } from "@/services/expense-effective-amount";
import type { Expense } from "@/services/expense-types";

/** WHERE conditions (no leading AND) on the `expenses` table, unaliased. */
export const SPENDING_WHERE = `status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
  AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
  AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id)
  AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id)`;

/** Spending rows dated startDate..endDate (inclusive), oldest first, refund-adjusted amounts. */
export async function getSpendingRows(userId: string, startDate: string, endDate: string): Promise<Expense[]> {
  const db = getDatabase();
  return db.getAllAsync<Expense>(
    `SELECT *, ${effectiveAmountSql("expenses")} AS amount FROM expenses
      WHERE user_id = ? AND date >= ? AND date <= ? AND ${SPENDING_WHERE}
      ORDER BY date ASC, created_at ASC;`,
    userId,
    startDate,
    endDate,
  );
}

/** How many distinct months have any spending at all. */
export async function getSpendingMonthCount(userId: string): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ months: number }>(
    `SELECT COUNT(DISTINCT strftime('%Y-%m', date)) AS months FROM expenses
      WHERE user_id = ? AND ${SPENDING_WHERE};`,
    userId,
  );
  return row?.months ?? 0;
}

/** Middle value — one unusual month can't drag a baseline up or down. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
