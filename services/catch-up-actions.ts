import { DEFAULT_USER_ID } from "@/constants/app";
import {
  approveExpense,
  approveExpenses,
  bulkAssignCategory,
} from "@/services/expense";
import { recordCategoryCorrection } from "@/services/smart-categorizer";
import type { Expense } from "@/services/expense";

/**
 * The writes behind Catch Up's approve / categorize actions. Kept apart from the screen so
 * the category-then-approve ordering is tested in one place.
 */

/**
 * Approve one pending item with the category shown on the card.
 *
 * `taught` = the user picked the category by hand, so the merchant → category mapping is recorded
 * for next time, the same learning path the edit screen uses.
 */
export async function approveWithCategory(
  expense: Expense,
  categoryId: string | null,
  taught: boolean,
): Promise<void> {
  if (categoryId && categoryId !== expense.category_id) {
    await bulkAssignCategory([expense.id], categoryId);
  }
  if (taught && categoryId && expense.merchant_name) {
    await recordCategoryCorrection(DEFAULT_USER_ID, expense.merchant_name, categoryId);
  }
  await approveExpense(expense.id);
}

/** "Same again?" for pending items: give every row the category, then approve them in one pass. */
export async function approveBatchWithCategory(
  expenses: Expense[],
  categoryId: string | null,
): Promise<void> {
  if (expenses.length === 0) return;
  const ids = expenses.map((e) => e.id);
  if (categoryId) {
    const needCategory = expenses.filter((e) => e.category_id !== categoryId).map((e) => e.id);
    if (needCategory.length > 0) await bulkAssignCategory(needCategory, categoryId);
  }
  await approveExpenses(ids);
}

/** Categorize already-approved uncategorized rows (one card, or a "same again" batch). */
export async function assignCategory(
  expenses: Expense[],
  categoryId: string,
  taught: boolean,
): Promise<void> {
  if (expenses.length === 0) return;
  await bulkAssignCategory(expenses.map((e) => e.id), categoryId);
  const merchant = expenses[0].merchant_name;
  if (taught && merchant) {
    await recordCategoryCorrection(DEFAULT_USER_ID, merchant, categoryId);
  }
}
