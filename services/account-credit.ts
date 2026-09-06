/**
 * Account Credit Service
 *
 * Credits are stored in the `expenses` table with nature='credit'.
 * This module provides the CRUD API used by the account ledger UI and
 * manual-add flow. All operations are scoped to nature='credit' rows.
 *
 * Migration 005 moved legacy `account_credits` rows into `expenses`; the old
 * table is kept until a later cleanup migration.
 */

import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import { round2 } from "@/utils/math";
import { generateUUID } from "@/utils/uuid";

export interface AccountCredit {
  id: string;
  account_id: string;
  user_id: string;
  amount: number;
  description: string | null;
  date: string;
  source: "manual" | "sms_auto";
  /**
   * v15.13.1: if this credit row is an SMS-detected refund, points at the
   * original expense being refunded. Used by the account-ledger UI to deep-
   * link a refund row to its originating expense.
   */
  refund_of_expense_id: string | null;
  /** v15.12.1: full SMS body preserved for SMS-detected credits */
  raw_source_text: string | null;
  /** v15.12.1: DLT sender ID of the originating SMS */
  source_sms_address: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Add a credit transaction to an account.
 * Creates an `expenses` row with nature='credit' and status='approved'.
 */
export async function addCredit(params: {
  accountId: string;
  userId: string;
  amount: number;
  description: string;
  date: string;
  source?: "manual" | "sms_auto";
}): Promise<string> {
  const db = getDatabase();
  const id = generateUUID();
  const now = new Date().toISOString(); // Local time in ISO format
  await db.runAsync(
    `INSERT INTO expenses (id, user_id, amount, currency, description, date, transaction_time, nature, source, status, account_id, created_at)
     VALUES (?, ?, ?, 'INR', ?, ?, '00:00:00', 'credit', ?, 'approved', ?, ?);`,
    id,
    params.userId,
    round2(params.amount),
    params.description,
    params.date,
    params.source ?? "manual",
    params.accountId,
    now,
  );

  await bumpDataVersion();
  return id;
}

/**
 * Get individual credit entries for an account in a date range.
 */
export async function getCreditsForMonth(
  accountId: string,
  startDate: string,
  endDate: string,
): Promise<AccountCredit[]> {
  const db = getDatabase();
  return db.getAllAsync<AccountCredit>(
    // v15.13.1: include refund_of_expense_id so the ledger UI can render a
    // "refund of …" link back to the originating expense when the credit is
    // an SMS-detected refund. Applies uniformly to CC, savings, wallets,
    // loans, demat — every account type that goes through this loader.
    // v15.12.1: include raw_source_text and source_sms_address for source SMS modal
    `SELECT id, account_id, user_id, amount, description, date, source,
            refund_of_expense_id, raw_source_text, source_sms_address,
            created_at, updated_at, deleted_at
     FROM expenses
     WHERE account_id = ? AND deleted_at IS NULL
       AND nature = 'credit' AND status = 'approved'
       -- A credit reclassified as a transfer is represented by the transfer row. Without
       -- this the ledger listed BOTH, and the balance counted the amount twice.
       AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
       AND date >= ? AND date <= ?
     ORDER BY date DESC;`,
    accountId,
    startDate,
    endDate,
  );
}

/**
 * Update an existing credit entry (amount, description, date).
 */
export async function updateCredit(
  creditId: string,
  params: { amount: number; description: string; date: string },
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE expenses
     SET amount = ?, description = ?, date = ?, updated_at = datetime('now')
     WHERE id = ? AND nature = 'credit' AND deleted_at IS NULL;`,
    round2(params.amount),
    params.description,
    params.date,
    creditId,
  );
  // v16.0.6 — if this credit is linked as a hisaab settlement, mirror the
  // new amount + date onto the hisaab entry. Before this, editing the
  // credit left the settlement row with stale amount/date; the hisaab
  // ledger would show the old value until the user unlinked + relinked.
  await syncSettlementLinkedHisaabEntry(creditId, {
    amount: round2(params.amount),
    date: params.date,
  });
  await bumpDataVersion();
}

/**
 * v16.0.6 — keep hisaab entries in sync with the expense/credit they
 * reference. Two cases:
 *
 *  1. DATE — every linked hisaab row mirrors the source date. Applies
 *     uniformly to split debits, split credits, and settlement rows.
 *     Before this, editing the date on a split expense OR a settlement-
 *     linked credit left the hisaab row's date stale; the only way to
 *     refresh was unlink + relink (or split rebuild).
 *
 *  2. AMOUNT — mirror only for `type='settlement'` rows. Those are 1:1
 *     with the credit (one credit, one settlement hisaab row). Split
 *     rows intentionally have their own per-leg amounts that are
 *     managed by the split-rebuild path when the total changes, so
 *     this helper stays out of that.
 *
 * Safe to call with empty patches (no-op).
 */
export async function syncSettlementLinkedHisaabEntry(
  expenseOrCreditId: string,
  patch: { amount?: number; date?: string; description?: string },
): Promise<void> {
  if (patch.amount === undefined && patch.date === undefined && patch.description === undefined) return;
  const db = getDatabase();

  // Pass 1 — date mirrors to every linked hisaab row (split + settlement).
  if (patch.date !== undefined) {
    await db.runAsync(
      `UPDATE hisaab_entries
       SET date = ?, updated_at = datetime('now')
       WHERE linked_expense_id = ?;`,
      patch.date,
      expenseOrCreditId,
    );
  }

  // Pass 2 — amount only to settlement rows (1:1 with the credit).
  if (patch.amount !== undefined) {
    await db.runAsync(
      `UPDATE hisaab_entries
       SET amount = ?, updated_at = datetime('now')
       WHERE linked_expense_id = ? AND type = 'settlement';`,
      patch.amount,
      expenseOrCreditId,
    );
  }

  // Pass 3 — description sync with precedence:
  //   Multi-split entries that have their own "What for" description keep it.
  //   Only update entries where description is null/empty (inheriting from expense).
  //   Settlement + single-split entries always sync (they don't have a separate "What for").
  if (patch.description !== undefined) {
    const expenseSplitIds = await db.getAllAsync<{ hisaab_entry_id: string }>(
      `SELECT hisaab_entry_id FROM expense_splits WHERE expense_id = ? AND hisaab_entry_id IS NOT NULL;`,
      expenseOrCreditId,
    );
    const multiSplitEntryIds = new Set(expenseSplitIds.map((r) => r.hisaab_entry_id));

    if (multiSplitEntryIds.size > 0) {
      const placeholders = [...multiSplitEntryIds].map(() => "?").join(",");
      // Non-multi-split entries (settlement, single-split): always sync
      await db.runAsync(
        `UPDATE hisaab_entries
         SET description = ?, updated_at = datetime('now')
         WHERE linked_expense_id = ? AND id NOT IN (${placeholders});`,
        patch.description,
        expenseOrCreditId,
        ...[...multiSplitEntryIds],
      );
      // Multi-split entries: only fill if their own description is empty
      await db.runAsync(
        `UPDATE hisaab_entries
         SET description = ?, updated_at = datetime('now')
         WHERE linked_expense_id = ? AND id IN (${placeholders})
           AND (description IS NULL OR description = '');`,
        patch.description,
        expenseOrCreditId,
        ...[...multiSplitEntryIds],
      );
    } else {
      // No multi-split — safe to sync all
      await db.runAsync(
        `UPDATE hisaab_entries
         SET description = ?, updated_at = datetime('now')
         WHERE linked_expense_id = ?;`,
        patch.description,
        expenseOrCreditId,
      );
    }
  }
}

/**
 * Delete a credit entry (soft delete).
 */
export async function deleteCredit(creditId: string): Promise<void> {
  const db = getDatabase();
  // Accept both credit and ledger_adjustment rows — the ledger screen uses this
  // handler for any row the user tapped "delete" on, including manual
  // balance/opening adjustments which are now nature='ledger_adjustment'.
  await db.runAsync(
    `UPDATE expenses SET deleted_at = datetime('now') WHERE id = ? AND nature IN ('credit', 'ledger_adjustment');`,
    creditId,
  );
  await bumpDataVersion();
}

/**
 * Get all soft-deleted credits for the recycle bin.
 */
export async function getDeletedCredits(userId: string): Promise<AccountCredit[]> {
  const db = getDatabase();
  return db.getAllAsync<AccountCredit>(
    `SELECT id, account_id, user_id, amount, description, date, source, created_at, updated_at, deleted_at
     FROM expenses
     WHERE user_id = ? AND nature = 'credit' AND deleted_at IS NOT NULL
     ORDER BY deleted_at DESC;`,
    userId,
  );
}

/**
 * Restore a soft-deleted credit entry.
 */
export async function restoreCredit(creditId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE expenses SET deleted_at = NULL, updated_at = datetime('now')
     WHERE id = ? AND nature = 'credit';`,
    creditId,
  );
  await bumpDataVersion();
}

