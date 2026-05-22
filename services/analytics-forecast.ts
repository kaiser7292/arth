/**
 * Analytics V2 Forecast Service — Fixed/Variable Split
 *
 * Uses recurring_transactions to identify fixed expenses,
 * then projects variable spending via daily pace.
 */

import { getDatabase } from "@/database";
import { getMonthDateRange, getDaysRemaining, getTotalDaysInMonth } from "@/utils/budget-helpers";
import { normalizeMerchant } from "@/services/smart-categorizer";
import { round2 } from "@/utils/math";
import { getActiveClassifications } from "@/services/analytics/classifier";
import { forecastMonthEndRealistic, getHistoricalVariableAvg as getHistVarAvg } from "@/services/analytics/forecast-engine-v2";
import { getBudgetsForMonth } from "@/services/budget";
import type { Expense } from "@/services/expense-types";
import { effectiveAmountSql } from "@/services/expense-effective-amount";

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

export type ConfidenceLevel = "learning" | "low" | "moderate" | "high" | "confirmed";

export interface FixedExpenseItem {
  id: string;
  merchant: string;
  amount: number;
  expectedDay: number;
  frequency: string;
  categoryId: string | null;
  arrived: boolean;
  actualAmount?: number;
  actualDate?: string;
}

export interface VariableProjection {
  spentSoFar: number;
  dailyPace: number;
  daysElapsed: number;
  daysLeft: number;
  projected: number;
  historicalAvg: number;
}

export interface CategoryPace {
  categoryId: string;
  categoryName: string;
  dailyPace: number;
  projected: number;
}

export interface AnalyticsForecast {
  month: string;
  monthSoFar: number;
  fixedDone: { total: number; items: FixedExpenseItem[] };
  fixedPending: { total: number; items: FixedExpenseItem[] };
  variable: VariableProjection;
  categoryPaces: CategoryPace[];
  projectedTotal: number;
  budget: number | null;
  breathingRoom: number | null;
  confidence: ConfidenceLevel;
  dataMonths: number;
}

// ═══════════════════════════════════════════════
// Main Entry Point
// ═══════════════════════════════════════════════

