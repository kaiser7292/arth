/**
 * Split-tender purchase groups.
 *
 * A single real-world purchase can be paid across multiple payment sources
 * (e.g. ₹1,500 on a credit card + ₹500 from a wallet for a ₹2,000 bill).
 * Each leg is stored as its own expense row so account balances remain
 * accurate; all legs share a single purchase_group_id so the UI can present
 * them together and duplicate detection can skip siblings.
 *
 * Rules:
 *  - All legs share merchant, date, category, description, and is_right_spend.
 *    Only amount + account_id + payment_mode_id differ per leg.
 *  - Legs are capped at {@link MAX_PURCHASE_GROUP_LEGS}.
 *  - If a group is reduced to a single leg (e.g. one leg deleted from a 2-leg
 *    group), the remaining leg is unlinked and becomes a standalone expense.
 */

import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { createExpense } from "./expense-crud";
import { bumpDataVersion } from "@/services/settings";
import type { CreateExpenseInput, Expense } from "./expense-types";

export const MAX_PURCHASE_GROUP_LEGS = 3;

export interface PurchaseGroupLeg {
  amount: number;
  account_id: string | null;
  payment_mode_id?: string | null;
}

export interface CreateSplitTenderInput {
  /** Shared fields across all legs (same merchant, date, category, etc.) */
  shared: Omit<CreateExpenseInput, "amount" | "account_id" | "payment_mode_id" | "purchase_group_id">;
  /** 2-3 legs, each with its own amount and payment source. */
  legs: PurchaseGroupLeg[];
}

/**
 * Create a split-tender purchase: 2-3 expense rows sharing a
 * purchase_group_id. Returns the generated group ID and the created expense
 * IDs (in the order they were inserted).
 */
export async function createSplitTender(
  input: CreateSplitTenderInput,
): Promise<{ groupId: string; expenseIds: string[] }> {
  if (input.legs.length < 2) {
    throw new Error("A split-tender purchase needs at least 2 legs.");
  }
  if (input.legs.length > MAX_PURCHASE_GROUP_LEGS) {
    throw new Error(
      `A split-tender purchase supports up to ${MAX_PURCHASE_GROUP_LEGS} legs.`,
    );
  }
  for (const leg of input.legs) {
    if (!Number.isFinite(leg.amount) || leg.amount <= 0) {
      throw new Error("Each leg amount must be a positive number.");
    }
  }

  const groupId = generateUUID();
  const expenseIds: string[] = [];
  for (const leg of input.legs) {
    const id = await createExpense({
      ...input.shared,
      amount: leg.amount,
      account_id: leg.account_id,
      payment_mode_id: leg.payment_mode_id ?? undefined,
      purchase_group_id: groupId,
    });
    expenseIds.push(id);
  }
  return { groupId, expenseIds };
}

/**
 * Load every sibling leg that shares the same purchase_group_id as the given
 * expense, excluding the expense itself. Returns [] if the expense is
 * standalone (no group).
 */
export async function getGroupSiblings(expenseId: string): Promise<Expense[]> {
  const db = getDatabase();
  const self = await db.getFirstAsync<{ purchase_group_id: string | null; user_id: string }>(
    "SELECT purchase_group_id, user_id FROM expenses WHERE id = ?;",
    expenseId,
  );
  if (!self?.purchase_group_id) return [];
  return db.getAllAsync<Expense>(
    `SELECT * FROM expenses
     WHERE purchase_group_id = ? AND id != ? AND deleted_at IS NULL
     ORDER BY created_at ASC;`,
    self.purchase_group_id,
    expenseId,
  );
}

/**
 * Unlink an expense from its purchase group. If after removal only one leg
 * remains in the group, that last leg is also unlinked (a single-row "group"
 * is meaningless). Does not delete any expenses.
 */
export async function unlinkFromGroup(expenseId: string): Promise<void> {
  const db = getDatabase();
  const self = await db.getFirstAsync<{ purchase_group_id: string | null }>(
    "SELECT purchase_group_id FROM expenses WHERE id = ?;",
    expenseId,
  );
  if (!self?.purchase_group_id) return;
  const groupId = self.purchase_group_id;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "UPDATE expenses SET purchase_group_id = NULL, updated_at = datetime('now') WHERE id = ?;",
      expenseId,
    );
    const remaining = await db.getAllAsync<{ id: string }>(
      "SELECT id FROM expenses WHERE purchase_group_id = ? AND deleted_at IS NULL;",
      groupId,
    );
    if (remaining.length <= 1) {
      // Drop the group entirely — a 1-leg group is not a split tender.
      await db.runAsync(
        "UPDATE expenses SET purchase_group_id = NULL, updated_at = datetime('now') WHERE purchase_group_id = ?;",
        groupId,
      );
    }
  });
  bumpDataVersion();
}

/**
 * Propagate a shared-field edit (merchant, date, category, description,
 * is_right_spend) to every live sibling in the same purchase group. The
 * caller is responsible for having already updated the leg the user edited;
 * this just fans the change out.
 *
 * Per-leg fields (amount, account_id, payment_mode_id) are NOT propagated —
 * that's the whole point of a split tender.
 */
