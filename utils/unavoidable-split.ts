/**
 * Unavoidable vs Discretionary Split — V3
 *
 * Pure functions that group one month's spending into three buckets by each expense's own
 * is_right_spend flag:
 *   - unavoidable   (is_right_spend = 1)
 *   - discretionary (is_right_spend = 0)
 *   - unclassified  (is_right_spend IS NULL — not marked either way yet)
 *
 * A category can appear in more than one bucket (some Food is unavoidable, some isn't).
 *
 * Budgets are set per category, so each budget needs one home bucket. V2 gave it to whichever
 * bucket had more spending that month, so a budget jumped sides from month to month and a
 * budgeted category with nothing spent yet (rent not paid) vanished from the budget totals.
 * V3 uses the category's own "unavoidable" setting: stable, and every budget counts.
 */

export type SplitBucket = "unavoidable" | "discretionary" | "unclassified";

export interface SplitInput {
  /** Spending grouped by (category, bucket). categoryId null = no category. */
  items: Array<{
    categoryId: string | null;
    spent: number;
    bucket: SplitBucket;
  }>;
  /** Every category, for names and each one's home bucket for its budget. */
  categories: Array<{ id: string; name: string; isUnavoidable: boolean }>;
  /** Budget per category for the month. */
  categoryBudgets: Map<string, number>;
  /** Monthly income (yearly plan / 12), or null when there's no plan. */
  monthlyIncome: number | null;
}

export interface SplitCategoryDetail {
  /** null = expenses with no category. */
  categoryId: string | null;
  name: string;
  spent: number;
  /** This category's budget when this bucket is its home, else 0. */
  budget: number;
}

export interface SplitBucketDetail {
  spent: number;
  budget: number;
  /** Integer share of the month's spending; the three add up to 100 (or all 0). */
  pct: number;
  categories: SplitCategoryDetail[];
}

export interface SplitSnapshot {
  unavoidable: SplitBucketDetail;
  discretionary: SplitBucketDetail;
  unclassified: SplitBucketDetail;
  totalSpent: number;
  totalBudget: number;
  /**
   * What's left of income once unavoidable costs are covered — the most the month could save if
   * nothing discretionary were spent. Unavoidable costs count at the larger of spent and budget,
   * so a bill not yet paid this month still counts. null without an income plan.
   */
  maxPossibleSavings: number | null;
}

export const NO_CATEGORY_NAME = "No category";

/** Integer percentages that add up to 100; rounding drift goes to the largest bucket. */
export function splitPcts(values: [number, number, number]): [number, number, number] {
  const total = values[0] + values[1] + values[2];
  if (total <= 0) return [0, 0, 0];
  const pcts = values.map((v) => Math.round((v / total) * 100)) as [number, number, number];
  const drift = 100 - (pcts[0] + pcts[1] + pcts[2]);
  if (drift !== 0) {
    const largest = pcts.indexOf(Math.max(...pcts));
    pcts[largest] += drift;
  }
  return pcts;
}

export function calculateSplit(input: SplitInput): SplitSnapshot {
  const { items, categories, categoryBudgets, monthlyIncome } = input;
  const catById = new Map(categories.map((c) => [c.id, c]));
  const homeOf = (categoryId: string): SplitBucket =>
    catById.get(categoryId)?.isUnavoidable ? "unavoidable" : "discretionary";

  const buckets: Record<SplitBucket, Map<string | null, SplitCategoryDetail>> = {
    unavoidable: new Map(),
    discretionary: new Map(),
    unclassified: new Map(),
  };
  const rowFor = (bucket: SplitBucket, categoryId: string | null): SplitCategoryDetail => {
    let row = buckets[bucket].get(categoryId);
    if (!row) {
      row = {
        categoryId,
        name: categoryId == null ? NO_CATEGORY_NAME : catById.get(categoryId)?.name ?? "Unknown",
        spent: 0,
        budget: 0,
      };
      buckets[bucket].set(categoryId, row);
    }
    return row;
  };

  for (const item of items) {
    if (item.spent <= 0) continue;
    rowFor(item.bucket, item.categoryId).spent += item.spent;
  }

  // Every budget lands in its category's home bucket, spent on or not.
  let totalBudget = 0;
  for (const [categoryId, budget] of categoryBudgets) {
    if (budget <= 0) continue;
    totalBudget += budget;
    rowFor(homeOf(categoryId), categoryId).budget = budget;
  }

  const detail = (bucket: SplitBucket): Omit<SplitBucketDetail, "pct"> => {
    const rows = [...buckets[bucket].values()].sort((a, b) => b.spent - a.spent || b.budget - a.budget);
    return {
      spent: rows.reduce((s, r) => s + r.spent, 0),
      budget: rows.reduce((s, r) => s + r.budget, 0),
      categories: rows,
    };
  };
  const u = detail("unavoidable");
  const d = detail("discretionary");
  const n = detail("unclassified");
  const [uPct, dPct, nPct] = splitPcts([u.spent, d.spent, n.spent]);

  const unavoidableCommitted = u.categories.reduce((s, r) => s + Math.max(r.spent, r.budget), 0);

  return {
    unavoidable: { ...u, pct: uPct },
    discretionary: { ...d, pct: dPct },
    unclassified: { ...n, pct: nPct },
    totalSpent: u.spent + d.spent + n.spent,
    totalBudget,
    maxPossibleSavings: monthlyIncome !== null ? monthlyIncome - unavoidableCommitted : null,
  };
}
