import { useCallback, useRef, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, GroupHeading, ListToolbar, LoadFailed, LoadingState, ScreenContainer, Text, UndoBar } from "@/components/ui";
import { CategoryPickerSheet } from "@/components/expense/catch-up/CategoryPickerSheet";
import { useAlert } from "@/hooks/use-alert";
import { getCategories, type Category } from "@/services/category";
import { applyRulesToPastTransactions, countPastTransactionsForRule, setMerchantRules } from "@/services/merchant-categories";
import { withMerchantUndo } from "@/services/merchant-undo";
import { useListTools } from "@/hooks/use-list-tools";
import type { ListField, ListSort } from "@/utils/list-tools";
import { DEFAULT_USER_ID } from "@/constants/app";
import { compareUnicode } from "@/utils/unicode-sort";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { getErrorMessage } from "@/utils/error-message";
import { useTheme } from "@/hooks/use-theme";
import { dismissMerchantUndo, undoMerchantChange, usePendingMerchantUndo } from "@/services/merchant-undo";
import { listMerchants, type MerchantSummary } from "@/services/merchants-overview";

const SHOW_LABELS: Record<string, string> = { uncategorised: "No category", several: "Several names" };
const MERCHANT_FIELDS: ListField<MerchantSummary>[] = [
  {
    id: "show",
    label: "Show",
    keyOf: () => null,
    // A merchant can be both.
    keysOf: (m) => [...(!m.category ? ["uncategorised"] : []), ...(m.names.length > 1 ? ["several"] : [])],
    labelOf: (k) => SHOW_LABELS[k] ?? k,
    filter: true,
  },
  { id: "category", label: "Category", keyOf: (m) => m.category, noneLabel: "No category", filter: true, group: true, searchable: true },
];
const MERCHANT_SORTS: ListSort<MerchantSummary>[] = [
  { id: "name", label: "Name (A–Z)", compare: (a, b) => compareUnicode(a.name, b.name) },
  { id: "most", label: "Most transactions", compare: (a, b) => b.txCount - a.txCount || compareUnicode(a.name, b.name) },
];
const MERCHANT_SEARCH = (m: MerchantSummary) => ({ texts: [m.name, ...m.names.map((n) => n.smsName)] });

/**
 * Every merchant you've used, with the names it has in transaction messages and the category its new
 * transactions go to - Merchant Categories and Merchant Aliases in one list. Tap one to rename
 * it, merge or unmerge names, and set its category.
 */
