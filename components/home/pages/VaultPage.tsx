import { Ionicons } from "@expo/vector-icons";

import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, SectionList, TextInput, View } from "react-native";
import { LoadingState, Text } from "@/components/ui";
import { VaultIcon } from "@/components/ui/VaultIcon";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";

import {
  VAULT_CATEGORY_GROUPS,
  VAULT_CATEGORY_ICONS,
  VAULT_CATEGORY_LABELS,
  VaultEntry,
  getVaultEntries,
  searchVaultEntries,
} from "@/services/vault";
import { consumeVaultPreload } from "@/services/home-preload";
import { useTheme } from "@/hooks/use-theme";

export function VaultPage() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const preload = consumeVaultPreload();
      const data = preload ? preload.entries : await getVaultEntries();
      setEntries(data);
    } catch {
      // db not ready
    }
    setLoaded(true);
  }, []);

  useDataRefresh(load);

  const handleSearch = useCallback(async (text: string) => {
    setQuery(text);
    if (!text.trim()) {
      setSearching(false);
      load();
      return;
    }
    setSearching(true);
    try {
      const results = await searchVaultEntries(text.trim());
      setEntries(results);
    } catch {
      // ignore
    }
  }, [load]);

  const sections = useMemo(() =>
    VAULT_CATEGORY_GROUPS.flatMap((group) =>
      group.categories
        .map((cat) => ({
          title: VAULT_CATEGORY_LABELS[cat],
          icon: VAULT_CATEGORY_ICONS[cat],
          data: entries.filter((e) => e.category === cat),
        }))
        .filter((s) => s.data.length > 0),
    ),
  [entries]);

  const LINK_CATEGORIES = ["banking", "card", "demat", "statement_pwd"];

  const renderEntry = ({ item }: { item: VaultEntry }) => {
    const needsLink = LINK_CATEGORIES.includes(item.category) && !item.linked_account_id;
    return (
      <Pressable
        onPress={() => router.push(`/vault/${item.id}`)}
        className="flex-row items-center py-3 border-b border-border"
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

  if (!loaded) return <LoadingState message="Loading vault..." icon="lock-closed-outline" />;

  const empty = entries.length === 0;

  return (
    <View style={{ flex: 1 }}>
      {/* Search bar */}
      <View
        className="mx-4 mt-3 mb-2 flex-row items-center rounded-xl px-3 py-2.5"
        style={{ backgroundColor: colors.border + "55" }}
      >
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={handleSearch}
          placeholder="Search vault..."
          placeholderTextColor={colors.textSecondary}
          className="flex-1 ml-2 text-sm text-foreground"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <Pressable onPress={() => handleSearch("")} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {/* Add button row */}
      <Pressable
        onPress={() => router.push("/vault/add")}
        className="mx-4 mb-2 flex-row items-center justify-center py-2 rounded-lg border border-border"
      >
        <Ionicons name="add" size={16} color={colors.textSecondary} />
        <Text className="text-sm text-muted-foreground ml-1">Add entry</Text>
      </Pressable>

      {empty && !query ? (
        <View className="flex-1 items-center justify-center pb-16">
          <VaultIcon size={48} color={colors.textSecondary} />
          <Text className="text-lg font-semibold text-foreground mt-4">
            Vault is empty
          </Text>
          <Text className="text-sm text-muted-foreground mt-1 text-center px-10">
            Store your banking logins, card PINs, subscriptions, and any other credentials here — all encrypted on your device.
          </Text>
        </View>
      ) : searching || query.length > 0 ? (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={renderEntry}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80 }}
          ListEmptyComponent={
            <View className="items-center py-12">
              <Text className="text-sm text-muted-foreground">
                No results for "{query}"
              </Text>
            </View>
          }
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderEntry}
          renderSectionHeader={({ section }) => (
            <View className="flex-row items-center px-4 pt-5 pb-1">
              <View
                className="w-5 h-5 rounded-md items-center justify-center mr-2"
                style={{ backgroundColor: theme.primary + "22" }}
              >
                <Ionicons name={section.icon as any} size={11} color={theme.primary} />
              </View>
              <Text
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: theme.primary }}
              >
                {section.title}
              </Text>
            </View>
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80 }}
          stickySectionHeadersEnabled={false}
        />
      )}
    </View>
  );
}
