import { useCallback, useRef, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { GroupHeading, ListToolbar, LoadingState, ScreenContainer, Text, UndoBar } from "@/components/ui";
import { useListTools } from "@/hooks/use-list-tools";
import type { ListField, ListSort } from "@/utils/list-tools";
import { DEFAULT_USER_ID } from "@/constants/app";
import { compareUnicode } from "@/utils/unicode-sort";
import { useDataRefresh } from "@/hooks/use-data-refresh";
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
  // A change made on a merchant's page can still be undone from here.
  const pendingUndo = usePendingMerchantUndo();

  // The merchant whose page was opened from here.
  const opened = useRef<string | null>(null);
  const clearSearch = useRef<() => void>(() => {});

  useDataRefresh(
    useCallback(async () => {
      try {
        const list = await listMerchants(DEFAULT_USER_ID);
        setMerchants(list);
        // Back from a merchant that was renamed or merged away: the search that found it is stale.
        if (opened.current && !list.some((m) => m.name === opened.current)) clearSearch.current();
        opened.current = null;
      } catch {
        setMerchants([]);
      }
    }, []),
  );

  const tools = useListTools<MerchantSummary>({
    screen: "merchants",
    rows: merchants ?? [],
    fields: MERCHANT_FIELDS,
    sorts: MERCHANT_SORTS,
    searchPlaceholder: "Search merchants or message names",
    search: MERCHANT_SEARCH,
  });
  clearSearch.current = () => tools.setQuery("");

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
        contentContainerStyle={{ paddingBottom: pendingUndo ? 120 : 40 }}
        ListEmptyComponent={
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
              opened.current = m.name;
              router.push({ pathname: "/settings/merchant-detail", params: { name: m.name } });
            }}
            className="flex-row items-center mx-4 px-3 border-b border-border"
            style={{ minHeight: 64, paddingVertical: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`${m.name}, ${m.category ?? "no category"}`}
          >
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
            <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} style={{ marginLeft: 8 }} />
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
      {pendingUndo && <UndoBar message={pendingUndo.message} onUndo={() => undoMerchantChange()} onClose={dismissMerchantUndo} />}
    </ScreenContainer>
  );
}
