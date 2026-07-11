import { getDatabase } from "@/database";
import type { Expense, ExpenseFilters, CategoryActual, MonthlyTotal } from "./expense-types";
import { effectiveAmountSql } from "./expense-effective-amount";

/**
 * v17.0.0 / v17.4.0: SQL fragment to exclude expenses that are linked to an
 * investment bucket OR a loan payment. Both types are NOT discretionary
 * spending — they belong in their respective buckets/loans, not in the
 * budget or spending insights.
 *
 * Safe for all builds: migrations run before any consumer query.
 * Safe for flag-off: when the linking UI is gated off, no link rows exist,
 * so the NOT EXISTS clauses always pass.
 */
const NOT_INVESTMENT_LINKED = `
  AND NOT EXISTS (
    SELECT 1 FROM expense_investment_links l
    WHERE l.expense_id = expenses.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM expense_loan_links ll
    WHERE ll.expense_id = expenses.id
  )
`;

const NOT_RECLASSIFIED = "(reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)";

/**
 * Get expenses for a user within a date range, ordered by date descending.
 */
export async function getExpenses(
  userId: string,
  startDate?: string,
  endDate?: string,
): Promise<Expense[]> {
  const db = getDatabase();

  if (startDate && endDate) {
    return db.getAllAsync<Expense>(
      `SELECT * FROM expenses
       WHERE user_id = ? AND status != 'rejected' AND nature = 'realized' AND deleted_at IS NULL AND ${NOT_RECLASSIFIED} AND date >= ? AND date <= ?
       ORDER BY date DESC, created_at DESC;`,
      userId,
      startDate,
      endDate,
    );
  }

  return db.getAllAsync<Expense>(
    `SELECT * FROM expenses
     WHERE user_id = ? AND status != 'rejected' AND nature = 'realized' AND deleted_at IS NULL AND ${NOT_RECLASSIFIED}
     ORDER BY date DESC, created_at DESC;`,
    userId,
  );
}

/**
 * Get a single expense by ID.
 */
export async function getExpenseById(id: string): Promise<Expense | null> {
  const db = getDatabase();
  return db.getFirstAsync<Expense>(
    "SELECT * FROM expenses WHERE id = ?;",
    id,
  );
}

/**
 * Batch-load a specific set of expenses by ID. Missing or soft-deleted rows are
 * silently dropped. Results are ordered by date desc, created_at desc to match
 * the list-view ordering elsewhere.
 */
export async function getExpensesByIds(ids: string[]): Promise<Expense[]> {
  if (ids.length === 0) return [];
  const db = getDatabase();
  const placeholders = ids.map(() => "?").join(",");
  return db.getAllAsync<Expense>(
    `SELECT * FROM expenses
     WHERE id IN (${placeholders}) AND deleted_at IS NULL
     ORDER BY date DESC, created_at DESC;`,
    ...ids,
  );
}

/**
 * Get paginated expenses with optional filters and search.
 */
