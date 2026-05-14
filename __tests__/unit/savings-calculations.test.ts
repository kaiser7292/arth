import {
  calculateSavingsSnapshot,
  calculateMonthlySavingsTrend,
} from "@/utils/savings-calculations";

describe("calculateSavingsSnapshot", () => {
  const baseParams = {
    annualSalary: 2400000, // 20L salary → 2L/month
    expectedBonus: 200000,
    targetSavingsRatePct: 25,
    totalExpenses: 900000, // 9L spent in 6 months → 1.5L/month
    monthsElapsed: 6,
  };

  test("calculates income received (prorated salary)", () => {
    const result = calculateSavingsSnapshot(baseParams);
    // 24L / 12 * 6 = 12L
    expect(result.incomeReceived).toBe(1200000);
  });

  test("calculates actual saved (income - expenses)", () => {
    const result = calculateSavingsSnapshot(baseParams);
    // 12L - 9L = 3L
    expect(result.actualSaved).toBe(300000);
  });

  test("calculates actual savings rate as % of income", () => {
    const result = calculateSavingsSnapshot(baseParams);
    // 3L / 12L * 100 = 25%
    expect(result.actualSavingsRatePct).toBe(25);
  });

  test("correctly identifies on-track (actual >= target)", () => {
    const result = calculateSavingsSnapshot(baseParams);
    // 25% actual vs 25% target → on track
    expect(result.isOnTrack).toBe(true);
  });

  test("identifies off-track when spending too much", () => {
    const result = calculateSavingsSnapshot({
      ...baseParams,
      totalExpenses: 1100000, // 11L spent → savings rate = 8.3%
    });
    expect(result.isOnTrack).toBe(false);
  });

  test("calculates annual target savings from salary * rate", () => {
    const result = calculateSavingsSnapshot(baseParams);
    // 24L * 25% = 6L
    expect(result.annualTargetSavings).toBe(600000);
  });

  test("calculates savings gap (ahead or behind prorated target)", () => {
    const result = calculateSavingsSnapshot(baseParams);
    // Prorated target at 6 months: 6L / 12 * 6 = 3L. Actual saved: 3L. Gap = 0.
    expect(result.savingsGap).toBe(0);
  });

  test("shows negative gap when behind", () => {
    const result = calculateSavingsSnapshot({
      ...baseParams,
      totalExpenses: 1050000, // savings = 1.5L, prorated target = 3L
    });
    expect(result.savingsGap).toBe(-150000);
  });

  test("shows positive gap when ahead", () => {
    const result = calculateSavingsSnapshot({
      ...baseParams,
      totalExpenses: 600000, // savings = 6L, prorated target = 3L
    });
    expect(result.savingsGap).toBe(300000);
  });

  test("calculates months remaining", () => {
    const result = calculateSavingsSnapshot(baseParams);
    expect(result.monthsElapsed).toBe(6);
    expect(result.monthsRemaining).toBe(6);
  });

  test("calculates average monthly savings", () => {
    const result = calculateSavingsSnapshot(baseParams);
    // 3L saved / 6 months = 50K/month
    expect(result.avgMonthlySavings).toBe(50000);
  });

  test("calculates course correction per month", () => {
    const result = calculateSavingsSnapshot(baseParams);
    // Target 6L, saved 3L, 6 months left → need 50K/month (same as current pace)
    expect(result.courseCorrectionPerMonth).toBe(50000);
  });

  test("higher course correction when behind", () => {
    const result = calculateSavingsSnapshot({
      ...baseParams,
      totalExpenses: 1050000, // only saved 1.5L so far
    });
    // Target 6L, saved 1.5L, 6 months left → need 75K/month
    expect(result.courseCorrectionPerMonth).toBe(75000);
  });

  test("calculates projected year-end savings", () => {
    const result = calculateSavingsSnapshot(baseParams);
    // Saved 3L + (50K/month * 6 months) = 6L
    expect(result.projectedYearEndSavings).toBe(600000);
  });

  test("calculates projected year-end rate (using full income with bonus)", () => {
    const result = calculateSavingsSnapshot(baseParams);
    // Projected savings 6L / (24L + 2L) * 100 ≈ 23.08%
    expect(result.projectedYearEndRatePct).toBeCloseTo(23.08, 1);
  });

  test("projected on track when projected savings >= annual target", () => {
    const result = calculateSavingsSnapshot(baseParams);
    // Projected 6L >= target 6L
    expect(result.projectedOnTrack).toBe(true);
  });

  test("projected off track when projected savings < annual target", () => {
    const result = calculateSavingsSnapshot({
      ...baseParams,
      totalExpenses: 1100000,
    });
    expect(result.projectedOnTrack).toBe(false);
  });

  test("handles month 1 (start of FY)", () => {
    const result = calculateSavingsSnapshot({
      ...baseParams,
      totalExpenses: 150000,
      monthsElapsed: 1,
    });
    expect(result.incomeReceived).toBe(200000);
    expect(result.actualSaved).toBe(50000);
    expect(result.monthsRemaining).toBe(11);
  });

  test("handles month 12 (end of FY)", () => {
    const result = calculateSavingsSnapshot({
      ...baseParams,
      totalExpenses: 1800000,
      monthsElapsed: 12,
    });
    expect(result.incomeReceived).toBe(2400000);
    expect(result.monthsRemaining).toBe(0);
    expect(result.courseCorrectionPerMonth).toBe(0); // no months left
  });

  test("handles zero income", () => {
    const result = calculateSavingsSnapshot({
      ...baseParams,
      annualSalary: 0,
      expectedBonus: 0,
    });
    expect(result.actualSavingsRatePct).toBe(0);
    expect(result.projectedYearEndRatePct).toBe(0);
  });

  test("handles zero months elapsed", () => {
    const result = calculateSavingsSnapshot({
      ...baseParams,
      monthsElapsed: 0,
      totalExpenses: 0,
    });
    expect(result.incomeReceived).toBe(0);
    expect(result.actualSaved).toBe(0);
    expect(result.monthsRemaining).toBe(12);
    expect(result.avgMonthlySavings).toBe(0);
  });

  test("clamps months elapsed to 0-12 range", () => {
    const over = calculateSavingsSnapshot({
      ...baseParams,
      monthsElapsed: 15,
    });
    expect(over.monthsElapsed).toBe(12);
    expect(over.monthsRemaining).toBe(0);

    const under = calculateSavingsSnapshot({
      ...baseParams,
      monthsElapsed: -3,
    });
    expect(under.monthsElapsed).toBe(0);
    expect(under.monthsRemaining).toBe(12);
  });
});

