import { useState, useCallback } from "react";
import { View, Text, FlatList, Pressable, TextInput } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card, FAB, Button } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
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

export default function TagsSettingsScreen() {
  const alert = useAlert();
  const { accent, colorScheme, colors } = useColorScheme();
  const [tags, setTags] = useState<Tag[]>([]);
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  const loadTags = useCallback(async () => {
    try {
      const data = await getTags(DEFAULT_USER_ID);
      setTags(data);
      const counts: Record<string, number> = {};
      for (const tag of data) {
        counts[tag.id] = await getTagUsageCount(tag.id);
      }
      setUsageCounts(counts);
    } catch {
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
      alert("Missing Name", "Please enter a tag name.");
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
        "Delete Tag",
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

  const renderTag = ({ item }: { item: Tag }) => {
    const isEditing = editingId === item.id;
    const count = usageCounts[item.id] ?? 0;

    if (isEditing) {
      return (
        <View className="py-3 border-b border-border-light dark:border-border-dark">
          <TextInput
            value={editName}
            onChangeText={setEditName}
            autoFocus
            maxLength={50}
            className="text-base text-text-primary dark:text-text-dark-primary border rounded-lg px-3 py-2 mb-2"
            style={{ borderColor: accent[500] }}
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
          <View className="flex-row">
            <Button
              title="Save"
              onPress={handleSaveEdit}
              variant="primary"
              className="flex-1 mr-2 py-2"
            />
            <Button
              title="Cancel"
              onPress={() => setEditingId(null)}
              variant="secondary"
              className="flex-1 py-2"
            />
          </View>
        </View>
      );
    }

    return (
      <Pressable
        onPress={() => handleStartEdit(item)}
        onLongPress={() => handleDelete(item)}
        className="flex-row items-center py-3 border-b border-border-light dark:border-border-dark"
      >
        <View
          className="w-4 h-4 rounded-full mr-3"
          style={{ backgroundColor: item.color }}
        />
        <View className="flex-1">
          <Text className="text-base text-text-primary dark:text-text-dark-primary">
            {item.name}
          </Text>
          <Text className="text-xs text-text-tertiary">
            {count} {count === 1 ? "expense" : "expenses"}
          </Text>
        </View>
        <Pressable onPress={() => handleDelete(item)} className="p-2">
          <Ionicons name="trash-outline" size={18} color={StatusColors[colorScheme].danger} />
        </Pressable>
      </Pressable>
    );
  };

  return (
    <ScreenContainer padTop={false} keyboardAware>
      {/* Count */}
      <View className="px-4 py-3">
        <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
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
            placeholderTextColor={colors.tabIconDefault}
            autoFocus
            maxLength={50}
            className="text-base text-text-primary dark:text-text-dark-primary border border-border-light dark:border-border-dark rounded-lg px-3 py-2 mb-3"
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
              className="flex-1 py-2.5 rounded-xl border border-border-light dark:border-border-dark items-center"
            >
              <Text className="text-sm font-medium text-text-secondary dark:text-text-dark-secondary">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleAdd}
              className="flex-1 py-2.5 rounded-xl items-center"
              style={{ backgroundColor: accent[500] }}
            >
              <Text className="text-sm font-semibold text-white">Create Tag</Text>
            </Pressable>
          </View>
        </Card>
      )}

      {/* Tag list */}
      <FlatList
        data={tags}
        keyExtractor={(item) => item.id}
        renderItem={renderTag}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80 }}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Ionicons name="pricetags-outline" size={48} color={colors.textSecondary} />
            <Text className="text-lg font-medium text-text-primary dark:text-text-dark-primary mt-4">
              No tags yet
            </Text>
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-1 text-center px-8">
              Tags let you label expenses (e.g. "work trip", "birthday", "tax deductible"). Create one to get started.
            </Text>
          </View>
        }
      />

      {/* FAB */}
      {!showAdd && (
        <FAB icon="add" onPress={() => setShowAdd(true)} />
      )}
    </ScreenContainer>
  );
}
