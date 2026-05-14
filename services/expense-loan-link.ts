/**
 * Expense ↔ Loan Payment linking (v17.4.0).
 *
 * Mirrors expense-investment-link.ts. An expense can be marked as either:
 *   - kind='emi'        → links to a specific loan_schedule_entries row,
 *                         marks that installment `paid`.
 *   - kind='prepayment' → creates a loan_prepayments row + cross-link. On
 *                         link, the schedule is regenerated from the
 *                         prepayment onwards.
 *
 * 1:1 with expense (UNIQUE expense_id).
 *
 * Guards:
 *   - Only realized expenses (nature='realized').
 *   - Rejects split-tender legs, multi-split / single-split sources.
 *   - Rejects refunds.
 *   - Rejects expenses already linked to an investment bucket (one kind of
 *     link per expense is the clean story).
 *
 * Cascade:
 *   - expense soft-delete → schedule entry reverts to 'scheduled', unlinks
 *     from prepayment.
 *   - expense hard-delete → FK CASCADE drops the link row; if kind='emi',
 *     schedule entry needs an unlink pass; if kind='prepayment', prepayment
 *     stays (historical truth) but is no longer tied to an expense.
 */

import { getDatabase } from "@/database";
import { recordPrepayment } from "@/services/loan-accounts";
import { bumpDataVersion } from "@/services/settings";
import { generateUUID } from "@/utils/uuid";

// ─── Types ────────────────────────────────────────────────

export type LoanLinkKind = "emi" | "prepayment";

export interface ExpenseLoanLink {
  id: string;
  expense_id: string;
  loan_account_id: string;
  link_kind: LoanLinkKind;
  schedule_entry_id: string | null;
  prepayment_id: string | null;
  amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export class LoanLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoanLinkError";
  }
}

// ─── Read ─────────────────────────────────────────────────

export async function getLoanLinkForExpense(
  expenseId: string,
): Promise<ExpenseLoanLink | null> {
  const db = getDatabase();
  return db.getFirstAsync<ExpenseLoanLink>(
    "SELECT * FROM expense_loan_links WHERE expense_id = ?;",
    expenseId,
  );
}

export async function getLinkedExpenseIdsForLoan(
  loanAccountId: string,
): Promise<Set<string>> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ expense_id: string }>(
    `SELECT l.expense_id FROM expense_loan_links l
     JOIN expenses e ON e.id = l.expense_id
     WHERE l.loan_account_id = ? AND e.deleted_at IS NULL;`,
    loanAccountId,
  );
  return new Set(rows.map((r) => r.expense_id));
}

/** All loan-linked expense IDs for a user (budget + insights exclusion). */
export async function getAllLoanLinkedExpenseIds(userId: string): Promise<Set<string>> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ expense_id: string }>(
    `SELECT l.expense_id FROM expense_loan_links l
     JOIN expenses e ON e.id = l.expense_id
     WHERE e.user_id = ? AND e.deleted_at IS NULL;`,
    userId,
  );
  return new Set(rows.map((r) => r.expense_id));
}

// ─── Link as EMI ──────────────────────────────────────────

/**
 * Mark an expense as an EMI payment against a specific scheduled installment.
 * Flags the installment `paid` + stores the cross-link.
 */
