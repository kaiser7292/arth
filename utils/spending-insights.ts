/**
 * Spending Insights — Pure Calculation Functions (Task 22.0)
 *
 * Analyzes expense data to generate actionable insights:
 * 1. Category trends (3-month direction: rising/falling/stable)
 * 2. Anomaly detection (transactions significantly above average)
 * 3. Merchant analytics (top merchants by spend, frequency)
 * 4. Day-of-week patterns (weekday vs weekend spending)
 * 5. Payment mode distribution
 * 6. Overall insights summary (plain English)
 *
 * All functions are pure — they take data in, return insights out.
 * The service layer (services/spending-insights.ts) handles DB queries.
 */

import { round2 } from "@/utils/math";
import { formatNumber as formatNum } from "@/utils/format";

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

export interface CategoryTrend {
  categoryId: string;
  currentMonth: number;
  previousMonth: number;
  twoMonthsAgo: number;
  threeMonthAvg: number;
  direction: "rising" | "falling" | "stable";
  /** % change vs previous month (positive = spending more) */
  changePct: number;
}

export interface SpendingAnomaly {
  expenseId: string;
  amount: number;
  description: string | null;
  date: string;
  categoryId: string;
  /** Average spend per transaction in this category */
  categoryAvg: number;
  /** How many times above average (e.g., 2.5 = 2.5x the average) */
  deviationMultiple: number;
}

export interface MerchantInsight {
  merchant: string;
  totalSpent: number;
  transactionCount: number;
  avgAmount: number;
  lastDate: string;
  categoryId: string | null;
}

export interface DayPattern {
  weekdayTotal: number;
  weekendTotal: number;
  weekdayAvgPerDay: number;
  weekendAvgPerDay: number;
  weekdayCount: number;
  weekendCount: number;
  higherOn: "weekday" | "weekend" | "equal";
}

export interface PaymentModeShare {
  paymentModeId: string;
  totalSpent: number;
  transactionCount: number;
  /** Percentage of total spending */
  pct: number;
}

export interface InsightsSummary {
  /** Plain English insight strings (top 5 most interesting) */
  topInsights: string[];
  categoryTrends: CategoryTrend[];
  anomalies: SpendingAnomaly[];
  topMerchants: MerchantInsight[];
  dayPattern: DayPattern;
  paymentModes: PaymentModeShare[];
  /** Headline totals for the Spending Pulse (all expenses, not just categorized) */
  monthTotals: { currentMonth: number; previousMonth: number };
}

// ═══════════════════════════════════════════════
// Input types (what the service layer provides)
// ═══════════════════════════════════════════════

export interface MonthlyCategory {
  categoryId: string;
  month: string; // "YYYY-MM"
  total: number;
}

export interface ExpenseRecord {
  id: string;
  amount: number;
  description: string | null;
  merchantName?: string | null;
  date: string; // "YYYY-MM-DD"
  categoryId: string | null;
  paymentModeId: string | null;
}

// ═══════════════════════════════════════════════
// 1. Category Trends
// ═══════════════════════════════════════════════

/**
 * Calculate spending trend direction for each category over 3 months.
 *
 * Direction logic:
 * - "rising" if current > 3-month avg by 10%+
 * - "falling" if current < 3-month avg by 10%+
 * - "stable" otherwise
 *
 * @param monthlyData — per-category monthly totals (expects 3 months of data)
 * @param months — the 3 months to analyze, ordered [oldest, middle, newest]
 */
export function calculateCategoryTrends(
  monthlyData: MonthlyCategory[],
  months: [string, string, string],
): CategoryTrend[] {
  // Group by category
  const byCategory = new Map<string, Map<string, number>>();
  for (const entry of monthlyData) {
    if (!byCategory.has(entry.categoryId)) {
      byCategory.set(entry.categoryId, new Map());
    }
    byCategory.get(entry.categoryId)!.set(entry.month, entry.total);
  }

  const trends: CategoryTrend[] = [];

  for (const [categoryId, monthMap] of byCategory) {
    const twoMonthsAgo = monthMap.get(months[0]) ?? 0;
    const previousMonth = monthMap.get(months[1]) ?? 0;
    const currentMonth = monthMap.get(months[2]) ?? 0;

    const threeMonthAvg = (twoMonthsAgo + previousMonth + currentMonth) / 3;

    // Direction: compare current to 3-month average
    let direction: "rising" | "falling" | "stable";
    if (threeMonthAvg === 0) {
      direction = currentMonth > 0 ? "rising" : "stable";
    } else {
      const deviationPct = ((currentMonth - threeMonthAvg) / threeMonthAvg) * 100;
      if (deviationPct > 10) direction = "rising";
      else if (deviationPct < -10) direction = "falling";
      else direction = "stable";
    }

    // % change vs previous month
    const changePct =
      previousMonth > 0
        ? round2(((currentMonth - previousMonth) / previousMonth) * 100)
        : currentMonth > 0
          ? 100
          : 0;

    trends.push({
      categoryId,
      currentMonth: round2(currentMonth),
      previousMonth: round2(previousMonth),
      twoMonthsAgo: round2(twoMonthsAgo),
      threeMonthAvg: round2(threeMonthAvg),
      direction,
      changePct,
    });
  }

  // Sort: biggest spenders first
  return trends.sort((a, b) => b.currentMonth - a.currentMonth);
}