/**
 * Restore all deleted credits for a user.
 */
export async function restoreAllCredits(userId: string): Promise<number> {
  const db = getDatabase();
  const result = await db.runAsync(
    `UPDATE expenses SET deleted_at = NULL, updated_at = datetime('now')
     WHERE user_id = ? AND nature = 'credit' AND deleted_at IS NOT NULL;`,
    userId,
  );
  if (result.changes > 0) await bumpDataVersion();
  return result.changes;
}

/**
 * Permanently delete a soft-deleted credit entry.
 * Clears inbound FKs from hisaab_entries (settlement links) and pending_sms
 * (SMS-detected credits reference the expense row) before deleting.
 */
export async function hardDeleteCredit(creditId: string): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    // Drop any v15.12+ "linked settlement" rows — their only reason for existing
    // is the bond to this credit. Recordcreated rows (settlement_source='created'
    // or NULL for pre-migration-022 rows) keep existing but are unlinked below;
    // they still represent a real settlement the user recorded.
    await db.runAsync(
      `DELETE FROM hisaab_entries
       WHERE linked_expense_id = ? AND type = 'settlement' AND settlement_source = 'linked';`,
      creditId,
    );
    await db.runAsync(
      `UPDATE hisaab_entries SET linked_expense_id = NULL WHERE linked_expense_id = ?;`,
      creditId,
    );
    await db.runAsync(
      `UPDATE hisaab_entries SET linked_account_credit_id = NULL WHERE linked_account_credit_id = ?;`,
      creditId,
    );
    await db.runAsync(
      `DELETE FROM pending_sms WHERE expense_id = ?;`,
      creditId,
    );
    await db.runAsync(
      `DELETE FROM expenses WHERE id = ? AND nature = 'credit' AND deleted_at IS NOT NULL;`,
      creditId,
    );
  });
  bumpDataVersion();
}