export async function getExpensesPaginated(
  userId: string,
  filters: ExpenseFilters = {},
  limit = 50,
  offset = 0,
): Promise<Expense[]> {
  const db = getDatabase();

  const nature = filters.nature ?? "realized";
  const conditions: string[] = ["user_id = ?", "deleted_at IS NULL"];
  const params: (string | number)[] = [userId];

  if (nature === "all") {
    conditions.push("nature IN ('realized', 'credit')");
  } else {
    conditions.push("nature = ?");
    params.push(nature);
  }
  conditions.push(NOT_RECLASSIFIED);

  if (filters.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  } else {
    conditions.push("status != 'rejected'");
  }

  if (filters.startDate) {
    conditions.push("date >= ?");
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push("date <= ?");
    params.push(filters.endDate);
  }
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    const placeholders = filters.categoryIds.map(() => "?").join(",");
    conditions.push(`category_id IN (${placeholders})`);
    params.push(...filters.categoryIds);
  }
  if (filters.paymentModeIds && filters.paymentModeIds.length > 0) {
    const placeholders = filters.paymentModeIds.map(() => "?").join(",");
    conditions.push(`payment_mode_id IN (${placeholders})`);
    params.push(...filters.paymentModeIds);
  }
  if (filters.accountIds && filters.accountIds.length > 0) {
    const placeholders = filters.accountIds.map(() => "?").join(",");
    conditions.push(`account_id IN (${placeholders})`);
    params.push(...filters.accountIds);
  }
  if (filters.tagIds && filters.tagIds.length > 0) {
    const placeholders = filters.tagIds.map(() => "?").join(",");
    conditions.push(`id IN (SELECT expense_id FROM expense_tags WHERE tag_id IN (${placeholders}))`);
    params.push(...filters.tagIds);
  }
  if (filters.search) {
    conditions.push("(description LIKE ? OR merchant_name LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  if (filters.expenseIds && filters.expenseIds.length > 0) {
    const placeholders = filters.expenseIds.map(() => "?").join(",");
    conditions.push(`id IN (${placeholders})`);
    params.push(...filters.expenseIds);
  }
  if (filters.refundedStatus) {
    const refundedSub = `id IN (SELECT refund_of_expense_id FROM expenses WHERE refund_of_expense_id IS NOT NULL AND nature = 'credit' AND deleted_at IS NULL)`;
    conditions.push(filters.refundedStatus === "refunded" ? refundedSub : `NOT (${refundedSub})`);
  }
  if (filters.avoidability) {
    conditions.push("is_right_spend = ?");
    params.push(filters.avoidability === "unavoidable" ? 1 : 0);
  }
  if (filters.merchantNames && filters.merchantNames.length > 0) {
    const placeholders = filters.merchantNames.map(() => "?").join(",");
    conditions.push(`merchant_name IN (${placeholders})`);
    params.push(...filters.merchantNames);
  }
  if (filters.ruleIds && filters.ruleIds.length > 0) {
    const inPlaceholders = filters.ruleIds.map(() => "?").join(",");
    const likeParts = filters.ruleIds.map(() => `applied_rule_ids LIKE ?`).join(" OR ");
    conditions.push(`(applied_rule_id IN (${inPlaceholders}) OR ${likeParts})`);
    params.push(...filters.ruleIds);
    params.push(...filters.ruleIds.map((id) => `%"${id}"%`));
  }
  if (filters.segment === "spend") {
    conditions.push(`NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id)`);
    conditions.push(`NOT EXISTS (SELECT 1 FROM expense_investment_links il WHERE il.expense_id = expenses.id)`);
  } else if (filters.segment === "committed") {
    conditions.push(`(EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id) OR EXISTS (SELECT 1 FROM expense_investment_links il WHERE il.expense_id = expenses.id))`);
  }

  params.push(limit, offset);

  // Explicit projection (list view only needs these fields) — reduces row size ~3x vs SELECT *.
  return db.getAllAsync<Expense>(
    `SELECT
       id, user_id, amount, currency, description, merchant_name,
       category_id, payment_mode_id, account_id,
       date, transaction_time, due_date, is_right_spend,
       source, status, nature,
       split_original_amount, split_person_id, split_pct, split_hisaab_entry_id,
       deleted_at, created_at
     FROM expenses
     WHERE ${conditions.join(" AND ")}
     ORDER BY date DESC, created_at DESC
     LIMIT ? OFFSET ?;`,
    ...params,
  );
}

export interface FilteredSummaryGroup {
  key: string | null;
  total: number;
  count: number;
}

export interface FilteredSummary {
  total: number;
  count: number;
  groupBy: "category" | "account" | "payment_mode" | "merchant";
  groups: FilteredSummaryGroup[];
}

/**
 * Get total + groupBy breakdown for the same filters used in getExpensesPaginated.
 * Used by the filtered summary card on list screens.
 */
