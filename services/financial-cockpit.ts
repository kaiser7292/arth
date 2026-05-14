/**
 * Financial Cockpit — Orchestrator Service
 *
 * Single entry point: getFinancialCockpit(userId, fy).
 * Calls existing services in parallel, feeds data to pure functions
 * in utils/financial-cockpit.ts, returns a unified FinancialCockpitData object.
 *
 * Also provides getRealityCheck() for the Yearly Plan Reality Check card.
 */

import { getDatabase } from "@/database";
import { getCurrentFY, getFYRange, getFYLabel, getFiscalMonth, formatLocalDate } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";
import { round2 } from "@/utils/math";
import { formatCompact } from "@/utils/format";
import { effectiveAmountSql } from "@/services/expense-effective-amount";

import {
  deriveYearlyPlan,
  type DerivedPlanSummary,
  type InvestmentBucket,
} from "@/services/yearly-plan";

import {
  getMilestoneContributionForFY,
  getMilestoneContributionsForFY,
  type LifeMilestone,
} from "@/services/life-milestone";

import { getSavingsSnapshot, getDistinctExpenseMonthsInRange } from "@/services/savings-tracker";

import { getYearEndProjection } from "@/services/forecast-engine";
import type { YearEndProjection } from "@/utils/forecast-engine";
import { getActiveClassifications } from "@/services/analytics/classifier";
import { forecastMonthEndRealistic, getHistoricalVariableAvg as getHistVarAvgV2, projectYearEndRealistic } from "@/services/analytics/forecast-engine-v2";
import { getBudgetsForMonth } from "@/services/budget";
import type { Expense } from "@/services/expense-types";
import { getMonthDateRange } from "@/utils/budget-helpers";

import { getRightSpendTrend } from "@/services/spending-insights";
import { getSalaryCreditDay } from "@/services/salary-profile";

import {
  calculateHealthScore,
  calculateWaterfall,
  calculateBucketAffordability,
  calculateMilestoneRealism,
  generateAdvisories,
  calculateTension,
  buildGoalMatrix,
  type HealthFactor,
  type HealthGrade,
  type WaterfallData,
  type SavingsPulseData,
  type GoalStatus,
  type BucketStatus,
  type MilestoneStatus,
  type Advisory,
  type TensionData,
} from "@/utils/financial-cockpit";

// ── Exported Types ──

export interface FinancialCockpitData {
  financialYear: string;
  fyLabel: string;
  fiscalMonth: number;
  monthsElapsed: number;
  monthsRemaining: number;
  healthScore: number;
  healthGrade: HealthGrade;
  healthFactors: HealthFactor[];
  waterfall: WaterfallData;
  savings: SavingsPulseData;
  goals: GoalStatus[];
  buckets: BucketStatus[];
  milestones: MilestoneStatus[];
  advisories: Advisory[];
  tension: TensionData;
  /** v17.3.0 — net principal reduced on debt_payoff buckets for this FY. */
  debtReducedYTD: number;
  /** v17.3.0 — annual debt-reduction target (sum across debt_payoff buckets). */
  debtReductionTarget: number;
}

export interface RealityCheckData {
  financialYear: string;
  fyLabel: string;
  monthsElapsed: number;
  monthsRemaining: number;
  isPastFY: boolean;
  rows: RealityCheckRow[];
  netSurplusPlanned: number;
  netSurplusProjected: number;
  overallCorrection: number;
  overallStatus: "on_track" | "needs_correction";
  summaryLines: string[];
}

export interface RealityCheckRow {
  label: string;
  planned: number;
  actualYTD: number;
  proratedTarget: number;
  gap: number;
  gapLabel: string;
  isAhead: boolean;
  monthlyCorrection: number;
  correctionLabel: string;
}

/**
 * How many fiscal months should be treated as "elapsed" for pacing math.
 *
 * Policy (Option D): the current month is only counted as elapsed once the
 * user's salary has actually credited. That means if today is before the
 * salary-credit day of the month AND the user hasn't contributed to any
 * milestone/investment this month, we subtract 1 from fiscalMonth so the
 * "reality check" doesn't tell them they're behind just because payroll
 * hasn't run yet. Contributions already made override the rule — you clearly
 * had the money.
 */
