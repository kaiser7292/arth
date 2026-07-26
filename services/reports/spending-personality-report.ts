import { getDatabase } from "@/database";
import { effectiveAmountSql } from "@/services/expense-effective-amount";
import { getCategories, type Category } from "@/services/category";
import { toIsoDate, getLastDayOfMonth } from "@/utils/date";

export interface SpendingArchetype {
  name: string;
  emoji: string;
  description: string;
  traits: string[];
}

export interface SpendingPersonalityReport {
  generatedAt: string;
  dataAsOf: string;
  monthsAnalyzed: number;

  archetype: SpendingArchetype;

  topCategories: {
    categoryId: string;
    categoryName: string;
    totalSpent: number;
    percentage: number;
    avgMonthly: number;
    trend: "rising" | "falling" | "stable";
  }[];

  topMerchants: {
    merchant: string;
    totalSpent: number;
    transactionCount: number;
    avgTransaction: number;
  }[];

  dayOfWeekPattern: {
    day: string;
    avgSpend: number;
    transactionCount: number;
  }[];
  mostExpensiveDay: string;
  cheapestDay: string;

  weekdayAvgDaily: number;
  weekendAvgDaily: number;
  weekendMultiple: number;

  monthlyPattern: {
    month: string;
    total: number;
    transactionCount: number;
    avgTransaction: number;
  }[];
  highestSpendMonth: { month: string; total: number };
  lowestSpendMonth: { month: string; total: number };
  monthlyAvg: number;
  monthlyVolatility: number;

  insights: {
    icon: string;
    title: string;
    detail: string;
    sentiment: "positive" | "neutral" | "warning";
  }[];

