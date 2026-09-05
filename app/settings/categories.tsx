import { useState, useCallback } from "react";

import { View, FlatList, Pressable } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Ionicons } from "@expo/vector-icons";
import { FAB, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getAllCategories,
  updateCategory,
  getCategoryExpenseCount,
  swapCategoryOrder,
  hardDeleteCategory,
} from "@/services/category";
import type { Category } from "@/services/category";
import { getErrorMessage } from "@/utils/error-message";
import { useTheme } from "@/hooks/use-theme";

export default function CategoriesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const alert = useAlert();
  const { colors } = useColorScheme();
  const [categories, setCategories] = useState<Category[]>([]);

  const loadCategories = useCallback(async () => {
    try {
      const cats = await getAllCategories(DEFAULT_USER_ID);
      setCategories(cats);
    } catch {
      // Database not initialized
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCategories();
    }, [loadCategories]),
  );

  const handleToggleActive = useCallback(
    async (cat: Category) => {
      try {
        if (cat.is_active === 1) {
          const count = await getCategoryExpenseCount(cat.id);
          if (count > 0) {
            alert(
              "Cannot Deactivate",
              `"${cat.name}" has ${count} expense${count > 1 ? "s" : ""} linked to it. Remove or reassign them first.`,
            );
            return;
          }
        }
        const newActive = cat.is_active === 1 ? 0 : 1;
        await updateCategory(cat.id, { is_active: newActive });
        loadCategories();
      } catch (e) {
        alert("Couldn't update", getErrorMessage(e, "Failed to update category."));
      }
    },
    [loadCategories],
  );

  const handleMoveUp = useCallback(
    async (index: number) => {
      if (index <= 0) return;
      try {
        const current = categories[index];
        const above = categories[index - 1];
        await swapCategoryOrder(
          current.id,
          current.sort_order,
          above.id,
          above.sort_order,
        );
        loadCategories();
      } catch (e) {
        alert("Couldn't reorder", getErrorMessage(e, "Failed to reorder."));
      }
    },
    [categories, loadCategories],
  );

  const handleMoveDown = useCallback(
    async (index: number) => {
      if (index >= categories.length - 1) return;
      try {
        const current = categories[index];
        const below = categories[index + 1];
        await swapCategoryOrder(
          current.id,
          current.sort_order,
          below.id,
          below.sort_order,
        );
        loadCategories();
      } catch (e) {
        alert("Couldn't reorder", getErrorMessage(e, "Failed to reorder."));
      }
    },
    [categories, loadCategories],
  );

  const handleDelete = useCallback(
    async (cat: Category) => {
      const count = await getCategoryExpenseCount(cat.id);
      if (count > 0) {
        alert(
          "Cannot Delete",
          `"${cat.name}" has ${count} expense${count > 1 ? "s" : ""} linked to it. Remove or reassign them first.`,
        );
        return;
      }
      alert("Delete Category", `Permanently delete "${cat.name}"? This cannot be undone.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await hardDeleteCategory(cat.id);
              loadCategories();
            } catch (e) {
              alert("Couldn't delete", getErrorMessage(e, "Failed to delete category."));
            }
          },
        },
      ]);
    },
    [loadCategories],
  );

  const renderItem = ({ item, index }: { item: Category; index: number }) => (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/settings/category-edit",
          params: { id: item.id },
        })
      }
      className={`flex-row items-center px-4 py-3 border-b border-border ${
        item.is_active === 0 ? "opacity-40" : ""
      }`}
    >
      <View
        className="w-10 h-10 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: item.color + "14" }}
      >
        <Ionicons
          name={item.icon as keyof typeof Ionicons.glyphMap}
          size={20}
          color={item.color}
        />
      </View>
      <View className="flex-1">
        <Text className="text-base font-medium text-foreground">
          {item.name}
        </Text>
        <View className="flex-row items-center">
          {item.is_unavoidable === 1 && (
            <Text className="text-xs text-muted-foreground mr-2">
              Unavoidable
            </Text>
          )}
          {item.is_active === 0 && (
            <Text className="text-xs text-danger">Inactive</Text>
          )}
        </View>
      </View>

      {/* Reorder buttons */}
      <View className="flex-row mr-2">
        <Pressable
          onPress={() => handleMoveUp(index)}
          disabled={index === 0}
          className="p-1"
        >
          <Ionicons
            name="chevron-up"
            size={16}
            color={index === 0 ? theme.faintForeground : theme.mutedForeground}
          />
        </Pressable>
        <Pressable
          onPress={() => handleMoveDown(index)}
          disabled={index === categories.length - 1}
          className="p-1"
        >
          <Ionicons
            name="chevron-down"
            size={16}
            color={index === categories.length - 1 ? theme.faintForeground : theme.mutedForeground}
          />
        </Pressable>
      </View>

      {/* Active/Inactive toggle */}
      <Pressable onPress={() => handleToggleActive(item)} className="p-2">
        <Ionicons
          name={item.is_active === 1 ? "eye-outline" : "eye-off-outline"}
          size={18}
          color={item.is_active === 1 ? colors.blue : theme.faintForeground}
        />
      </Pressable>

      {/* Delete button */}
      <Pressable onPress={() => handleDelete(item)} className="p-2">
        <Ionicons name="trash-outline" size={18} color={theme.danger} />
      </Pressable>
    </Pressable>
  );

  return (
    <ScreenContainer padTop={false}>
      <FlatList
        data={categories}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 80 }}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center py-20">
            <Text className="text-muted-foreground">
              No categories yet. Tap + to add one.
            </Text>
          </View>
        }
      />
      <FAB icon="add" onPress={() => router.push("/settings/category-edit")} />
    </ScreenContainer>
  );
}
