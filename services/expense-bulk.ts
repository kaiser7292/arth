/**
 * Bulk expense operations — v17.5.35
 *
 * Batch-update fields across multiple expenses in one transaction.
 */

import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import { recordEdits } from "@/services/expense-edit-history";
import { logger } from "@/utils/logger";

export interface BulkUpdateFields {
  category_id?: string;
  payment_mode_id?: string;
  account_id?: string;
  merchant_name?: string;
  date?: string;
}

export async function bulkUpdateExpenses(
  expenseIds: string[],
  fields: BulkUpdateFields,
): Promise<number> {
  if (expenseIds.length === 0 || Object.keys(fields).length === 0) return 0;

  const db = getDatabase();
  const setClauses: string[] = [];
  const params: string[] = [];

  if (fields.category_id !== undefined) {
    setClauses.push("category_id = ?");
    params.push(fields.category_id);
  }
  if (fields.payment_mode_id !== undefined) {
    setClauses.push("payment_mode_id = ?");
    params.push(fields.payment_mode_id);
  }
  if (fields.account_id !== undefined) {
    setClauses.push("account_id = ?");
    params.push(fields.account_id);
  }
  if (fields.merchant_name !== undefined) {
    setClauses.push("merchant_name = ?");
    params.push(fields.merchant_name);
  }
  if (fields.date !== undefined) {
    setClauses.push("date = ?");
    params.push(fields.date);
  }

  setClauses.push("updated_at = datetime('now')");

  // Capture old values for edit history before bulk update
  const fieldNames = Object.keys(fields).filter((k) => (fields as Record<string, unknown>)[k] !== undefined);
  const placeholders = expenseIds.map(() => "?").join(",");
  let oldRows: Record<string, Record<string, string | null>>[] = [];
  try {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT id, ${fieldNames.join(", ")} FROM expenses WHERE id IN (${placeholders});`,
      ...expenseIds,
    );
    for (const row of rows) {
      const id = String(row.id);
      const values: Record<string, string | null> = {};
      for (const f of fieldNames) values[f] = row[f] != null ? String(row[f]) : null;
      oldRows.push({ [id]: values });
    }
  } catch (e) {
    logger.warn("bulk edit history capture failed (non-fatal)", e);
  }

  const result = await db.runAsync(
    `UPDATE expenses SET ${setClauses.join(", ")} WHERE id IN (${placeholders});`,
    ...params,
    ...expenseIds,
  );

  // Record edit history for each affected expense
  if (result.changes > 0) {
    await bumpDataVersion();
    try {
      for (const rowMap of oldRows) {
        for (const [id, oldVals] of Object.entries(rowMap)) {
          const changes: Record<string, { old: string | null; new: string | null }> = {};
          for (const f of fieldNames) {
            changes[f] = { old: oldVals[f], new: (fields as Record<string, unknown>)[f] != null ? String((fields as Record<string, unknown>)[f]) : null };
          }
          await recordEdits(id, changes);
        }
      }
    } catch (e) {
      logger.warn("bulk recordEdits failed (non-fatal)", e);
    }
  }
  return result.changes;
}
