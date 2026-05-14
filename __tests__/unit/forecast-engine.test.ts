/**
 * Tests for Predictive Forecast Engine pure calculations.
 *
 * Tests cover:
 * - Month-end forecast (pace-based, historical, blended)
 * - Budget breach prediction
 * - Confidence levels
 * - Year-end projection (simple average, weighted recent months)
 * - Edge cases (no data, no budget, early/late month)
 */

import {
  forecastMonthEnd,
  projectYearEnd,
  type ForecastInput,
  type YearEndInput,
} from "../../utils/forecast-engine";

// ═══════════════════════════════════════════════
// Month-End Forecast
// ═══════════════════════════════════════════════

describe("forecastMonthEnd", () => {
  it("predicts month-end using blended pace + historical", () => {
    const input: ForecastInput = {
      daysElapsed: 15,
      daysInMonth: 30,
      categories: [
        {
          categoryId: "food",
          spentSoFar: 5000,
          budget: 10000,
          historicalMonthlyAvg: 9000,
          sameMonthLastYear: null,
        },
      ],
    };

    const result = forecastMonthEnd(input);
    // Pace: 5000/15 * 30 = 10000
    // Historical: 9000
    // At 15 days: pace weight 0.6, hist weight 0.4
    // Blended: 10000*0.6 + 9000*0.4 = 6000 + 3600 = 9600
    expect(result.categories[0].paceBasedTotal).toBe(10000);
    expect(result.categories[0].historicalTotal).toBe(9000);
    expect(result.categories[0].predictedTotal).toBe(9600);
  });

  it("weights historical more when early in month (<5 days)", () => {
    const input: ForecastInput = {
      daysElapsed: 3,
      daysInMonth: 30,
      categories: [
        {
          categoryId: "food",
          spentSoFar: 2000,
          budget: 10000,
          historicalMonthlyAvg: 8000,
          sameMonthLastYear: null,
        },
      ],
    };

    const result = forecastMonthEnd(input);
    // Pace: 2000/3 * 30 = 20000
    // Historical: 8000
    // At 3 days: pace weight 0.2, hist weight 0.8
    // Blended: 20000*0.2 + 8000*0.8 = 4000 + 6400 = 10400
    expect(result.categories[0].predictedTotal).toBe(10400);
  });

  it("weights pace more when late in month (>15 days)", () => {
    const input: ForecastInput = {
      daysElapsed: 25,
      daysInMonth: 30,
      categories: [
        {
          categoryId: "food",
          spentSoFar: 8000,
          budget: 10000,
          historicalMonthlyAvg: 12000,
          sameMonthLastYear: null,
        },
      ],
    };

    const result = forecastMonthEnd(input);
    // Pace: 8000/25 * 30 = 9600
    // Historical: 12000
    // At 25 days: pace weight 0.8, hist weight 0.2
    // Blended: 9600*0.8 + 12000*0.2 = 7680 + 2400 = 10080
    expect(result.categories[0].predictedTotal).toBe(10080);
  });

  it("detects budget breach", () => {
    const input: ForecastInput = {
      daysElapsed: 20,
      daysInMonth: 30,
      categories: [
        {
          categoryId: "food",
          spentSoFar: 8000,
          budget: 10000,
          historicalMonthlyAvg: 10000,
          sameMonthLastYear: null,
        },
      ],
    };

    const result = forecastMonthEnd(input);
    // Pace: 8000/20 * 30 = 12000
    // At 20 days: pace weight 0.8, hist weight 0.2
    // Blended: 12000*0.8 + 10000*0.2 = 9600 + 2000 = 11600
    expect(result.categories[0].willExceedBudget).toBe(true);
    expect(result.categories[0].predictedOverspend).toBeGreaterThan(0);
    expect(result.breachAlerts).toHaveLength(1);
  });

  it("no breach when within budget", () => {
    const input: ForecastInput = {
      daysElapsed: 20,
      daysInMonth: 30,
      categories: [
        {
          categoryId: "food",
          spentSoFar: 3000,
          budget: 10000,
          historicalMonthlyAvg: 5000,
          sameMonthLastYear: null,
        },
      ],
    };

    const result = forecastMonthEnd(input);
    expect(result.categories[0].willExceedBudget).toBe(false);
    expect(result.categories[0].predictedOverspend).toBe(0);
    expect(result.breachAlerts).toHaveLength(0);
  });

  it("calculates overall totals across categories", () => {
    const input: ForecastInput = {
      daysElapsed: 15,
      daysInMonth: 30,
      categories: [
        { categoryId: "food", spentSoFar: 5000, budget: 10000, historicalMonthlyAvg: 9000, sameMonthLastYear: null },
        { categoryId: "travel", spentSoFar: 3000, budget: 8000, historicalMonthlyAvg: 7000, sameMonthLastYear: null },
      ],
    };

    const result = forecastMonthEnd(input);
    expect(result.totalBudget).toBe(18000);
    expect(result.totalPredictedSpend).toBeGreaterThan(0);
    expect(result.categories).toHaveLength(2);
  });

  it("handles zero days elapsed", () => {
    const input: ForecastInput = {
      daysElapsed: 0,
      daysInMonth: 30,
      categories: [
        { categoryId: "food", spentSoFar: 0, budget: 10000, historicalMonthlyAvg: 8000, sameMonthLastYear: null },
      ],
    };

    const result = forecastMonthEnd(input);
    // With 0 days elapsed: uses historical as pace-based
    expect(result.categories[0].predictedTotal).toBeGreaterThan(0);
  });

  it("uses sameMonthLastYear when available", () => {
    const input: ForecastInput = {
      daysElapsed: 15,
      daysInMonth: 30,
      categories: [
        {
          categoryId: "food",
          spentSoFar: 5000,
          budget: 10000,
          historicalMonthlyAvg: 8000,
          sameMonthLastYear: 12000,
        },
      ],
    };

    const result = forecastMonthEnd(input);
    // Historical should use sameMonthLastYear (12000) instead of avg (8000)
    expect(result.categories[0].historicalTotal).toBe(12000);
  });

  it("assigns high confidence when pace and historical agree", () => {
    const input: ForecastInput = {
      daysElapsed: 15,
      daysInMonth: 30,
      categories: [
        { categoryId: "food", spentSoFar: 4500, budget: 10000, historicalMonthlyAvg: 9000, sameMonthLastYear: null },
      ],
    };

    const result = forecastMonthEnd(input);
    // Pace: 9000, Historical: 9000 — perfect agreement
    expect(result.categories[0].confidence).toBe("high");
  });

  it("assigns low confidence when pace and historical disagree greatly", () => {
    const input: ForecastInput = {
      daysElapsed: 15,
      daysInMonth: 30,
      categories: [
        { categoryId: "food", spentSoFar: 500, budget: 10000, historicalMonthlyAvg: 9000, sameMonthLastYear: null },
      ],
    };

    const result = forecastMonthEnd(input);
    // Pace: 1000, Historical: 9000 — huge disagreement
    expect(result.categories[0].confidence).toBe("low");
  });

  it("sorts breach alerts by overspend amount descending", () => {
    const input: ForecastInput = {
      daysElapsed: 25,
      daysInMonth: 30,
      categories: [
        { categoryId: "food", spentSoFar: 12000, budget: 10000, historicalMonthlyAvg: 11000, sameMonthLastYear: null },
        { categoryId: "travel", spentSoFar: 20000, budget: 8000, historicalMonthlyAvg: 15000, sameMonthLastYear: null },
      ],
    };

    const result = forecastMonthEnd(input);
    expect(result.breachAlerts.length).toBe(2);
    expect(result.breachAlerts[0].predictedOverspend).toBeGreaterThanOrEqual(
      result.breachAlerts[1].predictedOverspend,
    );
  });
});

