/**
 * Expense Edit History — v17.5.38
 *
 * Records field-level changes when an expense is updated. Each edit creates
 * one row per changed field. Undo reverts the field to its old_value if safe.
 *
 * Guardrails:
 *   - Undo checks if the field's current value still matches new_value
 *     (another edit in between = stale, undo blocked)
 *   - Undo on amount triggers balance recompute warning
 *   - Undo on date with linked reminder/forecast is blocked (suggests manual fix)
 *   - Deleted/soft-deleted expenses cannot be undone
 */

import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import { logger } from "@/utils/logger";

export interface EditHistoryEntry {
  id: string;
  expense_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  edited_at: string;
  undone: boolean;
  merchant_name?: string | null;
  amount?: number;
}

export interface UndoResult {
  success: boolean;
  message: string;
}

function generateId(): string {
  return `eh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Record field-level edits. Called from updateExpense / bulkUpdateExpenses.
 * @param expenseId The expense that was edited
 * @param changes Map of field_name → { old, new } values
 */
export async function recordEdits(
  expenseId: string,
  changes: Record<string, { old: string | null; new: string | null }>,
): Promise<void> {
  const db = getDatabase();
  const entries = Object.entries(changes);
  if (entries.length === 0) return;

  for (const [field, { old: oldVal, new: newVal }] of entries) {
    if (oldVal === newVal) continue;
    await db.runAsync(
      `INSERT INTO expense_edit_history (id, expense_id, field_name, old_value, new_value)
       VALUES (?, ?, ?, ?, ?);`,
      generateId(), expenseId, field, oldVal, newVal,
    );
  }
}

/**
 * Get edit history for a single expense (most recent first).
 */
export async function getEditHistory(expenseId: string): Promise<EditHistoryEntry[]> {
  const db = getDatabase();
  return db.getAllAsync<EditHistoryEntry>(
    `SELECT h.*, e.merchant_name, e.amount FROM expense_edit_history h
     LEFT JOIN expenses e ON e.id = h.expense_id
     WHERE h.expense_id = ? AND h.undone = 0
     ORDER BY h.edited_at DESC;`,
    expenseId,
  );
}

/**
 * Get recent edit history across all expenses (for audit log screen).
 */
export async function getRecentEdits(limit = 100): Promise<EditHistoryEntry[]> {
  const db = getDatabase();
  return db.getAllAsync<EditHistoryEntry>(
    `SELECT h.*, e.merchant_name, e.amount FROM expense_edit_history h
     LEFT JOIN expenses e ON e.id = h.expense_id
     WHERE h.undone = 0
     ORDER BY h.edited_at DESC
     LIMIT ?;`,
    limit,
  );
}

const FIELD_LABELS: Record<string, string> = {
  category_id: "Category",
  payment_mode_id: "Payment Mode",
  account_id: "Account",
  merchant_name: "Merchant",
  date: "Date",
  amount: "Amount",
  description: "Description",
  is_right_spend: "Avoidability",
};

export function getFieldLabel(fieldName: string): string {
  return FIELD_LABELS[fieldName] ?? fieldName;
}

/**
 * Undo a specific edit. Reverts the field to its old value.
 *
 * Guardrails:
 *   1. Expense must still exist and not be deleted
 *   2. Field's current value must still be new_value (no intervening edit)
 *   3. Date undo blocked if expense has fulfills_rule_id (would desync reminder)
 *   4. Amount undo allowed but caller should warn about balance impact
 */
export async function undoEdit(editId: string): Promise<UndoResult> {
  const db = getDatabase();

  const edit = await db.getFirstAsync<{
    id: string;
    expense_id: string;
    field_name: string;
    old_value: string | null;
    new_value: string | null;
    undone: number;
  }>(
    `SELECT * FROM expense_edit_history WHERE id = ?;`,
    editId,
  );

  if (!edit) return { success: false, message: "Edit record not found." };
  if (edit.undone) return { success: false, message: "This edit was already undone." };

  const expense = await db.getFirstAsync<{
    id: string;
    deleted_at: string | null;
    fulfills_rule_id: string | null;
  }>(
    `SELECT id, deleted_at, fulfills_rule_id FROM expenses WHERE id = ?;`,
    edit.expense_id,
  );

  if (!expense) return { success: false, message: "Expense no longer exists." };
  if (expense.deleted_at) return { success: false, message: "Cannot undo - expense is deleted. Restore it first." };

  // Check for linked reminder conflict on date undo
  if (edit.field_name === "date" && expense.fulfills_rule_id) {
    return { success: false, message: "Cannot undo date change - this expense is linked to a reminder. Unlink it first." };
  }

  // Verify current value matches new_value (no intervening edit)
  const currentRow = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT ${edit.field_name} FROM expenses WHERE id = ?;`,
    edit.expense_id,
  );
  const currentValue = currentRow ? String(currentRow[edit.field_name] ?? "") : null;
  const expectedValue = edit.new_value ?? "";

  if (currentValue !== expectedValue) {
    return { success: false, message: `Cannot undo - ${getFieldLabel(edit.field_name)} was changed again after this edit.` };
  }

  // Perform the undo
  await db.runAsync(
    `UPDATE expenses SET ${edit.field_name} = ?, updated_at = datetime('now') WHERE id = ?;`,
    edit.old_value,
    edit.expense_id,
  );
  await db.runAsync(
    `UPDATE expense_edit_history SET undone = 1 WHERE id = ?;`,
    editId,
  );

  await bumpDataVersion();
  return { success: true, message: `${getFieldLabel(edit.field_name)} reverted.` };
}
