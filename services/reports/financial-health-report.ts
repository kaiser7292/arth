import { getBalanceSheetColumn } from "@/services/balance-sheet";
import { getCategories } from "@/services/category";
import { getExpenseTotalsByCategory } from "@/services/expense-queries";
import { getLoansSummary } from "@/services/loan-accounts";
import { getSalaryProfileByFY } from "@/services/salary-profile";
import { getSavingsSnapshot, getSavingsTrend } from "@/services/savings-tracker";
import { getFYStartMonth } from "@/services/settings";
import { getRightSpendTrend } from "@/services/spending-insights";
import { toIsoDate } from "@/utils/date";
import { getCurrentFY, getFYRange } from "@/utils/fiscal-year";

export interface FinancialHealthReport {
  generatedAt: string;
  dataAsOf: string;

  overallGrade: string;
  overallScore: number;
  gradeSummary: string;
  dimensions: {
    name: string;
    grade: string;
    score: number;
    description: string;
  }[];

  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  assetBreakdown: { label: string; amount: number; group: string }[];
  liabilityBreakdown: { label: string; amount: number; group: string }[];

  currentSavingsRate: number;
  monthlySavingsRates: {
    month: string;
    rate: number;
    income: number;
    expenses: number;
    saved: number;
  }[];
  avgSavingsRate: number;

  debtToIncomeRatio: number;
  monthlyEMI: number;
  monthlyIncome: number;

  monthlyExpenseAvg: number;
  liquidAssets: number;
  emergencyMonths: number;
  emergencyTarget: number;
  emergencyGap: number;

  categoryBreakdown: {
    categoryId: string;
    categoryName: string;
    amount: number;
    percentage: number;
  }[];
  fixedVsDiscretionary: {
    fixed: number;
    discretionary: number;
    fixedPct: number;
    discretionaryPct: number;
  };

  spikingCategories: {
    categoryId: string;
    categoryName: string;
    currentMonth: number;
    avgPrevious: number;
    spikeMultiple: number;
  }[];
}

