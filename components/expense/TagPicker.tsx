/**
 * TagPicker — Inline tag selector with autocomplete and create-new.
 *
 * Shows currently selected tags as colored chips with remove buttons.
 * Tap "+" to show autocomplete dropdown of existing tags.
 * Type to filter. "Create new" option when no match.
 */

import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, TextInput, FlatList } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getTags,
  getTagsForExpense,
  addTagToExpense,
  removeTagFromExpense,
  findOrCreateTag,
} from "@/services/tags";
import type { Tag } from "@/services/tags";

interface TagPickerProps {
  /** Expense ID — if provided, loads/saves tags to this expense */
  expenseId?: string;
  /** For add screen (no expense yet) — controlled selected tag IDs */
  selectedTagIds?: string[];
  /** For add screen — callback when selection changes */
  onSelectionChange?: (tagIds: string[]) => void;
  /** Called when the picker dropdown opens — use to scroll parent into view */
  onOpen?: () => void;
  /** Called when the picker dropdown closes */
  onClose?: () => void;
}

export function TagPicker({ expenseId, selectedTagIds, onSelectionChange, onOpen, onClose }: TagPickerProps) {
  const { colors, accent, colorScheme } = useColorScheme();
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [activeTags, setActiveTags] = useState<Tag[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [searchText, setSearchText] = useState("");

  const isControlled = !expenseId; // controlled mode for add screen

  const loadTags = useCallback(async () => {
    try {
      const tags = await getTags(DEFAULT_USER_ID);
      setAllTags(tags);

      if (expenseId) {
        const expTags = await getTagsForExpense(expenseId);
        setActiveTags(expTags);
      }
    } catch {
      // DB not ready
    }
  }, [expenseId]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  // For controlled mode: sync activeTags from selectedTagIds
  useEffect(() => {
    if (isControlled && selectedTagIds) {
      setActiveTags(allTags.filter((t) => selectedTagIds.includes(t.id)));
    }
  }, [isControlled, selectedTagIds, allTags]);

  const activeIds = new Set(activeTags.map((t) => t.id));

  const filteredTags = allTags.filter(
    (t) =>
      !activeIds.has(t.id) &&
      t.name.toLowerCase().includes(searchText.toLowerCase()),
  );

  const showCreateOption =
    searchText.trim().length > 0 &&
    !allTags.some(
      (t) => t.name.toLowerCase() === searchText.trim().toLowerCase(),
    );

  const handleAddTag = useCallback(
    async (tag: Tag) => {
      if (expenseId) {
        await addTagToExpense(expenseId, tag.id);
        setActiveTags((prev) => [...prev, tag]);
      } else {
        const newIds = [...(selectedTagIds ?? []), tag.id];
        onSelectionChange?.(newIds);
      }
      setSearchText("");
      setShowPicker(false);
      onClose?.();
    },
    [expenseId, selectedTagIds, onSelectionChange, onClose],
  );

  const handleCreateAndAdd = useCallback(async () => {
    const tag = await findOrCreateTag(DEFAULT_USER_ID, searchText.trim());
    setAllTags((prev) => (prev.find((t) => t.id === tag.id) ? prev : [...prev, tag]));
    await handleAddTag(tag);
  }, [searchText, handleAddTag]);

  const handleRemoveTag = useCallback(
    async (tag: Tag) => {
      if (expenseId) {
        await removeTagFromExpense(expenseId, tag.id);
        setActiveTags((prev) => prev.filter((t) => t.id !== tag.id));
      } else {
        const newIds = (selectedTagIds ?? []).filter((id) => id !== tag.id);
        onSelectionChange?.(newIds);
      }
    },
    [expenseId, selectedTagIds, onSelectionChange],
  );

  return (
    <View>
      {/* Active tags as chips */}
      <View className="flex-row flex-wrap items-center">
        {activeTags.map((tag) => (
          <View
            key={tag.id}
            className="flex-row items-center rounded-full px-2.5 py-1 mr-1.5 mb-1.5"
            style={{ backgroundColor: tag.color + "14" }}
          >
            <View
              className="w-2 h-2 rounded-full mr-1.5"
              style={{ backgroundColor: tag.color }}
            />
            <Text
              className="text-xs font-medium mr-1"
              style={{ color: tag.color }}
            >
              {tag.name}
            </Text>
            <Pressable onPress={() => handleRemoveTag(tag)} hitSlop={8}>
              <Ionicons name="close-circle" size={14} color={tag.color} />
            </Pressable>
          </View>
        ))}

        {/* Add button */}
        <Pressable
          onPress={() => {
            const willOpen = !showPicker;
            setShowPicker(willOpen);
            if (willOpen) onOpen?.();
            else onClose?.();
          }}
          className="flex-row items-center rounded-full px-2.5 py-1 mr-1.5 mb-1.5 bg-card"
        >
          <Ionicons
            name={showPicker ? "close" : "add"}
            size={14}
            color={colors.textSecondary}
          />
          <Text className="text-xs text-muted-foreground ml-0.5">
            {showPicker ? "Close" : "Add Tag"}
          </Text>
        </Pressable>
      </View>

      {/* Picker dropdown */}
      {showPicker && (
        <View className="mt-2 rounded-xl bg-card p-3">
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search or create tag..."
            placeholderTextColor={colors.tabIconDefault}
            autoFocus
            maxLength={50}
            className="text-sm text-foreground border-b border-border pb-2 mb-2"
          />

          <FlatList
            data={filteredTags}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => handleAddTag(item)}
                className="flex-row items-center py-2"
              >
                <View
                  className="w-3 h-3 rounded-full mr-2"
                  style={{ backgroundColor: item.color }}
                />
                <Text className="text-sm text-foreground">
                  {item.name}
                </Text>
              </Pressable>
            )}
            ListEmptyComponent={
              !showCreateOption ? (
                <Text className="text-xs text-faint-foreground py-2">
                  {searchText ? "No matching tags" : "No tags yet"}
                </Text>
              ) : null
            }
          />

          {showCreateOption && (
            <Pressable
              onPress={handleCreateAndAdd}
              className="flex-row items-center py-2 border-t border-border mt-1"
            >
              <Ionicons name="add-circle-outline" size={16} color={colors.blue} />
              <Text className="text-sm font-medium ml-2" style={{ color: accent[500] }}>
                Create "{searchText.trim()}"
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
