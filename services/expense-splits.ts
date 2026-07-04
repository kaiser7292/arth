import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import { logger } from "@/utils/logger";
import { generateUUID } from "@/utils/uuid";
import { createExpense } from "./expense-crud";
import { getRefundedAmount } from "./expense-effective-amount";
import { removeMultiSplit } from "./expense-multi-split";
import { getExpenseById } from "./expense-queries";
import type { CreateExpenseInput, SplitConfig } from "./expense-types";

/**
 * Remove split from an expense — restores original amount and deletes hisaab entry.
 */
export async function removeSplit(expenseId: string): Promise<void> {
  const db = getDatabase();
  const expense = await getExpenseById(expenseId);
  if (!expense || !expense.split_original_amount || !expense.split_hisaab_entry_id) return;

  await db.withTransactionAsync(async () => {
    // Restore expense to original amount and clear split fields
    await db.runAsync(
      `UPDATE expenses
       SET amount = ?, split_original_amount = NULL, split_person_id = NULL, split_pct = NULL, split_hisaab_entry_id = NULL,
           split_mode = NULL, split_exact_amount = NULL, updated_at = datetime('now')
       WHERE id = ?;`,
      expense.split_original_amount,
      expenseId,
    );

    // Delete the linked hisaab entry
    await db.runAsync(
      `DELETE FROM hisaab_entries WHERE id = ?;`,
      expense.split_hisaab_entry_id,
    );
  });
  bumpDataVersion();
}

/**
 * Delete a split expense — also deletes the linked hisaab entry.
 */
export async function deleteSplitExpense(expenseId: string): Promise<void> {
  const db = getDatabase();
  const expense = await getExpenseById(expenseId);
  if (!expense) return;

  await db.withTransactionAsync(async () => {
    // Clear the FK on expense FIRST, then delete the hisaab entry
    if (expense.split_hisaab_entry_id) {
      await db.runAsync(
        `UPDATE expenses SET split_hisaab_entry_id = NULL WHERE id = ?;`,
        expenseId,
      );
      await db.runAsync(
        `DELETE FROM hisaab_entries WHERE id = ?;`,
        expense.split_hisaab_entry_id,
      );
    }

    // Delete multi-split records and their linked hisaab entries
    const multiSplitEntries = await db.getAllAsync<{ hisaab_entry_id: string | null }>(
      "SELECT hisaab_entry_id FROM expense_splits WHERE expense_id = ?;",
      expenseId,
    );
    for (const s of multiSplitEntries) {
      if (s.hisaab_entry_id) {
        await db.runAsync("DELETE FROM hisaab_entries WHERE id = ?;", s.hisaab_entry_id);
      }
    }
    await db.runAsync("DELETE FROM expense_splits WHERE expense_id = ?;", expenseId);

    // Soft-delete the expense
    await db.runAsync(
      `UPDATE expenses SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?;`,
      expenseId,
    );
  });
  bumpDataVersion();
}

// ═══════════════════════════════════════════════
// Unified Split (V2) — Splitwise-inspired
// ═══════════════════════════════════════════════

/**
 * Compute split amounts from a total and config.
 * Returns what to record in the user's budget and hisaab.
 */
export function computeSplitAmounts(
  totalAmount: number,
  config: SplitConfig,
): {
  myBudgetAmount: number;
  hisaabAmount: number;
  hisaabType: "debit" | "credit";
  splitPct: number;
} {
  let otherPersonShare: number;

  switch (config.splitMode) {
    case "equal":
      otherPersonShare = Math.round((totalAmount / 2) * 100) / 100;
      break;
    case "they_owe_full":
      otherPersonShare = totalAmount;
      break;
    case "i_owe_full":
      otherPersonShare = 0;
      break;
    case "exact":
      otherPersonShare = config.exactAmount ?? 0;
      break;
    case "percentage":
      otherPersonShare =
        Math.round(totalAmount * ((config.percentage ?? 0) / 100) * 100) / 100;
      break;
  }

  const myShare = Math.round((totalAmount - otherPersonShare) * 100) / 100;
  const splitPct =
    totalAmount > 0 ? Math.round((myShare / totalAmount) * 100) : 100;

  if (config.paidBy === "me") {
    return {
      myBudgetAmount: myShare,
      hisaabAmount: otherPersonShare,
      hisaabType: "debit",
      splitPct,
    };
  } else {
    return {
      myBudgetAmount: myShare,
      hisaabAmount: myShare,
      hisaabType: "credit",
      splitPct,
    };
  }
}

