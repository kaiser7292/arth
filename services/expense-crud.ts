import { getDatabase } from "@/database";
import { syncSettlementLinkedHisaabEntry } from "@/services/account-credit";
import { findPaymentModeByType } from "@/services/account-master";
import { learnMerchantAlias } from "@/services/merchant-alias";
import { bumpDataVersion } from "@/services/settings";
import { categorizeByMerchant } from "@/services/smart-categorizer";
import { applyRules, stampApplication } from "@/services/smart-rules";
import { inferPaymentMode, parseBankSMS } from "@/services/sms/bank-patterns";
import { logger } from "@/utils/logger";
import { round2 } from "@/utils/math";
import { generateUUID } from "@/utils/uuid";
import type { CreateExpenseInput, Expense, UpdateExpenseInput } from "./expense-types";

/**
 * Create a new expense. Returns the new ID.
 * Source defaults to 'manual', status defaults to 'approved'.
 */
export async function createExpense(input: CreateExpenseInput): Promise<string> {
  const db = getDatabase();
  const id = generateUUID();

  // v15.2: smart-rules auto-categorize. Only fills blanks the user didn't set.
  // Rule actions never stomp explicit user input (category_id, payment_mode_id,
  // is_right_spend if caller passed a value).
  let categoryId = input.category_id ?? null;
  let paymentModeId = input.payment_mode_id ?? null;
  let isRightSpend = input.is_right_spend ?? null;
  let appliedRuleId: string | null = null;

  const userSetCategory = input.category_id !== undefined && input.category_id !== null;
  const userSetPaymentMode = input.payment_mode_id !== undefined && input.payment_mode_id !== null;
  const userSetRightSpend = input.is_right_spend !== undefined && input.is_right_spend !== null;

  let linkToBucketId: string | null = null;
  try {
    const rule = await applyRules({
      amount: input.amount,
      merchant: input.merchant_name ?? null,
      description: input.description ?? null,
      category_id: categoryId,
      account_id: input.account_id ?? null,
      payment_mode_id: input.payment_mode_id ?? null,
      sms_body: null,
    });
    if (rule) {
      if (!userSetCategory && rule.category_id) categoryId = rule.category_id;
      if (!userSetPaymentMode && rule.payment_mode) paymentModeId = rule.payment_mode;
      if (!userSetRightSpend && rule.is_right_spend !== null) isRightSpend = rule.is_right_spend;
      appliedRuleId = rule.rule.id;
      linkToBucketId = rule.rule.action_link_to_investment_bucket_id ?? null;
    }
  } catch (e) {
    logger.warn("Smart rule application failed in createExpense (non-fatal):", e);
  }

  const description = input.description ?? input.merchant_name ?? null;

  const now = new Date().toISOString(); // Local time in ISO format
  await db.runAsync(
    `INSERT INTO expenses (id, user_id, amount, currency, description, merchant_name, category_id, payment_mode_id, account_id, date, transaction_time, nature, is_right_spend, refund_of_expense_id, purchase_group_id, due_date, applied_rule_id, source, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'approved', ?);`,
    id,
    input.user_id,
    round2(input.amount),
    input.currency ?? "INR",
    description,
    input.merchant_name ?? null,
    categoryId,
    paymentModeId,
    input.account_id ?? null,
    input.date,
    input.transaction_time ?? "00:00:00",
    input.nature ?? "realized",
    isRightSpend,
    input.refund_of_expense_id ?? null,
    input.purchase_group_id ?? null,
    input.due_date ?? null,
    appliedRuleId,
    now,
  );

  if (appliedRuleId) {
    stampApplication(appliedRuleId).catch((e) =>
      logger.warn("stampApplication failed (non-fatal)", e),
    );
  }

  // v17.2.0 — opportunistic loan EMI match. Runs async, never blocks.
  try {
    const { tryMatchExpenseToEMI } = await import("./loan-sms-matcher");
    await tryMatchExpenseToEMI(id, input.user_id);
  } catch (e) {
    logger.warn("tryMatchExpenseToEMI failed (non-fatal)", e);
  }

  // v17.2.0 — auto-link to investment bucket if the matched smart rule said so.
  if (linkToBucketId && (input.nature ?? "realized") === "realized") {
    try {
      const { linkExpenseToBucket } = await import("./expense-investment-link");
      await linkExpenseToBucket(id, linkToBucketId);
    } catch (e) {
      logger.warn("linkExpenseToBucket failed (non-fatal)", e);
    }
  }

  bumpDataVersion();
  return id;
}

/**
 * Update an expense by ID.
 */
