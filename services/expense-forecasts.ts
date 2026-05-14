import { getDatabase } from "@/database";
import { createTransfer } from "@/services/account-transfer";
import { applyCcPayment } from "@/services/financial-account";
import { bumpDataVersion } from "@/services/settings";
import { generateUUID } from "@/utils/uuid";
import type { Expense, ForecastMatch, ForecastMatchPair } from "./expense-types";

/**
 * Get all forecast (upcoming) expenses for a user, ordered by due date ascending.
 * Optionally filter by status.
 */
export async function getForecastExpenses(
  userId: string,
  status?: "approved" | "pending_review" | "rejected",
): Promise<Expense[]> {
  const db = getDatabase();

  if (status) {
    return db.getAllAsync<Expense>(
      `SELECT * FROM expenses
       WHERE user_id = ? AND nature = 'forecast' AND status = ? AND deleted_at IS NULL
       ORDER BY due_date ASC, created_at DESC;`,
      userId,
      status,
    );
  }

  return db.getAllAsync<Expense>(
    `SELECT * FROM expenses
     WHERE user_id = ? AND nature = 'forecast' AND status != 'rejected' AND deleted_at IS NULL
     ORDER BY due_date ASC, created_at DESC;`,
    userId,
  );
}

/**
 * Get overdue forecast expenses — forecasts whose due_date has passed
 * but haven't been realized or rejected.
 */
export async function getOverdueForecasts(
  userId: string,
  today: string,
): Promise<Expense[]> {
  const db = getDatabase();
  return db.getAllAsync<Expense>(
    `SELECT * FROM expenses
     WHERE user_id = ? AND nature = 'forecast' AND status != 'rejected' AND deleted_at IS NULL
       AND due_date IS NOT NULL AND due_date < ?
     ORDER BY due_date ASC;`,
    userId,
    today,
  );
}

/**
 * Convert a forecast expense to realized.
 * Sets nature to 'realized', updates the date to the actual transaction date,
 * and clears the due_date.
 */
