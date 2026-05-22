/**
 * Predictive Forecast Engine — Pure Calculations (Task 23.0)
 *
 * Predicts month-end totals per category using:
 * 1. Current pace (daily burn rate × remaining days)
 * 2. Historical seasonality (same month last year or 3-month avg)
 * 3. Blended forecast (weighted combination)
 *
 * Also provides budget breach predictions and year-end savings projection.
 */

import { round2 } from "@/utils/math";

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

export interface CategoryForecast {
  categoryId: string;
  /** Spent so far this month */
  spentSoFar: number;
  /** Monthly budget for this category */
  budget: number;
  /** Predicted month-end total (blended) */
  predictedTotal: number;
  /** Prediction from current daily pace */
  paceBasedTotal: number;
  /** Prediction from historical average for this month */
  historicalTotal: number;
  /** Will this category exceed its budget? */
  willExceedBudget: boolean;
  /** Predicted overspend amount (0 if within budget) */
  predictedOverspend: number;
  /** Confidence: 'high' if pace + historical agree, 'medium' otherwise */
  confidence: "high" | "medium" | "low";
}

export interface MonthEndForecast {
  /** Total predicted spending this month */
  totalPredictedSpend: number;
  /** Total budget across all categories */
  totalBudget: number;
  /** Will total spending exceed total budget? */
  willExceedOverall: boolean;
  /** Predicted surplus or deficit (positive = under budget) */
  predictedSurplusDeficit: number;
  /** Per-category forecasts */
  categories: CategoryForecast[];
  /** Categories predicted to breach budget, sorted by overspend amount */
  breachAlerts: CategoryForecast[];
}

export interface YearEndProjection {
  /** Projected total annual spending */
  projectedAnnualSpend: number;
  /** Annual budget (if yearly plan exists) */
  annualBudget: number;
  /** Projected annual savings */
  projectedSavings: number;
  /** Projected savings rate % */
  projectedSavingsRatePct: number;
  /** Monthly average spending at current pace */
  monthlyAvgSpend: number;
  /** Months of data used for projection */
  monthsOfData: number;
}

// ═══════════════════════════════════════════════
// Input types
// ═══════════════════════════════════════════════

export interface CategoryMonthData {
  categoryId: string;
  spentSoFar: number;
  budget: number;
  /** Average monthly spend from last 3 months (for seasonality) */
  historicalMonthlyAvg: number;
  /** Same month last year spend (if available) */
  sameMonthLastYear: number | null;
}

export interface ForecastInput {
  daysElapsed: number;
  daysInMonth: number;
  categories: CategoryMonthData[];
}

export interface YearEndInput {
  annualIncome: number;
  annualBudget: number;
  totalSpentYTD: number;
  monthsElapsed: number;
  /** Monthly spend totals for months that have passed */
  monthlyTotals: number[];
}

// ═══════════════════════════════════════════════
// Month-End Forecast
// ═══════════════════════════════════════════════

/**
 * Predict month-end totals for each category.
 *
 * Blending strategy:
 * - If < 5 days elapsed: weight historical 80%, pace 20%
 * - If 5-15 days elapsed: weight historical 40%, pace 60%
 * - If > 15 days elapsed: weight historical 20%, pace 80%
 */
