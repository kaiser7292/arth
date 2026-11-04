import { useCallback, useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { GroupHeading, ListToolbar, Money, PeriodNavigator, ScreenContainer, Text, useToast } from "@/components/ui";
import { FilterSummaryCard } from "@/components/expense/FilterSummaryCard";
import { FullScreenFilter } from "@/components/expense/FullScreenFilter";
import { StatementRowDetail, StatementRowItem } from "@/components/household/StatementList";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useGroupBy } from "@/hooks/use-group-by";
import { getCategories, type Category } from "@/services/category";
import { categoryLook } from "@/services/household/category-look";
import { NOT_SET, NOT_SET_LABELS } from "@/services/expense-types";
import { getStatement, type Statement, type StatementRow } from "@/services/household/statement";
import { syncHousehold } from "@/services/household/sync";
import { transactionDayLabel } from "@/utils/day-label";
import { NO_GROUP } from "@/utils/group-rows";
import {
  filterStatementRows,
  groupStatementRows,
  statementTotal,
  summarizeStatement,
  withDayHeadings,
  type StatementGroupBy,
  type StatementKind,
  type StatementListBy,
  type StatementListRow,
} from "@/utils/statement-view";

const KINDS: { id: StatementKind; label: string }[] = [
  { id: "you_owe", label: "You owe" },
  { id: "owes_you", label: "Owed to you" },
  { id: "settle", label: "Settle-ups" },
  { id: "personal", label: "Personal" },
];
const GROUP_BYS: readonly StatementGroupBy[] = ["category", "member", "merchant"];
const GROUP_LABELS: Record<StatementGroupBy, string> = { category: "Category", member: "Paid by", merchant: "Merchant" };
const LIST_GROUPS: readonly StatementListBy[] = ["date", "category", "member", "merchant", "kind"];
const LIST_GROUP_OPTIONS: { value: StatementListBy; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "category", label: "Category" },
  { value: "member", label: "Paid by" },
  { value: "merchant", label: "Merchant" },
  { value: "kind", label: "You owe or owed" },
];

type StatementSort = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
const SORTS: readonly StatementSort[] = ["date_desc", "date_asc", "amount_desc", "amount_asc"];
const SORT_OPTIONS: { value: StatementSort; label: string }[] = [
  { value: "date_desc", label: "Date (newest first)" },
  { value: "date_asc", label: "Date (oldest first)" },
  { value: "amount_desc", label: "Amount (highest first)" },
  { value: "amount_asc", label: "Amount (lowest first)" },
];

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthBefore = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/**
 * Together's transactions: the household's shared spending for a month, in the same layout as
 * Transactions (day headings with totals, the summary card, the full-screen multi-select filter).
 * Opened from a total on Together.
 */
