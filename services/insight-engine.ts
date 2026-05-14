/**
 * Insight Engine — Analytics V2
 *
 * Generates severity-scored, actionable insights from expense data.
 * Each insight is tappable and leads to a drill-down detail screen.
 */

import { getDatabase } from "@/database";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { round2 } from "@/utils/math";
import { effectiveAmountSql } from "./expense-effective-amount";

/**
 * v17.0.0: Exclude expenses linked to investment buckets from spending insights
 * (Lifestyle Creep, Leaks, Spending Forecast, Budget Breach). Linked expenses
 * are savings contributions, not spending; counting them would confuse "your
 * food spend doubled" vs "you started a Retirement SIP".
 *
 * The alias is usually `e`; for bare `FROM expenses` use `expenses`.
 */
const NOT_LINKED_E = `
  AND NOT EXISTS (
    SELECT 1 FROM expense_investment_links l
    WHERE l.expense_id = e.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM expense_loan_links ll
    WHERE ll.expense_id = e.id
  )
`;
const NOT_LINKED_BARE = `
  AND NOT EXISTS (
    SELECT 1 FROM expense_investment_links l
    WHERE l.expense_id = expenses.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM expense_loan_links ll
    WHERE ll.expense_id = expenses.id
  )
`;

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

export type InsightSeverity = "celebrate" | "info" | "warning" | "critical";

export type InsightType =
  | "budget_breach"
  | "lifestyle_creep"
  | "savings_win"
  | "micro_leaks"
  | "category_spike";

export interface Insight {
  id: string;
  type: InsightType;
  severity: InsightSeverity;
  title: string;
  detail: string;
  metric?: string;
  categoryId?: string;
  categoryName?: string;
  trendData?: number[];
  score: number;
}

export interface InsightDrillGroup {
  label: string;
  amount: number;
  count: number;
  percentage: number;
  expenseIds: string[];
  /** Optional YoY comparison (populated for lifestyle-creep drill). */
  comparison?: {
    previousAmount: number;
    deltaAmount: number;
    deltaPct: number | null; // null = previousAmount is 0 ("new this year")
  };
}

export interface InsightDetail {
  insight: Insight;
  drillGroups: InsightDrillGroup[];
  totalAmount: number;
  budgetAmount?: number;
  suggestion?: string;
  /** Populated for lifestyle-creep drill. Headline totals + window labels. */
  yoyComparison?: {
    currentTotal: number;
    previousTotal: number;
    currentLabel: string; // e.g. "Mar–May 2026"
    previousLabel: string; // e.g. "Mar–May 2025"
  };
}

// ═══════════════════════════════════════════════
// Main Entry Point
// ═══════════════════════════════════════════════

export async function getInsights(
  userId: string,
  month?: string,
  limit: number = 5,
): Promise<Insight[]> {
  const now = new Date();
  const yearMonth = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const insights: Insight[] = [];

  const [breaches, creep, wins, leaks] = await Promise.all([
    detectBudgetBreaches(userId, yearMonth),
    detectLifestyleCreep(userId, yearMonth),
    detectSavingsWins(userId, yearMonth),
    detectMicroLeaks(userId, yearMonth),
  ]);

  insights.push(...breaches, ...creep, ...wins, ...leaks);

  // Sort by score descending, take top N
  insights.sort((a, b) => b.score - a.score);
  return insights.slice(0, limit);
}

// ═══════════════════════════════════════════════
// Insight Detectors
// ═══════════════════════════════════════════════

async function detectBudgetBreaches(userId: string, yearMonth: string): Promise<Insight[]> {
  const db = getDatabase();
  const { startDate, endDate } = getMonthDateRange(yearMonth);

  const rows = await db.getAllAsync<{
    category_id: string;
    category_name: string;
    spent: number;
    budget: number;
  }>(
    `SELECT e.category_id, c.name as category_name,
            SUM(${effectiveAmountSql("e")}) as spent, b.amount as budget
     FROM expenses e
     JOIN categories c ON c.id = e.category_id
     JOIN budgets b ON b.category_id = e.category_id AND b.month = ?
     WHERE e.user_id = ? AND e.status = 'approved' AND e.nature = 'realized'
       AND e.deleted_at IS NULL AND e.date >= ? AND e.date <= ?
       AND e.category_id IS NOT NULL
       ${NOT_LINKED_E}
     GROUP BY e.category_id
     HAVING spent > budget;`,
    yearMonth,
    userId,
    startDate,
    endDate,
  );

  return rows.map((row) => {
    const overPct = Math.round(((row.spent - row.budget) / row.budget) * 100);
    const severity: InsightSeverity = overPct > 50 ? "critical" : "warning";

    return {
      id: `breach_${row.category_id}_${yearMonth}`,
      type: "budget_breach" as InsightType,
      severity,
      title: `${row.category_name} ${overPct}% over budget`,
      detail: `${formatCurrency(row.spent)} of ${formatCurrency(row.budget)} budget`,
      metric: `+${formatCurrency(row.spent - row.budget)}`,
      categoryId: row.category_id,
      categoryName: row.category_name,
      score: 70 + Math.min(overPct, 30),
    };
  });
}