function scoreToGrade(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

function scoreSavingsRate(rate: number): number {
  if (rate >= 50) return 100;
  if (rate >= 40) return 85;
  if (rate >= 30) return 70;
  if (rate >= 20) return 50;
  if (rate >= 10) return 30;
  return 10;
}

function scoreDebt(dti: number): number {
  if (dti <= 0) return 100;
  if (dti < 10) return 85;
  if (dti < 20) return 70;
  if (dti < 30) return 50;
  if (dti < 40) return 30;
  return 10;
}

function scoreDiversification(groupCount: number): number {
  if (groupCount >= 4) return 100;
  if (groupCount === 3) return 75;
  if (groupCount === 2) return 50;
  if (groupCount === 1) return 25;
  return 0;
}

function scoreEmergencyFund(months: number): number {
  if (months >= 6) return 100;
  if (months >= 4) return 75;
  if (months >= 2) return 50;
  if (months >= 1) return 25;
  return 0;
}

function scoreSpendingDiscipline(spikeCount: number): number {
  if (spikeCount === 0) return 100;
  if (spikeCount === 1) return 75;
  if (spikeCount === 2) return 50;
  return 25;
}

function buildGradeSummary(grade: string, score: number): string {
  if (score >= 90) return "Excellent financial health across all dimensions.";
  if (score >= 80) return "Strong financial position with minor areas for improvement.";
  if (score >= 70) return "Good overall health; a few dimensions have room to grow.";
  if (score >= 55) return "Moderate financial health; several areas need attention.";
  if (score >= 40) return "Below average; significant improvement needed across key areas.";
  return "Financial health needs urgent attention across multiple areas.";
}

function getMonthString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthStartEnd(monthStr: string): { start: string; end: string } {
  const [y, m] = monthStr.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

export async function generateFinancialHealthReport(
  userId: string,
): Promise<FinancialHealthReport> {
  try {
    const now = new Date();
    const today = toIsoDate(now);
    const startMonth = getFYStartMonth();
    const fyYear = getCurrentFY(startMonth);
    const { start: fyStart, end: fyEnd } = getFYRange(fyYear, startMonth);
    const fyStartDate = toIsoDate(fyStart);
    const fyEndDate = toIsoDate(fyEnd);

    // --- Net worth ---
    const bs = await getBalanceSheetColumn(userId, today, "Today", true, null);
    const assetBreakdown = bs.assets.map((a) => ({
      label: a.label,
      amount: a.amount,
      group: a.group,
    }));
    const liabilityBreakdown = bs.liabilities.map((l) => ({
      label: l.label,
      amount: l.amount,
      group: l.group,
    }));

    // --- Savings ---
    const [snapshot, trend] = await Promise.all([
      getSavingsSnapshot(userId, fyYear),
      getSavingsTrend(userId, fyYear),
    ]);

    const currentSavingsRate = snapshot?.actualSavingsRatePct ?? 0;
    // Convert fiscal month number to readable label (e.g. fiscal month 1 → "Apr")
    const fyStartMo = startMonth; // 1-indexed calendar month (4 = April for Indian FY)
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthlySavingsRates = (trend ?? []).map((t) => {
      const calMonth = ((fyStartMo - 1 + t.fiscalMonth - 1) % 12);
      return {
        month: monthNames[calMonth],
        rate: t.savingsRatePct,
        income: t.income,
        expenses: t.expenses,
        saved: t.saved,
      };
    });
    const avgSavingsRate =
      monthlySavingsRates.length > 0
        ? monthlySavingsRates.reduce((sum, m) => sum + m.rate, 0) /
          monthlySavingsRates.length
        : 0;

    // --- Income ---
    const salary = await getSalaryProfileByFY(userId, String(fyYear));
    const monthlyIncome =
      salary?.manual_monthly_in_hand || salary?.computed_monthly_in_hand || 0;

    // --- Loans ---
    const loansSummary = await getLoansSummary(userId);
    const monthlyEMI = loansSummary?.totalMonthlyEMI ?? 0;
    const debtToIncomeRatio =
      monthlyIncome > 0
        ? Math.round((monthlyEMI / monthlyIncome) * 10000) / 100
        : 0;

    // --- Emergency fund ---
    const liquidAssets = bs.assets
      .filter((a) => a.group === "savings" || a.group === "wallet")
      .reduce((sum, a) => sum + a.amount, 0);

    const monthsElapsed = snapshot?.monthsElapsed ?? 1;
    const totalExpenses = snapshot?.totalExpenses ?? 0;
    const monthlyExpenseAvg =
      monthsElapsed > 0
        ? Math.round(totalExpenses / monthsElapsed)
        : 0;
    const emergencyMonths =
      monthlyExpenseAvg > 0
        ? Math.round((liquidAssets / monthlyExpenseAvg) * 10) / 10
        : 0;
    const emergencyTarget = monthlyExpenseAvg * 6;
    const emergencyGap = Math.max(0, emergencyTarget - liquidAssets);

    // --- Category breakdown ---
    const [categoryTotals, categories] = await Promise.all([
      getExpenseTotalsByCategory(userId, fyStartDate, fyEndDate),
      getCategories(userId),
    ]);

    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
    const totalCategorySpend = categoryTotals.reduce(
      (sum, c) => sum + c.total,
      0,
    );
    const categoryBreakdown = categoryTotals
      .map((c) => ({
        categoryId: c.category_id,
        categoryName: categoryMap.get(c.category_id) ?? "Unknown",
        amount: c.total,
        percentage:
          totalCategorySpend > 0
            ? Math.round((c.total / totalCategorySpend) * 10000) / 100
            : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    // --- Fixed vs discretionary ---
    const spendTrend = await getRightSpendTrend(userId, 6);
    const latestMonth =
      spendTrend.monthly.length > 0
        ? spendTrend.monthly[spendTrend.monthly.length - 1]
        : null;
    const fixed = latestMonth?.rightSpend ?? 0;
    const discretionary = latestMonth
      ? latestMonth.total - latestMonth.rightSpend
      : 0;
    const totalForSplit = fixed + discretionary;
    const fixedVsDiscretionary = {
      fixed,
      discretionary,
      fixedPct:
        totalForSplit > 0
          ? Math.round((fixed / totalForSplit) * 10000) / 100
          : 0,
      discretionaryPct:
        totalForSplit > 0
          ? Math.round((discretionary / totalForSplit) * 10000) / 100
          : 0,
    };

    // --- Spike detection ---
    const currentMonthStr = getMonthString(now);
    const prevMonths: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      prevMonths.push(getMonthString(d));
    }

    const currentRange = getMonthStartEnd(currentMonthStr);
    const currentCategoryTotals = await getExpenseTotalsByCategory(
      userId,
      currentRange.start,
      currentRange.end,
    );

    const prevCategoryTotalsArr = await Promise.all(
      prevMonths.map((m) => {
        const range = getMonthStartEnd(m);
        return getExpenseTotalsByCategory(userId, range.start, range.end);
      }),
    );

    const prevAvgMap = new Map<string, number>();
    const prevCountMap = new Map<string, number>();
    for (const monthTotals of prevCategoryTotalsArr) {
      for (const ct of monthTotals) {
        prevAvgMap.set(
          ct.category_id,
          (prevAvgMap.get(ct.category_id) ?? 0) + ct.total,
        );
        prevCountMap.set(
          ct.category_id,
          (prevCountMap.get(ct.category_id) ?? 0) + 1,
        );
      }
    }
    // Average over 3 months (use 3 as denominator even if category absent some months)
    for (const [catId, total] of prevAvgMap) {
      prevAvgMap.set(catId, total / 3);
    }

    const spikingCategories: FinancialHealthReport["spikingCategories"] = [];
    for (const ct of currentCategoryTotals) {
      const avg = prevAvgMap.get(ct.category_id);
      if (avg != null && avg > 0 && ct.total >= avg * 2) {
        spikingCategories.push({
          categoryId: ct.category_id,
          categoryName: categoryMap.get(ct.category_id) ?? "Unknown",
          currentMonth: ct.total,
          avgPrevious: Math.round(avg),
          spikeMultiple: Math.round((ct.total / avg) * 10) / 10,
        });
      }
    }
    spikingCategories.sort((a, b) => b.spikeMultiple - a.spikeMultiple);

    // --- Grading ---
    const assetGroups = new Set(bs.assets.map((a) => a.group));

    const savingsScore = scoreSavingsRate(currentSavingsRate);
    const debtScore = scoreDebt(debtToIncomeRatio);
    const diversificationScore = scoreDiversification(assetGroups.size);
    const emergencyScore = scoreEmergencyFund(emergencyMonths);
    const disciplineScore = scoreSpendingDiscipline(spikingCategories.length);

    const dimensions = [
      {
        name: "Savings Rate",
        score: savingsScore,
        grade: scoreToGrade(savingsScore),
        description: `Current savings rate is ${Math.round(currentSavingsRate)}% of income.`,
      },
      {
        name: "Debt Management",
        score: debtScore,
        grade: scoreToGrade(debtScore),
        description:
          monthlyEMI > 0
            ? `Debt-to-income ratio is ${debtToIncomeRatio}%.`
            : "No active debt obligations.",
      },
      {
        name: "Diversification",
        score: diversificationScore,
        grade: scoreToGrade(diversificationScore),
        description: `Assets spread across ${assetGroups.size} group${assetGroups.size !== 1 ? "s" : ""}.`,
      },
      {
        name: "Emergency Fund",
        score: emergencyScore,
        grade: scoreToGrade(emergencyScore),
        description:
          emergencyMonths > 0
            ? `Liquid reserves cover ${emergencyMonths} months of expenses.`
            : "No liquid reserves detected.",
      },
      {
        name: "Spending Discipline",
        score: disciplineScore,
        grade: scoreToGrade(disciplineScore),
        description:
          spikingCategories.length === 0
            ? "No spending spikes detected this month."
            : `${spikingCategories.length} categor${spikingCategories.length === 1 ? "y" : "ies"} spiking above normal.`,
      },
    ];

    const overallScore = Math.round(
      savingsScore * 0.3 +
        debtScore * 0.25 +
        diversificationScore * 0.15 +
        emergencyScore * 0.15 +
        disciplineScore * 0.15,
    );
    const overallGrade = scoreToGrade(overallScore);

    return {
      generatedAt: now.toISOString(),
      dataAsOf: today,

      overallGrade,
      overallScore,
      gradeSummary: buildGradeSummary(overallGrade, overallScore),
      dimensions,

      totalAssets: bs.totalAssets,
      totalLiabilities: bs.totalLiabilities,
      netWorth: bs.netWorth,
      assetBreakdown,
      liabilityBreakdown,

      currentSavingsRate,
      monthlySavingsRates,
      avgSavingsRate: Math.round(avgSavingsRate * 100) / 100,

      debtToIncomeRatio,
      monthlyEMI,
      monthlyIncome,

      monthlyExpenseAvg,
      liquidAssets,
      emergencyMonths,
      emergencyTarget,
      emergencyGap,

      categoryBreakdown,
      fixedVsDiscretionary,

      spikingCategories,
    };
  } catch {
    return emptyReport();
  }
}

function emptyReport(): FinancialHealthReport {
  const now = new Date();
  return {
    generatedAt: now.toISOString(),
    dataAsOf: toIsoDate(now),
    overallGrade: "F",
    overallScore: 0,
    gradeSummary: "Unable to compute financial health report.",
    dimensions: [],
    totalAssets: 0,
    totalLiabilities: 0,
    netWorth: 0,
    assetBreakdown: [],
    liabilityBreakdown: [],
    currentSavingsRate: 0,
    monthlySavingsRates: [],
    avgSavingsRate: 0,
    debtToIncomeRatio: 0,
    monthlyEMI: 0,
    monthlyIncome: 0,
    monthlyExpenseAvg: 0,
    liquidAssets: 0,
    emergencyMonths: 0,
    emergencyTarget: 0,
    emergencyGap: 0,
    categoryBreakdown: [],
    fixedVsDiscretionary: { fixed: 0, discretionary: 0, fixedPct: 0, discretionaryPct: 0 },
    spikingCategories: [],
  };
}
