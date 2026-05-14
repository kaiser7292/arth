import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import { generateUUID } from "@/utils/uuid";
import { getExpenseById } from "./expense-queries";

export interface MultiSplitEntry {
  personId: string;
  description: string;
  amount: number;
}

export interface MultiSplitConfig {
  splits: MultiSplitEntry[];
  feeAbsorbed: boolean;
}

export interface ExpenseSplitRow {
  id: string;
  expense_id: string;
  hisaab_person_id: string;
  description: string | null;
  amount: number;
  hisaab_entry_id: string | null;
  created_at: string;
}

export async function applyMultiSplit(
  expenseId: string,
  config: MultiSplitConfig,
): Promise<void> {
  const db = getDatabase();
  const expense = await getExpenseById(expenseId);
  if (!expense) return;

  const originalAmount = expense.split_original_amount ?? expense.amount;
  const totalSplitAmount = config.splits.reduce((sum, s) => sum + s.amount, 0);
  const convenienceFee = Math.round((originalAmount - totalSplitAmount) * 100) / 100;
  const feeAbsorbed = config.feeAbsorbed;

  let feePerSplit = 0;
  if (!feeAbsorbed && convenienceFee > 0 && config.splits.length > 0) {
    feePerSplit = Math.round((convenienceFee / config.splits.length) * 100) / 100;
  }

  const myShare = feeAbsorbed
    ? originalAmount - totalSplitAmount - config.splits.reduce((s, sp) => s + sp.amount, 0) + totalSplitAmount
    : originalAmount - totalSplitAmount - feePerSplit * config.splits.length;

  // Calculate: others' total share (what leaves my budget)
  const othersTotal = config.splits.reduce((sum, s) => {
    return sum + s.amount + (feeAbsorbed ? 0 : feePerSplit);
  }, 0);

  const myBudgetAmount = Math.round((originalAmount - othersTotal) * 100) / 100;
  const splitPct = originalAmount > 0 ? Math.round((myBudgetAmount / originalAmount) * 100) : 100;

  await db.withTransactionAsync(async () => {
    // Remove any existing multi-splits for this expense
    // Delete expense_splits FIRST (child FK), then hisaab_entries (parent)
    const existingSplits = await db.getAllAsync<ExpenseSplitRow>(
      `SELECT * FROM expense_splits WHERE expense_id = ?`,
      expenseId,
    );
    await db.runAsync(`DELETE FROM expense_splits WHERE expense_id = ?`, expenseId);
    for (const es of existingSplits) {
      if (es.hisaab_entry_id) {
        await db.runAsync(`DELETE FROM hisaab_entries WHERE id = ?`, es.hisaab_entry_id);
      }
    }

    // Also clear legacy single-split fields if present
    if (expense.split_hisaab_entry_id) {
      await db.runAsync(`DELETE FROM hisaab_entries WHERE id = ?`, expense.split_hisaab_entry_id);
    }

    // Create new splits + hisaab entries
    for (const split of config.splits) {
      const splitId = generateUUID();
      const hisaabEntryId = generateUUID();
      const entryAmount = split.amount + (feeAbsorbed ? 0 : feePerSplit);
      const now = new Date().toISOString(); // Local time in ISO format

      await db.runAsync(
        `INSERT INTO hisaab_entries (id, hisaab_person_id, amount, description, date, type, category_id, merchant_name, linked_expense_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'debit', ?, ?, ?, ?);`,
        hisaabEntryId,
        split.personId,
        entryAmount,
        split.description || expense.description || expense.merchant_name || null,
        expense.date,
        expense.category_id ?? null,
        expense.merchant_name ?? null,
        expenseId,
        now,
      );

      await db.runAsync(
        `INSERT INTO expense_splits (id, expense_id, hisaab_person_id, description, amount, hisaab_entry_id)
         VALUES (?, ?, ?, ?, ?, ?);`,
        splitId,
        expenseId,
        split.personId,
        split.description || null,
        split.amount,
        hisaabEntryId,
      );
    }

    // Update the expense: reduce amount to my share, store original + convenience info
    await db.runAsync(
      `UPDATE expenses
       SET amount = ?,
           split_original_amount = ?,
           split_person_id = NULL,
           split_pct = ?,
           split_hisaab_entry_id = NULL,
           convenience_fee = ?,
           fee_absorbed = ?,
           updated_at = datetime('now')
       WHERE id = ?;`,
      myBudgetAmount,
      originalAmount,
      splitPct,
      convenienceFee > 0 ? convenienceFee : 0,
      feeAbsorbed ? 1 : 0,
      expenseId,
    );
  });

  bumpDataVersion();
}

export async function removeMultiSplit(expenseId: string): Promise<void> {
  const db = getDatabase();
  const expense = await getExpenseById(expenseId);
  if (!expense) return;

  await db.withTransactionAsync(async () => {
    const existingSplits = await db.getAllAsync<ExpenseSplitRow>(
      `SELECT * FROM expense_splits WHERE expense_id = ?`,
      expenseId,
    );
    // Delete expense_splits FIRST (child FK), then hisaab_entries (parent)
    await db.runAsync(`DELETE FROM expense_splits WHERE expense_id = ?`, expenseId);
    for (const es of existingSplits) {
      if (es.hisaab_entry_id) {
        await db.runAsync(`DELETE FROM hisaab_entries WHERE id = ?`, es.hisaab_entry_id);
      }
    }

    const originalAmount = expense.split_original_amount ?? expense.amount;
    await db.runAsync(
      `UPDATE expenses
       SET amount = ?,
           split_original_amount = NULL,
           split_person_id = NULL,
           split_pct = NULL,
           split_hisaab_entry_id = NULL,
           convenience_fee = 0,
           fee_absorbed = 1,
           updated_at = datetime('now')
       WHERE id = ?;`,
      originalAmount,
      expenseId,
    );
  });

  bumpDataVersion();
}

export interface MultiSplitSummary {
  splits: (ExpenseSplitRow & { person_name: string })[];
  totalSplitAmount: number;
  convenienceFee: number;
  feeAbsorbed: boolean;
  myShare: number;
  originalAmount: number;
}

export async function getMultiSplitSummary(expenseId: string): Promise<MultiSplitSummary | null> {
  const db = getDatabase();
  const expense = await getExpenseById(expenseId);
  if (!expense) return null;

  const splits = await db.getAllAsync<ExpenseSplitRow & { person_name: string }>(
    `SELECT es.*, hp.name as person_name
     FROM expense_splits es
     JOIN hisaab_persons hp ON hp.id = es.hisaab_person_id
     WHERE es.expense_id = ?
     ORDER BY es.created_at ASC`,
    expenseId,
  );

  if (splits.length === 0) return null;

  const totalSplitAmount = splits.reduce((sum, s) => sum + s.amount, 0);

  return {
    splits,
    totalSplitAmount,
    convenienceFee: expense.convenience_fee ?? 0,
    feeAbsorbed: (expense.fee_absorbed ?? 1) === 1,
    myShare: expense.amount,
    originalAmount: expense.split_original_amount ?? expense.amount,
  };
}
