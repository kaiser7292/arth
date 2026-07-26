import { getBalanceSheetColumn } from "@/services/balance-sheet";
import { getLoansSummary } from "@/services/loan-accounts";
import { getSalaryProfileByFY } from "@/services/salary-profile";
import { getSavingsSnapshot } from "@/services/savings-tracker";
import { getLifeMilestones, type LifeMilestone } from "@/services/life-milestone";
import { getFYStartMonth } from "@/services/settings";
import { toIsoDate } from "@/utils/date";
import { getCurrentFY, getFYRange } from "@/utils/fiscal-year";

export interface RetirementInputs {
  currentAge: number;
  retirementAge: number;
  lifeExpectancy: number;
  expectedReturnPct: number;
  inflationPct: number;
  healthcareInflationPct: number;
  salaryGrowthPct: number;
  retirementPortfolioYieldPct: number;
  postRetirementExpensePct: number;
}

export const DEFAULT_RETIREMENT_INPUTS: RetirementInputs = {
  currentAge: 25,
  retirementAge: 55,
  lifeExpectancy: 85,
  expectedReturnPct: 12,
  inflationPct: 6.5,
  healthcareInflationPct: 10,
  salaryGrowthPct: 10,
  retirementPortfolioYieldPct: 8,
  postRetirementExpensePct: 75,
};

export interface RetirementReport {
  generatedAt: string;
  dataAsOf: string;
  inputs: RetirementInputs;

  currentAge: number;
  yearsToRetirement: number;
  currentMonthlyInHand: number;
  currentMonthlyExpenses: number;
  currentSavingsRate: number;
  currentMonthlySurplus: number;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  monthlyEMI: number;

  retirementMonthlyExpenseToday: number;
  retirementMonthlyExpenseInflated: number;
  retirementAnnualExpense: number;
  targetCorpus: number;
  existingAssetsAtRetirement: number;
  gapToFill: number;

  requiredMonthlySIP: number;
  sipAnnualStepUpPct: number;
  projectedCorpus: number;

  scenarios: {
    label: string;
    returnPct: number;
    projectedCorpus: number;
    isAchievable: boolean;
  }[];

  ageWhatIf: {
    retireAt: number;
    yearsToRetirement: number;
    targetCorpus: number;
    requiredSIP: number;
    projectedCorpus: number;
    feasible: boolean;
  }[];

  phases: {
    name: string;
    yearRange: string;
    monthlyIncomeEstimate: string;
    sipTarget: string;
    goals: string[];
    keyActions: string[];
    allocation: string;
  }[];


  risks: {
    severity: "critical" | "high" | "medium";
    title: string;
    description: string;
  }[];

  actions: {
    priority: number;
    title: string;
    description: string;
  }[];

  milestones: {
    name: string;
    targetAmount: number;
    inflatedCost: number;
    currentSaved: number;
    progressPct: number;
    targetDate: string | null;
    yearsAway: number;
    monthlyNeeded: number;
    impactOnRetirement: string;
  }[];

  corpusMilestones: {
    year: number;
    age: number;
    sipMonthly: number;
    corpusAccumulated: number;
    milestone: string;
  }[];

  drawdownPlan: {
    withdrawalRate: number;
    annualWithdrawal: number;
    monthlyWithdrawal: number;
    corpusLastsYears: number;
    corpusAtEnd: number;
    sustainable: boolean;
    yearByYear: {
      year: number;
      age: number;
      corpusStart: number;
      withdrawal: number;
      growth: number;
      corpusEnd: number;
    }[];
  }[];

  readinessScore: number;
  readinessLabel: string;
}

function computeGrowingSIP(
  gap: number,
  annualReturnPct: number,
  annualStepUpPct: number,
  years: number,
): number {
  if (gap <= 0 || years <= 0) return 0;

  const monthlyRate = annualReturnPct / 100 / 12;
  const g = annualStepUpPct / 100;

  let fv = 0;
  for (let year = 0; year < years; year++) {
    const currentMonthlySIP = Math.pow(1 + g, year);
    for (let m = 0; m < 12; m++) {
      const monthsRemaining = (years - year) * 12 - m;
      fv += currentMonthlySIP * Math.pow(1 + monthlyRate, monthsRemaining);
    }
  }

  return gap / fv;
}

