import { useState, useCallback, useMemo, useRef } from "react";
import { View, FlatList, Pressable, TextInput, KeyboardAvoidingView, Keyboard } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, FAB, LearnMoreChip, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getMerchantAliases,
  deleteMerchantAlias,
  unmergeMerchantAlias,
  learnMerchantAlias,
  propagateMerchantRename,
  renameCanonical,
  getDistinctMerchantNames,
} from "@/services/merchant-alias";
import { useTheme } from "@/hooks/use-theme";

interface Alias {
  id: string;
  sms_name: string;
  canonical_name: string;
  category_id: string | null;
}

export default function MerchantAliasesScreen() {
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newSmsName, setNewSmsName] = useState("");
  const [newCanonical, setNewCanonical] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const listRef = useRef<FlatList>(null);

  const loadAliases = useCallback(async () => {
    try {
      // Load explicit aliases AND distinct merchant names from expenses.
      // Merchants without an alias row are displayed as pseudo-rows so the
      // screen works as a unified "all merchants I've used" manager.
      // Editing such a merchant creates a real alias row on first save.
      const [aliasRows, allMerchantNames] = await Promise.all([
        getMerchantAliases(DEFAULT_USER_ID),
        getDistinctMerchantNames(DEFAULT_USER_ID),
      ]);

      // Names already represented by an alias group (as canonical_name OR sms_name).
      const covered = new Set<string>();
      for (const a of aliasRows) {
        covered.add(a.canonical_name.toLowerCase());
        covered.add(a.sms_name.toLowerCase());
      }

      // Synthetic rows for merchants that have no alias mapping yet.
      // Using a sentinel id prefix so handlers can detect and skip alias-only operations.
      const syntheticRows: Alias[] = allMerchantNames
        .filter((name) => !covered.has(name.toLowerCase()))
        .map((name) => ({
          id: `synthetic:${name}`,
          sms_name: name,
          canonical_name: name,
          category_id: null,
        }));

      setAliases([...aliasRows, ...syntheticRows]);
    } catch {
      // Database not ready
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAliases();
    }, [loadAliases]),
  );

  const handleDelete = useCallback(
    (alias: Alias) => {
      // Synthetic rows (no alias mapping) can't be "deleted" — the user would
      // need to delete the underlying expenses to remove the merchant entirely.
      if (alias.id.startsWith("synthetic:")) {
        alert(
          "No Alias to Delete",
          `"${alias.sms_name}" has no alias mapping. To remove this merchant, delete the expenses that use it.`,
        );
        return;
      }
      alert(
        "Delete Alias",
        `Remove alias "${alias.sms_name}" → "${alias.canonical_name}"?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              await deleteMerchantAlias(alias.id);
              loadAliases();
            },
          },
        ],
      );
    },
    [loadAliases, alert],
  );

  const handleUnmerge = useCallback(
    (alias: Alias) => {
      alert(
        "Unmerge Alias",
        `Separate "${alias.sms_name}" from "${alias.canonical_name}"? It will become its own merchant and matching expenses will be renamed.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Unmerge",
            onPress: async () => {
              const result = await unmergeMerchantAlias(alias.id, DEFAULT_USER_ID);
              loadAliases();
              if (result && result.expensesUpdated > 0) {
                alert("Unmerged", `"${result.smsName}" is now separate. ${result.expensesUpdated} expense${result.expensesUpdated !== 1 ? "s" : ""} updated.`);
              }
            },
          },
        ],
      );
    },
    [loadAliases],
  );

  // Search filter
  const filteredAliases = useMemo(() => {
    if (!searchQuery.trim()) return aliases;
    const q = searchQuery.toLowerCase();
    return aliases.filter(
      (a) =>
        a.sms_name.toLowerCase().includes(q) ||
        a.canonical_name.toLowerCase().includes(q),
    );
  }, [aliases, searchQuery]);

  // Group aliases by canonical_name for display
  const groupedAliases = useMemo(() => {
    const groups = new Map<string, Alias[]>();
    for (const a of filteredAliases) {
      const key = a.canonical_name.toLowerCase();
      const existing = groups.get(key);
      if (existing) {
        existing.push(a);
      } else {
        groups.set(key, [a]);
      }
    }
    return Array.from(groups.entries())
      .map(([, items]) => ({
        canonical: items[0].canonical_name,
        aliases: items,
        primaryId: items[0].id,
      }))
      .sort((a, b) => a.canonical.localeCompare(b.canonical, "en", { sensitivity: "base" }));
  }, [filteredAliases]);

  const uniqueMerchants = groupedAliases.length;

  // Inline edit — save on blur or submit
  // Renames ALL aliases in the group + merges if new name matches another group
  const handleEditSave = useCallback(
    async (alias: Alias) => {
      const newName = editValue.trim();
      if (!newName || newName === alias.canonical_name) {
        setEditingId(null);
        setEditValue("");
        return;
      }
      const oldCanonical = alias.canonical_name;
      // Rename all aliases in this group to the new canonical name (auto-merge if name matches another group)
      await renameCanonical(DEFAULT_USER_ID, oldCanonical, newName);
      // Propagate rename to all existing expenses with the old merchant name
      const updated = await propagateMerchantRename(DEFAULT_USER_ID, oldCanonical, newName);
      setEditingId(null);
      setEditValue("");
      loadAliases();
      if (updated > 0) {
        alert("Updated", `Renamed "${oldCanonical}" → "${newName}" on ${updated} expense${updated !== 1 ? "s" : ""}.`);
      }
    },
    [editValue, loadAliases],
  );

  const handleAdd = useCallback(async () => {
    const sms = newSmsName.trim();
    const canonical = newCanonical.trim();

    if (!sms || !canonical) {
      alert("Missing Fields", "Both SMS name and display name are required.");
      return;
    }

    await learnMerchantAlias(DEFAULT_USER_ID, sms, canonical);
    setNewSmsName("");
    setNewCanonical("");
    setShowAdd(false);
    loadAliases();
  }, [newSmsName, newCanonical, loadAliases]);

  const renderGroup = ({ item }: { item: typeof groupedAliases[0] }) => {
    const primaryAlias = item.aliases[0];
    const isEditing = editingId === primaryAlias.id;

    return (
      <Card className="mx-4 mb-2">
        {/* Canonical name (editable) */}
        <View className="flex-row items-center justify-between mb-1">
          {isEditing ? (
            <TextInput
              value={editValue}
              onChangeText={setEditValue}
              onBlur={() => handleEditSave(primaryAlias)}
              onSubmitEditing={() => handleEditSave(primaryAlias)}
              autoFocus
              maxLength={100}
              className="text-base font-semibold text-foreground flex-1 border-b-2 py-0 mr-2"
              style={{ borderColor: theme.primary }}
            />
          ) : (
            <Pressable
              onPress={() => {
                setEditingId(primaryAlias.id);
                setEditValue(primaryAlias.canonical_name);
              }}
              className="flex-1 flex-row items-center"
            >
              <Text className="text-base font-semibold text-foreground flex-1" numberOfLines={1}>
                {item.canonical}
              </Text>
              <Ionicons name="create-outline" size={16} color={colors.blue} style={{ marginLeft: 6 }} />
            </Pressable>
          )}
        </View>

        {/* SMS name variants — only for real alias rows */}
        <View className="mt-1">
          {item.aliases.map((a) => {
            const isSynthetic = a.id.startsWith("synthetic:");
            if (isSynthetic) {
              return (
                <View key={a.id} className="flex-row items-center py-1.5">
                  <Ionicons name="information-circle-outline" size={10} color={colors.textSecondary} style={{ marginRight: 6 }} />
                  <Text className="text-xs text-faint-foreground flex-1" numberOfLines={1}>
                    No alias - tap name above to rename
                  </Text>
                </View>
              );
            }
            return (
              <View key={a.id} className="flex-row items-center justify-between py-1.5">
                <View className="flex-row items-center flex-1 mr-2">
                  <Ionicons name="arrow-forward" size={10} color={colors.textSecondary} style={{ marginRight: 6 }} />
                  <Text className="text-xs text-muted-foreground flex-1" numberOfLines={1}>
                    {a.sms_name}
                  </Text>
                </View>
                <View className="flex-row items-center">
                  {item.aliases.length > 1 && (
                    <Pressable onPress={() => handleUnmerge(a)} className="p-1 mr-1" hitSlop={6}>
                      <Ionicons name="git-branch-outline" size={14} color={colors.blue} />
                    </Pressable>
                  )}
                  <Pressable onPress={() => handleDelete(a)} className="p-1" hitSlop={6}>
                    <Ionicons name="trash-outline" size={14} color={theme.danger} />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>

        {/* Variant count */}
        {item.aliases.length > 1 && (
          <Text className="text-label text-faint-foreground mt-1">
            {item.aliases.length} SMS variants
          </Text>
        )}
      </Card>
    );
  };

  const handleOpenForm = useCallback(() => {
    setShowAdd(true);
    // Scroll to top to reveal the form once keyboard opens
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      sub.remove();
    });
    setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, 400);
  }, []);

  const listHeader = (
    <>
      {/* Header info */}
      <View className="px-4 pt-3 pb-2">
        <Text className="text-xs text-muted-foreground mb-2">
          All merchants from your expenses. Tap any name to rename - changes apply everywhere. Renaming a merchant that has no alias yet creates one on save.
        </Text>
        <LearnMoreChip contextKey="merchant-aliases-list" label="Why are names weird?" />
      </View>

      {/* Search bar */}
      <View className="flex-row items-center border border-border rounded-lg px-3 py-2 mx-4 mb-2">
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search merchants..."
          placeholderTextColor={colors.tabIconDefault}
          maxLength={100}
          className="flex-1 ml-2 text-base text-foreground"
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery("")}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {/* Count badge */}
      <View className="px-4 mb-2">
        <Text className="text-xs text-faint-foreground">
          {uniqueMerchants} {uniqueMerchants === 1 ? "merchant" : "merchants"} · {aliases.filter((a) => !a.id.startsWith("synthetic:")).length} with aliases
        </Text>
      </View>

      {/* Add form */}
      {showAdd && (
        <Card className="mx-4 mb-3">
          <Text className="text-xs font-medium text-muted-foreground mb-1">
            SMS Name (as it appears in bank SMS)
          </Text>
          <TextInput
            value={newSmsName}
            onChangeText={setNewSmsName}
            placeholder="e.g. ZOMATO LTD"
            placeholderTextColor={colors.tabIconDefault}
            autoFocus
            maxLength={100}
            className="border border-border rounded-lg px-3 py-2 mb-3 text-base text-foreground"
          />
          <Text className="text-xs font-medium text-muted-foreground mb-1">
            Display Name (clean name you want to see)
          </Text>
          <TextInput
            value={newCanonical}
            onChangeText={setNewCanonical}
            placeholder="e.g. Zomato"
            placeholderTextColor={colors.tabIconDefault}
            maxLength={100}
            className="border border-border rounded-lg px-3 py-2 mb-3 text-base text-foreground"
          />
          <View className="flex-row gap-3">
            <Button
              title="Cancel"
              onPress={() => { setShowAdd(false); setNewSmsName(""); setNewCanonical(""); }}
              variant="outline"
              className="flex-1 py-2.5"
            />
            <Button
              title="Save Alias"
              onPress={handleAdd}
              variant="primary"
              className="flex-1 py-2.5"
            />
          </View>
        </Card>
      )}
    </>
  );

  return (
    <ScreenContainer padTop={false}>
      <KeyboardAvoidingView
        behavior="padding"
        className="flex-1"
        keyboardVerticalOffset={100}
      >
        {/* Grouped alias list with header inside for proper keyboard scrolling */}
        <FlatList
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          ref={listRef}
          data={groupedAliases}
          keyExtractor={(item) => item.primaryId}
          renderItem={renderGroup}
          ListHeaderComponent={listHeader}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: showAdd ? 320 : 80 }}
          ListEmptyComponent={
            <View className="items-center py-16">
              <Ionicons name="swap-horizontal-outline" size={48} color={colors.textSecondary} />
              <Text className="text-lg font-medium text-foreground mt-4">
                No aliases yet
              </Text>
              <Text className="text-sm text-muted-foreground mt-1 text-center px-8">
                Aliases are auto-created when you scan SMS. You can also add them manually.
              </Text>
            </View>
          }
        />

        {/* FAB */}
        {!showAdd && (
          <FAB icon="add" onPress={handleOpenForm} />
        )}
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