export async function updateExpense(
  id: string,
  input: UpdateExpenseInput,
): Promise<void> {
  const db = getDatabase();

  // Capture old values for edit history
  const editableFields = ["amount", "description", "merchant_name", "category_id", "payment_mode_id", "date", "is_right_spend", "currency", "account_id"] as const;
  const changedFields = editableFields.filter((f) => (input as Record<string, unknown>)[f] !== undefined);
  let oldValues: Record<string, string | null> = {};
  if (changedFields.length > 0) {
    const oldRow = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT ${changedFields.join(", ")} FROM expenses WHERE id = ?;`,
      id,
    );
    if (oldRow) {
      for (const f of changedFields) {
        oldValues[f] = oldRow[f] != null ? String(oldRow[f]) : null;
      }
    }
  }

  // Read old expense state before updating (for auto-learn)
  let oldExpense: { user_id: string; merchant_name: string | null; source: string } | null = null;
  if (input.merchant_name !== undefined) {
    oldExpense = await db.getFirstAsync<{ user_id: string; merchant_name: string | null; source: string }>(
      `SELECT user_id, merchant_name, source FROM expenses WHERE id = ?;`,
      id,
    );
  }

  // Guardrail (v14.8.0): if the user is editing amount or date on an expense
  // that fulfills a recurring reminder, auto-unfulfill first. The reminder's
  // cycle_due_date stays frozen at the original fulfillment — changing the
  // expense's date after-the-fact would desync history. Unfulfilling rewinds
  // the rule's next_due_date so the reminder becomes "due" again; the user
  // can re-link the updated expense via the suggestion banner.
  if (input.amount !== undefined || input.date !== undefined) {
    const linkRow = await db.getFirstAsync<{ fulfills_rule_id: string | null }>(
      `SELECT fulfills_rule_id FROM expenses WHERE id = ?;`,
      id,
    );
    if (linkRow?.fulfills_rule_id) {
      try {
        const { unfulfillReminder } = await import("./recurring-rules");
        await unfulfillReminder(id);
      } catch (e) {
        // Failing the unfulfill shouldn't block the edit. If the reminder's
        // state becomes inconsistent the user can manually re-link.
        logger.warn("unfulfillReminder failed (non-fatal)", e);
      }
    }
  }

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.amount !== undefined) {
    fields.push("amount = ?");
    values.push(round2(input.amount));
  }
  if (input.description !== undefined) {
    fields.push("description = ?");
    values.push(input.description);
  }
  if (input.merchant_name !== undefined) {
    fields.push("merchant_name = ?");
    values.push(input.merchant_name);
  }
  if (input.category_id !== undefined) {
    fields.push("category_id = ?");
    values.push(input.category_id);
  }
  if (input.payment_mode_id !== undefined) {
    fields.push("payment_mode_id = ?");
    values.push(input.payment_mode_id);
  }
  if (input.date !== undefined) {
    fields.push("date = ?");
    values.push(input.date);
  }
  if (input.is_right_spend !== undefined) {
    fields.push("is_right_spend = ?");
    values.push(input.is_right_spend);
  }
  if (input.currency !== undefined) {
    fields.push("currency = ?");
    values.push(input.currency);
  }
  if (input.account_id !== undefined) {
    fields.push("account_id = ?");
    values.push(input.account_id);
  }

  if (fields.length === 0) return;

  fields.push("updated_at = datetime('now')");
  values.push(id);
  await db.runAsync(
    `UPDATE expenses SET ${fields.join(", ")} WHERE id = ?;`,
    ...values,
  );

  // Record edit history for undo
  if (Object.keys(oldValues).length > 0) {
    try {
      const { recordEdits } = await import("./expense-edit-history");
      const changes: Record<string, { old: string | null; new: string | null }> = {};
      for (const f of changedFields) {
        const newVal = (input as Record<string, unknown>)[f];
        changes[f] = { old: oldValues[f], new: newVal != null ? String(newVal) : null };
      }
      await recordEdits(id, changes);
    } catch (e) {
      logger.warn("recordEdits failed (non-fatal)", e);
    }
  }

  // Auto-learn merchant alias: old SMS merchant name → user's preferred name
  if (
    input.merchant_name !== undefined &&
    oldExpense?.source === "sms_auto" &&
    oldExpense.merchant_name &&
    input.merchant_name &&
    oldExpense.merchant_name !== input.merchant_name
  ) {
    await learnMerchantAlias(
      oldExpense.user_id,
      oldExpense.merchant_name,
      input.merchant_name,
      input.category_id,
    ).catch((e) => logger.warn("Merchant alias learn failed (non-critical):", e));
  }

  // v16.0.6 — mirror amount/date to any linked hisaab row. Applies to:
  //   - settlement-linked credits (1:1 amount + date sync)
  //   - split debits/credits (date only; amount is handled by the
  //     expense-detail rebuild path when the total changes)
  // v17.5.47 — also mirrors description changes.
  // Gated on the relevant fields actually changing so we don't churn
  // hisaab rows on unrelated edits.
  if (input.amount !== undefined || input.date !== undefined || input.description !== undefined) {
    await syncSettlementLinkedHisaabEntry(id, {
      amount: input.amount !== undefined ? round2(input.amount) : undefined,
      date: input.date,
      description: input.description ?? undefined,
    });
  }

  // v17.0.0 — if this expense is linked to an investment bucket, sync the
  // contribution amount on amount-edit so the bucket's current_contributed
  // stays consistent.
  if (input.amount !== undefined) {
    try {
      const { syncLinkOnExpenseEdit } = await import(
        "./expense-investment-link"
      );
      await syncLinkOnExpenseEdit(id, round2(input.amount));
    } catch (e) {
      logger.warn("syncLinkOnExpenseEdit failed (non-fatal)", e);
    }
  }

  // v17.5.13 — if this expense is linked as a loan prepayment, mirror
  // amount/date edits into the loan_prepayments row and rebuild the
  // schedule. Without this the expense.amount and prepayment.amount could
  // diverge silently — the loan tells a different story than the expense.
  // Caveat: the expense edit screen doesn't surface strategy/kind/charges,
  // so those stay fixed; if the user needs to change them they must
  // unlink and re-link (documented limitation for v17.5.13).
  if (input.amount !== undefined || input.date !== undefined) {
    try {
      await syncLoanPrepaymentLinkOnExpenseEdit(id);
    } catch (e) {
      logger.warn("syncLoanPrepaymentLinkOnExpenseEdit failed (non-fatal)", e);
    }
  }

  bumpDataVersion();
}

/**
 * v17.5.13 — propagates amount/date edits from an expense into its linked
 * loan_prepayments row (if any), recomputing the charge + GST from the
 * loan's configured rates and rebuilding the schedule.
 *
 * No-op when:
 *   - the expense isn't linked to a loan prepayment
 *   - the expense is linked as an EMI (that flow keeps schedule in sync
 *     via linkExpenseAsEMI's status flag; amount changes there are caught
 *     at a different layer)
 */
async function syncLoanPrepaymentLinkOnExpenseEdit(expenseId: string): Promise<void> {
  const db = getDatabase();
  const link = await db.getFirstAsync<{
    prepayment_id: string;
    loan_account_id: string;
  }>(
    `SELECT prepayment_id, loan_account_id FROM expense_loan_links
     WHERE expense_id = ? AND link_kind = 'prepayment' AND prepayment_id IS NOT NULL;`,
    expenseId,
  );
  if (!link) return;

  const expense = await db.getFirstAsync<{ amount: number; date: string }>(
    "SELECT amount, date FROM expenses WHERE id = ?;",
    expenseId,
  );
  if (!expense) return;

  const prepay = await db.getFirstAsync<{
    strategy: "reduce_tenure" | "reduce_emi" | null;
    kind: "part_payment" | "foreclosure";
  }>(
    "SELECT strategy, kind FROM loan_prepayments WHERE id = ?;",
    link.prepayment_id,
  );
  if (!prepay) return;

  // Recompute charge + GST at the new amount/date using the loan's
  // configured rates, so the prepayment row stays in lockstep with what
  // the picker would have produced for these values.
  const {
    getLoanById,
    getSchedule,
    getPrepayments,
    loanToParams,
    loanToTerms,
    updatePrepayment,
  } = await import("./loan-accounts");
  const { computePrepaymentImpact } = await import("./loan-engine");

  const loan = await getLoanById(link.loan_account_id);
  if (!loan) return;
  const [schedule, allPrepays] = await Promise.all([
    getSchedule(link.loan_account_id),
    getPrepayments(link.loan_account_id),
  ]);

  // computePrepaymentImpact needs the schedule + the OTHER prepayments
  // (exclude the one we're updating so it's not double-counted) + the
  // strategy. Returns charge + GST derived from the loan's configured
  // prepayment_charge_pct_early/late + threshold + gst_pct.
  const otherPrepays = allPrepays.filter((p) => p.id !== link.prepayment_id);
  const impact = computePrepaymentImpact(
    { ...loanToParams(loan), ...loanToTerms(loan) },
    schedule.map((e) => ({
      id: e.id,
      installment_num: e.installment_num,
      due_date: e.due_date,
      opening_principal: e.opening_principal,
      emi_amount: e.emi_amount,
      principal_component: e.principal_component,
      interest_component: e.interest_component,
      closing_principal: e.closing_principal,
      status: e.status,
    })),
    otherPrepays.map((p) => ({
      prepayment_date: p.prepayment_date,
      amount: p.amount,
      prepayment_charge: p.prepayment_charge,
      gst_on_charge: p.gst_on_charge,
      kind: p.kind,
      strategy: p.strategy ?? undefined,
    })),
    expense.amount,
    expense.date,
    prepay.strategy ?? "reduce_tenure",
  );

  await updatePrepayment(link.prepayment_id, {
    prepayment_date: expense.date,
    amount: expense.amount,
    prepayment_charge: impact.charge,
    gst_on_charge: impact.gst,
    strategy: prepay.strategy ?? undefined,
  });

  // Also keep the link row's amount column in sync (used by analytics).
  await db.runAsync(
    "UPDATE expense_loan_links SET amount = ?, updated_at = datetime('now') WHERE expense_id = ?;",
    expense.amount,
    expenseId,
  );
}

/**
 * Soft-delete an expense (sets deleted_at timestamp).
 * The expense moves to the recycle bin and can be restored.
 */
export async function deleteExpense(id: string): Promise<void> {
  const db = getDatabase();

  // Guardrail (v14.8.0 — G5): capture split-tender group membership BEFORE
  // the soft-delete so we can tidy up 1-leg-remaining groups below.
  const groupRow = await db.getFirstAsync<{ purchase_group_id: string | null }>(
    "SELECT purchase_group_id FROM expenses WHERE id = ?;",
    id,
  );

  await db.runAsync(
    "UPDATE expenses SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?;",
    id,
  );
  // Remove SMS tracking so rescan can re-detect this SMS
  await db.runAsync("DELETE FROM pending_sms WHERE expense_id = ?;", id);

  // Guardrail (v14.8.0 — G5): if this leg was part of a split-tender group
  // and only one live leg remains after soft-delete, unlink that leg (a
  // 1-leg "group" renders as a split in the UI but is semantically just a
  // standalone expense). Mirrors the hard-delete logic in
  // permanentlyDeleteExpense.
  if (groupRow?.purchase_group_id) {
    const remaining = await db.getAllAsync<{ id: string }>(
      "SELECT id FROM expenses WHERE purchase_group_id = ? AND deleted_at IS NULL;",
      groupRow.purchase_group_id,
    );
    if (remaining.length <= 1) {
      await db.runAsync(
        "UPDATE expenses SET purchase_group_id = NULL, updated_at = datetime('now') WHERE purchase_group_id = ?;",
        groupRow.purchase_group_id,
      );
    }
  }

  // Connected-dots delete semantics for recurring reminders:
  //   1. If this expense is the source of an active rule → auto-stop the rule.
  //   2. If this expense fulfills a reminder cycle → unfulfill it (rewind
  //      next_due_date so the user isn't silently skipping a month).
  try {
    const { onSourceExpenseDeleted, onFulfillingExpenseDeleted } = await import(
      "./recurring-rules"
    );
    await onSourceExpenseDeleted(id);
    await onFulfillingExpenseDeleted(id);
  } catch (e) {
    logger.warn("recurring-rules cleanup on delete failed (non-fatal)", e);
  }

  // v17.0.0 — if this expense is linked to an investment bucket, recompute the
  // bucket so its current_contributed drops by the link amount.
  try {
    const { onExpenseDeletedOrRestored } = await import(
      "./expense-investment-link"
    );
    await onExpenseDeletedOrRestored(id);
  } catch (e) {
    logger.warn("expense-investment-link cleanup failed (non-fatal)", e);
  }

  // v17.4.0 — if this expense is linked as an EMI, revert the installment
  // back to scheduled. Prepayment links keep the prepayment row intact (user
  // deletes via loan detail if needed).
  try {
    const { onExpenseDeletedOrRestored: onLoanDel } = await import(
      "./expense-loan-link"
    );
    await onLoanDel(id);
  } catch (e) {
    logger.warn("expense-loan-link cleanup failed (non-fatal)", e);
  }

  // v17.2.0 — if this expense was auto-linked to a loan installment, unlink it.
  try {
    const { onLinkedExpenseDeleted } = await import("./loan-sms-matcher");
    await onLinkedExpenseDeleted(id);
  } catch (e) {
    logger.warn("loan-sms-matcher unlink failed (non-fatal)", e);
  }

  bumpDataVersion();
}

/**
 * Permanently delete an expense from the database (hard delete).
 * Clears foreign key references from other tables/self-refs before deleting.
 * Used by recycle bin purge.
 *
 * Runs inside a single transaction so a partial failure doesn't leave the
 * DB with dangling FK pointers.
 */
export async function permanentlyDeleteExpense(id: string): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    // Save the split hisaab entry ID before clearing the FK on the expense
    const splitEntry = await db.getFirstAsync<{ split_hisaab_entry_id: string | null }>(
      "SELECT split_hisaab_entry_id FROM expenses WHERE id = ?;",
      id,
    );
    // Capture split-tender group membership so we can tidy up after the delete
    const groupRow = await db.getFirstAsync<{ purchase_group_id: string | null }>(
      "SELECT purchase_group_id FROM expenses WHERE id = ?;",
      id,
    );
    // Clear the expense's own FK to hisaab_entries FIRST (so deleting the entry won't violate FK)
    if (splitEntry?.split_hisaab_entry_id) {
      await db.runAsync(
        "UPDATE expenses SET split_hisaab_entry_id = NULL WHERE id = ?;",
        id,
      );
      await db.runAsync(
        "DELETE FROM hisaab_entries WHERE id = ?;",
        splitEntry.split_hisaab_entry_id,
      );
    }
    // Delete multi-split records and their linked hisaab entries
    const multiSplitEntries = await db.getAllAsync<{ hisaab_entry_id: string | null }>(
      "SELECT hisaab_entry_id FROM expense_splits WHERE expense_id = ?;",
      id,
    );
    for (const s of multiSplitEntries) {
      if (s.hisaab_entry_id) {
        await db.runAsync("DELETE FROM hisaab_entries WHERE id = ?;", s.hisaab_entry_id);
      }
    }
    await db.runAsync("DELETE FROM expense_splits WHERE expense_id = ?;", id);
    // Clear FK references that would block DELETE
    await db.runAsync("UPDATE expenses SET refund_of_expense_id = NULL WHERE refund_of_expense_id = ?;", id);
    await db.runAsync("UPDATE expenses SET matched_forecast_id = NULL WHERE matched_forecast_id = ?;", id);
    await db.runAsync("DELETE FROM pending_sms WHERE expense_id = ?;", id);
    // v15.12.0: drop any "linked settlement" hisaab rows tied to this expense —
    // their only reason for existing was the bond to this credit.
    await db.runAsync(
      `DELETE FROM hisaab_entries
       WHERE linked_expense_id = ? AND type = 'settlement' AND settlement_source = 'linked';`,
      id,
    );
    await db.runAsync("UPDATE hisaab_entries SET linked_expense_id = NULL WHERE linked_expense_id = ?;", id);
    // If this expense is the source of a recurring rule, the DB FK
    // (recurring_expense_rules.source_expense_id → expenses.id ON DELETE CASCADE)
    // takes the rule row with us. But forecasts materialized from that rule
    // still carry the deleted rule's id in expenses.recurring_rule_id
    // (plain stamp, not an FK) — clear those stamps so the orphan forecasts
    // don't look like they belong to a phantom rule.
    await db.runAsync(
      `UPDATE expenses SET recurring_rule_id = NULL
       WHERE recurring_rule_id IN (
         SELECT id FROM recurring_expense_rules WHERE source_expense_id = ?
       );`,
      id,
    );
    // Legacy column: pre-migration-005 hisaab entries point at the same id via linked_account_credit_id.
    await db.runAsync("UPDATE hisaab_entries SET linked_account_credit_id = NULL WHERE linked_account_credit_id = ?;", id);
    // account_transfers can reference an expense as either the forecast or the realized side (migration 001:516-517)
    await db.runAsync("UPDATE account_transfers SET linked_forecast_id = NULL WHERE linked_forecast_id = ?;", id);
    await db.runAsync("UPDATE account_transfers SET linked_expense_id = NULL WHERE linked_expense_id = ?;", id);
    // Guardrail (v14.8.0): reminder_fulfillments.expense_id is a plain column
    // with a UNIQUE constraint but NO FK — nothing cascades when the expense
    // is hard-deleted. Clear the fulfillment row explicitly so audit history
    // doesn't point at a phantom expense id.
    await db.runAsync("DELETE FROM reminder_fulfillments WHERE expense_id = ?;", id);
    // expense_edit_history.expense_id has no FK — clear explicitly or the row
    // becomes a ghost entry the Edit History screen would otherwise still show.
    await db.runAsync("DELETE FROM expense_edit_history WHERE expense_id = ?;", id);
    // expense_tags has ON DELETE CASCADE — handled automatically
    await db.runAsync("DELETE FROM expenses WHERE id = ?;", id);

    // Tidy split-tender group: if the deleted row was one leg of a group,
    // and only one live leg remains, unlink that leg (a 1-leg "group" is
    // meaningless). Soft-deleted siblings still count as members, so we
    // only check live rows.
    if (groupRow?.purchase_group_id) {
      const remaining = await db.getAllAsync<{ id: string }>(
        "SELECT id FROM expenses WHERE purchase_group_id = ? AND deleted_at IS NULL;",
        groupRow.purchase_group_id,
      );
      if (remaining.length <= 1) {
        await db.runAsync(
          "UPDATE expenses SET purchase_group_id = NULL, updated_at = datetime('now') WHERE purchase_group_id = ?;",
          groupRow.purchase_group_id,
        );
      }
    }
  });
  bumpDataVersion();
}

/**
 * Restore a soft-deleted expense.
 */
export async function restoreExpense(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "UPDATE expenses SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?;",
    id,
  );
  // v17.0.0 — if restored expense had an active investment link, re-credit bucket.
  try {
    const { onExpenseDeletedOrRestored } = await import(
      "./expense-investment-link"
    );
    await onExpenseDeletedOrRestored(id);
  } catch (e) {
    logger.warn("expense-investment-link restore failed (non-fatal)", e);
  }
  // v17.4.0 — if restored expense is a loan EMI link, re-mark installment paid.
  try {
    const { onExpenseDeletedOrRestored: onLoanRestore } = await import(
      "./expense-loan-link"
    );
    await onLoanRestore(id);
  } catch (e) {
    logger.warn("expense-loan-link restore failed (non-fatal)", e);
  }
  bumpDataVersion();
}

/**
 * Get all soft-deleted expenses (recycle bin).
 * Excludes credits — those live in a dedicated "Credits" section in the recycle bin
 * and are fetched via getDeletedCredits() in services/account-credit.ts.
 */
export async function getDeletedExpenses(userId: string): Promise<Expense[]> {
  const db = getDatabase();
  return db.getAllAsync<Expense>(
    `SELECT * FROM expenses
     WHERE user_id = ? AND deleted_at IS NOT NULL AND nature != 'credit'
     ORDER BY deleted_at DESC;`,
    userId,
  );
}

/**
 * Get all rejected expenses (not deleted).
 * Excludes credits — rejected credits are surfaced via the credits section.
 */
export async function getRejectedExpenses(userId: string): Promise<Expense[]> {
  const db = getDatabase();
  return db.getAllAsync<Expense>(
    `SELECT * FROM expenses
     WHERE user_id = ? AND status = 'rejected' AND deleted_at IS NULL AND nature != 'credit'
     ORDER BY updated_at DESC;`,
    userId,
  );
}

/**
 * Permanently delete all expenses that were soft-deleted more than N days ago.
 * Pass daysOld=0 to purge ALL soft-deleted expenses regardless of age.
 * Clears foreign key references before deleting.
 */
export async function purgeOldDeletedExpenses(userId: string, daysOld = 30): Promise<number> {
  const db = getDatabase();
  // Build the target condition for soft-deleted expenses
  const condition = daysOld === 0
    ? "user_id = ? AND deleted_at IS NOT NULL"
    : "user_id = ? AND deleted_at IS NOT NULL AND deleted_at < datetime('now', '-' || ? || ' days')";
  const params = daysOld === 0 ? [userId] : [userId, daysOld];

  let changes = 0;
  await db.withTransactionAsync(async () => {
    // Collect split hisaab entry IDs (legacy binary-split via expenses.split_hisaab_entry_id) before clearing FKs
    const splitEntryRows = await db.getAllAsync<{ split_hisaab_entry_id: string }>(
      `SELECT split_hisaab_entry_id FROM expenses WHERE ${condition} AND split_hisaab_entry_id IS NOT NULL;`,
      ...params,
    );
    // Collect multi-split hisaab entry IDs (via expense_splits.hisaab_entry_id) before cascade
    const multiSplitRows = await db.getAllAsync<{ hisaab_entry_id: string }>(
      `SELECT es.hisaab_entry_id FROM expense_splits es
       WHERE es.expense_id IN (SELECT id FROM expenses WHERE ${condition})
         AND es.hisaab_entry_id IS NOT NULL;`,
      ...params,
    );

    // Clear the expense FK to hisaab_entries FIRST
    await db.runAsync(`UPDATE expenses SET split_hisaab_entry_id = NULL WHERE ${condition} AND split_hisaab_entry_id IS NOT NULL;`, ...params);
    // Now safe to delete orphaned hisaab entries from binary splits
    for (const row of splitEntryRows) {
      await db.runAsync("DELETE FROM hisaab_entries WHERE id = ?;", row.split_hisaab_entry_id);
    }

    // Cascade multi-split child rows + their linked hisaab entries
    for (const row of multiSplitRows) {
      await db.runAsync("DELETE FROM hisaab_entries WHERE id = ?;", row.hisaab_entry_id);
    }
    await db.runAsync(
      `DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE ${condition});`,
      ...params,
    );

    // Clear FK references pointing to expenses we're about to delete
    await db.runAsync(`UPDATE expenses SET refund_of_expense_id = NULL WHERE refund_of_expense_id IN (SELECT id FROM expenses WHERE ${condition});`, ...params);
    await db.runAsync(`UPDATE expenses SET matched_forecast_id = NULL WHERE matched_forecast_id IN (SELECT id FROM expenses WHERE ${condition});`, ...params);
    await db.runAsync(`UPDATE pending_sms SET expense_id = NULL WHERE expense_id IN (SELECT id FROM expenses WHERE ${condition});`, ...params);
    // v15.12.0: drop "linked settlement" rows before unlinking — same reason
    // as the single-row permanentlyDeleteExpense path.
    await db.runAsync(
      `DELETE FROM hisaab_entries
       WHERE linked_expense_id IN (SELECT id FROM expenses WHERE ${condition})
         AND type = 'settlement' AND settlement_source = 'linked';`,
      ...params,
    );
    await db.runAsync(`UPDATE hisaab_entries SET linked_expense_id = NULL WHERE linked_expense_id IN (SELECT id FROM expenses WHERE ${condition});`, ...params);
    // Legacy column: pre-migration-005 hisaab entries may still reference these via linked_account_credit_id.
    await db.runAsync(`UPDATE hisaab_entries SET linked_account_credit_id = NULL WHERE linked_account_credit_id IN (SELECT id FROM expenses WHERE ${condition});`, ...params);
    // v15.11.1: missing from pre-v15.11.1 bulk delete — caused FK
    // constraint failures whenever a recycled expense was referenced by
    // an account_transfer (either as linked_forecast_id or linked_expense_id)
    // or by a reminder_fulfillment. Single-row permanentlyDeleteExpense
    // already cleared these; bulk path now mirrors that exactly.
    await db.runAsync(`UPDATE account_transfers SET linked_forecast_id = NULL WHERE linked_forecast_id IN (SELECT id FROM expenses WHERE ${condition});`, ...params);
    await db.runAsync(`UPDATE account_transfers SET linked_expense_id = NULL WHERE linked_expense_id IN (SELECT id FROM expenses WHERE ${condition});`, ...params);
    await db.runAsync(`DELETE FROM reminder_fulfillments WHERE expense_id IN (SELECT id FROM expenses WHERE ${condition});`, ...params);
    // expense_edit_history.expense_id has no FK — clear explicitly, mirroring
    // the single-row permanentlyDeleteExpense path.
    await db.runAsync(`DELETE FROM expense_edit_history WHERE expense_id IN (SELECT id FROM expenses WHERE ${condition});`, ...params);
    // If any recycled expenses are the source of a recurring rule, the
    // rule row cascades via ON DELETE CASCADE. But forecasts materialized
    // from those rules still carry a recurring_rule_id stamp (plain column,
    // not FK) — clear those stamps so the orphan forecasts don't look
    // like they belong to a phantom rule.
    await db.runAsync(
      `UPDATE expenses SET recurring_rule_id = NULL
       WHERE recurring_rule_id IN (
         SELECT id FROM recurring_expense_rules
         WHERE source_expense_id IN (SELECT id FROM expenses WHERE ${condition})
       );`,
      ...params,
    );

    const result = await db.runAsync(`DELETE FROM expenses WHERE ${condition};`, ...params);
    changes = result.changes;
  });

  if (changes > 0) bumpDataVersion();
  return changes;
}

/**
 * Restore all soft-deleted expenses for a user.
 */
export async function restoreAllDeletedExpenses(userId: string): Promise<number> {
  const db = getDatabase();
  const result = await db.runAsync(
    "UPDATE expenses SET deleted_at = NULL, updated_at = datetime('now') WHERE user_id = ? AND deleted_at IS NOT NULL;",
    userId,
  );
  if (result.changes > 0) bumpDataVersion();
  return result.changes;
}

/**
 * Bulk-approve all rejected expenses for a user.
 */
export async function approveAllRejectedExpenses(userId: string): Promise<number> {
  const db = getDatabase();
  const result = await db.runAsync(
    "UPDATE expenses SET status = 'approved', updated_at = datetime('now') WHERE user_id = ? AND status = 'rejected' AND deleted_at IS NULL;",
    userId,
  );
  if (result.changes > 0) bumpDataVersion();
  return result.changes;
}

/**
 * Soft-delete all rejected expenses for a user.
 * Clears pending_sms references so rescan can re-detect.
 */
export async function deleteAllRejectedExpenses(userId: string): Promise<number> {
  const db = getDatabase();
  // Clear SMS tracking so rescan re-detects
  await db.runAsync(
    "DELETE FROM pending_sms WHERE expense_id IN (SELECT id FROM expenses WHERE user_id = ? AND status = 'rejected' AND deleted_at IS NULL);",
    userId,
  );
  const result = await db.runAsync(
    "UPDATE expenses SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ? AND status = 'rejected' AND deleted_at IS NULL;",
    userId,
  );
  if (result.changes > 0) bumpDataVersion();
  return result.changes;
}

/**
 * Approve an expense — sets status to 'approved'.
 *
 * For credit rows (nature='credit') without an account link, re-parses the
 * original SMS body to discover/create the financial account and link it.
 * This is the user's first confirmation that the credit is real, so we only
 * touch account records here (not at SMS-ingest time).
 */
export async function approveExpense(id: string): Promise<void> {
  const db = getDatabase();

  const row = await db.getFirstAsync<{
    user_id: string;
    nature: string;
    account_id: string | null;
    raw_source_text: string | null;
    source: string;
  }>(
    `SELECT user_id, nature, account_id, raw_source_text, source FROM expenses WHERE id = ?;`,
    id,
  );

  if (row && row.nature === "credit" && !row.account_id && row.source === "sms_auto" && row.raw_source_text) {
    try {
      const parsed = parseBankSMS(row.raw_source_text);
      if (parsed && parsed.cardLast4) {
        const { discoverOrUpdateAccount, linkExpenseToAccount } = await import("@/services/financial-account");
        const accountId = await discoverOrUpdateAccount(row.user_id, parsed);
        if (accountId) {
          await db.runAsync(`UPDATE expenses SET account_id = ? WHERE id = ?;`, accountId, id);
        } else {
          await linkExpenseToAccount(row.user_id, id, parsed.cardLast4, parsed.bank, parsed.accountNickname);
        }
      }
    } catch (e) {
      logger.error("approveExpense: failed to resolve account for credit", e);
    }
  }

  await db.runAsync(
    `UPDATE expenses SET status = 'approved', updated_at = datetime('now') WHERE id = ?;`,
    id,
  );
  bumpDataVersion();

  if (row && row.nature === "credit") {
    const refundRow = await db.getFirstAsync<{ refund_of_expense_id: string | null; amount: number }>(
      `SELECT refund_of_expense_id, amount FROM expenses WHERE id = ?;`,
      id,
    );
    if (refundRow?.refund_of_expense_id) {
      try {
        const { adjustSplitAfterRefund } = await import("./expense-splits");
        await adjustSplitAfterRefund(refundRow.refund_of_expense_id, refundRow.amount);
      } catch (e) {
        logger.warn("approveExpense: adjustSplitAfterRefund failed (non-fatal):", e);
      }
    }
  }
}

/**
 * Reject an expense — sets status to 'rejected'.
 */
export async function rejectExpense(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE expenses SET status = 'rejected', updated_at = datetime('now') WHERE id = ?;`,
    id,
  );
  bumpDataVersion();
}