function computeProjectedCorpus(
  monthlySIP: number,
  annualReturnPct: number,
  annualStepUpPct: number,
  years: number,
): number {
  if (monthlySIP <= 0 || years <= 0) return 0;

  const monthlyRate = annualReturnPct / 100 / 12;
  const g = annualStepUpPct / 100;

  let fv = 0;
  for (let year = 0; year < years; year++) {
    const currentMonthlySIP = monthlySIP * Math.pow(1 + g, year);
    for (let m = 0; m < 12; m++) {
      const monthsRemaining = (years - year) * 12 - m;
      fv += currentMonthlySIP * Math.pow(1 + monthlyRate, monthsRemaining);
    }
  }

  return fv;
}

function formatRupees(amount: number): string {
  return "₹" + Math.round(amount).toLocaleString("en-IN");
}

function buildPhases(
  yearsToRetirement: number,
  currentMonthlyInHand: number,
  salaryGrowthPct: number,
  requiredMonthlySIP: number,
  monthlyEMI: number,
  milestoneGoals: { year: number; label: string }[],
): RetirementReport["phases"] {
  if (yearsToRetirement <= 0) return [];

  const g = salaryGrowthPct / 100;
  const sipG = salaryGrowthPct / 100;

  const phaseDefs: {
    name: string;
    startYear: number;
    endYear: number;
    goals: string[];
    keyActions: string[];
    allocation: string;
  }[] = [];

  if (yearsToRetirement <= 5) {
    phaseDefs.push({
      name: "Final Sprint",
      startYear: 0,
      endYear: yearsToRetirement,
      goals: ["Maximize savings", "Reduce risk exposure"],
      keyActions: [
        "Shift equity to balanced/debt funds gradually",
        "Build 2-year cash runway for early retirement years",
        "Review health and term insurance adequacy",
      ],
      allocation: "30% Equity · 50% Debt · 20% Cash",
    });
  } else if (yearsToRetirement <= 10) {
    phaseDefs.push(
      {
        name: "Foundations",
        startYear: 0,
        endYear: 3,
        goals: ["Clear high-interest debt", "Build emergency fund", "Start SIPs"],
        keyActions: [
          monthlyEMI > 0 ? "Prioritize clearing high-interest loans" : "Establish 6-month emergency fund",
          "Start SIP of " + formatRupees(requiredMonthlySIP) + "/month",
          "Get term insurance (10x annual income) and health insurance (10L+)",
        ],
        allocation: "70% Equity · 20% Debt · 10% Gold",
      },
      {
        name: "Acceleration",
        startYear: 3,
        endYear: Math.min(6, yearsToRetirement),
        goals: ["Ramp up SIPs", "Build investment discipline"],
        keyActions: [
          "Step up SIP by " + salaryGrowthPct + "% annually",
          "Diversify across equity, debt, and gold",
          "Review and rebalance portfolio annually",
        ],
        allocation: "60% Equity · 30% Debt · 10% Gold",
      },
      {
        name: "Power Accumulation",
        startYear: 6,
        endYear: yearsToRetirement,
        goals: ["Peak earning years", "Aggressive wealth building"],
        keyActions: [
          "Maximize equity allocation while young enough",
          "Consider real estate if not already owned",
          "Start shifting to balanced funds in final 3 years",
        ],
        allocation: "40% Equity · 40% Debt · 20% Cash",
      },
    );
  } else {
    phaseDefs.push(
      {
        name: "Foundations",
        startYear: 0,
        endYear: 3,
        goals: ["Clear high-interest debt", "Build emergency fund", "Start SIPs"],
        keyActions: [
          monthlyEMI > 0 ? "Prioritize clearing high-interest loans" : "Establish 6-month emergency fund",
          "Start SIP of " + formatRupees(requiredMonthlySIP) + "/month",
          "Get term insurance (10x annual income) and health insurance (10L+)",
        ],
        allocation: "80% Equity · 15% Debt · 5% Gold",
      },
      {
        name: "Acceleration",
        startYear: 3,
        endYear: 6,
        goals: ["Ramp up SIPs with salary growth", "Build diversified portfolio"],
        keyActions: [
          "Step up SIP by " + salaryGrowthPct + "% annually",
          "Target 80/20 equity-debt split",
          "Start tax-saving investments (ELSS, PPF, NPS)",
        ],
        allocation: "80% Equity · 15% Debt · 5% Gold",
      },
      {
        name: "House + Family",
        startYear: 6,
        endYear: 15,
        goals: ["Home purchase", "Child education planning", "Career growth"],
        keyActions: [
          "Plan home down payment (don't over-leverage)",
          "Start child education SIP if applicable",
          "Continue stepping up retirement SIP despite EMI",
        ],
        allocation: "70% Equity · 20% Debt · 10% Gold",
      },
      {
        name: "Power Accumulation",
        startYear: 15,
        endYear: yearsToRetirement,
        goals: ["Peak earning", "Aggressive corpus building", "Pre-retirement planning"],
        keyActions: [
          "Post-EMI surplus should go entirely to investments",
          "Shift to 60/40 equity-debt in final 5 years",
          "Build 2-year cash runway before retirement date",
        ],
        allocation: "50% Equity · 35% Debt · 15% Cash",
      },
    );
  }

  // Inject milestone goals into matching phases
  for (const mg of milestoneGoals) {
    for (const phase of phaseDefs) {
      if (mg.year >= phase.startYear && mg.year <= phase.endYear) {
        phase.goals.push(mg.label);
        break;
      }
    }
  }

  return phaseDefs.map((phase) => {
    const midYear = Math.floor((phase.startYear + phase.endYear) / 2);
    const incomeAtMid = currentMonthlyInHand * Math.pow(1 + g, midYear);
    const sipAtMid = requiredMonthlySIP * Math.pow(1 + sipG, midYear);

    return {
      name: phase.name,
      yearRange: `Year ${phase.startYear + 1}–${phase.endYear}`,
      monthlyIncomeEstimate: formatRupees(incomeAtMid),
      sipTarget: formatRupees(sipAtMid),
      goals: phase.goals,
      keyActions: phase.keyActions,
      allocation: phase.allocation,
    };
  });
}

