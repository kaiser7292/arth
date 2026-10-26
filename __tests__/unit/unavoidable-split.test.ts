import { calculateSplit, splitPcts, NO_CATEGORY_NAME } from "@/utils/unavoidable-split";

describe("calculateSplit", () => {
  const categories = [
    { id: "rent", name: "Rent", isUnavoidable: true },
    { id: "groceries", name: "Groceries", isUnavoidable: true },
    { id: "food", name: "Food", isUnavoidable: false },
    { id: "shopping", name: "Shopping", isUnavoidable: false },
  ];

  test("groups spending into three buckets that add up to the total", () => {
    const r = calculateSplit({
      items: [
        { categoryId: "rent", spent: 25000, bucket: "unavoidable" },
        { categoryId: "food", spent: 3000, bucket: "discretionary" },
        { categoryId: "food", spent: 1000, bucket: "unavoidable" },
        { categoryId: null, spent: 500, bucket: "unclassified" },
      ],
      categories,
      categoryBudgets: new Map(),
      monthlyIncome: null,
    });
    expect(r.unavoidable.spent).toBe(26000);
    expect(r.discretionary.spent).toBe(3000);
    expect(r.unclassified.spent).toBe(500);
    expect(r.totalSpent).toBe(29500);
    expect(r.unavoidable.pct + r.discretionary.pct + r.unclassified.pct).toBe(100);
    // Food shows in both buckets with its own amounts.
    expect(r.unavoidable.categories.find((c) => c.categoryId === "food")?.spent).toBe(1000);
    expect(r.discretionary.categories.find((c) => c.categoryId === "food")?.spent).toBe(3000);
    expect(r.unclassified.categories[0].name).toBe(NO_CATEGORY_NAME);
  });

  test("a budget goes to its category's own bucket, even with nothing spent yet", () => {
    const r = calculateSplit({
      items: [{ categoryId: "food", spent: 2000, bucket: "discretionary" }],
      categories,
      categoryBudgets: new Map([
        ["rent", 20000],
        ["food", 5000],
      ]),
      monthlyIncome: null,
    });
    expect(r.unavoidable.budget).toBe(20000);
    expect(r.unavoidable.categories).toEqual([{ categoryId: "rent", name: "Rent", spent: 0, budget: 20000 }]);
    expect(r.discretionary.budget).toBe(5000);
    expect(r.totalBudget).toBe(25000);
  });

  test("the budget doesn't follow whichever bucket had more spending", () => {
    const r = calculateSplit({
      items: [
        { categoryId: "groceries", spent: 900, bucket: "discretionary" },
        { categoryId: "groceries", spent: 100, bucket: "unavoidable" },
      ],
      categories,
      categoryBudgets: new Map([["groceries", 6000]]),
      monthlyIncome: null,
    });
    expect(r.unavoidable.budget).toBe(6000);
    expect(r.discretionary.budget).toBe(0);
  });

  test("savings potential counts an unpaid unavoidable bill at its budget", () => {
    const r = calculateSplit({
      items: [{ categoryId: "groceries", spent: 4000, bucket: "unavoidable" }],
      categories,
      categoryBudgets: new Map([
        ["rent", 20000],
        ["groceries", 3000],
      ]),
      monthlyIncome: 100000,
    });
    // rent max(0, 20000) + groceries max(4000, 3000)
    expect(r.maxPossibleSavings).toBe(76000);
  });

  test("no income plan means no savings figure", () => {
    const r = calculateSplit({ items: [], categories, categoryBudgets: new Map(), monthlyIncome: null });
    expect(r.maxPossibleSavings).toBeNull();
    expect(r.totalSpent).toBe(0);
  });
});

describe("splitPcts", () => {
  test("always adds up to 100", () => {
    expect(splitPcts([1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(splitPcts([2, 1, 0])).toEqual([67, 33, 0]);
  });
  test("all zero when nothing was spent", () => {
    expect(splitPcts([0, 0, 0])).toEqual([0, 0, 0]);
  });
});
