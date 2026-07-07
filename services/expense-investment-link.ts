/**
 * Expense ↔ Investment Bucket linking (v17.0.0).
 *
 * Promotes a regular realized expense to an "investment contribution" to any
 * active Investment Bucket — no demat path required. Feeds the same
 * bucket.current_contributed field as the v14.4.0 demat-transfer path.
 *
 * Rules:
 *   - 1:1 with expenses (UNIQUE expense_id).
 *   - Only realized expenses (nature='realized'); rejects forecasts.
 *   - Rejects split-tender legs and multi-split / single-split sources in v1.
 *   - Refunds on a linked expense reduce the bucket via the existing refund
 *     cascade (expense.refund_of_expense_id → bucket recompute).
 *   - Soft-delete of expense → contribution removed from bucket (recompute
 *     join filters deleted_at IS NULL). Restore re-credits it.
 *   - Hard-delete → CASCADE drops the link row; bucket recomputes down.
 */

import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import { _syncLinkedMilestone, recomputeBucketContributed } from "@/services/yearly-plan";
import { generateUUID } from "@/utils/uuid";

// ─── Types ────────────────────────────────────────────────

export interface ExpenseInvestmentLink {
  id: string;
  expense_id: string;
  investment_bucket_id: string;
  contribution_amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Read ─────────────────────────────────────────────────

export async function getLinkForExpense(
  expenseId: string,
): Promise<ExpenseInvestmentLink | null> {
  const db = getDatabase();
  return db.getFirstAsync<ExpenseInvestmentLink>(
    "SELECT * FROM expense_investment_links WHERE expense_id = ?;",
    expenseId,
  );
}

export async function getLinksForBucket(
  bucketId: string,
): Promise<ExpenseInvestmentLink[]> {
  const db = getDatabase();
  return db.getAllAsync<ExpenseInvestmentLink>(
    `SELECT l.* FROM expense_investment_links l
     JOIN expenses e ON e.id = l.expense_id
     WHERE l.investment_bucket_id = ? AND e.deleted_at IS NULL
     ORDER BY e.date DESC;`,
    bucketId,
  );
}

export async function getLinksForBucketEnriched(
  bucketId: string,
): Promise<Array<{
  link: ExpenseInvestmentLink;
  expense_date: string;
  expense_merchant: string | null;
  expense_description: string | null;
  expense_amount: number;
}>> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    expense_id: string;
    investment_bucket_id: string;
    contribution_amount: number;
    notes: string | null;
    created_at: string;
    updated_at: string;
    expense_date: string;
    expense_merchant: string | null;
    expense_description: string | null;
    expense_amount: number;
  }>(
    `SELECT l.*, e.date as expense_date, e.merchant_name as expense_merchant,
            e.description as expense_description, e.amount as expense_amount
     FROM expense_investment_links l
     JOIN expenses e ON e.id = l.expense_id
     WHERE l.investment_bucket_id = ? AND e.deleted_at IS NULL
     ORDER BY e.date DESC;`,
    bucketId,
  );
  return rows.map((r) => ({
    link: {
      id: r.id,
      expense_id: r.expense_id,
      investment_bucket_id: r.investment_bucket_id,
      contribution_amount: r.contribution_amount,
      notes: r.notes,
      created_at: r.created_at,
      updated_at: r.updated_at,
    },
    expense_date: r.expense_date,
    expense_merchant: r.expense_merchant,
    expense_description: r.expense_description,
    expense_amount: r.expense_amount,
  }));
}

/**
 * Linked expense IDs for a given month (for budget "Tracked via Buckets" strip).
 * Returns Set of expense IDs to exclude from category totals.
 */
export async function getLinkedExpenseIdsForMonth(
  userId: string,
  yyyymm: string,
): Promise<Set<string>> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ expense_id: string }>(
    `SELECT l.expense_id FROM expense_investment_links l
     JOIN expenses e ON e.id = l.expense_id
     WHERE e.user_id = ? AND substr(e.date, 1, 7) = ? AND e.deleted_at IS NULL;`,
    userId,
    yyyymm,
  );
  return new Set(rows.map((r) => r.expense_id));
}

/** All linked expense IDs, for exclusion in insights/trends. */
export async function getAllLinkedExpenseIds(userId: string): Promise<Set<string>> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ expense_id: string }>(
    `SELECT l.expense_id FROM expense_investment_links l
     JOIN expenses e ON e.id = l.expense_id
     WHERE e.user_id = ? AND e.deleted_at IS NULL;`,
    userId,
  );
  return new Set(rows.map((r) => r.expense_id));
}

// ─── Create / Delete ──────────────────────────────────────

export class InvestmentLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvestmentLinkError";
  }
}

/**
 * Link an expense to an investment bucket.
 *
 * Guards:
 *   - expense exists, not soft-deleted
 *   - expense.nature === 'realized'
 *   - expense is not a credit, refund, or transfer leg
 *   - expense is not part of a split (single-split source OR split-tender leg OR multi-split)
 *   - expense isn't already linked
 */
