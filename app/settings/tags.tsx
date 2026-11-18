import { useState, useCallback } from "react";
import { View, FlatList, Pressable, TextInput } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, EmptyState, FAB, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getTags,
  createTag,
  updateTag,
  deleteTag,
  getTagUsageCount,
  TAG_COLORS,
} from "@/services/tags";
import type { Tag } from "@/services/tags";
import { getErrorMessage } from "@/utils/error-message";
import { useTheme } from "@/hooks/use-theme";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";

export default function TagsSettingsScreen() {
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [tags, setTags] = useState<Tag[]>([]);
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  const [loadFailed, setLoadFailed] = useState(false);
  const loadTags = useCallback(async () => {
    try {
      const data = await getTags(DEFAULT_USER_ID);
      setTags(data);
      const counts: Record<string, number> = {};
      for (const tag of data) {
        counts[tag.id] = await getTagUsageCount(tag.id);
      }
      setUsageCounts(counts);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      // Database not ready
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTags();
    }, [loadTags]),
  );

  const handleAdd = useCallback(async () => {
    const name = newTagName.trim();
    if (!name) {
      alert("Missing name", "Please enter a tag name.");
      return;
    }
    try {
      await createTag(DEFAULT_USER_ID, name, newTagColor);
      setNewTagName("");
      setShowAdd(false);
      loadTags();
    } catch (e) {
      alert("Couldn't create tag", getErrorMessage(e, "Failed to create tag."));
    }
  }, [newTagName, newTagColor, loadTags]);

  const handleDelete = useCallback(
    (tag: Tag) => {
      const count = usageCounts[tag.id] ?? 0;
      alert(
        "Delete tag",
        count > 0
          ? `"${tag.name}" is used on ${count} expense${count > 1 ? "s" : ""}. Delete it? It will be removed from all expenses.`
          : `Delete "${tag.name}"?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                await deleteTag(tag.id);
                loadTags();
              } catch (e) {
                alert("Couldn't delete tag", getErrorMessage(e, "Failed to delete tag."));
              }
            },
          },
        ],
      );
    },
    [usageCounts, loadTags],
  );

  const handleStartEdit = useCallback((tag: Tag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return;
    const name = editName.trim();
    if (!name) return;
    try {
      await updateTag(editingId, { name, color: editColor });
      setEditingId(null);
      loadTags();
    } catch (e) {
      alert("Couldn't update tag", getErrorMessage(e, "Failed to update tag."));
    }
  }, [editingId, editName, editColor, loadTags]);

  const renderTag = ({ item, index }: { item: Tag; index: number }) => {
    const isEditing = editingId === item.id;
    const count = usageCounts[item.id] ?? 0;

    if (isEditing) {
      return (
        <View className={`px-4 py-3.5 ${index > 0 ? "border-t border-border" : ""}`} style={{ gap: 4, backgroundColor: theme.alpha("primary", 0.04) }}>
          <Text className="text-label font-semibold text-muted-foreground mb-1">Editing in place</Text>
          <TextInput
            value={editName}
            onChangeText={setEditName}
            autoFocus
            maxLength={50}
            className="text-body text-foreground rounded-control px-3 mb-2 bg-card"
            style={{ borderColor: theme.primary, borderWidth: 2, height: 44 }}
            accessibilityLabel="Tag name"
          />
          {/* Color picker */}
          <View className="flex-row flex-wrap mb-2">
            {TAG_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => setEditColor(c)}
                className="mr-2 mb-2"
              >
                <View
                  className="w-7 h-7 rounded-full items-center justify-center"
                  style={{ backgroundColor: c }}
                >
                  {editColor === c && (
                    <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                  )}
                </View>
              </Pressable>
            ))}
          </View>
          <View className="flex-row" style={{ gap: 10 }}>
            <Pressable
              onPress={() => setEditingId(null)}
              className="rounded-pill border border-border bg-card items-center justify-center px-4"
              style={{ height: 40 }}
              accessibilityRole="button"
            >
              <Text className="text-meta font-semibold text-foreground">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSaveEdit}
              className="rounded-pill items-center justify-center px-5"
              style={{ height: 40, backgroundColor: theme.primary }}
              accessibilityRole="button"
            >
              <Text className="text-meta font-bold" style={{ color: theme.primaryForeground }}>
                Save tag
              </Text>
            </Pressable>
          </View>
        </View>
      );
    }

    return (
      <Pressable
        onPress={() => handleStartEdit(item)}
        onLongPress={() => handleDelete(item)}
        className={`flex-row items-center pl-4 pr-2 ${index > 0 ? "border-t border-border" : ""}`}
        style={{ minHeight: 56 }}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${count} ${count === 1 ? "transaction" : "transactions"}. Edit`}
      >
        <View
          className="w-4 h-4 rounded-full mr-3"
          style={{ backgroundColor: item.color }}
        />
        <View className="flex-1">
          <Text className="text-body font-semibold text-foreground" numberOfLines={1}>
            {item.name}
          </Text>
          <Text className="text-meta text-muted-foreground">
            {count} {count === 1 ? "transaction" : "transactions"}
          </Text>
        </View>
        <Pressable onPress={() => handleDelete(item)} className="w-10 h-10 items-center justify-center" accessibilityRole="button" accessibilityLabel={`Delete ${item.name}`}>
          <Ionicons name="trash-outline" size={17} color={theme.mutedForeground} />
        </Pressable>
      </Pressable>
    );
  };

  return (
    <ScreenContainer padTop={false} keyboardAware>
      {loadFailed && <LoadFailedBanner onRetry={loadTags} />}
      {/* Count */}
      <View className="px-4 py-3">
        <Text className="text-meta text-muted-foreground">
          {tags.length} {tags.length === 1 ? "tag" : "tags"}
        </Text>
      </View>

      {/* Add form */}
      {showAdd && (
        <Card className="mx-4 mb-3">
          <TextInput
            value={newTagName}
            onChangeText={setNewTagName}
            placeholder="Tag name"
            placeholderTextColor={theme.mutedForeground}
            autoFocus
            maxLength={50}
            className="text-body text-foreground border border-border rounded-control px-3 py-2 mb-3"
          />
          {/* Color picker */}
          <View className="flex-row flex-wrap mb-3">
            {TAG_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => setNewTagColor(c)}
                className="mr-2 mb-2"
              >
                <View
                  className="w-7 h-7 rounded-full items-center justify-center"
                  style={{ backgroundColor: c }}
                >
                  {newTagColor === c && (
                    <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                  )}
                </View>
              </Pressable>
            ))}
          </View>
          <View className="flex-row gap-3">
            <Pressable
              onPress={() => { setShowAdd(false); setNewTagName(""); }}
              className="flex-1 py-2.5 rounded-card border border-border items-center"
            >
              <Text className="text-body font-medium text-muted-foreground">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleAdd}
              className="flex-1 py-2.5 rounded-card items-center"
              style={{ backgroundColor: theme.primary }}
            >
              <Text className="text-body font-semibold text-primary-foreground">Create tag</Text>
            </Pressable>
          </View>
        </Card>
      )}

      {/* Tag list */}
      <FlatList
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        data={tags}
        keyExtractor={(item) => item.id}
        renderItem={renderTag}
        style={{ flexGrow: 0, flexShrink: 1, marginBottom: 88 }}
        contentContainerStyle={tags.length > 0 ? { marginHorizontal: 16, borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, overflow: "hidden" } : { paddingHorizontal: 16 }}
        ListEmptyComponent={
          <EmptyState
            icon="pricetags-outline"
            title={"No tags yet"}
            subtitle={"Tags let you label expenses (e.g. \"work trip\", \"birthday\", \"tax deductible\"). Create one to get started."}
          />
        }
      />

      {/* FAB */}
      {!showAdd && (
        <FAB icon="add" label="Tag" onPress={() => setShowAdd(true)} />
      )}
    </ScreenContainer>
  );
}
