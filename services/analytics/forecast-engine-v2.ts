import { getDatabase } from "@/database";
import { getMonthDateRange, getDaysRemaining, getTotalDaysInMonth } from "@/utils/budget-helpers";
import { THRESHOLDS } from "@/utils/analytics/thresholds";
import type {
  RealisticForecast,
  FixedForecastItem,
  VariableForecast,
  CategoryPace,
  CategoryForecast,
  ConfidenceLevel,
  YearEndForecast,
} from "@/utils/analytics/types";
import type { Expense } from "@/services/expense-types";
import type { ExpenseClassificationRow } from "./classifier";
import {
  getActiveClassifications,
  classifyExpense,
  getFixedClassifications,
  matchesClassification,
} from "./classifier";
import type { Budget } from "@/services/budget";

export interface ForecastInput {
  userId: string;
  month: string;
  expenses: Expense[];
  classifications: ExpenseClassificationRow[];
  budgets: Budget[];
  historicalVariableAvg: number;
  dataMonths: number;
}

export async function forecastMonthEndRealistic(input: ForecastInput): Promise<RealisticForecast> {
  const { month, expenses, classifications, budgets, historicalVariableAvg, dataMonths } = input;
  const { startDate, endDate } = getMonthDateRange(month);
  const today = new Date();
  const dayOfMonth = today.getDate();
  const totalDays = getTotalDaysInMonth(month);
  const daysLeft = getDaysRemaining(month);

  const fixedClassifications = getFixedClassifications(classifications);

  // Classify current month expenses
  const fixedExpenses: Expense[] = [];
  const variableExpenses: Expense[] = [];

  for (const e of expenses) {
    const cls = classifyExpense(e, classifications);
    if (cls === "fixed" || cls === "semi_fixed") {
      fixedExpenses.push(e);
    } else {
      variableExpenses.push(e);
    }
  }

  // Fixed done: already paid this month
  const fixedDoneItems: FixedForecastItem[] = fixedClassifications
    .filter((cls) => {
      return expenses.some((e) => matchesClassification(e, cls));
    })
    .map((cls) => {
      const matchedExpense = expenses.find((e) => matchesClassification(e, cls));
      return {
        classificationId: cls.id,
        merchant: cls.merchant_normalized,
        expectedAmount: (cls.amount_range_low + cls.amount_range_high) / 2,
        expectedDay: cls.expected_day_of_month ?? 1,
        frequency: cls.frequency ?? "monthly",
        categoryId: cls.category_id,
        arrived: true,
        actualExpenseId: matchedExpense?.id,
        actualAmount: matchedExpense?.amount,
        actualDate: matchedExpense?.date,
      };
    });

  // Fixed pending: expected but not yet paid
  const matchedClassificationIds = new Set(fixedDoneItems.map((i) => i.classificationId));
  const fixedPendingItems: FixedForecastItem[] = fixedClassifications
    .filter((cls) => {
      if (matchedClassificationIds.has(cls.id)) return false;
      if (cls.frequency === "yearly") {
        const expectedMonth = cls.last_seen_date?.slice(5, 7);
        const currentMonth = month.slice(5, 7);
        return expectedMonth === currentMonth;
      }
      return cls.frequency === "monthly" || cls.frequency === "weekly";
    })
    .map((cls) => ({
      classificationId: cls.id,
      merchant: cls.merchant_normalized,
      expectedAmount: (cls.amount_range_low + cls.amount_range_high) / 2,
      expectedDay: cls.expected_day_of_month ?? 15,
      frequency: cls.frequency ?? "monthly",
      categoryId: cls.category_id,
      arrived: false,
    }));

  const fixedDoneTotal = fixedDoneItems.reduce((s, i) => s + (i.actualAmount ?? i.expectedAmount), 0);
  const fixedPendingTotal = fixedPendingItems.reduce((s, i) => s + i.expectedAmount, 0);

  // Variable projection
  const variableSpent = variableExpenses.reduce((s, e) => s + e.amount, 0);
  const variableDaysElapsed = getVariableDaysElapsed(variableExpenses, startDate);
  const variableDailyRate = variableDaysElapsed > 0 ? variableSpent / variableDaysElapsed : 0;
  const variableProjectedRemaining = variableDailyRate * daysLeft;

  // Blend with historical for early-month stability
  const blendedVariable = blendProjection(
    variableSpent + variableProjectedRemaining,
    historicalVariableAvg,
    variableDaysElapsed
  );

  // Category paces
  const categoryPaces = calculateCategoryPaces(variableExpenses, variableDaysElapsed, daysLeft, budgets);

  const variable: VariableForecast = {
    spentSoFar: variableSpent,
    dailyPace: Math.round(variableDailyRate),
    daysElapsed: variableDaysElapsed,
    daysLeft,
    projected: Math.round(blendedVariable),
    historicalAvg: Math.round(historicalVariableAvg),
    categoryPaces,
  };

  const projectedTotal = Math.round(fixedDoneTotal + fixedPendingTotal + blendedVariable);
  const totalBudget = budgets.reduce((s, b) => s + b.amount, 0) || null;
  const breathingRoom = totalBudget ? totalBudget - projectedTotal : null;

  const confidence = determineConfidence(dataMonths, variableDaysElapsed, classifications.length);

  return {
    month,
    fixedDone: { total: Math.round(fixedDoneTotal), items: fixedDoneItems },
    fixedPending: { total: Math.round(fixedPendingTotal), items: fixedPendingItems },
    variable,
    projectedTotal,
    budget: totalBudget,
    breathingRoom,
    confidence,
    dataMonths,
  };
}

