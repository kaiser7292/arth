/**
 * Loan EMI auto-matcher (v17.2.0).
 *
 * When a new realized expense lands (from SMS or manual), if it looks like an
 * EMI debit (amount within 5% of a loan's EMI, date within ±5 days of a
 * scheduled installment on an active loan for the same user), mark that
 * installment as `paid` and link the expense via `linked_expense_id`.
 *
 * Strictly opportunistic — the matcher never errors out a successful expense
 * create. Idempotent: if the matched installment is already linked, skip.
 */

import { getDatabase } from "@/database";
import { logger } from "@/utils/logger";
import { bumpDataVersion } from "@/services/settings";

interface MatchCandidate {
  schedule_id: string;
  loan_account_id: string;
  installment_num: number;
  due_date: string;
  emi_amount: number;
  bank_name: string;
  account_identifier: string;
}

/**
 * Try to match a newly-created expense to a scheduled EMI.
 * Returns the matched schedule entry id if matched, else null.
 */
export async function tryMatchExpenseToEMI(
  expenseId: string,
  userId: string,
): Promise<string | null> {
  try {
    const db = getDatabase();
    const expense = await db.getFirstAsync<{
      amount: number;
      date: string;
      nature: string;
      deleted_at: string | null;
    }>(
      `SELECT amount, date, nature, deleted_at FROM expenses WHERE id = ?;`,
      expenseId,
    );
    if (!expense || expense.deleted_at || expense.nature !== "realized") return null;

    const amountLow = expense.amount * 0.95;
    const amountHigh = expense.amount * 1.05;
    const dateLow = shiftDate(expense.date, -5);
    const dateHigh = shiftDate(expense.date, 5);

    // Find candidate scheduled EMIs on active loans matching amount + date window
    const candidates = await db.getAllAsync<MatchCandidate>(
      `SELECT se.id as schedule_id, se.loan_account_id, se.installment_num,
              se.due_date, se.emi_amount, fa.bank_name, fa.account_identifier
       FROM loan_schedule_entries se
       JOIN loan_accounts la ON la.id = se.loan_account_id
       JOIN financial_accounts fa ON fa.id = la.financial_account_id
       WHERE fa.user_id = ? AND la.status = 'active' AND se.status = 'scheduled'
         AND se.emi_amount >= ? AND se.emi_amount <= ?
         AND se.due_date >= ? AND se.due_date <= ?
       ORDER BY ABS(julianday(se.due_date) - julianday(?)) ASC
       LIMIT 1;`,
      userId,
      amountLow,
      amountHigh,
      dateLow,
      dateHigh,
      expense.date,
    );

    const match = candidates[0];
    if (!match) return null;

    // Mark installment paid + link
    await db.runAsync(
      `UPDATE loan_schedule_entries
       SET status = 'paid', linked_expense_id = ?, paid_date = ?, paid_amount = ?
       WHERE id = ?;`,
      expenseId,
      expense.date,
      expense.amount,
      match.schedule_id,
    );

    logger.info(`Matched expense ${expenseId} to loan installment ${match.installment_num}`);
    bumpDataVersion();
    return match.schedule_id;
  } catch (e) {
    logger.warn("tryMatchExpenseToEMI failed (non-fatal):", e);
    return null;
  }
}

/**
 * Unlink an installment if the linked expense is deleted.
 * Called from expense-crud.ts:deleteExpense.
 */
export async function onLinkedExpenseDeleted(expenseId: string): Promise<void> {
  try {
    const db = getDatabase();
    await db.runAsync(
      `UPDATE loan_schedule_entries
       SET status = 'scheduled', linked_expense_id = NULL, paid_date = NULL, paid_amount = NULL
       WHERE linked_expense_id = ?;`,
      expenseId,
    );
    bumpDataVersion();
  } catch (e) {
    logger.warn("onLinkedExpenseDeleted failed (non-fatal):", e);
  }
}

function shiftDate(yyyymmdd: string, days: number): string {
  const d = new Date(yyyymmdd + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}
