import { useCallback, useMemo, useState, type ComponentProps } from "react";
import { useGroupDrawers } from "@/hooks/use-group-drawers";
import { FullScreenFilter, applySortGroup, sortGroupSections } from "@/components/expense/FullScreenFilter";
import type { ListToolbarProps, ToolbarChip, ToolbarChoice } from "@/components/ui";
import { useGroupBy } from "@/hooks/use-group-by";
import {
  fieldLabel,
  filterOptions,
  filterRows,
  groupListRows,
  sortRows,
  type ListField,
  type ListSearch,
  type ListSort,
} from "@/utils/list-tools";

const NONE = "none";
type Sections = ComponentProps<typeof FullScreenFilter>["sections"];

/** Filters a screen handles itself, such as a date range that decides what gets loaded. */
export interface ExtraFilter {
  sections: Sections;
  chips: ToolbarChip[];
  onApply: (selections: Record<string, string[]>) => void;
  onReset: () => void;
  /** How many are on, for the funnel. */
  activeCount: number;
}

/**
 * The toolbar for a list held in memory: pass the rows and what they have, get back the rows to show
 * and everything the toolbar needs. Sort and group are remembered per screen.
 */
export function useListTools<T>({
  screen,
  rows,
  fields,
  search,
  searchPlaceholder,
  sorts,
  defaultSort,
  sort: outsideSort,
  defaultGroup = NONE,
  noGrouping = true,
  amountOf,
  extraFilter,
  noun,
}: {
  screen: string;
  rows: readonly T[];
  fields: readonly ListField<T>[];
  search?: ListSearch<T>;
  searchPlaceholder?: string;
  sorts?: readonly ListSort<T>[];
  defaultSort?: string;
  /** For rows that come sorted from the database: the screen keeps the choice. */
  sort?: ToolbarChoice<string>;
  defaultGroup?: string;
  /** Offer "None" as a way to group. */
  noGrouping?: boolean;
  amountOf?: (row: T) => number;
  extraFilter?: ExtraFilter;
  /** What the rows are called, for the filter sheet's "Show 24 merchants". */
  noun?: { one: string; many: string };
}) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [filterOpen, setFilterOpen] = useState(false);

  const groupFields = useMemo(() => fields.filter((f) => f.group), [fields]);
  const filterFields = useMemo(() => fields.filter((f) => f.filter), [fields]);
  const groupIds = useMemo(() => [...(noGrouping ? [NONE] : []), ...groupFields.map((f) => f.id)], [noGrouping, groupFields]);
  const sortIds = useMemo(() => (sorts ?? []).map((s) => s.id), [sorts]);
  const firstSort = defaultSort ?? sortIds[0] ?? "";

  const [groupBy, setGroupBy] = useGroupBy<string>(screen, groupIds, defaultGroup);
  const [sortBy, setSortBy] = useGroupBy<string>(`sort_${screen}`, sortIds, firstSort);

  const shown = useMemo(() => {
    const filtered = filterRows(rows, fields, filters, query, search);
    return sortRows(filtered, sorts?.find((s) => s.id === sortBy));
  }, [rows, fields, filters, query, search, sorts, sortBy]);

  const flatGroups = useMemo(
    () => groupListRows(shown, groupFields.find((f) => f.id === groupBy), amountOf ?? (() => 0)),
    [shown, groupFields, groupBy, amountOf],
  );

  // Every group is a drawer, as on the Transactions tab (hooks/use-group-drawers.ts).
  const drawerRows = useGroupDrawers(flatGroups, {
    isHeading: (r) => r.type === "heading",
    keyOf: (r) => (r.type === "heading" ? r.key : ""),
    resetKey: groupBy,
  });
  const grouped = useMemo(
    () => (noun ? drawerRows.map((r) => (r.type === "heading" ? { ...r, noun } : r)) : drawerRows),
    [drawerRows, noun],
  );

  const clearFilters = useCallback(() => {
    setFilters({});
    extraFilter?.onReset();
  }, [extraFilter]);

  const reset = useCallback(() => {
    setQuery("");
    setFilters({});
  }, []);

  const setFieldFilter = useCallback(
    (fieldId: string, keys: string[]) => setFilters((prev) => ({ ...prev, [fieldId]: keys })),
    [],
  );

  const chips: ToolbarChip[] = [
    ...(extraFilter?.chips ?? []),
    ...filterFields.flatMap((f) =>
      (filters[f.id] ?? []).map((key) => ({
        key: `${f.id}:${key}`,
        label: fieldLabel(f, key),
        onRemove: () => setFilters((prev) => ({ ...prev, [f.id]: (prev[f.id] ?? []).filter((k) => k !== key) })),
      })),
    ),
  ];
  const activeCount = (extraFilter?.activeCount ?? 0) + filterFields.reduce((n, f) => n + (filters[f.id] ?? []).length, 0);

  const sortChoice: ToolbarChoice<string> | undefined =
    outsideSort ??
    (sorts && sorts.length > 1
      ? { value: sortBy, defaultValue: firstSort, options: sorts.map((s) => ({ value: s.id, label: s.label })), onChange: setSortBy }
      : undefined);

  const groupChoice: ToolbarChoice<string> | undefined =
    groupIds.length > 1
      ? {
          value: groupBy,
          defaultValue: defaultGroup,
          options: groupIds.map((id) => ({ value: id, label: id === NONE ? "None" : (groupFields.find((f) => f.id === id)?.label ?? id) })),
          onChange: setGroupBy,
        }
      : undefined;
  // Sort, filter and group are set in one sheet, the same on every list (and as on Transactions).
  const hasSheet = filterFields.length > 0 || !!extraFilter || !!sortChoice || !!groupChoice;

  const toolbar: ListToolbarProps<string, string> = {
    search: search ? { value: query, onChangeText: setQuery, placeholder: searchPlaceholder } : undefined,
    filter: hasSheet ? { onPress: () => setFilterOpen(true), activeCount } : undefined,
    sort: sortChoice ? { ...sortChoice, inSheet: true } : undefined,
    group: groupChoice ? { ...groupChoice, inSheet: true } : undefined,
    chips,
    onClearAll: clearFilters,
  };

  const filterSheet = filterOpen ? (
    <FullScreenFilter
      visible
      sections={[
        ...sortGroupSections(sortChoice, groupChoice),
        ...(extraFilter?.sections ?? []),
        ...filterFields.map((f) => ({
          key: f.id,
          label: f.label,
          type: "multi" as const,
          searchable: f.searchable,
          options: filterOptions(rows, f, filters[f.id] ?? []),
          selectedIds: filters[f.id] ?? [],
        })),
      ]}
      onApply={(selections) => {
        applySortGroup(selections, sortChoice, groupChoice);
        setFilters(Object.fromEntries(filterFields.map((f) => [f.id, selections[f.id] ?? []])));
        extraFilter?.onApply(selections);
      }}
      onReset={() => {
        clearFilters();
        if (sortChoice) sortChoice.onChange(sortChoice.defaultValue);
        if (groupChoice) groupChoice.onChange(groupChoice.defaultValue);
      }}
      onClose={() => setFilterOpen(false)}
      noun={noun}
      countFor={(selections) => {
        // A screen's own filters (a date range that decides what is loaded) can't be counted here.
        const extraChanged = (extraFilter?.sections ?? []).some(
          (s) => (selections[s.key] ?? []).join("|") !== s.selectedIds.join("|"),
        );
        if (extraChanged) return null;
        const own = Object.fromEntries(filterFields.map((f) => [f.id, selections[f.id] ?? []]));
        return filterRows(rows, fields, own, query, search).length;
      }}
    />
  ) : null;

  return {
    /** Rows that pass, in order. */
    rows: shown,
    /** The same rows with their group headings. */
    grouped,
    toolbar,
    filterSheet,
    groupBy,
    /** The grouping and sorting choices, for a "Grouped by … sorted …" line under the search. */
    groupChoice,
    sortChoice,
    query,
    setQuery,
    /** Search or a filter is narrowing the list. */
    narrowed: query.trim() !== "" || activeCount > 0,
    reset,
    /** Turn on one field's filter from outside, e.g. the card a shared-limit ledger was opened from. */
    setFieldFilter,
  };
}
