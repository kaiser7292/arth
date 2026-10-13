/**
 * Month-by-month value of the user's investments, by form (market / pension / FD),
 * for the line chart on /investments.
 *
 * Read-only: no balance rows are created (getOrCreateMonthBalance is avoided on purpose).
 *   - market (demat / MF / gold…): latest portfolio + fund snapshot on or before each month end,
 *     carried forward — the same numbers the Demat screens show.
 *   - pension (EPF / NPS / PPF): the month's closing balance from the balance chain; unseeded
 *     accounts chain from their first activity (computeUnseededBalance); seeded months with
 *     no row carry the last known value forward.
 *   - FD: principal while it was running (start ≤ month end < maturity).
 * The current month is pinned to `currentValues` so the line ends where the header total is.
 *
 * Market accounts can also be drawn over a chosen period (5D ... 10Y) - getMarketTrend, below.
 */

import { getDatabase } from "@/database";
import { computeUnseededBalance, getClosingBalance, isAccountSeeded } from "@/services/account-balance";
import type { MonthlyTotal } from "@/services/expense-types";
import type { InvestmentProduct } from "@/services/investment-accounts";
import { isDematLikeAccount, isPensionLikeAccount } from "@/services/investment-accounts";

export type InvestmentGroup = "fd" | "market" | "pension";

export interface InvestmentTrend {
  months: string[];
  byGroup: Record<InvestmentGroup, MonthlyTotal[]>;
  /** Each account's value per month (same order as `months`), for the per-category drill-down. */
  byAccount: Record<string, number[]>;
  total: MonthlyTotal[];
}