/**
 * v17.5.4 — bulk approve/reject. Replaces the N serial UPDATE round-trips
 * the review queue was doing inside for-loops. One UPDATE ... IN (...) plus
 * (for approve) one parallel pass to resolve pending CC account links.
 *
 * Note: account-resolution for unlinked credits (in approveExpense) still
 * runs per-row because it calls discoverOrUpdateAccount; wrapped in
 * Promise.all so they run in parallel rather than serial.
 */
export async function approveExpenses(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDatabase();

  // Find credits that still need account linking
  const placeholders = ids.map(() => "?").join(",");
  const needsLink = await db.getAllAsync<{
    id: string;
    user_id: string;
    raw_source_text: string | null;
  }>(
    `SELECT id, user_id, raw_source_text FROM expenses
     WHERE id IN (${placeholders})
       AND nature = 'credit' AND account_id IS NULL
       AND source = 'sms_auto' AND raw_source_text IS NOT NULL;`,
    ...ids,
  );

  await Promise.all(
    needsLink.map(async (row) => {
      try {
        if (!row.raw_source_text) return;
        const parsed = parseBankSMS(row.raw_source_text);
        if (parsed && parsed.cardLast4) {
          const { discoverOrUpdateAccount } = await import(
            "@/services/financial-account"
          );
          const accountId = await discoverOrUpdateAccount(row.user_id, parsed);
          if (accountId) {
            await db.runAsync(
              `UPDATE expenses SET account_id = ? WHERE id = ?;`,
              accountId,
              row.id,
            );
          }
        }
      } catch (e) {
        logger.warn("approveExpenses: account resolve failed (non-fatal)", e);
      }
    }),
  );

  await db.runAsync(
    `UPDATE expenses SET status = 'approved', updated_at = datetime('now')
     WHERE id IN (${placeholders});`,
    ...ids,
  );
  bumpDataVersion();

  const refundLinks = await db.getAllAsync<{ id: string; refund_of_expense_id: string; amount: number }>(
    `SELECT id, refund_of_expense_id, amount FROM expenses
     WHERE id IN (${placeholders})
       AND nature = 'credit'
       AND refund_of_expense_id IS NOT NULL;`,
    ...ids,
  );
  if (refundLinks.length > 0) {
    const { adjustSplitAfterRefund } = await import("./expense-splits");
    await Promise.all(
      refundLinks.map(async (r) => {
        try {
          await adjustSplitAfterRefund(r.refund_of_expense_id, r.amount);
        } catch (e) {
          logger.warn("approveExpenses: adjustSplitAfterRefund failed (non-fatal):", e);
        }
      }),
    );
  }
}