async function computeMonthsElapsed(
  userId: string,
  fy: string,
  fiscalMonth: number,
): Promise<number> {
  const creditDay = await getSalaryCreditDay(userId, fy);
  const today = new Date();
  const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const db = getDatabase();
  const [milestoneContribRow, investmentContribRow] = await Promise.all([
    db
      .getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM milestone_contributions WHERE month = ?;`,
        currentMonthStr,
      )
      .catch(() => null),
    db
      .getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM investment_contributions WHERE month = ?;`,
        currentMonthStr,
      )
      .catch(() => null),
  ]);
  const hasContributedThisMonth =
    (milestoneContribRow?.count ?? 0) > 0 ||
    (investmentContribRow?.count ?? 0) > 0;
  const pastCreditDay = today.getDate() >= creditDay;
  const currentMonthCounts = pastCreditDay || hasContributedThisMonth;
  return currentMonthCounts ? fiscalMonth : Math.max(0, fiscalMonth - 1);
}

// ── Main Orchestrator ──

export async function getFinancialCockpit(
  userId: string,
  financialYear?: string,
): Promise<FinancialCockpitData | null> {
  const startMonth = getFYStartMonth();
  const fy = financialYear ?? String(getCurrentFY(startMonth));
  const fyYear = parseInt(fy, 10);
  const fyLabel = getFYLabel(fyYear, startMonth);
  const fiscalMonth = getFiscalMonth(startMonth);
  // Option D: treat current month as "elapsed" only after the user's salary-credit day,
  // OR if any contribution (milestone or investment) has already been made this month.
  // Otherwise subtract 1 so on-track checks don't flag users as behind when they haven't
  // been paid yet this month.
  const monthsElapsed = await computeMonthsElapsed(userId, fy, fiscalMonth);
  const monthsRemaining = 12 - monthsElapsed;

  // ── Parallel fetch all data (plan includes buckets & milestones — reuse them) ──
  const [plan, savings, yearEndOld, spendTrend] = await Promise.all([
    deriveYearlyPlan(userId, fy),
    getSavingsSnapshot(userId, fyYear),
    getYearEndProjection(userId, startMonth),
    getRightSpendTrend(userId, 6),
  ]);

  // Try V2 year-end projection if classifications available
  const yearEnd = await tryV2YearEnd(userId, fyYear, startMonth, yearEndOld);

  if (!plan || plan.total_income === 0) return null;

  // Reuse buckets & milestones already fetched inside deriveYearlyPlan
  const buckets = plan._buckets;
  const milestones = plan._milestones;

  // Batch-build linked bucket map from bucket data (no N+1 queries)
  const linkedBucketMap = new Map<string, string[]>();
  for (const b of buckets) {
    if (b.linked_milestone_id) {
      const existing = linkedBucketMap.get(b.linked_milestone_id) ?? [];
      existing.push(b.name);
      linkedBucketMap.set(b.linked_milestone_id, existing);
    }
  }

  // ── Compute investment totals ──
  // v17.3.0: debt_payoff buckets are debt reduction, not investments. We keep
  // them in the total for backward-compat scoring but surface a separate
  // debtReducedYTD metric so UI can show both.
  const investmentBuckets = buckets.filter((b) => b.bucket_type !== "debt_payoff");
  const debtBuckets = buckets.filter((b) => b.bucket_type === "debt_payoff");
  const totalInvestmentContributed = investmentBuckets.reduce((s, b) => s + b.current_contributed, 0);
  const totalInvestmentTarget = investmentBuckets.reduce((s, b) => s + b.annual_target, 0);
  const proratedInvestmentTarget = (totalInvestmentTarget / 12) * monthsElapsed;
  const totalDebtReducedYTD = debtBuckets.reduce((s, b) => s + b.current_contributed, 0);
  const totalDebtReductionTarget = debtBuckets.reduce((s, b) => s + b.annual_target, 0);

  // ── Compute milestone totals (dedup linked milestones) ──
  // planned: already deduped by deriveYearlyPlan
  const totalMilestonePlanned = plan.total_planned_milestones;
  // actuals: for linked milestones, current_saved includes bucket contributions
  // which are already in totalInvestmentContributed — deduct the overlap
  const linkedBucketContribByMilestone = new Map<string, number>();
  for (const b of buckets) {
    if (b.linked_milestone_id) {
      const existing = linkedBucketContribByMilestone.get(b.linked_milestone_id) ?? 0;
      linkedBucketContribByMilestone.set(b.linked_milestone_id, existing + b.current_contributed);
    }
  }
  const totalMilestoneActualYTD = milestones.reduce((s, m) => {
    const linkedContrib = linkedBucketContribByMilestone.get(m.id) ?? 0;
    return s + Math.max(0, m.current_saved - linkedContrib);
  }, 0);

  // ── Expenses ──
  const expensesActualYTD = savings?.totalExpenses ?? 0;
  const projectedAnnualSpend = yearEnd?.projectedAnnualSpend ?? null;
  const budgetedExpensesYTD = monthsElapsed > 0
    ? (plan.total_planned_expenses / 12) * monthsElapsed
    : 0;

  // ── Discretionary spend (from right-spend trend) ──
  const discretionarySpendYTD = spendTrend.monthly.reduce(
    (s, m) => s + (m.total - m.rightSpend),
    0,
  );

  // ── Waterfall ──
  const waterfall = calculateWaterfall({
    totalIncome: plan.total_income,
    monthsElapsed,
    monthsRemaining,
    expensesPlanned: plan.total_planned_expenses,
    expensesActualYTD,
    projectedAnnualSpend,
    investmentsPlanned: totalInvestmentTarget,
    investmentsActualYTD: totalInvestmentContributed,
    milestonesPlanned: totalMilestonePlanned,
    milestonesActualYTD: totalMilestoneActualYTD,
  });

  // ── Bucket Affordability ──
  const totalBucketsMonthlyNeeded = monthsRemaining > 0
    ? buckets.reduce((s, b) => {
        const remaining = Math.max(0, b.annual_target - b.current_contributed);
        return s + remaining / monthsRemaining;
      }, 0)
    : 0;

  const bucketStatuses: BucketStatus[] = buckets.map((b) => {
    const linkedMilestone = milestones.find((m) =>
      buckets.some((lb) => lb.linked_milestone_id === m.id && lb.id === b.id),
    );
    return calculateBucketAffordability({
      id: b.id,
      name: b.name,
      annualTarget: b.annual_target,
      currentContributed: b.current_contributed,
      linkedMilestoneName: linkedMilestone?.name ?? null,
      monthsElapsed,
      monthsRemaining,
    });
  });

  // ── Milestone Realism ──
  const totalGoalsMonthlyNeeded = totalBucketsMonthlyNeeded +
    milestones.reduce((s, m) => s + m.monthly_contribution_planned, 0);

  const milestoneStatuses: MilestoneStatus[] = milestones.map((m) =>
    calculateMilestoneRealism({
      id: m.id,
      name: m.name,
      targetAmount: m.target_amount,
      currentSaved: m.current_saved,
      targetDate: m.target_date,
      monthlyPlanned: m.monthly_contribution_planned,
      linkedBucketNames: linkedBucketMap.get(m.id) ?? [],
      breathingRoomMonthly: waterfall.breathingRoomMonthly,
      totalGoalsMonthlyNeeded,
      isCompleted: m.is_completed === 1,
    }),
  );

  // ── Health Score ──
  const goalProgressPcts = [
    ...bucketStatuses.map((b) => b.progressPct),
    ...milestoneStatuses.map((m) => m.progressPct),
  ];

  const monthlyIncome = plan.total_income / 12;

  const health = calculateHealthScore({
    actualSavingsRatePct: savings?.actualSavingsRatePct ?? 0,
    targetSavingsRatePct: savings?.targetSavingsRatePct ?? 0,
    totalInvestmentContributed,
    proratedInvestmentTarget,
    actualExpensesYTD: expensesActualYTD,
    budgetedExpensesYTD,
    goalProgressPcts,
    breathingRoom: waterfall.breathingRoomMonthly,
    monthlyIncome,
  });

  // ── Savings Pulse ──
  const savingsPulse: SavingsPulseData = {
    actualRatePct: savings?.actualSavingsRatePct ?? 0,
    targetRatePct: savings?.targetSavingsRatePct ?? 0,
    isOnTrack: savings?.isOnTrack ?? false,
    savingsGap: savings?.savingsGap ?? 0,
    projectedYearEndRate: savings?.projectedYearEndRatePct ?? 0,
    projectedYearEndSavings: savings?.projectedYearEndSavings ?? 0,
    courseCorrectionPerMonth: savings?.courseCorrectionPerMonth ?? 0,
    avgMonthlySavings: savings?.avgMonthlySavings ?? 0,
    totalSaved: savings?.actualSaved ?? 0,
    targetSavings: savings?.annualTargetSavings ?? 0,
  };

  // ── Advisories ──
  const advisories = generateAdvisories({
    waterfall,
    savingsRateActual: savingsPulse.actualRatePct,
    savingsRateTarget: savingsPulse.targetRatePct,
    buckets: bucketStatuses,
    milestones: milestoneStatuses,
    monthsRemaining,
  });

  // ── Tension ──
  const tension = calculateTension({
    expensesActualYTD,
    expensesBudgetedAnnual: plan.total_planned_expenses,
    monthsElapsed,
    monthsRemaining,
    discretionarySpendYTD,
    buckets: bucketStatuses,
    breathingRoomMonthly: waterfall.breathingRoomMonthly,
  });

  // ── Goal Matrix ──
  const goals = buildGoalMatrix(bucketStatuses, milestoneStatuses);

  return {
    financialYear: fy,
    fyLabel,
    fiscalMonth,
    monthsElapsed,
    monthsRemaining,
    healthScore: health.score,
    healthGrade: health.grade,
    healthFactors: health.factors,
    waterfall,
    savings: savingsPulse,
    goals,
    buckets: bucketStatuses,
    milestones: milestoneStatuses,
    advisories,
    tension,
    debtReducedYTD: totalDebtReducedYTD,
    debtReductionTarget: totalDebtReductionTarget,
  };
}