/**
 * Split a NEW expense: creates the expense + hisaab entry in one transaction.
 * Returns the expense ID.
 */
export async function splitNewExpense(
  input: CreateExpenseInput,
  totalAmount: number,
  config: SplitConfig,
): Promise<string> {
  const { myBudgetAmount, hisaabAmount, hisaabType, splitPct } =
    computeSplitAmounts(totalAmount, config);

  // No hisaab entry needed if other person's share is 0
  if (hisaabAmount === 0) {
    return createExpense({ ...input, amount: totalAmount });
  }

  const db = getDatabase();
  const expenseId = generateUUID();
  const hisaabEntryId = generateUUID();
  // v15.13.1: persist the original split intent so edits can reconstruct it
  // exactly instead of degrading to a percentage approximation.
  const splitMode = config.splitMode;
  const splitExactAmount =
    config.splitMode === "exact" && typeof config.exactAmount === "number"
      ? config.exactAmount
      : null;

  await db.withTransactionAsync(async () => {
    // 1. Insert expense first (without hisaab link) so the FK from hisaab_entries.linked_expense_id is valid
    const now = new Date().toISOString(); // Local time in ISO format
    await db.runAsync(
      `INSERT INTO expenses (id, user_id, amount, currency, description, merchant_name, category_id, payment_mode_id, account_id, date, transaction_time, is_right_spend, source, status, nature, split_original_amount, split_person_id, split_pct, split_hisaab_entry_id, split_mode, split_exact_amount, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'approved', 'realized', ?, ?, ?, NULL, ?, ?, ?);`,
      expenseId,
      input.user_id,
      myBudgetAmount,
      input.currency ?? "INR",
      input.description ?? null,
      input.merchant_name ?? null,
      input.category_id ?? null,
      input.payment_mode_id ?? null,
      input.account_id ?? null,
      input.date,
      input.transaction_time ?? "00:00:00",
      input.is_right_spend ?? null,
      totalAmount,
      config.personId,
      splitPct,
      splitMode,
      splitExactAmount,
      now,
    );

    // 2. Insert hisaab entry (linked_expense_id now valid)
    const entryNow = new Date().toISOString(); // Local time in ISO format
    await db.runAsync(
      `INSERT INTO hisaab_entries (id, hisaab_person_id, amount, description, date, type, category_id, merchant_name, linked_expense_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      hisaabEntryId,
      config.personId,
      hisaabAmount,
      input.description ?? null,
      input.date,
      hisaabType,
      input.category_id ?? null,
      input.merchant_name ?? null,
      expenseId,
      entryNow,
    );

    // 3. Update expense with hisaab entry link
    await db.runAsync(
      `UPDATE expenses SET split_hisaab_entry_id = ? WHERE id = ?;`,
      hisaabEntryId,
      expenseId,
    );
  });

  bumpDataVersion();
  return expenseId;
}

/**
 * Split an EXISTING expense: updates the expense and creates a hisaab entry.
 * If the expense already has a split, removes the old one first.
 */
export async function splitExistingExpense(
  expenseId: string,
  config: SplitConfig,
): Promise<void> {
  const db = getDatabase();
  const expense = await getExpenseById(expenseId);
  if (!expense) return;

  // If already split, remove old split first
  if (expense.split_hisaab_entry_id) {
    await removeSplit(expenseId);
    // Re-fetch after removal to get original amount
    const refreshed = await getExpenseById(expenseId);
    if (!refreshed) return;
    Object.assign(expense, refreshed);
  }

  const totalAmount = expense.split_original_amount ?? expense.amount;
  const { myBudgetAmount, hisaabAmount, hisaabType, splitPct } =
    computeSplitAmounts(totalAmount, config);

  if (hisaabAmount === 0) return;

  const hisaabEntryId = generateUUID();

  await db.withTransactionAsync(async () => {
    // 1. Insert hisaab entry (expense already exists, so linked_expense_id FK is valid)
    const now = new Date().toISOString(); // Local time in ISO format
    await db.runAsync(
      `INSERT INTO hisaab_entries (id, hisaab_person_id, amount, description, date, type, category_id, merchant_name, linked_expense_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      hisaabEntryId,
      config.personId,
      hisaabAmount,
      expense.description ?? null,
      expense.date,
      hisaabType,
      expense.category_id ?? null,
      expense.merchant_name ?? null,
      expenseId,
      now,
    );

    // 2. Update expense with split details + hisaab link (hisaab entry now exists, so FK is valid)
    // v15.13.1: also persist split_mode + split_exact_amount so edits can
    // reconstruct the original intent instead of degrading to percentage-only.
    const splitMode = config.splitMode;
    const splitExactAmount =
      config.splitMode === "exact" && typeof config.exactAmount === "number"
        ? config.exactAmount
        : null;
    await db.runAsync(
      `UPDATE expenses
       SET amount = ?, split_original_amount = ?, split_person_id = ?, split_pct = ?, split_hisaab_entry_id = ?,
           split_mode = ?, split_exact_amount = ?, updated_at = datetime('now')
       WHERE id = ?;`,
      myBudgetAmount,
      totalAmount,
      config.personId,
      splitPct,
      hisaabEntryId,
      splitMode,
      splitExactAmount,
      expenseId,
    );
  });
  bumpDataVersion();
}

// ═══════════════════════════════════════════════
// Refund Side-Effects
// ═══════════════════════════════════════════════

/**
 * Called after a refund credit is saved or approved for a split expense.
 *
 * For percentage / equal / they_owe_full / i_owe_full splits the other
 * person's share of the refund is computed automatically from the split ratio.
 *
 * For exact-amount single splits the caller must supply `otherPersonRefundShare`
 * (how much of this refund belongs to the other person). For multi-person splits
 * `otherPersonRefundShares` is a map of hisaab_entry_id → their refund share.
 *
 * Full refund (totalRefunds ≥ expense.amount): removes the split entirely.
 * Partial refund: reduces each hisaab entry by that person's share of the refund.
 * No new hisaab entries are created.
 *
 * Safe to call for non-split expenses — exits early if no split is present.
 */
export async function adjustSplitAfterRefund(
  originalExpenseId: string,
  thisRefundAmount: number,
  otherPersonRefundShare?: number,
  otherPersonRefundShares?: Record<string, number>,
): Promise<void> {
  logger.info("adjustSplitAfterRefund called", { originalExpenseId, thisRefundAmount, otherPersonRefundShare });
  const expense = await getExpenseById(originalExpenseId);
  if (!expense) {
    logger.warn("adjustSplitAfterRefund: expense not found", { originalExpenseId });
    return;
  }

  const originalTotal = expense.split_original_amount;
  if (!originalTotal) {
    logger.warn("adjustSplitAfterRefund: expense not split", { originalExpenseId });
    return;
  }

  const totalRefunds = await getRefundedAmount(originalExpenseId);
  logger.info("adjustSplitAfterRefund: split data", { originalTotal, totalRefunds, userShare: expense.amount, splitPct: expense.split_pct, splitMode: expense.split_mode });
  if (totalRefunds <= 0) return;

  const userShare = expense.amount;
  // Full refund means the entire original amount was refunded, not just the user's share.
  // For they_owe_full (userShare=0) or i_owe_full (userShare=originalTotal), using userShare
  // would incorrectly trigger full refund on any refund or never trigger it.
  const isFullRefund = totalRefunds + 0.01 >= originalTotal;
  logger.info("adjustSplitAfterRefund: full refund check", { totalRefunds, userShare, originalTotal, isFullRefund });

  if (isFullRefund) {
    if (expense.split_hisaab_entry_id) {
      await removeSplit(originalExpenseId);
    } else {
      await removeMultiSplit(originalExpenseId);
    }
    return;
  }

  const db = getDatabase();

  if (expense.split_hisaab_entry_id) {
    // Single-person split.
    const currentEntry = await db.getFirstAsync<{ amount: number }>(
      `SELECT amount FROM hisaab_entries WHERE id = ?;`,
      expense.split_hisaab_entry_id,
    );
    if (!currentEntry) {
      logger.warn("adjustSplitAfterRefund: hisaab entry not found", { hisaabEntryId: expense.split_hisaab_entry_id });
      return;
    }
    logger.info("adjustSplitAfterRefund: current hisaab entry", { currentAmount: currentEntry.amount });

    let otherShare: number;
    const splitMode = expense.split_mode as string | null;
    if (splitMode === 'exact') {
      // Caller must provide the other person's share of this refund.
      otherShare = otherPersonRefundShare ?? 0;
      logger.info("adjustSplitAfterRefund: exact split, using provided share", { otherShare });
    } else {
      // Percentage / equal / they_owe_full / i_owe_full:
      // compute their proportion from the original split ratio.
      // use split_pct directly: other person's share = refund × (1 - splitPct/100)
      const otherPct = 1 - (expense.split_pct ?? 0) / 100;
      otherShare = Math.round(thisRefundAmount * otherPct * 100) / 100;
      logger.info("adjustSplitAfterRefund: percentage split computed", { splitMode, splitPct: expense.split_pct, otherPct, thisRefundAmount, otherShare });
    }

    const newAmount = Math.max(0, Math.round((currentEntry.amount - otherShare) * 100) / 100);
    logger.info("adjustSplitAfterRefund: updating hisaab entry", { currentAmount: currentEntry.amount, otherShare, newAmount });
    if (newAmount <= 0) {
      logger.info("adjustSplitAfterRefund: removing split (new amount <= 0)");
      await removeSplit(originalExpenseId);
      return;
    }

    // Only update the hisaab entry (what the other person owes).
    // The credit entry for the refund already handles the CC balance correction —
    // modifying expense.amount / split_original_amount here would double-count the
    // refund in the ledger balance (COALESCE(split_original_amount, amount)).
    await db.runAsync(
      `UPDATE hisaab_entries SET amount = ?, updated_at = datetime('now') WHERE id = ?;`,
      newAmount,
      expense.split_hisaab_entry_id,
    );
    logger.info("adjustSplitAfterRefund: hisaab entry updated", { newAmount });
  } else {
    // Multi-person split — caller supplies a map of hisaab_entry_id → refund share.
    const splits = await db.getAllAsync<{ amount: number; hisaab_entry_id: string | null }>(
      `SELECT amount, hisaab_entry_id FROM expense_splits WHERE expense_id = ?;`,
      originalExpenseId,
    );

    // Only update hisaab entries (what each person owes).
    // The credit entry already handles the CC balance — don't touch expense amounts.
    await db.withTransactionAsync(async () => {
      for (const split of splits) {
        if (!split.hisaab_entry_id) continue;
        const personRefund = otherPersonRefundShares?.[split.hisaab_entry_id] ?? 0;
        const newAmount = Math.max(0, Math.round((split.amount - personRefund) * 100) / 100);
        if (newAmount <= 0) {
          await db.runAsync(`DELETE FROM hisaab_entries WHERE id = ?;`, split.hisaab_entry_id);
          await db.runAsync(`DELETE FROM expense_splits WHERE hisaab_entry_id = ?;`, split.hisaab_entry_id);
        } else {
          await db.runAsync(
            `UPDATE hisaab_entries SET amount = ?, updated_at = datetime('now') WHERE id = ?;`,
            newAmount,
            split.hisaab_entry_id,
          );
        }
      }
    });
    logger.info("adjustSplitAfterRefund: multi-split hisaab entries updated");
  }

  bumpDataVersion();
}