export async function rejectExpenses(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDatabase();
  const placeholders = ids.map(() => "?").join(",");
  await db.runAsync(
    `UPDATE expenses SET status = 'rejected', updated_at = datetime('now')
     WHERE id IN (${placeholders});`,
    ...ids,
  );
  bumpDataVersion();
}

/**
 * Undo a previously recorded refund — soft-deletes the credit row so the
 * parent expense returns to its un-refunded (or partially-refunded) state.
 * Also reverses the hisaab entry adjustment that was made when the refund
 * was originally approved (for split expenses).
 */
export async function undoRefund(refundCreditId: string): Promise<void> {
  const db = getDatabase();
  const refundRow = await db.getFirstAsync<{ id: string; amount: number; refund_of_expense_id: string }>(
    `SELECT id, amount, refund_of_expense_id FROM expenses
     WHERE id = ? AND nature = 'credit' AND refund_of_expense_id IS NOT NULL AND deleted_at IS NULL;`,
    refundCreditId,
  );
  if (!refundRow) throw new Error("Refund not found or already removed");

  await db.runAsync(
    `UPDATE expenses SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?;`,
    refundCreditId,
  );

  // For split expenses: reverse the hisaab entry reduction that adjustSplitAfterRefund applied.
  const originalExpense = await db.getFirstAsync<{
    split_hisaab_entry_id: string | null;
    split_pct: number | null;
    split_original_amount: number | null;
  }>(
    `SELECT split_hisaab_entry_id, split_pct, split_original_amount FROM expenses WHERE id = ? AND deleted_at IS NULL;`,
    refundRow.refund_of_expense_id,
  );

  if (originalExpense?.split_hisaab_entry_id && originalExpense.split_pct != null) {
    const otherPct = 1 - originalExpense.split_pct / 100;
    const otherShareToRestore = Math.round(refundRow.amount * otherPct * 100) / 100;

    if (otherShareToRestore > 0) {
      const currentEntry = await db.getFirstAsync<{ amount: number }>(
        `SELECT amount FROM hisaab_entries WHERE id = ?;`,
        originalExpense.split_hisaab_entry_id,
      );

      if (currentEntry) {
        // Cap at the original other-person share so multiple undo operations don't overshoot.
        const originalOtherShare = originalExpense.split_original_amount != null
          ? Math.round(originalExpense.split_original_amount * otherPct * 100) / 100
          : currentEntry.amount + otherShareToRestore;
        const newAmount = Math.min(
          Math.round((currentEntry.amount + otherShareToRestore) * 100) / 100,
          originalOtherShare,
        );
        await db.runAsync(
          `UPDATE hisaab_entries SET amount = ?, updated_at = datetime('now') WHERE id = ?;`,
          newAmount,
          originalExpense.split_hisaab_entry_id,
        );
      }
    }
  }

  bumpDataVersion();
}