// ── Reality Check (for Yearly Plan screen) ──

export async function getRealityCheck(
  userId: string,
  financialYear?: string,
  precomputedPlan?: DerivedPlanSummary,
): Promise<RealityCheckData | null> {
  const startMonth = getFYStartMonth();
  const currentFYNum = getCurrentFY(startMonth);
  const fy = financialYear ?? String(currentFYNum);
  const fyYear = parseInt(fy, 10);
  const fyLabel = getFYLabel(fyYear, startMonth);
  const isPastFY = fyYear < currentFYNum;

  const { start: fyStart, end: fyEnd } = getFYRange(fyYear, startMonth);
  const fyStartStr = formatLocalDate(fyStart);
  const fyEndStr = formatLocalDate(fyEnd);

  const [plan, savings, dataMonths] = await Promise.all([
    precomputedPlan ?? deriveYearlyPlan(userId, fy),
    getSavingsSnapshot(userId, fyYear),
    getDistinctExpenseMonthsInRange(userId, fyStartStr, fyEndStr),
  ]);

  if (!plan || plan.total_income === 0) return null;

  // Pacing: for the current FY, honour the salary-credit day (see
  // computeMonthsElapsed). Still floor at dataMonths — if the user has already
  // spent activity in this month, count it regardless of payroll timing.
  const fiscalMonth = getFiscalMonth(startMonth);
  const paceMonths = isPastFY
    ? 12
    : await computeMonthsElapsed(userId, fy, fiscalMonth);
  const monthsElapsed = isPastFY ? 12 : Math.max(dataMonths, paceMonths);
  const monthsRemaining = isPastFY ? 0 : 12 - monthsElapsed;

  const buckets = plan._buckets;
  const milestones = plan._milestones;

  const expensesActualYTD = savings?.totalExpenses ?? 0;
  const investActualYTD = buckets.reduce((s, b) => s + b.current_contributed, 0);
  const milestoneActualYTD = await getMilestoneContributionsForFY(
    milestones.map((m) => m.id),
    fyStartStr,
    fyEndStr,
  );

  const rows: RealityCheckRow[] = [
    buildRealityRow("Expenses", plan.total_planned_expenses, expensesActualYTD, monthsElapsed, monthsRemaining, true),
    buildRealityRow("Investments", plan.total_planned_investments, investActualYTD, monthsElapsed, monthsRemaining, false),
    buildRealityRow("Milestones", plan.total_planned_milestones, milestoneActualYTD, monthsElapsed, monthsRemaining, false),
  ];

  const totalPlannedOutflow = plan.total_planned_expenses + plan.total_planned_investments + plan.total_planned_milestones;
  const totalActualOutflowYTD = expensesActualYTD + investActualYTD + milestoneActualYTD;
  const netSurplusPlanned = plan.total_income - totalPlannedOutflow;

  const projectedOutflow = monthsElapsed > 0 ? (totalActualOutflowYTD / monthsElapsed) * 12 : totalPlannedOutflow;
  const netSurplusProjected = isPastFY
    ? plan.total_income - totalActualOutflowYTD
    : plan.total_income - projectedOutflow;

  const hasCorrections = !isPastFY && rows.some((r) => !r.isAhead);

  const summaryLines: string[] = [];
  if (isPastFY) {
    const diff = netSurplusProjected - netSurplusPlanned;
    if (diff >= 0) {
      summaryLines.push(`Finished ${formatCompact(diff)} better than planned`);
    } else {
      summaryLines.push(`Finished ${formatCompact(Math.abs(diff))} worse than planned`);
    }
  } else {
    for (const r of rows) {
      if (r.monthlyCorrection === 0) continue;
      if (r.label === "Expenses" && !r.isAhead) {
        summaryLines.push(`Cut ${formatCompact(Math.abs(r.monthlyCorrection))}/mo from expenses`);
      } else if (r.label === "Expenses" && r.isAhead) {
        summaryLines.push(`${formatCompact(r.gap)} surplus on expenses`);
      } else if (!r.isAhead) {
        summaryLines.push(`Add ${formatCompact(Math.abs(r.monthlyCorrection))}/mo to ${r.label.toLowerCase()}`);
      } else {
        summaryLines.push(`${formatCompact(r.gap)} ahead on ${r.label.toLowerCase()}`);
      }
    }
  }

  return {
    financialYear: fy,
    fyLabel,
    monthsElapsed,
    monthsRemaining,
    isPastFY,
    rows,
    netSurplusPlanned: round2(netSurplusPlanned),
    netSurplusProjected: round2(netSurplusProjected),
    overallCorrection: round2(isPastFY ? 0 : rows.reduce((s, r) => s + Math.abs(r.monthlyCorrection), 0)),
    overallStatus: hasCorrections ? "needs_correction" : "on_track",
    summaryLines,
  };
}

