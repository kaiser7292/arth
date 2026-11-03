/**
 * Group by, for any list: rows go under headings with a total. Pure, so each screen only says what
 * a row's group is, what it's called and what it adds up to. Rows keep the order they came in.
 */

export type GroupedRow<T> =
  | { type: "heading"; key: string; label: string; total: number; count: number }
  | { type: "item"; item: T };

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
  const groups = new Map<string, { rows: T[]; total: number }>();
  for (const row of rows) {
    const key = by.keyOf(row) || NO_GROUP;
    const group = groups.get(key) ?? { rows: [], total: 0 };
    group.rows.push(row);
    group.total += by.amountOf(row);
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
    out.push({ type: "heading", key, label: by.labelOf(key), total: Math.round(group.total * 100) / 100, count: group.rows.length });
    for (const item of group.rows) out.push({ type: "item", item });
  }
  return out;
}

/** The same rows with no headings, for a list that's been told not to group. */
export function ungrouped<T>(rows: readonly T[]): GroupedRow<T>[] {
  return rows.map((item) => ({ type: "item", item }));
}
