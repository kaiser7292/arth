/**
 * Spending Insights Service — Task 22.0
 *
 * Queries expense data from SQLite and feeds it to the pure
 * calculation functions in utils/spending-insights.ts.
 *
 * Provides a single entry point: getSpendingInsights(userId, dateRange)
 * that returns a complete InsightsSummary.
 */

import { getDatabase } from "@/database";
import {
  calculateCategoryTrends,
  detectAnomalies,
  analyzeMerchants,
  analyzeDayPatterns,
  analyzePaymentModes,
  generateInsights,
  type InsightsSummary,
  type MonthlyCategory,
  type ExpenseRecord,
} from "@/utils/spending-insights";
import { getLastDayOfMonth } from "@/utils/date";
import { effectiveAmountSql } from "./expense-effective-amount";

/**
 * Generate a complete spending insights summary for a user.
 *
 * @param userId — the user to analyze
 * @param currentMonth — "YYYY-MM" of the month to analyze (defaults to now)
 */
export async function getSpendingInsights(
  userId: string,
  currentMonth?: string,
): Promise<InsightsSummary> {
  const db = getDatabase();

  // Determine the 3 months to analyze
  const now = currentMonth
    ? new Date(currentMonth + "-15")
    : new Date();
  const months = getLast3Months(now);

  const startDate = `${months[0]}-01`;
  const endMonth = months[2];
  const endDate = getLastDayOfMonth(endMonth);

  // 1. Query monthly totals per category (for trends)
  const monthlyRows = await db.getAllAsync<{
    category_id: string;
    month: string;
    total: number;
  }>(
    `SELECT category_id, strftime('%Y-%m', date) as month, SUM(${effectiveAmountSql("expenses")}) as total
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND category_id IS NOT NULL
       AND date >= ? AND date <= ?
       AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id)
       AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id)
     GROUP BY category_id, strftime('%Y-%m', date);`,
    userId,
    startDate,
    endDate,
  );

  const monthlyData: MonthlyCategory[] = monthlyRows.map((r) => ({
    categoryId: r.category_id,
    month: r.month,
    total: r.total,
  }));

  // 2. Query individual expenses for the current month (for anomalies, merchants, patterns)
  const currentStart = `${endMonth}-01`;
  const currentEnd = endDate;

  // Effective amount subtracts refund credits. Fully-refunded expenses
  // (effective = 0) are excluded from anomaly detection, merchants, and
  // day/payment patterns — they didn't cost anything net.
  const expenseRows = await db.getAllAsync<{
    id: string;
    amount: number;
    description: string | null;
    merchant_name: string | null;
    date: string;
    category_id: string | null;
    payment_mode_id: string | null;
  }>(
    `SELECT id, ${effectiveAmountSql("expenses")} as amount, description, merchant_name, date, category_id, payment_mode_id
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND date >= ? AND date <= ?
       AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id)
       AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id)
     ORDER BY date DESC;`,
    userId,
    currentStart,
    currentEnd,
  );

  const expenses: ExpenseRecord[] = expenseRows
    .filter((r) => r.amount > 0)
    .map((r) => ({
      id: r.id,
      amount: r.amount,
      description: r.description,
      merchantName: r.merchant_name,
      date: r.date,
      categoryId: r.category_id,
      paymentModeId: r.payment_mode_id,
    }));

  // 3. Query category averages (per-transaction average over last 3 months)
  const avgRows = await db.getAllAsync<{
    category_id: string;
    avg_amount: number;
  }>(
    `SELECT category_id, AVG(${effectiveAmountSql("expenses")}) as avg_amount
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND category_id IS NOT NULL
       AND date >= ? AND date <= ?
       AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id)
       AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id)
     GROUP BY category_id;`,
    userId,
    startDate,
    endDate,
  );

  const categoryAverages = new Map<string, number>();
  for (const row of avgRows) {
    categoryAverages.set(row.category_id, row.avg_amount);
  }

  // 4. Query category names
  const categoryRows = await db.getAllAsync<{ id: string; name: string }>(
    `SELECT id, name FROM categories WHERE user_id = ?;`,
    userId,
  );
  const categoryNames = new Map<string, string>();
  for (const row of categoryRows) {
    categoryNames.set(row.id, row.name);
  }

  // 5. Run all analyses
  const categoryTrends = calculateCategoryTrends(monthlyData, months);
  const anomalies = detectAnomalies(expenses, categoryAverages);
  const topMerchants = analyzeMerchants(expenses);
  const dayPattern = analyzeDayPatterns(expenses);
  const paymentModes = analyzePaymentModes(expenses);
  const topInsights = generateInsights(
    categoryTrends,
    anomalies,
    topMerchants,
    dayPattern,
    categoryNames,
  );

  return {
    topInsights,
    categoryTrends,
    anomalies,
    topMerchants,
    dayPattern,
    paymentModes,
  };
}