  consistencyScore: number;
  consistencyLabel: string;
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const BASE_WHERE = `
  status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
  AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
  AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id)
  AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id)
`;

function getDateRange(): { startDate: string; endDate: string; startMonth: string } {
  const now = new Date();
  const endDate = toIsoDate(now);
  const startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const startMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}`;
  return { startDate: toIsoDate(startDate), endDate, startMonth };
}

function buildCategoryMap(categories: Category[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of categories) map.set(c.id, c.name);
  return map;
}

function computeCV(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function cvToScore(cv: number): { score: number; label: string } {
  if (cv < 0.15) return { score: Math.round(90 + (0.15 - cv) / 0.15 * 10), label: "Very consistent" };
  if (cv < 0.25) return { score: Math.round(70 + (0.25 - cv) / 0.10 * 19), label: "Consistent" };
  if (cv < 0.35) return { score: Math.round(50 + (0.35 - cv) / 0.10 * 19), label: "Moderate" };
  if (cv < 0.50) return { score: Math.round(30 + (0.50 - cv) / 0.15 * 19), label: "Variable" };
  return { score: Math.max(10, Math.round(29 - (cv - 0.50) * 38)), label: "Unpredictable" };
}

function determineTrend(
  monthlyTotals: Map<string, number>,
  months: string[],
): "rising" | "falling" | "stable" {
  if (months.length < 2) return "stable";
  const lastMonth = months[months.length - 1];
  const priorMonths = months.slice(0, -1).slice(-3);
  if (priorMonths.length === 0) return "stable";
  const priorAvg =
    priorMonths.reduce((s, m) => s + (monthlyTotals.get(m) ?? 0), 0) / priorMonths.length;
  const current = monthlyTotals.get(lastMonth) ?? 0;
  if (priorAvg === 0) return current > 0 ? "rising" : "stable";
  if (current > priorAvg * 1.2) return "rising";
  if (current < priorAvg * 0.8) return "falling";
  return "stable";
}

const ARCHETYPES: Record<string, SpendingArchetype> = {
  nester: {
    name: "The Nester",
    emoji: "\u{1F3E0}",
    description:
      "Your home is your castle. A significant share of your spending goes toward rent, housing, and making your space comfortable.",
    traits: [
      "Housing is your largest expense by far",
      "You prioritize a comfortable living space",
      "Spending is anchored around predictable home costs",
      "You likely value stability and routine",
    ],
  },
  foodie: {
    name: "The Foodie",
    emoji: "\u{1F355}",
    description:
      "Good food is non-negotiable. Whether dining out or stocking the kitchen, food dominates your wallet.",
    traits: [
      "Food and groceries are your top category",
      "You probably know the best restaurants around",
      "Your merchant list is full of food spots",
      "Meal-related spending is consistent month to month",
    ],
  },
  explorer: {
    name: "The Explorer",
    emoji: "✈️",
    description:
      "You spend on getting places. Travel, transport, and fuel keep you on the move.",
    traits: [
      "Travel and transport lead your spending",
      "You value experiences over things",
      "Commute and trip costs are a big chunk",
      "You likely have a mix of daily and occasional travel expenses",
    ],
  },
  collector: {
    name: "The Collector",
    emoji: "\u{1F6CD}️",
    description:
      "Shopping is your thing. You know where the deals are and your cart is never empty for long.",
    traits: [
      "Shopping is your dominant category",
      "You have a wide variety of merchants",
      "Spending spikes around sales and seasons",
      "You enjoy the thrill of a good find",
    ],
  },
  weekendWarrior: {
    name: "The Weekend Warrior",
    emoji: "\u{1F389}",
    description:
      "Weekends are when your wallet comes alive. You spend significantly more on Saturdays and Sundays than during the week.",
    traits: [
      "Weekend spending is nearly double your weekday average",
      "You save up energy (and money) for the weekend",
      "Leisure and dining likely spike on Sat/Sun",
      "Your weekdays are disciplined but weekends are for living",
    ],
  },
  methodical: {
    name: "The Methodical Spender",
    emoji: "\u{1F4CA}",
    description:
      "Your spending is remarkably predictable. Month after month, the numbers barely budge. Budgeting comes naturally to you.",
    traits: [
      "Very low month-to-month variation",
      "You likely follow a budget or spending plan",
      "Surprises are rare in your financial life",
      "Consistency is your superpower",
    ],
  },
  impulseRider: {
    name: "The Impulse Rider",
    emoji: "\u{1F3A2}",
    description:
      "Your spending has dramatic peaks and valleys. Some months are frugal, others are splurges. Life is unpredictable and your spending reflects it.",
    traits: [
      "High month-to-month spending variation",
      "Big-ticket purchases create noticeable spikes",
      "You might benefit from a spending buffer",
      "Spontaneity is part of your financial personality",
    ],
  },
  balanced: {
    name: "The Balanced Planner",
    emoji: "\u{1F3AF}",
    description:
      "No single category dominates your spending. You spread your money across needs and wants in a balanced way.",
    traits: [
      "Diversified spending across multiple categories",
      "No extreme patterns in any direction",
      "You manage competing priorities well",
      "A little bit of everything, nothing out of control",
    ],
  },
  healthEnthusiast: {
    name: "The Health Enthusiast",
    emoji: "\u{1F3CB}️",
    description:
      "Health and wellness take priority in your spending. Gym memberships, medical visits, and self-care define your financial profile.",
    traits: [
      "Health and medical costs are a top category",
      "You invest in your physical wellbeing",
      "Preventive care and fitness feature prominently",
      "Spending here reflects long-term thinking",
    ],
  },
  techie: {
    name: "The Digital Native",
    emoji: "\u{1F4F1}",
    description:
      "Subscriptions, gadgets, and digital services make up a big slice of your spending. You live in the connected world.",
    traits: [
      "Bills, subscriptions, and tech purchases lead spending",
      "You're an early adopter of digital services",
      "Recurring digital costs add up quietly",
      "Your spending is heavily subscription-driven",
    ],
  },
  newExplorer: {
    name: "The New Explorer",
    emoji: "\u{1F331}",
    description:
      "You're just getting started tracking your spending. Keep going and your financial personality will emerge!",
    traits: [
      "Less than 2 months of data available",
      "Your patterns are still forming",
      "Every tracked transaction adds clarity",
      "Check back soon for deeper insights",
    ],
  },
};

function determineArchetype(
  topCategories: SpendingPersonalityReport["topCategories"],
  weekendMultiple: number,
  consistencyScore: number,
  monthlyVolatility: number,
): SpendingArchetype {
  if (topCategories.length === 0) return ARCHETYPES.balanced;

  const topPct = topCategories[0]?.percentage ?? 0;
  const topName = (topCategories[0]?.categoryName ?? "").toLowerCase();

  if (topPct > 40) {
    if (topName.includes("rent") || topName.includes("housing") || topName.includes("home"))
      return ARCHETYPES.nester;
    if (topName.includes("food") || topName.includes("grocer") || topName.includes("dining"))
      return ARCHETYPES.foodie;
    if (topName.includes("travel") || topName.includes("transport") || topName.includes("fuel"))
      return ARCHETYPES.explorer;
    if (topName.includes("shopping") || topName.includes("retail"))
      return ARCHETYPES.collector;
    if (topName.includes("health") || topName.includes("medical") || topName.includes("fitness"))
      return ARCHETYPES.healthEnthusiast;
    if (
      topName.includes("bill") ||
      topName.includes("subscription") ||
      topName.includes("tech") ||
      topName.includes("recharge")
    )
      return ARCHETYPES.techie;
  }

  if (weekendMultiple > 1.8) return ARCHETYPES.weekendWarrior;
  if (consistencyScore > 80) return ARCHETYPES.methodical;
  if (monthlyVolatility > 0.4) return ARCHETYPES.impulseRider;

  return ARCHETYPES.balanced;
}

function generateInsights(report: {
  topCategories: SpendingPersonalityReport["topCategories"];
  topMerchants: SpendingPersonalityReport["topMerchants"];
  mostExpensiveDay: string;
  cheapestDay: string;
  weekendMultiple: number;
  monthlyAvg: number;
  monthlyVolatility: number;
  consistencyScore: number;
  monthlyPattern: SpendingPersonalityReport["monthlyPattern"];
}): SpendingPersonalityReport["insights"] {
  const insights: SpendingPersonalityReport["insights"] = [];

  if (report.mostExpensiveDay && report.weekendMultiple > 0) {
    const mult = report.weekendMultiple.toFixed(1);
    if (report.weekendMultiple > 1.3) {
      insights.push({
        icon: "calendar-outline",
        title: "Weekend spender",
        detail: `Your most expensive day is ${report.mostExpensiveDay} — you spend ${mult}x your weekday average on weekends.`,
        sentiment: "warning",
      });
    } else if (report.weekendMultiple < 0.8) {
      insights.push({
        icon: "calendar-outline",
        title: "Weekday spender",
        detail: `You actually spend less on weekends than weekdays. ${report.cheapestDay} is your lightest day.`,
        sentiment: "neutral",
      });
    }
  }

  const risingCategories = report.topCategories.filter((c) => c.trend === "rising");
  if (risingCategories.length > 0) {
    const names = risingCategories
      .slice(0, 2)
      .map((c) => c.categoryName)
      .join(" and ");
    insights.push({
      icon: "trending-up-outline",
      title: "Rising spending",
      detail: `${names} spending has been rising recently compared to your 3-month average.`,
      sentiment: "warning",
    });
  }

  const fallingCategories = report.topCategories.filter((c) => c.trend === "falling");
  if (fallingCategories.length > 0) {
    const names = fallingCategories
      .slice(0, 2)
      .map((c) => c.categoryName)
      .join(" and ");
    insights.push({
      icon: "trending-down-outline",
      title: "Spending cooling off",
      detail: `${names} spending has dropped compared to your 3-month average.`,
      sentiment: "positive",
    });
  }

  const totalTx = report.monthlyPattern.reduce((s, m) => s + m.transactionCount, 0);
  const monthCount = report.monthlyPattern.length || 1;
  const avgTxPerMonth = totalTx / monthCount;
  const avgTxPerDay = avgTxPerMonth / 30;
  insights.push({
    icon: "receipt-outline",
    title: "Transaction frequency",
    detail: `You averaged ${Math.round(avgTxPerMonth)} transactions/month — about ${avgTxPerDay.toFixed(1)} per day.`,
    sentiment: "neutral",
  });

  if (report.consistencyScore > 75) {
    const cvPct = Math.round(report.monthlyVolatility * 100);
    insights.push({
      icon: "shield-checkmark-outline",
      title: "Predictable spender",
      detail: `Your spending is very consistent — monthly variation is only ${cvPct}%.`,
      sentiment: "positive",
    });
  } else if (report.consistencyScore < 40) {
    insights.push({
      icon: "flash-outline",
      title: "Volatile spending",
      detail: `Your monthly spending swings a lot. Consider setting a monthly spending target to smooth things out.`,
      sentiment: "warning",
    });
  }

  if (report.topMerchants.length >= 5) {
    const foodKeywords = ["food", "restaurant", "cafe", "swiggy", "zomato", "grocer", "kitchen", "pizza", "burger", "chai", "tea", "coffee"];
    const foodMerchantCount = report.topMerchants
      .slice(0, 5)
      .filter((m) => foodKeywords.some((k) => m.merchant.toLowerCase().includes(k))).length;
    if (foodMerchantCount >= 3) {
      insights.push({
        icon: "restaurant-outline",
        title: "Food-heavy merchants",
        detail: `${foodMerchantCount} of your top 5 merchants are food-related.`,
        sentiment: "neutral",
      });
    }
  }

  if (report.topCategories.length > 0) {
    const topPct = report.topCategories[0].percentage;
    if (topPct > 50) {
      insights.push({
        icon: "pie-chart-outline",
        title: "Concentrated spending",
        detail: `${report.topCategories[0].categoryName} alone accounts for ${Math.round(topPct)}% of your total spending.`,
        sentiment: "warning",
      });
    }
  }

  return insights.slice(0, 6);
}

export async function generateSpendingPersonalityReport(
  userId: string,
): Promise<SpendingPersonalityReport> {
  const db = getDatabase();
  const now = new Date();
  const generatedAt = now.toISOString();
  const dataAsOf = toIsoDate(now);
  const { startDate, endDate } = getDateRange();

  const categories = await getCategories(userId);
  const catMap = buildCategoryMap(categories);

  const eaSql = effectiveAmountSql("expenses");

  type CatMonthRow = { category_id: string; month: string; total: number; tx_count: number };
  const catMonthRows = await db.getAllAsync<CatMonthRow>(
    `SELECT category_id, strftime('%Y-%m', date) as month,
            SUM(${eaSql}) as total, COUNT(*) as tx_count
     FROM expenses
     WHERE user_id = ? AND ${BASE_WHERE} AND date >= ? AND date <= ? AND category_id IS NOT NULL
     GROUP BY category_id, strftime('%Y-%m', date)`,
    userId,
    startDate,
    endDate,
  );

  const allMonths = [...new Set(catMonthRows.map((r) => r.month))].sort();
  const monthsAnalyzed = allMonths.length;

  if (monthsAnalyzed < 2) {
    return buildMinimalReport(generatedAt, dataAsOf, monthsAnalyzed);
  }

  const catTotals = new Map<string, { total: number; txCount: number; monthlyMap: Map<string, number> }>();
  for (const row of catMonthRows) {
    let entry = catTotals.get(row.category_id);
    if (!entry) {
      entry = { total: 0, txCount: 0, monthlyMap: new Map() };
      catTotals.set(row.category_id, entry);
    }
    entry.total += row.total;
    entry.txCount += row.tx_count;
    entry.monthlyMap.set(row.month, (entry.monthlyMap.get(row.month) ?? 0) + row.total);
  }

  const grandTotal = [...catTotals.values()].reduce((s, e) => s + e.total, 0);

  const topCategories = [...catTotals.entries()]
    .map(([catId, data]) => ({
      categoryId: catId,
      categoryName: catMap.get(catId) ?? "Unknown",
      totalSpent: Math.round(data.total * 100) / 100,
      percentage: grandTotal > 0 ? Math.round((data.total / grandTotal) * 1000) / 10 : 0,
      avgMonthly: Math.round((data.total / monthsAnalyzed) * 100) / 100,
      trend: determineTrend(data.monthlyMap, allMonths),
    }))
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 10);

  type MerchantRow = { merchant_name: string; total: number; tx_count: number };
  const merchantRows = await db.getAllAsync<MerchantRow>(
    `SELECT merchant_name, SUM(${eaSql}) as total, COUNT(*) as tx_count
     FROM expenses
     WHERE user_id = ? AND ${BASE_WHERE} AND date >= ? AND date <= ?
       AND merchant_name IS NOT NULL AND merchant_name != ''
     GROUP BY merchant_name
     ORDER BY total DESC
     LIMIT 10`,
    userId,
    startDate,
    endDate,
  );

  const topMerchants = merchantRows.map((r) => ({
    merchant: r.merchant_name,
    totalSpent: Math.round(r.total * 100) / 100,
    transactionCount: r.tx_count,
    avgTransaction: r.tx_count > 0 ? Math.round((r.total / r.tx_count) * 100) / 100 : 0,
  }));

  type DowRow = { dow: number; total: number; tx_count: number };
  const dowRows = await db.getAllAsync<DowRow>(
    `SELECT CAST(strftime('%w', date) AS INTEGER) as dow,
            SUM(${eaSql}) as total, COUNT(*) as tx_count
     FROM expenses
     WHERE user_id = ? AND ${BASE_WHERE} AND date >= ? AND date <= ?
     GROUP BY dow`,
    userId,
    startDate,
    endDate,
  );

  const dowMap = new Map<number, { total: number; txCount: number }>();
  for (const r of dowRows) {
    dowMap.set(r.dow, { total: r.total, txCount: r.tx_count });
  }

  const dayOfWeekPattern = DAY_NAMES.map((name, i) => {
    const data = dowMap.get(i);
    const weeksInRange = monthsAnalyzed * (30 / 7);
    return {
      day: name,
      avgSpend: data ? Math.round((data.total / weeksInRange) * 100) / 100 : 0,
      transactionCount: data?.txCount ?? 0,
    };
  });

  let mostExpensiveDay = DAY_NAMES[0];
  let cheapestDay = DAY_NAMES[0];
  let maxAvg = 0;
  let minAvg = Infinity;
  for (const d of dayOfWeekPattern) {
    if (d.avgSpend > maxAvg) {
      maxAvg = d.avgSpend;
      mostExpensiveDay = d.day;
    }
    if (d.avgSpend < minAvg) {
      minAvg = d.avgSpend;
      cheapestDay = d.day;
    }
  }

  const weekendTotal =
    (dowMap.get(0)?.total ?? 0) + (dowMap.get(6)?.total ?? 0);
  const weekdayTotal =
    (dowMap.get(1)?.total ?? 0) +
    (dowMap.get(2)?.total ?? 0) +
    (dowMap.get(3)?.total ?? 0) +
    (dowMap.get(4)?.total ?? 0) +
    (dowMap.get(5)?.total ?? 0);

  const totalDays = Math.max(1, Math.round((now.getTime() - new Date(startDate).getTime()) / 86400000));
  const weekendDays = Math.round(totalDays * (2 / 7));
  const weekdayDays = totalDays - weekendDays;

  const weekendAvgDaily = weekendDays > 0 ? Math.round((weekendTotal / weekendDays) * 100) / 100 : 0;
  const weekdayAvgDaily = weekdayDays > 0 ? Math.round((weekdayTotal / weekdayDays) * 100) / 100 : 0;
  const weekendMultiple =
    weekdayAvgDaily > 0 ? Math.round((weekendAvgDaily / weekdayAvgDaily) * 100) / 100 : 0;

  type MonthRow = { month: string; total: number; tx_count: number };
  const monthRows = await db.getAllAsync<MonthRow>(
    `SELECT strftime('%Y-%m', date) as month, SUM(${eaSql}) as total, COUNT(*) as tx_count
     FROM expenses
     WHERE user_id = ? AND ${BASE_WHERE} AND date >= ? AND date <= ?
     GROUP BY month ORDER BY month`,
    userId,
    startDate,
    endDate,
  );

  const monthlyPattern = monthRows.map((r) => ({
    month: r.month,
    total: Math.round(r.total * 100) / 100,
    transactionCount: r.tx_count,
    avgTransaction: r.tx_count > 0 ? Math.round((r.total / r.tx_count) * 100) / 100 : 0,
  }));

  const monthTotals = monthlyPattern.map((m) => m.total);
  const monthlyAvg =
    monthTotals.length > 0
      ? Math.round((monthTotals.reduce((a, b) => a + b, 0) / monthTotals.length) * 100) / 100
      : 0;
  const monthlyVolatility = computeCV(monthTotals);

  let highestSpendMonth = { month: "", total: 0 };
  let lowestSpendMonth = { month: "", total: Infinity };
  for (const m of monthlyPattern) {
    if (m.total > highestSpendMonth.total) highestSpendMonth = { month: m.month, total: m.total };
    if (m.total < lowestSpendMonth.total) lowestSpendMonth = { month: m.month, total: m.total };
  }
  if (lowestSpendMonth.total === Infinity) lowestSpendMonth = { month: "", total: 0 };

  const { score: consistencyScore, label: consistencyLabel } = cvToScore(monthlyVolatility);

  const archetype = determineArchetype(
    topCategories,
    weekendMultiple,
    consistencyScore,
    monthlyVolatility,
  );

  const insights = generateInsights({
    topCategories,
    topMerchants,
    mostExpensiveDay,
    cheapestDay,
    weekendMultiple,
    monthlyAvg,
    monthlyVolatility,
    consistencyScore,
    monthlyPattern,
  });

  return {
    generatedAt,
    dataAsOf,
    monthsAnalyzed,
    archetype,
    topCategories,
    topMerchants,
    dayOfWeekPattern,
    mostExpensiveDay,
    cheapestDay,
    weekdayAvgDaily,
    weekendAvgDaily,
    weekendMultiple,
    monthlyPattern,
    highestSpendMonth,
    lowestSpendMonth,
    monthlyAvg,
    monthlyVolatility: Math.round(monthlyVolatility * 1000) / 1000,
    insights,
    consistencyScore,
    consistencyLabel,
  };
}

function buildMinimalReport(
  generatedAt: string,
  dataAsOf: string,
  monthsAnalyzed: number,
): SpendingPersonalityReport {
  return {
    generatedAt,
    dataAsOf,
    monthsAnalyzed,
    archetype: ARCHETYPES.newExplorer,
    topCategories: [],
    topMerchants: [],
    dayOfWeekPattern: DAY_NAMES.map((day) => ({ day, avgSpend: 0, transactionCount: 0 })),
    mostExpensiveDay: "",
    cheapestDay: "",
    weekdayAvgDaily: 0,
    weekendAvgDaily: 0,
    weekendMultiple: 0,
    monthlyPattern: [],
    highestSpendMonth: { month: "", total: 0 },
    lowestSpendMonth: { month: "", total: 0 },
    monthlyAvg: 0,
    monthlyVolatility: 0,
    insights: [
      {
        icon: "hourglass-outline",
        title: "Not enough data yet",
        detail: "Keep tracking your expenses. Your spending personality will emerge after 2 months of data.",
        sentiment: "neutral",
      },
    ],
    consistencyScore: 0,
    consistencyLabel: "Not enough data",
  };
}