/**
 * Approve a pending CC-repayment credit by running the full Pay flow:
 * deletes the pending credit row, marks the matched forecast paid, creates a
 * savings → CC transfer, and updates CC dues/available.
 *
 * Only valid for credits where matched_forecast_id is a 'repayment' forecast.
 */
export async function approveCcRepaymentCredit(
  creditId: string,
  fromAccountId: string,
): Promise<void> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ matched_forecast_id: string | null; nature: string }>(
    `SELECT matched_forecast_id, nature FROM expenses WHERE id = ?;`,
    creditId,
  );
  if (!row || row.nature !== "credit" || !row.matched_forecast_id) {
    throw new Error("Not a CC repayment credit with a matched forecast");
  }
  const { markRepaymentAsPaid } = await import("@/services/expense-forecasts");
  await markRepaymentAsPaid(row.matched_forecast_id, fromAccountId);
  // The pending credit row is redundant now — the transfer carries the ledger
  // math. Soft-delete so it disappears from the review queue and ledger.
  await db.runAsync(
    `UPDATE expenses SET deleted_at = datetime('now'), updated_at = datetime('now'), status = 'rejected' WHERE id = ?;`,
    creditId,
  );
  bumpDataVersion();
}

/**
 * Bulk-assign a category to multiple expenses by ID.
 * Returns the number of expenses updated.
 */
