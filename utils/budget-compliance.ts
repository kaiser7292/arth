/**
 * Budget Compliance Calculations — Task 7.4
 *
 * Pure functions for answering: "If I continue at this rate,
 * what's my projected end state for the month and year?"
 */

export interface MonthlyComplianceSnapshot {
  // Current month
  daysElapsed: number;
  daysTotal: number;
  daysRemaining: number;
  spentSoFar: number;
  monthlyBudget: number;
  budgetLeftPct: number;
  dailySpendRate: number;
  projectedMonthEnd: number;
  monthlyProjectedSavings: number;
  monthlyOnTrack: boolean;

  // Annual (if yearly plan exists)
  annualIncome: number | null;
  annualBudget: number | null;
  annualSpentYTD: number | null;
  monthsElapsed: number | null;
  monthsRemaining: number | null;
  annualProjectedSpend: number | null;
  annualProjectedSavings: number | null;
  annualBudgetLeftPct: number | null;
  annualOnTrack: boolean | null;
}

export interface MonthlyComplianceInput {
  daysElapsed: number;
  daysTotal: number;
  spentSoFar: number;
  monthlyBudget: number;
  // Optional annual context
  annualIncome?: number;
  annualBudget?: number;
  annualSpentYTD?: number;
  monthsElapsed?: number;
}

export function calculateMonthlyCompliance(
  input: MonthlyComplianceInput,
): MonthlyComplianceSnapshot {
  const {
    daysElapsed,
    daysTotal,
    spentSoFar,
    monthlyBudget,
  } = input;

  const daysRemaining = Math.max(daysTotal - daysElapsed, 0);
  const dailySpendRate = daysElapsed > 0 ? spentSoFar / daysElapsed : 0;
  const projectedMonthEnd = daysElapsed > 0
    ? dailySpendRate * daysTotal
    : spentSoFar;

  const budgetLeftPct =
    monthlyBudget > 0
      ? Math.max(((monthlyBudget - spentSoFar) / monthlyBudget) * 100, 0)
      : 0;

  const monthlyProjectedSavings = monthlyBudget - projectedMonthEnd;
  const monthlyOnTrack = projectedMonthEnd <= monthlyBudget;

  // Annual projections
  let annualIncome: number | null = null;
  let annualBudget: number | null = null;
  let annualSpentYTD: number | null = null;
  let monthsElapsed: number | null = null;
  let monthsRemaining: number | null = null;
  let annualProjectedSpend: number | null = null;
  let annualProjectedSavings: number | null = null;
  let annualBudgetLeftPct: number | null = null;
  let annualOnTrack: boolean | null = null;

  if (
    input.annualIncome !== undefined &&
    input.annualBudget !== undefined &&
    input.annualSpentYTD !== undefined &&
    input.monthsElapsed !== undefined
  ) {
    annualIncome = input.annualIncome;
    annualBudget = input.annualBudget;
    annualSpentYTD = input.annualSpentYTD;
    monthsElapsed = input.monthsElapsed;
    monthsRemaining = 12 - monthsElapsed;

    // Project annual spend from current monthly rate
    const monthlyAvgSpend =
      monthsElapsed > 0 ? annualSpentYTD / monthsElapsed : spentSoFar;
    annualProjectedSpend = monthlyAvgSpend * 12;
    // Projected savings = planned budget − projected spend.
    // Intentionally NOT using annualIncome so the number reflects budget
    // compliance, not disposable-income math.
    annualProjectedSavings = annualBudget - annualProjectedSpend;

    annualBudgetLeftPct =
      annualBudget > 0
        ? Math.max(
            ((annualBudget - annualSpentYTD) / annualBudget) * 100,
            0,
          )
        : 0;

    annualOnTrack = annualProjectedSpend <= annualBudget;
  }

  return {
    daysElapsed,
    daysTotal,
    daysRemaining,
    spentSoFar,
    monthlyBudget,
    budgetLeftPct,
    dailySpendRate,
    projectedMonthEnd,
    monthlyProjectedSavings,
    monthlyOnTrack,
    annualIncome,
    annualBudget,
    annualSpentYTD,
    monthsElapsed,
    monthsRemaining,
    annualProjectedSpend,
    annualProjectedSavings,
    annualBudgetLeftPct,
    annualOnTrack,
  };
}
