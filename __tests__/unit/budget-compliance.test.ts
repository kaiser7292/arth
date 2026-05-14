import { calculateMonthlyCompliance } from "@/utils/budget-compliance";

describe("calculateMonthlyCompliance", () => {
  describe("monthly projections", () => {
    test("projects month-end spend from daily rate", () => {
      const result = calculateMonthlyCompliance({
        daysElapsed: 10,
        daysTotal: 30,
        spentSoFar: 30000,
        monthlyBudget: 100000,
      });

      // Daily rate: 30000/10 = 3000/day
      // Projected: 3000 * 30 = 90000
      expect(result.dailySpendRate).toBe(3000);
      expect(result.projectedMonthEnd).toBe(90000);
      expect(result.monthlyOnTrack).toBe(true);
      expect(result.monthlyProjectedSavings).toBe(10000); // 100k - 90k
    });

    test("flags off-track when projection exceeds budget", () => {
      const result = calculateMonthlyCompliance({
        daysElapsed: 10,
        daysTotal: 30,
        spentSoFar: 50000,
        monthlyBudget: 100000,
      });

      // 5000/day * 30 = 150000 > 100000
      expect(result.projectedMonthEnd).toBe(150000);
      expect(result.monthlyOnTrack).toBe(false);
      expect(result.monthlyProjectedSavings).toBe(-50000);
    });

    test("calculates budget left percentage", () => {
      const result = calculateMonthlyCompliance({
        daysElapsed: 15,
        daysTotal: 30,
        spentSoFar: 40000,
        monthlyBudget: 100000,
      });

      expect(result.budgetLeftPct).toBe(60); // (100k - 40k) / 100k * 100
    });

    test("budget left pct floors at 0 when over budget", () => {
      const result = calculateMonthlyCompliance({
        daysElapsed: 20,
        daysTotal: 30,
        spentSoFar: 120000,
        monthlyBudget: 100000,
      });

      expect(result.budgetLeftPct).toBe(0);
    });

    test("handles zero days elapsed", () => {
      const result = calculateMonthlyCompliance({
        daysElapsed: 0,
        daysTotal: 30,
        spentSoFar: 0,
        monthlyBudget: 100000,
      });

      expect(result.dailySpendRate).toBe(0);
      expect(result.projectedMonthEnd).toBe(0);
      expect(result.monthlyOnTrack).toBe(true);
    });

    test("handles zero budget", () => {
      const result = calculateMonthlyCompliance({
        daysElapsed: 10,
        daysTotal: 30,
        spentSoFar: 5000,
        monthlyBudget: 0,
      });

      expect(result.budgetLeftPct).toBe(0);
    });

    test("calculates days remaining", () => {
      const result = calculateMonthlyCompliance({
        daysElapsed: 12,
        daysTotal: 30,
        spentSoFar: 10000,
        monthlyBudget: 50000,
      });

      expect(result.daysRemaining).toBe(18);
    });
  });

  describe("annual projections", () => {
    test("projects annual spend from monthly average", () => {
      const result = calculateMonthlyCompliance({
        daysElapsed: 15,
        daysTotal: 30,
        spentSoFar: 50000,
        monthlyBudget: 100000,
        annualIncome: 1500000,
        annualBudget: 1200000,
        annualSpentYTD: 300000,
        monthsElapsed: 3,
      });

      // Monthly avg: 300000/3 = 100000/mo
      // Annual projected: 100000 * 12 = 1200000
      expect(result.annualProjectedSpend).toBe(1200000);
      // Projected savings = annualBudget (1.2M) − annualProjectedSpend (1.2M) = 0.
      // Budget is exactly on track so there's no surplus or deficit vs the plan.
      expect(result.annualProjectedSavings).toBe(0);
      expect(result.annualOnTrack).toBe(true);
      expect(result.monthsRemaining).toBe(9);
    });

    test("flags annual off-track when overspending", () => {
      const result = calculateMonthlyCompliance({
        daysElapsed: 10,
        daysTotal: 30,
        spentSoFar: 40000,
        monthlyBudget: 100000,
        annualIncome: 1500000,
        annualBudget: 1200000,
        annualSpentYTD: 500000,
        monthsElapsed: 3,
      });

      // Monthly avg: 500000/3 = ~166667/mo
      // Annual projected: ~166667 * 12 = ~2000000 > 1200000
      expect(result.annualOnTrack).toBe(false);
    });

    test("calculates annual budget left pct", () => {
      const result = calculateMonthlyCompliance({
        daysElapsed: 10,
        daysTotal: 30,
        spentSoFar: 30000,
        monthlyBudget: 100000,
        annualIncome: 1500000,
        annualBudget: 1200000,
        annualSpentYTD: 600000,
        monthsElapsed: 6,
      });

      // (1200000 - 600000) / 1200000 * 100 = 50%
      expect(result.annualBudgetLeftPct).toBe(50);
    });

    test("returns null annual fields when no plan provided", () => {
      const result = calculateMonthlyCompliance({
        daysElapsed: 10,
        daysTotal: 30,
        spentSoFar: 30000,
        monthlyBudget: 100000,
      });

      expect(result.annualIncome).toBeNull();
      expect(result.annualProjectedSpend).toBeNull();
      expect(result.annualOnTrack).toBeNull();
    });
  });
});
