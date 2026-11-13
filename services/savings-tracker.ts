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
import { getSalaryProfileByFY } from "@/services/salary-profile";
import { deriveDirectBaseMonthly } from "@/services/income-calculation";
import { getSalaryMonths } from "@/services/salary-periods";
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
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
       AND date >= ? AND date <= ?
       AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id) AND COALESCE(expenses.money_event, '') NOT IN ('fd_open', 'sip', 'self_transfer')
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
       AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
       AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id) AND COALESCE(expenses.money_event, '') NOT IN ('fd_open', 'sip', 'self_transfer')
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
 * Loan payments (EMIs and prepayments: expenses linked to a loan) in a date range, keyed by month
 * ("YYYY-MM"). They stay out of Expenses (they never fill a budget category) but they are money
 * out, so the savings rate takes them off what was saved, as the Yearly Plan's surplus does.
 */
export async function getLoanPaymentsByMonth(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<Map<string, number>> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ month_str: string; total: number | null }>(
    `SELECT strftime('%Y-%m', e.date) AS month_str, SUM(${effectiveAmountSql("e")}) AS total
     FROM expenses e
     WHERE e.user_id = ? AND e.status = 'approved' AND e.nature = 'realized' AND e.deleted_at IS NULL
       AND (e.reclassified_as_transfer IS NULL OR e.reclassified_as_transfer = 0)
       AND e.date >= ? AND e.date <= ?
       AND EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = e.id)
     GROUP BY month_str;`,
    userId,
    startDate,
    endDate,
  );
  return new Map(rows.map((r) => [r.month_str, Math.max(0, r.total ?? 0)]));
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

  const [totalExpenses, paymentsByMonth, buckets, milestones] = await Promise.all([
    getTotalExpensesInRange(userId, startDate, endDate),
    getLoanPaymentsByMonth(userId, startDate, endDate).catch(() => new Map<string, number>()),
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
    loanPayments: [...paymentsByMonth.values()].reduce((a, v) => a + v, 0),
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

  const fyRange = getFYRange(fyYear, startMonth);
  const [monthlyExpenses, salaryProfile, paymentsByMonth] = await Promise.all([
    getMonthlyExpensesByFiscalMonth(userId, fyYear, startMonth),
    getSalaryProfileByFY(userId, String(fyYear)),
    getLoanPaymentsByMonth(userId, formatDate(fyRange.start), formatDate(fyRange.end)).catch(() => new Map<string, number>()),
  ]);
  // Same calendar → fiscal month mapping as the expenses.
  const monthlyLoanPayments = new Map<number, number>();
  for (const [monthStr, total] of paymentsByMonth) {
    let fm = parseInt(monthStr.split("-")[1], 10) - startMonth + 1;
    if (fm <= 0) fm += 12;
    monthlyLoanPayments.set(fm, total);
  }

  const currentFY = getCurrentFY(startMonth);
  const monthsElapsed = fyYear < currentFY ? 12
    : fyYear === currentFY ? getFiscalMonth(startMonth)
    : 0;

  let monthlyIncomeOverrides: Map<number, number> | undefined;
  if (salaryProfile?.monthly_overrides) {
    try {
      const overrides: Record<number, string> = JSON.parse(salaryProfile.monthly_overrides);
      // computed_monthly_in_hand is the year's average; the default month is what's left
      // after taking the overridden months out.
      const defaultInHand = deriveDirectBaseMonthly(
        salaryProfile.computed_monthly_in_hand || salaryProfile.manual_monthly_in_hand || 0,
        overrides,
      );
      monthlyIncomeOverrides = new Map<number, number>();
      for (let i = 0; i < 12; i++) {
        const ov = overrides[i];
        const value = ov !== undefined ? (parseFloat(ov) || 0) : defaultInHand;
        monthlyIncomeOverrides.set(i + 1, value);
      }
    } catch {}
  }

  // Months with a salary credit show what was credited, plus any side income from the calculator.
  try {
    const rows = await getSalaryMonths(userId, String(fyYear), new Date(), salaryProfile);
    if (rows.length > 0 && salaryProfile) {
      const plannedAverage = rows.reduce((s, r) => s + r.expected, 0) / rows.length;
      const side = Math.max(0, salaryProfile.computed_monthly_in_hand - plannedAverage);
      monthlyIncomeOverrides = new Map(rows.map((r) => [r.index + 1, (r.credited > 0 ? r.credited : r.expected) + side]));
    }
  } catch {
    // Keeps the calculator's figures.
  }

  return calculateMonthlySavingsTrend({
    annualSalary: plan.annual_salary_in_hand,
    monthlyExpenses,
    monthsToShow: monthsElapsed,
    monthlyIncomeOverrides,
    monthlyLoanPayments,
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
       AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id) AND COALESCE(expenses.money_event, '') NOT IN ('fd_open', 'sip', 'self_transfer')
       AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id);`,
    userId,
    startDate,
    endDate,
  );
  return row?.cnt ?? 0;
}

