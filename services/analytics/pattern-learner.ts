import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { normalizeMerchant } from "@/services/smart-categorizer";
import { bumpDataVersion } from "@/services/settings";
import { THRESHOLDS } from "@/utils/analytics/thresholds";
import type { Classification } from "@/utils/analytics/types";
import type { Expense } from "@/services/expense-types";
import type { ExpenseClassificationRow } from "./classifier";

interface MerchantPattern {
  merchant: string;
  amounts: number[];
  dates: string[];
  categoryId: string | null;
}

export async function detectNewPatterns(
  userId: string,
  expenses: Expense[]
): Promise<number> {
  const db = getDatabase();

  const existing = await db.getAllAsync<{ merchant_normalized: string }>(
    `SELECT merchant_normalized FROM expense_classifications
     WHERE user_id = ? AND is_active = 1;`,
    userId
  );
  const existingMerchants = new Set(existing.map((e) => e.merchant_normalized));

  const patterns = findRepeatMerchants(expenses);
  let detected = 0;

  for (const pattern of patterns) {
    if (existingMerchants.has(pattern.merchant)) continue;
    if (pattern.amounts.length < THRESHOLDS.CLASSIFICATION_MIN_OCCURRENCES) continue;

    const classification = determineClassification(pattern);
    const amountLow = Math.min(...pattern.amounts);
    const amountHigh = Math.max(...pattern.amounts);
    const avgDay = getAverageDay(pattern.dates);
    const frequency = estimateFrequency(pattern.dates);
    const confidence = calculatePatternConfidence(pattern.amounts.length);

    await db.runAsync(
      `INSERT INTO expense_classifications
       (id, user_id, merchant_normalized, category_id, amount_range_low, amount_range_high,
        classification, frequency, expected_day_of_month, confidence, source,
        occurrence_count, last_seen_date, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto_detected', ?, ?, 1);`,
      generateUUID(),
      userId,
      pattern.merchant,
      pattern.categoryId,
      amountLow,
      amountHigh,
      classification,
      frequency,
      avgDay,
      confidence,
      pattern.amounts.length,
      pattern.dates[pattern.dates.length - 1]
    );
    detected++;
  }

  if (detected > 0) await bumpDataVersion();
  return detected;
}

export async function updatePatternConfidence(
  userId: string,
  expenses: Expense[]
): Promise<void> {
  const db = getDatabase();
  const classifications = await db.getAllAsync<ExpenseClassificationRow>(
    `SELECT * FROM expense_classifications WHERE user_id = ? AND is_active = 1;`,
    userId
  );

  for (const cls of classifications) {
    const matches = expenses.filter((e) => {
      const normalized = e.merchant_name ? normalizeMerchant(e.merchant_name) : "";
      if (normalized !== cls.merchant_normalized) return false;
      const tolerance = THRESHOLDS.CLASSIFICATION_AMOUNT_TOLERANCE;
      return (
        e.amount >= cls.amount_range_low * (1 - tolerance) &&
        e.amount <= cls.amount_range_high * (1 + tolerance)
      );
    });

    if (matches.length > 0) {
      const newCount = cls.occurrence_count + matches.length;
      const newConfidence = calculatePatternConfidence(newCount);
      const latestDate = matches.sort((a, b) => b.date.localeCompare(a.date))[0].date;

      await db.runAsync(
        `UPDATE expense_classifications
         SET occurrence_count = ?, confidence = ?, last_seen_date = ?, updated_at = datetime('now')
         WHERE id = ?;`,
        newCount,
        Math.min(newConfidence, cls.source === "user_confirmed" ? 1.0 : 0.95),
        latestDate,
        cls.id
      );
    }
  }
}

export async function deactivateStalePatterns(
  userId: string,
  currentMonth: string
): Promise<number> {
  const db = getDatabase();
  const twoMonthsAgo = getMonthOffset(currentMonth, -2);

  const result = await db.runAsync(
    `UPDATE expense_classifications
     SET is_active = 0, deactivated_reason = 'pattern_stopped', updated_at = datetime('now')
     WHERE user_id = ? AND is_active = 1 AND source = 'auto_detected'
       AND last_seen_date < ? AND confidence < ?;`,
    userId,
    twoMonthsAgo + "-01",
    THRESHOLDS.CLASSIFICATION_CONFIRM_THRESHOLD
  );

  if (result.changes > 0) await bumpDataVersion();
  return result.changes;
}