export function lastNMonths(count: number, now = new Date()): string[] {
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

/** Value as of each month end from dated readings, carrying the latest one forward. */
export function carryForward(readings: { date: string; value: number }[], months: string[]): number[] {
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  let i = 0;
  let last = 0;
  return months.map((m) => {
    const end = monthEnd(m);
    while (i < sorted.length && sorted[i].date <= end) {
      last = sorted[i].value;
      i++;
    }
    return last;
  });
}

export function groupOf(account: { account_type: string }, product: InvestmentProduct | null): InvestmentGroup {
  return isDematLikeAccount(account, product) ? "market" : isPensionLikeAccount(account, product) ? "pension" : "fd";
}

export async function getInvestmentTrend(
  accounts: { id: string; account_type: string }[],
  products: Map<string, InvestmentProduct>,
  currentValues: Map<string, number>,
  monthCount = 12,
): Promise<InvestmentTrend> {
  const db = getDatabase();
  const months = lastNMonths(monthCount);
  const sums: Record<InvestmentGroup, number[]> = {
    market: months.map(() => 0),
    pension: months.map(() => 0),
    fd: months.map(() => 0),
  };
  const last = months.length - 1;
  const byAccount: Record<string, number[]> = {};

  for (const account of accounts) {
    const product = products.get(account.id) ?? null;
    const group = groupOf(account, product);
    let series: number[];

    if (group === "market") {
      const [portfolio, fund] = await Promise.all([
        db.getAllAsync<{ date: string; value: number }>(
          `SELECT snapshot_date AS date, portfolio_value AS value FROM demat_portfolio_snapshots WHERE account_id = ?;`,
          account.id,
        ),
        db.getAllAsync<{ date: string; value: number }>(
          `SELECT snapshot_date AS date, fund_value AS value FROM demat_fund_snapshots WHERE account_id = ?;`,
          account.id,
        ),
      ]);
      const p = carryForward(portfolio, months);
      const f = carryForward(fund, months);
      series = months.map((_, i) => p[i] + f[i]);
    } else if (group === "pension") {
      const seeded = await isAccountSeeded(account.id);
      series = [];
      let carried = 0;
      for (const m of months) {
        let v: number | null = null;
        if (seeded) v = await getClosingBalance(account.id, m);
        else v = (await computeUnseededBalance(account.id, m)).closing;
        if (v != null) carried = v;
        series.push(carried);
      }
    } else {
      const principal = product?.principal ?? 0;
      const start = product?.start_date ?? null;
      const maturity = product?.maturity_date ?? null;
      series = months.map((m) => {
        const end = monthEnd(m);
        const running = start != null && start <= end && (maturity == null || maturity > end);
        return running ? principal : 0;
      });
    }

    const now = currentValues.get(account.id);
    if (now != null) series[last] = now;
    byAccount[account.id] = series.map((v) => Math.round(v * 100) / 100);
    series.forEach((v, i) => {
      sums[group][i] += v;
    });
  }

  const toTotals = (vals: number[]): MonthlyTotal[] =>
    months.map((month, i) => ({ month, total: Math.round(vals[i] * 100) / 100 }));
  return {
    months,
    byGroup: { market: toTotals(sums.market), pension: toTotals(sums.pension), fd: toTotals(sums.fd) },
    byAccount,
    total: toTotals(months.map((_, i) => sums.market[i] + sums.pension[i] + sums.fd[i])),
  };
}

// ─── Market accounts over a chosen period ────────────────────────────────────

export type MarketPeriod = "5D" | "30D" | "3M" | "6M" | "YTD" | "5Y" | "10Y";
export type PeriodUnit = "day" | "week" | "month";

/**
 * Day periods show each day, month periods each week, year periods each month. `phrase` finishes
 * "+₹X ..." under the total.
 */
export const MARKET_PERIODS: { value: MarketPeriod; label: string; unit: PeriodUnit; phrase: string }[] = [
  { value: "5D", label: "5D", unit: "day", phrase: "in 5 days" },
  { value: "30D", label: "30D", unit: "day", phrase: "in 30 days" },
  { value: "3M", label: "3M", unit: "week", phrase: "in 3 months" },
  { value: "6M", label: "6M", unit: "week", phrase: "in 6 months" },
  { value: "YTD", label: "YTD", unit: "month", phrase: "this year" },
  { value: "5Y", label: "5Y", unit: "month", phrase: "in 5 years" },
  { value: "10Y", label: "10Y", unit: "month", phrase: "in 10 years" },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * The dates a period is drawn at, oldest first, always ending today. The first date is the
 * starting point the change is measured from (so 5D has six points: five days ago to today).
 *   day   - every day
 *   week  - every 7 days back from today (13 weeks for 3M, 26 for 6M)
 *   month - each month end, then today (YTD starts from last 31 December)
 */
export function periodPoints(period: MarketPeriod, today = new Date()): string[] {
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const back = (days: number) => iso(new Date(y, m, d - days));
  if (period === "5D" || period === "30D") {
    const n = period === "5D" ? 5 : 30;
    return Array.from({ length: n + 1 }, (_, i) => back(n - i));
  }
  if (period === "3M" || period === "6M") {
    const weeks = period === "3M" ? 13 : 26;
    return Array.from({ length: weeks + 1 }, (_, i) => back((weeks - i) * 7));
  }
  // Month ends: day 0 of the following month. `monthsBack` month ends before this month, then today.
  const monthsBack = period === "YTD" ? m + 1 : period === "5Y" ? 60 : 120;
  const ends = Array.from({ length: monthsBack }, (_, i) => iso(new Date(y, m - (monthsBack - 1 - i), 0)));
  return [...ends, iso(today)];
}

/** The latest reading on or before each date, carried forward (0 before the first reading). */
export function valuesAt(readings: { date: string; value: number }[], dates: string[]): number[] {
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  let i = 0;
  let last = 0;
  return dates.map((date) => {
    while (i < sorted.length && sorted[i].date <= date) {
      last = sorted[i].value;
      i++;
    }
    return last;
  });
}

export interface MarketTrend {
  period: MarketPeriod;
  /** YYYY-MM-DD, oldest first, ending today. Starts where the accounts first have a value. */
  points: string[];
  byAccount: Record<string, number[]>;
  /** False when the accounts' history starts inside the period (the chart starts later). */
  coversPeriod: boolean;
}

/**
 * Each market account's value (portfolio + idle cash snapshots, carried forward) at the period's
 * dates. Today's point is pinned to `currentValues`, so the chart ends on the header total. Dates
 * before any account had a value are dropped rather than drawn as a flat zero.
 */
export async function getMarketTrend(
  accountIds: string[],
  currentValues: Map<string, number>,
  period: MarketPeriod,
  today = new Date(),
): Promise<MarketTrend> {
  const db = getDatabase();
  const all = periodPoints(period, today);
  const last = all.length - 1;
  const series: Record<string, number[]> = {};
  for (const id of accountIds) {
    const [portfolio, fund] = await Promise.all([
      db.getAllAsync<{ date: string; value: number }>(
        `SELECT snapshot_date AS date, portfolio_value AS value FROM demat_portfolio_snapshots WHERE account_id = ?;`,
        id,
      ),
      db.getAllAsync<{ date: string; value: number }>(
        `SELECT snapshot_date AS date, fund_value AS value FROM demat_fund_snapshots WHERE account_id = ?;`,
        id,
      ),
    ]);
    const p = valuesAt(portfolio, all);
    const f = valuesAt(fund, all);
    const values = all.map((_, i) => Math.round((p[i] + f[i]) * 100) / 100);
    const now = currentValues.get(id);
    if (now != null) values[last] = now;
    series[id] = values;
  }
  const firstWithValue = all.findIndex((_, i) => accountIds.some((id) => series[id][i] > 0));
  // Keep at least two points so there is a line to draw.
  const start = Math.max(0, Math.min(firstWithValue < 0 ? last : firstWithValue, last - 1));
  const byAccount: Record<string, number[]> = {};
  for (const id of accountIds) byAccount[id] = series[id].slice(start);
  return { period, points: all.slice(start), byAccount, coversPeriod: start === 0 };
}