/**
 * Get merchant-level analytics for a longer time range (e.g., 6 months).
 */
export async function getMerchantAnalytics(
  userId: string,
  startDate: string,
  endDate: string,
  limit: number = 20,
): Promise<ReturnType<typeof analyzeMerchants>> {
  const db = getDatabase();

  const rows = await db.getAllAsync<{
    id: string;
    amount: number;
    description: string | null;
    merchant_name: string | null;
    date: string;
    category_id: string | null;
    payment_mode_id: string | null;
  }>(
    `SELECT id, ${effectiveAmountSql("expenses")} as amount, description, merchant_name, date, category_id, payment_mode_id
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND date >= ? AND date <= ?
       AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id)
       AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id)
     ORDER BY date DESC;`,
    userId,
    startDate,
    endDate,
  );

  const expenses: ExpenseRecord[] = rows
    .filter((r) => r.amount > 0)
    .map((r) => ({
      id: r.id,
      amount: r.amount,
      description: r.description,
      merchantName: r.merchant_name,
      date: r.date,
      categoryId: r.category_id,
      paymentModeId: r.payment_mode_id,
    }));

  return analyzeMerchants(expenses, limit);
}

/**
 * Get detailed analytics for a single merchant.
 * Returns all transactions, monthly totals, categories used, and average amount.
 */
