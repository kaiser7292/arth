import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, SectionList, Text, TextInput, View } from "react-native";
import { Card, FAB, ScreenContainer } from "@/components/ui";
import { VaultIcon } from "@/components/ui/VaultIcon";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  VAULT_CATEGORY_GROUPS,
  VAULT_CATEGORY_ICONS,
  VAULT_CATEGORY_LABELS,
  VaultEntry,
  getVaultEntries,
  searchVaultEntries,
} from "@/services/vault";

export default function VaultIndexScreen() {
  const router = useRouter();
  const { colors, colorScheme } = useColorScheme();
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getVaultEntries();
      setEntries(data);
    } catch {
      // db not ready
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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

  // Group entries by category
  const sections = VAULT_CATEGORY_GROUPS.flatMap((group) =>
    group.categories
      .map((cat) => ({
        title: VAULT_CATEGORY_LABELS[cat],
        icon: VAULT_CATEGORY_ICONS[cat],
        data: entries.filter((e) => e.category === cat),
      }))
      .filter((s) => s.data.length > 0),
  );

  const renderEntry = ({ item }: { item: VaultEntry }) => (
    <Pressable
      onPress={() => router.push(`/vault/${item.id}`)}
      className="flex-row items-center py-3 border-b border-border-light dark:border-border-dark"
    >
      <View className="flex-1">
        <Text className="text-base font-medium text-text-primary dark:text-text-dark-primary">
          {item.title}
        </Text>
        {(item.email || item.username || item.phone) && (
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5" numberOfLines={1}>
            {item.email || item.username || item.phone}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
    </Pressable>
  );

  const empty = entries.length === 0;

  return (
    <ScreenContainer padTop={false}>
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
          className="flex-1 ml-2 text-sm text-text-primary dark:text-text-dark-primary"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <Pressable onPress={() => handleSearch("")} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {empty && !query ? (
        <View className="flex-1 items-center justify-center pb-16">
          <VaultIcon size={48} color={colors.textSecondary} />
          <Text className="text-lg font-semibold text-text-primary dark:text-text-dark-primary mt-4">
            Vault is empty
          </Text>
          <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-1 text-center px-10">
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
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
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
              <Ionicons
                name={section.icon as any}
                size={14}
                color={colors.textSecondary}
              />
              <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary ml-1.5">
                {section.title}
              </Text>
            </View>
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80 }}
          stickySectionHeadersEnabled={false}
        />
      )}

      <FAB icon="add" onPress={() => router.push("/vault/add")} />
    </ScreenContainer>
  );
}
