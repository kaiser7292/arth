/**
 * Year over Year — two financial years side by side, from real data.
 *
 * Works with or without a yearly plan: every figure comes from transactions, transfers, loan
 * schedules and the net worth history. A year's plan, when it has one, only adds "plan" figures
 * to Spent and Invested.
 *
 * Fair by default: a year still in progress is compared with the SAME stretch of the other year
 * (1 Apr to today's date, a year earlier), never with the other year in full.
 *
 * Spending, money in and investing use the same rules as Year in Review (year-review.ts), so the
 * two screens agree. docs/SETTINGS_AND_ANALYSE_PROPOSAL.md, Part B.
 */

import { getLoanPaymentsBetween } from "@/services/loan-accounts";
import { getNetWorthHistory, prevMonth, type NetWorthPoint } from "@/services/net-worth-history";
import { categoryNames, invested, moneyIn, summariseSpending, type SpendSummary } from "@/services/reports/year-review";
import { getDataVersion, getFYStartMonth } from "@/services/settings";
import { getYearlyPlans } from "@/services/yearly-plan";
import { formatLocalDate, getFYLabel, getFYRange } from "@/utils/fiscal-year";

export type YoYMode = "same-period" | "full";

export interface YoYPeriod {
  fy: number;
  label: string;
  startDate: string;
  endDate: string;
  moneyIn: number;
  spent: number;
  /** (money in − spent) / money in, as a percentage; null when nothing came in. */
  savedPct: number | null;
  invested: number;
  loansRepaid: number;
  /** Change in net worth across the period; null when there's no history for it. */
  netWorthChange: number | null;
  /** From the FY's yearly plan, scaled to the period's length; null without a plan. */
  planSpent: number | null;
  planInvested: number | null;
  /** Spending added up month by month, one value per month of the period. */
  cumulative: number[];
}

export interface YoYMover {
  categoryId: string | null;
  name: string;
  prev: number;
  curr: number;
  /** null when the category had no spending in the base year. */
  changePct: number | null;
  /** This period's transactions in the category, for drilling in. */
  expenseIds: string[];
}

export interface YoYComparison {
  mode: YoYMode;
  /** True when `current` is a year still in progress and the comparison is cut to the same stretch. */
  partial: boolean;
  current: YoYPeriod;
  base: YoYPeriod;
  /** Month labels for the cumulative chart ("Apr", "May", …), as long as the longer period. */
  monthLabels: string[];
  movers: YoYMover[];
  summary: string;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const round2 = (n: number) => Math.round(n * 100) / 100;

function shiftYears(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number);
  // Clamp 29 Feb to the 28th in a year without one.
  const last = new Date(y + years, m, 0).getDate();
  return `${y + years}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let m = start.slice(0, 7); m <= end.slice(0, 7); ) {
    out.push(m);
    const [y, mo] = m.split("-").map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  return out;
}

function pointAtOrBefore(points: NetWorthPoint[], month: string): NetWorthPoint | undefined {
  let found: NetWorthPoint | undefined;
  for (const p of points) {
    if (p.month <= month) found = p;
    else break;
  }
  return found;
}

const pctChange = (curr: number, prev: number) => (prev > 0 ? round2(((curr - prev) / prev) * 100) : null);

/** One plain sentence: what changed most usefully. */
export function summarise(c: Pick<YoYComparison, "current" | "base" | "partial">): string {
  const spentPct = pctChange(c.current.spent, c.base.spent);
  const pts =
    c.current.savedPct != null && c.base.savedPct != null ? Math.round(c.current.savedPct - c.base.savedPct) : null;
  const when = c.partial ? "this time last year" : c.base.label;
  const parts: string[] = [];
  if (spentPct != null && Math.abs(spentPct) >= 1) {
    parts.push(`spending ${Math.abs(Math.round(spentPct))}% ${spentPct < 0 ? "less" : "more"}`);
  }
  if (pts != null && pts !== 0) parts.push(`saving ${Math.abs(pts)} point${Math.abs(pts) === 1 ? "" : "s"} ${pts > 0 ? "more" : "less"}`);
  if (parts.length === 0) return `About the same as ${when}.`;
  return `You're ${parts.join(" and ")} than ${when}.`;
}