export async function getFilteredExpenseSummary(
  userId: string,
  filters: ExpenseFilters = {},
  groupBy: "category" | "account" | "payment_mode" | "merchant" = "category",
): Promise<FilteredSummary> {
  const db = getDatabase();

  const nature = filters.nature ?? "realized";
  const conditions: string[] = ["user_id = ?", "deleted_at IS NULL"];
  const params: (string | number)[] = [userId];

  if (nature === "all") {
    conditions.push("nature IN ('realized', 'credit')");
  } else {
    conditions.push("nature = ?");
    params.push(nature);
  }
  conditions.push(NOT_RECLASSIFIED);

  if (filters.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  } else {
    conditions.push("status != 'rejected'");
  }

  if (filters.startDate) {
    conditions.push("date >= ?");
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push("date <= ?");
    params.push(filters.endDate);
  }
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    const placeholders = filters.categoryIds.map(() => "?").join(",");
    conditions.push(`category_id IN (${placeholders})`);
    params.push(...filters.categoryIds);
  }
  if (filters.paymentModeIds && filters.paymentModeIds.length > 0) {
    const placeholders = filters.paymentModeIds.map(() => "?").join(",");
    conditions.push(`payment_mode_id IN (${placeholders})`);
    params.push(...filters.paymentModeIds);
  }
  if (filters.accountIds && filters.accountIds.length > 0) {
    const placeholders = filters.accountIds.map(() => "?").join(",");
    conditions.push(`account_id IN (${placeholders})`);
    params.push(...filters.accountIds);
  }
  if (filters.tagIds && filters.tagIds.length > 0) {
    const placeholders = filters.tagIds.map(() => "?").join(",");
    conditions.push(`id IN (SELECT expense_id FROM expense_tags WHERE tag_id IN (${placeholders}))`);
    params.push(...filters.tagIds);
  }
  if (filters.search) {
    conditions.push("(description LIKE ? OR merchant_name LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  if (filters.expenseIds && filters.expenseIds.length > 0) {
    const placeholders = filters.expenseIds.map(() => "?").join(",");
    conditions.push(`id IN (${placeholders})`);
    params.push(...filters.expenseIds);
  }
  if (filters.refundedStatus) {
    const refundedSub = `id IN (SELECT refund_of_expense_id FROM expenses WHERE refund_of_expense_id IS NOT NULL AND nature = 'credit' AND deleted_at IS NULL)`;
    conditions.push(filters.refundedStatus === "refunded" ? refundedSub : `NOT (${refundedSub})`);
  }
  if (filters.avoidability) {
    conditions.push("is_right_spend = ?");
    params.push(filters.avoidability === "unavoidable" ? 1 : 0);
  }
  if (filters.merchantNames && filters.merchantNames.length > 0) {
    const placeholders = filters.merchantNames.map(() => "?").join(",");
    conditions.push(`merchant_name IN (${placeholders})`);
    params.push(...filters.merchantNames);
  }
  if (filters.ruleIds && filters.ruleIds.length > 0) {
    const inPlaceholders = filters.ruleIds.map(() => "?").join(",");
    const likeParts = filters.ruleIds.map(() => `applied_rule_ids LIKE ?`).join(" OR ");
    conditions.push(`(applied_rule_id IN (${inPlaceholders}) OR ${likeParts})`);
    params.push(...filters.ruleIds);
    params.push(...filters.ruleIds.map((id) => `%"${id}"%`));
  }
  if (filters.segment === "spend") {
    conditions.push(`NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id)`);
    conditions.push(`NOT EXISTS (SELECT 1 FROM expense_investment_links il WHERE il.expense_id = expenses.id)`);
  } else if (filters.segment === "committed") {
    conditions.push(`(EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id) OR EXISTS (SELECT 1 FROM expense_investment_links il WHERE il.expense_id = expenses.id))`);
  }

  const where = conditions.join(" AND ");

  // For realized expenses: subtract linked refund credits so a refunded
  // expense stops inflating the "filtered total". Credit-nature queries are
  // not passed through this helper — refunds are themselves credits.
  const useEffective = nature !== "credit" && nature !== "all";
  const amountExpr = useEffective ? `SUM(${effectiveAmountSql("expenses")})` : "COALESCE(SUM(amount), 0)";

  const totalRow = await db.getFirstAsync<{ total: number | null; count: number }>(
    `SELECT COALESCE(${amountExpr}, 0) as total, COUNT(*) as count FROM expenses WHERE ${where};`,
    ...params,
  );

  const groupColumn =
    groupBy === "category" ? "category_id" : groupBy === "account" ? "account_id" : groupBy === "merchant" ? "merchant_name" : "payment_mode_id";

  const groupRows = await db.getAllAsync<{ key: string | null; total: number | null; count: number }>(
    `SELECT ${groupColumn} as key, COALESCE(${amountExpr}, 0) as total, COUNT(*) as count
     FROM expenses
     WHERE ${where}
     GROUP BY ${groupColumn}
     ORDER BY total DESC;`,
    ...params,
  );

  return {
    total: totalRow?.total ?? 0,
    count: totalRow?.count ?? 0,
    groupBy,
    groups: groupRows.map((r) => ({ key: r.key, total: r.total ?? 0, count: r.count })),
  };
}

/**
 * Get total spending for the previous period of the same length as [startDate, endDate].
 * Used to compute MoM / period-over-period trend deltas for the filter summary card.
 * Returns null if filters lack a start+end (no meaningful "previous period").
 */