export default function TogetherTransactionsScreen() {
  const toast = useToast();
  const params = useLocalSearchParams<{ month?: string; member?: string; category?: string }>();
  const [month, setMonth] = useState(params.month ?? thisMonth());
  const [members, setMembers] = useState<string[]>(params.member ? [params.member] : []);
  const [categories, setCategories] = useState<string[]>(params.category ? [params.category] : []);
  const [merchants, setMerchants] = useState<string[]>([]);
  const [kinds, setKinds] = useState<StatementKind[]>([]);
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<StatementGroupBy>("category");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [s, setS] = useState<Statement | null>(null);
  const [previous, setPrevious] = useState<Statement | null>(null);
  const [viewing, setViewing] = useState<StatementRow | null>(null);
  const [myCategories, setMyCategories] = useState<Category[]>([]);

  useDataRefresh(
    useCallback(async () => {
      setS(await getStatement(month));
      // Only the trend line and icons depend on these, so neither can stop the list loading.
      getStatement(monthBefore(month)).then(setPrevious).catch(() => setPrevious(null));
      getCategories(DEFAULT_USER_ID).then(setMyCategories).catch(() => {});
    }, [month]),
  );

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await syncHousehold();
      if (r.error) toast(r.error === "offline" ? "You're offline. It'll sync when you're back." : `Couldn't sync: ${r.error}`);
    } finally {
      setSyncing(false);
    }
  };

  const [listBy, setListBy] = useGroupBy<StatementListBy>("together_transactions", LIST_GROUPS, "date");
  const filters = useMemo(() => ({ members, categories, merchants, kinds, query }), [members, categories, merchants, kinds, query]);
  const [sortBy, setSortBy] = useGroupBy<StatementSort>("sort_together_transactions", SORTS, "date_desc");
  const rows = useMemo(() => {
    const byDate = (a: StatementRow, b: StatementRow) => b.date.localeCompare(a.date);
    const compare: Record<StatementSort, (a: StatementRow, b: StatementRow) => number> = {
      date_desc: byDate,
      date_asc: (a, b) => a.date.localeCompare(b.date),
      // By amount, days still hold together under their headings; a list by category sorts purely by amount.
      amount_desc: (a, b) => (listBy === "date" ? byDate(a, b) : 0) || b.paid - a.paid,
      amount_asc: (a, b) => (listBy === "date" ? byDate(a, b) : 0) || a.paid - b.paid,
    };
    return [...filterStatementRows(s?.rows ?? [], filters)].sort(compare[sortBy]);
  }, [s, filters, sortBy, listBy]);
  const summary = useMemo(() => summarizeStatement(rows, groupBy), [rows, groupBy]);
  const previousTotal = useMemo(() => (previous ? statementTotal(filterStatementRows(previous.rows, filters)) : null), [previous, filters]);

  const me = s?.household.my_member_id ?? null;
  const nameOf = useCallback((id: string) => (id === me ? "You" : (s?.members.find((m) => m.id === id)?.name ?? "Someone")), [me, s]);

  const list = useMemo(() => {
    if (listBy === "date") return withDayHeadings(rows);
    return groupStatementRows(rows, listBy, (key) => {
      if (listBy === "member") return nameOf(key);
      if (listBy === "kind") return KINDS.find((k) => k.id === key)?.label ?? key;
      if (key === NO_GROUP) return listBy === "merchant" ? "No merchant" : "Uncategorized";
      return key;
    });
  }, [rows, listBy, nameOf]);

  // Names biggest first, as in the summary, and anything already chosen stays listed in any month.
  const optionsFor = (pick: (r: Statement["rows"][number]) => string | null, chosen: string[]) => {
    const totals = new Map<string, number>();
    for (const r of s?.rows ?? []) {
      const name = r.relation.kind === "settle" ? null : pick(r);
      if (name) totals.set(name, (totals.get(name) ?? 0) + r.paid);
    }
    for (const name of chosen) if (name !== NOT_SET && !totals.has(name)) totals.set(name, 0);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => ({ id: name, label: name }));
  };

  const clearFilters = () => {
    setMembers([]);
    setCategories([]);
    setMerchants([]);
    setKinds([]);
  };

  const active: { key: string; label: string; remove: () => void }[] = [
    ...members.map((id) => ({ key: `m-${id}`, label: nameOf(id), remove: () => setMembers((p) => p.filter((x) => x !== id)) })),
    ...kinds.map((id) => ({ key: `k-${id}`, label: KINDS.find((k) => k.id === id)?.label ?? id, remove: () => setKinds((p) => p.filter((x) => x !== id)) })),
    ...categories.map((id) => ({
      key: `c-${id}`,
      label: id === NOT_SET ? NOT_SET_LABELS.category : id,
      remove: () => setCategories((p) => p.filter((x) => x !== id)),
    })),
    ...merchants.map((id) => ({
      key: `b-${id}`,
      label: id === NOT_SET ? NOT_SET_LABELS.merchant : id,
      remove: () => setMerchants((p) => p.filter((x) => x !== id)),
    })),
  ];

  const renderItem = useCallback(
    ({ item }: { item: StatementListRow }) => {
      if (item.type === "day") {
        return (
          <View className="px-4 pt-4 pb-1.5 flex-row items-baseline justify-between">
            <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground" style={{ letterSpacing: 0.6 }}>
              {transactionDayLabel(item.date)}
            </Text>
            {item.total !== 0 && <Money value={-item.total} signed showPlus className="text-label font-semibold" />}
          </View>
        );
      }
      if (item.type === "group") {
        return <GroupHeading label={item.label} count={item.count} total={-item.total} />;
      }
      const category = categoryLook(item.row.look, item.row.category, myCategories);
      return <StatementRowItem row={item.row} myMemberId={me} category={category} onView={setViewing} />;
    },
    [myCategories, me],
  );

  return (
    <ScreenContainer padTop={false}>
      <PeriodNavigator mode="month" value={month} onChange={setMonth} />
      <ListToolbar
        search={{ value: query, onChangeText: setQuery, placeholder: "Search name or >5000" }}
        filter={{ onPress: () => setFiltersOpen(true), activeCount: active.length }}
        sort={{ value: sortBy, defaultValue: "date_desc", options: SORT_OPTIONS, onChange: setSortBy }}
        group={{ value: listBy, defaultValue: "date", options: LIST_GROUP_OPTIONS, onChange: setListBy }}
        chips={active.map((a) => ({ key: a.key, label: a.label, onRemove: a.remove }))}
        onClearAll={clearFilters}
      />

      <FlatList
        data={list}
        keyExtractor={(item) => (item.type === "day" ? `day-${item.date}` : item.type === "group" ? `group-${item.key}` : item.row.id)}
        renderItem={renderItem}
        initialNumToRender={15}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 80 }}
        refreshing={syncing}
        onRefresh={syncNow}
        ListHeaderComponent={
          rows.length > 0 ? (
            <FilterSummaryCard
              summary={summary}
              natureKind="all"
              previousTotal={previousTotal}
              groupLabelHeader={GROUP_LABELS[groupBy]}
              allowGroupByChange
              availableGroupBys={GROUP_BYS}
              groupByLabels={GROUP_LABELS}
              onChangeGroupBy={setGroupBy}
              resolveGroupLabel={(key) =>
                groupBy === "member" ? nameOf(key ?? "") : key ?? (groupBy === "merchant" ? "No merchant" : "Uncategorized")
              }
            />
          ) : null
        }
        ListEmptyComponent={
          s ? (
            <View className="items-center py-12 px-6">
              <Text className="text-sm text-muted-foreground text-center">
                {active.length > 0 || query.trim() ? "Nothing matches in this month." : "Nothing shared this month."}
              </Text>
            </View>
          ) : null
        }
      />

      <StatementRowDetail row={viewing} myMemberId={me} onClose={() => setViewing(null)} />

      <FullScreenFilter
        visible={filtersOpen}
        sections={[
          { key: "member", label: "Paid by", type: "multi", options: (s?.members ?? []).map((m) => ({ id: m.id, label: nameOf(m.id) })), selectedIds: members },
          { key: "kind", label: "Show", type: "multi", options: KINDS, selectedIds: kinds },
          {
            key: "category",
            label: "Category",
            type: "multi",
            searchable: true,
            options: [{ id: NOT_SET, label: NOT_SET_LABELS.category }, ...optionsFor((r) => r.category, categories)],
            selectedIds: categories,
          },
          {
            key: "merchant",
            label: "Merchant",
            type: "multi",
            searchable: true,
            options: [{ id: NOT_SET, label: NOT_SET_LABELS.merchant }, ...optionsFor((r) => r.merchant, merchants)],
            selectedIds: merchants,
          },
        ]}
        onApply={(selected) => {
          setMembers(selected.member ?? []);
          setKinds((selected.kind ?? []) as StatementKind[]);
          setCategories(selected.category ?? []);
          setMerchants(selected.merchant ?? []);
        }}
        onReset={clearFilters}
        onClose={() => setFiltersOpen(false)}
      />
    </ScreenContainer>
  );
}
