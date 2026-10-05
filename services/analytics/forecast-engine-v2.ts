import { getDatabase } from "@/database";
import { getMonthDateRange, getDaysElapsed, getDaysRemaining } from "@/utils/budget-helpers";
import { getSpendingRows, median } from "./spending-rows";
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
import { normalizeMerchant } from "@/services/smart-categorizer";

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
  const { endDate } = getMonthDateRange(month);
  const daysLeft = getDaysRemaining(month);
  // Days of the month so far, counting today (today's spending is already in). A past month is
  // over — its "projection" is what was spent; a future month has only history to go on.
  const daysElapsed = getDaysElapsed(month);
  const isPast = daysLeft === 0;
  const isFuture = daysElapsed === 0;

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

  // Fixed pending: expected but not yet paid. Nothing is pending in a month that's over.
  const matchedClassificationIds = new Set(fixedDoneItems.map((i) => i.classificationId));
  const fixedPendingItems: FixedForecastItem[] = isPast
    ? []
    : fixedClassifications
        .filter((cls) => {
          // Weekly bills recur within the month, so one payment doesn't settle them.
          if (cls.frequency === "weekly") return true;
          if (matchedClassificationIds.has(cls.id)) return false;
          if (cls.frequency === "yearly" || cls.frequency === "quarterly") {
            return expectedThisMonth(cls, month);
          }
          return cls.frequency === "monthly";
        })
        .map((cls) => {
          const each = (cls.amount_range_low + cls.amount_range_high) / 2;
          // Weekly: one for each week still to come (a future month: the whole month's worth).
          const times = cls.frequency === "weekly" ? Math.max(1, Math.ceil(daysLeft / 7)) : 1;
          return {
            classificationId: cls.id,
            merchant: cls.merchant_normalized,
            expectedAmount: each * times,
            expectedDay: cls.expected_day_of_month ?? 15,
            frequency: cls.frequency ?? "monthly",
            categoryId: cls.category_id,
            arrived: false,
          };
        });

  // Reminders you set up (rent, school fees …) due later this month and not yet paid are bills
  // too — unless a learned pattern already covers the same merchant.
  if (!isPast) {
    const covered = new Set(fixedPendingItems.map((i) => i.merchant));
    for (const r of await dueReminders(input.userId, month, endDate)) {
      if (r.merchant && covered.has(r.merchant)) continue;
      fixedPendingItems.push({
        classificationId: `reminder:${r.id}`,
        merchant: r.merchant ?? "Reminder",
        expectedAmount: r.amount,
        expectedDay: Number(r.next_due_date.slice(8, 10)),
        frequency: r.frequency,
        categoryId: r.category_id,
        arrived: false,
      });
    }
  }

  const fixedDoneTotal = fixedDoneItems.reduce((s, i) => s + (i.actualAmount ?? i.expectedAmount), 0);
  const fixedPendingTotal = fixedPendingItems.reduce((s, i) => s + i.expectedAmount, 0);

  // Variable projection: today's pace over the rest of the month, blended with the usual month.
  // Days count from the 1st (not from the first variable expense — a month whose first spend
  // was yesterday used to project as if only one day had passed).
  const variableSpent = variableExpenses.reduce((s, e) => s + e.amount, 0);
  const variableDaysElapsed = daysElapsed;
  const variableDailyRate = variableDaysElapsed > 0 ? variableSpent / variableDaysElapsed : 0;
  const variableProjectedRemaining = variableDailyRate * daysLeft;

  // Floor at variableSpent — blending must never project less than what's already spent.
  const blendedVariableRaw = isPast
    ? variableSpent
    : isFuture
      ? historicalVariableAvg
      : blendProjection(variableSpent + variableProjectedRemaining, historicalVariableAvg, variableDaysElapsed);
  const blendedVariable = Math.max(blendedVariableRaw, variableSpent);

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

  // Floor projection at (actual spend so far + pending fixed bills).
  // The blended variable can dip below variableSpent when historical average
  // is lower than current pace (common early in the month) — but you can't
  // un-spend money. Projection must be ≥ what's already on the books.
  // Use the raw expense sum (not fixedDoneTotal + variableSpent) because
  // multiple expenses matching the same fixed classification only get one
  // entry in fixedDoneTotal — the rest would be lost.
  const totalSpentSoFar = expenses.reduce((s, e) => s + e.amount, 0);
  const paceProjected = fixedDoneTotal + fixedPendingTotal + blendedVariable;
  const minProjected = totalSpentSoFar + fixedPendingTotal;
  const projectedTotal = Math.round(Math.max(paceProjected, minProjected));
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
  const variableDays = getDaysElapsed(month);
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

/**
 * The usual month's variable spending: the MEDIAN over the last `months` months of spending
 * (same rule as this month — no transfers, investments, loan payments; refunds netted), counting
 * only the part that isn't a learned fixed bill. Median, so one unusual month can't skew it.
 */
export async function getHistoricalVariableAvg(
  userId: string,
  months: number,
  currentMonth: string,
  classifications: ExpenseClassificationRow[]
): Promise<number> {
  const totals: number[] = [];
  const [year, m] = currentMonth.split("-").map(Number);

  for (let i = 1; i <= months; i++) {
    const d = new Date(year, m - 1 - i, 1);
    const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const { startDate, endDate } = getMonthDateRange(monthStr);
    const rows = await getSpendingRows(userId, startDate, endDate);
    if (rows.length === 0) continue; // no data that month — don't count it as a ₹0 month
    let variableTotal = 0;
    for (const row of rows) {
      if (classifyExpense(row, classifications) === "variable") variableTotal += row.amount;
    }
    totals.push(variableTotal);
  }
  return median(totals);
}

interface DueReminder {
  id: string;
  amount: number;
  next_due_date: string;
  frequency: string;
  merchant: string | null;
  category_id: string | null;
}

/** Active reminders with an amount, due from today to the month's end (not yet paid this cycle). */
async function dueReminders(userId: string, month: string, endDate: string): Promise<DueReminder[]> {
  try {
    const db = getDatabase();
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const from = `${month}-01` > today ? `${month}-01` : today;
    const rows = await db.getAllAsync<DueReminder & { merchant_name: string | null }>(
      `SELECT r.id, r.amount, r.next_due_date, r.frequency, e.merchant_name, e.category_id
         FROM recurring_expense_rules r
         LEFT JOIN expenses e ON e.id = r.source_expense_id
        WHERE r.user_id = ? AND r.is_active = 1 AND r.amount IS NOT NULL AND r.amount > 0
          AND r.next_due_date >= ? AND r.next_due_date <= ?;`,
      userId,
      from,
      endDate,
    );
    return rows.map((r) => ({ ...r, merchant: r.merchant_name ? normalizeMerchant(r.merchant_name) : null }));
  } catch {
    return [];
  }
}

/** A yearly / quarterly bill is due this month when the month lines up with when it was last seen. */
function expectedThisMonth(cls: ExpenseClassificationRow, month: string): boolean {
  if (!cls.last_seen_date) return false;
  const seen = Number(cls.last_seen_date.slice(5, 7));
  const now = Number(month.slice(5, 7));
  const gap = cls.frequency === "quarterly" ? 3 : 12;
  return (now - seen + 12) % gap === 0 && month > cls.last_seen_date.slice(0, 7);
}

// ─── Helpers ───

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