export async function getPreviousPeriodTotal(
  userId: string,
  filters: ExpenseFilters,
): Promise<number | null> {
  if (!filters.startDate || !filters.endDate) return null;

  const startMs = new Date(filters.startDate + "T00:00:00").getTime();
  const endMs = new Date(filters.endDate + "T00:00:00").getTime();
  const lengthMs = endMs - startMs;
  if (lengthMs <= 0) return null;

  const prevEndMs = startMs - 24 * 60 * 60 * 1000; // one day before current start
  const prevStartMs = prevEndMs - lengthMs;
  const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  const prevFilters: ExpenseFilters = {
    ...filters,
    startDate: toIso(prevStartMs),
    endDate: toIso(prevEndMs),
  };

  const summary = await getFilteredExpenseSummary(userId, prevFilters, "category");
  return summary.total;
}

/**
 * Get total spending for a user in a date range.
 */
export async function getExpenseTotal(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(${effectiveAmountSql("expenses")}) as total FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL AND ${NOT_RECLASSIFIED} AND date >= ? AND date <= ?
     ${NOT_INVESTMENT_LINKED};`,
    userId,
    startDate,
    endDate,
  );
  return row?.total ?? 0;
}

/**
 * Get monthly expense totals (keyed by 'YYYY-MM') across a date range in a
 * single query. Replaces per-month getExpenseTotal calls — critical for the
 * budget rolling-surplus loop which used to fire 2×N queries (one budget
 * fetch + one total) for N months since FY start.
 */
export async function getMonthlyExpenseTotals(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<Map<string, number>> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ month: string; total: number | null }>(
    `SELECT SUBSTR(date, 1, 7) as month, SUM(${effectiveAmountSql("expenses")}) as total
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND ${NOT_RECLASSIFIED} AND date >= ? AND date <= ?
       ${NOT_INVESTMENT_LINKED}
     GROUP BY SUBSTR(date, 1, 7);`,
    userId,
    startDate,
    endDate,
  );
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.month, r.total ?? 0);
  return out;
}

/**
 * Get total spending per category for a user in a date range.
 */
export async function getExpenseTotalsByCategory(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<CategoryActual[]> {
  const db = getDatabase();
  return db.getAllAsync<CategoryActual>(
    `SELECT category_id, SUM(${effectiveAmountSql("expenses")}) as total FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL AND ${NOT_RECLASSIFIED} AND date >= ? AND date <= ? AND category_id IS NOT NULL
     ${NOT_INVESTMENT_LINKED}
     GROUP BY category_id;`,
    userId,
    startDate,
    endDate,
  );
}

/**
 * Get IDs of approved realized expenses for a single category in a date range.
 * Used by budget-vs-actual drill-down to feed the filtered transactions screen.
 */
export async function getExpenseIdsByCategory(
  userId: string,
  categoryId: string,
  startDate: string,
  endDate: string,
): Promise<string[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM expenses
     WHERE user_id = ? AND category_id = ? AND status = 'approved'
       AND nature = 'realized' AND deleted_at IS NULL AND ${NOT_RECLASSIFIED}
       AND date >= ? AND date <= ?
     ${NOT_INVESTMENT_LINKED}
     ORDER BY date DESC;`,
    userId, categoryId, startDate, endDate,
  );
  return rows.map((r) => r.id);
}

/**
 * Get expense totals grouped by (category_id, is_right_spend).
 * This allows the same category to appear in both unavoidable and discretionary buckets.
 */
export interface CategoryClassificationActual {
  category_id: string;
  is_unavoidable: number; // 1 = unavoidable, 0 = discretionary
  total: number;
}