async function detectLifestyleCreep(userId: string, yearMonth: string): Promise<Insight[]> {
  const db = getDatabase();
  const [year, month] = yearMonth.split("-").map(Number);

  // Compare last 3 months average vs same 3 months last year
  const currentEnd = `${yearMonth}-${new Date(year, month, 0).getDate()}`;
  const currentStart = `${year}-${String(month - 2).padStart(2, "0")}-01`;

  const lastYearEnd = `${year - 1}-${String(month).padStart(2, "0")}-${new Date(year - 1, month, 0).getDate()}`;
  const lastYearStart = `${year - 1}-${String(month - 2).padStart(2, "0")}-01`;

  const [currentRow, lastYearRow] = await Promise.all([
    db.getFirstAsync<{ avg: number | null }>(
      `SELECT SUM(${effectiveAmountSql("expenses")}) / 3.0 as avg FROM expenses
       WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
         AND date >= ? AND date <= ?
         ${NOT_LINKED_BARE};`,
      userId, currentStart, currentEnd,
    ),
    db.getFirstAsync<{ avg: number | null }>(
      `SELECT SUM(${effectiveAmountSql("expenses")}) / 3.0 as avg FROM expenses
       WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
         AND date >= ? AND date <= ?
         ${NOT_LINKED_BARE};`,
      userId, lastYearStart, lastYearEnd,
    ),
  ]);

  if (!currentRow?.avg || !lastYearRow?.avg || lastYearRow.avg === 0) return [];

  const creepPct = Math.round(((currentRow.avg - lastYearRow.avg) / lastYearRow.avg) * 100);
  if (creepPct < 15) return [];

  return [{
    id: `creep_${yearMonth}`,
    type: "lifestyle_creep",
    severity: creepPct > 30 ? "warning" : "info",
    title: `Lifestyle creep +${creepPct}% YoY`,
    detail: `Monthly average up from ${formatCurrency(lastYearRow.avg)} to ${formatCurrency(currentRow.avg)}`,
    score: 50 + Math.min(creepPct, 30),
  }];
}

