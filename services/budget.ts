import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { bumpDataVersion } from "@/services/settings";
import { logger } from "@/utils/logger";
import { getExpenseTotalsByCategory } from "@/services/expense";

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

// ─── Budget vs Actual ─────────────────────────────────────────────────────────

export interface BudgetVsActualRow {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  categoryIcon: string;
  isUnavoidable: number;
  totalBudget: number;
  totalActual: number;
}

export interface MonthlyBudgetActual {
  month: string;
  budget: number;
  actual: number;
}

export interface BudgetVsActualResult {
  rows: BudgetVsActualRow[];           // categories that have a budget set
  unbudgetedRows: BudgetVsActualRow[]; // spend with no budget configured
  totalBudget: number;
  totalActual: number;
  monthly: MonthlyBudgetActual[];      // per-month totals (empty for single-month)
}

/**
 * Returns budget vs actual spend for a date range.
 *
 * startMonth / endMonth  — YYYY-MM range for budget rows (full months).
 * startDate  / endDate   — YYYY-MM-DD range for expense actuals (can be
 *   capped at today so mid-month queries only count spend to date).
 */
export async function getBudgetVsActual(
  userId: string,
  startMonth: string,
  endMonth: string,
  startDate: string,
  endDate: string,
): Promise<BudgetVsActualResult> {
  const db = getDatabase();

  // 1. Budget totals per category with category metadata
  const budgetRows = await db.getAllAsync<{
    category_id: string;
    name: string;
    color: string;
    icon: string;
    is_unavoidable: number;
    total: number;
  }>(
    `SELECT b.category_id, c.name, c.color, c.icon, c.is_unavoidable,
            SUM(b.amount) as total
     FROM budgets b
     JOIN categories c ON c.id = b.category_id AND c.is_active = 1
     WHERE b.user_id = ? AND b.month >= ? AND b.month <= ?
     GROUP BY b.category_id
     ORDER BY c.name ASC`,
    userId, startMonth, endMonth,
  );

  // 2. Actual totals per category (uses effective amount / split-aware query)
  const actualRows = await getExpenseTotalsByCategory(userId, startDate, endDate);
  const actualMap = new Map(actualRows.map((r) => [r.category_id, r.total]));
  const budgetCatIds = new Set(budgetRows.map((r) => r.category_id));

  // 3. Build main rows
  const rows: BudgetVsActualRow[] = budgetRows.map((r) => ({
    categoryId: r.category_id,
    categoryName: r.name,
    categoryColor: r.color,
    categoryIcon: r.icon,
    isUnavoidable: r.is_unavoidable,
    totalBudget: r.total,
    totalActual: actualMap.get(r.category_id) ?? 0,
  }));

  // 4. Categories with spend but no budget configured
  const unbudgetedActuals = actualRows.filter((r) => !budgetCatIds.has(r.category_id));
  let unbudgetedRows: BudgetVsActualRow[] = [];
  if (unbudgetedActuals.length > 0) {
    const placeholders = unbudgetedActuals.map(() => "?").join(",");
    const catRows = await db.getAllAsync<{
      id: string; name: string; color: string; icon: string; is_unavoidable: number;
    }>(
      `SELECT id, name, color, icon, is_unavoidable FROM categories
       WHERE id IN (${placeholders}) AND is_active = 1`,
      unbudgetedActuals.map((r) => r.category_id),
    );
    const catMap = new Map(catRows.map((c) => [c.id, c]));
    unbudgetedRows = unbudgetedActuals
      .map((r) => {
        const cat = catMap.get(r.category_id);
        if (!cat) return null;
        return {
          categoryId: r.category_id,
          categoryName: cat.name,
          categoryColor: cat.color,
          categoryIcon: cat.icon,
          isUnavoidable: cat.is_unavoidable,
          totalBudget: 0,
          totalActual: r.total,
        };
      })
      .filter((r): r is BudgetVsActualRow => r !== null);
  }

  const totalBudget = rows.reduce((s, r) => s + r.totalBudget, 0);
  const totalActual = [...rows, ...unbudgetedRows].reduce((s, r) => s + r.totalActual, 0);

  // 5. Monthly breakdown (only needed for multi-month ranges)
  let monthly: MonthlyBudgetActual[] = [];
  if (startMonth !== endMonth) {
    const monthBudgets = await db.getAllAsync<{ month: string; total: number }>(
      `SELECT month, SUM(amount) as total FROM budgets
       WHERE user_id = ? AND month >= ? AND month <= ?
       GROUP BY month ORDER BY month`,
      userId, startMonth, endMonth,
    );
    const monthActuals = await db.getAllAsync<{ month: string; total: number }>(
      `SELECT strftime('%Y-%m', date) as month, SUM(amount) as total
       FROM expenses
       WHERE user_id = ? AND status = 'approved' AND nature = 'realized'
         AND deleted_at IS NULL AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer != 1)
         AND date >= ? AND date <= ? AND category_id IS NOT NULL
       GROUP BY strftime('%Y-%m', date) ORDER BY month`,
      userId, startDate, endDate,
    );

    // Generate all months in range (budget months with no actuals still appear)
    const allMonths: string[] = [];
    let cur = startMonth;
    while (cur <= endMonth) {
      allMonths.push(cur);
      const [y, m] = cur.split("-").map(Number);
      const next = new Date(y, m, 1);
      cur = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    }
    const budgetMonthMap = new Map(monthBudgets.map((r) => [r.month, r.total]));
    const actualMonthMap = new Map(monthActuals.map((r) => [r.month, r.total]));
    monthly = allMonths.map((mo) => ({
      month: mo,
      budget: budgetMonthMap.get(mo) ?? 0,
      actual: actualMonthMap.get(mo) ?? 0,
    }));
  }

  return { rows, unbudgetedRows, totalBudget, totalActual, monthly };
}
