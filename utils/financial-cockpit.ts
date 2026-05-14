/**
 * Financial Cockpit — Pure Computation Functions
 *
 * All formulas for the unified financial cockpit. No DB calls.
 * Pattern follows utils/savings-calculations.ts.
 */

import { round2 } from "@/utils/math";
import { toIsoDate as formatDateStr } from "@/utils/date";

// ── Types ──

export type HealthGrade = "A+" | "A" | "B" | "C" | "D" | "F";
export type GoalStatusLevel = "on_track" | "at_risk" | "needs_attention" | "completed";
export type PaceStatus = "ahead" | "on_track" | "behind";
export type AdvisorySeverity = "celebrate" | "info" | "warning" | "critical";
export type AdvisoryCategory = "spending" | "savings" | "investment" | "milestone" | "general";

export interface HealthFactor {
  name: string;
  score: number;
  weight: number;
  status: "positive" | "neutral" | "negative";
  detail: string;
}

export interface WaterfallData {
  totalIncome: number;
  incomeReceivedYTD: number;
  expensesPlanned: number;
  expensesActualYTD: number;
  expensesProjectedAnnual: number;
  investmentsPlanned: number;
  investmentsActualYTD: number;
  investmentsProjectedAnnual: number;
  milestonesPlanned: number;
  milestonesActualYTD: number;
  milestonesProjectedAnnual: number;
  surplusPlanned: number;
  surplusProjected: number;
  breathingRoom: number;
  breathingRoomMonthly: number;
}

export interface SavingsPulseData {
  actualRatePct: number;
  targetRatePct: number;
  isOnTrack: boolean;
  savingsGap: number;
  projectedYearEndRate: number;
  projectedYearEndSavings: number;
  courseCorrectionPerMonth: number;
  avgMonthlySavings: number;
  totalSaved: number;
  targetSavings: number;
}

export interface GoalStatus {
  id: string;
  name: string;
  type: "bucket" | "milestone";
  status: GoalStatusLevel;
  progressPct: number;
  targetAmount: number;
  currentAmount: number;
  remainingAmount: number;
  projectedCompletion: string | null;
}

export interface BucketStatus {
  id: string;
  name: string;
  annualTarget: number;
  contributed: number;
  progressPct: number;
  remainingTarget: number;
  monthlyRequired: number;
  linkedMilestoneName: string | null;
  paceStatus: PaceStatus;
  projectedYearEndContribution: number;
}

export interface MilestoneStatus {
  id: string;
  name: string;
  targetAmount: number;
  currentSaved: number;
  progressPct: number;
  targetDate: string | null;
  monthlyPlanned: number;
  monthlyRealistic: number;
  realisticCompletionDate: string | null;
  plannedCompletionDate: string | null;
  slippageMonths: number;
  status: GoalStatusLevel;
  linkedBucketNames: string[];
}

export interface Advisory {
  id: string;
  severity: AdvisorySeverity;
  title: string;
  message: string;
  action: string | null;
  relatedGoalId: string | null;
  category: AdvisoryCategory;
}

export interface TensionData {
  spendingPaceAnnualized: number;
  spendingBudgeted: number;
  overspendAnnualized: number;
  goalsAtRiskFromOverspend: string[];
  discretionarySpendYTD: number;
  discretionaryCutNeeded: number;
}

// ── Health Score ──

export interface HealthScoreInput {
  actualSavingsRatePct: number;
  targetSavingsRatePct: number;
  totalInvestmentContributed: number;
  proratedInvestmentTarget: number;
  actualExpensesYTD: number;
  budgetedExpensesYTD: number;
  goalProgressPcts: number[];
  breathingRoom: number;
  monthlyIncome: number;
}