// ── Helpers ──

function buildRealityRow(
  label: string,
  annualPlanned: number,
  actualYTD: number,
  monthsElapsed: number,
  monthsRemaining: number,
  lowerIsBetter: boolean,
): RealityCheckRow {
  const proratedTarget = monthsElapsed > 0
    ? round2((annualPlanned / 12) * monthsElapsed)
    : 0;
  const gap = round2(actualYTD - proratedTarget);

  let isAhead: boolean;
  if (lowerIsBetter) {
    isAhead = gap <= 0;
  } else {
    isAhead = gap >= 0;
  }

  let gapLabel: string;
  if (Math.abs(gap) < 1) {
    gapLabel = "On Track";
  } else if (lowerIsBetter) {
    gapLabel = gap > 0 ? `${formatCompact(gap)} over` : `${formatCompact(Math.abs(gap))} under`;
  } else {
    gapLabel = gap > 0 ? `${formatCompact(gap)} ahead` : `${formatCompact(Math.abs(gap))} behind`;
  }

  let monthlyCorrection = 0;
  let correctionLabel = "On Track";
  if (!isAhead && monthsRemaining > 0 && Math.abs(gap) >= 1) {
    monthlyCorrection = round2(Math.abs(gap) / monthsRemaining);
    if (lowerIsBetter) {
      correctionLabel = `Cut ${formatCompact(monthlyCorrection)}/mo`;
    } else {
      correctionLabel = `Add ${formatCompact(monthlyCorrection)}/mo`;
    }
  } else if (isAhead && Math.abs(gap) >= 1) {
    correctionLabel = `${formatCompact(Math.abs(gap))} surplus`;
    monthlyCorrection = round2(Math.abs(gap) / Math.max(monthsRemaining, 1));
  }

  return {
    label,
    planned: round2(annualPlanned),
    actualYTD: round2(actualYTD),
    proratedTarget,
    gap,
    gapLabel,
    isAhead,
    monthlyCorrection,
    correctionLabel,
  };
}