// ═══════════════════════════════════════════════
// 2. Anomaly Detection
// ═══════════════════════════════════════════════

/**
 * Flag individual transactions that are significantly above the
 * per-transaction average for their category.
 *
 * @param expenses — recent expenses to scan for anomalies
 * @param categoryAverages — map of categoryId → avg amount per transaction
 * @param threshold — multiplier threshold (default 2.0 = 2x the average)
 */
export function detectAnomalies(
  expenses: ExpenseRecord[],
  categoryAverages: Map<string, number>,
  threshold: number = 2.0,
): SpendingAnomaly[] {
  const anomalies: SpendingAnomaly[] = [];

  for (const exp of expenses) {
    if (!exp.categoryId) continue;
    const avg = categoryAverages.get(exp.categoryId);
    if (!avg || avg === 0) continue;

    const multiple = exp.amount / avg;
    if (multiple >= threshold) {
      anomalies.push({
        expenseId: exp.id,
        amount: exp.amount,
        description: exp.description,
        date: exp.date,
        categoryId: exp.categoryId,
        categoryAvg: round2(avg),
        deviationMultiple: round2(multiple),
      });
    }
  }

  // Sort by deviation (most anomalous first)
  return anomalies.sort((a, b) => b.deviationMultiple - a.deviationMultiple);
}

// ═══════════════════════════════════════════════
// 3. Merchant Analytics
// ═══════════════════════════════════════════════

/**
 * Aggregate spending by merchant (normalized description).
 * Returns top merchants sorted by total spend descending.
 */
export function analyzeMerchants(
  expenses: ExpenseRecord[],
  limit: number = 10,
): MerchantInsight[] {
  const merchantMap = new Map<
    string,
    { total: number; count: number; lastDate: string; categoryId: string | null }
  >();

  for (const exp of expenses) {
    const merchant = exp.merchantName
      ? exp.merchantName.trim().toLowerCase()
      : "unknown";
    if (!merchant) continue;

    const existing = merchantMap.get(merchant);
    if (existing) {
      existing.total += exp.amount;
      existing.count++;
      if (exp.date > existing.lastDate) {
        existing.lastDate = exp.date;
        existing.categoryId = exp.categoryId;
      }
    } else {
      merchantMap.set(merchant, {
        total: exp.amount,
        count: 1,
        lastDate: exp.date,
        categoryId: exp.categoryId,
      });
    }
  }

  const results: MerchantInsight[] = [];
  for (const [merchant, data] of merchantMap) {
    results.push({
      merchant,
      totalSpent: round2(data.total),
      transactionCount: data.count,
      avgAmount: round2(data.total / data.count),
      lastDate: data.lastDate,
      categoryId: data.categoryId,
    });
  }

  return results.sort((a, b) => b.totalSpent - a.totalSpent).slice(0, limit);
}

/**
 * Simple merchant name normalization.
 * Strips common suffixes (repeatedly), lowercases, trims whitespace.
 */
export function normalizeMerchantName(description: string | null): string | null {
  if (!description) return null;
  let name = description.trim().toLowerCase();
  // Strip " via UPI" / " via NEFT" etc.
  name = name.replace(/\s+via\s+\w+$/i, "");
  // Strip common corporate suffixes (loop until stable)
  let prev = "";
  while (prev !== name) {
    prev = name;
    name = name.replace(/\s+(ltd|pvt|inc|india|payments|services|private|limited)\.?\s*$/i, "");
  }
  name = name.trim();
  return name.length > 0 ? name : null;
}

// ═══════════════════════════════════════════════
// 4. Day-of-Week Patterns
// ═══════════════════════════════════════════════

/**
 * Analyze spending split between weekdays (Mon-Fri) and weekends (Sat-Sun).
 */