export async function linkExpenseAsEMI(
  expenseId: string,
  loanAccountId: string,
  scheduleEntryId: string,
): Promise<string> {
  const db = getDatabase();
  await runCommonGuards(expenseId);

  // Verify the schedule entry is on this loan and still scheduled
  const entry = await db.getFirstAsync<{
    id: string;
    loan_account_id: string;
    status: string;
    emi_amount: number;
  }>(
    "SELECT id, loan_account_id, status, emi_amount FROM loan_schedule_entries WHERE id = ?;",
    scheduleEntryId,
  );
  if (!entry) throw new LoanLinkError("Scheduled installment not found");
  if (entry.loan_account_id !== loanAccountId)
    throw new LoanLinkError("Installment doesn't belong to that loan");
  if (entry.status !== "scheduled")
    throw new LoanLinkError("That installment is already paid or prepaid");

  const expense = await db.getFirstAsync<{ amount: number; date: string }>(
    "SELECT amount, date FROM expenses WHERE id = ?;",
    expenseId,
  );
  if (!expense) throw new LoanLinkError("Expense not found");

  const id = generateUUID();
  await db.runAsync(
    `INSERT INTO expense_loan_links (
       id, expense_id, loan_account_id, link_kind, schedule_entry_id, amount
     ) VALUES (?, ?, ?, 'emi', ?, ?);`,
    id,
    expenseId,
    loanAccountId,
    scheduleEntryId,
    expense.amount,
  );

  await db.runAsync(
    `UPDATE loan_schedule_entries
     SET status = 'paid', linked_expense_id = ?, paid_date = ?, paid_amount = ?
     WHERE id = ?;`,
    expenseId,
    expense.date,
    expense.amount,
    scheduleEntryId,
  );

  bumpDataVersion();
  return id;
}

// ─── Link as Prepayment ───────────────────────────────────

/**
 * Mark an expense as a prepayment against a loan. Creates the prepayment
 * row (which regenerates the schedule) + stores the cross-link.
 */
export async function linkExpenseAsPrepayment(
  expenseId: string,
  loanAccountId: string,
  params: {
    strategy: "reduce_tenure" | "reduce_emi";
    prepayment_charge?: number;
    gst_on_charge?: number;
    kind?: "part_payment" | "foreclosure";
  },
): Promise<string> {
  const db = getDatabase();
  await runCommonGuards(expenseId);

  const expense = await db.getFirstAsync<{ amount: number; date: string }>(
    "SELECT amount, date FROM expenses WHERE id = ?;",
    expenseId,
  );
  if (!expense) throw new LoanLinkError("Expense not found");

  // Create the prepayment through the existing service (regenerates schedule)
  const prepaymentId = await recordPrepayment(loanAccountId, {
    prepayment_date: expense.date,
    amount: expense.amount,
    prepayment_charge: params.prepayment_charge ?? 0,
    gst_on_charge: params.gst_on_charge ?? 0,
    kind: params.kind ?? "part_payment",
    strategy: params.strategy,
    linked_expense_id: expenseId,
  });

  const id = generateUUID();
  await db.runAsync(
    `INSERT INTO expense_loan_links (
       id, expense_id, loan_account_id, link_kind, prepayment_id, amount
     ) VALUES (?, ?, ?, 'prepayment', ?, ?);`,
    id,
    expenseId,
    loanAccountId,
    prepaymentId,
    expense.amount,
  );

  bumpDataVersion();
  return id;
}

// ─── Unlink ───────────────────────────────────────────────

export async function unlinkExpenseFromLoan(expenseId: string): Promise<void> {
  const db = getDatabase();
  const link = await getLoanLinkForExpense(expenseId);
  if (!link) return;

  if (link.link_kind === "emi" && link.schedule_entry_id) {
    await db.runAsync(
      `UPDATE loan_schedule_entries
       SET status = 'scheduled', linked_expense_id = NULL, paid_date = NULL, paid_amount = NULL
       WHERE id = ?;`,
      link.schedule_entry_id,
    );
    await db.runAsync("DELETE FROM expense_loan_links WHERE expense_id = ?;", expenseId);
  } else if (link.link_kind === "prepayment" && link.prepayment_id) {
    // v17.5.14 — unlinking a prepayment-linked expense now fully reverses
    // the prepayment: drops loan_prepayments row + rebuilds the schedule
    // (via deletePrepayment) + reopens the loan if it was a foreclosure.
    // Previously only dropped the cross-link, leaving a phantom prepayment
    // on the loan with no way to undo its schedule effect.
    const { deletePrepayment } = await import("./loan-accounts");
    await deletePrepayment(link.prepayment_id);
    // deletePrepayment already deletes expense_loan_links WHERE prepayment_id = ?
  } else {
    // Defensive: drop the link row even if it's malformed (missing FKs).
    await db.runAsync("DELETE FROM expense_loan_links WHERE expense_id = ?;", expenseId);
  }

  bumpDataVersion();
}