function buildRisks(
  monthlyEMI: number,
  currentMonthlyInHand: number,
  currentSavingsRate: number,
  totalAssets: number,
  currentMonthlyExpenses: number,
): RetirementReport["risks"] {
  const risks: RetirementReport["risks"] = [];

  risks.push({
    severity: "critical",
    title: "Health insurance check",
    description: "Ensure you have adequate health insurance (at least ₹10L family floater). Medical emergencies are the #1 retirement plan killer.",
  });

  risks.push({
    severity: "critical",
    title: "Term insurance check",
    description: "If you have dependents, ensure term life cover of at least 10x annual income. This is non-negotiable until your corpus can self-insure.",
  });

  if (currentMonthlyInHand > 0) {
    const dti = (monthlyEMI / currentMonthlyInHand) * 100;
    if (dti > 20) {
      risks.push({
        severity: "high",
        title: "High debt-to-income ratio (" + Math.round(dti) + "%)",
        description: "Monthly EMI exceeds 20% of take-home pay. Prioritize clearing high-interest debt before aggressive investing.",
      });
    }
  }

  risks.push({
    severity: "high",
    title: "Single income reliance",
    description: "With a single income source, any disruption directly impacts retirement plans. Build a 6-month emergency fund as priority.",
  });

  if (currentMonthlyExpenses > 0) {
    const emergencyMonths = totalAssets / currentMonthlyExpenses;
    if (emergencyMonths < 3) {
      risks.push({
        severity: "medium",
        title: "Emergency fund below 3 months",
        description: "Liquid assets cover only " + Math.round(emergencyMonths * 10) / 10 + " months of expenses. Target at least 6 months before aggressive equity allocation.",
      });
    }
  }

  if (currentSavingsRate < 30) {
    risks.push({
      severity: "medium",
      title: "Savings rate below 30%",
      description: "Current savings rate is " + Math.round(currentSavingsRate) + "%. For early retirement, aim for 40–50%. Review discretionary spending.",
    });
  }

  return risks;
}