export function forecastCategoryRealistic(
  expenses: Expense[],
  classifications: ExpenseClassificationRow[],
  budgets: Budget[],
  month: string
): CategoryForecast[] {
  const daysLeft = getDaysRemaining(month);
  const categoryMap = new Map<string, { fixed: number; variable: Expense[] }>();

  for (const e of expenses) {
    const catId = e.category_id ?? "__uncategorized__";
    const cls = classifyExpense(e, classifications);
    const entry = categoryMap.get(catId) ?? { fixed: 0, variable: [] };

    if (cls === "fixed" || cls === "semi_fixed") {
      entry.fixed += e.amount;
    } else {
      entry.variable.push(e);
    }
    categoryMap.set(catId, entry);
  }

  const results: CategoryForecast[] = [];
  for (const [catId, data] of categoryMap) {
    const variableSpent = data.variable.reduce((s, e) => s + e.amount, 0);
    const variableDays = getVariableDaysElapsed(data.variable, `${month}-01`);
    const variableRate = variableDays > 0 ? variableSpent / variableDays : 0;
    const variableProjected = variableSpent + variableRate * daysLeft;

    const totalProjected = Math.round(data.fixed + variableProjected);
    const budget = budgets.find((b) => b.category_id === catId);
    const budgetAmount = budget?.amount ?? null;

    let breachDriver: CategoryForecast["breachDriver"];
    if (budgetAmount && totalProjected > budgetAmount) {
      if (data.fixed > budgetAmount) {
        breachDriver = "fixed_costs_exceed_budget";
      } else {
        breachDriver = "variable_pace_too_high";
      }
    }

    results.push({
      categoryId: catId,
      categoryName: "",
      fixedTotal: Math.round(data.fixed),
      variableProjected: Math.round(variableProjected),
      totalProjected,
      budget: budgetAmount,
      breachDriver,
    });
  }

  return results.sort((a, b) => b.totalProjected - a.totalProjected);
}

export async function getHistoricalVariableAvg(
  userId: string,
  months: number,
  currentMonth: string,
  classifications: ExpenseClassificationRow[]
): Promise<number> {
  const db = getDatabase();
  const totals: number[] = [];

  for (let i = 1; i <= months; i++) {
    const [year, m] = currentMonth.split("-").map(Number);
    const d = new Date(year, m - 1 - i, 1);
    const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const { startDate, endDate } = getMonthDateRange(monthStr);

    const rows = await db.getAllAsync<{ amount: number; merchant_name: string | null }>(
      `SELECT amount, merchant_name FROM expenses
       WHERE user_id = ? AND date >= ? AND date <= ?
         AND status != 'rejected' AND nature = 'realized' AND deleted_at IS NULL;`,
      userId,
      startDate,
      endDate
    );

    let variableTotal = 0;
    for (const row of rows) {
      const expense = row as unknown as Expense;
      const cls = classifyExpense(expense, classifications);
      if (cls === "variable") variableTotal += row.amount;
    }
    totals.push(variableTotal);
  }

  if (totals.length === 0) return 0;
  return totals.reduce((s, t) => s + t, 0) / totals.length;
}

// ─── Helpers ───

