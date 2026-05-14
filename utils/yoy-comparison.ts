/**
 * Year-over-Year Comparison
 *
 * Compares two financial years side-by-side with planned vs actual
 * for each category: income, expenses, investments, milestones, savings rate.
 */

export interface FYData {
  financialYear: string;
  annualIncome: number;
  totalPlannedExpenses: number;
  totalActualExpenses: number;
  actualSavingsRatePct: number;
  totalPlannedInvestments: number;
  totalActualInvestments: number;
  totalPlannedMilestones: number;
  totalActualMilestones: number;
  /** v17.5.1 — loan EMIs + prepayments, INR only. */
  totalPlannedLoanOutflow: number;
  totalActualLoanOutflow: number;
}

export interface YoYCategory {
  label: string;
  prevPlanned: number;
  prevActual: number;
  currPlanned: number;
  currActual: number;
  isAmount: boolean;
  /**
   * YoY row direction — TRUE means a year-over-year decrease is "better"
   * (green arrow in row badges). Used by ChangeBadge.
   */
  lowerIsBetter: boolean;
  /**
   * Plan-vs-Actual gap direction — defaults to `lowerIsBetter`. Diverges
   * for debt: paying off more than planned (actual > planned) is GOOD even
   * though the row itself is `lowerIsBetter` (we want outflow to shrink YoY).
   * Explicit to avoid silent drift.
   */
  gapActualHigherIsBetter?: boolean;
}

export interface YoYComparison {
  previousFY: string;
  currentFY: string;
  categories: YoYCategory[];
  overallTrend: "improved" | "declined" | "mixed";
}

export function calculateYoYComparison(
  previous: FYData,
  current: FYData,
): YoYComparison {
  const categories: YoYCategory[] = [
    {
      label: "Income",
      prevPlanned: previous.annualIncome,
      prevActual: previous.annualIncome,
      currPlanned: current.annualIncome,
      currActual: current.annualIncome,
      isAmount: true,
      lowerIsBetter: false,
    },
    {
      label: "Expenses",
      prevPlanned: previous.totalPlannedExpenses,
      prevActual: previous.totalActualExpenses,
      currPlanned: current.totalPlannedExpenses,
      currActual: current.totalActualExpenses,
      isAmount: true,
      lowerIsBetter: true,
    },
    {
      label: "Investments",
      prevPlanned: previous.totalPlannedInvestments,
      prevActual: previous.totalActualInvestments,
      currPlanned: current.totalPlannedInvestments,
      currActual: current.totalActualInvestments,
      isAmount: true,
      lowerIsBetter: false,
    },
    {
      label: "Milestones",
      prevPlanned: previous.totalPlannedMilestones,
      prevActual: previous.totalActualMilestones,
      currPlanned: current.totalPlannedMilestones,
      currActual: current.totalActualMilestones,
      isAmount: true,
      lowerIsBetter: false,
    },
    {
      label: "Loans & Debts",
      prevPlanned: previous.totalPlannedLoanOutflow,
      prevActual: previous.totalActualLoanOutflow,
      currPlanned: current.totalPlannedLoanOutflow,
      currActual: current.totalActualLoanOutflow,
      isAmount: true,
      lowerIsBetter: true,
      // Paying off MORE debt than planned is a win — gap actual > planned = good.
      gapActualHigherIsBetter: true,
    },
    {
      label: "Savings Rate",
      prevPlanned: previous.annualIncome > 0
        ? Math.round(((previous.annualIncome - previous.totalPlannedExpenses) / previous.annualIncome) * 1000) / 10
        : 0,
      prevActual: previous.actualSavingsRatePct,
      currPlanned: current.annualIncome > 0
        ? Math.round(((current.annualIncome - current.totalPlannedExpenses) / current.annualIncome) * 1000) / 10
        : 0,
      currActual: current.actualSavingsRatePct,
      isAmount: false,
      lowerIsBetter: false,
    },
  ];

  let improvements = 0;
  let declines = 0;
  for (const c of categories) {
    if (c.label === "Income") continue;
    const prevGap = c.prevActual - c.prevPlanned;
    const currGap = c.currActual - c.currPlanned;
    // Gap direction defaults to row direction; Loans & Debts overrides so
    // that over-delivering (actual > planned) counts as improvement.
    const gapHigherIsBetter = c.gapActualHigherIsBetter ?? !c.lowerIsBetter;
    const betterGap = gapHigherIsBetter ? currGap > prevGap : currGap < prevGap;
    if (betterGap) improvements++;
    else if (currGap !== prevGap) declines++;
  }

  let overallTrend: "improved" | "declined" | "mixed";
  if (improvements > declines) overallTrend = "improved";
  else if (declines > improvements) overallTrend = "declined";
  else overallTrend = "mixed";

  return {
    previousFY: previous.financialYear,
    currentFY: current.financialYear,
    categories,
    overallTrend,
  };
}