export async function getMerchantDetail(
  userId: string,
  merchantName: string,
  startDate: string,
  endDate: string,
): Promise<{
  transactions: { id: string; amount: number; date: string; description: string | null; category_id: string | null }[];
  monthlyTotals: { month: string; total: number; count: number }[];
  categories: { category_id: string; total: number; count: number }[];
  totalSpent: number;
  avgAmount: number;
  transactionCount: number;
}> {
  const db = getDatabase();

  // Match on merchant_name (consistent with how analyzeMerchants groups expenses).
  // "unknown" matches expenses with no merchant_name.
  const merchantLower = merchantName.toLowerCase();
  const allRows = await db.getAllAsync<{
    id: string;
    amount: number;
    date: string;
    description: string | null;
    merchant_name: string | null;
    category_id: string | null;
  }>(
    `SELECT id, ${effectiveAmountSql("expenses")} as amount, date, description, merchant_name, category_id
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND date >= ? AND date <= ?
     ORDER BY date DESC;`,
    userId,
    startDate,
    endDate,
  );

  // Filter in JS using the same logic as analyzeMerchants; drop fully-
  // refunded rows (effective amount = 0) so merchant totals reflect net spend.
  const rows = allRows
    .filter((r) => r.amount > 0)
    .filter((r) => {
      if (r.merchant_name) {
        return r.merchant_name.trim().toLowerCase() === merchantLower;
      }
      return merchantLower === "unknown";
    });

  // Monthly totals
  const monthMap = new Map<string, { total: number; count: number }>();
  const catMap = new Map<string, { total: number; count: number }>();
  let totalSpent = 0;

  for (const r of rows) {
    totalSpent += r.amount;
    const month = r.date.substring(0, 7);
    const existing = monthMap.get(month);
    if (existing) {
      existing.total += r.amount;
      existing.count++;
    } else {
      monthMap.set(month, { total: r.amount, count: 1 });
    }
    if (r.category_id) {
      const cat = catMap.get(r.category_id);
      if (cat) {
        cat.total += r.amount;
        cat.count++;
      } else {
        catMap.set(r.category_id, { total: r.amount, count: 1 });
      }
    }
  }

  const monthlyTotals = Array.from(monthMap.entries())
    .map(([month, data]) => ({ month, total: Math.round(data.total * 100) / 100, count: data.count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const categories = Array.from(catMap.entries())
    .map(([category_id, data]) => ({ category_id, total: Math.round(data.total * 100) / 100, count: data.count }))
    .sort((a, b) => b.total - a.total);

  return {
    transactions: rows,
    monthlyTotals,
    categories,
    totalSpent: Math.round(totalSpent * 100) / 100,
    avgAmount: rows.length > 0 ? Math.round((totalSpent / rows.length) * 100) / 100 : 0,
    transactionCount: rows.length,
  };
}

/**
 * Get account-level spending analytics.
 */
export async function getAccountAnalytics(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<{
  accounts: { account_id: string; total: number; count: number; pct: number }[];
  monthlyByAccount: { account_id: string; month: string; total: number }[];
}> {
  const db = getDatabase();

  const rows = await db.getAllAsync<{
    account_id: string;
    total: number;
    count: number;
  }>(
    `SELECT account_id, SUM(${effectiveAmountSql("expenses")}) as total, COUNT(*) as count
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND account_id IS NOT NULL
       AND date >= ? AND date <= ?
     GROUP BY account_id
     ORDER BY total DESC;`,
    userId,
    startDate,
    endDate,
  );

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  const accounts = rows.map((r) => ({
    account_id: r.account_id,
    total: Math.round(r.total * 100) / 100,
    count: r.count,
    pct: grandTotal > 0 ? Math.round((r.total / grandTotal) * 10000) / 100 : 0,
  }));

  const monthlyRows = await db.getAllAsync<{
    account_id: string;
    month: string;
    total: number;
  }>(
    `SELECT account_id, strftime('%Y-%m', date) as month, SUM(${effectiveAmountSql("expenses")}) as total
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND account_id IS NOT NULL
       AND date >= ? AND date <= ?
     GROUP BY account_id, strftime('%Y-%m', date)
     ORDER BY month ASC;`,
    userId,
    startDate,
    endDate,
  );

  return {
    accounts,
    monthlyByAccount: monthlyRows.map((r) => ({
      account_id: r.account_id,
      month: r.month,
      total: Math.round(r.total * 100) / 100,
    })),
  };
}

/**
 * Get recent transactions for a specific account within a date range.
 */
export async function getAccountTransactions(
  userId: string,
  accountId: string,
  startDate: string,
  endDate: string,
  limit = 10,
): Promise<{ id: string; amount: number; date: string; description: string | null }[]> {
  const db = getDatabase();
  return db.getAllAsync<{ id: string; amount: number; date: string; description: string | null }>(
    `SELECT id, amount, date, description
     FROM expenses
     WHERE user_id = ? AND account_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND date >= ? AND date <= ?
     ORDER BY date DESC
     LIMIT ?;`,
    userId,
    accountId,
    startDate,
    endDate,
    limit,
  );
}

/**
 * Get payment mode spending trends over months.
 */
export async function getPaymentModeTrend(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<{
  modes: { payment_mode_id: string; total: number; count: number; pct: number }[];
  monthlyByMode: { payment_mode_id: string; month: string; total: number }[];
}> {
  const db = getDatabase();

  const rows = await db.getAllAsync<{
    payment_mode_id: string;
    total: number;
    count: number;
  }>(
    `SELECT COALESCE(payment_mode_id, 'unknown') as payment_mode_id, SUM(${effectiveAmountSql("expenses")}) as total, COUNT(*) as count
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND date >= ? AND date <= ?
     GROUP BY payment_mode_id
     ORDER BY total DESC;`,
    userId,
    startDate,
    endDate,
  );

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  const modes = rows.map((r) => ({
    payment_mode_id: r.payment_mode_id,
    total: Math.round(r.total * 100) / 100,
    count: r.count,
    pct: grandTotal > 0 ? Math.round((r.total / grandTotal) * 10000) / 100 : 0,
  }));

  const monthlyRows = await db.getAllAsync<{
    payment_mode_id: string;
    month: string;
    total: number;
  }>(
    `SELECT COALESCE(payment_mode_id, 'unknown') as payment_mode_id, strftime('%Y-%m', date) as month, SUM(${effectiveAmountSql("expenses")}) as total
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND date >= ? AND date <= ?
     GROUP BY payment_mode_id, strftime('%Y-%m', date)
     ORDER BY month ASC;`,
    userId,
    startDate,
    endDate,
  );

  return {
    modes,
    monthlyByMode: monthlyRows.map((r) => ({
      payment_mode_id: r.payment_mode_id,
      month: r.month,
      total: Math.round(r.total * 100) / 100,
    })),
  };
}

/**
 * Get right-spend trend over N months.
 * Unavoidable spend = expenses where is_right_spend = 1 (per-expense classification).
 * Discretionary = expenses where is_right_spend = 0 or NULL.
 */
export async function getRightSpendTrend(
  userId: string,
  months: number = 6,
): Promise<{
  monthly: { month: string; total: number; rightSpend: number; rightPct: number }[];
  avoidableCategories: { category_id: string; total: number; pct: number }[];
}> {
  const db = getDatabase();

  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const startDate = `${startMonth.getFullYear()}-${String(startMonth.getMonth() + 1).padStart(2, "0")}-01`;
  const endDate = getLastDayOfMonth(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );

  // Monthly totals with unavoidable/discretionary split using per-expense is_right_spend
  const rows = await db.getAllAsync<{
    month: string;
    total: number;
    right_spend: number;
  }>(
    `SELECT strftime('%Y-%m', e.date) as month,
            SUM(${effectiveAmountSql("e")}) as total,
            SUM(CASE WHEN COALESCE(e.is_right_spend, 1) = 1 THEN ${effectiveAmountSql("e")} ELSE 0 END) as right_spend
     FROM expenses e
     WHERE e.user_id = ? AND e.status = 'approved' AND e.nature = 'realized'
       AND e.deleted_at IS NULL AND e.date >= ? AND e.date <= ?
     GROUP BY strftime('%Y-%m', e.date)
     ORDER BY month ASC;`,
    userId,
    startDate,
    endDate,
  );

  const monthly = rows.map((r) => ({
    month: r.month,
    total: Math.round(r.total * 100) / 100,
    rightSpend: Math.round(r.right_spend * 100) / 100,
    rightPct: r.total > 0 ? Math.round((r.right_spend / r.total) * 10000) / 100 : 0,
  }));

  // Discretionary categories breakdown (current month) using per-expense is_right_spend
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentStart = `${currentMonth}-01`;
  const currentEnd = getLastDayOfMonth(currentMonth);

  const avoidableRows = await db.getAllAsync<{
    category_id: string;
    total: number;
  }>(
    `SELECT e.category_id, SUM(${effectiveAmountSql("e")}) as total
     FROM expenses e
     WHERE e.user_id = ? AND e.status = 'approved' AND e.nature = 'realized'
       AND e.deleted_at IS NULL AND COALESCE(e.is_right_spend, 1) = 0
       AND e.date >= ? AND e.date <= ? AND e.category_id IS NOT NULL
     GROUP BY e.category_id
     ORDER BY total DESC;`,
    userId,
    currentStart,
    currentEnd,
  );

  const avoidableTotal = avoidableRows.reduce((s, r) => s + r.total, 0);
  const avoidableCategories = avoidableRows.map((r) => ({
    category_id: r.category_id,
    total: Math.round(r.total * 100) / 100,
    pct: avoidableTotal > 0 ? Math.round((r.total / avoidableTotal) * 10000) / 100 : 0,
  }));

  return { monthly, avoidableCategories };
}

// ─── Helpers ───

function getLast3Months(now: Date): [string, string, string] {
  const months: string[] = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    );
  }
  return months as [string, string, string];
}

