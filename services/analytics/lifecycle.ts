import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { seedClassificationsFromRecurring } from "./seed-classifications";
import { detectNewPatterns, updatePatternConfidence, deactivateStalePatterns } from "./pattern-learner";
import { detectRecurringTransactions } from "@/services/recurring-detector";
import type { Expense } from "@/services/expense-types";

/**
 * Run on app startup (after DB init). Seeds classifications from recurring
 * transactions if none exist yet, then runs pattern detection on recent expenses.
 */
export async function initClassificationSystem(): Promise<void> {
  const userId = DEFAULT_USER_ID;

  // Detect recurring transactions from full expense history. This populates
  // the recurring_transactions table that the Patterns UI reads from.
  // Without this, historic data is never surfaced as patterns.
  await detectRecurringTransactions(userId);

  // Seed from existing recurring_transactions (no-op if already seeded)
  await seedClassificationsFromRecurring(userId);

  // Run pattern detection on last 6 months of expenses
  const db = getDatabase();
  const sixMonthsAgo = getMonthOffset(getCurrentMonth(), -6);
  const expenses = await db.getAllAsync<Expense>(
    `SELECT * FROM expenses
     WHERE user_id = ? AND date >= ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
     ORDER BY date ASC;`,
    userId,
    `${sixMonthsAgo}-01`,
  );

  if (expenses.length > 0) {
    await detectNewPatterns(userId, expenses);
    await updatePatternConfidence(userId, expenses);
  }

  // Deactivate stale patterns (merchants that stopped recurring)
  await deactivateStalePatterns(userId, getCurrentMonth());
}

/**
 * Run after a batch of new expenses is added/approved.
 * Updates confidence of existing patterns and detects new ones.
 */
export async function refreshClassifications(newExpenses: Expense[]): Promise<void> {
  if (newExpenses.length === 0) return;
  const userId = DEFAULT_USER_ID;

  // Re-run recurring detection so the Patterns UI picks up newly-added merchants.
  await detectRecurringTransactions(userId);
  await updatePatternConfidence(userId, newExpenses);
  await detectNewPatterns(userId, newExpenses);
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthOffset(month: string, offset: number): string {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(year, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