export function calculateHealthScore(input: HealthScoreInput): {
  score: number;
  grade: HealthGrade;
  factors: HealthFactor[];
} {
  const savingsScore = input.targetSavingsRatePct > 0
    ? Math.min(100, (input.actualSavingsRatePct / input.targetSavingsRatePct) * 100)
    : 50;

  const investmentPaceScore = input.proratedInvestmentTarget > 0
    ? Math.min(100, (input.totalInvestmentContributed / input.proratedInvestmentTarget) * 100)
    : 50;

  const overspendPct = input.budgetedExpensesYTD > 0
    ? Math.max(0, ((input.actualExpensesYTD - input.budgetedExpensesYTD) / input.budgetedExpensesYTD) * 100)
    : 0;
  const spendingScore = input.actualExpensesYTD <= input.budgetedExpensesYTD
    ? 100
    : Math.max(0, 100 - overspendPct * 5);

  const goalProgressScore = input.goalProgressPcts.length > 0
    ? input.goalProgressPcts.reduce((a, b) => a + b, 0) / input.goalProgressPcts.length
    : 50;

  const breathingRoomScore = input.breathingRoom > 0 && input.monthlyIncome > 0
    ? Math.min(100, (input.breathingRoom / input.monthlyIncome) * 200)
    : input.breathingRoom <= 0 ? 0 : 50;

  const score = round2(
    0.30 * savingsScore +
    0.25 * investmentPaceScore +
    0.20 * spendingScore +
    0.15 * goalProgressScore +
    0.10 * breathingRoomScore,
  );

  const clampedScore = Math.max(0, Math.min(100, score));

  const factors: HealthFactor[] = [
    {
      name: "Savings",
      score: round2(savingsScore),
      weight: 0.30,
      status: savingsScore >= 80 ? "positive" : savingsScore >= 50 ? "neutral" : "negative",
      detail: input.targetSavingsRatePct > 0
        ? `${round2(input.actualSavingsRatePct)}% of ${input.targetSavingsRatePct}% target`
        : "No target set",
    },
    {
      name: "Investments",
      score: round2(investmentPaceScore),
      weight: 0.25,
      status: investmentPaceScore >= 80 ? "positive" : investmentPaceScore >= 50 ? "neutral" : "negative",
      detail: investmentPaceScore >= 100 ? "Ahead of schedule" : `${round2(investmentPaceScore)}% of prorated target`,
    },
    {
      name: "Spending",
      score: round2(spendingScore),
      weight: 0.20,
      status: spendingScore >= 80 ? "positive" : spendingScore >= 50 ? "neutral" : "negative",
      detail: spendingScore >= 100 ? "Within budget" : `${round2(overspendPct)}% over budget`,
    },
    {
      name: "Goals",
      score: round2(goalProgressScore),
      weight: 0.15,
      status: goalProgressScore >= 80 ? "positive" : goalProgressScore >= 50 ? "neutral" : "negative",
      detail: `${round2(goalProgressScore)}% avg progress`,
    },
    {
      name: "Surplus",
      score: round2(breathingRoomScore),
      weight: 0.10,
      status: breathingRoomScore >= 60 ? "positive" : breathingRoomScore >= 30 ? "neutral" : "negative",
      detail: input.breathingRoom > 0 ? "Healthy surplus" : "No surplus",
    },
  ];

  return { score: clampedScore, grade: scoreToGrade(clampedScore), factors };
}

