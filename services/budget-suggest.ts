/**
 * Budget figures from what was really spent, for onboarding's budget step: the average of the
 * last complete months (up to 3) per category, rounded up to the next ₹500.
 *
 * The spend comes from getBudgetVsActual, the same function the Budget tab shows actuals with,
 * so a suggested budget and the "spent" next to it later are the same figure (sub-categories
 * count toward their parent, refunds netted, transfers, investments and loans left out).
 */

import { getDatabase } from "@/database";
import { getBudgetVsActual } from "@/services/budget";
import { getStartDate } from "@/services/start-date";
import { formatLocalDate } from "@/utils/fiscal-year";

export const MAX_MONTHS = 3;
const ROUND_TO = 500;

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * The complete months to average: from the first whole month with spending to last month,
 * the last `max` of them. Pure; exported for tests. Empty when there's no whole month yet.
 */
export function wholeMonths(earliest: string | null, today: Date, max: number = MAX_MONTHS): string[] {
  if (!earliest) return [];
  const [y, m, d] = earliest.split("-").map(Number);
  // A month that starts part-way through isn't a whole month of spending.
  const first = new Date(y, m - 1 + (d > 1 ? 1 : 0), 1);
  const lastFull = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const out: string[] = [];
  for (let cur = new Date(lastFull); cur >= first && out.length < max; cur = new Date(cur.getFullYear(), cur.getMonth() - 1, 1)) {
    out.unshift(ym(cur));
  }
  return out;
}

/** Round up to the next ₹500. Pure. */
export function roundBudget(amount: number): number {
  return amount <= 0 ? 0 : Math.ceil(amount / ROUND_TO) * ROUND_TO;
}

export interface HistoryBudgets {
  /** How many whole months the figures average; 0 = no suggestion. */
  months: number;
  /** categoryId -> suggested monthly budget. Only categories with spending. */
  amounts: Map<string, number>;
}

export async function budgetsFromHistory(userId: string, today: Date = new Date()): Promise<HistoryBudgets> {
  const row = await getDatabase().getFirstAsync<{ first: string | null }>(
    `SELECT MIN(date) AS first FROM expenses WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL;`,
    userId,
  );
  // Reports leave out what's before the start date, so budgets do too.
  const start = getStartDate();
  const earliest = row?.first && start && start > row.first ? start : (row?.first ?? null);
  const months = wholeMonths(earliest, today);
  if (months.length === 0) return { months: 0, amounts: new Map() };

  const first = months[0];
  const last = months[months.length - 1];
  const [ly, lm] = last.split("-").map(Number);
  const endDate = formatLocalDate(new Date(ly, lm, 0));
  const result = await getBudgetVsActual(userId, first, last, `${first}-01`, endDate);
  const amounts = new Map<string, number>();
  for (const r of [...result.rows, ...result.unbudgetedRows]) {
    const monthly = roundBudget(r.totalActual / months.length);
    if (monthly > 0) amounts.set(r.categoryId, monthly);
  }
  return { months: months.length, amounts };
}
