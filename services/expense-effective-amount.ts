/**
 * Effective-amount helpers.
 *
 * When a realized expense is refunded (a credit row is created with
 * `refund_of_expense_id` pointing back at it), budget / insights / forecast /
 * YoY / savings-tracker totals must treat that expense as partially or fully
 * negated. A ₹1,000 expense with a ₹1,000 refund effectively costs ₹0; a
 * ₹1,000 expense with a ₹400 partial refund effectively costs ₹600.
 *
 * We do NOT mutate the original expense row (balance math in
 * `account-balance.ts` intentionally counts the debit + the credit on the
 * ledger — flipping the debit would double-count). Instead every aggregate
 * query that shows "spend" subtracts the sum of linked approved refunds.
 *
 * Two usage patterns:
 *
 *  1. SQL-side subtraction inside SUM(...) — use `effectiveAmountSql(alias)`.
 *     Drop-in replacement for `alias.amount` (or COALESCE-wrapped variants).
 *
 *  2. Post-query adjustment for list rendering — use `sumRefundsByExpenseIds`
 *     to fetch the refunded total per expense in one batched query.
 *
 * Only credits that are approved and not soft-deleted count. Pending /
 * rejected / deleted refunds don't move the needle yet.
 */

import { getDatabase } from "@/database";

/** SQL fragment that sums refunded credits linked to an expense.
 *  `<ALIAS>` is replaced with the caller-provided expense alias. */
function refundSubtractionSql(alias: string): string {
  return `COALESCE((
    SELECT SUM(r.amount) FROM expenses r
    WHERE r.refund_of_expense_id = ${alias}.id
      AND r.nature = 'credit'
      AND r.status = 'approved'
      AND r.deleted_at IS NULL
  ), 0)`;
}

/**
 * Returns a SQL expression equivalent to the effective (refund-adjusted)
 * amount for the expense row aliased as `alias`.
 *
 * For split-hisaab expenses, `amount` is the user's share but a refund comes
 * back against the whole charge (`split_original_amount`) -
 * adjustSplitAfterRefund shrinks the other person's Hisaab entry by their
 * part of it. So the user keeps their proportion of what's left:
 * (original − refunded) × share / original. The list rows
 * (ExpenseListItem) show the same figure.
 *
 * Clamped to ≥ 0 so an over-refund (shouldn't happen but technically
 * possible if the user edits a credit amount upward) can't negative-bias
 * totals.
 */
/**
 * The parts that take an expense from what was paid to what counts (effectiveAmountSql), for
 * breakdowns that show gross → others' share → refunds → net:
 *   gross       = what was paid (the whole bill when split)
 *   othersShare = the part of the bill other people owe
 *   myRefund    = your proportion of the refunds (the rest went back on their share)
 * gross − othersShare − myRefund = effectiveAmountSql, exactly as the list rows show it.
 */
export function amountPartsSql(alias: string = "e"): { gross: string; othersShare: string; myRefund: string } {
  const refunded = refundSubtractionSql(alias);
  const split = `${alias}.split_original_amount > 0`;
  return {
    gross: `(CASE WHEN ${split} THEN ${alias}.split_original_amount ELSE ${alias}.amount END)`,
    othersShare: `(CASE WHEN ${split} THEN MAX(${alias}.split_original_amount - ${alias}.amount, 0) ELSE 0 END)`,
    myRefund: `(CASE WHEN ${split}
      THEN MIN(${refunded}, ${alias}.split_original_amount) * ${alias}.amount / ${alias}.split_original_amount
      ELSE MIN(${refunded}, ${alias}.amount) END)`,
  };
}

export function effectiveAmountSql(alias: string = "e"): string {
  const refunded = refundSubtractionSql(alias);
  return `(CASE WHEN ${alias}.split_original_amount > 0
    THEN MAX((${alias}.split_original_amount - ${refunded}) * ${alias}.amount / ${alias}.split_original_amount, 0)
    ELSE MAX(${alias}.amount - ${refunded}, 0) END)`;
}

/**
 * Sum of approved, non-deleted refund credits linked to a single expense.
 * Returns 0 if nothing refunded.
 */
export async function getRefundedAmount(expenseId: string): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
     WHERE refund_of_expense_id = ?
       AND nature = 'credit'
       AND status = 'approved'
       AND deleted_at IS NULL;`,
    expenseId,
  );
  return row?.total ?? 0;
}

/**
 * Batched lookup: for a list of expense IDs, returns a Map from expense id →
 * total refunded amount. Expenses with no refund are omitted from the map
 * (callers should default to 0). One query regardless of list size.
 */
export async function sumRefundsByExpenseIds(
  expenseIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (expenseIds.length === 0) return map;
  const db = getDatabase();
  const placeholders = expenseIds.map(() => "?").join(",");
  const rows = await db.getAllAsync<{ refund_of_expense_id: string; total: number }>(
    `SELECT refund_of_expense_id, SUM(amount) as total FROM expenses
     WHERE refund_of_expense_id IN (${placeholders})
       AND nature = 'credit'
       AND status = 'approved'
       AND deleted_at IS NULL
     GROUP BY refund_of_expense_id;`,
    ...expenseIds,
  );
  for (const r of rows) {
    map.set(r.refund_of_expense_id, r.total);
  }
  return map;
}

/**
 * List of approved, non-deleted refund credits linked to a single expense.
 * Used by the expense detail screen to render per-refund rows with Undo buttons.
 */
export async function getRefundsForExpense(
  expenseId: string,
): Promise<{ id: string; amount: number; date: string; description: string | null }[]> {
  const db = getDatabase();
  return db.getAllAsync<{ id: string; amount: number; date: string; description: string | null }>(
    `SELECT id, amount, date, description FROM expenses
     WHERE refund_of_expense_id = ?
       AND nature = 'credit'
       AND status = 'approved'
       AND deleted_at IS NULL
     ORDER BY date DESC, created_at DESC;`,
    expenseId,
  );
}

/**
 * Refund-state classification for UI rendering.
 *   'none'    — no linked refunds (or all refunds are pending/deleted)
 *   'partial' — refunded < original amount
 *   'full'    — refunded >= original amount
 */
export type RefundState = "none" | "partial" | "full";

export function classifyRefund(
  originalAmount: number,
  refundedAmount: number,
): RefundState {
  if (refundedAmount <= 0) return "none";
  // 1 paisa tolerance for rounding (storage is 2dp, some arithmetic can drift)
  if (refundedAmount + 0.01 >= originalAmount) return "full";
  return "partial";
}