export async function getAnalyticsForecast(
  userId: string,
  month?: string,
): Promise<AnalyticsForecast> {
  const db = getDatabase();

  const now = new Date();
  const yearMonth = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Try V2 engine if classifications exist
  const v2Result = await tryV2Forecast(userId, yearMonth);
  if (v2Result) return v2Result;

  const { startDate, endDate } = getMonthDateRange(yearMonth);
  const daysInMonth = getTotalDaysInMonth(yearMonth);
  const daysLeft = getDaysRemaining(yearMonth);
  const daysElapsed = daysInMonth - daysLeft;

  // 1. Get all active monthly recurring transactions (fixed expenses)
  const recurrings = await db.getAllAsync<{
    id: string;
    merchant_normalized: string;
    amount: number;
    frequency: string;
    category_id: string | null;
    last_seen_date: string;
  }>(
    `SELECT id, merchant_normalized, amount, frequency, category_id, last_seen_date
     FROM recurring_transactions
     WHERE user_id = ? AND is_active = 1 AND frequency = 'monthly'
     ORDER BY amount DESC;`,
    userId,
  );

  // 2. Get all approved expenses this month.
  //    `amount` = raw (used for recurring-rule matching via 10% tolerance).
  //    `effective_amount` = refund-adjusted (used for totals + variable calc).
  const monthExpenses = await db.getAllAsync<{
    id: string;
    amount: number;
    effective_amount: number;
    merchant_name: string | null;
    date: string;
    category_id: string | null;
  }>(
    `SELECT id, amount, ${effectiveAmountSql("expenses")} as effective_amount, merchant_name, date, category_id FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND date >= ? AND date <= ?
       AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id)
       AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id)
     ORDER BY date ASC;`,
    userId,
    startDate,
    endDate,
  );

  // 3. Match recurring to actual expenses (amount-match uses raw amount —
  //    rent is still rent even if refunded; the rule should still match).
  const matchedExpenseIds = new Set<string>();
  const fixedDoneItems: FixedExpenseItem[] = [];
  const fixedPendingItems: FixedExpenseItem[] = [];

  for (const rec of recurrings) {
    const expectedDay = extractExpectedDay(rec.last_seen_date);
    const match = monthExpenses.find((exp) => {
      if (matchedExpenseIds.has(exp.id)) return false;
      if (!exp.merchant_name) return false;
      const normalized = normalizeMerchant(exp.merchant_name);
      if (normalized !== rec.merchant_normalized) return false;
      // Amount within 10% tolerance (slightly more relaxed for price changes)
      if (rec.amount === 0) return exp.amount === 0;
      return Math.abs(exp.amount - rec.amount) / rec.amount <= 0.10;
    });

    const item: FixedExpenseItem = {
      id: rec.id,
      merchant: rec.merchant_normalized,
      amount: rec.amount,
      expectedDay,
      frequency: rec.frequency,
      categoryId: rec.category_id,
      arrived: !!match,
      // For display, prefer the refund-adjusted amount — a fully-refunded
      // fixed expense shouldn't inflate the "fixed done" number.
      actualAmount: match?.effective_amount,
      actualDate: match?.date,
    };

    if (match) {
      matchedExpenseIds.add(match.id);
      fixedDoneItems.push(item);
    } else {
      fixedPendingItems.push(item);
    }
  }

  const fixedDoneTotal = round2(fixedDoneItems.reduce((s, i) => s + (i.actualAmount ?? i.amount), 0));
  const fixedPendingTotal = round2(fixedPendingItems.reduce((s, i) => s + i.amount, 0));

  // 4. Variable = all month spend minus matched fixed expenses
  const totalMonthSpend = round2(monthExpenses.reduce((s, e) => s + e.effective_amount, 0));
  const variableSpent = round2(totalMonthSpend - fixedDoneTotal);

  // 5. Daily pace for variable spending
  const dailyPace = daysElapsed > 0 ? round2(variableSpent / daysElapsed) : 0;
  const projectedVariable = round2(variableSpent + dailyPace * daysLeft);

  // 6. Historical variable avg (last 3 months, excluding fixed)
  const historicalAvg = await getHistoricalVariableAvg(userId, yearMonth, recurrings.length);

  // 7. Category paces (variable only — exclude matched fixed expenses).
  //    Use effective_amount so refunded items don't inflate category pace.
  const categoryPaces = calculateCategoryPaces(
    monthExpenses.map((e) => ({ id: e.id, amount: e.effective_amount, category_id: e.category_id })),
    matchedExpenseIds,
    daysElapsed,
    daysLeft,
  );

  // 8. Total budget for the month
  const budgetRow = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(amount) as total FROM budgets WHERE user_id = ? AND month = ?;`,
    userId,
    yearMonth,
  );
  const budget = budgetRow?.total ?? null;

  // 9. Projected total
  // Pace-based projection: fixed expenses paid + unpaid bills + variable
  // extrapolated at the same daily pace. Floor at (totalMonthSpend +
  // fixedPendingTotal) — projection can never be less than what's already
  // been spent plus bills we know are coming.
  const paceProjected = round2(fixedDoneTotal + fixedPendingTotal + projectedVariable);
  const minProjected = round2(totalMonthSpend + fixedPendingTotal);
  const projectedTotal = Math.max(paceProjected, minProjected);

  // 10. Confidence level
  const dataMonths = await getDataMonthCount(userId);
  const confidence = computeConfidence(dataMonths, recurrings.length);

  return {
    month: yearMonth,
    monthSoFar: totalMonthSpend,
    fixedDone: { total: fixedDoneTotal, items: fixedDoneItems },
    fixedPending: { total: fixedPendingTotal, items: fixedPendingItems },
    variable: {
      spentSoFar: variableSpent,
      dailyPace,
      daysElapsed,
      daysLeft,
      projected: projectedVariable,
      historicalAvg,
    },
    categoryPaces,
    projectedTotal,
    budget,
    breathingRoom: budget != null ? round2(budget - projectedTotal) : null,
    confidence,
    dataMonths,
  };
}

// ═══════════════════════════════════════════════
// V2 Engine Delegation
// ═══════════════════════════════════════════════

async function tryV2Forecast(userId: string, month: string): Promise<AnalyticsForecast | null> {
  const classifications = await getActiveClassifications(userId);
  if (classifications.length === 0) return null;

  const { startDate, endDate } = getMonthDateRange(month);
  const db = getDatabase();

  // `amount` is replaced with effective amount so the V2 forecast engine
  // (which sums `amount` for totals) reflects refunds.
  const expenses = await db.getAllAsync<Expense>(
    `SELECT *, ${effectiveAmountSql("expenses")} as amount FROM expenses
     WHERE user_id = ? AND date >= ? AND date <= ?
       AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id)
       AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id)
     ORDER BY date ASC;`,
    userId,
    startDate,
    endDate,
  );

  const budgets = await getBudgetsForMonth(userId, month);
  const dataMonths = await getDataMonthCount(userId);
  const historicalVariableAvg = await getHistVarAvg(userId, Math.min(dataMonths, 6), month, classifications);

  const result = await forecastMonthEndRealistic({
    userId,
    month,
    expenses,
    classifications,
    budgets,
    historicalVariableAvg,
    dataMonths,
  });

  const totalMonthSpend = expenses.reduce((s, e) => s + e.amount, 0);

  return {
    month,
    monthSoFar: round2(totalMonthSpend),
    fixedDone: {
      total: result.fixedDone.total,
      items: result.fixedDone.items.map((i) => ({
        id: i.classificationId,
        merchant: i.merchant,
        amount: i.expectedAmount,
        expectedDay: i.expectedDay,
        frequency: i.frequency,
        categoryId: i.categoryId,
        arrived: true,
        actualAmount: i.actualAmount,
        actualDate: i.actualDate,
      })),
    },
    fixedPending: {
      total: result.fixedPending.total,
      items: result.fixedPending.items.map((i) => ({
        id: i.classificationId,
        merchant: i.merchant,
        amount: i.expectedAmount,
        expectedDay: i.expectedDay,
        frequency: i.frequency,
        categoryId: i.categoryId,
        arrived: false,
      })),
    },
    variable: {
      spentSoFar: result.variable.spentSoFar,
      dailyPace: result.variable.dailyPace,
      daysElapsed: result.variable.daysElapsed,
      daysLeft: result.variable.daysLeft,
      projected: result.variable.projected,
      historicalAvg: result.variable.historicalAvg,
    },
    categoryPaces: result.variable.categoryPaces.map((cp) => ({
      categoryId: cp.categoryId,
      categoryName: cp.categoryName,
      dailyPace: cp.dailyPace,
      projected: cp.projected,
    })),
    projectedTotal: result.projectedTotal,
    budget: result.budget,
    breathingRoom: result.breathingRoom,
    confidence: result.confidence,
    dataMonths: result.dataMonths,
  };
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function extractExpectedDay(lastSeenDate: string): number {
  const parts = lastSeenDate.split("-");
  return parseInt(parts[2], 10) || 1;
}

async function getHistoricalVariableAvg(
  userId: string,
  currentMonth: string,
  fixedCount: number,
): Promise<number> {
  if (fixedCount === 0) return 0;

  const db = getDatabase();
  const [year, month] = currentMonth.split("-").map(Number);

  // Get total spend for 3 previous months
  const threeMonthsAgo = new Date(year, month - 4, 1);
  const prevMonthEnd = new Date(year, month - 1, 0);
  const histStart = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, "0")}-01`;
  const histEnd = `${prevMonthEnd.getFullYear()}-${String(prevMonthEnd.getMonth() + 1).padStart(2, "0")}-${String(prevMonthEnd.getDate()).padStart(2, "0")}`;

  const row = await db.getFirstAsync<{ total: number | null; months: number }>(
    `SELECT SUM(${effectiveAmountSql("expenses")}) as total, COUNT(DISTINCT strftime('%Y-%m', date)) as months
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND date >= ? AND date <= ?
       AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id)
       AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id);`,
    userId,
    histStart,
    histEnd,
  );

  if (!row?.total || !row.months) return 0;

  // Estimate fixed portion from recurring amounts
  const fixedMonthlyTotal = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(amount) as total FROM recurring_transactions
     WHERE user_id = ? AND is_active = 1 AND frequency = 'monthly';`,
    userId,
  );

  const avgMonthlyTotal = row.total / row.months;
  const estimatedFixedPerMonth = fixedMonthlyTotal?.total ?? 0;
  return round2(Math.max(0, avgMonthlyTotal - estimatedFixedPerMonth));
}

function calculateCategoryPaces(
  expenses: { id: string; amount: number; category_id: string | null }[],
  excludeIds: Set<string>,
  daysElapsed: number,
  daysLeft: number,
): CategoryPace[] {
  if (daysElapsed === 0) return [];

  const categoryTotals = new Map<string, number>();
  for (const exp of expenses) {
    if (excludeIds.has(exp.id)) continue;
    const catId = exp.category_id ?? "uncategorized";
    categoryTotals.set(catId, (categoryTotals.get(catId) ?? 0) + exp.amount);
  }

  return Array.from(categoryTotals.entries())
    .map(([categoryId, total]) => {
      const dailyPace = round2(total / daysElapsed);
      return {
        categoryId,
        categoryName: "",
        dailyPace,
        projected: round2(total + dailyPace * daysLeft),
      };
    })
    .sort((a, b) => b.projected - a.projected);
}

async function getDataMonthCount(userId: string): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ months: number }>(
    `SELECT COUNT(DISTINCT strftime('%Y-%m', date)) as months
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id)
       AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id);`,
    userId,
  );
  return row?.months ?? 0;
}

function computeConfidence(dataMonths: number, patternCount: number): ConfidenceLevel {
  if (dataMonths < 2) return "learning";
  if (dataMonths < 3 || patternCount < 2) return "low";
  if (dataMonths < 4 || patternCount < 4) return "moderate";
  if (dataMonths >= 6 && patternCount >= 5) return "confirmed";
  return "high";
}
