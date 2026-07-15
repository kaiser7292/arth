/**
 * Comparison Insights Service (V4 Phase 2)
 *
 * Provides week-on-week and custom date range comparison queries.
 * Both functions return deltas by total, category, merchant, and payment mode.
 */

import { getDatabase } from "@/database";
import { round2 } from "@/utils/math";
import { getLastDayOfMonth } from "@/utils/date";
import { effectiveAmountSql } from "./expense-effective-amount";

const NOT_BUDGET_EXCLUDED = `
  AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
  AND NOT EXISTS (
    SELECT 1 FROM expense_investment_links l
    WHERE l.expense_id = e.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM expense_loan_links ll
    WHERE ll.expense_id = e.id
  )`;

const NOT_BUDGET_EXCLUDED_BARE = `
  AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
  AND NOT EXISTS (
    SELECT 1 FROM expense_investment_links l
    WHERE l.expense_id = expenses.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM expense_loan_links ll
    WHERE ll.expense_id = expenses.id
  )`;

// ─── Types ───

export interface RangeSummary {
  totalSpent: number;
  transactionCount: number;
  avgPerTransaction: number;
  topCategory: { id: string; name: string; total: number } | null;
  topMerchant: { name: string; total: number } | null;
}

export interface DeltaSummary {
  totalDelta: number;
  totalDeltaPct: number;
  countDelta: number;
}

export interface CategoryComparison {
  categoryId: string;
  categoryName: string;
  range1Total: number;
  range2Total: number;
  delta: number;
  deltaPct: number;
}

export interface MerchantComparison {
  merchantName: string;
  range1Total: number;
  range2Total: number;
  delta: number;
  deltaPct: number;
}

export interface PaymentModeComparison {
  paymentModeId: string;
  paymentModeName: string;
  range1Total: number;
  range2Total: number;
  delta: number;
  deltaPct: number;
}

export interface ComparisonResult {
  range1: { start: string; end: string; summary: RangeSummary };
  range2: { start: string; end: string; summary: RangeSummary };
  delta: DeltaSummary;
  byCategory: CategoryComparison[];
  byMerchant: MerchantComparison[];
  byPaymentMode: PaymentModeComparison[];
}

export interface ComparisonPreset {
  label: string;
  range1Start: string;
  range1End: string;
  range2Start: string;
  range2End: string;
}

// ─── Helpers ───


function deltaPct(old: number, current: number): number {
  if (old === 0) return current > 0 ? 100 : 0;
  return round2(((current - old) / old) * 100);
}

function getWeekBounds(weekOffset: number): { start: string; end: string } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() + mondayOffset + weekOffset * 7);
  thisMonday.setHours(0, 0, 0, 0);

  const sunday = new Date(thisMonday);
  sunday.setDate(thisMonday.getDate() + 6);

  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return { start: fmt(thisMonday), end: fmt(sunday) };
}


// ─── Core Query ───