export async function getExpenseTotalsByCategoryAndClassification(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<CategoryClassificationActual[]> {
  const db = getDatabase();
  // v15.2.1 fix: previously grouped by COALESCE(is_right_spend, 1) which
  // silently bucketed NULL (uncategorized-for-classification) expenses as
  // "unavoidable", inflating the unavoidable % on the spending-split screen
  // vs the monthly summary. Now: treat NULL as its own third group
  // (0/1/NULL → discretionary/unavoidable/uncategorized). The spending-split
  // UI still buckets NULL into discretionary for display if desired, but the
  // raw data is honest.
  return db.getAllAsync<CategoryClassificationActual>(
    `SELECT category_id,
            CASE
              WHEN is_right_spend = 1 THEN 1
              WHEN is_right_spend = 0 THEN 0
              ELSE -1
            END as is_unavoidable,
            SUM(${effectiveAmountSql("expenses")}) as total
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized'
       AND deleted_at IS NULL AND ${NOT_RECLASSIFIED} AND date >= ? AND date <= ?
       AND category_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM expense_investment_links il WHERE il.expense_id = expenses.id)
       AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id)
     GROUP BY category_id, is_unavoidable;`,
    userId,
    startDate,
    endDate,
  );
}

/**
 * Get monthly spending totals for a category over the last N months.
 * Returns array sorted oldest to newest.
 */
export async function getCategoryMonthlyTrend(
  userId: string,
  categoryId: string,
  months: number = 6,
  referenceMonth?: string,
): Promise<MonthlyTotal[]> {
  const db = getDatabase();

  // Use reference month if provided (format: "YYYY-MM"), otherwise current month
  const now = referenceMonth
    ? new Date(Number(referenceMonth.split("-")[0]), Number(referenceMonth.split("-")[1]) - 1, 1)
    : new Date();
  const earliest = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const startDate = `${earliest.getFullYear()}-${String(earliest.getMonth() + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  // Single query with GROUP BY month instead of N separate queries
  const rows = await db.getAllAsync<{ month: string; total: number | null }>(
    `SELECT strftime('%Y-%m', date) as month, SUM(${effectiveAmountSql("expenses")}) as total
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized'
       AND deleted_at IS NULL AND ${NOT_RECLASSIFIED} AND category_id = ? AND date >= ? AND date <= ?
     GROUP BY strftime('%Y-%m', date)
     ORDER BY month;`,
    userId,
    categoryId,
    startDate,
    endDate,
  );

  // Build result array with zero-fill for months with no spending
  const rowMap = new Map(rows.map((r) => [r.month, r.total ?? 0]));
  const results: MonthlyTotal[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    results.push({ month, total: rowMap.get(month) ?? 0 });
  }

  return results;
}

/**
 * Get total "right spend" amount for a user in a date range.
 */
export async function getRightSpendTotal(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(${effectiveAmountSql("expenses")}) as total FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL AND ${NOT_RECLASSIFIED} AND is_right_spend = 1 AND date >= ? AND date <= ?;`,
    userId,
    startDate,
    endDate,
  );
  return row?.total ?? 0;
}

/**
 * Get top N categories by spending in a date range.
 */
export async function getTopCategoriesBySpending(
  userId: string,
  startDate: string,
  endDate: string,
  limit: number = 5,
): Promise<CategoryActual[]> {
  const db = getDatabase();
  return db.getAllAsync<CategoryActual>(
    `SELECT category_id, SUM(${effectiveAmountSql("expenses")}) as total FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL AND ${NOT_RECLASSIFIED} AND date >= ? AND date <= ? AND category_id IS NOT NULL
     GROUP BY category_id
     ORDER BY total DESC
     LIMIT ?;`,
    userId,
    startDate,
    endDate,
    limit,
  );
}

/**
 * Get transaction count for a user in a date range.
 */
export async function getExpenseCount(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL AND ${NOT_RECLASSIFIED} AND date >= ? AND date <= ?;`,
    userId,
    startDate,
    endDate,
  );
  return row?.count ?? 0;
}

/**
 * Get uncategorized total for a user in a date range.
 */
export async function getUncategorizedTotal(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(${effectiveAmountSql("expenses")}) as total FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL AND ${NOT_RECLASSIFIED} AND date >= ? AND date <= ? AND category_id IS NULL
     ${NOT_INVESTMENT_LINKED};`,
    userId,
    startDate,
    endDate,
  );
  return row?.total ?? 0;
}

/**
 * Get uncategorized expense count for a user.
 */
export async function getUncategorizedCount(
  userId: string,
): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL AND ${NOT_RECLASSIFIED} AND category_id IS NULL;`,
    userId,
  );
  return row?.count ?? 0;
}

/**
 * Get all uncategorized expenses for a user, ordered by newest first.
 */
export async function getUncategorizedExpenses(
  userId: string,
): Promise<Expense[]> {
  const db = getDatabase();
  return db.getAllAsync<Expense>(
    `SELECT * FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL AND ${NOT_RECLASSIFIED} AND category_id IS NULL
     ORDER BY date DESC;`,
    userId,
  );
}

/**
 * Get all expenses pending review, ordered by newest first.
 * Includes both realized and forecast items from SMS/email auto-detection.
 */
export async function getPendingExpensesForReview(
  userId: string,
): Promise<Expense[]> {
  const db = getDatabase();
  return db.getAllAsync<Expense>(
    `SELECT * FROM expenses
     WHERE user_id = ? AND status = 'pending_review' AND deleted_at IS NULL
     ORDER BY created_at DESC;`,
    userId,
  );
}

/**
 * Get the count of expenses pending review.
 */
export async function getPendingExpenseCount(
  userId: string,
): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM expenses
     WHERE user_id = ? AND status = 'pending_review' AND nature IN ('realized', 'credit') AND deleted_at IS NULL;`,
    userId,
  );
  return row?.count ?? 0;
}
