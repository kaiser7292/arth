/**
 * Account Transfer Service
 *
 * Tracks money moving between the user's own accounts:
 * - CC bill payments (savings → credit card)
 * - Self-transfers (savings → savings via IMPS/NEFT)
 * - Wallet top-ups (savings → wallet)
 *
 * Transfers are NOT expenses — they don't affect spending totals or budgets.
 * They affect account balances via:
 *   closing = opening - expenses + credits - transfers_out + transfers_in
 */

import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import type { Expense } from "@/services/expense-types";
import { generateUUID } from "@/utils/uuid";

export interface AccountTransfer {
  id: string;
  user_id: string;
  from_account_id: string;
  to_account_id: string;
  amount: number;
  description: string | null;
  date: string;
  linked_forecast_id: string | null;
  linked_expense_id: string | null;
  source: "manual" | "sms_auto";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** v15.12.1: full SMS body when the transfer was reclassified from an SMS-sourced credit/debit. */
  raw_source_text: string | null;
  /** v15.12.1: DLT sender ID (e.g. "VM-HDFCBK-S") of the originating SMS. */
  source_sms_address: string | null;
}

export interface CreateTransferParams {
  userId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  description?: string;
  date: string;
  linkedForecastId?: string;
  linkedExpenseId?: string;
  source?: "manual" | "sms_auto";
  /** Copy of the source expense's raw_source_text when reclassifying from an SMS credit/debit. */
  rawSourceText?: string | null;
  /** DLT sender ID of the originating SMS. */
  sourceSmsAddress?: string | null;
}

export async function createTransfer(params: CreateTransferParams): Promise<string> {
  // Guard: a transfer moves money between two different accounts. Same-account
  // transfers would create a self-loop that balance math nets out to zero but
  // leaves a garbage row in the ledger.
  if (params.fromAccountId === params.toAccountId) {
    throw new Error("Source and destination accounts must be different");
  }
  // Reject non-finite, non-positive, or absurdly-large amounts. UI validates
  // first but service is the final guard — a bad amount here would poison
  // demat snapshot math if the transfer is later categorized.
  if (!Number.isFinite(params.amount) || params.amount <= 0 || params.amount >= 1e12) {
    throw new Error("Transfer amount must be a positive, finite number");
  }
  // Dates must be YYYY-MM-DD — demat side-effects slice date.slice(0,7) for
  // the month bucket, and balance-sheet math assumes this format.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
    throw new Error("Transfer date must be in YYYY-MM-DD format");
  }
  const db = getDatabase();
  const id = generateUUID();
  const now = new Date().toISOString(); // Local time in ISO format
  await db.runAsync(
    `INSERT INTO account_transfers
       (id, user_id, from_account_id, to_account_id, amount, description, date, linked_forecast_id, linked_expense_id, source, raw_source_text, source_sms_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    id,
    params.userId,
    params.fromAccountId,
    params.toAccountId,
    params.amount,
    params.description ?? null,
    params.date,
    params.linkedForecastId ?? null,
    params.linkedExpenseId ?? null,
    params.source ?? "manual",
    params.rawSourceText ?? null,
    params.sourceSmsAddress ?? null,
    now,
  );
  await bumpDataVersion();
  return id;
}

/**
 * Total amount transferred OUT of an account in a date range.
 * Used in balance calculation: closing = opening - expenses + credits - transfers_out + transfers_in
 */
export async function getTransfersOutTotal(
  accountId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(amount) as total FROM account_transfers
     WHERE from_account_id = ? AND deleted_at IS NULL
       AND date >= ? AND date <= ?;`,
    accountId,
    startDate,
    endDate,
  );
  return row?.total ?? 0;
}

/**
 * Total amount transferred INTO an account in a date range.
 */