export default function MerchantsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [merchants, setMerchants] = useState<MerchantSummary[] | null>(null);
  const alert = useAlert();
  const [categories, setCategories] = useState<Category[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  // A change made on a merchant's page can still be undone from here.
  const pendingUndo = usePendingMerchantUndo();

  // The merchant whose page was opened from here.
  const opened = useRef<string | null>(null);
  const clearSearch = useRef<() => void>(() => {});

  const [loadFailed, setLoadFailed] = useState(false);
  const loadMerchants = useCallback(async () => {
      try {
        const list = await listMerchants(DEFAULT_USER_ID);
        setLoadFailed(false);
        setMerchants(list);
        getCategories(DEFAULT_USER_ID).then(setCategories).catch(() => {});
        // Back from a merchant that was renamed or merged away: the search that found it is stale.
        if (opened.current && !list.some((m) => m.name === opened.current)) clearSearch.current();
        opened.current = null;
      } catch {
        setMerchants([]);
        setLoadFailed(true);
      }
  }, []);
  useDataRefresh(loadMerchants);

  const tools = useListTools<MerchantSummary>({
    screen: "merchants",
    rows: merchants ?? [],
    fields: MERCHANT_FIELDS,
    sorts: MERCHANT_SORTS,
    searchPlaceholder: "Search merchants or message names",
    search: MERCHANT_SEARCH,
  });
  clearSearch.current = () => tools.setQuery("");

  // A filter changed after picking: only what's still showing counts, so nothing hidden is changed.
  const chosen = tools.rows.filter((m) => selected.has(m.name));
  const allChosen = tools.rows.length > 0 && chosen.length === tools.rows.length;

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const applyCategory = async (categoryName: string) => {
    const names = chosen.map((m) => m.name);
    try {
      const keywords = await withMerchantUndo(
        () => setMerchantRules(names, categoryName),
        (set) => `${set.length} merchant${set.length === 1 ? "" : "s"} now go to ${categoryName}`,
      );
      stopSelecting();
      let earlier = 0;
      for (const keyword of keywords) earlier += await countPastTransactionsForRule(keyword, categoryName);
      if (earlier === 0) return;
      alert(`Move ${earlier} earlier transaction${earlier === 1 ? "" : "s"}?`, `They'd go to ${categoryName} too.`, [
        { text: "Leave them", style: "cancel" },
        {
          text: "Move",
          onPress: () =>
            void withMerchantUndo(
              () => applyRulesToPastTransactions(keywords.map((keyword) => ({ keyword, category: categoryName }))),
              (n) => `Moved ${n} transaction${n === 1 ? "" : "s"} to ${categoryName}`,
            ).catch((e) => alert("Couldn't move them", getErrorMessage(e, "Please try again."))),
        },
      ]);
    } catch (e) {
      alert("Couldn't set the category", getErrorMessage(e, "Please try again."));
    }
  };

  if (!merchants) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState icon="storefront-outline" message="Loading merchants…" />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <ListToolbar {...tools.toolbar} />
      {tools.filterSheet}
      <FlatList
        data={tools.grouped}
        keyExtractor={(row) => (row.type === "heading" ? `heading-${row.key}` : row.item.name.toLowerCase())}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: selecting ? 160 : pendingUndo ? 120 : 40 }}
        ListEmptyComponent={loadFailed ? <LoadFailed onRetry={loadMerchants} /> :
          <Text className="text-sm text-muted-foreground text-center px-8 mt-8">
            {merchants.length === 0 ? "Merchants appear here once you have transactions." : "Nothing matches."}
          </Text>
        }
        renderItem={({ item: row }) => {
          if (row.type === "heading") return <GroupHeading label={row.label} count={row.count} total={0} />;
          const m = row.item;
          return (
          <Pressable
            onPress={() => {
              if (selecting) {
                toggle(m.name);
                return;
              }
              opened.current = m.name;
              router.push({ pathname: "/settings/merchant-detail", params: { name: m.name } });
            }}
            onLongPress={() => {
              setSelecting(true);
              toggle(m.name);
            }}
            className="flex-row items-center mx-4 px-3 border-b border-border"
            style={{ minHeight: 64, paddingVertical: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`${m.name}, ${m.category ?? "no category"}`}
          >
            {selecting && (
              <Ionicons
                name={selected.has(m.name) ? "checkbox" : "square-outline"}
                size={22}
                color={selected.has(m.name) ? theme.primary : theme.mutedForeground}
                style={{ marginRight: 12 }}
              />
            )}
            <View className="flex-1 mr-2">
              <Text className="text-base font-medium text-foreground" numberOfLines={1}>{m.name}</Text>
              <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
                {m.names.length > 1 ? `${m.names.length} names in messages` : "1 name"}
                {" · "}
                {m.txCount} transaction{m.txCount === 1 ? "" : "s"}
                {m.categorySource === "learned" ? " · learned" : ""}
              </Text>
            </View>
            {m.category ? (
              <View className="rounded-full px-3 py-1" style={{ backgroundColor: theme.alpha("primary", 0.1), maxWidth: 140 }}>
                <Text className="text-xs font-semibold" style={{ color: theme.primary }} numberOfLines={1}>{m.category}</Text>
              </View>
            ) : (
              <View className="rounded-full px-3 py-1" style={{ backgroundColor: theme.alpha("warning", 0.14) }}>
                <Text className="text-xs font-semibold" style={{ color: theme.warning }}>Set category</Text>
              </View>
            )}
            {!selecting && <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} style={{ marginLeft: 8 }} />}
          </Pressable>
          );
        }}
        ListFooterComponent={
          <Pressable
            onPress={() => router.push("/settings/merchant-categories")}
            className="flex-row items-center mx-4 mt-4 px-3 py-3 rounded-lg border border-border"
            accessibilityRole="button"
          >
            <Ionicons name="list-outline" size={16} color={theme.mutedForeground} />
            <View className="flex-1 ml-2">
              <Text className="text-sm text-foreground">All keyword rules</Text>
              <Text className="text-xs text-muted-foreground">Built-in and your own keywords, and what Arth has learned</Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
          </Pressable>
        }
      />
      {selecting && (
        <View className="absolute left-0 right-0 bottom-0 px-4 pt-3 pb-6 bg-card border-t border-border">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-sm text-foreground">
              {chosen.length === 0 ? "Tap merchants to pick them" : `${chosen.length} selected`}
            </Text>
            <Pressable
              onPress={() => setSelected(allChosen ? new Set() : new Set(tools.rows.map((m) => m.name)))}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text className="text-sm font-semibold" style={{ color: theme.primary }}>
                {allChosen ? "Select none" : `Select all ${tools.rows.length}`}
              </Text>
            </Pressable>
          </View>
          <View className="flex-row" style={{ gap: 12 }}>
            <View className="flex-1"><Button title="Cancel" variant="secondary" onPress={stopSelecting} /></View>
            <View className="flex-1"><Button title="Set category" disabled={chosen.length === 0} onPress={() => setPicking(true)} /></View>
          </View>
        </View>
      )}
      <CategoryPickerSheet
        visible={picking}
        categories={categories}
        selectedId={null}
        onSelect={(id) => {
          setPicking(false);
          const category = categories.find((c) => c.id === id);
          if (category) void applyCategory(category.name);
        }}
        onClose={() => setPicking(false)}
      />
      {!selecting && pendingUndo && <UndoBar message={pendingUndo.message} onUndo={() => undoMerchantChange()} onClose={dismissMerchantUndo} />}
    </ScreenContainer>
  );
}
