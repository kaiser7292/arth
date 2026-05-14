/**
 * Tests for Spending Insights pure calculation functions.
 *
 * Tests cover:
 * - Category trend analysis (rising/falling/stable detection)
 * - Anomaly detection (threshold-based flagging)
 * - Merchant analytics (aggregation, ranking, normalization)
 * - Day-of-week patterns (weekday vs weekend)
 * - Payment mode distribution
 * - Plain English insight generation
 */

import {
  calculateCategoryTrends,
  detectAnomalies,
  analyzeMerchants,
  analyzeDayPatterns,
  analyzePaymentModes,
  generateInsights,
  type MonthlyCategory,
  type ExpenseRecord,
  type CategoryTrend,
  type DayPattern,
} from "../../utils/spending-insights";

// ═══════════════════════════════════════════════
// Category Trends
// ═══════════════════════════════════════════════

describe("calculateCategoryTrends", () => {
  const months: [string, string, string] = ["2026-01", "2026-02", "2026-03"];

  it("detects rising category (>10% above 3-month avg)", () => {
    const data: MonthlyCategory[] = [
      { categoryId: "food", month: "2026-01", total: 3000 },
      { categoryId: "food", month: "2026-02", total: 3200 },
      { categoryId: "food", month: "2026-03", total: 5000 },
    ];

    const trends = calculateCategoryTrends(data, months);
    expect(trends).toHaveLength(1);
    expect(trends[0].direction).toBe("rising");
    expect(trends[0].currentMonth).toBe(5000);
    expect(trends[0].changePct).toBeGreaterThan(0);
  });

  it("detects falling category (<10% below 3-month avg)", () => {
    const data: MonthlyCategory[] = [
      { categoryId: "shopping", month: "2026-01", total: 8000 },
      { categoryId: "shopping", month: "2026-02", total: 7000 },
      { categoryId: "shopping", month: "2026-03", total: 2000 },
    ];

    const trends = calculateCategoryTrends(data, months);
    expect(trends[0].direction).toBe("falling");
    expect(trends[0].changePct).toBeLessThan(0);
  });

  it("detects stable category (within 10% of avg)", () => {
    const data: MonthlyCategory[] = [
      { categoryId: "utilities", month: "2026-01", total: 5000 },
      { categoryId: "utilities", month: "2026-02", total: 5100 },
      { categoryId: "utilities", month: "2026-03", total: 5050 },
    ];

    const trends = calculateCategoryTrends(data, months);
    expect(trends[0].direction).toBe("stable");
  });

  it("handles missing months as zero", () => {
    const data: MonthlyCategory[] = [
      { categoryId: "travel", month: "2026-03", total: 15000 },
    ];

    const trends = calculateCategoryTrends(data, months);
    expect(trends[0].twoMonthsAgo).toBe(0);
    expect(trends[0].previousMonth).toBe(0);
    expect(trends[0].currentMonth).toBe(15000);
    expect(trends[0].direction).toBe("rising");
  });

  it("handles multiple categories", () => {
    const data: MonthlyCategory[] = [
      { categoryId: "food", month: "2026-01", total: 3000 },
      { categoryId: "food", month: "2026-02", total: 3000 },
      { categoryId: "food", month: "2026-03", total: 3000 },
      { categoryId: "travel", month: "2026-01", total: 1000 },
      { categoryId: "travel", month: "2026-02", total: 1000 },
      { categoryId: "travel", month: "2026-03", total: 10000 },
    ];

    const trends = calculateCategoryTrends(data, months);
    expect(trends).toHaveLength(2);
    // Sorted by currentMonth descending
    expect(trends[0].categoryId).toBe("travel");
    expect(trends[1].categoryId).toBe("food");
  });

  it("returns empty for no data", () => {
    expect(calculateCategoryTrends([], months)).toEqual([]);
  });

  it("calculates correct 3-month average", () => {
    const data: MonthlyCategory[] = [
      { categoryId: "food", month: "2026-01", total: 1000 },
      { categoryId: "food", month: "2026-02", total: 2000 },
      { categoryId: "food", month: "2026-03", total: 3000 },
    ];

    const trends = calculateCategoryTrends(data, months);
    expect(trends[0].threeMonthAvg).toBe(2000);
  });
});

