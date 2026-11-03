import { matchesSearch } from "@/utils/amount-search";
import { groupRows, NO_GROUP, ungrouped, type GroupedRow } from "@/utils/group-rows";

/**
 * Search, filter, sort and group for a list held in memory. A screen says what its rows have, once,
 * and the toolbar and the rows both come from that. Pure, so it can be tested without a screen.
 */

export interface ListField<T> {
  id: string;
  label: string;
  /** The row's value for this field. Nothing means it goes under noneLabel. */
  keyOf: (row: T) => string | null | undefined;
  /** For a filter a row can match more than one way ("No category" and "Several names"). */
  keysOf?: (row: T) => string[];
  labelOf?: (key: string) => string;
  noneLabel?: string;
  filter?: boolean;
  /** Long lists of choices get a search box in the filter. */
  searchable?: boolean;
  group?: boolean;
  /** "first" keeps groups in the order rows come, for dates; otherwise biggest first. */
  groupOrder?: "size" | "first";
}

export interface ListSort<T> {
  id: string;
  label: string;
  /** Leave out for the order rows already come in. */
  compare?: (a: T, b: T) => number;
}

export type ListSearch<T> = (row: T) => { texts: (string | null | undefined)[]; amounts?: number[] };

export const fieldLabel = <T,>(field: ListField<T>, key: string): string =>
  key === NO_GROUP ? (field.noneLabel ?? "None") : (field.labelOf ? field.labelOf(key) : key);

const fieldKeys = <T,>(field: ListField<T>, row: T): string[] =>
  field.keysOf ? field.keysOf(row) : [field.keyOf(row) || NO_GROUP];

/** Rows that pass the search and every filter: any of a filter's choices, all of the filters. */
export function filterRows<T>(
  rows: readonly T[],
  fields: readonly ListField<T>[],
  filters: Record<string, string[]>,
  query: string,
  search?: ListSearch<T>,
): T[] {
  const on = fields.filter((f) => (filters[f.id] ?? []).length > 0);
  return rows.filter((row) => {
    if (!on.every((f) => fieldKeys(f, row).some((k) => filters[f.id].includes(k)))) return false;
    if (!search || !query.trim()) return true;
    const { texts, amounts } = search(row);
    return matchesSearch(query, texts, amounts ?? []);
  });
}

export function sortRows<T>(rows: readonly T[], sort: ListSort<T> | undefined): T[] {
  return sort?.compare ? [...rows].sort(sort.compare) : [...rows];
}

export function groupListRows<T>(
  rows: readonly T[],
  field: ListField<T> | undefined,
  amountOf: (row: T) => number,
): GroupedRow<T>[] {
  if (!field) return ungrouped(rows);
  return groupRows(rows, {
    keyOf: field.keyOf,
    labelOf: (key) => fieldLabel(field, key),
    amountOf,
    order: field.groupOrder ?? "size",
  });
}

/** A filter's choices with how many rows each has, biggest first. Anything already chosen stays listed. */
export function filterOptions<T>(
  rows: readonly T[],
  field: ListField<T>,
  chosen: readonly string[],
): { id: string; label: string }[] {
  const counts = new Map<string, number>();
  for (const row of rows) for (const k of fieldKeys(field, row)) counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const k of chosen) if (!counts.has(k)) counts.set(k, 0);
  return [...counts.entries()]
    .sort(([ka, a], [kb, b]) => {
      if ((ka === NO_GROUP) !== (kb === NO_GROUP)) return ka === NO_GROUP ? -1 : 1;
      return b - a;
    })
    .map(([id, n]) => ({ id, label: `${fieldLabel(field, id)} (${n})` }));
}
