/**
 * Savings Rate Tracker service — Task 6.2.
 *
 * Connects the pure calculation functions to actual DB data.
 * Provides the savings snapshot and monthly trend for a given FY.
 */

import { getDatabase } from "@/database";
import { getYearlyPlanByFY, getBucketsByFY } from "@/services/yearly-plan";
import { getMilestonesForFY, getCombinedMilestoneContributionsForFY } from "@/services/life-milestone";
import { getFYRange, getFiscalMonth, getCurrentFY } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";
import {
  calculateSavingsSnapshot,
  calculateMonthlySavingsTrend,
} from "@/utils/savings-calculations";
import type { SavingsSnapshot } from "@/utils/savings-calculations";
import { effectiveAmountSql } from "./expense-effective-amount";
import { toIsoDate as formatDate } from "@/utils/date";

/**
 * Get total approved investment contributions for given bucket IDs within a date range.
 */
async function getInvestmentContributionsInRange(
  bucketIds: string[],
  startDate: string,
  endDate: string,
): Promise<number> {
  if (bucketIds.length === 0) return 0;
  const db = getDatabase();
  const placeholders = bucketIds.map(() => "?").join(",");
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM investment_contributions
     WHERE investment_bucket_id IN (${placeholders}) AND status = 'approved' AND date >= ? AND date <= ?;`,
    ...bucketIds,
    startDate,
    endDate,
  );
  return row?.total ?? 0;
}

/**
 * Get the total expenses for a user within a date range.
 */
async function getTotalExpensesInRange(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(${effectiveAmountSql("expenses")}) as total FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL AND date >= ? AND date <= ?
       AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id)
       AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id);`,
    userId,
    startDate,
    endDate,
  );
  return row?.total ?? 0;
}

/**
 * Get monthly expense totals for a FY, keyed by fiscal month (1-12).
 */
async function getMonthlyExpensesByFiscalMonth(
  userId: string,
  fyYear: number,
  startMonth: number,
): Promise<Map<number, number>> {
  const db = getDatabase();
  const { start, end } = getFYRange(fyYear, startMonth);
  const startDate = formatDate(start);
  const endDate = formatDate(end);

  const rows = await db.getAllAsync<{ month_str: string; total: number }>(
    `SELECT strftime('%Y-%m', date) as month_str, SUM(${effectiveAmountSql("expenses")}) as total
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL AND date >= ? AND date <= ?
       AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id)
       AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id)
     GROUP BY month_str
     ORDER BY month_str;`,
    userId,
    startDate,
    endDate,
  );

  const result = new Map<number, number>();

  for (const row of rows) {
    const [yearStr, monthStr] = row.month_str.split("-");
    const calMonth = parseInt(monthStr, 10);
    // Convert calendar month to fiscal month
    let fm = calMonth - startMonth + 1;
    if (fm <= 0) fm += 12;
    result.set(fm, row.total);
  }

  return result;
}

/**
 * Get the full savings snapshot for a given FY.
 * Returns null if no yearly plan exists for that FY.
 */
export async function getSavingsSnapshot(
  userId: string,
  fyYear: number,
): Promise<SavingsSnapshot | null> {
  const startMonth = getFYStartMonth();
  const fy = String(fyYear);
  const plan = await getYearlyPlanByFY(userId, fy);
  if (!plan) return null;

  const { start, end } = getFYRange(fyYear, startMonth);
  const startDate = formatDate(start);
  const endDate = formatDate(end);

  const [totalExpenses, buckets, milestones] = await Promise.all([
    getTotalExpensesInRange(userId, startDate, endDate),
    getBucketsByFY(userId, fy),
    getMilestonesForFY(userId, fy),
  ]);

  // Query actual contributions within FY date range (not relying on running total)
  const bucketIds = buckets.map((b) => b.id);
  const [investmentContributions, milestoneContributions] = await Promise.all([
    getInvestmentContributionsInRange(bucketIds, startDate, endDate),
    milestones.length > 0
      ? getCombinedMilestoneContributionsForFY(milestones.map((m) => m.id), startDate, endDate)
      : Promise.resolve(0),
  ]);

  const currentFY = getCurrentFY(startMonth);
  const monthsElapsed = fyYear < currentFY ? 12
    : fyYear === currentFY ? getFiscalMonth(startMonth)
    : 0;

  return calculateSavingsSnapshot({
    annualSalary: plan.annual_salary_in_hand,
    expectedBonus: plan.expected_bonus,
    targetSavingsRatePct: plan.savings_rate_target_pct,
    totalExpenses,
    monthsElapsed,
    investmentContributions,
    milestoneContributions,
  });
}

/**
 * Get monthly savings trend data for a FY.
 * Returns null if no yearly plan exists for that FY.
 */
export async function getSavingsTrend(
  userId: string,
  fyYear: number,
): Promise<
  Array<{
    fiscalMonth: number;
    income: number;
    expenses: number;
    saved: number;
    savingsRatePct: number;
  }> | null
> {
  const startMonth = getFYStartMonth();
  const plan = await getYearlyPlanByFY(userId, String(fyYear));
  if (!plan) return null;

  const monthlyExpenses = await getMonthlyExpensesByFiscalMonth(
    userId,
    fyYear,
    startMonth,
  );

  const currentFY = getCurrentFY(startMonth);
  const monthsElapsed = fyYear < currentFY ? 12
    : fyYear === currentFY ? getFiscalMonth(startMonth)
    : 0;

  return calculateMonthlySavingsTrend({
    annualSalary: plan.annual_salary_in_hand,
    monthlyExpenses,
    monthsToShow: monthsElapsed,
  });
}

/**
 * Count distinct months that have at least one expense record in the given range.
 */
export async function getDistinctExpenseMonthsInRange(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(DISTINCT strftime('%Y-%m', date)) as cnt FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL AND date >= ? AND date <= ?
       AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id)
       AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id);`,
    userId,
    startDate,
    endDate,
  );
  return row?.cnt ?? 0;
}

