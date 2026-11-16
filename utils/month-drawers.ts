/**
 * The Transactions list as month drawers: one card per month with its totals on the header, the
 * month's rows inside when it's open. Pure, so the screen only renders what this returns.
 */

export interface MonthSummary {
  /** "YYYY-MM" */
  month: string;
  /** What went out, as a positive number. */
  spent: number;
  /** What came in. */
  received: number;
  count: number;
}

export type DrawerRow<T> =
  | { kind: "month"; month: string; summary: MonthSummary; open: boolean }
  | { kind: "day"; month: string; date: string; total: number }
  | { kind: "item"; month: string; item: T; last: boolean }
  | { kind: "loading"; month: string }
  | { kind: "empty"; month: string }
  | { kind: "end"; month: string };

/** Months newest first (or oldest first for an oldest-first sort), skipping empty ones. */
export function orderMonths(totals: ReadonlyMap<string, MonthSummary>, oldestFirst = false): MonthSummary[] {
  const list = [...totals.values()].filter((m) => m.count > 0);
  list.sort((a, b) => (oldestFirst ? a.month.localeCompare(b.month) : b.month.localeCompare(a.month)));
  return list;
}

/** The days of one month, kept inside the list's own range. */
export function monthBounds(month: string, rangeStart?: string, rangeEnd?: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const start = `${month}-01`;
  const end = `${month}-${String(last).padStart(2, "0")}`;
  return {
    start: rangeStart && rangeStart > start ? rangeStart : start,
    end: rangeEnd && rangeEnd < end ? rangeEnd : end,
  };
}

/** Month totals worked out from rows already in memory (transfers, which aren't paged). */
export function summarizeByMonth<T>(
  items: readonly T[],
  dateOf: (t: T) => string,
  amountOf: (t: T) => number,
): Map<string, MonthSummary> {
  const out = new Map<string, MonthSummary>();
  for (const t of items) {
    const month = dateOf(t).slice(0, 7);
    if (month.length !== 7) continue;
    const s = out.get(month) ?? { month, spent: 0, received: 0, count: 0 };
    const a = amountOf(t);
    if (a >= 0) s.received += a;
    else s.spent += -a;
    s.count += 1;
    out.set(month, s);
  }
  return out;
}

/**
 * Every row of the list in order: a header per month, and for an open month its rows (with a
 * heading per day when `dayHeadings`), or a loading row until they arrive.
 */
export function buildDrawerRows<T>({
  months,
  open,
  rowsOf,
  dateOf,
  amountOf,
  dayHeadings,
}: {
  months: readonly MonthSummary[];
  open: ReadonlySet<string>;
  /** The month's rows, or undefined while they haven't loaded. */
  rowsOf: (month: string) => readonly T[] | undefined;
  dateOf: (t: T) => string;
  /** Signed: money in positive, out negative. For the day totals. */
  amountOf: (t: T) => number;
  dayHeadings: boolean;
}): DrawerRow<T>[] {
  const rows: DrawerRow<T>[] = [];
  for (const summary of months) {
    const { month } = summary;
    const isOpen = open.has(month);
    rows.push({ kind: "month", month, summary, open: isOpen });
    if (!isOpen) continue;
    const items = rowsOf(month);
    if (items === undefined) {
      rows.push({ kind: "loading", month });
    } else if (items.length === 0) {
      rows.push({ kind: "empty", month });
    } else {
      let lastDate = "";
      let day: Extract<DrawerRow<T>, { kind: "day" }> | null = null;
      items.forEach((item, i) => {
        if (dayHeadings) {
          const date = dateOf(item).slice(0, 10);
          if (date !== lastDate) {
            day = { kind: "day", month, date, total: 0 };
            rows.push(day);
            lastDate = date;
          }
          if (day) day.total += amountOf(item);
        }
        rows.push({ kind: "item", month, item, last: i === items.length - 1 });
      });
    }
    rows.push({ kind: "end", month });
  }
  return rows;
}
