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
