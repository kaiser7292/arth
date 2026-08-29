/**
 * Recurring Transaction Detection Service.
 *
 * Auto-detects subscriptions and recurring payments from expense history.
 * Groups expenses by normalized merchant + approximate amount, classifies
 * interval (weekly/monthly/quarterly/yearly), and predicts next occurrence.
 *
 * Detection runs after expense approval, throttled to max once per hour.
 */

import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { normalizeMerchant } from "@/services/smart-categorizer";
import { bumpDataVersion } from "@/services/settings";
import { formatLocalDate } from "@/utils/fiscal-year";

export type RecurringFrequency = "weekly" | "monthly" | "quarterly" | "yearly" | "last_day_of_month" | "nth_weekday";

export interface RecurringTransaction {
  id: string;
  user_id: string;
  merchant_normalized: string;
  amount: number;
  frequency: RecurringFrequency;
  category_id: string | null;
  account_id: string | null;
  last_seen_date: string;
  next_expected_date: string | null;
  occurrence_count: number;
  is_active: number;
  is_confirmed: number;
  created_at: string;
  updated_at: string;
}

/**
 * Classify the average interval in days into a frequency bucket.
 * Returns null if the interval doesn't match any known pattern.
 */
export function classifyFrequency(avgIntervalDays: number): RecurringFrequency | null {
  if (avgIntervalDays >= 5 && avgIntervalDays <= 10) return "weekly";
  if (avgIntervalDays >= 25 && avgIntervalDays <= 35) return "monthly";
  if (avgIntervalDays >= 80 && avgIntervalDays <= 100) return "quarterly";
  if (avgIntervalDays >= 340 && avgIntervalDays <= 395) return "yearly";
  return null;
}

/**
 * Calculate next expected date from the last seen date and frequency.
 */
