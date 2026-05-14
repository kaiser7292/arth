import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { getRecurringTransactions } from "@/services/recurring-detector";
import { bumpDataVersion } from "@/services/settings";
import { THRESHOLDS } from "@/utils/analytics/thresholds";

export async function seedClassificationsFromRecurring(userId: string): Promise<number> {
  const db = getDatabase();

  const existingCount = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM expense_classifications WHERE user_id = ?;",
    userId
  );
  if (existingCount && existingCount.count > 0) return 0;

  const recurrings = await getRecurringTransactions(userId);
  if (recurrings.length === 0) return 0;

  let seeded = 0;
  for (const r of recurrings) {
    if (!r.is_active) continue;

    const tolerance = r.amount * THRESHOLDS.CLASSIFICATION_AMOUNT_TOLERANCE;
    const confidence = r.is_confirmed === 1
      ? 1.0
      : calculateSeedConfidence(r.occurrence_count);

    const source = r.is_confirmed === 1 ? "user_confirmed" : "auto_detected";
    const expectedDay = new Date(r.last_seen_date).getDate();

    await db.runAsync(
      `INSERT INTO expense_classifications
       (id, user_id, merchant_normalized, category_id, amount_range_low, amount_range_high,
        classification, frequency, expected_day_of_month, confidence, source,
        occurrence_count, last_seen_date, last_confirmed_date, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 'fixed', ?, ?, ?, ?, ?, ?, ?, 1);`,
      generateUUID(),
      userId,
      r.merchant_normalized,
      r.category_id,
      r.amount - tolerance,
      r.amount + tolerance,
      r.frequency,
      expectedDay,
      confidence,
      source,
      r.occurrence_count,
      r.last_seen_date,
      r.is_confirmed === 1 ? r.last_seen_date : null
    );
    seeded++;
  }

  if (seeded > 0) await bumpDataVersion();
  return seeded;
}

function calculateSeedConfidence(occurrenceCount: number): number {
  if (occurrenceCount >= 6) return 0.9;
  if (occurrenceCount >= 4) return 0.8;
  if (occurrenceCount >= 3) return 0.7;
  if (occurrenceCount >= 2) return 0.5;
  return 0.3;
}