function buildActions(
  monthlyEMI: number,
  currentSavingsRate: number,
  requiredMonthlySIP: number,
  targetSavingsRatePct: number,
): RetirementReport["actions"] {
  const actions: RetirementReport["actions"] = [];
  let priority = 1;

  if (monthlyEMI > 0) {
    actions.push({
      priority: priority++,
      title: "Close high-interest debt first",
      description: "You're paying " + formatRupees(monthlyEMI) + "/month in EMIs. Clearing high-interest loans (personal, credit card) frees up cash for SIPs and reduces risk.",
    });
  }

  if (currentSavingsRate < targetSavingsRatePct) {
    actions.push({
      priority: priority++,
      title: "Increase SIP to " + formatRupees(requiredMonthlySIP) + "/month",
      description: "Current savings rate (" + Math.round(currentSavingsRate) + "%) is below target. Start or increase SIP to " + formatRupees(requiredMonthlySIP) + " with " + "annual step-up to stay on track.",
    });
  }

  actions.push({
    priority: priority++,
    title: "Start SIP immediately if not already",
    description: "Every month of delay costs compounding. Even " + formatRupees(Math.round(requiredMonthlySIP * 0.5)) + "/month is better than waiting for the 'right time'.",
  });

  return actions.slice(0, 3);
}

function buildCorpusMilestones(
  currentAge: number,
  yearsToRetirement: number,
  requiredMonthlySIP: number,
  sipStepUpPct: number,
  expectedReturnPct: number,
  existingAssets: number,
): RetirementReport["corpusMilestones"] {
  const milestones: RetirementReport["corpusMilestones"] = [];
  const monthlyRate = expectedReturnPct / 100 / 12;
  const g = sipStepUpPct / 100;

  let corpus = existingAssets;
  const intervals = yearsToRetirement <= 10
    ? [2, 5, 7, 10]
    : yearsToRetirement <= 20
      ? [3, 5, 10, 15, 20]
      : [5, 10, 15, 20, 25, 30];

  for (let yr = 1; yr <= yearsToRetirement; yr++) {
    const sipThisYear = requiredMonthlySIP * Math.pow(1 + g, yr - 1);
    for (let m = 0; m < 12; m++) {
      corpus = corpus * (1 + monthlyRate) + sipThisYear;
    }

    if (intervals.includes(yr) || yr === yearsToRetirement) {
      let milestone = "";
      if (yr === yearsToRetirement) milestone = "Retirement!";
      else if (corpus >= 10_00_00_000) milestone = "₹" + Math.round(corpus / 1_00_00_000) + " Cr";
      else if (corpus >= 1_00_00_000) milestone = "₹" + (corpus / 1_00_00_000).toFixed(1) + " Cr";
      else milestone = "₹" + Math.round(corpus / 1_00_000) + " L";

      milestones.push({
        year: yr,
        age: currentAge + yr,
        sipMonthly: Math.round(sipThisYear),
        corpusAccumulated: Math.round(corpus),
        milestone,
      });
    }
  }
  return milestones;
}

function buildDrawdownPlan(
  targetCorpus: number,
  inflationPct: number,
  portfolioYieldPct: number,
  healthcareInflationPct: number,
  lifeExpectancy: number,
  retirementAge: number,
  retirementAnnualExpense: number,
): RetirementReport["drawdownPlan"] {
  const rates = [3, 4, 5, 6];
  const retirementYears = lifeExpectancy - retirementAge;
  const realReturn = (portfolioYieldPct - inflationPct) / 100;
  const healthcareEscalation = (healthcareInflationPct - inflationPct) / 100;

  return rates.map((rate) => {
    const annualWithdrawal = targetCorpus * rate / 100;
    const monthlyWithdrawal = annualWithdrawal / 12;

    // Year-by-year simulation
    let corpus = targetCorpus;
    const yearByYear: RetirementReport["drawdownPlan"][0]["yearByYear"] = [];
    let years = 0;

    const maxYears = Math.min(retirementYears + 10, 60);
    for (let y = 1; y <= maxYears && corpus > 0; y++) {
      const corpusStart = corpus;
      // Healthcare costs escalate faster than general inflation
      const healthcareSurcharge = corpusStart * 0.05 * Math.pow(1 + healthcareEscalation, y);
      const withdrawal = annualWithdrawal + healthcareSurcharge;
      const growth = corpusStart * realReturn;
      corpus = corpusStart + growth - withdrawal;
      if (corpus < 0) corpus = 0;
      years = y;

      yearByYear.push({
        year: y,
        age: retirementAge + y,
        corpusStart: Math.round(corpusStart),
        withdrawal: Math.round(withdrawal),
        growth: Math.round(growth),
        corpusEnd: Math.round(corpus),
      });

      if (corpus <= 0) break;
    }

    return {
      withdrawalRate: rate,
      annualWithdrawal: Math.round(annualWithdrawal),
      monthlyWithdrawal: Math.round(monthlyWithdrawal),
      corpusLastsYears: years,
      corpusAtEnd: Math.round(corpus),
      sustainable: years >= retirementYears,
      yearByYear,
    };
  });
}