export function calculateNextDate(lastDate: string, frequency: RecurringFrequency): string {
  const d = new Date(lastDate);
  switch (frequency) {
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "monthly":
      d.setMonth(d.getMonth() + 1);
      break;
    case "quarterly":
      d.setMonth(d.getMonth() + 3);
      break;
    case "yearly":
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return formatLocalDate(d);
}

/**
 * Full scan: detect recurring transactions from expense history.
 *
 * Algorithm:
 * 1. Group approved realized expenses by normalized merchant description
 * 2. For each group with 2+ occurrences, check if amounts are within 5%
 * 3. Calculate average interval between occurrences
 * 4. Classify interval into frequency bucket
 * 5. Upsert into recurring_transactions table
 */
/**
 * Per-merchant diagnostic explaining why a group was or wasn't detected.
 * Returned from detectRecurringTransactionsDetailed so the UI can show the
 * user why their data didn't surface as patterns.
 */
export interface MerchantDetectionReason {
  merchant: string;
  occurrences: number;
  outcome: "detected" | "single_occurrence" | "amount_variance" | "irregular_interval";
  avgIntervalDays?: number;
  frequency?: RecurringFrequency;
}

export interface DetectionSummary {
  scannedExpenses: number;
  uniqueMerchants: number;
  detected: number;
  skipped: MerchantDetectionReason[];
  detectedList: MerchantDetectionReason[];
}

export async function detectRecurringTransactions(userId: string): Promise<number> {
  const summary = await detectRecurringTransactionsDetailed(userId);
  return summary.detected;
}

/**
 * Same detection logic as detectRecurringTransactions, but returns a full
 * diagnostic summary so a UI can explain which merchants were skipped and why.
 */
export async function detectRecurringTransactionsDetailed(userId: string): Promise<DetectionSummary> {
  const db = getDatabase();

  // Get all approved realized expenses with merchant names, grouped by merchant
  const expenses = await db.getAllAsync<{
    id: string;
    amount: number;
    merchant_name: string;
    date: string;
    category_id: string | null;
    account_id: string | null;
  }>(
    `SELECT id, amount, merchant_name, date, category_id, account_id FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND merchant_name IS NOT NULL AND merchant_name != ''
     ORDER BY date ASC;`,
    userId,
  );

  // Group by normalized merchant name
  const groups = new Map<string, typeof expenses>();
  for (const exp of expenses) {
    const merchant = normalizeMerchant(exp.merchant_name);
    if (!merchant) continue;
    if (!groups.has(merchant)) groups.set(merchant, []);
    groups.get(merchant)!.push(exp);
  }

  let detected = 0;
  const skipped: MerchantDetectionReason[] = [];
  const detectedList: MerchantDetectionReason[] = [];

  for (const [merchant, items] of groups) {
    if (items.length < 2) {
      skipped.push({ merchant, occurrences: items.length, outcome: "single_occurrence" });
      continue;
    }

    // Check amount consistency (within 5% of median)
    const amounts = items.map((i) => i.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    const withinTolerance = items.filter(
      (i) => median === 0 ? i.amount === 0 : Math.abs(i.amount - median) / median <= 0.05,
    );
    if (withinTolerance.length < 2) {
      skipped.push({ merchant, occurrences: items.length, outcome: "amount_variance" });
      continue;
    }

    // Calculate average interval between consecutive occurrences
    const dates = withinTolerance.map((i) => new Date(i.date).getTime()).sort((a, b) => a - b);
    let totalInterval = 0;
    for (let i = 1; i < dates.length; i++) {
      totalInterval += dates[i] - dates[i - 1];
    }
    const avgIntervalMs = totalInterval / (dates.length - 1);
    const avgIntervalDays = avgIntervalMs / (1000 * 60 * 60 * 24);

    const frequency = classifyFrequency(avgIntervalDays);
    if (!frequency) {
      skipped.push({ merchant, occurrences: withinTolerance.length, outcome: "irregular_interval", avgIntervalDays });
      continue;
    }

    const lastItem = withinTolerance[withinTolerance.length - 1];
    const nextExpected = calculateNextDate(lastItem.date, frequency);

    // Upsert: check if we already track this merchant
    const existing = await db.getFirstAsync<{ id: string; occurrence_count: number }>(
      `SELECT id, occurrence_count FROM recurring_transactions
       WHERE user_id = ? AND merchant_normalized = ? AND is_active = 1;`,
      userId,
      merchant,
    );

    if (existing) {
      await db.runAsync(
        `UPDATE recurring_transactions
         SET amount = ?, frequency = ?, last_seen_date = ?, next_expected_date = ?,
             occurrence_count = ?, category_id = ?, account_id = ?, updated_at = datetime('now')
         WHERE id = ?;`,
        median,
        frequency,
        lastItem.date,
        nextExpected,
        withinTolerance.length,
        lastItem.category_id,
        lastItem.account_id,
        existing.id,
      );
    } else {
      const id = generateUUID();
      await db.runAsync(
        `INSERT INTO recurring_transactions
         (id, user_id, merchant_normalized, amount, frequency, category_id, account_id, last_seen_date, next_expected_date, occurrence_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        id,
        userId,
        merchant,
        median,
        frequency,
        lastItem.category_id,
        lastItem.account_id,
        lastItem.date,
        nextExpected,
        withinTolerance.length,
      );
    }

    detected++;
    detectedList.push({ merchant, occurrences: withinTolerance.length, outcome: "detected", avgIntervalDays, frequency });
  }

  if (detected > 0) await bumpDataVersion();
  return {
    scannedExpenses: expenses.length,
    uniqueMerchants: groups.size,
    detected,
    skipped,
    detectedList,
  };
}

/**
 * Get all active recurring transactions for a user.
 */
export async function getRecurringTransactions(
  userId: string,
): Promise<RecurringTransaction[]> {
  const db = getDatabase();
  return db.getAllAsync<RecurringTransaction>(
    `SELECT * FROM recurring_transactions
     WHERE user_id = ? AND is_active = 1
     ORDER BY next_expected_date ASC;`,
    userId,
  );
}

/**
 * User confirms a detected recurring transaction.
 */
export async function confirmRecurring(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE recurring_transactions SET is_confirmed = 1, updated_at = datetime('now') WHERE id = ?;`,
    id,
  );
  await bumpDataVersion();
}

/**
 * User dismisses a detected recurring transaction (not actually recurring).
 */
export async function dismissRecurring(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE recurring_transactions SET is_active = 0, updated_at = datetime('now') WHERE id = ?;`,
    id,
  );
  await bumpDataVersion();
}

/**
 * Get all dismissed (soft-deleted) recurring transactions for the recycle bin.
 */
export async function getDismissedRecurring(userId: string): Promise<RecurringTransaction[]> {
  const db = getDatabase();
  return db.getAllAsync<RecurringTransaction>(
    "SELECT * FROM recurring_transactions WHERE user_id = ? AND is_active = 0 ORDER BY merchant_normalized ASC;",
    userId,
  );
}

/**
 * Restore a dismissed recurring transaction.
 */
export async function restoreRecurring(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "UPDATE recurring_transactions SET is_active = 1, updated_at = datetime('now') WHERE id = ?;",
    id,
  );
  await bumpDataVersion();
}

/**
 * Restore all dismissed recurring transactions for a user.
 */
export async function restoreAllRecurring(userId: string): Promise<number> {
  const db = getDatabase();
  const result = await db.runAsync(
    "UPDATE recurring_transactions SET is_active = 1, updated_at = datetime('now') WHERE user_id = ? AND is_active = 0;",
    userId,
  );
  if (result.changes > 0) await bumpDataVersion();
  return result.changes;
}

/**
 * Permanently delete a dismissed recurring transaction.
 */
export async function hardDeleteRecurring(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync("DELETE FROM recurring_transactions WHERE id = ? AND is_active = 0;", id);
  await bumpDataVersion();
}

/**
 * Permanently delete all dismissed recurring transactions for a user.
 */
export async function purgeAllDismissedRecurring(userId: string): Promise<number> {
  const db = getDatabase();
  const result = await db.runAsync(
    "DELETE FROM recurring_transactions WHERE user_id = ? AND is_active = 0;",
    userId,
  );
  if (result.changes > 0) await bumpDataVersion();
  return result.changes;
}

/**
 * Get recurring transactions predicted within the next N days.
 */
export async function getUpcomingRecurring(
  userId: string,
  days: number = 30,
): Promise<RecurringTransaction[]> {
  const db = getDatabase();
  const today = new Date().toISOString().split("T")[0];
  return db.getAllAsync<RecurringTransaction>(
    `SELECT * FROM recurring_transactions
     WHERE user_id = ? AND is_active = 1
       AND next_expected_date IS NOT NULL
       AND next_expected_date >= ?
       AND next_expected_date <= date(?, '+' || ? || ' days')
     ORDER BY next_expected_date ASC;`,
    userId,
    today,
    today,
    days,
  );
}

/**
 * After a new expense is approved, check if it matches a known recurring pattern.
 * Updates the recurring record with the new occurrence if found.
 */
export async function checkNewExpenseForRecurring(
  userId: string,
  merchant: string | null,
  amount: number,
  date: string,
  categoryId: string | null,
  accountId: string | null,
): Promise<void> {
  if (!merchant) return;

  const normalized = normalizeMerchant(merchant.split(" via ")[0]);
  if (!normalized) return;

  const db = getDatabase();
  const existing = await db.getFirstAsync<{
    id: string;
    amount: number;
    frequency: RecurringFrequency;
    occurrence_count: number;
  }>(
    `SELECT id, amount, frequency, occurrence_count FROM recurring_transactions
     WHERE user_id = ? AND merchant_normalized = ? AND is_active = 1;`,
    userId,
    normalized,
  );

  if (!existing) return;

  // Check amount is within 5% tolerance
  if (existing.amount === 0 ? amount !== 0 : Math.abs(amount - existing.amount) / existing.amount > 0.05) return;

  const nextExpected = calculateNextDate(date, existing.frequency);

  await db.runAsync(
    `UPDATE recurring_transactions
     SET last_seen_date = ?, next_expected_date = ?, occurrence_count = ?,
         category_id = ?, account_id = ?, updated_at = datetime('now')
     WHERE id = ?;`,
    date,
    nextExpected,
    existing.occurrence_count + 1,
    categoryId,
    accountId,
    existing.id,
  );
  await bumpDataVersion();
}