export async function bulkAssignCategory(
  expenseIds: string[],
  categoryId: string,
): Promise<number> {
  if (expenseIds.length === 0) return 0;
  const db = getDatabase();
  const placeholders = expenseIds.map(() => "?").join(",");
  const result = await db.runAsync(
    `UPDATE expenses SET category_id = ?, updated_at = datetime('now') WHERE id IN (${placeholders});`,
    categoryId,
    ...expenseIds,
  );
  if (result.changes > 0) bumpDataVersion();
  return result.changes;
}

/**
 * Re-map expenses to current categories and payment modes.
 *
 * Useful when expenses were imported before master data was set up:
 *   - Expenses with null/Unknown category get re-categorized using merchant name
 *   - Expenses with null payment_mode_id get re-mapped using raw SMS body
 *
 * Only touches expenses that are missing data — never overwrites user edits.
 */
export async function remapExpenses(
  userId: string,
): Promise<{ categorized: number; paymentMapped: number }> {
  const db = getDatabase();
  let categorized = 0;
  let paymentMapped = 0;

  // Find the "Unknown" category ID so we can also re-map those
  const unknownCat = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM categories WHERE user_id = ? AND name = 'Unknown' AND is_active = 1;",
    userId,
  );
  const unknownCatId = unknownCat?.id ?? null;

  // ── Re-map categories ──
  // Expenses with null category OR mapped to "Unknown" that have a merchant name
  const unmappedCat = await db.getAllAsync<{ id: string; merchant_name: string }>(
    `SELECT id, merchant_name FROM expenses
     WHERE user_id = ? AND deleted_at IS NULL
       AND merchant_name IS NOT NULL AND merchant_name != ''
       AND (category_id IS NULL ${unknownCatId ? "OR category_id = ?" : ""})
     ORDER BY date DESC;`,
    ...(unknownCatId ? [userId, unknownCatId] : [userId]),
  );

  await db.withTransactionAsync(async () => {
    for (const row of unmappedCat) {
      const result = await categorizeByMerchant(userId, row.merchant_name);
      if (result.categoryId && result.source !== "fallback") {
        await db.runAsync(
          "UPDATE expenses SET category_id = ?, updated_at = datetime('now') WHERE id = ?;",
          result.categoryId,
          row.id,
        );
        categorized++;
      }
    }
  });

  // ── Re-map payment modes ──
  // SMS expenses with null payment_mode_id that have raw_source_text
  const unmappedPM = await db.getAllAsync<{ id: string; raw_source_text: string }>(
    `SELECT id, raw_source_text FROM expenses
     WHERE user_id = ? AND deleted_at IS NULL
       AND payment_mode_id IS NULL
       AND source = 'sms_auto'
       AND raw_source_text IS NOT NULL
     ORDER BY date DESC;`,
    userId,
  );

  await db.withTransactionAsync(async () => {
    for (const row of unmappedPM) {
      const parsed = parseBankSMS(row.raw_source_text);
      if (!parsed) return;

      const modeType = inferPaymentMode(parsed, row.raw_source_text);
      if (!modeType) return;

      const mode = await findPaymentModeByType(userId, modeType);
      if (mode) {
        await db.runAsync(
          "UPDATE expenses SET payment_mode_id = ?, updated_at = datetime('now') WHERE id = ?;",
          mode.id,
          row.id,
        );
        paymentMapped++;
      }
    }
  });

  if (categorized > 0 || paymentMapped > 0) {
    bumpDataVersion();
  }

  return { categorized, paymentMapped };
}