function getVariableDaysElapsed(variableExpenses: Expense[], monthStart: string): number {
  if (variableExpenses.length === 0) return 0;
  const sorted = variableExpenses.map((e) => e.date).sort();
  const firstDate = new Date(sorted[0]);
  const today = new Date();
  const diff = Math.floor((today.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(diff, 1);
}

function blendProjection(
  paceProjection: number,
  historicalAvg: number,
  daysElapsed: number
): number {
  if (historicalAvg <= 0) return paceProjection;

  const earlyDays = THRESHOLDS.FORECAST_EARLY_MONTH_DAYS;
  if (daysElapsed < earlyDays) {
    const histWeight = THRESHOLDS.FORECAST_HISTORICAL_WEIGHT_EARLY;
    return historicalAvg * histWeight + paceProjection * (1 - histWeight);
  } else if (daysElapsed <= 12) {
    return paceProjection * 0.6 + historicalAvg * 0.4;
  } else {
    const histWeight = THRESHOLDS.FORECAST_HISTORICAL_WEIGHT_LATE;
    return paceProjection * (1 - histWeight) + historicalAvg * histWeight;
  }
}

function calculateCategoryPaces(
  variableExpenses: Expense[],
  daysElapsed: number,
  daysLeft: number,
  budgets: Budget[]
): CategoryPace[] {
  const catMap = new Map<string, number>();
  for (const e of variableExpenses) {
    const catId = e.category_id ?? "__uncategorized__";
    catMap.set(catId, (catMap.get(catId) ?? 0) + e.amount);
  }

  const paces: CategoryPace[] = [];
  for (const [catId, spent] of catMap) {
    const dailyPace = daysElapsed > 0 ? spent / daysElapsed : 0;
    const projected = spent + dailyPace * daysLeft;
    const budget = budgets.find((b) => b.category_id === catId);

    paces.push({
      categoryId: catId,
      categoryName: "",
      dailyPace: Math.round(dailyPace),
      projected: Math.round(projected),
      budget: budget?.amount ?? null,
    });
  }

  return paces.sort((a, b) => b.projected - a.projected).slice(0, 8);
}

function determineConfidence(
  dataMonths: number,
  variableDaysElapsed: number,
  classificationCount: number
): ConfidenceLevel {
  if (classificationCount === 0) return "learning";
  if (dataMonths < 2) return "low";
  if (dataMonths < 4 || variableDaysElapsed < 7) return "moderate";
  if (dataMonths >= THRESHOLDS.HIGH_CONFIDENCE_MONTHS) return "confirmed";
  return "high";
}

export interface YearEndInput {
  userId: string;
  fyYear: number;
  fyStartMonth: number;
  currentMonthForecast: RealisticForecast;
  pastMonthsSpent: number[];
  annualBudget: number | null;
  dataMonths: number;
  classificationCount: number;
}

export function projectYearEndRealistic(input: YearEndInput): YearEndForecast {
  const {
    fyYear,
    fyStartMonth,
    currentMonthForecast,
    pastMonthsSpent,
    annualBudget,
    dataMonths,
    classificationCount,
  } = input;

  const today = new Date();
  const currentCalMonth = today.getMonth() + 1;
  const currentFiscalMonth = currentCalMonth >= fyStartMonth
    ? currentCalMonth - fyStartMonth + 1
    : currentCalMonth + 12 - fyStartMonth + 1;

  const monthsElapsed = currentFiscalMonth;
  const monthsRemaining = 12 - monthsElapsed;

  const actualSpent = pastMonthsSpent.reduce((s, m) => s + m, 0);
  const monthlyAvgActual = pastMonthsSpent.length > 0
    ? actualSpent / pastMonthsSpent.length
    : 0;

  const currentMonthProjected = currentMonthForecast.projectedTotal;
  const monthlyAvgProjected = pastMonthsSpent.length > 0
    ? (actualSpent + currentMonthProjected) / (pastMonthsSpent.length + 1)
    : currentMonthProjected;

  const projectedRemaining = currentMonthProjected + monthlyAvgProjected * Math.max(monthsRemaining - 1, 0);
  const projectedTotal = actualSpent + projectedRemaining;

  const confidence = determineConfidence(dataMonths, monthsElapsed * 15, classificationCount);
  const breathingRoom = annualBudget ? annualBudget - projectedTotal : null;

  return {
    fyYear,
    monthsElapsed,
    monthsRemaining,
    actualSpent: Math.round(actualSpent),
    projectedRemaining: Math.round(projectedRemaining),
    projectedTotal: Math.round(projectedTotal),
    monthlyAvgActual: Math.round(monthlyAvgActual),
    monthlyAvgProjected: Math.round(monthlyAvgProjected),
    annualBudget,
    breathingRoom: breathingRoom !== null ? Math.round(breathingRoom) : null,
    confidence,
  };
}
