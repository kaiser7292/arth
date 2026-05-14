/**
 * Forecast Engine Service — Task 23.0
 *
 * Queries expense and budget data, feeds to pure forecast functions.
 * Provides month-end and year-end predictions.
 */

import { getDatabase } from "@/database";
import {
  forecastMonthEnd,
  projectYearEnd,
  type MonthEndForecast,
  type YearEndProjection,
  type CategoryMonthData,
} from "@/utils/forecast-engine";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { effectiveAmountSql } from "./expense-effective-amount";

/**
 * Get month-end spending forecast for each category.
 *
 * @param userId — user to forecast for
 * @param month — "YYYY-MM" to forecast (defaults to current month)
 */
export async function getMonthEndForecast(
  userId: string,
  month?: string,
): Promise<MonthEndForecast> {
  const db = getDatabase();

  const now = month ? new Date(month + "-15") : new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const { startDate, endDate } = getMonthDateRange(yearMonth);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  // Days elapsed
  const today = new Date();
  const monthStart = new Date(startDate);
  const daysElapsed = month
    ? daysInMonth // historical month = complete
    : Math.min(
        Math.ceil((today.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24)),
        daysInMonth,
      );

  // Get budgets per category
  const budgetRows = await db.getAllAsync<{
    category_id: string;
    amount: number;
  }>(
    `SELECT category_id, amount FROM budgets
     WHERE user_id = ? AND month = ?;`,
    userId,
    yearMonth,
  );
  const budgetMap = new Map<string, number>();
  for (const row of budgetRows) {
    budgetMap.set(row.category_id, row.amount);
  }

  // Get current month spending per category
  const spentRows = await db.getAllAsync<{
    category_id: string;
    total: number;
  }>(
    `SELECT category_id, SUM(${effectiveAmountSql("expenses")}) as total FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND category_id IS NOT NULL
       AND date >= ? AND date <= ?
     GROUP BY category_id;`,
    userId,
    startDate,
    endDate,
  );
  const spentMap = new Map<string, number>();
  for (const row of spentRows) {
    spentMap.set(row.category_id, row.total);
  }

  // Get historical 3-month average per category
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const histStart = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, "0")}-01`;
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const histEnd = `${prevMonthEnd.getFullYear()}-${String(prevMonthEnd.getMonth() + 1).padStart(2, "0")}-${String(prevMonthEnd.getDate()).padStart(2, "0")}`;

  const histRows = await db.getAllAsync<{
    category_id: string;
    avg_monthly: number;
  }>(
    `SELECT category_id, SUM(${effectiveAmountSql("expenses")}) / 3.0 as avg_monthly FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND category_id IS NOT NULL
       AND date >= ? AND date <= ?
     GROUP BY category_id;`,
    userId,
    histStart,
    histEnd,
  );
  const histAvgMap = new Map<string, number>();
  for (const row of histRows) {
    histAvgMap.set(row.category_id, row.avg_monthly);
  }

  // Build category data
  const allCategoryIds = new Set([
    ...budgetMap.keys(),
    ...spentMap.keys(),
    ...histAvgMap.keys(),
  ]);

  const categories: CategoryMonthData[] = [];
  for (const catId of allCategoryIds) {
    categories.push({
      categoryId: catId,
      spentSoFar: spentMap.get(catId) ?? 0,
      budget: budgetMap.get(catId) ?? 0,
      historicalMonthlyAvg: histAvgMap.get(catId) ?? 0,
      sameMonthLastYear: null, // Could be added later
    });
  }

  return forecastMonthEnd({ daysElapsed, daysInMonth, categories });
}

/**
 * Get year-end spending and savings projection.
 *
 * @param userId — user to project for
 * @param fyStartMonth — fiscal year start month (default 4 for April)
 */
export async function getYearEndProjection(
  userId: string,
  fyStartMonth: number = 4,
): Promise<YearEndProjection | null> {
  const db = getDatabase();

  // Find current yearly plan
  const plan = await db.getFirstAsync<{
    annual_salary_in_hand: number;
    total_planned_expenses: number;
    savings_rate_target_pct: number;
  }>(
    `SELECT annual_salary_in_hand, total_planned_expenses, savings_rate_target_pct
     FROM yearly_plans WHERE user_id = ? ORDER BY financial_year DESC LIMIT 1;`,
    userId,
  );

  if (!plan) return null;

  // Calculate FY range
  const now = new Date();
  const fyYear =
    now.getMonth() + 1 >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1;
  const fyStart = `${fyYear}-${String(fyStartMonth).padStart(2, "0")}-01`;
  const today = now.toISOString().split("T")[0];

  // Months elapsed in FY
  const startDate = new Date(fyStart);
  const monthsElapsed = Math.max(
    1,
    (now.getFullYear() - startDate.getFullYear()) * 12 +
      (now.getMonth() - startDate.getMonth()) + 1,
  );

  // Total spent YTD
  const spentRow = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(${effectiveAmountSql("expenses")}) as total FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND date >= ? AND date <= ?;`,
    userId,
    fyStart,
    today,
  );
  const totalSpentYTD = spentRow?.total ?? 0;

  // Monthly totals for trend weighting
  const monthlyRows = await db.getAllAsync<{
    month: string;
    total: number;
  }>(
    `SELECT strftime('%Y-%m', date) as month, SUM(${effectiveAmountSql("expenses")}) as total
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND date >= ? AND date <= ?
     GROUP BY strftime('%Y-%m', date)
     ORDER BY month ASC;`,
    userId,
    fyStart,
    today,
  );

  return projectYearEnd({
    annualIncome: plan.annual_salary_in_hand,
    annualBudget: plan.total_planned_expenses,
    totalSpentYTD,
    monthsElapsed,
    monthlyTotals: monthlyRows.map((r) => r.total),
  });
}