function scoreToGrade(score: number): HealthGrade {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

// ── Waterfall ──

export interface WaterfallInput {
  totalIncome: number;
  monthsElapsed: number;
  monthsRemaining: number;
  expensesPlanned: number;
  expensesActualYTD: number;
  projectedAnnualSpend: number | null;
  investmentsPlanned: number;
  investmentsActualYTD: number;
  milestonesPlanned: number;
  milestonesActualYTD: number;
}

export function calculateWaterfall(input: WaterfallInput): WaterfallData {
  const { totalIncome, monthsElapsed, monthsRemaining } = input;
  const incomeReceivedYTD = monthsElapsed > 0 ? (totalIncome / 12) * monthsElapsed : 0;

  const expensesProjectedAnnual = input.projectedAnnualSpend
    ?? (monthsElapsed > 0 ? (input.expensesActualYTD / monthsElapsed) * 12 : input.expensesPlanned);

  const investmentsProjectedAnnual = monthsElapsed > 0
    ? (input.investmentsActualYTD / monthsElapsed) * 12
    : input.investmentsPlanned;

  const milestonesProjectedAnnual = monthsElapsed > 0
    ? (input.milestonesActualYTD / monthsElapsed) * 12
    : input.milestonesPlanned;

  const surplusPlanned = totalIncome - input.expensesPlanned - input.investmentsPlanned - input.milestonesPlanned;
  const surplusProjected = totalIncome - expensesProjectedAnnual - input.investmentsPlanned - input.milestonesPlanned;
  const breathingRoom = surplusProjected;
  const breathingRoomMonthly = monthsRemaining > 0 ? breathingRoom / monthsRemaining : breathingRoom;

  return {
    totalIncome: round2(totalIncome),
    incomeReceivedYTD: round2(incomeReceivedYTD),
    expensesPlanned: round2(input.expensesPlanned),
    expensesActualYTD: round2(input.expensesActualYTD),
    expensesProjectedAnnual: round2(expensesProjectedAnnual),
    investmentsPlanned: round2(input.investmentsPlanned),
    investmentsActualYTD: round2(input.investmentsActualYTD),
    investmentsProjectedAnnual: round2(investmentsProjectedAnnual),
    milestonesPlanned: round2(input.milestonesPlanned),
    milestonesActualYTD: round2(input.milestonesActualYTD),
    milestonesProjectedAnnual: round2(milestonesProjectedAnnual),
    surplusPlanned: round2(surplusPlanned),
    surplusProjected: round2(surplusProjected),
    breathingRoom: round2(breathingRoom),
    breathingRoomMonthly: round2(breathingRoomMonthly),
  };
}

// ── Bucket Affordability ──

export interface BucketAffordabilityInput {
  id: string;
  name: string;
  annualTarget: number;
  currentContributed: number;
  linkedMilestoneName: string | null;
  monthsElapsed: number;
  monthsRemaining: number;
}

export function calculateBucketAffordability(input: BucketAffordabilityInput): BucketStatus {
  const remaining = Math.max(0, input.annualTarget - input.currentContributed);
  const progressPct = input.annualTarget > 0
    ? Math.min(100, (input.currentContributed / input.annualTarget) * 100)
    : 0;

  const monthlyRequired = input.monthsRemaining > 0 ? remaining / input.monthsRemaining : remaining;

  const proratedTarget = input.monthsElapsed > 0
    ? (input.annualTarget / 12) * input.monthsElapsed
    : 0;
  let paceStatus: PaceStatus;
  if (proratedTarget > 0) {
    const ratio = input.currentContributed / proratedTarget;
    paceStatus = ratio >= 1.05 ? "ahead" : ratio >= 0.85 ? "on_track" : "behind";
  } else {
    paceStatus = "on_track";
  }

  const avgMonthly = input.monthsElapsed > 0 ? input.currentContributed / input.monthsElapsed : 0;
  const projectedYearEnd = input.currentContributed + avgMonthly * input.monthsRemaining;

  return {
    id: input.id,
    name: input.name,
    annualTarget: input.annualTarget,
    contributed: input.currentContributed,
    progressPct: round2(progressPct),
    remainingTarget: round2(remaining),
    monthlyRequired: round2(monthlyRequired),
    linkedMilestoneName: input.linkedMilestoneName,
    paceStatus,
    projectedYearEndContribution: round2(projectedYearEnd),
  };
}

// ── Milestone Realism ──

export interface MilestoneRealismInput {
  id: string;
  name: string;
  targetAmount: number;
  currentSaved: number;
  targetDate: string | null;
  monthlyPlanned: number;
  linkedBucketNames: string[];
  breathingRoomMonthly: number;
  totalGoalsMonthlyNeeded: number;
  isCompleted: boolean;
}

export function calculateMilestoneRealism(input: MilestoneRealismInput): MilestoneStatus {
  if (input.isCompleted) {
    return {
      id: input.id,
      name: input.name,
      targetAmount: input.targetAmount,
      currentSaved: input.currentSaved,
      progressPct: 100,
      targetDate: input.targetDate,
      monthlyPlanned: input.monthlyPlanned,
      monthlyRealistic: 0,
      realisticCompletionDate: null,
      plannedCompletionDate: null,
      slippageMonths: 0,
      status: "completed",
      linkedBucketNames: input.linkedBucketNames,
    };
  }

  const remaining = Math.max(0, input.targetAmount - input.currentSaved);
  const progressPct = input.targetAmount > 0
    ? Math.min(100, (input.currentSaved / input.targetAmount) * 100)
    : 0;

  // Realistic monthly = proportional share of surplus
  const shareOfSurplus = input.totalGoalsMonthlyNeeded > 0
    ? (input.monthlyPlanned / input.totalGoalsMonthlyNeeded) * input.breathingRoomMonthly
    : input.breathingRoomMonthly;
  const monthlyRealistic = Math.min(input.monthlyPlanned, Math.max(0, shareOfSurplus));

  const plannedMonthsToComplete = input.monthlyPlanned > 0
    ? Math.ceil(remaining / input.monthlyPlanned)
    : null;

  const realisticMonthsToComplete = monthlyRealistic > 0
    ? Math.ceil(remaining / monthlyRealistic)
    : null;

  const now = new Date();
  const plannedCompletionDate = plannedMonthsToComplete != null
    ? addMonths(now, plannedMonthsToComplete)
    : null;

  const realisticCompletionDate = realisticMonthsToComplete != null
    ? addMonths(now, realisticMonthsToComplete)
    : null;

  const slippageMonths = (plannedMonthsToComplete != null && realisticMonthsToComplete != null)
    ? Math.max(0, realisticMonthsToComplete - plannedMonthsToComplete)
    : 0;

  let status: GoalStatusLevel;
  if (progressPct >= 100) {
    status = "completed";
  } else if (slippageMonths > 6 || (monthlyRealistic <= 0 && remaining > 0)) {
    status = "needs_attention";
  } else if (slippageMonths > 2) {
    status = "at_risk";
  } else {
    status = "on_track";
  }

  return {
    id: input.id,
    name: input.name,
    targetAmount: input.targetAmount,
    currentSaved: input.currentSaved,
    progressPct: round2(progressPct),
    targetDate: input.targetDate,
    monthlyPlanned: round2(input.monthlyPlanned),
    monthlyRealistic: round2(monthlyRealistic),
    realisticCompletionDate: realisticCompletionDate ? formatDateStr(realisticCompletionDate) : null,
    plannedCompletionDate: plannedCompletionDate ? formatDateStr(plannedCompletionDate) : null,
    slippageMonths,
    status,
    linkedBucketNames: input.linkedBucketNames,
  };
}

// ── Advisory Generation ──

export interface AdvisoryInput {
  waterfall: WaterfallData;
  savingsRateActual: number;
  savingsRateTarget: number;
  buckets: BucketStatus[];
  milestones: MilestoneStatus[];
  monthsRemaining: number;
}

export function generateAdvisories(input: AdvisoryInput): Advisory[] {
  const advisories: Advisory[] = [];
  let nextId = 1;

  // 1. CRITICAL: Spending threatens goals
  const overspend = input.waterfall.expensesProjectedAnnual - input.waterfall.expensesPlanned;
  if (overspend > 0) {
    const behindFromOverspend = input.buckets.filter((b) => b.paceStatus === "behind");
    if (behindFromOverspend.length > 0) {
      const names = behindFromOverspend.map((b) => b.name).join(", ");
      const monthlyCut = input.monthsRemaining > 0 ? round2(overspend / input.monthsRemaining) : round2(overspend);
      advisories.push({
        id: String(nextId++),
        severity: "critical",
        title: "Spending Threatens Goals",
        message: `Projected overspend of ${formatLakhs(overspend)}/yr puts ${names} at risk.`,
        action: `Reduce monthly spending by ${formatLakhs(monthlyCut)} to stay on track.`,
        relatedGoalId: behindFromOverspend[0]?.id ?? null,
        category: "spending",
      });
    }
  }

  // 2. WARNING: Investment pace behind
  const behindBuckets = input.buckets.filter((b) => b.paceStatus === "behind");
  if (behindBuckets.length > 0) {
    const totalShortfall = behindBuckets.reduce((s, b) => s + b.remainingTarget, 0);
    advisories.push({
      id: String(nextId++),
      severity: "warning",
      title: "Investment Pace Behind",
      message: `${behindBuckets.length} investment${behindBuckets.length > 1 ? "s are" : " is"} behind schedule. ${formatLakhs(totalShortfall)} remaining.`,
      action: input.monthsRemaining > 0
        ? `Increase monthly investments by ${formatLakhs(totalShortfall / input.monthsRemaining)}.`
        : null,
      relatedGoalId: behindBuckets[0]?.id ?? null,
      category: "investment",
    });
  }

  // 3. WARNING: Milestone slippage
  const slippingMilestones = input.milestones.filter((m) => m.slippageMonths > 2 && m.status !== "completed");
  for (const ms of slippingMilestones) {
    advisories.push({
      id: String(nextId++),
      severity: ms.slippageMonths > 6 ? "warning" : "info",
      title: `${ms.name} May Slip`,
      message: `At current pace, ${ms.name} may slip by ${ms.slippageMonths} month${ms.slippageMonths > 1 ? "s" : ""}.`,
      action: ms.monthlyPlanned > ms.monthlyRealistic
        ? `Increase contribution from ${formatLakhs(ms.monthlyRealistic)} to ${formatLakhs(ms.monthlyPlanned)}/mo.`
        : null,
      relatedGoalId: ms.id,
      category: "milestone",
    });
  }

  // 4. INFO: Savings course correction
  if (input.savingsRateTarget > 0 && input.savingsRateActual < input.savingsRateTarget - 5) {
    const gap = round2(input.savingsRateTarget - input.savingsRateActual);
    advisories.push({
      id: String(nextId++),
      severity: gap > 10 ? "warning" : "info",
      title: "Savings Rate Below Target",
      message: `Actual ${round2(input.savingsRateActual)}% vs target ${input.savingsRateTarget}% (gap: ${gap}%).`,
      action: null,
      relatedGoalId: null,
      category: "savings",
    });
  }

  // 5. CELEBRATE: Healthy surplus
  if (input.waterfall.breathingRoomMonthly > 0 && advisories.filter((a) => a.severity === "critical" || a.severity === "warning").length === 0) {
    advisories.push({
      id: String(nextId++),
      severity: "celebrate",
      title: "Healthy Financial Surplus",
      message: `You have ${formatLakhs(input.waterfall.breathingRoomMonthly)}/month breathing room after all commitments.`,
      action: null,
      relatedGoalId: null,
      category: "general",
    });
  }

  return advisories;
}

// ── Tension ──

export interface TensionInput {
  expensesActualYTD: number;
  expensesBudgetedAnnual: number;
  monthsElapsed: number;
  monthsRemaining: number;
  discretionarySpendYTD: number;
  buckets: BucketStatus[];
  breathingRoomMonthly: number;
}

export function calculateTension(input: TensionInput): TensionData {
  const spendingPaceAnnualized = input.monthsElapsed > 0
    ? (input.expensesActualYTD / input.monthsElapsed) * 12
    : 0;

  const overspendAnnualized = Math.max(0, spendingPaceAnnualized - input.expensesBudgetedAnnual);

  const goalsAtRisk = input.buckets
    .filter((b) => b.paceStatus === "behind")
    .map((b) => b.name);

  const discretionaryCutNeeded = input.monthsRemaining > 0
    ? overspendAnnualized / input.monthsRemaining
    : 0;

  return {
    spendingPaceAnnualized: round2(spendingPaceAnnualized),
    spendingBudgeted: round2(input.expensesBudgetedAnnual),
    overspendAnnualized: round2(overspendAnnualized),
    goalsAtRiskFromOverspend: goalsAtRisk,
    discretionarySpendYTD: round2(input.discretionarySpendYTD),
    discretionaryCutNeeded: round2(discretionaryCutNeeded),
  };
}

// ── Goal Matrix (unified sorted list) ──

export function buildGoalMatrix(
  buckets: BucketStatus[],
  milestones: MilestoneStatus[],
): GoalStatus[] {
  const goals: GoalStatus[] = [];

  for (const b of buckets) {
    goals.push({
      id: b.id,
      name: b.name,
      type: "bucket",
      status: b.paceStatus === "behind" ? "at_risk" : "on_track",
      progressPct: b.progressPct,
      targetAmount: b.annualTarget,
      currentAmount: b.contributed,
      remainingAmount: b.remainingTarget,
      projectedCompletion: null,
    });
  }

  for (const m of milestones) {
    goals.push({
      id: m.id,
      name: m.name,
      type: "milestone",
      status: m.status,
      progressPct: m.progressPct,
      targetAmount: m.targetAmount,
      currentAmount: m.currentSaved,
      remainingAmount: Math.max(0, m.targetAmount - m.currentSaved),
      projectedCompletion: m.realisticCompletionDate,
    });
  }

  // Sort: needs_attention first, then at_risk, then on_track, then completed
  const order: Record<GoalStatusLevel, number> = {
    needs_attention: 0,
    at_risk: 1,
    on_track: 2,
    completed: 3,
  };
  goals.sort((a, b) => order[a.status] - order[b.status]);

  return goals;
}

// ── Helpers ──

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}


function formatLakhs(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 100000) return `${round2(abs / 100000)}L`;
  if (abs >= 1000) return `${round2(abs / 1000)}K`;
  return String(Math.round(abs));
}
