import { THRESHOLDS } from "./thresholds";
import type { PatternResult, PatternType, RankedInsight } from "./types";

interface ScoreBreakdown {
  impact: number;
  actionability: number;
  urgency: number;
  confidence: number;
}

export function calculateImpact(amount: number, monthlyIncome: number): number {
  if (monthlyIncome <= 0) return 50;
  const pct = (amount / monthlyIncome) * 100;
  if (pct >= 20) return 100;
  if (pct >= 10) return 80;
  if (pct >= 5) return 60;
  if (pct >= 2) return 40;
  return 20;
}

export function calculateActionability(
  categoryIsUnavoidable: boolean,
  patternType: PatternType
): number {
  if (categoryIsUnavoidable) return 10;

  const highActionability: PatternType[] = [
    "micro_leak",
    "weekend_warrior",
    "lifestyle_creep",
    "credit_card_creep",
  ];
  const medActionability: PatternType[] = [
    "budget_breach",
    "category_drift",
    "recurring_growth",
  ];

  if (highActionability.includes(patternType)) return 85;
  if (medActionability.includes(patternType)) return 60;
  return 40;
}

export function calculateUrgency(
  patternType: PatternType,
  context: { daysRemaining?: number; monthsObserved?: number }
): number {
  const currentMonthTypes: PatternType[] = ["budget_breach", "goal_jeopardy"];
  if (currentMonthTypes.includes(patternType)) {
    const daysLeft = context.daysRemaining ?? 15;
    if (daysLeft <= 7) return 100;
    if (daysLeft <= 14) return 80;
    return 60;
  }

  const trendTypes: PatternType[] = [
    "lifestyle_creep",
    "category_drift",
    "savings_erosion",
    "credit_card_creep",
  ];
  if (trendTypes.includes(patternType)) {
    const months = context.monthsObserved ?? 3;
    if (months >= 6) return 70;
    if (months >= 4) return 50;
    return 30;
  }

  return 40;
}

export function calculateConfidence(
  patternConfidence: number,
  dataMonths: number
): number {
  const monthFactor = Math.min(dataMonths / THRESHOLDS.HIGH_CONFIDENCE_MONTHS, 1);
  return Math.round(patternConfidence * 100 * monthFactor);
}

export function calculateInsightScore(breakdown: ScoreBreakdown): number {
  return Math.round(
    breakdown.impact * THRESHOLDS.SCORE_IMPACT_WEIGHT +
    breakdown.actionability * THRESHOLDS.SCORE_ACTIONABILITY_WEIGHT +
    breakdown.urgency * THRESHOLDS.SCORE_URGENCY_WEIGHT +
    breakdown.confidence * THRESHOLDS.SCORE_CONFIDENCE_WEIGHT
  );
}

export function rankInsights(
  patterns: PatternResult[],
  monthlyIncome: number,
  dataMonths: number,
  categoryUnavoidableMap: Map<string, boolean>
): RankedInsight[] {
  const ranked = patterns.map((pattern, idx) => {
    const primaryCategory = pattern.affectedCategoryIds?.[0];
    const isUnavoidable = primaryCategory
      ? categoryUnavoidableMap.get(primaryCategory) ?? false
      : false;

    const breakdown: ScoreBreakdown = {
      impact: calculateImpact(pattern.metric, monthlyIncome),
      actionability: calculateActionability(isUnavoidable, pattern.type),
      urgency: calculateUrgency(pattern.type, {}),
      confidence: calculateConfidence(pattern.confidence, dataMonths),
    };

    const score = calculateInsightScore(breakdown);

    const insight: RankedInsight = {
      id: `${pattern.type}_${pattern.timeRange.start}_${idx}`,
      pattern,
      score,
      scoreBreakdown: breakdown,
    };

    return insight;
  });

  return ranked.sort((a, b) => b.score - a.score);
}