export function analyzeDayPatterns(
  expenses: ExpenseRecord[],
): DayPattern {
  let weekdayTotal = 0;
  let weekendTotal = 0;
  let weekdayCount = 0;
  let weekendCount = 0;

  for (const exp of expenses) {
    const day = new Date(exp.date).getDay(); // 0=Sun, 6=Sat
    if (day === 0 || day === 6) {
      weekendTotal += exp.amount;
      weekendCount++;
    } else {
      weekdayTotal += exp.amount;
      weekdayCount++;
    }
  }

  // Average per calendar day (5 weekdays, 2 weekend days per week)
  // Use transaction count ratio to estimate days
  const totalDays = expenses.length > 0
    ? Math.ceil(
        (new Date(expenses[0].date).getTime() -
          new Date(expenses[expenses.length - 1].date).getTime()) /
          (1000 * 60 * 60 * 24),
      ) + 1
    : 0;

  const weekdayDays = totalDays > 0 ? Math.round((totalDays * 5) / 7) : 1;
  const weekendDays = totalDays > 0 ? Math.round((totalDays * 2) / 7) : 1;

  const weekdayAvgPerDay = weekdayDays > 0 ? round2(weekdayTotal / weekdayDays) : 0;
  const weekendAvgPerDay = weekendDays > 0 ? round2(weekendTotal / weekendDays) : 0;

  let higherOn: "weekday" | "weekend" | "equal";
  if (weekdayAvgPerDay > weekendAvgPerDay * 1.1) higherOn = "weekday";
  else if (weekendAvgPerDay > weekdayAvgPerDay * 1.1) higherOn = "weekend";
  else higherOn = "equal";

  return {
    weekdayTotal: round2(weekdayTotal),
    weekendTotal: round2(weekendTotal),
    weekdayAvgPerDay,
    weekendAvgPerDay,
    weekdayCount,
    weekendCount,
    higherOn,
  };
}

// ═══════════════════════════════════════════════
// 5. Payment Mode Distribution
// ═══════════════════════════════════════════════

/**
 * Break down spending by payment mode.
 */
export function analyzePaymentModes(
  expenses: ExpenseRecord[],
): PaymentModeShare[] {
  const modeMap = new Map<string, { total: number; count: number }>();
  let grandTotal = 0;

  for (const exp of expenses) {
    const modeId = exp.paymentModeId ?? "unknown";
    const existing = modeMap.get(modeId);
    if (existing) {
      existing.total += exp.amount;
      existing.count++;
    } else {
      modeMap.set(modeId, { total: exp.amount, count: 1 });
    }
    grandTotal += exp.amount;
  }

  const results: PaymentModeShare[] = [];
  for (const [modeId, data] of modeMap) {
    results.push({
      paymentModeId: modeId,
      totalSpent: round2(data.total),
      transactionCount: data.count,
      pct: grandTotal > 0 ? round2((data.total / grandTotal) * 100) : 0,
    });
  }

  return results.sort((a, b) => b.totalSpent - a.totalSpent);
}

// ═══════════════════════════════════════════════
// 6. Generate Plain English Insights
// ═══════════════════════════════════════════════

/**
 * Generate a prioritized list of plain English insights from all analyses.
 * Returns up to 5 of the most interesting/actionable insights.
 */
export function generateInsights(
  trends: CategoryTrend[],
  anomalies: SpendingAnomaly[],
  merchants: MerchantInsight[],
  dayPattern: DayPattern,
  categoryNames: Map<string, string>,
): string[] {
  const insights: { text: string; priority: number }[] = [];

  // Rising categories
  const rising = trends.filter((t) => t.direction === "rising" && t.changePct > 20);
  for (const t of rising.slice(0, 2)) {
    const name = categoryNames.get(t.categoryId) ?? "Unknown";
    insights.push({
      text: `${name} spending is up ${Math.abs(t.changePct)}% vs last month (₹${formatNum(t.currentMonth)} → was ₹${formatNum(t.previousMonth)})`,
      priority: 90 + Math.min(t.changePct, 50),
    });
  }

  // Falling categories (good news)
  const falling = trends.filter((t) => t.direction === "falling" && t.changePct < -20);
  for (const t of falling.slice(0, 1)) {
    const name = categoryNames.get(t.categoryId) ?? "Unknown";
    insights.push({
      text: `${name} spending dropped ${Math.abs(t.changePct)}% vs last month - nice!`,
      priority: 70,
    });
  }

  // Anomalies
  if (anomalies.length > 0) {
    const top = anomalies[0];
    const catName = categoryNames.get(top.categoryId) ?? "Unknown";
    insights.push({
      text: `Unusual spend: ₹${formatNum(top.amount)} on ${top.description ?? catName} - ${top.deviationMultiple}x your average for ${catName}`,
      priority: 85,
    });
  }

  // Top merchant
  if (merchants.length > 0) {
    const top = merchants[0];
    insights.push({
      text: `Top merchant: ${top.merchant} - ₹${formatNum(top.totalSpent)} across ${top.transactionCount} transactions`,
      priority: 60,
    });
  }

  // Weekend pattern
  if (dayPattern.higherOn === "weekend" && dayPattern.weekendTotal > 0) {
    const ratio = dayPattern.weekendAvgPerDay / Math.max(dayPattern.weekdayAvgPerDay, 1);
    if (ratio > 1.3) {
      insights.push({
        text: `Weekend spending is ${round2(ratio)}x your weekday average - ₹${formatNum(dayPattern.weekendAvgPerDay)}/day vs ₹${formatNum(dayPattern.weekdayAvgPerDay)}/day`,
        priority: 50,
      });
    }
  }

  // Sort by priority, return top 5
  return insights
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 5)
    .map((i) => i.text);
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════


