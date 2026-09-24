import type { DuplicateGroup } from "@/services/duplicate-detection";
import { scanAllDuplicatesCached } from "@/services/duplicate-detection";
import type { Expense, ForecastMatchPair } from "@/services/expense";
import {
  getMatchedForecastPairs,
  getPendingExpensesForReview,
  getUncategorizedExpenses,
} from "@/services/expense";

/**
 * Everything the review queue shows, loaded in one pass.
 *
 * Both the list (ReviewQueuePage) and Catch Up read from here so the two can't drift on what
 * counts as "needs review" - the list and its old route copy drifted once already.
 */
export interface ReviewQueueSnapshot {
  /** pending_review rows (realized, credit, forecast), minus realized rows that sit in a forecast match. */
  pending: Expense[];
  matchedPairs: ForecastMatchPair[];
  duplicateGroups: DuplicateGroup[];
  uncategorized: Expense[];
}

export async function getReviewQueueSnapshot(userId: string): Promise<ReviewQueueSnapshot> {
  const [pending, pairs, dupScan, uncat] = await Promise.all([
    getPendingExpensesForReview(userId),
    getMatchedForecastPairs(userId),
    scanAllDuplicatesCached(userId),
    getUncategorizedExpenses(userId),
  ]);
  // A matched realized row is reviewed through its pair, not on its own.
  const matchedRealizedIds = new Set(pairs.map((p) => p.realized.id));
  return {
    pending: pending.filter((i) => !matchedRealizedIds.has(i.id)),
    matchedPairs: pairs,
    duplicateGroups: dupScan.groups,
    uncategorized: uncat,
  };
}
