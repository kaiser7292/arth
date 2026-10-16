import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { FilterChip, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { listMerchants, type MerchantSummary } from "@/services/merchants-overview";

type Filter = "all" | "uncategorised" | "several";

/**
 * Every merchant you've used, with the names it has in transaction messages and the category its new
 * transactions go to - Merchant Categories and Merchant Aliases in one list. Tap one to rename
 * it, merge or unmerge names, and set its category.
 */
export default function MerchantsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [merchants, setMerchants] = useState<MerchantSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useDataRefresh(
    useCallback(async () => {
      try {
        setMerchants(await listMerchants(DEFAULT_USER_ID));
      } catch {
        setMerchants([]);
      }
    }, []),
  );

  const counts = useMemo(() => {
    const list = merchants ?? [];
    return {
      all: list.length,
      uncategorised: list.filter((m) => !m.category).length,
      several: list.filter((m) => m.names.length > 1).length,
    };
  }, [merchants]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (merchants ?? []).filter((m) => {
      if (filter === "uncategorised" && m.category) return false;
      if (filter === "several" && m.names.length < 2) return false;
      if (!q) return true;
      return m.name.toLowerCase().includes(q) || m.names.some((n) => n.smsName.toLowerCase().includes(q));
    });
  }, [merchants, query, filter]);

  if (!merchants) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState icon="storefront-outline" message="Loading merchants…" />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <FlatList
        data={shown}
        keyExtractor={(m) => m.name.toLowerCase()}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 40 }}
        ListHeaderComponent={
          <View className="px-4 pt-3 pb-1">
            <View className="flex-row items-center rounded-lg border border-border bg-card px-3" style={{ minHeight: 42 }}>
              <Ionicons name="search-outline" size={16} color={theme.mutedForeground} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search merchants or names in messages"
                placeholderTextColor={theme.mutedForeground}
                className="flex-1 text-sm text-foreground py-2 ml-2"
                accessibilityLabel="Search merchants"
              />
              {query.length > 0 && (
                <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={16} color={theme.mutedForeground} />
                </Pressable>
              )}
            </View>
            <View className="flex-row mt-3 mb-2">
              <FilterChip label={`All ${counts.all}`} active={filter === "all"} onPress={() => setFilter("all")} spacing="sm" />
              <FilterChip label={`No category ${counts.uncategorised}`} active={filter === "uncategorised"} onPress={() => setFilter("uncategorised")} spacing="sm" />
              <FilterChip label={`Several names ${counts.several}`} active={filter === "several"} onPress={() => setFilter("several")} spacing="sm" />
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text className="text-sm text-muted-foreground text-center px-8 mt-8">
            {merchants.length === 0 ? "Merchants appear here once you have transactions." : "Nothing matches."}
          </Text>
        }
        renderItem={({ item: m }) => (
          <Pressable
            onPress={() => router.push({ pathname: "/settings/merchant-detail", params: { name: m.name } })}
            className="flex-row items-center mx-4 px-3 py-3 border-b border-border"
            accessibilityRole="button"
            accessibilityLabel={`${m.name}, ${m.category ?? "no category"}`}
          >
            <View className="flex-1 mr-2">
              <Text className="text-sm font-medium text-foreground" numberOfLines={1}>{m.name}</Text>
              <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
                {m.names.length > 1 ? `${m.names.length} names in messages` : "1 name"}
                {" · "}
                {m.txCount} transaction{m.txCount === 1 ? "" : "s"}
                {m.categorySource === "learned" ? " · learned" : ""}
              </Text>
            </View>
            {m.category ? (
              <View className="rounded-md px-2 py-0.5" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                <Text className="text-label font-semibold" style={{ color: theme.primary }} numberOfLines={1}>{m.category}</Text>
              </View>
            ) : (
              <View className="rounded-md px-2 py-0.5" style={{ backgroundColor: theme.alpha("warning", 0.14) }}>
                <Text className="text-label font-semibold" style={{ color: theme.warning }}>Set category</Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} style={{ marginLeft: 6 }} />
          </Pressable>
        )}
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
    </ScreenContainer>
  );
}
