import { getDatabase } from "@/database";
import { normalizeMerchant } from "@/services/smart-categorizer";
import { THRESHOLDS } from "@/utils/analytics/thresholds";
import type { Classification } from "@/utils/analytics/types";
import type { Expense } from "@/services/expense-types";

export interface ExpenseClassificationRow {
  id: string;
  user_id: string;
  merchant_normalized: string;
  category_id: string | null;
  amount_range_low: number;
  amount_range_high: number;
  classification: Classification;
  frequency: string | null;
  expected_day_of_month: number | null;
  confidence: number;
  source: "auto_detected" | "user_confirmed" | "user_corrected";
  occurrence_count: number;
  last_seen_date: string;
  last_confirmed_date: string | null;
  is_active: number;
  deactivated_reason: string | null;
  created_at: string;
  updated_at: string;
}

export async function getActiveClassifications(
  userId: string
): Promise<ExpenseClassificationRow[]> {
  const db = getDatabase();
  return db.getAllAsync<ExpenseClassificationRow>(
    `SELECT * FROM expense_classifications
     WHERE user_id = ? AND is_active = 1
     ORDER BY confidence DESC, occurrence_count DESC;`,
    userId
  );
}

export function classifyExpense(
  expense: Expense,
  classifications: ExpenseClassificationRow[]
): Classification {
  const normalized = expense.merchant_name
    ? normalizeMerchant(expense.merchant_name)
    : "";

  if (!normalized) return "variable";

  const match = classifications.find((c) => {
    if (c.merchant_normalized !== normalized) return false;
    const tolerance = THRESHOLDS.CLASSIFICATION_AMOUNT_TOLERANCE;
    const low = c.amount_range_low * (1 - tolerance);
    const high = c.amount_range_high * (1 + tolerance);
    return expense.amount >= low && expense.amount <= high;
  });

  if (match) return match.classification;

  if (isInfrequentLargeTransaction(expense, classifications)) return "fixed";

  return "variable";
}

export function getFixedClassifications(
  classifications: ExpenseClassificationRow[]
): ExpenseClassificationRow[] {
  return classifications.filter(
    (c) => c.classification === "fixed" || c.classification === "semi_fixed"
  );
}

export function matchesClassification(
  expense: Expense,
  classification: ExpenseClassificationRow
): boolean {
  const normalized = expense.merchant_name
    ? normalizeMerchant(expense.merchant_name)
    : "";

  if (classification.merchant_normalized !== normalized) return false;

  const tolerance = THRESHOLDS.CLASSIFICATION_AMOUNT_TOLERANCE;
  const low = classification.amount_range_low * (1 - tolerance);
  const high = classification.amount_range_high * (1 + tolerance);

  return expense.amount >= low && expense.amount <= high;
}

function isInfrequentLargeTransaction(
  expense: Expense,
  classifications: ExpenseClassificationRow[]
): boolean {
  const categoryClassifications = classifications.filter(
    (c) => c.category_id === expense.category_id && c.classification !== "variable"
  );
  if (categoryClassifications.length === 0) return false;

  const avgAmount =
    categoryClassifications.reduce(
      (sum, c) => sum + (c.amount_range_low + c.amount_range_high) / 2,
      0
    ) / categoryClassifications.length;

  return expense.amount > avgAmount * THRESHOLDS.CREEP_SPIKE_MULTIPLIER;
}

export async function updateClassification(
  id: string,
  updates: Partial<{
    classification: Classification;
    amount_range_low: number;
    amount_range_high: number;
    frequency: string;
    expected_day_of_month: number;
    confidence: number;
    source: "user_confirmed" | "user_corrected";
    is_active: number;
    deactivated_reason: string;
    last_confirmed_date: string;
  }>
): Promise<void> {
  const db = getDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return;

  fields.push("updated_at = datetime('now')");
  values.push(id);

  await db.runAsync(
    `UPDATE expense_classifications SET ${fields.join(", ")} WHERE id = ?;`,
    ...values
  );
}
