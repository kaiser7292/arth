import { getBalanceSheetColumn } from "@/services/balance-sheet";
import { getLoansSummary } from "@/services/loan-accounts";
import { getSalaryProfileByFY } from "@/services/salary-profile";
import { getSavingsSnapshot } from "@/services/savings-tracker";
import { getFYStartMonth } from "@/services/settings";
import { toIsoDate } from "@/utils/date";
import { getCurrentFY, getFYRange } from "@/utils/fiscal-year";

export interface RetirementInputs {
  retirementAge: number;
  lifeExpectancy: number;
  expectedReturnPct: number;
  inflationPct: number;
  salaryGrowthPct: number;
  educationInflationPct: number;
  numberOfChildren: number;
  retirementPortfolioYieldPct: number;
}

export const DEFAULT_RETIREMENT_INPUTS: RetirementInputs = {
  retirementAge: 55,
  lifeExpectancy: 85,
  expectedReturnPct: 12,
  inflationPct: 6.5,
  salaryGrowthPct: 10,
  educationInflationPct: 9,
  numberOfChildren: 1,
  retirementPortfolioYieldPct: 8,
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

  phases: {
    name: string;
    yearRange: string;
    monthlyIncomeEstimate: string;
    sipTarget: string;
    goals: string[];
    keyActions: string[];
  }[];

  childEducation: {
    costTodayTotal: number;
    costInflated: number;
    monthlySIPNeeded: number;
    projectedCorpus: number;
  } | null;

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
      },
    );
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

export async function generateRetirementReport(
  userId: string,
  inputs: RetirementInputs,
): Promise<RetirementReport> {
  try {
    const now = new Date();
    const today = toIsoDate(now);
    const startMonth = getFYStartMonth();
    const fyYear = getCurrentFY(startMonth);

    const [bs, snapshot, salary, loansSummary] = await Promise.all([
      getBalanceSheetColumn(userId, today, "Today", true, null),
      getSavingsSnapshot(userId, fyYear),
      getSalaryProfileByFY(userId, String(fyYear)),
      getLoansSummary(userId),
    ]);

    const totalAssets = bs.totalAssets;
    const totalLiabilities = bs.totalLiabilities;
    const netWorth = bs.netWorth;

    const monthlyInHand =
      salary?.manual_monthly_in_hand || salary?.computed_monthly_in_hand || 0;
    const monthlyEMI = loansSummary?.totalMonthlyEMI ?? 0;

    const { start: fyStart } = getFYRange(fyYear, startMonth);
    const fyStartDate = fyStart.getTime();
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

    // Assume current age = retirementAge - 30 if we can't derive it; caller provides retirementAge
    // We use a reasonable default: user is in their late 20s
    const currentAge = Math.max(inputs.retirementAge - 30, 25);
    const yearsToRetirement = Math.max(inputs.retirementAge - currentAge, 1);

    const retirementMonthlyExpenseToday = Math.max(currentMonthlyExpenses - monthlyEMI, 0);
    const retirementMonthlyExpenseInflated =
      retirementMonthlyExpenseToday * Math.pow(1 + inputs.inflationPct / 100, yearsToRetirement);
    const retirementAnnualExpense = retirementMonthlyExpenseInflated * 12;

    // 28x rule: covers ~30 years of retirement with inflation-adjusted withdrawals
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

    const phases = buildPhases(
      yearsToRetirement,
      monthlyInHand,
      inputs.salaryGrowthPct,
      requiredMonthlySIP,
      monthlyEMI,
    );

    let childEducation: RetirementReport["childEducation"] = null;
    if (inputs.numberOfChildren > 0) {
      const costTodayPerChild = 40_00_000;
      const costTodayTotal = costTodayPerChild * inputs.numberOfChildren;
      const yearsUntilNeeded = 18 + 3; // child born in ~3 years, needs funds at 18
      const costInflated = costTodayTotal *
        Math.pow(1 + inputs.educationInflationPct / 100, yearsUntilNeeded);
      const monthlySIPNeeded = computeGrowingSIP(
        costInflated,
        inputs.expectedReturnPct,
        10, // 10% annual step-up for education SIP
        yearsUntilNeeded,
      );
      const educationProjectedCorpus = computeProjectedCorpus(
        monthlySIPNeeded,
        inputs.expectedReturnPct,
        10,
        yearsUntilNeeded,
      );

      childEducation = {
        costTodayTotal,
        costInflated,
        monthlySIPNeeded,
        projectedCorpus: educationProjectedCorpus,
      };
    }

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
      phases,
      childEducation,
      risks,
      actions,
    };
  } catch (error) {
    throw new Error(
      "Failed to generate retirement report: " +
      (error instanceof Error ? error.message : String(error)),
    );
  }
}