async function buildPeriod(
  userId: string,
  fy: number,
  startDate: string,
  endDate: string,
  fyMonths: number,
  plans: Awaited<ReturnType<typeof getYearlyPlans>>,
  history: NetWorthPoint[],
): Promise<{ period: YoYPeriod; spend: SpendSummary }> {
  const startMonth = getFYStartMonth();
  const [spend, inTotal, inv, loans] = await Promise.all([
    summariseSpending(userId, startDate, endDate),
    moneyIn(userId, startDate, endDate),
    invested(userId, startDate, endDate),
    getLoanPaymentsBetween(userId, startDate, endDate),
  ]);

  const months = monthsBetween(startDate, endDate);
  let running = 0;
  const cumulative = months.map((m) => (running = round2(running + (spend.byMonth.get(m) ?? 0))));

  const base = pointAtOrBefore(history, prevMonth(startDate.slice(0, 7)));
  const end = pointAtOrBefore(history, endDate.slice(0, 7));
  const netWorthChange = base && end && end !== base ? round2(end.netWorth - base.netWorth) : null;

  const plan = plans.find((p) => p.financial_year === String(fy) || p.financial_year.startsWith(`${fy}-`));
  // A plan is for the whole year; scale it to the stretch being compared.
  const share = Math.min(1, months.length / fyMonths);

  return {
    spend,
    period: {
      fy,
      label: getFYLabel(fy, startMonth),
      startDate,
      endDate,
      moneyIn: round2(inTotal),
      spent: round2(spend.total),
      savedPct: inTotal > 0 ? round2(((inTotal - spend.total) / inTotal) * 100) : null,
      invested: round2(inv.amount),
      loansRepaid: round2(loans),
      netWorthChange,
      planSpent: plan && plan.total_planned_expenses > 0 ? round2(plan.total_planned_expenses * share) : null,
      planInvested: plan && plan.total_planned_investments > 0 ? round2(plan.total_planned_investments * share) : null,
      cumulative,
    },
  };
}

export async function computeYoY(
  userId: string,
  fy: number,
  baseFy: number,
  mode: YoYMode,
  today: string = formatLocalDate(new Date()),
): Promise<YoYComparison> {
  const startMonth = getFYStartMonth();
  const curRange = getFYRange(fy, startMonth);
  const baseRange = getFYRange(baseFy, startMonth);
  const curStart = formatLocalDate(curRange.start);
  const curFyEnd = formatLocalDate(curRange.end);
  const baseStart = formatLocalDate(baseRange.start);
  const baseFyEnd = formatLocalDate(baseRange.end);

  const inProgress = curFyEnd > today && curStart <= today;
  const curEnd = inProgress ? today : curFyEnd;
  const partial = inProgress && mode === "same-period";
  // Same stretch of the base year: shift the cut-off by the years between them.
  const baseEnd = partial ? shiftYears(curEnd, baseFy - fy) : baseFyEnd;
  const fyMonths = monthsBetween(curStart, curFyEnd).length;

  const [plans, history, cats] = await Promise.all([
    getYearlyPlans(userId),
    getNetWorthHistory(userId).then((h) => h.points).catch(() => [] as NetWorthPoint[]),
    categoryNames(userId),
  ]);
  const [cur, base] = await Promise.all([
    buildPeriod(userId, fy, curStart, curEnd, fyMonths, plans, history),
    buildPeriod(userId, baseFy, baseStart, baseEnd, fyMonths, plans, history),
  ]);

  const ids = new Set([...cur.spend.byCategory.keys(), ...base.spend.byCategory.keys()]);
  const movers: YoYMover[] = [...ids]
    .map((id) => {
      const curr = round2(cur.spend.byCategory.get(id) ?? 0);
      const prev = round2(base.spend.byCategory.get(id) ?? 0);
      return {
        categoryId: id || null,
        name: id ? cats.get(id)?.name ?? "Uncategorised" : "Uncategorised",
        prev,
        curr,
        changePct: pctChange(curr, prev),
        expenseIds: cur.spend.idsByCategory.get(id) ?? [],
      };
    })
    .filter((m) => Math.abs(m.curr - m.prev) >= 1)
    .sort((a, b) => Math.abs(b.curr - b.prev) - Math.abs(a.curr - a.prev))
    .slice(0, 5);

  // The chart's x axis is the whole financial year, so a year in progress visibly stops part-way.
  const monthLabels = monthsBetween(curStart, curFyEnd).map((m) => SHORT_MONTHS[Number(m.slice(5, 7)) - 1]);

  const result = { mode, partial, current: cur.period, base: base.period, monthLabels, movers, summary: "" };
  result.summary = summarise(result);
  return result;
}

// ── Cache: recompute only after a write (data version) or a new day ──

const cache = new Map<string, Promise<YoYComparison>>();
let cacheVersion = -1;

export function getYoY(userId: string, fy: number, baseFy: number, mode: YoYMode): Promise<YoYComparison> {
  const version = getDataVersion();
  if (version !== cacheVersion) {
    cache.clear();
    cacheVersion = version;
  }
  const today = formatLocalDate(new Date());
  const key = `${userId}|${fy}|${baseFy}|${mode}|${today}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const value = computeYoY(userId, fy, baseFy, mode, today);
  cache.set(key, value);
  value.catch(() => cache.delete(key));
  return value;
}
