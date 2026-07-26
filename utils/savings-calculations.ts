/**
 * Savings Rate Goal calculations — Task 6.2.
 *
 * These are pure functions for computing savings trajectory, course correction,
 * and projected year-end savings. Based on PRD F15 + Section 5.3.
 *
 * Formulas from PRD:
 * - actual_savings_rate = (income_received - total_expenses) / income_received * 100
 * - savings_on_track = actual_savings_rate >= savings_rate_target_pct
 * - course_correction_per_month = (target_savings - actual_saved) / remaining_months
 * - projected_year_end_savings = actual_saved + (avg_monthly_savings * remaining_months)
 */

import { round2 } from "@/utils/math";

export interface SavingsSnapshot {
  /** Total income received so far this FY (prorated salary + bonus received) */
  incomeReceived: number;
  /** Total expenses so far this FY */
  totalExpenses: number;
  /** Actual saved = income - expenses */
  actualSaved: number;
  /** Actual savings rate as % of income received */
  actualSavingsRatePct: number;
  /** Target savings rate from yearly plan */
  targetSavingsRatePct: number;
  /** Annual target savings amount (salary * target %) */
  annualTargetSavings: number;
  /** Is the actual rate >= target rate? */
  isOnTrack: boolean;
  /** How much behind/ahead of target (negative = behind) */
  savingsGap: number;
  /** Months elapsed in the FY so far */
  monthsElapsed: number;
  /** Months remaining in the FY */
  monthsRemaining: number;
  /** Average monthly savings so far */
  avgMonthlySavings: number;
  /** Extra savings per month needed to hit annual target */
  courseCorrectionPerMonth: number;
  /** Projected year-end savings at current rate */
  projectedYearEndSavings: number;
  /** Projected year-end savings rate */
  projectedYearEndRatePct: number;
  /** Will projected savings meet the annual target? */
  projectedOnTrack: boolean;
}

/**
 * Calculate a complete savings snapshot for the current point in the FY.
 */
export function calculateSavingsSnapshot(params: {
  /** Annual salary in-hand from yearly plan */
  annualSalary: number;
  /** Expected bonus from yearly plan */
  expectedBonus: number;
  /** Savings rate target % from yearly plan */
  targetSavingsRatePct: number;
  /** Total expenses so far this FY (from actual expense records) */
  totalExpenses: number;
  /** Months elapsed in the FY (1-12). Use getFiscalMonth() for current. */
  monthsElapsed: number;
  /** Actual investment bucket contributions so far this FY */
  investmentContributions?: number;
  /** Actual milestone contributions so far this FY */
  milestoneContributions?: number;
}): SavingsSnapshot {
  const {
    annualSalary,
    expectedBonus,
    targetSavingsRatePct,
    totalExpenses,
    monthsElapsed,
    investmentContributions = 0,
    milestoneContributions = 0,
  } = params;

  const clampedElapsed = Math.min(Math.max(monthsElapsed, 0), 12);
  const monthsRemaining = 12 - clampedElapsed;

  // Income received so far: prorate salary + assume bonus comes at year end (not received yet)
  const incomeReceived = (annualSalary / 12) * clampedElapsed;

  const actualSaved = incomeReceived - totalExpenses;

  // Actual savings rate = (investment contributions + milestone contributions + surplus) / income
  // Where surplus = income - expenses - contributions (undeployed savings)
  const totalDeployed = investmentContributions + milestoneContributions;
  const surplus = Math.max(0, actualSaved - totalDeployed);
  const totalActualSavings = totalDeployed + surplus;
  const actualSavingsRatePct =
    incomeReceived > 0 ? (totalActualSavings / incomeReceived) * 100 : 0;

  const annualTargetSavings = (annualSalary * targetSavingsRatePct) / 100;

  const isOnTrack = actualSavingsRatePct >= targetSavingsRatePct;

  // Target saved by this point = prorated annual target
  const proratedTarget = (annualTargetSavings / 12) * clampedElapsed;
  const savingsGap = actualSaved - proratedTarget;

  const avgMonthlySavings =
    clampedElapsed > 0 ? actualSaved / clampedElapsed : 0;

  // Course correction: how much extra/month to still hit annual target
  const courseCorrectionPerMonth =
    monthsRemaining > 0
      ? (annualTargetSavings - actualSaved) / monthsRemaining
      : 0;

  // Projected year-end savings at current rate
  const projectedYearEndSavings =
    actualSaved + avgMonthlySavings * monthsRemaining;

  // Projected year-end rate (using full annual income including bonus)
  const annualIncome = annualSalary + expectedBonus;
  const projectedYearEndRatePct =
    annualIncome > 0 ? (projectedYearEndSavings / annualIncome) * 100 : 0;

  const projectedOnTrack = projectedYearEndSavings >= annualTargetSavings;

  return {
    incomeReceived: round2(incomeReceived),
    totalExpenses: round2(totalExpenses),
    actualSaved: round2(actualSaved),
    actualSavingsRatePct: round2(actualSavingsRatePct),
    targetSavingsRatePct,
    annualTargetSavings: round2(annualTargetSavings),
    isOnTrack,
    savingsGap: round2(savingsGap),
    monthsElapsed: clampedElapsed,
    monthsRemaining,
    avgMonthlySavings: round2(avgMonthlySavings),
    courseCorrectionPerMonth: round2(courseCorrectionPerMonth),
    projectedYearEndSavings: round2(projectedYearEndSavings),
    projectedYearEndRatePct: round2(projectedYearEndRatePct),
    projectedOnTrack,
  };
}

/**
 * Calculate monthly savings data for trend display.
 * Returns an array of { month, income, expenses, saved, savingsRatePct }.
 */
export function calculateMonthlySavingsTrend(params: {
  annualSalary: number;
  /** Map of fiscal month (1-12) → total expenses for that month */
  monthlyExpenses: Map<number, number>;
  /** Number of fiscal months to include (1-12) */
  monthsToShow: number;
  /** Per-month income overrides: fiscal month (1-12) → income for that month */
  monthlyIncomeOverrides?: Map<number, number>;
}): Array<{
  fiscalMonth: number;
  income: number;
  expenses: number;
  saved: number;
  savingsRatePct: number;
}> {
  const defaultMonthlyIncome = params.annualSalary / 12;
  const result = [];

  for (let fm = 1; fm <= params.monthsToShow; fm++) {
    const monthlyIncome = params.monthlyIncomeOverrides?.get(fm) ?? defaultMonthlyIncome;
    const expenses = params.monthlyExpenses.get(fm) ?? 0;
    const saved = monthlyIncome - expenses;
    const savingsRatePct =
      monthlyIncome > 0 ? (saved / monthlyIncome) * 100 : 0;

    result.push({
      fiscalMonth: fm,
      income: round2(monthlyIncome),
      expenses: round2(expenses),
      saved: round2(saved),
      savingsRatePct: round2(savingsRatePct),
    });
  }

  return result;
}

