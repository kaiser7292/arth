import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { bumpDataVersion } from "@/services/settings";
import { logger } from "@/utils/logger";

export interface Budget {
  id: string;
  user_id: string;
  category_id: string;
  month: string; // YYYY-MM
  amount: number;
  notes: string | null;
}

export interface BudgetBreakdown {
  id: string;
  budget_id: string;
  line_item: string;
  formula: string | null;
  amount: number;
}

export interface CreateBudgetInput {
  user_id: string;
  category_id: string;
  month: string;
  amount: number;
  notes?: string;
}

export interface UpdateBudgetInput {
  amount?: number;
  notes?: string | null;
}

export interface CreateBreakdownInput {
  budget_id: string;
  line_item: string;
  formula?: string;
  amount: number;
}

/**
 * Get all budgets for a user in a given month.
 */
export async function getBudgetsForMonth(
  userId: string,
  month: string,
): Promise<Budget[]> {
  const db = getDatabase();
  return db.getAllAsync<Budget>(
    `SELECT b.* FROM budgets b
     JOIN categories c ON b.category_id = c.id AND c.is_active = 1
     WHERE b.user_id = ? AND b.month = ?
     ORDER BY b.category_id;`,
    userId,
    month,
  );
}

/**
 * Get monthly budget totals (keyed by 'YYYY-MM') across a month range in a
 * single query. Replaces per-month getBudgetsForMonth calls — used by the
 * budget rolling-surplus loop.
 */
export async function getMonthlyBudgetTotals(
  userId: string,
  startMonth: string,
  endMonth: string,
): Promise<Map<string, number>> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ month: string; total: number | null }>(
    `SELECT b.month, SUM(b.amount) as total FROM budgets b
     JOIN categories c ON b.category_id = c.id AND c.is_active = 1
     WHERE b.user_id = ? AND b.month >= ? AND b.month <= ?
     GROUP BY b.month;`,
    userId,
    startMonth,
    endMonth,
  );
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.month, r.total ?? 0);
  return out;
}

/**
 * Get a budget by user, category, and month.
 */
export async function getBudget(
  userId: string,
  categoryId: string,
  month: string,
): Promise<Budget | null> {
  const db = getDatabase();
  return db.getFirstAsync<Budget>(
    "SELECT * FROM budgets WHERE user_id = ? AND category_id = ? AND month = ?;",
    userId,
    categoryId,
    month,
  );
}

/**
 * Get a budget by ID.
 */
export async function getBudgetById(id: string): Promise<Budget | null> {
  const db = getDatabase();
  return db.getFirstAsync<Budget>(
    "SELECT * FROM budgets WHERE id = ?;",
    id,
  );
}

/**
 * Create or update a budget for a category/month.
 * Uses UPSERT (INSERT OR REPLACE) via unique constraint.
 * Returns the budget ID.
 */
export async function upsertBudget(input: CreateBudgetInput): Promise<string> {
  const db = getDatabase();

  // Atomic upsert — avoids the non-atomic SELECT+INSERT race condition.
  // The UNIQUE constraint on (user_id, category_id, month) means ON CONFLICT
  // correctly targets the existing row without a prior SELECT.
  const existing = await getBudget(input.user_id, input.category_id, input.month);
  const id = existing?.id ?? generateUUID();
  await db.runAsync(
    `INSERT INTO budgets (id, user_id, category_id, month, amount, notes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, category_id, month)
     DO UPDATE SET amount = excluded.amount, notes = excluded.notes;`,
    id,
    input.user_id,
    input.category_id,
    input.month,
    input.amount,
    input.notes ?? null,
  );
  bumpDataVersion();
  return id;
}

/**
 * Update a budget by ID.
 */
export async function updateBudget(
  id: string,
  input: UpdateBudgetInput,
): Promise<void> {
  const db = getDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.amount !== undefined) {
    fields.push("amount = ?");
    values.push(input.amount);
  }
  if (input.notes !== undefined) {
    fields.push("notes = ?");
    values.push(input.notes);
  }

  if (fields.length === 0) return;

  values.push(id);
  await db.runAsync(
    `UPDATE budgets SET ${fields.join(", ")} WHERE id = ?;`,
    ...values,
  );
  bumpDataVersion();
}

/**
 * Delete a budget and its breakdowns.
 */
export async function deleteBudget(id: string): Promise<void> {
  const db = getDatabase();
  if (__DEV__) {
    const fk = await db.getFirstAsync<{ foreign_keys: number }>("PRAGMA foreign_keys;");
    if (!fk?.foreign_keys) logger.warn("foreign_keys PRAGMA is OFF — cascading deletes may leave orphaned rows");
  }
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM budget_breakdowns WHERE budget_id = ?;", id);
    await db.runAsync("DELETE FROM budgets WHERE id = ?;", id);
  });
  bumpDataVersion();
}

/**
 * Get breakdowns for a budget.
 */
export async function getBreakdowns(budgetId: string): Promise<BudgetBreakdown[]> {
  const db = getDatabase();
  return db.getAllAsync<BudgetBreakdown>(
    "SELECT * FROM budget_breakdowns WHERE budget_id = ? ORDER BY rowid;",
    budgetId,
  );
}

/**
 * Add a breakdown line to a budget.
 */
export async function addBreakdown(input: CreateBreakdownInput): Promise<string> {
  const db = getDatabase();
  const id = generateUUID();
  await db.runAsync(
    "INSERT INTO budget_breakdowns (id, budget_id, line_item, formula, amount) VALUES (?, ?, ?, ?, ?);",
    id,
    input.budget_id,
    input.line_item,
    input.formula ?? null,
    input.amount,
  );
  bumpDataVersion();
  return id;
}

/**
 * Delete a breakdown line.
 */
export async function deleteBreakdown(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync("DELETE FROM budget_breakdowns WHERE id = ?;", id);
  bumpDataVersion();
}


/**
 * Get the current month as YYYY-MM.
 */
export function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
