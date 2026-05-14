import { fetchAnalyticsDatasets, classifyExpenses } from "./data-layer";
import { rankInsights } from "@/utils/analytics/scoring";
import { THRESHOLDS } from "@/utils/analytics/thresholds";
import type { AnalyticsDashboard, RankedInsight, PatternResult } from "@/utils/analytics/types";

export type { AnalyticsDashboard, RankedInsight };

export async function getAnalyticsDashboard(
  userId: string,
  month?: string
): Promise<AnalyticsDashboard> {
  const datasets = await fetchAnalyticsDatasets(userId, month);

  const classifiedExpenses = classifyExpenses(
    datasets.expenses,
    datasets.recurringTransactions
  );

  // Phase 2 will add real detectors here
  const patterns: PatternResult[] = [];

  const insights = rankInsights(
    patterns,
    datasets.monthlyIncome,
    datasets.dataMonths,
    datasets.categoryUnavoidableMap
  );

  const limited = insights.slice(0, THRESHOLDS.DASHBOARD_MAX_INSIGHTS);

  return {
    generatedAt: new Date().toISOString(),
    period: {
      start: `${datasets.currentMonth}-01`,
      end: getMonthEnd(datasets.currentMonth),
    },
    insights: limited,
    totalPatterns: patterns.length,
    dataVersion: Date.now(),
  };
}

function getMonthEnd(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const lastDay = new Date(year, m, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}