export async function linkExpenseToBucket(
  expenseId: string,
  bucketId: string,
  notes?: string,
): Promise<string> {
  const db = getDatabase();

  // Fetch expense
  const expense = await db.getFirstAsync<{
    id: string;
    amount: number;
    nature: string;
    deleted_at: string | null;
    refund_of_expense_id: string | null;
    purchase_group_id: string | null;
  }>(
    "SELECT id, amount, nature, deleted_at, refund_of_expense_id, purchase_group_id FROM expenses WHERE id = ?;",
    expenseId,
  );
  if (!expense) throw new InvestmentLinkError("Expense not found");
  if (expense.deleted_at) throw new InvestmentLinkError("Cannot link a deleted expense");
  if (expense.nature !== "realized")
    throw new InvestmentLinkError("Only realized expenses can be linked to a bucket");
  if (expense.refund_of_expense_id)
    throw new InvestmentLinkError("Refunds cannot be linked to a bucket");
  if (expense.purchase_group_id)
    throw new InvestmentLinkError(
      "Split-tender expenses can't be linked. Remove the split first.",
    );

  // Check for existing splits (single-split source via expense_splits table)
  const splitCheck = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM expense_splits WHERE expense_id = ?;",
    expenseId,
  );
  if (splitCheck && splitCheck.count > 0)
    throw new InvestmentLinkError(
      "Split expenses can't be linked. Remove the split first.",
    );

  // Check it's not itself a leg of a split (referenced as owner in another expense)
  // (Handled by purchase_group_id check above.)

  // Already linked to investment bucket?
  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM expense_investment_links WHERE expense_id = ?;",
    expenseId,
  );
  if (existing) throw new InvestmentLinkError("Expense is already linked to a bucket");

  // Check for existing loan link (incompatible)
  const loanLink = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM expense_loan_links WHERE expense_id = ?;",
    expenseId,
  );
  if (loanLink) throw new InvestmentLinkError("Expense is already linked to a loan. Remove the loan link first.");

  // Check for existing transfer link (incompatible)
  const transferLink = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM account_transfers WHERE linked_expense_id = ?;",
    expenseId,
  );
  if (transferLink) throw new InvestmentLinkError("Expense is already linked to a transfer. Remove the transfer link first.");

  // Verify bucket is active
  const bucket = await db.getFirstAsync<{ is_active: number }>(
    "SELECT is_active FROM investment_buckets WHERE id = ?;",
    bucketId,
  );
  if (!bucket) throw new InvestmentLinkError("Bucket not found");
  if (!bucket.is_active) throw new InvestmentLinkError("Bucket is not active");

  const id = generateUUID();
  await db.runAsync(
    `INSERT INTO expense_investment_links (
       id, expense_id, investment_bucket_id, contribution_amount, notes
     ) VALUES (?, ?, ?, ?, ?);`,
    id,
    expenseId,
    bucketId,
    expense.amount,
    notes ?? null,
  );

  await recomputeBucketContributed(bucketId);
  await _syncLinkedMilestone(bucketId);
  bumpDataVersion();

  const statusRow = await db.getFirstAsync<{ status: string }>(
    `SELECT status FROM expenses WHERE id = ?;`, expenseId,
  );
  if (statusRow?.status === "pending_review") {
    const { approveExpense } = await import("@/services/expense-crud");
    await approveExpense(expenseId);
  }

  return id;
}

export async function unlinkExpenseFromBucket(expenseId: string): Promise<void> {
  const db = getDatabase();
  const link = await getLinkForExpense(expenseId);
  if (!link) return;

  await db.runAsync(
    "DELETE FROM expense_investment_links WHERE expense_id = ?;",
    expenseId,
  );

  await recomputeBucketContributed(link.investment_bucket_id);
  await _syncLinkedMilestone(link.investment_bucket_id);
  bumpDataVersion();
}

/** Called when a linked expense's amount is edited — keep the link in sync. */
export async function syncLinkOnExpenseEdit(
  expenseId: string,
  newAmount: number,
): Promise<void> {
  const db = getDatabase();
  const link = await getLinkForExpense(expenseId);
  if (!link) return;
  if (link.contribution_amount === newAmount) return;

  await db.runAsync(
    `UPDATE expense_investment_links
     SET contribution_amount = ?, updated_at = datetime('now')
     WHERE expense_id = ?;`,
    newAmount,
    expenseId,
  );

  await recomputeBucketContributed(link.investment_bucket_id);
  await _syncLinkedMilestone(link.investment_bucket_id);
  bumpDataVersion();
}

/**
 * Called when a linked expense is soft-deleted OR restored — recompute affected
 * bucket so current_contributed reflects the new join result.
 */
export async function onExpenseDeletedOrRestored(expenseId: string): Promise<void> {
  const link = await getLinkForExpense(expenseId);
  if (!link) return;
  await recomputeBucketContributed(link.investment_bucket_id);
  await _syncLinkedMilestone(link.investment_bucket_id);
}