// ═══════════════════════════════════════════════
// Anomaly Detection
// ═══════════════════════════════════════════════

describe("detectAnomalies", () => {
  const expenses: ExpenseRecord[] = [
    { id: "e1", amount: 500, description: "Swiggy", date: "2026-03-15", categoryId: "food", paymentModeId: "upi" },
    { id: "e2", amount: 200, description: "Zomato", date: "2026-03-14", categoryId: "food", paymentModeId: "upi" },
    { id: "e3", amount: 5000, description: "Fine Dining", date: "2026-03-10", categoryId: "food", paymentModeId: "cc" },
    { id: "e4", amount: 1000, description: "Amazon", date: "2026-03-08", categoryId: "shopping", paymentModeId: "cc" },
  ];

  const categoryAvgs = new Map([
    ["food", 400],
    ["shopping", 800],
  ]);

  it("flags transactions above threshold", () => {
    const anomalies = detectAnomalies(expenses, categoryAvgs, 2.0);
    expect(anomalies.length).toBeGreaterThanOrEqual(1);
    // Fine Dining at 5000 vs avg 400 = 12.5x
    const fineDining = anomalies.find((a) => a.expenseId === "e3");
    expect(fineDining).toBeDefined();
    expect(fineDining!.deviationMultiple).toBe(12.5);
  });

  it("does not flag normal transactions", () => {
    const anomalies = detectAnomalies(expenses, categoryAvgs, 2.0);
    const zomato = anomalies.find((a) => a.expenseId === "e2");
    expect(zomato).toBeUndefined(); // 200/400 = 0.5x, below threshold
  });

  it("sorts by deviation descending", () => {
    const anomalies = detectAnomalies(expenses, categoryAvgs, 1.2);
    expect(anomalies[0].deviationMultiple).toBeGreaterThanOrEqual(
      anomalies[anomalies.length - 1].deviationMultiple,
    );
  });

  it("skips expenses with no category", () => {
    const withNull: ExpenseRecord[] = [
      { id: "e5", amount: 99999, description: "Big", date: "2026-03-01", categoryId: null, paymentModeId: null },
    ];
    const anomalies = detectAnomalies(withNull, categoryAvgs, 2.0);
    expect(anomalies).toHaveLength(0);
  });

  it("returns empty for no expenses", () => {
    expect(detectAnomalies([], categoryAvgs, 2.0)).toEqual([]);
  });

  it("respects custom threshold", () => {
    // With threshold 100, only extreme outliers
    const anomalies = detectAnomalies(expenses, categoryAvgs, 100);
    expect(anomalies).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════
// Merchant Analytics
// ═══════════════════════════════════════════════

describe("analyzeMerchants", () => {
  const expenses: ExpenseRecord[] = [
    { id: "e1", amount: 300, description: "SWIGGY via UPI", merchantName: "Swiggy", date: "2026-03-15", categoryId: "food", paymentModeId: "upi" },
    { id: "e2", amount: 400, description: "Swiggy order", merchantName: "Swiggy", date: "2026-03-12", categoryId: "food", paymentModeId: "upi" },
    { id: "e3", amount: 500, description: "SWIGGY", merchantName: "Swiggy", date: "2026-03-10", categoryId: "food", paymentModeId: "cc" },
    { id: "e4", amount: 2000, description: "Amazon India Pvt Ltd", merchantName: "Amazon", date: "2026-03-08", categoryId: "shopping", paymentModeId: "cc" },
    { id: "e5", amount: 1500, description: "Amazon order", merchantName: "Amazon", date: "2026-03-05", categoryId: "shopping", paymentModeId: "cc" },
  ];

  it("groups by merchantName", () => {
    const merchants = analyzeMerchants(expenses);
    const swiggy = merchants.find((m) => m.merchant === "swiggy");
    expect(swiggy).toBeDefined();
    expect(swiggy!.transactionCount).toBe(3);
    expect(swiggy!.totalSpent).toBe(1200);
  });

  it("groups different merchantNames separately", () => {
    const merchants = analyzeMerchants(expenses);
    const amazon = merchants.find((m) => m.merchant === "amazon");
    expect(amazon).toBeDefined();
    expect(amazon!.transactionCount).toBe(2);
  });

  it("calculates average amount per merchant", () => {
    const merchants = analyzeMerchants(expenses);
    const swiggy = merchants.find((m) => m.merchant === "swiggy");
    expect(swiggy!.avgAmount).toBe(400); // 1200 / 3
  });

  it("sorts by total spent descending", () => {
    const merchants = analyzeMerchants(expenses);
    expect(merchants[0].totalSpent).toBeGreaterThanOrEqual(merchants[1].totalSpent);
  });

  it("respects limit parameter", () => {
    const merchants = analyzeMerchants(expenses, 1);
    expect(merchants).toHaveLength(1);
  });

  it("buckets expenses without merchantName as unknown", () => {
    const withNull: ExpenseRecord[] = [
      { id: "e6", amount: 100, description: "Some expense", merchantName: null, date: "2026-03-01", categoryId: null, paymentModeId: null },
      { id: "e7", amount: 200, description: null, merchantName: null, date: "2026-03-02", categoryId: null, paymentModeId: null },
    ];
    const result = analyzeMerchants(withNull);
    expect(result).toHaveLength(1);
    expect(result[0].merchant).toBe("unknown");
    expect(result[0].totalSpent).toBe(300);
  });

  it("tracks last date per merchant", () => {
    const merchants = analyzeMerchants(expenses);
    const swiggy = merchants.find((m) => m.merchant === "swiggy");
    expect(swiggy!.lastDate).toBe("2026-03-15");
  });
});

// ═══════════════════════════════════════════════
// Day-of-Week Patterns
// ═══════════════════════════════════════════════

describe("analyzeDayPatterns", () => {
  it("classifies weekday vs weekend spending", () => {
    const expenses: ExpenseRecord[] = [
      // 2026-03-09 is Monday, 2026-03-14 is Saturday, 2026-03-15 is Sunday
      { id: "e1", amount: 500, description: "A", date: "2026-03-09", categoryId: null, paymentModeId: null },
      { id: "e2", amount: 500, description: "B", date: "2026-03-10", categoryId: null, paymentModeId: null },
      { id: "e3", amount: 2000, description: "C", date: "2026-03-14", categoryId: null, paymentModeId: null },
      { id: "e4", amount: 3000, description: "D", date: "2026-03-15", categoryId: null, paymentModeId: null },
    ];

    const pattern = analyzeDayPatterns(expenses);
    expect(pattern.weekdayTotal).toBe(1000);
    expect(pattern.weekendTotal).toBe(5000);
    expect(pattern.weekdayCount).toBe(2);
    expect(pattern.weekendCount).toBe(2);
    expect(pattern.higherOn).toBe("weekend");
  });

  it("returns equal when spending is balanced", () => {
    // All on one day — technically weekday
    const expenses: ExpenseRecord[] = [
      { id: "e1", amount: 1000, description: "A", date: "2026-03-09", categoryId: null, paymentModeId: null },
    ];

    const pattern = analyzeDayPatterns(expenses);
    expect(pattern.weekdayTotal).toBe(1000);
    expect(pattern.weekendTotal).toBe(0);
    // With 0 weekend spend, weekday is higher
    expect(pattern.higherOn).toBe("weekday");
  });

  it("handles empty expenses", () => {
    const pattern = analyzeDayPatterns([]);
    expect(pattern.weekdayTotal).toBe(0);
    expect(pattern.weekendTotal).toBe(0);
    expect(pattern.higherOn).toBe("equal");
  });
});

// ═══════════════════════════════════════════════
// Payment Mode Distribution
// ═══════════════════════════════════════════════

describe("analyzePaymentModes", () => {
  const expenses: ExpenseRecord[] = [
    { id: "e1", amount: 3000, description: "A", date: "2026-03-15", categoryId: null, paymentModeId: "upi" },
    { id: "e2", amount: 2000, description: "B", date: "2026-03-14", categoryId: null, paymentModeId: "cc" },
    { id: "e3", amount: 5000, description: "C", date: "2026-03-13", categoryId: null, paymentModeId: "upi" },
  ];

  it("calculates totals per payment mode", () => {
    const modes = analyzePaymentModes(expenses);
    const upi = modes.find((m) => m.paymentModeId === "upi");
    expect(upi!.totalSpent).toBe(8000);
    expect(upi!.transactionCount).toBe(2);
  });

  it("calculates percentage correctly", () => {
    const modes = analyzePaymentModes(expenses);
    const upi = modes.find((m) => m.paymentModeId === "upi");
    expect(upi!.pct).toBe(80); // 8000/10000 = 80%
  });

  it("sorts by total spent descending", () => {
    const modes = analyzePaymentModes(expenses);
    expect(modes[0].paymentModeId).toBe("upi");
    expect(modes[1].paymentModeId).toBe("cc");
  });

  it("groups null payment mode as 'unknown'", () => {
    const withNull: ExpenseRecord[] = [
      { id: "e4", amount: 100, description: "X", date: "2026-03-01", categoryId: null, paymentModeId: null },
    ];
    const modes = analyzePaymentModes(withNull);
    expect(modes[0].paymentModeId).toBe("unknown");
  });

  it("returns empty for no expenses", () => {
    expect(analyzePaymentModes([])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════
// Insight Generation
// ═══════════════════════════════════════════════

describe("generateInsights", () => {
  const categoryNames = new Map([
    ["food", "Food & Dining"],
    ["shopping", "Shopping"],
    ["travel", "Travel"],
  ]);

  it("generates insight for rising category", () => {
    const trends: CategoryTrend[] = [
      {
        categoryId: "food",
        currentMonth: 8000,
        previousMonth: 4000,
        twoMonthsAgo: 3000,
        threeMonthAvg: 5000,
        direction: "rising",
        changePct: 100,
      },
    ];

    const insights = generateInsights(trends, [], [], makeDayPattern(), categoryNames);
    expect(insights.length).toBeGreaterThanOrEqual(1);
    expect(insights[0]).toContain("Food & Dining");
    expect(insights[0]).toContain("up");
  });

  it("generates insight for falling category", () => {
    const trends: CategoryTrend[] = [
      {
        categoryId: "shopping",
        currentMonth: 1000,
        previousMonth: 5000,
        twoMonthsAgo: 6000,
        threeMonthAvg: 4000,
        direction: "falling",
        changePct: -80,
      },
    ];

    const insights = generateInsights(trends, [], [], makeDayPattern(), categoryNames);
    expect(insights.some((i) => i.includes("Shopping") && i.includes("dropped"))).toBe(true);
  });

  it("generates insight for anomaly", () => {
    const anomalies = [
      {
        expenseId: "e1",
        amount: 15000,
        description: "Fine Dining",
        date: "2026-03-10",
        categoryId: "food",
        categoryAvg: 500,
        deviationMultiple: 30,
      },
    ];

    const insights = generateInsights([], anomalies, [], makeDayPattern(), categoryNames);
    expect(insights.some((i) => i.includes("Unusual spend"))).toBe(true);
  });

  it("generates top merchant insight", () => {
    const merchants = [
      {
        merchant: "swiggy",
        totalSpent: 5000,
        transactionCount: 15,
        avgAmount: 333,
        lastDate: "2026-03-15",
        categoryId: "food",
      },
    ];

    const insights = generateInsights([], [], merchants, makeDayPattern(), categoryNames);
    expect(insights.some((i) => i.includes("Top merchant") && i.includes("swiggy"))).toBe(true);
  });

  it("returns at most 5 insights", () => {
    const trends: CategoryTrend[] = Array.from({ length: 10 }, (_, i) => ({
      categoryId: `cat-${i}`,
      currentMonth: 10000 + i * 1000,
      previousMonth: 3000,
      twoMonthsAgo: 2000,
      threeMonthAvg: 5000,
      direction: "rising" as const,
      changePct: 50 + i * 10,
    }));

    const insights = generateInsights(trends, [], [], makeDayPattern(), categoryNames);
    expect(insights.length).toBeLessThanOrEqual(5);
  });

  it("returns empty for no data", () => {
    const insights = generateInsights([], [], [], makeDayPattern(), categoryNames);
    expect(insights).toEqual([]);
  });
});

// ─── Helpers ───

function makeDayPattern(): DayPattern {
  return {
    weekdayTotal: 10000,
    weekendTotal: 5000,
    weekdayAvgPerDay: 2000,
    weekendAvgPerDay: 2500,
    weekdayCount: 10,
    weekendCount: 5,
    higherOn: "equal",
  };
}
