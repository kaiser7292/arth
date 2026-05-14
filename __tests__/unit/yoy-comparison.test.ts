import { calculateYoYComparison } from "@/utils/yoy-comparison";

const previous = {
  financialYear: "2025",
  annualIncome: 1400000,
  totalPlannedExpenses: 1000000,
  totalActualExpenses: 950000,
  actualSavingsRatePct: 28,
  totalPlannedInvestments: 200000,
  totalActualInvestments: 180000,
  totalPlannedMilestones: 100000,
  totalActualMilestones: 90000,
  totalPlannedLoanOutflow: 240000,
  totalActualLoanOutflow: 240000,
};

const current = {
  financialYear: "2026",
  annualIncome: 1600000,
  totalPlannedExpenses: 1100000,
  totalActualExpenses: 500000,
  actualSavingsRatePct: 32,
  totalPlannedInvestments: 300000,
  totalActualInvestments: 150000,
  totalPlannedMilestones: 150000,
  totalActualMilestones: 80000,
  totalPlannedLoanOutflow: 280000,
  totalActualLoanOutflow: 140000,
};

describe("calculateYoYComparison", () => {
  test("returns correct FY labels", () => {
    const result = calculateYoYComparison(previous, current);
    expect(result.previousFY).toBe("2025");
    expect(result.currentFY).toBe("2026");
  });

  test("returns 6 categories", () => {
    const result = calculateYoYComparison(previous, current);
    expect(result.categories).toHaveLength(6);
    expect(result.categories.map((c) => c.label)).toEqual([
      "Income",
      "Expenses",
      "Investments",
      "Milestones",
      "Loans & Debts",
      "Savings Rate",
    ]);
  });

  test("loans & debts category tracks planned vs actual", () => {
    const result = calculateYoYComparison(previous, current);
    const loans = result.categories.find((c) => c.label === "Loans & Debts")!;
    expect(loans.prevPlanned).toBe(240000);
    expect(loans.prevActual).toBe(240000);
    expect(loans.currPlanned).toBe(280000);
    expect(loans.currActual).toBe(140000);
    expect(loans.isAmount).toBe(true);
    expect(loans.lowerIsBetter).toBe(true);
  });

  test("loans & debts: gap semantics invert — paying more than planned is good", () => {
    const result = calculateYoYComparison(previous, current);
    const loans = result.categories.find((c) => c.label === "Loans & Debts")!;
    // For loans, row trend is "lower is better" (outflow shrinks YoY) but
    // plan-vs-actual is "higher is better" (overshooting plan = faster payoff).
    expect(loans.gapActualHigherIsBetter).toBe(true);
  });

  test("income category has planned and actual values", () => {
    const result = calculateYoYComparison(previous, current);
    const income = result.categories.find((c) => c.label === "Income")!;
    expect(income.prevPlanned).toBe(1400000);
    expect(income.currPlanned).toBe(1600000);
    expect(income.isAmount).toBe(true);
    expect(income.lowerIsBetter).toBe(false);
  });

  test("expenses category tracks planned vs actual", () => {
    const result = calculateYoYComparison(previous, current);
    const expenses = result.categories.find((c) => c.label === "Expenses")!;
    expect(expenses.prevPlanned).toBe(1000000);
    expect(expenses.prevActual).toBe(950000);
    expect(expenses.currPlanned).toBe(1100000);
    expect(expenses.currActual).toBe(500000);
    expect(expenses.lowerIsBetter).toBe(true);
  });

  test("investments category tracks planned vs actual", () => {
    const result = calculateYoYComparison(previous, current);
    const inv = result.categories.find((c) => c.label === "Investments")!;
    expect(inv.prevActual).toBe(180000);
    expect(inv.currActual).toBe(150000);
  });

  test("savings rate is computed as percentage", () => {
    const result = calculateYoYComparison(previous, current);
    const sr = result.categories.find((c) => c.label === "Savings Rate")!;
    expect(sr.isAmount).toBe(false);
    expect(sr.prevActual).toBe(28);
    expect(sr.currActual).toBe(32);
    // planned = (income - plannedExpenses) / income
    expect(sr.prevPlanned).toBeCloseTo(28.6, 0);
  });

  test("overall trend reflects plan-vs-actual gap improvement", () => {
    const result = calculateYoYComparison(previous, current);
    expect(["improved", "declined", "mixed"]).toContain(result.overallTrend);
  });

  test("handles zero previous values", () => {
    const zeroPrev = { ...previous, annualIncome: 0, totalPlannedExpenses: 0, totalActualExpenses: 0 };
    const result = calculateYoYComparison(zeroPrev, current);
    expect(result.categories).toHaveLength(6);
  });
});
