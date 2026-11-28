/**
 * The Budget tab's span (Month · 3M · 6M · FY) as dates and words, so every Budget page follows
 * it (owner, Nov 2026): Overview, Spending Split and Monthly Summary all show the same stretch.
 * Pure apart from today's date.
 */
import { insightPeriodRange } from "@/utils/insight-periods";

export type BudgetSpanKey = "month" | "last_3m" | "last_6m" | "this_fy";

export interface BudgetSpan {
  startMonth: string;
  endMonth: string;
  startDate: string;
  /** Today: the span runs up to now. */
  endDate: string;
  /** Every month in it, oldest first. */
  months: string[];
  /** In a sentence: "these 3 months", "this financial year". */
  phrase: string;
  /** The same length just before it, for comparing. */
  previous: { startDate: string; endDate: string; phrase: string; title: string };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function monthsFrom(startMonth: string, endMonth: string): string[] {
  const out: string[] = [];
  let [y, m] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${pad(m)}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 36) break;
  }
  return out;
}

/** A date moved back by whole months, clamped to the month's last day. */
function monthsBack(dateIso: string, n: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const t = new Date(y, m - 1 - n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(Math.min(d, last))}`;
}

/** The span for a key, or undefined for a single month (pages then use their month). */
export function budgetSpanOf(key: BudgetSpanKey, fyStartMonth: number): BudgetSpan | undefined {
  if (key === "month") return undefined;
  const r = insightPeriodRange(key, fyStartMonth);
  const months = monthsFrom(r.startMonth, r.endMonth);
  const n = months.length;
  const phrase = key === "this_fy" ? "this financial year" : `these ${n} months`;
  return {
    ...r,
    months,
    phrase,
    previous: {
      startDate: monthsBack(r.startDate, key === "this_fy" ? 12 : n),
      endDate: monthsBack(r.endDate, key === "this_fy" ? 12 : n),
      phrase: key === "this_fy" ? "the same stretch last year" : `the ${n} months before`,
      title: key === "this_fy" ? "vs Last Year" : `vs Previous ${n} Months`,
    },
  };
}

/** Days from a to b inclusive. */
export function daysInclusive(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 864e5) + 1;
}
