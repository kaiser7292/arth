import { useState, useCallback, useMemo } from "react";

import { View, FlatList, Pressable } from "react-native";
import { useRouter, useFocusEffect, Stack } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import Ionicons from "@expo/vector-icons/Ionicons";
import { EmptyState, FAB, ListSeparator, ScreenContainer, Text } from "@/components/ui";
import { tint } from "@/constants/brand";
import { buildCategoryTree } from "@/utils/category-tree";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getAllCategories,
  updateCategory,
  getCategoryExpenseCount,
  swapCategoryOrder,
  hardDeleteCategory,
} from "@/services/category";
import type { Category } from "@/services/category";
import { countMerchantRulesForCategory } from "@/services/merchant-categories";
import { getErrorMessage } from "@/utils/error-message";
import { useTheme } from "@/hooks/use-theme";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";
import { HeaderPill } from "@/components/ui/LinkRow";

export default function CategoriesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const alert = useAlert();
  const [categories, setCategories] = useState<Category[]>([]);
  // Shown as a tree: each main category, then its sub-categories indented under it (095).
  const shown = useMemo(
    () => buildCategoryTree(categories).flatMap(({ parent, children }) => [parent, ...children]),
    [categories],
  );
  /** The category this one swaps places with: the next sibling up or down in the same group. */
  const siblingOf = useCallback(
    (cat: Category, dir: -1 | 1): Category | undefined => {
      const isChild = !!cat.parent_id && categories.some((c) => c.id === cat.parent_id);
      const group = shown.filter((c) => (isChild ? c.parent_id === cat.parent_id : !(c.parent_id && categories.some((p) => p.id === c.parent_id))));
      const i = group.findIndex((c) => c.id === cat.id);
      return group[i + dir];
    },
    [shown, categories],
  );

  const [loadFailed, setLoadFailed] = useState(false);
  const loadCategories = useCallback(async () => {
    try {
      const cats = await getAllCategories(DEFAULT_USER_ID);
      setCategories(cats);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      // Database not initialized
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCategories();
    }, [loadCategories]),
  );

  /**
   * Merchants still filed into a category that's about to go would land uncategorised.
   * Offer to move them first; resolves true when it's fine to go ahead.
   */
  const confirmMerchantRules = useCallback(
    async (cat: Category, verb: string): Promise<boolean> => {
      const n = await countMerchantRulesForCategory(cat.name);
      if (n === 0) return true;
      return new Promise<boolean>((resolve) =>
        alert(
          `${n} merchant${n > 1 ? "s" : ""} use "${cat.name}"`,
          `Arth files ${n > 1 ? "these merchants" : "this merchant"} into "${cat.name}". If you ${verb} it, ${n > 1 ? "they" : "it"} will land in your review queue uncategorised. Move ${n > 1 ? "them" : "it"} to another category first?`,
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            {
              text: "Move merchants",
              onPress: () => {
                resolve(false);
                router.push({ pathname: "/settings/merchant-categories", params: { category: cat.name } });
              },
            },
            { text: `${verb[0].toUpperCase()}${verb.slice(1)} anyway`, style: "destructive", onPress: () => resolve(true) },
          ],
        ),
      );
    },
    [alert, router],
  );

  const handleToggleActive = useCallback(
    async (cat: Category) => {
      try {
        if (cat.is_active === 1) {
          const count = await getCategoryExpenseCount(cat.id);
          if (count > 0) {
            alert(
              "Cannot deactivate",
              `"${cat.name}" has ${count} expense${count > 1 ? "s" : ""} linked to it. Remove or reassign them first.`,
            );
            return;
          }
        }
        if (cat.is_active === 1 && !(await confirmMerchantRules(cat, "hide"))) return;
        const newActive = cat.is_active === 1 ? 0 : 1;
        await updateCategory(cat.id, { is_active: newActive });
        loadCategories();
      } catch (e) {
        alert("Couldn't update", getErrorMessage(e, "Failed to update category."));
      }
    },
    [loadCategories, confirmMerchantRules],
  );

  /** Reorder mode: the up / down arrows show, the other row actions hide. */
  const [reordering, setReordering] = useState(false);

  const handleMoveUp = useCallback(
    async (current: Category) => {
      const above = siblingOf(current, -1);
      if (!above) return;
      try {
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
    [siblingOf, loadCategories],
  );

  const handleMoveDown = useCallback(
    async (current: Category) => {
      const below = siblingOf(current, 1);
      if (!below) return;
      try {
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
    [siblingOf, loadCategories],
  );

  const handleDelete = useCallback(
    async (cat: Category) => {
      const count = await getCategoryExpenseCount(cat.id);
      if (count > 0) {
        alert(
          "Cannot delete",
          `"${cat.name}" has ${count} expense${count > 1 ? "s" : ""} linked to it. Remove or reassign them first.`,
        );
        return;
      }
      if (!(await confirmMerchantRules(cat, "delete"))) return;
      alert("Delete category", `Permanently delete "${cat.name}"? This cannot be undone.`, [
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
    [loadCategories, confirmMerchantRules],
  );

  const renderItem = ({ item }: { item: Category }) => {
    const editing = !reordering;
    const isChild = !!item.parent_id && categories.some((c) => c.id === item.parent_id);
    const subCount = categories.filter((c) => c.parent_id === item.id).length;
    const canUp = !!siblingOf(item, -1);
    const canDown = !!siblingOf(item, 1);
    return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/settings/category-edit",
          params: { id: item.id },
        })
      }
      className={`flex-row items-center py-3 ${isChild ? "pl-14 pr-4" : "px-4"} ${
        item.is_active === 0 ? "opacity-40" : ""
      }`}
      accessibilityLabel={isChild ? `${item.name}, a sub-category` : item.name}
    >
      <View
        className={`${isChild ? "w-8 h-8" : "w-10 h-10"} rounded-control items-center justify-center mr-3`}
        style={{ backgroundColor: tint(item.color, 0.12) }}
      >
        <Ionicons
          name={item.icon as keyof typeof Ionicons.glyphMap}
          size={isChild ? 16 : 20}
          color={item.color}
        />
      </View>
      <View className="flex-1">
        <Text className={`${isChild ? "text-meta" : "text-body"} font-medium text-foreground`}>
          {item.name}
        </Text>
        <View className="flex-row items-center">
          {!isChild && subCount > 0 && (
            <Text className="text-label text-muted-foreground mr-2">
              {subCount} sub-categor{subCount === 1 ? "y" : "ies"}
            </Text>
          )}
          {item.is_unavoidable === 1 && (
            <Text className="text-label text-muted-foreground mr-2">
              Unavoidable
            </Text>
          )}
          {item.is_active === 0 && (
            <Text className="text-label text-danger">Inactive</Text>
          )}
        </View>
      </View>

      {/* Add a sub-category under a main category */}
      {editing && !isChild && item.is_active === 1 && (
        <Pressable
          onPress={() => router.push({ pathname: "/settings/category-edit", params: { parentId: item.id } })}
          className="p-2"
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Add a sub-category under ${item.name}`}
        >
          <Ionicons name="add-circle-outline" size={18} color={theme.primary} />
        </Pressable>
      )}

      {/* Reorder buttons: only in Reorder mode, so they don't crowd every row */}
      {reordering && (
      <View className="flex-row mr-1" style={{ gap: 4 }}>
        <Pressable
          onPress={() => handleMoveUp(item)}
          disabled={!canUp}
          className="w-10 h-10 rounded-control border border-border items-center justify-center"
          accessibilityRole="button"
          accessibilityLabel={`Move ${item.name} up`}
        >
          <Ionicons
            name="chevron-up"
            size={22}
            color={!canUp ? theme.faintForeground : theme.mutedForeground}
          />
        </Pressable>
        <Pressable
          onPress={() => handleMoveDown(item)}
          disabled={!canDown}
          className="w-10 h-10 rounded-control border border-border items-center justify-center"
          accessibilityRole="button"
          accessibilityLabel={`Move ${item.name} down`}
        >
          <Ionicons
            name="chevron-down"
            size={22}
            color={!canDown ? theme.faintForeground : theme.mutedForeground}
          />
        </Pressable>
      </View>
      )}

      {/* Active/Inactive toggle */}
      {editing && (
      <Pressable onPress={() => handleToggleActive(item)} className="p-2" accessibilityRole="switch" accessibilityState={{ checked: item.is_active === 1 }} accessibilityLabel={`${item.name} active`}>
        <Ionicons
          name={item.is_active === 1 ? "eye-outline" : "eye-off-outline"}
          size={18}
          color={item.is_active === 1 ? theme.primary : theme.faintForeground}
        />
      </Pressable>

      )}

      {/* Delete button */}
      {editing && (
      <Pressable onPress={() => handleDelete(item)} className="p-2" accessibilityRole="button" accessibilityLabel={`Delete ${item.name}`}>
        <Ionicons name="trash-outline" size={18} color={theme.danger} />
      </Pressable>
      )}
    </Pressable>
    );
  };

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <HeaderPill
              label={reordering ? "Done" : "Reorder"}
              icon={reordering ? "checkmark" : "swap-vertical"}
              onPress={() => setReordering((r) => !r)}
              accessibilityLabel={reordering ? "Done reordering" : "Reorder categories"}
            />
          ),
        }}
      />
      {loadFailed && <LoadFailedBanner onRetry={loadCategories} />}
      <FlatList
        ListHeaderComponent={
          <Pressable
            onPress={() => router.push("/settings/category-organise")}
            className="mx-4 mt-3 mb-2 flex-row items-center rounded-card border border-border bg-card px-4 py-3"
            accessibilityRole="button"
            accessibilityLabel="Organise categories into main and sub-categories"
          >
            <Ionicons name="git-merge-outline" size={20} color={theme.primary} />
            <View className="flex-1 ml-3">
              <Text className="text-body font-semibold text-foreground">Organise into sub-categories</Text>
              <Text className="text-meta text-muted-foreground">See suggestions; nothing changes until you apply</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.faintForeground} />
          </Pressable>
        }
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        data={shown}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={ListSeparator}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 80 }}
        ListEmptyComponent={
          <EmptyState
            icon="pricetag-outline"
            title="No categories yet"
            subtitle="Categories are how spending gets grouped in Budget and Insights. Tap + to add your first."
          />
        }
      />
      {!reordering && <FAB icon="add" label="Category" onPress={() => router.push("/settings/category-edit")} />}
    </ScreenContainer>
  );
}
