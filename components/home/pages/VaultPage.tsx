import Ionicons from "@expo/vector-icons/Ionicons";

import { useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { LoadingState, Text } from "@/components/ui";
import { FastScrollRail } from "@/components/ui/FastScrollRail";
import { VaultIcon } from "@/components/ui/VaultIcon";
import { useDataRefresh } from "@/hooks/use-data-refresh";

import {
  VAULT_CATEGORY_GROUPS,
  VAULT_CATEGORY_ICONS,
  VAULT_CATEGORY_LABELS,
  VaultCategory,
  VaultEntry,
  getVaultEntries,
  vaultEntryMatches,
} from "@/services/vault";
import { consumeVaultPreload } from "@/services/home-preload";
import { useTheme } from "@/hooks/use-theme";
import { LoadFailed } from "@/components/ui/ListToolbar";
import { ListToolbar } from "@/components/ui/ListToolbar";
import { tint } from "@/constants/brand";

const LINK_CATEGORIES = ["banking", "card", "demat", "statement_pwd"];
// statement_pwd isn't offered for new entries, but older ones still need to be reachable.
const ALL_CATEGORIES: VaultCategory[] = [...VAULT_CATEGORY_GROUPS.flatMap((g) => g.categories), "statement_pwd"];

/**
 * The Vault list.
 *
 * The single implementation. `app/vault/index.tsx` is a thin route around this, and the Home
 * swipe-pager renders it directly - previously each had its own near-identical 190-line copy, so
 * every change to the vault had to be made twice or the two silently drifted.
 *
 * The route and the pager differ only in chrome: the route wraps this in a ScreenContainer and
 * offers a FAB, while the pager has no room for one and uses an inline add row instead.
 */
export function VaultPage({ showInlineAdd = false }: { showInlineAdd?: boolean } = {}) {
  const router = useRouter();
  const theme = useTheme();
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  /** Where each type's heading sits in the list, for the thumb rail. */
  const groupY = useRef<Record<string, number>>({});

  const [loadFailed, setLoadFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const preload = consumeVaultPreload();
      const data = preload ? preload.entries : await getVaultEntries();
      setEntries(data);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      // db not ready
    }
    setLoaded(true);
  }, []);

  useDataRefresh(load);

  // Always grouped by type (owner, Nov 2026), in the order the add form lists them; search keeps
  // only the types with a match.
  const groups = useMemo(
    () =>
      ALL_CATEGORIES.map((category) => ({
        category,
        items: entries.filter((e) => e.category === category && vaultEntryMatches(e, query)),
      })).filter((g) => g.items.length > 0),
    [entries, query],
  );

  const jumpTo = (index: number) => {
    const g = groups[index];
    const y = g ? groupY.current[g.category] : undefined;
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 4), animated: false });
  };

  const renderEntry = ({ item, index }: { item: VaultEntry; index: number }) => {
    const needsLink = LINK_CATEGORIES.includes(item.category) && !item.linked_account_id;
    return (
      <Pressable
        onPress={() => router.push(`/vault/${item.id}`)}
        className={`flex-row items-center px-3.5 bg-card ${index > 0 ? "border-t border-border" : ""}`}
        style={{ minHeight: 64, gap: 12 }}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${VAULT_CATEGORY_LABELS[item.category]}${needsLink ? ", not linked to an account yet" : ""}`}
      >
        <View className="w-10 h-10 rounded-control items-center justify-center" style={{ backgroundColor: tint(theme.primary, 0.1) }}>
          <Ionicons name={VAULT_CATEGORY_ICONS[item.category] as keyof typeof Ionicons.glyphMap} size={18} color={theme.primary} />
        </View>
        <View className="flex-1 min-w-0">
          <Text className="text-body font-semibold text-foreground" numberOfLines={1}>
            {item.title}
          </Text>
          {(item.email || item.username || item.phone) && (
            <Text className="text-meta text-muted-foreground" numberOfLines={1}>
              {item.email || item.username || item.phone}
            </Text>
          )}
        </View>
        {needsLink && <View className="w-2 h-2 rounded-pill shrink-0" style={{ backgroundColor: theme.warning }} />}
      </Pressable>
    );
  };

  if (loadFailed) return <LoadFailed onRetry={load} />;
  if (!loaded) return <LoadingState message="Loading vault..." icon="lock-closed-outline" />;

  const empty = entries.length === 0;
  // On the Home tab there is no round button, so "Add entry" goes under the list.
  const addBelow = showInlineAdd ? (
    <Pressable
      onPress={() => router.push("/vault/add")}
      className="mt-3 flex-row items-center justify-center rounded-card border border-dashed"
      style={{ minHeight: 52, gap: 6, borderColor: theme.primary, backgroundColor: theme.alpha("primary", 0.04) }}
      accessibilityRole="button"
    >
      <Ionicons name="add" size={18} color={theme.primary} />
      <Text className="text-body font-semibold" style={{ color: theme.primary }}>
        Add entry
      </Text>
    </Pressable>
  ) : null;

  return (
    <View style={{ flex: 1 }}>
      {!empty && (
        <View className="mx-4 mt-2 mb-1 flex-row items-center rounded-control px-3 py-2.5" style={{ gap: 8, backgroundColor: theme.alpha("primary", 0.08) }}>
          <Ionicons name="lock-closed-outline" size={15} color={theme.primary} />
          <Text className="text-meta text-foreground flex-1">Encrypted and kept only on this phone.</Text>
        </View>
      )}
      <ListToolbar
        search={{ value: query, onChangeText: setQuery, placeholder: "Search vault", input: { autoCapitalize: "none", autoCorrect: false } }}
      />
      {empty ? (
        <View className="flex-1 items-center justify-center pb-16 px-4">
          <VaultIcon size={48} color={theme.mutedForeground} />
          <Text className="text-heading font-semibold text-foreground mt-4">Vault is empty</Text>
          <Text className="text-meta text-muted-foreground mt-1 text-center px-6">
            Store your banking logins, card PINs, subscriptions, and any other credentials here — all encrypted on your device.
          </Text>
          <View className="self-stretch">{addBelow}</View>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingLeft: 16, paddingRight: groups.length > 1 ? 40 : 16, paddingBottom: 96 }}
            style={{ flex: 1 }}
          >
            {groups.length === 0 ? (
              <View className="items-center py-12">
                <Text className="text-meta text-muted-foreground">No results for "{query}"</Text>
              </View>
            ) : (
              groups.map((g) => (
                <View
                  key={g.category}
                  onLayout={(e) => {
                    groupY.current[g.category] = e.nativeEvent.layout.y;
                  }}
                >
                  <View className="flex-row items-center pt-4 pb-2" style={{ gap: 8 }}>
                    <Ionicons name={VAULT_CATEGORY_ICONS[g.category] as keyof typeof Ionicons.glyphMap} size={15} color={theme.primary} />
                    <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground flex-1" numberOfLines={1}>
                      {VAULT_CATEGORY_LABELS[g.category]}
                    </Text>
                    <Text className="text-label font-semibold text-muted-foreground">{g.items.length}</Text>
                  </View>
                  <View className="rounded-card border border-border overflow-hidden">
                    {g.items.map((item, index) => (
                      <View key={item.id}>{renderEntry({ item, index })}</View>
                    ))}
                  </View>
                </View>
              ))
            )}
            {addBelow}
          </ScrollView>
          <FastScrollRail
            items={groups.map((g) => ({
              key: g.category,
              label: VAULT_CATEGORY_LABELS[g.category],
              icon: VAULT_CATEGORY_ICONS[g.category] as keyof typeof Ionicons.glyphMap,
            }))}
            onSelect={jumpTo}
          />
        </View>
      )}
    </View>
  );
}