/**
 * Permanently delete all soft-deleted credits for a user.
 * Clears inbound hisaab FKs and deletes linked pending_sms rows before deleting.
 */
export async function purgeAllDeletedCredits(userId: string): Promise<number> {
  const db = getDatabase();
  let changes = 0;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE hisaab_entries SET linked_expense_id = NULL
       WHERE linked_expense_id IN (
         SELECT id FROM expenses WHERE user_id = ? AND nature = 'credit' AND deleted_at IS NOT NULL
       );`,
      userId,
    );
    await db.runAsync(
      `UPDATE hisaab_entries SET linked_account_credit_id = NULL
       WHERE linked_account_credit_id IN (
         SELECT id FROM expenses WHERE user_id = ? AND nature = 'credit' AND deleted_at IS NOT NULL
       );`,
      userId,
    );
    await db.runAsync(
      `DELETE FROM pending_sms WHERE expense_id IN (
         SELECT id FROM expenses WHERE user_id = ? AND nature = 'credit' AND deleted_at IS NOT NULL
       );`,
      userId,
    );
    const result = await db.runAsync(
      `DELETE FROM expenses WHERE user_id = ? AND nature = 'credit' AND deleted_at IS NOT NULL;`,
      userId,
    );
    changes = result.changes;
  });
  if (changes > 0) bumpDataVersion();
  return changes;
}
