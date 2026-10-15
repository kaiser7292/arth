/**
 * Value of the user's investments over a chosen period (5D ... Max), for the stacked chart on
 * /investments - every account, valued at each date the period is drawn at:
 *   - market (demat / MF / gold / crypto): the latest portfolio + idle-cash snapshots on or before
 *     the date, carried forward - the same numbers the Demat screens show.
 *   - pension (EPF / NPS / PPF): the balance-chain value on the date - an opening balance (the
 *     latest seeded month on or before it) plus the money in and out since, with the same rules
 *     as account-balance.ts (expenses, credits, transfers, ledger adjustments). Unseeded accounts
 *     run from zero at their first activity. Done in one pass, not month by month.
 *   - FD: its principal while it was running (start <= date < maturity).
 * Today's point is pinned to the live value, so the chart ends where the header total is.
 * Read-only: no balance rows are created (getOrCreateMonthBalance is avoided on purpose).
 */

import { getDatabase } from "@/database";
import type { InvestmentProduct } from "@/services/investment-accounts";
import { isDematLikeAccount, isPensionLikeAccount } from "@/services/investment-accounts";

export type InvestmentGroup = "fd" | "market" | "pension";

export function groupOf(account: { account_type: string }, product: InvestmentProduct | null): InvestmentGroup {
  return isDematLikeAccount(account, product) ? "market" : isPensionLikeAccount(account, product) ? "pension" : "fd";
}

// ─── Periods ─────────────────────────────────────────────────────────────────

export type TrendPeriod = "5D" | "1M" | "6M" | "YTD" | "1Y" | "5Y" | "Max";
export type PeriodUnit = "day" | "week" | "month";

/**
 * The ranges Google's stock charts offer (less 1D: Arth keeps one value per day). Days are drawn
 * daily - 1M too, since four weekly points say little - 6M weekly, years monthly, and Max by
 * whatever suits how far back the history goes. `phrase` finishes "+₹X ..." under the total.
 */
export const TREND_PERIODS: { value: TrendPeriod; label: string; phrase: string }[] = [
  { value: "5D", label: "5D", phrase: "past 5 days" },
  { value: "1M", label: "1M", phrase: "past month" },
  { value: "6M", label: "6M", phrase: "past 6 months" },
  { value: "YTD", label: "YTD", phrase: "this year" },
  { value: "1Y", label: "1Y", phrase: "past year" },
  { value: "5Y", label: "5Y", phrase: "past 5 years" },
  { value: "Max", label: "Max", phrase: "all time" },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

function dailyBack(today: Date, days: number): string[] {
  return Array.from({ length: days + 1 }, (_, i) => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - i))));
}
function weeklyBack(today: Date, weeks: number): string[] {
  return Array.from({ length: weeks + 1 }, (_, i) =>
    iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (weeks - i) * 7)),
  );
}
/** `monthsBack` month ends before this month (oldest first), then today. */
function monthlyBack(today: Date, monthsBack: number): string[] {
  const y = today.getFullYear();
  const m = today.getMonth();
  const ends = Array.from({ length: monthsBack }, (_, i) => iso(new Date(y, m - (monthsBack - 1 - i), 0)));
  return [...ends, iso(today)];
}

/**
 * The dates a period is drawn at, oldest first, ending today. The first date is where the change
 * is measured from (5D has six points: five days ago to today). Max needs the history's first
 * date: up to two months back it's drawn daily, up to about a year weekly, beyond that monthly.
 */
export function periodPoints(period: TrendPeriod, today = new Date(), firstDate?: string | null): { dates: string[]; unit: PeriodUnit } {
  switch (period) {
    case "5D":
      return { dates: dailyBack(today, 5), unit: "day" };
    case "1M":
      return { dates: dailyBack(today, 30), unit: "day" };
    case "6M":
      return { dates: weeklyBack(today, 26), unit: "week" };
    case "YTD":
      return { dates: monthlyBack(today, today.getMonth() + 1), unit: "month" }; // from last 31 Dec
    case "1Y":
      return { dates: monthlyBack(today, 12), unit: "month" };
    case "5Y":
      return { dates: monthlyBack(today, 60), unit: "month" };
    case "Max": {
      const first = firstDate ? parse(firstDate) : new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
      const span = Math.max(1, Math.round((today.getTime() - first.getTime()) / 86400000));
      if (span <= 62) return { dates: dailyBack(today, span), unit: "day" };
      if (span <= 400) return { dates: weeklyBack(today, Math.ceil(span / 7)), unit: "week" };
      const months = (today.getFullYear() - first.getFullYear()) * 12 + (today.getMonth() - first.getMonth()) + 1;
      return { dates: monthlyBack(today, months), unit: "month" };
    }
  }
}

// ─── Values at dates ─────────────────────────────────────────────────────────

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

/**
 * Balance-chain value at each date. `flows` are signed amounts (money in +, out -); `anchors` are
 * seeded month openings. With an anchor on or before the date's month: its opening plus the flows
 * since that month began. Before the first anchor: that anchor's opening less the flows between
 * the date and it. No anchors: the running total from zero.
 */