async function tryV2YearEnd(
  userId: string,
  fyYear: number,
  startMonth: number,
  fallback: YearEndProjection | null,
): Promise<YearEndProjection | null> {
  try {
    const classifications = await getActiveClassifications(userId);
    if (classifications.length === 0) return fallback;

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const { startDate, endDate } = getMonthDateRange(currentMonth);
    const db = getDatabase();

    // Current-month expenses feed forecastMonthEndRealistic — which sums
    // `amount` to categorize variable / fixed spend and project month-end.
    // Overriding `amount` to effective amount here ensures refunded items
    // stop inflating the projection. The `id` column is still unique so
    // downstream classifier joins still work.
    const expenses = await db.getAllAsync<Expense>(
      `SELECT *, ${effectiveAmountSql("expenses")} as amount FROM expenses
       WHERE user_id = ? AND date >= ? AND date <= ?
         AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id)
         AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id);`,
      userId, startDate, endDate,
    );

    const budgets = await getBudgetsForMonth(userId, currentMonth);
    const dataMonths = await db.getFirstAsync<{ months: number }>(
      `SELECT COUNT(DISTINCT strftime('%Y-%m', date)) as months FROM expenses WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id) AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id);`,
      userId,
    );
    const months = dataMonths?.months ?? 0;
    const historicalAvg = await getHistVarAvgV2(userId, Math.min(months, 6), currentMonth, classifications);

    const monthForecast = await forecastMonthEndRealistic({
      userId, month: currentMonth, expenses, classifications, budgets, historicalVariableAvg: historicalAvg, dataMonths: months,
    });

    // Get past months' spending in this FY
    const fyStart = new Date(fyYear, startMonth - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const fyStartStr = `${fyStart.getFullYear()}-${String(fyStart.getMonth() + 1).padStart(2, "0")}-01`;
    const prevEndStr = `${prevMonthEnd.getFullYear()}-${String(prevMonthEnd.getMonth() + 1).padStart(2, "0")}-${String(prevMonthEnd.getDate()).padStart(2, "0")}`;

    const pastMonths = await db.getAllAsync<{ m: string; total: number }>(
      `SELECT strftime('%Y-%m', date) as m, SUM(${effectiveAmountSql("expenses")}) as total FROM expenses WHERE user_id = ? AND date >= ? AND date <= ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id) AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id) GROUP BY m ORDER BY m;`,
      userId, fyStartStr, prevEndStr,
    );

    const v2Result = projectYearEndRealistic({
      userId, fyYear, fyStartMonth: startMonth,
      currentMonthForecast: monthForecast,
      pastMonthsSpent: pastMonths.map((p: { m: string; total: number }) => p.total),
      annualBudget: fallback?.annualBudget ?? null,
      dataMonths: months,
      classificationCount: classifications.length,
    });

    const annualBudget = v2Result.annualBudget ?? fallback?.annualBudget ?? 0;
    const projectedSavings = annualBudget - v2Result.projectedTotal;
    const projectedSavingsRatePct = annualBudget > 0 ? (projectedSavings / annualBudget) * 100 : 0;

    return {
      projectedAnnualSpend: v2Result.projectedTotal,
      annualBudget,
      projectedSavings,
      projectedSavingsRatePct,
      monthlyAvgSpend: v2Result.monthlyAvgProjected,
      monthsOfData: months,
    };
  } catch {
    return fallback;
  }
}

