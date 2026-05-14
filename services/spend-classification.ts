/**
 * v15.2.1 — Unified spend-classification helper.
 *
 * Before this, Monthly Summary and Spending Split each ran their own query
 * with subtly different rules and produced different "unavoidable %" values
 * for the same month:
 *
 *   Monthly Summary  → SUM(amount) WHERE is_right_spend = 1
 *                      denominator = SUM(amount) of ALL approved realized
 *                      (incl. uncategorized, null is_right_spend)
 *
 *   Spending Split   → grouped by COALESCE(is_right_spend, 1)
 *                      — NULL was bucketed as unavoidable, inflating numerator
 *                      — category_id IS NOT NULL filter excluded uncategorized
 *                      from the denominator
 *
 *   → A single month with any NULL is_right_spend or any uncategorized
 *     expense produced diverging percentages (observed up to 20+ points).
 *
 * This helper is the single source of truth. Both screens now call it.
 *
 * Rules:
 *   - Scope: status='approved' AND nature='realized' AND deleted_at IS NULL
 *   - Unavoidable    = is_right_spend = 1
 *   - Discretionary  = is_right_spend = 0
 *   - Uncategorized  = is_right_spend IS NULL (user hasn't flagged yet)
 *   - Total          = unavoidable + discretionary + uncategorized (always
 *                      matches getExpenseTotal for the same period)
 */

import { getDatabase } from "@/database";
import { effectiveAmountSql } from "./expense-effective-amount";

export interface SpendClassificationTotals {
  /** Sum of is_right_spend=1 expenses (amount, split-aware). */
  unavoidable: number;
  /** Sum of is_right_spend=0 expenses. */
  discretionary: number;
  /** Sum of is_right_spend IS NULL expenses (uncategorized for spend-classification). */
  uncategorized: number;
  /** unavoidable + discretionary + uncategorized. */
  total: number;
  /** Integer percentage share of `unavoidable` over `total`. 0 when total=0. */
  unavoidablePct: number;
  /** Integer percentage share of `discretionary` over `total`. */
  discretionaryPct: number;
  /** Integer percentage share of `uncategorized` over `total`. */
  uncategorizedPct: number;
}

const EMPTY: SpendClassificationTotals = {
  unavoidable: 0,
  discretionary: 0,
  uncategorized: 0,
  total: 0,
  unavoidablePct: 0,
  discretionaryPct: 0,
  uncategorizedPct: 0,
};

/**
 * Compute percentages so they sum to 100 (or 0 when total is 0). Integer
 * rounding errors are absorbed by the largest bucket so the displayed
 * numbers always add up.
 */
function computePcts(u: number, d: number, n: number, total: number) {
  if (total <= 0) {
    return { unavoidablePct: 0, discretionaryPct: 0, uncategorizedPct: 0 };
  }
  const uRaw = (u / total) * 100;
  const dRaw = (d / total) * 100;
  const nRaw = (n / total) * 100;
  let uPct = Math.round(uRaw);
  let dPct = Math.round(dRaw);
  let nPct = Math.round(nRaw);
  const drift = 100 - (uPct + dPct + nPct);
  if (drift !== 0) {
    // Push drift into the largest bucket to preserve "adds up to 100".
    const maxBucket = Math.max(uPct, dPct, nPct);
    if (uPct === maxBucket) uPct += drift;
    else if (dPct === maxBucket) dPct += drift;
    else nPct += drift;
  }
  return { unavoidablePct: uPct, discretionaryPct: dPct, uncategorizedPct: nPct };
}

/**
 * Get unified spend-classification totals for a user in a date range.
 * Single SQL, single-source-of-truth for any screen that needs the
 * unavoidable/discretionary breakdown.
 */
export async function getSpendClassificationTotals(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<SpendClassificationTotals> {
  const db = getDatabase();
  const amtExpr = effectiveAmountSql("expenses");
  const row = await db.getFirstAsync<{
    unavoidable: number | null;
    discretionary: number | null;
    uncategorized: number | null;
  }>(
    `SELECT
        COALESCE(SUM(CASE WHEN is_right_spend = 1 THEN ${amtExpr} ELSE 0 END), 0) AS unavoidable,
        COALESCE(SUM(CASE WHEN is_right_spend = 0 THEN ${amtExpr} ELSE 0 END), 0) AS discretionary,
        COALESCE(SUM(CASE WHEN is_right_spend IS NULL THEN ${amtExpr} ELSE 0 END), 0) AS uncategorized
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND date >= ? AND date <= ?
       AND NOT EXISTS (SELECT 1 FROM expense_investment_links il WHERE il.expense_id = expenses.id)
       AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id);`,
    userId,
    startDate,
    endDate,
  );
  if (!row) return EMPTY;

  const unavoidable = row.unavoidable ?? 0;
  const discretionary = row.discretionary ?? 0;
  const uncategorized = row.uncategorized ?? 0;
  const total = unavoidable + discretionary + uncategorized;
  const pcts = computePcts(unavoidable, discretionary, uncategorized, total);

  return {
    unavoidable,
    discretionary,
    uncategorized,
    total,
    ...pcts,
  };
}

/** Exported for unit testing — the pure % computation. */
export const __test__ = { computePcts };