function buildMilestoneImpact(
  milestones: LifeMilestone[],
  currentMonthlyInHand: number,
  currentAge: number,
  inflationPct: number,
): RetirementReport["milestones"] {
  return milestones
    .filter((m) => m.is_completed === 0)
    .map((m) => {
      const remaining = Math.max(0, m.target_amount - m.current_saved);
      const totalMonths = Math.max(1, m.duration_years * 12 + m.duration_months);
      const progressPct = m.target_amount > 0
        ? Math.min(100, (m.current_saved / m.target_amount) * 100)
        : 0;

      // Calculate years away from target date or duration
      let yearsAway = totalMonths / 12;
      if (m.target_date) {
        const target = new Date(m.target_date);
        const now = new Date();
        yearsAway = Math.max(0, (target.getTime() - now.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      }

      // Inflate cost to target year
      const inflatedCost = m.target_amount * Math.pow(1 + inflationPct / 100, yearsAway);

      const monthlyNeeded = m.monthly_contribution_planned > 0
        ? m.monthly_contribution_planned
        : remaining / Math.max(1, yearsAway * 12);

      const pctOfIncome = currentMonthlyInHand > 0
        ? Math.round((monthlyNeeded / currentMonthlyInHand) * 100)
        : 0;
      const impactOnRetirement = pctOfIncome > 0
        ? `Uses ${pctOfIncome}% of monthly income · Inflated cost: ${formatRupees(inflatedCost)}`
        : "No income impact data";

      return {
        name: m.name,
        targetAmount: m.target_amount,
        inflatedCost: Math.round(inflatedCost),
        currentSaved: m.current_saved,
        progressPct: Math.round(progressPct),
        targetDate: m.target_date,
        yearsAway: Math.round(yearsAway * 10) / 10,
        monthlyNeeded: Math.round(monthlyNeeded),
        impactOnRetirement,
      };
    });
}

function computeReadinessScore(
  currentSavingsRate: number,
  projectedCorpus: number,
  targetCorpus: number,
  emergencyMonths: number,
  monthlyEMI: number,
  currentMonthlyInHand: number,
): { score: number; label: string } {
  let score = 0;

  const corpusPct = Math.min(100, (projectedCorpus / Math.max(1, targetCorpus)) * 100);
  score += corpusPct * 0.4;

  if (currentSavingsRate >= 40) score += 25;
  else if (currentSavingsRate >= 30) score += 20;
  else if (currentSavingsRate >= 20) score += 12;
  else score += Math.max(0, currentSavingsRate * 0.5);

  if (emergencyMonths >= 6) score += 15;
  else if (emergencyMonths >= 3) score += 10;
  else score += emergencyMonths * 2;

  const dti = currentMonthlyInHand > 0 ? (monthlyEMI / currentMonthlyInHand) * 100 : 0;
  if (dti === 0) score += 20;
  else if (dti <= 20) score += 15;
  else if (dti <= 40) score += 8;
  else score += 2;

  score = Math.round(Math.min(100, score));

  let label: string;
  if (score >= 80) label = "Strong — you're well on track";
  else if (score >= 60) label = "Good — a few areas to strengthen";
  else if (score >= 40) label = "Needs work — significant gaps remain";
  else label = "At risk — urgent action needed";

  return { score, label };
}

function buildAgeWhatIf(
  currentAge: number,
  totalAssets: number,
  retirementMonthlyExpenseToday: number,
  inflationPct: number,
  expectedReturnPct: number,
  sipStepUpPct: number,
  postRetirementExpensePct: number,
): RetirementReport["ageWhatIf"] {
  const ages = [50, 55, 60];
  return ages
    .filter((a) => a > currentAge)
    .map((retireAt) => {
      const yrs = retireAt - currentAge;
      const monthlyExpAdj = retirementMonthlyExpenseToday * (postRetirementExpensePct / 100);
      const inflated = monthlyExpAdj * Math.pow(1 + inflationPct / 100, yrs);
      const annual = inflated * 12;
      const target = annual * 28;
      const existingAtRetire = totalAssets * Math.pow(1 + expectedReturnPct / 100, yrs);
      const gap = Math.max(0, target - existingAtRetire);
      const sip = computeGrowingSIP(gap, expectedReturnPct, sipStepUpPct, yrs);
      const projected = existingAtRetire + computeProjectedCorpus(sip, expectedReturnPct, sipStepUpPct, yrs);
      return {
        retireAt,
        yearsToRetirement: yrs,
        targetCorpus: Math.round(target),
        requiredSIP: Math.round(sip),
        projectedCorpus: Math.round(projected),
        feasible: projected >= target,
      };
    });
}

export async function generateRetirementReport(
  userId: string,
  inputs: RetirementInputs,
): Promise<RetirementReport> {
  try {
    const now = new Date();
    const today = toIsoDate(now);
    const startMonth = getFYStartMonth();
    const fyYear = getCurrentFY(startMonth);

    const [bs, snapshot, salary, loansSummary, allMilestones] = await Promise.all([
      getBalanceSheetColumn(userId, today, "Today", true, null),
      getSavingsSnapshot(userId, fyYear),
      getSalaryProfileByFY(userId, String(fyYear)),
      getLoansSummary(userId),
      getLifeMilestones(userId),
    ]);

    const totalAssets = bs.totalAssets;
    const totalLiabilities = bs.totalLiabilities;
    const netWorth = bs.netWorth;

    const monthlyInHand =
      salary?.manual_monthly_in_hand || salary?.computed_monthly_in_hand || 0;
    const monthlyEMI = loansSummary?.totalMonthlyEMI ?? 0;

    const { start: fyStart } = getFYRange(fyYear, startMonth);
    const monthsElapsed = snapshot?.monthsElapsed ?? Math.max(1,
      (now.getFullYear() - fyStart.getFullYear()) * 12 +
      (now.getMonth() - fyStart.getMonth()) + 1,
    );

    const totalExpenses = snapshot?.totalExpenses ?? 0;
    const currentMonthlyExpenses = monthsElapsed > 0
      ? totalExpenses / monthsElapsed
      : 0;

    const currentMonthlySurplus = monthlyInHand - currentMonthlyExpenses;
    const currentSavingsRate = monthlyInHand > 0
      ? (currentMonthlySurplus / monthlyInHand) * 100
      : 0;

    const currentAge = inputs.currentAge;
    const yearsToRetirement = Math.max(inputs.retirementAge - currentAge, 1);

    // Post-retirement expenses = current expenses minus EMI, reduced by expense factor
    const retirementMonthlyExpenseToday = Math.max(currentMonthlyExpenses - monthlyEMI, 0);
    const adjustedExpenseToday = retirementMonthlyExpenseToday * (inputs.postRetirementExpensePct / 100);
    const retirementMonthlyExpenseInflated =
      adjustedExpenseToday * Math.pow(1 + inputs.inflationPct / 100, yearsToRetirement);
    const retirementAnnualExpense = retirementMonthlyExpenseInflated * 12;

    const targetCorpus = retirementAnnualExpense * 28;

    const existingAssetsAtRetirement =
      totalAssets * Math.pow(1 + inputs.expectedReturnPct / 100, yearsToRetirement);

    const gapToFill = Math.max(targetCorpus - existingAssetsAtRetirement, 0);

    const sipAnnualStepUpPct = inputs.salaryGrowthPct;

    const requiredMonthlySIP = computeGrowingSIP(
      gapToFill,
      inputs.expectedReturnPct,
      sipAnnualStepUpPct,
      yearsToRetirement,
    );

    const projectedCorpus = existingAssetsAtRetirement + computeProjectedCorpus(
      requiredMonthlySIP,
      inputs.expectedReturnPct,
      sipAnnualStepUpPct,
      yearsToRetirement,
    );

    const conservativeReturn = inputs.expectedReturnPct - 4;
    const optimisticReturn = inputs.expectedReturnPct + 1;

    const scenarios: RetirementReport["scenarios"] = [
      {
        label: "Conservative",
        returnPct: conservativeReturn,
        projectedCorpus:
          totalAssets * Math.pow(1 + conservativeReturn / 100, yearsToRetirement) +
          computeProjectedCorpus(requiredMonthlySIP, conservativeReturn, sipAnnualStepUpPct, yearsToRetirement),
        isAchievable: false,
      },
      {
        label: "Moderate",
        returnPct: inputs.expectedReturnPct,
        projectedCorpus,
        isAchievable: true,
      },
      {
        label: "Optimistic",
        returnPct: optimisticReturn,
        projectedCorpus:
          totalAssets * Math.pow(1 + optimisticReturn / 100, yearsToRetirement) +
          computeProjectedCorpus(requiredMonthlySIP, optimisticReturn, sipAnnualStepUpPct, yearsToRetirement),
        isAchievable: false,
      },
    ];

    scenarios[0].isAchievable = scenarios[0].projectedCorpus >= targetCorpus;
    scenarios[1].isAchievable = scenarios[1].projectedCorpus >= targetCorpus;
    scenarios[2].isAchievable = scenarios[2].projectedCorpus >= targetCorpus;

    // Build milestone impact (exclude completed ones)
    const activeMilestones = allMilestones.filter((m) => m.is_completed === 0);
    const milestones = buildMilestoneImpact(activeMilestones, monthlyInHand, currentAge, inputs.inflationPct);

    // Create milestone goals for phases
    const milestoneGoals: { year: number; label: string }[] = milestones.map((m) => ({
      year: Math.round(m.yearsAway),
      label: `${m.name} — ${formatRupees(m.inflatedCost)} by ${m.targetDate ? new Date(m.targetDate).getFullYear() : "target"}`,
    }));

    const phases = buildPhases(
      yearsToRetirement,
      monthlyInHand,
      inputs.salaryGrowthPct,
      requiredMonthlySIP,
      monthlyEMI,
      milestoneGoals,
    );

    const targetSavingsRatePct = snapshot?.targetSavingsRatePct ?? 40;

    const risks = buildRisks(
      monthlyEMI,
      monthlyInHand,
      currentSavingsRate,
      totalAssets,
      currentMonthlyExpenses,
    );

    const actions = buildActions(
      monthlyEMI,
      currentSavingsRate,
      requiredMonthlySIP,
      targetSavingsRatePct,
    );

    const corpusMilestones = buildCorpusMilestones(
      currentAge,
      yearsToRetirement,
      requiredMonthlySIP,
      sipAnnualStepUpPct,
      inputs.expectedReturnPct,
      totalAssets,
    );

    const emergencyMonths = currentMonthlyExpenses > 0
      ? totalAssets / currentMonthlyExpenses
      : 0;

    const drawdownPlan = buildDrawdownPlan(
      targetCorpus,
      inputs.inflationPct,
      inputs.retirementPortfolioYieldPct,
      inputs.healthcareInflationPct,
      inputs.lifeExpectancy,
      inputs.retirementAge,
      retirementAnnualExpense,
    );

    const { score: readinessScore, label: readinessLabel } = computeReadinessScore(
      currentSavingsRate,
      projectedCorpus,
      targetCorpus,
      emergencyMonths,
      monthlyEMI,
      monthlyInHand,
    );

    const ageWhatIf = buildAgeWhatIf(
      currentAge,
      totalAssets,
      retirementMonthlyExpenseToday,
      inputs.inflationPct,
      inputs.expectedReturnPct,
      sipAnnualStepUpPct,
      inputs.postRetirementExpensePct,
    );

    return {
      generatedAt: now.toISOString(),
      dataAsOf: today,
      inputs,
      currentAge,
      yearsToRetirement,
      currentMonthlyInHand: monthlyInHand,
      currentMonthlyExpenses,
      currentSavingsRate,
      currentMonthlySurplus,
      totalAssets,
      totalLiabilities,
      netWorth,
      monthlyEMI,
      retirementMonthlyExpenseToday,
      retirementMonthlyExpenseInflated,
      retirementAnnualExpense,
      targetCorpus,
      existingAssetsAtRetirement,
      gapToFill,
      requiredMonthlySIP,
      sipAnnualStepUpPct,
      projectedCorpus,
      scenarios,
      ageWhatIf,
      phases,
      risks,
      actions,
      milestones,
      corpusMilestones,
      drawdownPlan,
      readinessScore,
      readinessLabel,
    };
  } catch (error) {
    throw new Error(
      "Failed to generate retirement report: " +
      (error instanceof Error ? error.message : String(error)),
    );
  }
}
