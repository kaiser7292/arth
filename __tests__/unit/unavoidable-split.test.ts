import { calculateSplit } from "@/utils/unavoidable-split";

describe("calculateSplit", () => {
  // Simulates the typical case: each category's expenses are all in one bucket
  const items = [
    { categoryId: "1", name: "Rent", spent: 25000, isUnavoidable: true },
    { categoryId: "2", name: "Groceries", spent: 4500, isUnavoidable: true },
    { categoryId: "3", name: "EMIs", spent: 10000, isUnavoidable: true },
    { categoryId: "4", name: "Shopping", spent: 8000, isUnavoidable: false },
    { categoryId: "5", name: "Travel", spent: 12000, isUnavoidable: false },
    { categoryId: "6", name: "Food", spent: 15000, isUnavoidable: false },
  ];

  const categoryBudgets = new Map([
    ["1", 26000],
    ["2", 5000],
    ["3", 10000],
    ["4", 10000],
    ["5", 15000],
    ["6", 18000],
  ]);

  test("splits spending into unavoidable and discretionary", () => {
    const result = calculateSplit({
      items,
      categoryBudgets,
      totalBudget: 84000,
      monthlyIncome: null,
    });

    expect(result.unavoidableSpent).toBe(39500); // 25000+4500+10000
    expect(result.discretionarySpent).toBe(35000); // 8000+12000+15000
    expect(result.totalSpent).toBe(74500);
  });

  test("splits budgets into unavoidable and discretionary", () => {
    const result = calculateSplit({
      items,
      categoryBudgets,
      totalBudget: 84000,
      monthlyIncome: null,
    });

    expect(result.unavoidableBudget).toBe(41000); // 26000+5000+10000
    expect(result.discretionaryBudget).toBe(43000); // 10000+15000+18000
  });

  test("calculates percentage breakdowns", () => {
    const result = calculateSplit({
      items,
      categoryBudgets,
      totalBudget: 84000,
      monthlyIncome: null,
    });

    // unavoidable: 39500/74500 = 53%
    expect(result.unavoidablePct).toBe(53);
    // discretionary: 35000/74500 = 47%
    expect(result.discretionaryPct).toBe(47);
  });

  test("calculates max possible savings when income provided", () => {
    const result = calculateSplit({
      items,
      categoryBudgets,
      totalBudget: 84000,
      monthlyIncome: 150000,
    });

    // maxPossibleSavings = 150000 - 39500 (unavoidable spent) = 110500
    expect(result.maxPossibleSavings).toBe(110500);
  });

  test("returns null maxPossibleSavings when no income", () => {
    const result = calculateSplit({
      items,
      categoryBudgets,
      totalBudget: 84000,
      monthlyIncome: null,
    });

    expect(result.maxPossibleSavings).toBeNull();
  });

  test("calculates discretionary available", () => {
    const result = calculateSplit({
      items,
      categoryBudgets,
      totalBudget: 84000,
      monthlyIncome: null,
    });

    // 84000 - 41000 = 43000
    expect(result.discretionaryAvailable).toBe(43000);
  });

  test("separates category lists sorted by spend", () => {
    const result = calculateSplit({
      items,
      categoryBudgets,
      totalBudget: 84000,
      monthlyIncome: null,
    });

    expect(result.unavoidableCategories).toHaveLength(3);
    expect(result.discretionaryCategories).toHaveLength(3);
    // Sorted by spent descending
    expect(result.unavoidableCategories.map((c) => c.name)).toEqual([
      "Rent",
      "EMIs",
      "Groceries",
    ]);
    expect(result.discretionaryCategories.map((c) => c.name)).toEqual([
      "Food",
      "Travel",
      "Shopping",
    ]);
  });

  test("handles all unavoidable (no discretionary)", () => {
    const allUnavoidable = items.map((c) => ({
      ...c,
      isUnavoidable: true,
    }));

    const result = calculateSplit({
      items: allUnavoidable,
      categoryBudgets,
      totalBudget: 84000,
      monthlyIncome: 150000,
    });

    expect(result.unavoidablePct).toBe(100);
    expect(result.discretionaryPct).toBe(0);
    expect(result.discretionaryCategories).toHaveLength(0);
  });

  test("handles empty items", () => {
    const result = calculateSplit({
      items: [],
      categoryBudgets: new Map(),
      totalBudget: 0,
      monthlyIncome: null,
    });

    expect(result.unavoidableSpent).toBe(0);
    expect(result.discretionarySpent).toBe(0);
    expect(result.totalSpent).toBe(0);
    expect(result.unavoidableCategories).toHaveLength(0);
    expect(result.discretionaryCategories).toHaveLength(0);
  });

  test("same category can appear in both unavoidable and discretionary", () => {
    // Food: 5000 unavoidable (groceries marked necessary) + 12000 discretionary (dining out)
    const mixedItems = [
      { categoryId: "6", name: "Food", spent: 5000, isUnavoidable: true },
      { categoryId: "6", name: "Food", spent: 12000, isUnavoidable: false },
      { categoryId: "1", name: "Rent", spent: 25000, isUnavoidable: true },
    ];

    const budgets = new Map([
      ["6", 18000],
      ["1", 26000],
    ]);

    const result = calculateSplit({
      items: mixedItems,
      categoryBudgets: budgets,
      totalBudget: 44000,
      monthlyIncome: null,
    });

    expect(result.unavoidableSpent).toBe(30000); // 25000 + 5000
    expect(result.discretionarySpent).toBe(12000);
    expect(result.unavoidableCategories).toHaveLength(2); // Rent + Food
    expect(result.discretionaryCategories).toHaveLength(1); // Food

    // Food has more discretionary spend, so budget goes to discretionary
    const foodUnavoidable = result.unavoidableCategories.find((c) => c.name === "Food");
    const foodDiscretionary = result.discretionaryCategories.find((c) => c.name === "Food");
    expect(foodUnavoidable?.spent).toBe(5000);
    expect(foodUnavoidable?.budget).toBe(0); // Budget goes to dominant bucket
    expect(foodDiscretionary?.spent).toBe(12000);
    expect(foodDiscretionary?.budget).toBe(18000); // Food budget here (dominant)
  });

  test("budget goes to unavoidable when it has equal or more spend", () => {
    const equalItems = [
      { categoryId: "6", name: "Food", spent: 9000, isUnavoidable: true },
      { categoryId: "6", name: "Food", spent: 9000, isUnavoidable: false },
    ];

    const budgets = new Map([["6", 18000]]);

    const result = calculateSplit({
      items: equalItems,
      categoryBudgets: budgets,
      totalBudget: 18000,
      monthlyIncome: null,
    });

    // Equal spend — budget goes to unavoidable (>=)
    const foodUnavoidable = result.unavoidableCategories.find((c) => c.name === "Food");
    expect(foodUnavoidable?.budget).toBe(18000);
    const foodDiscretionary = result.discretionaryCategories.find((c) => c.name === "Food");
    expect(foodDiscretionary?.budget).toBe(0);
  });
});
