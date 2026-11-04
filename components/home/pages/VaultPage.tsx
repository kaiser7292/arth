import Ionicons from "@expo/vector-icons/Ionicons";

import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, SectionList, TextInput, View } from "react-native";
import { ListSeparator, LoadingState, Text } from "@/components/ui";
import { VaultIcon } from "@/components/ui/VaultIcon";
import { Chevron } from "@/components/motion/Chevron";
import { useColorScheme } from "@/hooks/use-color-scheme";
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
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  // Drawers start closed, so opening the Vault doesn't show every login at once.
  const [openCategories, setOpenCategories] = useState<Set<VaultCategory>>(new Set());

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

  const toggle = useCallback((category: VaultCategory) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const sections = useMemo(() => {
    const searching = query.trim().length > 0;
    const grouped = ALL_CATEGORIES.map((category) => ({
      category,
      matches: entries.filter((e) => e.category === category && vaultEntryMatches(e, query)),
    })).filter((g) => g.matches.length > 0);
    // Searching opens the drawers with matches. With only one drawer there is nothing to choose.
    const locked = searching || grouped.length === 1;
    return grouped.map(({ category, matches }) => {
      const open = locked || openCategories.has(category);
      return {
        category,
        title: VAULT_CATEGORY_LABELS[category],
        icon: VAULT_CATEGORY_ICONS[category],
        total: matches.length,
        needsLink: matches.some((e) => LINK_CATEGORIES.includes(e.category) && !e.linked_account_id),
        locked,
        open,
        data: open ? matches : [],
      };
    });
  }, [entries, query, openCategories]);

  const renderEntry = ({ item }: { item: VaultEntry }) => {
    const needsLink = LINK_CATEGORIES.includes(item.category) && !item.linked_account_id;
    return (
      <Pressable
        onPress={() => router.push(`/vault/${item.id}`)}
        className="flex-row items-center py-3"
      >
        <View className="flex-1 min-w-0">
          <Text className="text-base font-medium text-foreground">
            {item.title}
          </Text>
          {(item.email || item.username || item.phone) && (
            <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
              {item.email || item.username || item.phone}
            </Text>
          )}
        </View>
        {needsLink && (
          <View className="w-2 h-2 rounded-full mr-2 shrink-0" style={{ backgroundColor: theme.warning }} />
        )}
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
      </Pressable>
    );
  };

  if (loadFailed) return <LoadFailed onRetry={load} />;
  if (!loaded) return <LoadingState message="Loading vault..." icon="lock-closed-outline" />;

  const empty = entries.length === 0;

  return (
    <View style={{ flex: 1 }}>
      <ListToolbar
        search={{ value: query, onChangeText: setQuery, placeholder: "Search vault", input: { autoCapitalize: "none", autoCorrect: false } }}
      />

      {showInlineAdd && (
        <Pressable
          onPress={() => router.push("/vault/add")}
          className="mx-4 mb-2 flex-row items-center justify-center py-2 rounded-lg border border-border"
        >
          <Ionicons name="add" size={16} color={colors.textSecondary} />
          <Text className="text-sm text-muted-foreground ml-1">Add entry</Text>
        </Pressable>
      )}

      {empty ? (
        <View className="flex-1 items-center justify-center pb-16">
          <VaultIcon size={48} color={colors.textSecondary} />
          <Text className="text-lg font-semibold text-foreground mt-4">
            Vault is empty
          </Text>
          <Text className="text-sm text-muted-foreground mt-1 text-center px-10">
            Store your banking logins, card PINs, subscriptions, and any other credentials here — all encrypted on your device.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderEntry}
          ItemSeparatorComponent={ListSeparator}
          keyboardShouldPersistTaps="handled"
          renderSectionHeader={({ section }) => (
            <Pressable
              onPress={() => toggle(section.category)}
              disabled={section.locked}
              accessibilityRole="button"
              accessibilityState={{ expanded: section.open }}
              accessibilityLabel={`${section.title}, ${section.total} ${section.total === 1 ? "entry" : "entries"}`}
              className="flex-row items-center py-3 mt-2 border-b border-border"
            >
              <View
                className="w-6 h-6 rounded-md items-center justify-center mr-2"
                style={{ backgroundColor: theme.primary + "22" }}
              >
                <Ionicons name={section.icon as any} size={13} color={theme.primary} />
              </View>
              <Text className="text-sm font-semibold text-foreground flex-1" numberOfLines={1}>
                {section.title}
              </Text>
              {/* An account still to link would otherwise be hidden inside a closed drawer. */}
              {!section.open && section.needsLink && (
                <View className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: theme.warning }} />
              )}
              <Text className="text-xs text-muted-foreground mr-2">{section.total}</Text>
              {!section.locked && <Chevron open={section.open} size={16} color={colors.textSecondary} />}
            </Pressable>
          )}
          ListEmptyComponent={
            <View className="items-center py-12">
              <Text className="text-sm text-muted-foreground">
                No results for "{query}"
              </Text>
            </View>
          }
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80 }}
          stickySectionHeadersEnabled={false}
        />
      )}
    </View>
  );
}