export function forecastMonthEnd(input: ForecastInput): MonthEndForecast {
  const { daysElapsed, daysInMonth, categories } = input;
  const daysRemaining = Math.max(daysInMonth - daysElapsed, 0);

  // Determine pace vs historical weights
  const paceWeight = daysElapsed < 5 ? 0.2 : daysElapsed <= 15 ? 0.6 : 0.8;
  const histWeight = 1 - paceWeight;

  const forecasts: CategoryForecast[] = categories.map((cat) => {
    // Pace-based: extrapolate current daily rate
    const dailyRate = daysElapsed > 0 ? cat.spentSoFar / daysElapsed : 0;
    const paceBasedTotal = daysElapsed > 0
      ? cat.spentSoFar + dailyRate * daysRemaining
      : cat.historicalMonthlyAvg;

    // Historical: use same-month-last-year if available, else 3-month avg
    const historicalTotal = cat.sameMonthLastYear ?? cat.historicalMonthlyAvg;

    // Blended prediction. Floor at spentSoFar — projection can never be
    // less than what's already been spent on this category.
    const blended = paceBasedTotal * paceWeight + historicalTotal * histWeight;
    const predictedTotal = round2(Math.max(blended, cat.spentSoFar));

    // Budget breach
    const willExceedBudget = cat.budget > 0 && predictedTotal > cat.budget;
    const predictedOverspend = willExceedBudget
      ? round2(predictedTotal - cat.budget)
      : 0;

    // Confidence: high if pace and historical agree within 20%
    const agreement =
      historicalTotal > 0
        ? Math.abs(paceBasedTotal - historicalTotal) / historicalTotal
        : 1;
    const confidence: "high" | "medium" | "low" =
      agreement < 0.2 ? "high" : agreement < 0.5 ? "medium" : "low";

    return {
      categoryId: cat.categoryId,
      spentSoFar: round2(cat.spentSoFar),
      budget: cat.budget,
      predictedTotal,
      paceBasedTotal: round2(paceBasedTotal),
      historicalTotal: round2(historicalTotal),
      willExceedBudget,
      predictedOverspend,
      confidence,
    };
  });

  const totalPredictedSpend = round2(
    forecasts.reduce((sum, f) => sum + f.predictedTotal, 0),
  );
  const totalBudget = round2(
    forecasts.reduce((sum, f) => sum + f.budget, 0),
  );

  const breachAlerts = forecasts
    .filter((f) => f.willExceedBudget)
    .sort((a, b) => b.predictedOverspend - a.predictedOverspend);

  return {
    totalPredictedSpend,
    totalBudget,
    willExceedOverall: totalBudget > 0 && totalPredictedSpend > totalBudget,
    predictedSurplusDeficit: round2(totalBudget - totalPredictedSpend),
    categories: forecasts,
    breachAlerts,
  };
}

// ═══════════════════════════════════════════════
// Year-End Projection
// ═══════════════════════════════════════════════

/**
 * Project year-end totals based on spending so far.
 *
 * Uses weighted average of recent months (more weight to recent)
 * rather than simple average, to capture trends.
 */
export function projectYearEnd(input: YearEndInput): YearEndProjection {
  const { annualIncome, annualBudget, totalSpentYTD, monthsElapsed, monthlyTotals } = input;

  if (monthsElapsed <= 0) {
    return {
      projectedAnnualSpend: 0,
      annualBudget,
      projectedSavings: annualIncome,
      projectedSavingsRatePct: 100,
      monthlyAvgSpend: 0,
      monthsOfData: 0,
    };
  }

  // Weighted average: recent months count more
  let monthlyAvgSpend: number;
  if (monthlyTotals.length >= 3) {
    // Weighted: last month 50%, previous 30%, before that 20%
    const recent = monthlyTotals.slice(-3);
    monthlyAvgSpend = recent[2] * 0.5 + recent[1] * 0.3 + recent[0] * 0.2;
  } else {
    monthlyAvgSpend = totalSpentYTD / monthsElapsed;
  }

  const monthsRemaining = 12 - monthsElapsed;
  const projectedAnnualSpend = round2(
    totalSpentYTD + monthlyAvgSpend * monthsRemaining,
  );

  const projectedSavings = round2(annualIncome - projectedAnnualSpend);
  const projectedSavingsRatePct =
    annualIncome > 0
      ? round2((projectedSavings / annualIncome) * 100)
      : 0;

  return {
    projectedAnnualSpend,
    annualBudget,
    projectedSavings,
    projectedSavingsRatePct,
    monthlyAvgSpend: round2(monthlyAvgSpend),
    monthsOfData: monthsElapsed,
  };
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

