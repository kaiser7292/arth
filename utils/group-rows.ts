/**
 * Group by, for any list: rows go under headings with a total. Pure, so each screen only says what
 * a row's group is, what it's called and what it adds up to. Rows keep the order they came in.
 */

export type GroupedRow<T> =
  | {
      type: "heading";
      key: string;
      label: string;
      total: number;
      /** What the group's rows add up to on each side: money in, and money out (as a positive). */
      inflow: number;
      outflow: number;
      count: number;
      /** Set by useListTools: the group is a drawer, open or closed. */
      open?: boolean;
      onToggle?: () => void;
      /** What the rows are called, for "12 transactions". */
      noun?: { one: string; many: string };
    }
  | {
      type: "item";
      item: T;
      /** Set by useListTools: the row sits inside its group's drawer; the last one closes the card. */
      inDrawer?: boolean;
      last?: boolean;
    };

/** Biggest first, the groups without a value last; or in the order they first appear, for dates. */
export type GroupOrder = "size" | "first";

/** Key for rows with nothing to group on ("No merchant"). */
export const NO_GROUP = "__none__";

export function groupRows<T>(
  rows: readonly T[],
  by: {
    keyOf: (row: T) => string | null | undefined;
    labelOf: (key: string) => string;
    amountOf: (row: T) => number;
    order?: GroupOrder;
  },
): GroupedRow<T>[] {
  const groups = new Map<string, { rows: T[]; total: number; inflow: number; outflow: number }>();
  for (const row of rows) {
    const key = by.keyOf(row) || NO_GROUP;
    const group = groups.get(key) ?? { rows: [], total: 0, inflow: 0, outflow: 0 };
    group.rows.push(row);
    const amount = by.amountOf(row);
    group.total += amount;
    if (amount > 0) group.inflow += amount;
    else group.outflow -= amount;
    groups.set(key, group);
  }

  let entries = [...groups.entries()];
  if (by.order !== "first") {
    entries = entries.sort(([ka, a], [kb, b]) => {
      if ((ka === NO_GROUP) !== (kb === NO_GROUP)) return ka === NO_GROUP ? 1 : -1;
      return Math.abs(b.total) - Math.abs(a.total);
    });
  }

  const out: GroupedRow<T>[] = [];
  for (const [key, group] of entries) {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    out.push({ type: "heading", key, label: by.labelOf(key), total: r2(group.total), inflow: r2(group.inflow), outflow: r2(group.outflow), count: group.rows.length });
    for (const item of group.rows) out.push({ type: "item", item });
  }
  return out;
}

/** The same rows with no headings, for a list that's been told not to group. */
export function ungrouped<T>(rows: readonly T[]): GroupedRow<T>[] {
  return rows.map((item) => ({ type: "item", item }));
}