export async function confirmPattern(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE expense_classifications
     SET source = 'user_confirmed', confidence = 1.0,
         last_confirmed_date = datetime('now'), updated_at = datetime('now')
     WHERE id = ?;`,
    id
  );
  await bumpDataVersion();
}

export async function correctPattern(
  id: string,
  classification: Classification,
  amountLow?: number,
  amountHigh?: number,
  frequency?: string,
  expectedDay?: number
): Promise<void> {
  const db = getDatabase();
  const fields = [
    "source = 'user_corrected'",
    "confidence = 1.0",
    `classification = '${classification}'`,
    "last_confirmed_date = datetime('now')",
    "updated_at = datetime('now')",
  ];
  const values: (string | number | null)[] = [];

  if (amountLow !== undefined) {
    fields.push("amount_range_low = ?");
    values.push(amountLow);
  }
  if (amountHigh !== undefined) {
    fields.push("amount_range_high = ?");
    values.push(amountHigh);
  }
  if (frequency !== undefined) {
    fields.push("frequency = ?");
    values.push(frequency);
  }
  if (expectedDay !== undefined) {
    fields.push("expected_day_of_month = ?");
    values.push(expectedDay);
  }

  values.push(id);

  await db.runAsync(
    `UPDATE expense_classifications SET ${fields.join(", ")} WHERE id = ?;`,
    ...values
  );
  await bumpDataVersion();
}

// ─── Helpers ───

function findRepeatMerchants(expenses: Expense[]): MerchantPattern[] {
  const map = new Map<string, MerchantPattern>();

  for (const e of expenses) {
    if (!e.merchant_name) continue;
    const normalized = normalizeMerchant(e.merchant_name);
    if (!normalized) continue;

    const existing = map.get(normalized);
    if (existing) {
      existing.amounts.push(e.amount);
      existing.dates.push(e.date);
    } else {
      map.set(normalized, {
        merchant: normalized,
        amounts: [e.amount],
        dates: [e.date],
        categoryId: e.category_id,
      });
    }
  }

  return Array.from(map.values()).filter(
    (p) => p.amounts.length >= THRESHOLDS.CLASSIFICATION_MIN_OCCURRENCES
  );
}

function determineClassification(pattern: MerchantPattern): Classification {
  const { amounts } = pattern;
  const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
  const maxDeviation = Math.max(...amounts.map((a) => Math.abs(a - avg) / avg));

  if (maxDeviation <= THRESHOLDS.CLASSIFICATION_AMOUNT_TOLERANCE) return "fixed";
  if (maxDeviation <= 0.5) return "semi_fixed";
  return "variable";
}

function getAverageDay(dates: string[]): number {
  const days = dates.map((d) => new Date(d).getDate());
  return Math.round(days.reduce((s, d) => s + d, 0) / days.length);
}

function estimateFrequency(dates: string[]): string {
  if (dates.length < 2) return "monthly";
  const sorted = [...dates].sort();
  const intervals: number[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const diff = Math.abs(
      (new Date(sorted[i]).getTime() - new Date(sorted[i - 1]).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    intervals.push(diff);
  }

  const avgInterval = intervals.reduce((s, d) => s + d, 0) / intervals.length;

  if (avgInterval <= 10) return "weekly";
  if (avgInterval <= 45) return "monthly";
  if (avgInterval <= 120) return "quarterly";
  return "yearly";
}

function calculatePatternConfidence(occurrences: number): number {
  if (occurrences <= 1) return 0.3;
  if (occurrences === 2) return 0.5;
  if (occurrences === 3) return 0.7;
  if (occurrences >= 4) return 0.9;
  return 0.5;
}

function getMonthOffset(month: string, offset: number): string {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(year, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