// ═══════════════════════════════════════════════
// Year-End Projection
// ═══════════════════════════════════════════════

describe("projectYearEnd", () => {
  it("projects year-end using simple average", () => {
    const input: YearEndInput = {
      annualIncome: 1200000,
      annualBudget: 900000,
      totalSpentYTD: 300000,
      monthsElapsed: 4,
      monthlyTotals: [75000, 75000, 75000, 75000],
    };

    const result = projectYearEnd(input);
    // Simple avg: 75000/month → 75000 * 12 = 900000
    expect(result.projectedAnnualSpend).toBeGreaterThan(0);
    expect(result.projectedSavings).toBe(result.projectedAnnualSpend <= 1200000
      ? 1200000 - result.projectedAnnualSpend
      : result.projectedSavings);
    expect(result.monthsOfData).toBe(4);
  });

  it("uses weighted average with 3+ months of data", () => {
    const input: YearEndInput = {
      annualIncome: 1200000,
      annualBudget: 900000,
      totalSpentYTD: 240000,
      monthsElapsed: 3,
      monthlyTotals: [60000, 80000, 100000], // increasing trend
    };

    const result = projectYearEnd(input);
    // Weighted: 100000*0.5 + 80000*0.3 + 60000*0.2 = 50000+24000+12000 = 86000/month
    // Projected: 240000 + 86000*9 = 240000 + 774000 = 1014000
    expect(result.projectedAnnualSpend).toBe(1014000);
    expect(result.monthlyAvgSpend).toBe(86000);
  });

  it("falls back to simple average with <3 months", () => {
    const input: YearEndInput = {
      annualIncome: 1200000,
      annualBudget: 900000,
      totalSpentYTD: 150000,
      monthsElapsed: 2,
      monthlyTotals: [70000, 80000],
    };

    const result = projectYearEnd(input);
    // Simple avg: 150000/2 = 75000/month
    // Projected: 150000 + 75000*10 = 900000
    expect(result.projectedAnnualSpend).toBe(900000);
    expect(result.monthlyAvgSpend).toBe(75000);
  });

  it("calculates savings rate correctly", () => {
    const input: YearEndInput = {
      annualIncome: 1200000,
      annualBudget: 900000,
      totalSpentYTD: 300000,
      monthsElapsed: 4,
      monthlyTotals: [75000, 75000, 75000, 75000],
    };

    const result = projectYearEnd(input);
    expect(result.projectedSavingsRatePct).toBeGreaterThan(0);
    expect(result.projectedSavingsRatePct).toBeLessThan(100);
  });

  it("handles zero months elapsed", () => {
    const input: YearEndInput = {
      annualIncome: 1200000,
      annualBudget: 900000,
      totalSpentYTD: 0,
      monthsElapsed: 0,
      monthlyTotals: [],
    };

    const result = projectYearEnd(input);
    expect(result.projectedAnnualSpend).toBe(0);
    expect(result.projectedSavings).toBe(1200000);
    expect(result.projectedSavingsRatePct).toBe(100);
  });
});