describe("calculateMonthlySavingsTrend", () => {
  const monthlyExpenses = new Map<number, number>([
    [1, 150000], // Apr
    [2, 180000], // May
    [3, 130000], // Jun
    [4, 200000], // Jul
    [5, 160000], // Aug
    [6, 140000], // Sep
  ]);

  test("returns correct number of months", () => {
    const result = calculateMonthlySavingsTrend({
      annualSalary: 2400000,
      monthlyExpenses,
      monthsToShow: 6,
    });
    expect(result).toHaveLength(6);
  });

  test("calculates income as salary / 12 for each month", () => {
    const result = calculateMonthlySavingsTrend({
      annualSalary: 2400000,
      monthlyExpenses,
      monthsToShow: 3,
    });
    expect(result[0].income).toBe(200000);
    expect(result[1].income).toBe(200000);
  });

  test("uses actual expenses per month", () => {
    const result = calculateMonthlySavingsTrend({
      annualSalary: 2400000,
      monthlyExpenses,
      monthsToShow: 3,
    });
    expect(result[0].expenses).toBe(150000); // FM 1
    expect(result[1].expenses).toBe(180000); // FM 2
    expect(result[2].expenses).toBe(130000); // FM 3
  });

  test("calculates saved as income - expenses", () => {
    const result = calculateMonthlySavingsTrend({
      annualSalary: 2400000,
      monthlyExpenses,
      monthsToShow: 1,
    });
    expect(result[0].saved).toBe(50000); // 200K - 150K
  });

  test("calculates savings rate per month", () => {
    const result = calculateMonthlySavingsTrend({
      annualSalary: 2400000,
      monthlyExpenses,
      monthsToShow: 1,
    });
    // 50K / 200K * 100 = 25%
    expect(result[0].savingsRatePct).toBe(25);
  });

  test("handles months with no expenses", () => {
    const result = calculateMonthlySavingsTrend({
      annualSalary: 2400000,
      monthlyExpenses,
      monthsToShow: 8, // FM 7 and 8 have no data
    });
    expect(result[6].expenses).toBe(0);
    expect(result[6].saved).toBe(200000); // All income saved
    expect(result[6].savingsRatePct).toBe(100);
  });

  test("handles negative savings (overspending)", () => {
    const overSpend = new Map<number, number>([[1, 250000]]); // more than 200K income
    const result = calculateMonthlySavingsTrend({
      annualSalary: 2400000,
      monthlyExpenses: overSpend,
      monthsToShow: 1,
    });
    expect(result[0].saved).toBe(-50000);
    expect(result[0].savingsRatePct).toBe(-25);
  });
});