export async function getTransfersInTotal(
  accountId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(amount) as total FROM account_transfers
     WHERE to_account_id = ? AND deleted_at IS NULL
       AND date >= ? AND date <= ?;`,
    accountId,
    startDate,
    endDate,
  );
  return row?.total ?? 0;
}

/**
 * All transfers involving an account (in or out) for a date range.
 */
export async function getTransfersForMonth(
  accountId: string,
  startDate: string,
  endDate: string,
): Promise<AccountTransfer[]> {
  const db = getDatabase();
  return db.getAllAsync<AccountTransfer>(
    `SELECT * FROM account_transfers
     WHERE (from_account_id = ? OR to_account_id = ?) AND deleted_at IS NULL
       AND date >= ? AND date <= ?
     ORDER BY date DESC;`,
    accountId,
    accountId,
    startDate,
    endDate,
  );
}

/**
 * All transfers for a user across all accounts for a date range.
 * Used in the transfers nature filter to show all user transfers.
 */
export async function getTransfersForUser(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<AccountTransfer[]> {
  const db = getDatabase();
  return db.getAllAsync<AccountTransfer>(
    `SELECT * FROM account_transfers
     WHERE user_id = ? AND deleted_at IS NULL
       AND date >= ? AND date <= ?
     ORDER BY date DESC;`,
    userId,
    startDate,
    endDate,
  );
}

/**
 * All transfers for a user in a date range (for monthly summary display).
 */
export async function getUserTransfersForMonth(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<AccountTransfer[]> {
  const db = getDatabase();
  return db.getAllAsync<AccountTransfer>(
    `SELECT * FROM account_transfers
     WHERE user_id = ? AND deleted_at IS NULL
       AND date >= ? AND date <= ?
     ORDER BY date DESC;`,
    userId,
    startDate,
    endDate,
  );
}

/**
 * Update an existing transfer (amount, description, date).
 *
 * Guardrail (v14.8.0): if the transfer has demat side-effects applied
 * (demat_target != NULL), amount and date edits are rejected. Those fields
 * drive fund/portfolio snapshot math + the linked investment_contribution
 * amount — changing them without a paired reverse/re-apply silently
 * corrupts bucket progress and milestone current_saved totals.
 *
 * To change a demat transfer's amount or date, the user must delete + re-
 * create it so reverse-side-effects fire cleanly.
 */
export async function updateTransfer(
  id: string,
  params: { amount?: number; description?: string; date?: string },
): Promise<void> {
  const db = getDatabase();

  // Demat-linked guardrail
  if (params.amount !== undefined || params.date !== undefined) {
    const row = await db.getFirstAsync<{ demat_target: string | null }>(
      "SELECT demat_target FROM account_transfers WHERE id = ? AND deleted_at IS NULL;",
      id,
    );
    if (row?.demat_target) {
      throw new Error(
        "This transfer is linked to a demat fund/portfolio update. Delete and re-create the transfer to change amount or date.",
      );
    }
  }

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (params.amount !== undefined) { fields.push("amount = ?"); values.push(params.amount); }
  if (params.description !== undefined) { fields.push("description = ?"); values.push(params.description); }
  if (params.date !== undefined) { fields.push("date = ?"); values.push(params.date); }

  if (fields.length === 0) return;

  const now = new Date().toISOString(); // Local time in ISO format
  fields.push("updated_at = ?");
  values.push(now);
  values.push(id);

  await db.runAsync(
    `UPDATE account_transfers SET ${fields.join(", ")} WHERE id = ? AND deleted_at IS NULL;`,
    ...values,
  );
  await bumpDataVersion();
}

/**
 * Soft-delete a transfer. If the transfer landed in a demat account and had
 * demat side-effects (fund/portfolio snapshot bump + optional investment
 * contribution), reverse those side-effects first so all connected dots
 * (snapshot history, bucket progress, linked milestones) are undone together.
 *
 * Runs as a single outer transaction so the reverse + soft-delete UPDATE
 * are atomic. Prevents a race where a rapid second delete could observe an
 * already-cleared demat_target and skip the reversal, leaving the transfer
 * row marked deleted without undoing
 * its snapshot/bucket deltas.
 */
export async function deleteTransfer(id: string): Promise<void> {
  // Resolve the dynamic import OUTSIDE the transaction. Awaiting an import()
  // inside withTransactionAsync can leave the txn open across a microtask
  // boundary, which on some RN/SQLite combinations silently aborts the txn
  // and leaves the soft-delete UPDATE unpersisted.
  const { reverseDematTransferSideEffectsInTxn } = await import("@/services/demat-transfer");
  const db = getDatabase();

  // Get the transfer details to check if it has a linked expense
  const row = await db.getFirstAsync<{ linked_expense_id: string | null }>(
    "SELECT linked_expense_id FROM account_transfers WHERE id = ?;",
    id,
  );

  await db.withTransactionAsync(async () => {
    await reverseDematTransferSideEffectsInTxn(id);
    const now = new Date().toISOString(); // Local time in ISO format
    await db.runAsync(
      `UPDATE account_transfers SET deleted_at = ? WHERE id = ?;`,
      now,
      id,
    );
    // Check if reclassification columns exist (migration 046)
    const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(expenses);");
    const hasFlag = cols.some((c) => c.name === "reclassified_as_transfer");
    const hasLinked = cols.some((c) => c.name === "linked_transfer_id");

    // v15.12.1: Remove reclassification flag instead of restoring soft-deleted expense
    // Expenses are no longer soft-deleted when reclassified, so we just remove the flag
    if (row?.linked_expense_id) {
      if (hasFlag && hasLinked) {
        await db.runAsync(
          `UPDATE expenses SET reclassified_as_transfer = 0, linked_transfer_id = NULL, updated_at = ?
           WHERE id = ?;`,
          now,
          row.linked_expense_id,
        );
      } else {
        // Fallback: restore soft-deleted expense if columns don't exist (migration hasn't run)
        await db.runAsync(
          `UPDATE expenses SET deleted_at = NULL, updated_at = ? WHERE id = ?;`,
          now,
          row.linked_expense_id,
        );
      }
    }
  });
  await bumpDataVersion();
}

/**
 * Auto-detect if a savings debit might be a self-transfer.
 * Searches for a matching credit on another owned account within ±1 day
 * with the exact same amount.
 *
 * Returns the destination account ID if a unique match is found, null otherwise.
 */
export async function autoDetectTransfer(
  userId: string,
  debitAccountId: string,
  amount: number,
  date: string,
): Promise<string | null> {
  const db = getDatabase();

  const matches = await db.getAllAsync<{ account_id: string }>(
    `SELECT e.account_id FROM expenses e
     INNER JOIN financial_accounts fa ON fa.id = e.account_id
     WHERE fa.user_id = ? AND fa.is_active = 1
       AND e.nature = 'credit' AND e.status = 'approved'
       AND e.account_id != ?
       AND e.amount = ?
       AND e.date >= date(?, '-1 day')
       AND e.date <= date(?, '+1 day')
       AND e.deleted_at IS NULL
       AND e.source = 'sms_auto';`,
    userId,
    debitAccountId,
    amount,
    date,
    date,
  );

  if (matches.length === 1) return matches[0].account_id;
  return null;
}

/**
 * Get transfer by linked expense ID.
 * Used to show transfer details in expense view.
 */
export async function getTransferByLinkedExpenseId(
  expenseId: string,
): Promise<AccountTransfer | null> {
  const db = getDatabase();
  return db.getFirstAsync<AccountTransfer>(
    `SELECT * FROM account_transfers
     WHERE linked_expense_id = ? AND deleted_at IS NULL;`,
    expenseId,
  );
}

/**
 * Get expenses that are linked to transfers.
 * Used to show expense rows in the transfers tab.
 */
export async function getExpensesLinkedToTransfers(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<any[]> {
  const db = getDatabase();
  return db.getAllAsync(
    `SELECT e.* FROM expenses e
     INNER JOIN account_transfers t ON t.linked_expense_id = e.id
     WHERE e.user_id = ? AND e.deleted_at IS NULL
       AND t.deleted_at IS NULL
       AND e.date >= ? AND e.date <= ?
     ORDER BY e.date DESC;`,
    userId,
    startDate,
    endDate,
  );
}

/**
 * Reclassify a realized expense as an inter-account transfer.
 * Creates a transfer record and soft-deletes the original expense.
 */
export async function reclassifyExpenseAsTransfer(
  expenseId: string,
  toAccountId: string,
  currentUpdatedAt?: string,
): Promise<string> {
  const db = getDatabase();

  const expense = await db.getFirstAsync<{
    id: string;
    user_id: string;
    account_id: string;
    amount: number;
    date: string;
    merchant_name: string | null;
    raw_source_text: string | null;
    source: string;
    split_mode: string | null;
    split_person_id: string | null;
    matched_forecast_id: string | null;
    fulfills_rule_id: string | null;
    updated_at: string;
  }>(
    `SELECT id, user_id, account_id, amount, date, merchant_name, raw_source_text, source,
            split_mode, split_person_id, matched_forecast_id, fulfills_rule_id, updated_at
     FROM expenses WHERE id = ? AND nature = 'realized' AND deleted_at IS NULL;`,
    expenseId,
  );
  if (!expense) throw new Error("Expense not found or not reclassifiable");
  if (!expense.account_id) throw new Error("Expense has no source account");

  // Guard: concurrent edit protection
  if (currentUpdatedAt && expense.updated_at !== currentUpdatedAt) {
    throw new Error("This expense was modified by another action. Please refresh and try again.");
  }

  // Guard: prevent reclassifying split expense legs
  if (expense.split_mode || expense.split_person_id) {
    throw new Error("Cannot reclassify split expense legs. Delete the split first or reclassify the original expense.");
  }

  // Guard: prevent reclassifying expenses linked to non-repayment forecasts
  if (expense.matched_forecast_id) {
    const forecast = await db.getFirstAsync<{ forecast_type: string; status: string }>(
      `SELECT forecast_type, status FROM expenses WHERE id = ? AND nature = 'forecast';`,
      expense.matched_forecast_id,
    );
    if (forecast && forecast.forecast_type !== "repayment" && forecast.status !== "rejected") {
      throw new Error("Cannot reclassify expense linked to a forecast. Unlink the forecast first.");
    }
  }

  // Guard: prevent reclassifying expenses fulfilling reminders
  if (expense.fulfills_rule_id) {
    throw new Error("Cannot reclassify expense that fulfills a reminder. Unlink the reminder first.");
  }

  // v15.12.1: preserve SMS trace on the resulting transfer if the source
  // expense was SMS-auto detected.
  let rawSourceText: string | null = null;
  let sourceSmsAddress: string | null = null;
  if (expense.source === "sms_auto" && expense.raw_source_text) {
    rawSourceText = expense.raw_source_text;
    const smsRow = await db.getFirstAsync<{ address: string | null }>(
      `SELECT address FROM pending_sms WHERE expense_id = ? LIMIT 1;`,
      expenseId,
    );
    sourceSmsAddress = smsRow?.address ?? null;
  }

  const transferId = await createTransfer({
    userId: expense.user_id,
    fromAccountId: expense.account_id,
    toAccountId,
    amount: expense.amount,
    description: `Self transfer${expense.merchant_name ? ` — ${expense.merchant_name}` : ""}`,
    date: expense.date,
    linkedExpenseId: expenseId,
    source: "manual",
    rawSourceText,
    sourceSmsAddress,
  });

  const now = new Date().toISOString(); // Local time in ISO format
  // Check if reclassification columns exist (migration 046)
  const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(expenses);");
  const hasFlag = cols.some((c) => c.name === "reclassified_as_transfer");
  const hasLinked = cols.some((c) => c.name === "linked_transfer_id");

  if (hasFlag && hasLinked) {
    // Mark expense as reclassified instead of soft-deleting
    await db.runAsync(
      `UPDATE expenses SET reclassified_as_transfer = 1, linked_transfer_id = ?, updated_at = ? WHERE id = ?;`,
      transferId,
      now,
      expenseId,
    );
  } else {
    // Fallback: soft-delete if columns don't exist (migration hasn't run)
    await db.runAsync(
      `UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?;`,
      now,
      now,
      expenseId,
    );
  }

  await bumpDataVersion();
  return transferId;
}

/**
 * Reclassify an account credit as an inter-account transfer.
 *
 * Handles two shapes:
 *  1. CC-repayment credit — credit has matched_forecast_id pointing at a
 *     'repayment' forecast (SMS-detected CC bill payment). Delegates to
 *     approveCcRepaymentCredit so the forecast is also closed, CC dues reduced,
 *     and paid_from_account_id is recorded. Without this, the forecast would
 *     stay open forever and the user would see "bill due" in forecast UIs.
 *  2. Plain credit — everything else (savings self-transfer, one-off CC credit).
 *     Creates a transfer row and soft-deletes the credit.
 */
export async function reclassifyCreditAsTransfer(
  creditId: string,
  fromAccountId: string,
  currentUpdatedAt?: string,
): Promise<string> {
  const db = getDatabase();

  const credit = await db.getFirstAsync<{
    id: string;
    account_id: string;
    user_id: string;
    amount: number;
    description: string | null;
    date: string;
    matched_forecast_id: string | null;
    raw_source_text: string | null;
    source: string;
    split_mode: string | null;
    split_person_id: string | null;
    fulfills_rule_id: string | null;
    linked_settlement_id: string | null;
    updated_at: string;
  }>(
    `SELECT id, account_id, user_id, amount, description, date, matched_forecast_id, raw_source_text, source,
            split_mode, split_person_id, fulfills_rule_id, linked_settlement_id, updated_at
     FROM expenses WHERE id = ? AND nature = 'credit' AND deleted_at IS NULL;`,
    creditId,
  );
  if (!credit) throw new Error("Credit not found or already deleted");

  // Guard: concurrent edit protection
  if (currentUpdatedAt && credit.updated_at !== currentUpdatedAt) {
    throw new Error("This credit was modified by another action. Please refresh and try again.");
  }

  // Guard: prevent reclassifying split credit legs
  if (credit.split_mode || credit.split_person_id) {
    throw new Error("Cannot reclassify split credit legs. Delete the split first or reclassify the original credit.");
  }

  // Guard: prevent reclassifying credits linked to settlements
  if (credit.linked_settlement_id) {
    throw new Error("Cannot reclassify credit already used for hisaab settlement.");
  }

  // Guard: prevent reclassifying credits fulfilling reminders
  if (credit.fulfills_rule_id) {
    throw new Error("Cannot reclassify credit that fulfills a reminder. Unlink the reminder first.");
  }

  // Shape 1: CC-repayment credit → route through the repayment flow so the
  // linked forecast is closed and CC dues/paid_from_account_id are updated.
  if (credit.matched_forecast_id) {
    const forecast = await db.getFirstAsync<{ forecast_type: string; status: string }>(
      `SELECT forecast_type, status FROM expenses WHERE id = ? AND nature = 'forecast';`,
      credit.matched_forecast_id,
    );
    if (forecast?.forecast_type === "repayment" && forecast.status !== "rejected") {
      // Dynamic import avoids a circular dep (expense-crud imports account-transfer).
      const { approveCcRepaymentCredit } = await import("@/services/expense-crud");
      await approveCcRepaymentCredit(creditId, fromAccountId);
      // approveCcRepaymentCredit does not return an id; fetch the transfer it
      // created so this function's signature still resolves to a transfer id.
      const row = await db.getFirstAsync<{ id: string }>(
        `SELECT id FROM account_transfers
         WHERE linked_forecast_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 1;`,
        credit.matched_forecast_id,
      );
      return row?.id ?? credit.matched_forecast_id;
    }
  }

  // v15.12.1: preserve SMS trace on the resulting transfer if the source
  // credit was SMS-auto detected.
  let rawSourceText: string | null = null;
  let sourceSmsAddress: string | null = null;
  if (credit.source === "sms_auto" && credit.raw_source_text) {
    rawSourceText = credit.raw_source_text;
    const smsRow = await db.getFirstAsync<{ address: string | null }>(
      `SELECT address FROM pending_sms WHERE expense_id = ? LIMIT 1;`,
      creditId,
    );
    sourceSmsAddress = smsRow?.address ?? null;
  }

  // Shape 2: plain credit reclassify.
  const transferId = await createTransfer({
    userId: credit.user_id,
    fromAccountId,
    toAccountId: credit.account_id,
    amount: credit.amount,
    description: `Transfer${credit.description ? ` — ${credit.description}` : ""}`,
    date: credit.date,
    linkedExpenseId: creditId,
    source: "manual",
    rawSourceText,
    sourceSmsAddress,
  });

  const now = new Date().toISOString(); // Local time in ISO format
  // Check if reclassification columns exist (migration 046)
  const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(expenses);");
  const hasFlag = cols.some((c) => c.name === "reclassified_as_transfer");
  const hasLinked = cols.some((c) => c.name === "linked_transfer_id");

  if (hasFlag && hasLinked) {
    // Mark credit as reclassified instead of soft-deleting
    await db.runAsync(
      `UPDATE expenses SET reclassified_as_transfer = 1, linked_transfer_id = ?, updated_at = ?
       WHERE id = ? AND nature = 'credit';`,
      transferId,
      now,
      creditId,
    );
  } else {
    // Fallback: soft-delete if columns don't exist (migration hasn't run)
    await db.runAsync(
      `UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ? AND nature = 'credit';`,
      now,
      now,
      creditId,
    );
  }

  await bumpDataVersion();
  return transferId;
}

/**
 * Undo a transfer reclassification - convert back to original expense/credit.
 * Removes the reclassification flag and soft-deletes the transfer.
 */
export async function undoTransfer(transferId: string): Promise<void> {
  const { reverseDematTransferSideEffectsInTxn } = await import("@/services/demat-transfer");
  const db = getDatabase();

  // Get transfer details
  const transfer = await db.getFirstAsync<AccountTransfer>(
    `SELECT * FROM account_transfers WHERE id = ? AND deleted_at IS NULL;`,
    transferId,
  );
  if (!transfer) throw new Error("Transfer not found");

  await db.withTransactionAsync(async () => {
    // Reverse demat side-effects if applicable
    await reverseDematTransferSideEffectsInTxn(transferId);

    // Check if reclassification columns exist (migration 046)
    const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(expenses);");
    const hasFlag = cols.some((c) => c.name === "reclassified_as_transfer");
    const hasLinked = cols.some((c) => c.name === "linked_transfer_id");

    // Remove reclassification flag from expense/credit
    if (transfer.linked_expense_id) {
      if (hasFlag && hasLinked) {
        await db.runAsync(
          `UPDATE expenses SET reclassified_as_transfer = 0, linked_transfer_id = NULL, updated_at = ? WHERE id = ?;`,
          new Date().toISOString(),
          transfer.linked_expense_id,
        );
      } else {
        // Fallback: restore soft-deleted expense if columns don't exist (migration hasn't run)
        await db.runAsync(
          `UPDATE expenses SET deleted_at = NULL, updated_at = ? WHERE id = ?;`,
          new Date().toISOString(),
          transfer.linked_expense_id,
        );
      }
    }

    // Soft-delete the transfer
    const now = new Date().toISOString();
    await db.runAsync(
      `UPDATE account_transfers SET deleted_at = ? WHERE id = ?;`,
      now,
      transferId,
    );
  });

  await bumpDataVersion();
}

/**
 * Get expenses/credits that have been reclassified as transfers.
 * Used to show them in the transfers nature filter.
 */
export async function getReclassifiedExpenses(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<Expense[]> {
  const db = getDatabase();

  // Check if reclassification columns exist (migration 046)
  const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(expenses);");
  const hasFlag = cols.some((c) => c.name === "reclassified_as_transfer");
  const hasLinked = cols.some((c) => c.name === "linked_transfer_id");

  if (!hasFlag || !hasLinked) {
    // Migration hasn't run yet, return empty array
    return [];
  }

  const expenses = await db.getAllAsync<Expense>(
    `SELECT * FROM expenses
     WHERE user_id = ?
     AND reclassified_as_transfer = 1
     AND deleted_at IS NULL
     AND date >= ?
     AND date <= ?
     ORDER BY date DESC, created_at DESC;`,
    userId,
    startDate,
    endDate,
  );

  return expenses;
}