/**
 * Called from expense-crud.ts on soft-delete or restore. For EMI links, toggles
 * the installment status. For prepayment links, no-op — the prepayment row
 * stays authoritative.
 */
export async function onExpenseDeletedOrRestored(expenseId: string): Promise<void> {
  const db = getDatabase();
  const link = await getLoanLinkForExpense(expenseId);
  if (!link) return;

  const expense = await db.getFirstAsync<{ deleted_at: string | null }>(
    "SELECT deleted_at FROM expenses WHERE id = ?;",
    expenseId,
  );
  if (!expense) return;

  if (link.link_kind === "emi" && link.schedule_entry_id) {
    if (expense.deleted_at) {
      await db.runAsync(
        `UPDATE loan_schedule_entries
         SET status = 'scheduled', linked_expense_id = NULL, paid_date = NULL, paid_amount = NULL
         WHERE id = ?;`,
        link.schedule_entry_id,
      );
    } else {
      // Restored — re-mark as paid
      const exp = await db.getFirstAsync<{ amount: number; date: string }>(
        "SELECT amount, date FROM expenses WHERE id = ?;",
        expenseId,
      );
      if (exp) {
        await db.runAsync(
          `UPDATE loan_schedule_entries
           SET status = 'paid', linked_expense_id = ?, paid_date = ?, paid_amount = ?
           WHERE id = ?;`,
          expenseId,
          exp.date,
          exp.amount,
          link.schedule_entry_id,
        );
      }
    }
  }

  bumpDataVersion();
}

// ─── Internal guards ──────────────────────────────────────

async function runCommonGuards(expenseId: string): Promise<void> {
  const db = getDatabase();
  const expense = await db.getFirstAsync<{
    id: string;
    nature: string;
    deleted_at: string | null;
    refund_of_expense_id: string | null;
    purchase_group_id: string | null;
  }>(
    "SELECT id, nature, deleted_at, refund_of_expense_id, purchase_group_id FROM expenses WHERE id = ?;",
    expenseId,
  );
  if (!expense) throw new LoanLinkError("Expense not found");
  if (expense.deleted_at) throw new LoanLinkError("Cannot link a deleted expense");
  if (expense.nature !== "realized")
    throw new LoanLinkError("Only realized expenses can be linked to a loan");
  if (expense.refund_of_expense_id)
    throw new LoanLinkError("Refunds cannot be linked to a loan");
  if (expense.purchase_group_id)
    throw new LoanLinkError("Split-tender expenses can't be linked");

  const splitCheck = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM expense_splits WHERE expense_id = ?;",
    expenseId,
  );
  if (splitCheck && splitCheck.count > 0)
    throw new LoanLinkError("Split expenses can't be linked");

  const existingLoanLink = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM expense_loan_links WHERE expense_id = ?;",
    expenseId,
  );
  if (existingLoanLink)
    throw new LoanLinkError("Expense is already linked to a loan payment");

  const existingInvLink = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM expense_investment_links WHERE expense_id = ?;",
    expenseId,
  );
  if (existingInvLink)
    throw new LoanLinkError(
      "Expense is already marked as an investment. Unlink that first.",
    );

  // Check for existing transfer link (incompatible)
  const transferLink = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM account_transfers WHERE linked_expense_id = ?;",
    expenseId,
  );
  if (transferLink)
    throw new LoanLinkError(
      "Expense is already linked to a transfer. Remove the transfer link first.",
    );
}