export function balancesAt(
  flows: { date: string; amount: number }[],
  anchors: { month: string; opening: number }[],
  dates: string[],
): number[] {
  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  const sum = (after: string, upTo: string) =>
    sorted.reduce((s, f) => (f.date > after && f.date <= upTo ? s + f.amount : s), 0);
  const marks = [...anchors].sort((a, b) => a.month.localeCompare(b.month)).map((a) => ({ start: `${a.month}-01`, opening: a.opening }));
  return dates.map((date) => {
    if (marks.length === 0) return round2(sum("", date));
    const before = marks.filter((a) => a.start <= date).pop();
    if (before) return round2(before.opening + sum(dayBefore(before.start), date));
    const first = marks[0];
    return round2(first.opening - sum(date, dayBefore(first.start)));
  });
}

function dayBefore(date: string): string {
  const d = parse(date);
  return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
}
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PeriodTrend {
  period: TrendPeriod;
  /** YYYY-MM-DD, oldest first, ending today. Starts where the accounts first have a value. */
  points: string[];
  unit: PeriodUnit;
  byAccount: Record<string, number[]>;
  /** False when the history starts inside the period (the chart starts there, not at a flat zero). */
  coversPeriod: boolean;
}

interface AccountSeries {
  first: string | null;
  valuesAt: (dates: string[]) => number[];
}

async function seriesFor(
  account: { id: string; account_type: string },
  product: InvestmentProduct | null,
): Promise<AccountSeries> {
  const db = getDatabase();
  const group = groupOf(account, product);
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
    const first = [...portfolio, ...fund].map((r) => r.date).sort()[0] ?? null;
    return {
      first,
      valuesAt: (dates) => {
        const p = valuesAt(portfolio, dates);
        const f = valuesAt(fund, dates);
        return dates.map((_, i) => round2(p[i] + f[i]));
      },
    };
  }
  if (group === "pension") {
    // Same rows and signs as account-balance.ts: expenses out (split purchases at their full
    // amount), credits in, transfers out / in, ledger adjustments signed by their description.
    const [rows, transfers, anchors] = await Promise.all([
      db.getAllAsync<{ date: string; nature: string; gross: number; amount: number; description: string | null }>(
        `SELECT date, nature, COALESCE(split_original_amount, amount) AS gross, amount, description FROM expenses
          WHERE account_id = ? AND deleted_at IS NULL AND status = 'approved'
            AND nature IN ('realized', 'credit', 'ledger_adjustment')
            AND (nature = 'ledger_adjustment' OR reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0);`,
        account.id,
      ),
      db.getAllAsync<{ date: string; amount: number; from_account_id: string }>(
        `SELECT date, amount, from_account_id FROM account_transfers
          WHERE (from_account_id = ? OR to_account_id = ?) AND deleted_at IS NULL;`,
        account.id,
        account.id,
      ),
      db.getAllAsync<{ month: string; opening: number }>(
        `SELECT month, opening_balance AS opening FROM account_month_balances WHERE account_id = ?;`,
        account.id,
      ),
    ]);
    const flows = [
      ...rows.map((r) => ({
        date: r.date,
        amount:
          r.nature === "realized"
            ? -r.gross
            : r.nature === "credit"
              ? r.amount
              : (r.description ?? "").includes(" -]")
                ? -r.amount
                : r.amount,
      })),
      ...transfers.map((t) => ({ date: t.date, amount: t.from_account_id === account.id ? -t.amount : t.amount })),
    ];
    const first = [...flows.map((f) => f.date), ...anchors.map((a) => `${a.month}-01`)].sort()[0] ?? null;
    return { first, valuesAt: (dates) => balancesAt(flows, anchors, dates) };
  }
  const principal = product?.principal ?? 0;
  const start = product?.start_date ?? null;
  const maturity = product?.maturity_date ?? null;
  return {
    first: start,
    valuesAt: (dates) => dates.map((d) => (start != null && start <= d && (maturity == null || maturity > d) ? principal : 0)),
  };
}

/** Every account's value at the period's dates (see the file header). */
export async function getPeriodTrend(
  accounts: { id: string; account_type: string }[],
  products: Map<string, InvestmentProduct>,
  currentValues: Map<string, number>,
  period: TrendPeriod,
  today = new Date(),
): Promise<PeriodTrend> {
  const series = await Promise.all(accounts.map((a) => seriesFor(a, products.get(a.id) ?? null)));
  const firsts = series.map((s) => s.first).filter((d): d is string => !!d).sort();
  const { dates, unit } = periodPoints(period, today, firsts[0] ?? null);
  const last = dates.length - 1;
  const all: Record<string, number[]> = {};
  accounts.forEach((a, i) => {
    const values = series[i].valuesAt(dates);
    const now = currentValues.get(a.id);
    if (now != null) values[last] = now;
    all[a.id] = values;
  });
  const firstWithValue = dates.findIndex((_, i) => accounts.some((a) => all[a.id][i] > 0));
  // Keep at least two points so there is a line to draw.
  const start = Math.max(0, Math.min(firstWithValue < 0 ? last : firstWithValue, last - 1));
  const byAccount: Record<string, number[]> = {};
  for (const a of accounts) byAccount[a.id] = all[a.id].slice(start);
  return { period, points: dates.slice(start), unit, byAccount, coversPeriod: start === 0 };
}