async function detectSavingsWins(userId: string, yearMonth: string): Promise<Insight[]> {
  const db = getDatabase();
  const { startDate, endDate } = getMonthDateRange(yearMonth);
  const [year, month] = yearMonth.split("-").map(Number);

  // Previous month
  const prevMonth = month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, "0")}`;
  const prevRange = getMonthDateRange(prevMonth);

  const rows = await db.getAllAsync<{
    category_id: string;
    category_name: string;
    current_total: number;
  }>(
    `SELECT e.category_id, c.name as category_name, SUM(${effectiveAmountSql("e")}) as current_total
     FROM expenses e
     JOIN categories c ON c.id = e.category_id
     WHERE e.user_id = ? AND e.status = 'approved' AND e.nature = 'realized'
       AND e.deleted_at IS NULL AND e.date >= ? AND e.date <= ?
       AND e.category_id IS NOT NULL
       ${NOT_LINKED_E}
     GROUP BY e.category_id;`,
    userId, startDate, endDate,
  );

  const prevRows = await db.getAllAsync<{
    category_id: string;
    prev_total: number;
  }>(
    `SELECT category_id, SUM(${effectiveAmountSql("expenses")}) as prev_total FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND date >= ? AND date <= ? AND category_id IS NOT NULL
       ${NOT_LINKED_BARE}
     GROUP BY category_id;`,
    userId, prevRange.startDate, prevRange.endDate,
  );

  const prevMap = new Map(prevRows.map((r) => [r.category_id, r.prev_total]));
  const insights: Insight[] = [];

  for (const row of rows) {
    const prev = prevMap.get(row.category_id);
    if (!prev || prev === 0) continue;

    const dropPct = Math.round(((prev - row.current_total) / prev) * 100);
    if (dropPct < 15) continue;

    const saved = round2(prev - row.current_total);
    insights.push({
      id: `win_${row.category_id}_${yearMonth}`,
      type: "savings_win",
      severity: "celebrate",
      title: `${row.category_name} down ${dropPct}%`,
      detail: `Saved ${formatCurrency(saved)} vs last month`,
      categoryId: row.category_id,
      categoryName: row.category_name,
      score: 40 + Math.min(dropPct, 20),
    });
  }

  return insights.sort((a, b) => b.score - a.score).slice(0, 2);
}

async function detectMicroLeaks(userId: string, yearMonth: string): Promise<Insight[]> {
  const db = getDatabase();
  const { startDate, endDate } = getMonthDateRange(yearMonth);

  // Small transactions (< ₹500) that add up. Filters on `amount < 500` use
  // the raw column (micro-leaks are about the individual transaction size,
  // not the effective amount). Total uses effective amount so a ₹499 debit
  // refunded in full no longer shows as a "leak".
  const row = await db.getFirstAsync<{ total: number | null; count: number }>(
    `SELECT SUM(${effectiveAmountSql("expenses")}) as total, COUNT(*) as count FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND date >= ? AND date <= ? AND amount < 500 AND amount > 0
       ${NOT_LINKED_BARE};`,
    userId, startDate, endDate,
  );

  if (!row?.total || row.total < 3000) return [];

  return [{
    id: `leaks_${yearMonth}`,
    type: "micro_leaks",
    severity: "info",
    title: `Micro-leaks: ${formatCurrency(row.total)}/month`,
    detail: `${row.count} small transactions adding up`,
    score: 35 + Math.min(Math.round(row.total / 1000), 20),
  }];
}

// ═══════════════════════════════════════════════
// Drill-Down Detail
// ═══════════════════════════════════════════════

export async function getInsightDrill(
  userId: string,
  insightId: string,
  month?: string,
): Promise<InsightDetail | null> {
  const db = getDatabase();
  const now = new Date();
  const yearMonth = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const { startDate, endDate } = getMonthDateRange(yearMonth);

  // Parse insight type and category from ID
  const parts = insightId.split("_");
  const type = parts[0];
  const categoryId = parts.length > 2 ? parts[1] : undefined;

  if (type === "breach" && categoryId) {
    return getBudgetBreachDrill(db, userId, categoryId, yearMonth, startDate, endDate);
  }

  if (type === "win" && categoryId) {
    return getSavingsWinDrill(db, userId, categoryId, yearMonth, startDate, endDate);
  }

  if (type === "leaks") {
    return getMicroLeaksDrill(db, userId, yearMonth, startDate, endDate);
  }

  if (type === "creep") {
    return getLifestyleCreepDrill(db, userId, yearMonth);
  }

  return null;
}

async function getLifestyleCreepDrill(
  db: ReturnType<typeof getDatabase>,
  userId: string,
  yearMonth: string,
): Promise<InsightDetail> {
  const [year, month] = yearMonth.split("-").map(Number);

  const currentEnd = `${yearMonth}-${new Date(year, month, 0).getDate()}`;
  const currentStart = `${year}-${String(month - 2).padStart(2, "0")}-01`;

  const lastYearEnd = `${year - 1}-${String(month).padStart(2, "0")}-${new Date(year - 1, month, 0).getDate()}`;
  const lastYearStart = `${year - 1}-${String(month - 2).padStart(2, "0")}-01`;

  const [currentRows, lastYearRows] = await Promise.all([
    db.getAllAsync<{
      category_id: string | null;
      category_name: string;
      total: number;
      count: number;
      expense_ids: string;
    }>(
      `SELECT e.category_id,
              COALESCE(c.name, 'Uncategorized') as category_name,
              SUM(${effectiveAmountSql("e")}) as total,
              COUNT(*) as count,
              GROUP_CONCAT(e.id) as expense_ids
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.user_id = ? AND e.status = 'approved' AND e.nature = 'realized'
         AND e.deleted_at IS NULL AND e.date >= ? AND e.date <= ?
       GROUP BY e.category_id
       ORDER BY total DESC;`,
      userId, currentStart, currentEnd,
    ),
    db.getAllAsync<{
      category_id: string | null;
      total: number;
    }>(
      `SELECT e.category_id, SUM(${effectiveAmountSql("e")}) as total
       FROM expenses e
       WHERE e.user_id = ? AND e.status = 'approved' AND e.nature = 'realized'
         AND e.deleted_at IS NULL AND e.date >= ? AND e.date <= ?
       GROUP BY e.category_id;`,
      userId, lastYearStart, lastYearEnd,
    ),
  ]);

  const lastYearMap = new Map(lastYearRows.map((r) => [r.category_id ?? "__uncat__", r.total]));

  const currentTotal = currentRows.reduce((s, r) => s + r.total, 0);
  const lastYearTotal = lastYearRows.reduce((s, r) => s + r.total, 0);

  const drillGroups: InsightDrillGroup[] = currentRows.map((r) => {
    const key = r.category_id ?? "__uncat__";
    const prev = lastYearMap.get(key) ?? 0;
    const delta = r.total - prev;
    const deltaPct = prev > 0 ? Math.round((delta / prev) * 100) : null;
    return {
      label: r.category_name,
      amount: round2(r.total),
      count: r.count,
      percentage: currentTotal > 0 ? Math.round((r.total / currentTotal) * 100) : 0,
      expenseIds: r.expense_ids ? r.expense_ids.split(",") : [],
      comparison: {
        previousAmount: round2(prev),
        deltaAmount: round2(delta),
        deltaPct,
      },
    };
  });

  drillGroups.sort((a, b) => (b.comparison?.deltaAmount ?? 0) - (a.comparison?.deltaAmount ?? 0));

  const creepPct = lastYearTotal > 0
    ? Math.round((((currentTotal / 3) - (lastYearTotal / 3)) / (lastYearTotal / 3)) * 100)
    : 0;

  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Current window = (month-2) .. month, inclusive. month is 1-indexed.
  const currentStartMonth = MONTH_NAMES[month - 3] ?? MONTH_NAMES[(month - 3 + 12) % 12];
  const currentEndMonth = MONTH_NAMES[month - 1];
  const currentLabel = `${currentStartMonth}–${currentEndMonth} ${year}`;
  const previousLabel = `${currentStartMonth}–${currentEndMonth} ${year - 1}`;

  return {
    insight: {
      id: `creep_${yearMonth}`,
      type: "lifestyle_creep",
      severity: creepPct > 30 ? "warning" : "info",
      title: `Lifestyle creep +${creepPct}% YoY`,
      detail: `Monthly average up from ${formatCurrency(lastYearTotal / 3)} to ${formatCurrency(currentTotal / 3)}`,
      score: 50 + Math.min(creepPct, 30),
    },
    drillGroups,
    totalAmount: round2(currentTotal),
    yoyComparison: {
      currentTotal: round2(currentTotal),
      previousTotal: round2(lastYearTotal),
      currentLabel,
      previousLabel,
    },
  };
}

async function getBudgetBreachDrill(
  db: ReturnType<typeof getDatabase>,
  userId: string,
  categoryId: string,
  yearMonth: string,
  startDate: string,
  endDate: string,
): Promise<InsightDetail> {
  // Group by merchant within the breached category
  const rows = await db.getAllAsync<{
    merchant_name: string | null;
    total: number;
    count: number;
    expense_ids: string;
  }>(
    `SELECT COALESCE(merchant_name, 'Unknown') as merchant_name,
            SUM(${effectiveAmountSql("expenses")}) as total, COUNT(*) as count,
            GROUP_CONCAT(id) as expense_ids
     FROM expenses
     WHERE user_id = ? AND category_id = ? AND status = 'approved' AND nature = 'realized'
       AND deleted_at IS NULL AND date >= ? AND date <= ?
     GROUP BY merchant_name
     ORDER BY total DESC;`,
    userId, categoryId, startDate, endDate,
  );

  const totalAmount = rows.reduce((s, r) => s + r.total, 0);

  const budgetRow = await db.getFirstAsync<{ amount: number }>(
    `SELECT amount FROM budgets WHERE user_id = ? AND category_id = ? AND month = ?;`,
    userId, categoryId, yearMonth,
  );

  const catRow = await db.getFirstAsync<{ name: string }>(
    `SELECT name FROM categories WHERE id = ?;`, categoryId,
  );

  const drillGroups: InsightDrillGroup[] = rows.map((r) => ({
    label: r.merchant_name ?? "Unknown",
    amount: round2(r.total),
    count: r.count,
    percentage: totalAmount > 0 ? Math.round((r.total / totalAmount) * 100) : 0,
    expenseIds: r.expense_ids ? r.expense_ids.split(",") : [],
  }));

  const overPct = budgetRow && budgetRow.amount > 0
    ? Math.round(((totalAmount - budgetRow.amount) / budgetRow.amount) * 100)
    : 0;

  return {
    insight: {
      id: `breach_${categoryId}_${yearMonth}`,
      type: "budget_breach",
      severity: overPct > 50 ? "critical" : "warning",
      title: `${catRow?.name ?? "Category"} ${overPct}% over budget`,
      detail: `${formatCurrency(totalAmount)} of ${formatCurrency(budgetRow?.amount ?? 0)} budget`,
      categoryId,
      categoryName: catRow?.name,
      score: 70 + Math.min(overPct, 30),
    },
    drillGroups,
    totalAmount: round2(totalAmount),
    budgetAmount: budgetRow?.amount,
  };
}

async function getSavingsWinDrill(
  db: ReturnType<typeof getDatabase>,
  userId: string,
  categoryId: string,
  yearMonth: string,
  startDate: string,
  endDate: string,
): Promise<InsightDetail> {
  const rows = await db.getAllAsync<{
    merchant_name: string | null;
    total: number;
    count: number;
    expense_ids: string;
  }>(
    `SELECT COALESCE(merchant_name, 'Unknown') as merchant_name,
            SUM(${effectiveAmountSql("expenses")}) as total, COUNT(*) as count,
            GROUP_CONCAT(id) as expense_ids
     FROM expenses
     WHERE user_id = ? AND category_id = ? AND status = 'approved' AND nature = 'realized'
       AND deleted_at IS NULL AND date >= ? AND date <= ?
     GROUP BY merchant_name
     ORDER BY total DESC;`,
    userId, categoryId, startDate, endDate,
  );

  const totalAmount = rows.reduce((s, r) => s + r.total, 0);
  const catRow = await db.getFirstAsync<{ name: string }>(
    `SELECT name FROM categories WHERE id = ?;`, categoryId,
  );

  const drillGroups: InsightDrillGroup[] = rows.map((r) => ({
    label: r.merchant_name ?? "Unknown",
    amount: round2(r.total),
    count: r.count,
    percentage: totalAmount > 0 ? Math.round((r.total / totalAmount) * 100) : 0,
    expenseIds: r.expense_ids ? r.expense_ids.split(",") : [],
  }));

  return {
    insight: {
      id: `win_${categoryId}_${yearMonth}`,
      type: "savings_win",
      severity: "celebrate",
      title: `${catRow?.name ?? "Category"} spending down`,
      detail: `${formatCurrency(totalAmount)} this month`,
      categoryId,
      categoryName: catRow?.name,
      score: 50,
    },
    drillGroups,
    totalAmount: round2(totalAmount),
  };
}

async function getMicroLeaksDrill(
  db: ReturnType<typeof getDatabase>,
  userId: string,
  yearMonth: string,
  startDate: string,
  endDate: string,
): Promise<InsightDetail> {
  const rows = await db.getAllAsync<{
    category_name: string;
    total: number;
    count: number;
    expense_ids: string;
  }>(
    `SELECT COALESCE(c.name, 'Uncategorized') as category_name,
            SUM(${effectiveAmountSql("e")}) as total, COUNT(*) as count,
            GROUP_CONCAT(e.id) as expense_ids
     FROM expenses e
     LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.user_id = ? AND e.status = 'approved' AND e.nature = 'realized'
       AND e.deleted_at IS NULL AND e.date >= ? AND e.date <= ?
       AND e.amount < 500 AND e.amount > 0
     GROUP BY e.category_id
     ORDER BY total DESC;`,
    userId, startDate, endDate,
  );

  const totalAmount = rows.reduce((s, r) => s + r.total, 0);

  const drillGroups: InsightDrillGroup[] = rows.map((r) => ({
    label: r.category_name,
    amount: round2(r.total),
    count: r.count,
    percentage: totalAmount > 0 ? Math.round((r.total / totalAmount) * 100) : 0,
    expenseIds: r.expense_ids ? r.expense_ids.split(",") : [],
  }));

  return {
    insight: {
      id: `leaks_${yearMonth}`,
      type: "micro_leaks",
      severity: "info",
      title: `Micro-leaks: ${formatCurrency(totalAmount)}/month`,
      detail: `Small transactions adding up`,
      score: 40,
    },
    drillGroups,
    totalAmount: round2(totalAmount),
  };
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function formatCurrency(amount: number): string {
  return `\u20B9${Math.round(amount).toLocaleString("en-IN")}`;
}
