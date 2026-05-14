/**
 * Unavoidable vs Discretionary Split — V2
 *
 * Pure functions for classifying monthly spending into
 * unavoidable vs discretionary based on per-expense is_right_spend.
 *
 * A single category can now appear in BOTH buckets — e.g., Food
 * can have some unavoidable expenses and some discretionary ones.
 */

export interface SplitInput {
  /**
   * Per-expense classification grouped by (category, classification).
   * Same category can appear twice — once as unavoidable, once as discretionary.
   */
  items: Array<{
    categoryId: string;
    name: string;
    spent: number;
    isUnavoidable: boolean;
  }>;
  /** Budget data per category (budgets are still at category level) */
  categoryBudgets: Map<string, number>;
  /** Total monthly budget across all categories */
  totalBudget: number;
  /** Monthly income (from yearly plan, divided by 12) */
  monthlyIncome: number | null;
}

export interface SplitCategoryDetail {
  categoryId: string;
  name: string;
  spent: number;
  budget: number;
}

export interface SplitSnapshot {
  unavoidableSpent: number;
  unavoidableBudget: number;
  discretionarySpent: number;
  discretionaryBudget: number;
  uncategorizedSpent: number;
  totalSpent: number;
  totalBudget: number;

  /** Max possible savings = income - unavoidable spent */
  maxPossibleSavings: number | null;
  /** Discretionary budget available = totalBudget - unavoidableBudget */
  discretionaryAvailable: number;

  /** Percentage breakdowns */
  unavoidablePct: number;
  discretionaryPct: number;
  uncategorizedPct: number;

  /** Category lists for detail views */
  unavoidableCategories: SplitCategoryDetail[];
  discretionaryCategories: SplitCategoryDetail[];
}

export function calculateSplit(input: SplitInput): SplitSnapshot {
  const { items, categoryBudgets, totalBudget, monthlyIncome } = input;

  // Aggregate by (category, classification)
  // A category's budget is assigned to the bucket where it has the most spend.
  // If it appears in both, the budget goes to the dominant bucket.
  const unavoidableMap = new Map<string, { name: string; spent: number }>();
  const discretionaryMap = new Map<string, { name: string; spent: number }>();

  for (const item of items) {
    const map = item.isUnavoidable ? unavoidableMap : discretionaryMap;
    const existing = map.get(item.categoryId);
    if (existing) {
      existing.spent += item.spent;
    } else {
      map.set(item.categoryId, { name: item.name, spent: item.spent });
    }
  }

  // Assign each category's budget to the bucket with more spend
  let unavoidableSpent = 0;
  let unavoidableBudget = 0;
  let discretionarySpent = 0;
  let discretionaryBudget = 0;

  const unavoidableCategories: SplitCategoryDetail[] = [];
  const discretionaryCategories: SplitCategoryDetail[] = [];

  // Collect all unique category IDs
  const allCategoryIds = new Set([...unavoidableMap.keys(), ...discretionaryMap.keys()]);

  for (const catId of allCategoryIds) {
    const unavoidableEntry = unavoidableMap.get(catId);
    const discretionaryEntry = discretionaryMap.get(catId);
    const budget = categoryBudgets.get(catId) ?? 0;

    const uSpent = unavoidableEntry?.spent ?? 0;
    const dSpent = discretionaryEntry?.spent ?? 0;
    const name = unavoidableEntry?.name ?? discretionaryEntry?.name ?? "";

    // Budget goes to the dominant classification for this category
    const budgetToUnavoidable = uSpent >= dSpent;

    if (uSpent > 0) {
      unavoidableSpent += uSpent;
      if (budgetToUnavoidable) unavoidableBudget += budget;
      unavoidableCategories.push({
        categoryId: catId,
        name,
        spent: uSpent,
        budget: budgetToUnavoidable ? budget : 0,
      });
    }

    if (dSpent > 0) {
      discretionarySpent += dSpent;
      if (!budgetToUnavoidable) discretionaryBudget += budget;
      discretionaryCategories.push({
        categoryId: catId,
        name,
        spent: dSpent,
        budget: budgetToUnavoidable ? 0 : budget,
      });
    }

    // If category has spend in only one bucket, it already got budget above.
    // If category has zero spend in both, skip it entirely.
  }

  // Sort by spent descending
  unavoidableCategories.sort((a, b) => b.spent - a.spent);
  discretionaryCategories.sort((a, b) => b.spent - a.spent);

  const totalSpent = unavoidableSpent + discretionarySpent;
  const uncategorizedSpent = 0;

  const maxPossibleSavings =
    monthlyIncome !== null ? monthlyIncome - unavoidableSpent : null;
  const discretionaryAvailable = totalBudget - unavoidableBudget;

  const unavoidablePct =
    totalSpent > 0 ? Math.round((unavoidableSpent / totalSpent) * 100) : 0;
  const discretionaryPct =
    totalSpent > 0 ? Math.round((discretionarySpent / totalSpent) * 100) : 0;
  const uncategorizedPct = 0;

  return {
    unavoidableSpent,
    unavoidableBudget,
    discretionarySpent,
    discretionaryBudget,
    uncategorizedSpent,
    totalSpent,
    totalBudget,
    maxPossibleSavings,
    discretionaryAvailable,
    unavoidablePct,
    discretionaryPct,
    uncategorizedPct,
    unavoidableCategories,
    discretionaryCategories,
  };
}
