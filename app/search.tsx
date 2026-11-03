import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, SectionList, TextInput, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ScreenContainer, Text, useToast } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import {
  clearRecentSearchResults,
  getRecentSearchResults,
  rememberSearchResult,
  searchCatalog,
  searchData,
  type SearchGroup,
  type SearchResult,
} from "@/services/global-search";
import { availableCatalog, SUGGESTED_ACTION_IDS } from "@/services/search-catalog";
import { toggleAmountsHidden } from "@/services/privacy-mode";
import { formatAmount } from "@/utils/expense-validation";

interface Section {
  key: string;
  title: string;
  total?: number;
  seeAll?: SearchGroup["seeAll"];
  data: SearchResult[];
}

/** "Search or do": type anything, or pick from what people most often want. Opened from Home. */
export default function SearchScreen() {
  const router = useRouter();
  const theme = useTheme();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<SearchResult[]>(getRecentSearchResults);
  const seq = useRef(0);

  // Screens and actions answer at once; the person's own data follows a moment after typing stops.
  useEffect(() => {
    const run = ++seq.current;
    if (!query.trim()) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      const found = await searchData(query).catch(() => []);
      if (run !== seq.current) return;
      setGroups(found);
      setLoading(false);
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  const suggestions = useMemo(() => {
    const byId = new Map(availableCatalog().map((e) => [e.id, e]));
    return SUGGESTED_ACTION_IDS.flatMap((id) => {
      const e = byId.get(id);
      return e ? [{ key: `catalog:${e.id}`, title: e.title, icon: e.icon, target: e.target, action: e.action } as SearchResult] : [];
    });
  }, []);

  const sections = useMemo<Section[]>(() => {
    if (!query.trim()) {
      return [
        { key: "suggested", title: "I want to", data: suggestions },
        ...(recent.length > 0 ? [{ key: "recent", title: "Recent", data: recent }] : []),
      ];
    }
    const { actions, screens } = searchCatalog(query);
    return [
      ...(actions.length > 0 ? [{ key: "do", title: "Do", data: actions }] : []),
      ...(screens.length > 0 ? [{ key: "go", title: "Go to", data: screens }] : []),
      ...groups.map((g) => ({ key: g.key, title: g.title, total: g.total, seeAll: g.seeAll, data: g.results })),
    ];
  }, [query, groups, suggestions, recent]);

  const open = useCallback(
    (r: SearchResult) => {
      rememberSearchResult(r);
      setRecent(getRecentSearchResults());
      if (r.action === "toggleAmounts") {
        toast(toggleAmountsHidden() ? "Amounts hidden" : "Amounts showing");
        router.back();
        return;
      }
      if (!r.target) return;
      // A new value each time, so the same action works again with the Transactions tab already open.
      const params = r.target.pathname === "/(tabs)/expenses" ? { ...r.target.params, request: String(Date.now()) } : r.target.params;
      router.push({ pathname: r.target.pathname, params } as Href);
    },
    [router, toast],
  );

  return (
    <ScreenContainer>
      <View className="flex-row items-center px-3 pt-2 pb-2">
        <Pressable onPress={() => router.back()} hitSlop={10} className="p-1 mr-1" accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={22} color={theme.foreground} />
        </Pressable>
        <View className="flex-1 flex-row items-center rounded-xl border px-3" style={{ borderColor: theme.alpha("foreground", 0.15), minHeight: 44 }}>
          <Ionicons name="search" size={16} color={theme.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            placeholder="Search or do something"
            placeholderTextColor={theme.mutedForeground}
            className="flex-1 text-base text-foreground ml-2 py-2"
            accessibilityLabel="Search or do something"
          />
          {loading ? (
            <ActivityIndicator size="small" />
          ) : query ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={theme.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item, i) => `${item.key}-${i}`}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        renderSectionHeader={({ section }) => (
          <View className="flex-row items-baseline justify-between px-4 pt-4 pb-1">
            <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground">
              {section.title}
              {section.total && section.total > section.data.length ? ` · ${section.total}` : ""}
            </Text>
            {section.key === "recent" && (
              <Pressable
                onPress={() => {
                  clearRecentSearchResults();
                  setRecent([]);
                }}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text className="text-xs font-medium" style={{ color: theme.primary }}>Clear</Text>
              </Pressable>
            )}
          </View>
        )}
        renderItem={({ item }) => (
          <Pressable onPress={() => open(item)} className="flex-row items-center px-4 py-3 border-b border-border" accessibilityRole="button">
            <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={19} color={theme.primary} />
            <View className="flex-1 ml-3 mr-2">
              <Text className="text-sm text-foreground" numberOfLines={1}>{item.title}</Text>
              {item.subtitle ? <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>{item.subtitle}</Text> : null}
            </View>
            {item.amount != null ? (
              <Text className="text-sm font-semibold" style={{ color: item.incoming ? theme.success : theme.foreground }}>
                {item.incoming ? "+" : ""}{formatAmount(item.amount)}
              </Text>
            ) : (
              <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
            )}
          </Pressable>
        )}
        renderSectionFooter={({ section }) =>
          section.seeAll ? (
            <Pressable
              onPress={() => router.push({ pathname: section.seeAll!.pathname, params: { ...section.seeAll!.params, request: String(Date.now()) } } as Href)}
              className="px-4 py-3 border-b border-border"
              accessibilityRole="button"
            >
              <Text className="text-sm font-medium" style={{ color: theme.primary }}>See all {section.total}</Text>
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          query.trim() && !loading ? (
            <View className="items-center py-12 px-6">
              <Text className="text-sm text-muted-foreground text-center">Nothing matches "{query.trim()}". Try another word, or an amount like 450 or &gt;5000.</Text>
            </View>
          ) : null
        }
      />
    </ScreenContainer>
  );
}