export async function realizeForecast(
  id: string,
  actualDate: string,
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE expenses
     SET nature = 'realized', date = ?, due_date = NULL, status = 'approved', updated_at = datetime('now')
     WHERE id = ? AND nature = 'forecast';`,
    actualDate,
    id,
  );
  bumpDataVersion();
  // v14.7.0: recurring rules no longer materialize forecasts, so there's
  // nothing to auto-chain on realization. The recurring-rule fulfillment
  // flow is user-initiated via the reminder card on the home screen.
}

/**
 * Simple fuzzy merchant match: normalized Jaccard similarity on word tokens.
 * Returns 0-1 score (1 = identical, 0 = no overlap).
 */
function merchantSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection++;
  return intersection / (wordsA.size + wordsB.size - intersection);
}

/**
 * Find a matching forecast for an incoming realized transaction.
 * Match criteria:
 *  - Exact amount match (within 0.01 rounding tolerance)
 *  - Exact account_id match (when both present)
 *  - Fuzzy merchant name matching
 *  - due_date within +/- 7 days of the transaction date
 *
 * Returns the best match with a confidence score (0-100).
 * Confidence factors: exact amount (+25), exact account (+25), merchant similarity (+20), close date (+30 scaled).
 */
export async function findMatchingForecast(
  userId: string,
  amount: number,
  accountId: string | null,
  transactionDate: string,
  merchantName?: string | null,
): Promise<ForecastMatch | null> {
  const db = getDatabase();

  // Exact amount match: allow 0.01 rounding tolerance only
  const minAmount = Math.round((amount - 0.01) * 100) / 100;
  const maxAmount = Math.round((amount + 0.01) * 100) / 100;

  // Find all candidate forecasts with exact amount and date window
  const candidates = await db.getAllAsync<Expense>(
    `SELECT * FROM expenses
     WHERE user_id = ? AND nature = 'forecast' AND status != 'rejected' AND deleted_at IS NULL
       AND amount >= ? AND amount <= ?
       AND due_date IS NOT NULL
       AND due_date >= date(?, '-7 days')
       AND due_date <= date(?, '+7 days')
     ORDER BY ABS(julianday(due_date) - julianday(?)) ASC
     LIMIT 10;`,
    userId,
    minAmount,
    maxAmount,
    transactionDate,
    transactionDate,
    transactionDate,
  );

  if (candidates.length === 0) return null;

  // Score each candidate
  let bestMatch: ForecastMatch | null = null;

  for (const forecast of candidates) {
    let confidence = 0;

    // Amount: exact match = 25 (always true since query uses exact tolerance)
    confidence += 25;

    // Account match: exact = 25, both missing = 10, mismatch = skip candidate
    if (accountId && forecast.account_id) {
      if (accountId === forecast.account_id) {
        confidence += 25;
      } else {
        continue; // Different accounts — not a match
      }
    } else if (!accountId && !forecast.account_id) {
      confidence += 10;
    } else {
      confidence += 5; // One has account info, other doesn't
    }

    // Merchant similarity: fuzzy match (0-20 points)
    const mSim = merchantSimilarity(merchantName ?? null, forecast.merchant_name);
    confidence += Math.round(mSim * 20);

    // Date proximity: 0 days = 30, scales down to 5 at 7 days
    if (forecast.due_date) {
      const dueMs = new Date(forecast.due_date).getTime();
      const txMs = new Date(transactionDate).getTime();
      const daysDiff = Math.abs(dueMs - txMs) / (1000 * 60 * 60 * 24);
      const dateScore = Math.max(5, Math.round(30 - (daysDiff / 7) * 25));
      confidence += dateScore;
    }

    if (!bestMatch || confidence > bestMatch.confidence) {
      bestMatch = { forecast, confidence };
    }
  }

  return bestMatch;
}

/**
 * Get all matched forecast-realized pairs pending review.
 * A pair consists of a realized expense that has matched_forecast_id
 * pointing to a forecast expense.
 */
export async function getMatchedForecastPairs(
  userId: string,
): Promise<ForecastMatchPair[]> {
  const db = getDatabase();

  const realizedWithMatch = await db.getAllAsync<Expense>(
    `SELECT * FROM expenses
     WHERE user_id = ? AND nature = 'realized' AND status = 'pending_review' AND deleted_at IS NULL
       AND matched_forecast_id IS NOT NULL
     ORDER BY created_at DESC;`,
    userId,
  );

  if (realizedWithMatch.length === 0) return [];

  // Batch-load all referenced forecasts in one query
  const forecastIds = realizedWithMatch.map((r) => r.matched_forecast_id!);
  const placeholders = forecastIds.map(() => "?").join(",");
  const forecasts = await db.getAllAsync<Expense>(
    `SELECT * FROM expenses WHERE id IN (${placeholders}) AND nature = 'forecast' AND status != 'rejected';`,
    ...forecastIds,
  );

  const forecastMap = new Map(forecasts.map((f) => [f.id, f]));

  const pairs: ForecastMatchPair[] = [];
  for (const realized of realizedWithMatch) {
    const forecast = forecastMap.get(realized.matched_forecast_id!);
    if (forecast) {
      pairs.push({ realized, forecast });
    }
  }

  return pairs;
}

/**
 * Resolve a matched forecast pair: realize the forecast, reject the realized duplicate.
 * Use when user confirms the realized expense matches the existing forecast.
 */
export async function resolveMatchRealize(
  forecastId: string,
  realizedId: string,
  actualDate: string,
): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString(); // Local time in ISO format
  await db.withTransactionAsync(async () => {
    // Convert forecast to realized
    await db.runAsync(
      `UPDATE expenses
       SET nature = 'realized', date = ?, due_date = NULL, status = 'approved', matched_forecast_id = NULL, updated_at = ?
       WHERE id = ?;`,
      actualDate,
      now,
      forecastId,
    );
    // Reject the duplicate realized expense
    await db.runAsync(
      `UPDATE expenses SET status = 'rejected', updated_at = ? WHERE id = ?;`,
      now,
      realizedId,
    );
  });
  bumpDataVersion();
}

/**
 * Resolve a matched pair: keep the realized expense, reject the forecast.
 * Use when user says "already captured" — the forecast is stale.
 */
export async function resolveMatchAlreadyCaptured(
  forecastId: string,
  realizedId: string,
): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString(); // Local time in ISO format
  await db.withTransactionAsync(async () => {
    // Approve the realized expense and clear matched link
    await db.runAsync(
      `UPDATE expenses SET status = 'approved', matched_forecast_id = NULL, updated_at = ? WHERE id = ?;`,
      now,
      realizedId,
    );
    // Reject the forecast
    await db.runAsync(
      `UPDATE expenses SET status = 'rejected', updated_at = ? WHERE id = ?;`,
      now,
      forecastId,
    );
  });
  bumpDataVersion();
}

/**
 * Resolve a matched pair: keep both as separate expenses.
 * Use when user says "both different" — they are unrelated.
 */
export async function resolveMatchBothDifferent(
  forecastId: string,
  realizedId: string,
): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString(); // Local time in ISO format
  await db.withTransactionAsync(async () => {
    // Approve the realized expense and clear matched link
    await db.runAsync(
      `UPDATE expenses SET status = 'approved', matched_forecast_id = NULL, updated_at = ? WHERE id = ?;`,
      now,
      realizedId,
    );
    // Keep the forecast as-is (approve it if pending)
    await db.runAsync(
      `UPDATE expenses SET status = 'approved', updated_at = ? WHERE id = ?;`,
      now,
      forecastId,
    );
  });
  bumpDataVersion();
}

/**
 * Bulk reject overdue forecasts that haven't been matched or realized.
 */
export async function dismissOverdueForecasts(
  userId: string,
  today: string,
): Promise<number> {
  const db = getDatabase();
  const now = new Date().toISOString(); // Local time in ISO format
  const result = await db.runAsync(
    `UPDATE expenses SET status = 'rejected', updated_at = ?
     WHERE user_id = ? AND nature = 'forecast' AND status != 'rejected'
       AND due_date IS NOT NULL AND due_date < ?;`,
    now,
    userId,
    today,
  );
  bumpDataVersion();
  return result.changes;
}

/**
 * Mark an EXPENSE forecast as paid — searches for a matching realized expense
 * and links them. No CC dues logic (expense forecasts aren't bill payments).
 */
export async function markExpenseForecastAsPaid(
  forecastId: string,
): Promise<{ linked: boolean; matchedExpenseId?: string }> {
  const db = getDatabase();

  const forecast = await db.getFirstAsync<Expense>(
    `SELECT * FROM expenses WHERE id = ? AND nature = 'forecast';`,
    forecastId,
  );
  if (!forecast) throw new Error("Forecast not found");

  const tolerance = forecast.amount * 0.02;
  const minAmount = Math.round((forecast.amount - tolerance) * 100) / 100;
  const maxAmount = Math.round((forecast.amount + tolerance) * 100) / 100;
  const refDate = forecast.due_date ?? new Date().toISOString().split("T")[0];

  let match: Expense | null = null;

  if (forecast.account_id) {
    match = await db.getFirstAsync<Expense>(
      `SELECT * FROM expenses
       WHERE nature = 'realized' AND status IN ('approved', 'pending_review') AND deleted_at IS NULL
         AND account_id = ? AND amount >= ? AND amount <= ?
         AND date >= date(?, '-7 days') AND date <= date(?, '+7 days')
       ORDER BY ABS(julianday(date) - julianday(?)) ASC
       LIMIT 1;`,
      forecast.account_id,
      minAmount,
      maxAmount,
      refDate,
      refDate,
      refDate,
    );
  }

  if (!match) {
    match = await db.getFirstAsync<Expense>(
      `SELECT * FROM expenses
       WHERE nature = 'realized' AND status IN ('approved', 'pending_review') AND deleted_at IS NULL
         AND amount >= ? AND amount <= ?
         AND date >= date(?, '-7 days') AND date <= date(?, '+7 days')
       ORDER BY ABS(julianday(date) - julianday(?)) ASC
       LIMIT 1;`,
      minAmount,
      maxAmount,
      refDate,
      refDate,
      refDate,
    );
  }

  if (match) {
    const now = new Date().toISOString(); // Local time in ISO format
    await db.runAsync(
      `UPDATE expenses SET matched_forecast_id = ?, status = 'approved', updated_at = ? WHERE id = ?;`,
      forecastId,
      now,
      match.id,
    );
    await db.runAsync(
      `UPDATE expenses SET status = 'rejected', updated_at = ? WHERE id = ?;`,
      now,
      forecastId,
    );
    bumpDataVersion();
    return { linked: true, matchedExpenseId: match.id };
  } else {
    const now = new Date().toISOString(); // Local time in ISO format
    await db.runAsync(
      `UPDATE expenses SET status = 'rejected', updated_at = ? WHERE id = ?;`,
      now,
      forecastId,
    );
    bumpDataVersion();
    return { linked: false };
  }
}

/**
 * Find an open REPAYMENT forecast that matches an incoming CC payment SMS.
 * Match criteria (intentionally looser than findMatchingForecast):
 *  - Same CC account (exact)
 *  - Amount within ±0.5% (CC statements often slightly differ from reminder amounts)
 *  - Forecast is still open (status != 'rejected')
 *  - Prefer the forecast with the closest amount and closest due_date to the
 *    SMS payment date.
 */
export async function findMatchingRepaymentForecast(
  userId: string,
  ccAccountId: string,
  amount: number,
  paymentDate: string,
): Promise<Expense | null> {
  const db = getDatabase();
  const tolerance = Math.max(amount * 0.005, 0.01); // ±0.5% or at least 0.01
  const minAmount = amount - tolerance;
  const maxAmount = amount + tolerance;

  const candidates = await db.getAllAsync<Expense>(
    `SELECT * FROM expenses
     WHERE user_id = ? AND nature = 'forecast' AND forecast_type = 'repayment'
       AND status != 'rejected' AND deleted_at IS NULL
       AND account_id = ?
       AND amount >= ? AND amount <= ?
     ORDER BY ABS(amount - ?) ASC, ABS(julianday(COALESCE(due_date, date)) - julianday(?)) ASC
     LIMIT 1;`,
    userId,
    ccAccountId,
    minAmount,
    maxAmount,
    amount,
    paymentDate,
  );
  return candidates[0] ?? null;
}

/**
 * Mark a REPAYMENT forecast as paid from a specific savings/wallet account.
 * Creates an inter-account transfer (savings → CC), updates CC dues + available limit.
 * No expense is created — this is NOT spending, it's a balance transfer.
 */
export async function markRepaymentAsPaid(
  forecastId: string,
  fromAccountId: string,
): Promise<{ transferId: string }> {
  const db = getDatabase();

  const forecast = await db.getFirstAsync<Expense>(
    `SELECT * FROM expenses WHERE id = ? AND nature = 'forecast' AND forecast_type = 'repayment';`,
    forecastId,
  );
  if (!forecast) throw new Error("Repayment forecast not found");
  if (!forecast.account_id) throw new Error("Repayment forecast has no linked CC account");

  // Payment date = today. The user may pay before the forecast's due_date,
  // and the ledger must reflect when the money actually moved, not when the
  // bill was expected to be paid.
  const paymentDate = new Date().toISOString().split("T")[0];

  // Surface the due date in the ledger description so the reader can
  // distinguish payment date from bill due date at a glance.
  const merchantPart = forecast.merchant_name ? ` — ${forecast.merchant_name}` : "";
  const duePart = forecast.due_date ? ` (due ${forecast.due_date})` : "";

  // v15.12.1: for SMS-detected repayment forecasts, preserve the raw SMS body
  // and sender address on the resulting transfer so the ledger row stays
  // traceable to its origin.
  let rawSourceText: string | null = null;
  let sourceSmsAddress: string | null = null;
  if (forecast.source === "sms_auto" && forecast.raw_source_text) {
    rawSourceText = forecast.raw_source_text;
    const smsRow = await db.getFirstAsync<{ address: string | null }>(
      `SELECT address FROM pending_sms WHERE expense_id = ? LIMIT 1;`,
      forecastId,
    );
    sourceSmsAddress = smsRow?.address ?? null;
  }

  const transferId = await createTransfer({
    userId: forecast.user_id,
    fromAccountId,
    toAccountId: forecast.account_id,
    amount: forecast.amount,
    description: `CC bill payment${merchantPart}${duePart}`,
    date: paymentDate,
    linkedForecastId: forecastId,
    rawSourceText,
    sourceSmsAddress,
  });

  await applyCcPayment(forecast.account_id, forecast.amount);

  const now = new Date().toISOString(); // Local time in ISO format
  await db.runAsync(
    `UPDATE expenses SET status = 'rejected', paid_from_account_id = ?, updated_at = ? WHERE id = ?;`,
    fromAccountId,
    now,
    forecastId,
  );

  bumpDataVersion();
  return { transferId };
}

/**
 * Mark a forecast as "paid externally" — dismiss it without creating a transfer
 * or debiting any savings account.
 * For repayments: CC dues still decrease + available limit increases (payment happened, just not tracked).
 * For expenses: simply reject the forecast.
 */
export async function markForecastPaidExternally(
  forecastId: string,
): Promise<void> {
  const db = getDatabase();

  const forecast = await db.getFirstAsync<Expense>(
    `SELECT * FROM expenses WHERE id = ? AND nature = 'forecast';`,
    forecastId,
  );
  if (!forecast) throw new Error("Forecast not found");

  if (forecast.forecast_type === "repayment" && forecast.account_id) {
    await applyCcPayment(forecast.account_id, forecast.amount);
    // Also write a credit row so the CC ledger reflects the payment.
    // applyCcPayment only updates total_due — ledger math needs an actual row.
    // Date = today (when the user marked it paid); surface the due date in
    // the description so payment date vs bill due date are both visible.
    const creditId = generateUUID();
    const paymentDate = new Date().toISOString().split("T")[0];
    const merchantPart = forecast.merchant_name ? ` — ${forecast.merchant_name}` : "";
    const duePart = forecast.due_date ? ` (due ${forecast.due_date})` : "";
    const now = new Date().toISOString(); // Local time in ISO format
    await db.runAsync(
      `INSERT INTO expenses (id, user_id, amount, currency, description, date, transaction_time, nature, source, status, account_id, created_at)
       VALUES (?, ?, ?, 'INR', ?, ?, '00:00:00', 'credit', 'manual', 'approved', ?, ?);`,
      creditId,
      forecast.user_id,
      forecast.amount,
      `CC bill paid externally${merchantPart}${duePart}`,
      paymentDate,
      forecast.account_id,
      now,
    );
  }

  const now = new Date().toISOString(); // Local time in ISO format
  await db.runAsync(
    `UPDATE expenses SET status = 'rejected', updated_at = ? WHERE id = ?;`,
    now,
    forecastId,
  );
  bumpDataVersion();
}

/**
 * Legacy wrapper — routes to the correct handler based on forecast_type.
 * Prefer calling the specific functions directly.
 */
export async function markForecastAsPaid(
  forecastId: string,
): Promise<{ linked: boolean; matchedExpenseId?: string }> {
  const db = getDatabase();
  const forecast = await db.getFirstAsync<{ forecast_type: string }>(
    `SELECT forecast_type FROM expenses WHERE id = ? AND nature = 'forecast';`,
    forecastId,
  );
  if (!forecast) throw new Error("Forecast not found");

  if (forecast.forecast_type === "repayment") {
    await markForecastPaidExternally(forecastId);
    return { linked: false };
  }
  return markExpenseForecastAsPaid(forecastId);
}

/**
 * Find the original expense that a refund should link to.
 * Searches last 30 days for a realized, approved/pending debit
 * with a fuzzy amount match (within 2% tolerance) and same account
 * (by card last 4 digits). Returns the most recent match.
 */
export async function findRefundTarget(
  userId: string,
  amount: number,
  cardLast4: string | null,
  refundDate: string,
): Promise<Expense | null> {
  if (!cardLast4) return null;

  const db = getDatabase();
  const tolerance = amount * 0.02;
  const minAmount = Math.round((amount - tolerance) * 100) / 100;
  const maxAmount = Math.round((amount + tolerance) * 100) / 100;

  const row = await db.getFirstAsync<Expense>(
    `SELECT e.* FROM expenses e
     LEFT JOIN financial_accounts fa ON e.account_id = fa.id
     WHERE e.user_id = ? AND e.nature = 'realized' AND e.status != 'rejected' AND e.deleted_at IS NULL
       AND e.amount >= ? AND e.amount <= ?
       AND fa.account_identifier = ?
       AND e.date >= date(?, '-30 days')
       AND e.date <= ?
       AND e.refund_of_expense_id IS NULL
     ORDER BY e.date DESC
     LIMIT 1;`,
    userId,
    minAmount,
    maxAmount,
    cardLast4,
    refundDate,
    refundDate,
  );

  return row ?? null;
}