async function queryRangeSummary(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<RangeSummary> {
  const db = getDatabase();

  const totals = await db.getFirstAsync<{ total: number; count: number }>(
    `SELECT COALESCE(SUM(${effectiveAmountSql("expenses")}), 0) as total, COUNT(*) as count
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND date >= ? AND date <= ?
       ${NOT_BUDGET_EXCLUDED_BARE};`,
    userId,
    startDate,
    endDate,
  );

  const totalSpent = totals?.total ?? 0;
  const transactionCount = totals?.count ?? 0;

  const topCat = await db.getFirstAsync<{ id: string; name: string; total: number }>(
    `SELECT c.id, c.name, SUM(${effectiveAmountSql("e")}) as total
     FROM expenses e
     JOIN categories c ON e.category_id = c.id
     WHERE e.user_id = ? AND e.status = 'approved' AND e.nature = 'realized' AND e.deleted_at IS NULL
       AND e.date >= ? AND e.date <= ?
       ${NOT_BUDGET_EXCLUDED}
     GROUP BY c.id
     ORDER BY total DESC LIMIT 1;`,
    userId,
    startDate,
    endDate,
  );

  const topMerch = await db.getFirstAsync<{ name: string; total: number }>(
    `SELECT COALESCE(merchant_name, 'Unknown') as name, SUM(${effectiveAmountSql("expenses")}) as total
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND merchant_name IS NOT NULL
       AND date >= ? AND date <= ?
       ${NOT_BUDGET_EXCLUDED_BARE}
     GROUP BY merchant_name
     ORDER BY total DESC LIMIT 1;`,
    userId,
    startDate,
    endDate,
  );

  return {
    totalSpent: round2(totalSpent),
    transactionCount,
    avgPerTransaction: transactionCount > 0 ? round2(totalSpent / transactionCount) : 0,
    topCategory: topCat ? { id: topCat.id, name: topCat.name, total: round2(topCat.total) } : null,
    topMerchant: topMerch ? { name: topMerch.name, total: round2(topMerch.total) } : null,
  };
}

async function queryCategoryBreakdown(
  userId: string,
  r1Start: string,
  r1End: string,
  r2Start: string,
  r2End: string,
): Promise<CategoryComparison[]> {
  const db = getDatabase();

  const rows = await db.getAllAsync<{
    category_id: string;
    category_name: string;
    range_tag: string;
    total: number;
  }>(
    `SELECT c.id as category_id, c.name as category_name,
            CASE WHEN e.date >= ? AND e.date <= ? THEN 'r1' ELSE 'r2' END as range_tag,
            SUM(${effectiveAmountSql("e")}) as total
     FROM expenses e
     JOIN categories c ON e.category_id = c.id
     WHERE e.user_id = ? AND e.status = 'approved' AND e.nature = 'realized' AND e.deleted_at IS NULL
       AND ((e.date >= ? AND e.date <= ?) OR (e.date >= ? AND e.date <= ?))
       ${NOT_BUDGET_EXCLUDED}
     GROUP BY c.id, range_tag;`,
    r1Start, r1End,
    userId,
    r1Start, r1End, r2Start, r2End,
  );

  const map = new Map<string, { name: string; r1: number; r2: number }>();
  for (const r of rows) {
    const entry = map.get(r.category_id) ?? { name: r.category_name, r1: 0, r2: 0 };
    if (r.range_tag === "r1") entry.r1 = r.total;
    else entry.r2 = r.total;
    map.set(r.category_id, entry);
  }

  return Array.from(map.entries())
    .map(([categoryId, data]) => ({
      categoryId,
      categoryName: data.name,
      range1Total: round2(data.r1),
      range2Total: round2(data.r2),
      delta: round2(data.r2 - data.r1),
      deltaPct: deltaPct(data.r1, data.r2),
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

async function queryMerchantBreakdown(
  userId: string,
  r1Start: string,
  r1End: string,
  r2Start: string,
  r2End: string,
): Promise<MerchantComparison[]> {
  const db = getDatabase();

  const rows = await db.getAllAsync<{
    merchant_name: string;
    range_tag: string;
    total: number;
  }>(
    `SELECT merchant_name,
            CASE WHEN date >= ? AND date <= ? THEN 'r1' ELSE 'r2' END as range_tag,
            SUM(${effectiveAmountSql("expenses")}) as total
     FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND merchant_name IS NOT NULL
       AND ((date >= ? AND date <= ?) OR (date >= ? AND date <= ?))
       ${NOT_BUDGET_EXCLUDED_BARE}
     GROUP BY merchant_name, range_tag;`,
    r1Start, r1End,
    userId,
    r1Start, r1End, r2Start, r2End,
  );

  const map = new Map<string, { r1: number; r2: number }>();
  for (const r of rows) {
    const key = (r.merchant_name ?? "").toLowerCase();
    const entry = map.get(key) ?? { r1: 0, r2: 0 };
    if (r.range_tag === "r1") entry.r1 += r.total;
    else entry.r2 += r.total;
    map.set(key, entry);
  }

  return Array.from(map.entries())
    .map(([merchantName, data]) => ({
      merchantName,
      range1Total: round2(data.r1),
      range2Total: round2(data.r2),
      delta: round2(data.r2 - data.r1),
      deltaPct: deltaPct(data.r1, data.r2),
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 30);
}

async function queryPaymentModeBreakdown(
  userId: string,
  r1Start: string,
  r1End: string,
  r2Start: string,
  r2End: string,
): Promise<PaymentModeComparison[]> {
  const db = getDatabase();

  const rows = await db.getAllAsync<{
    payment_mode_id: string;
    payment_mode_name: string;
    range_tag: string;
    total: number;
  }>(
    `SELECT COALESCE(e.payment_mode_id, 'unknown') as payment_mode_id,
            COALESCE(pm.name, 'Unknown') as payment_mode_name,
            CASE WHEN e.date >= ? AND e.date <= ? THEN 'r1' ELSE 'r2' END as range_tag,
            SUM(${effectiveAmountSql("e")}) as total
     FROM expenses e
     LEFT JOIN payment_modes pm ON e.payment_mode_id = pm.id
     WHERE e.user_id = ? AND e.status = 'approved' AND e.nature = 'realized' AND e.deleted_at IS NULL
       AND ((e.date >= ? AND e.date <= ?) OR (e.date >= ? AND e.date <= ?))
       ${NOT_BUDGET_EXCLUDED}
     GROUP BY e.payment_mode_id, range_tag;`,
    r1Start, r1End,
    userId,
    r1Start, r1End, r2Start, r2End,
  );

  const map = new Map<string, { name: string; r1: number; r2: number }>();
  for (const r of rows) {
    const entry = map.get(r.payment_mode_id) ?? { name: r.payment_mode_name, r1: 0, r2: 0 };
    if (r.range_tag === "r1") entry.r1 = r.total;
    else entry.r2 = r.total;
    map.set(r.payment_mode_id, entry);
  }

  return Array.from(map.entries())
    .map(([paymentModeId, data]) => ({
      paymentModeId,
      paymentModeName: data.name,
      range1Total: round2(data.r1),
      range2Total: round2(data.r2),
      delta: round2(data.r2 - data.r1),
      deltaPct: deltaPct(data.r1, data.r2),
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

// ─── Drill-Down Queries ───

export type ComparisonDrillFilter =
  | { type: "category"; categoryId: string }
  | { type: "merchant"; merchantName: string }
  | { type: "paymentMode"; paymentModeId: string }
  | { type: "total" };

export async function getComparisonExpenseIds(
  userId: string,
  startDate: string,
  endDate: string,
  filter: ComparisonDrillFilter,
): Promise<string[]> {
  const db = getDatabase();
  let where = `user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0) AND date >= ? AND date <= ? AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id) AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = expenses.id)`;
  const params: string[] = [userId, startDate, endDate];

  if (filter.type === "category") {
    where += ` AND category_id = ?`;
    params.push(filter.categoryId);
  } else if (filter.type === "merchant") {
    where += ` AND LOWER(merchant_name) = ?`;
    params.push(filter.merchantName.toLowerCase());
  } else if (filter.type === "paymentMode") {
    where += ` AND payment_mode_id = ?`;
    params.push(filter.paymentModeId);
  }

  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM expenses WHERE ${where} ORDER BY date DESC;`,
    ...params,
  );
  return rows.map((r) => r.id);
}

// ─── Public API ───

/**
 * Compare spending between two arbitrary date ranges.
 */
export async function getDateRangeComparison(
  userId: string,
  range1Start: string,
  range1End: string,
  range2Start: string,
  range2End: string,
): Promise<ComparisonResult> {
  const [summary1, summary2, byCategory, byMerchant, byPaymentMode] = await Promise.all([
    queryRangeSummary(userId, range1Start, range1End),
    queryRangeSummary(userId, range2Start, range2End),
    queryCategoryBreakdown(userId, range1Start, range1End, range2Start, range2End),
    queryMerchantBreakdown(userId, range1Start, range1End, range2Start, range2End),
    queryPaymentModeBreakdown(userId, range1Start, range1End, range2Start, range2End),
  ]);

  return {
    range1: { start: range1Start, end: range1End, summary: summary1 },
    range2: { start: range2Start, end: range2End, summary: summary2 },
    delta: {
      totalDelta: round2(summary2.totalSpent - summary1.totalSpent),
      totalDeltaPct: deltaPct(summary1.totalSpent, summary2.totalSpent),
      countDelta: summary2.transactionCount - summary1.transactionCount,
    },
    byCategory,
    byMerchant,
    byPaymentMode,
  };
}

/**
 * Compare spending between the current week and previous week.
 * Week = Monday to Sunday.
 */
export async function getWeeklyComparison(
  userId: string,
  weekOffset: number = 0,
): Promise<ComparisonResult> {
  const currentWeek = getWeekBounds(weekOffset);
  const previousWeek = getWeekBounds(weekOffset - 1);

  return getDateRangeComparison(
    userId,
    previousWeek.start,
    previousWeek.end,
    currentWeek.start,
    currentWeek.end,
  );
}

/**
 * Get common comparison presets with pre-calculated date ranges.
 */
export function getComparisonPresets(): ComparisonPreset[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based

  // This Month vs Last Month
  const thisMonthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const thisMonthEnd = getLastDayOfMonth(`${year}-${String(month + 1).padStart(2, "0")}`);
  const lastMonthDate = new Date(year, month - 1, 1);
  const lastMonthYM = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const lastMonthStart = `${lastMonthYM}-01`;
  const lastMonthEnd = getLastDayOfMonth(lastMonthYM);

  // This Quarter vs Last Quarter
  const qMonth = Math.floor(month / 3) * 3; // start month of current quarter (0-based)
  const thisQStart = `${year}-${String(qMonth + 1).padStart(2, "0")}-01`;
  const thisQEndDate = new Date(year, qMonth + 3, 0);
  const thisQEnd = `${thisQEndDate.getFullYear()}-${String(thisQEndDate.getMonth() + 1).padStart(2, "0")}-${String(thisQEndDate.getDate()).padStart(2, "0")}`;

  const lastQStartDate = new Date(year, qMonth - 3, 1);
  const lastQStart = `${lastQStartDate.getFullYear()}-${String(lastQStartDate.getMonth() + 1).padStart(2, "0")}-01`;
  const lastQEndDate = new Date(year, qMonth, 0);
  const lastQEnd = `${lastQEndDate.getFullYear()}-${String(lastQEndDate.getMonth() + 1).padStart(2, "0")}-${String(lastQEndDate.getDate()).padStart(2, "0")}`;

  // Year-over-Year (same month last year)
  const yoyLastYearStart = `${year - 1}-${String(month + 1).padStart(2, "0")}-01`;
  const yoyLastYearEnd = getLastDayOfMonth(`${year - 1}-${String(month + 1).padStart(2, "0")}`);

  // This Week vs Last Week
  const thisWeek = getWeekBounds(0);
  const lastWeek = getWeekBounds(-1);

  return [
    {
      label: "This Week vs Last Week",
      range1Start: lastWeek.start,
      range1End: lastWeek.end,
      range2Start: thisWeek.start,
      range2End: thisWeek.end,
    },
    {
      label: "This Month vs Last Month",
      range1Start: lastMonthStart,
      range1End: lastMonthEnd,
      range2Start: thisMonthStart,
      range2End: thisMonthEnd,
    },
    {
      label: "This Quarter vs Last Quarter",
      range1Start: lastQStart,
      range1End: lastQEnd,
      range2Start: thisQStart,
      range2End: thisQEnd,
    },
    {
      label: "Year-over-Year (This Month)",
      range1Start: yoyLastYearStart,
      range1End: yoyLastYearEnd,
      range2Start: thisMonthStart,
      range2End: thisMonthEnd,
    },
  ];
}