export async function propagateSharedEdit(
  expenseId: string,
  patch: {
    merchant_name?: string | null;
    date?: string;
    category_id?: string | null;
    description?: string | null;
    is_right_spend?: number | null;
  },
): Promise<void> {
  const db = getDatabase();
  const self = await db.getFirstAsync<{ purchase_group_id: string | null }>(
    "SELECT purchase_group_id FROM expenses WHERE id = ?;",
    expenseId,
  );
  if (!self?.purchase_group_id) return;

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.merchant_name !== undefined) {
    fields.push("merchant_name = ?");
    values.push(patch.merchant_name);
  }
  if (patch.date !== undefined) {
    fields.push("date = ?");
    values.push(patch.date);
  }
  if (patch.category_id !== undefined) {
    fields.push("category_id = ?");
    values.push(patch.category_id);
  }
  if (patch.description !== undefined) {
    fields.push("description = ?");
    values.push(patch.description);
  }
  if (patch.is_right_spend !== undefined) {
    fields.push("is_right_spend = ?");
    values.push(patch.is_right_spend);
  }
  if (fields.length === 0) return;

  fields.push("updated_at = datetime('now')");
  values.push(self.purchase_group_id, expenseId);

  await db.runAsync(
    `UPDATE expenses SET ${fields.join(", ")}
     WHERE purchase_group_id = ? AND id != ? AND deleted_at IS NULL;`,
    ...values,
  );
  bumpDataVersion();
}

/**
 * Convert a standalone expense into a split-tender purchase by adding extra
 * payment legs. The target expense becomes the first leg of a new group; the
 * {@link extraLegs} each become their own expense rows sharing the new
 * purchase_group_id and the target's shared fields (merchant, date, category,
 * description, is_right_spend, user_id).
 *
 * Fails if the target is already part of a purchase group — call
 * {@link addLegToExistingGroup} instead for that case.
 */
export async function convertToSplitTender(
  targetExpenseId: string,
  extraLegs: PurchaseGroupLeg[],
): Promise<{ groupId: string; newExpenseIds: string[] }> {
  if (extraLegs.length < 1) {
    throw new Error("At least one extra leg is required to convert to a split purchase.");
  }

  const db = getDatabase();
  const target = await db.getFirstAsync<{
    user_id: string;
    purchase_group_id: string | null;
    merchant_name: string | null;
    description: string | null;
    category_id: string | null;
    date: string;
    is_right_spend: number | null;
  }>(
    `SELECT user_id, purchase_group_id, merchant_name, description, category_id, date, is_right_spend
     FROM expenses WHERE id = ?;`,
    targetExpenseId,
  );
  if (!target) {
    throw new Error("Expense not found.");
  }
  if (target.purchase_group_id) {
    throw new Error("Expense is already part of a split purchase.");
  }
  // Total legs = 1 (target) + extraLegs — cap still 3
  if (1 + extraLegs.length > MAX_PURCHASE_GROUP_LEGS) {
    throw new Error(
      `A split-tender purchase supports up to ${MAX_PURCHASE_GROUP_LEGS} legs.`,
    );
  }
  for (const leg of extraLegs) {
    if (!Number.isFinite(leg.amount) || leg.amount <= 0) {
      throw new Error("Each leg amount must be a positive number.");
    }
  }

  const groupId = generateUUID();
  const newExpenseIds: string[] = [];
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "UPDATE expenses SET purchase_group_id = ?, updated_at = datetime('now') WHERE id = ?;",
      groupId,
      targetExpenseId,
    );
    for (const leg of extraLegs) {
      const id = await createExpense({
        user_id: target.user_id,
        amount: leg.amount,
        description: target.description ?? undefined,
        merchant_name: target.merchant_name ?? undefined,
        category_id: target.category_id ?? undefined,
        payment_mode_id: leg.payment_mode_id ?? undefined,
        account_id: leg.account_id,
        date: target.date,
        is_right_spend: target.is_right_spend,
        purchase_group_id: groupId,
      });
      newExpenseIds.push(id);
    }
  });
  bumpDataVersion();
  return { groupId, newExpenseIds };
}

/**
 * Add one more leg to an expense that's already part of a split-tender group.
 * Inherits the group's shared fields from the existing expense.
 */
export async function addLegToExistingGroup(
  anyLegInGroupId: string,
  newLeg: PurchaseGroupLeg,
): Promise<string> {
  if (!Number.isFinite(newLeg.amount) || newLeg.amount <= 0) {
    throw new Error("Leg amount must be a positive number.");
  }

  const db = getDatabase();
  const anchor = await db.getFirstAsync<{
    user_id: string;
    purchase_group_id: string | null;
    merchant_name: string | null;
    description: string | null;
    category_id: string | null;
    date: string;
    is_right_spend: number | null;
  }>(
    `SELECT user_id, purchase_group_id, merchant_name, description, category_id, date, is_right_spend
     FROM expenses WHERE id = ?;`,
    anyLegInGroupId,
  );
  if (!anchor) {
    throw new Error("Expense not found.");
  }
  if (!anchor.purchase_group_id) {
    throw new Error("Expense is not part of a split purchase. Use convertToSplitTender instead.");
  }

  const countRow = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) as n FROM expenses WHERE purchase_group_id = ? AND deleted_at IS NULL;",
    anchor.purchase_group_id,
  );
  const currentCount = countRow?.n ?? 0;
  if (currentCount >= MAX_PURCHASE_GROUP_LEGS) {
    throw new Error(
      `This purchase already has the maximum of ${MAX_PURCHASE_GROUP_LEGS} payment sources.`,
    );
  }

  const newId = await createExpense({
    user_id: anchor.user_id,
    amount: newLeg.amount,
    description: anchor.description ?? undefined,
    merchant_name: anchor.merchant_name ?? undefined,
    category_id: anchor.category_id ?? undefined,
    payment_mode_id: newLeg.payment_mode_id ?? undefined,
    account_id: newLeg.account_id,
    date: anchor.date,
    is_right_spend: anchor.is_right_spend,
    purchase_group_id: anchor.purchase_group_id,
  });
  bumpDataVersion();
  return newId;
}
