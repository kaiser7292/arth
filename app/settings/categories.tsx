import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Toggle } from "@/components/ui/Toggle";

import { View, ScrollView, Pressable } from "react-native";
import { useRouter, useFocusEffect, Stack, useLocalSearchParams } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import Ionicons from "@expo/vector-icons/Ionicons";
import { EmptyState, FAB, ScreenContainer, Text } from "@/components/ui";
import { tint } from "@/constants/brand";
import { buildCategoryTree } from "@/utils/category-tree";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getAllCategories,
  updateCategory,
  getCategoryExpenseCount,
  getCategoryExpenseCounts,
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
  /** Spends per category, for the count under each name. */
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
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

  const { deleteId } = useLocalSearchParams<{ deleteId?: string }>();
  const deleteHandled = useRef<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const loadCategories = useCallback(async () => {
    try {
      const cats = await getAllCategories(DEFAULT_USER_ID);
      setCategories(cats);
      setLoadFailed(false);
      getCategoryExpenseCounts(DEFAULT_USER_ID)
        .then(setCounts)
        .catch(() => setCounts(new Map()));
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

  useEffect(() => {
    if (!deleteId || deleteHandled.current === deleteId) return;
    const cat = categories.find((c) => c.id === deleteId);
    if (!cat) return;
    deleteHandled.current = deleteId;
    void handleDelete(cat);
  }, [deleteId, categories, handleDelete]);

  const tree = useMemo(() => buildCategoryTree(categories), [categories]);
  const countLine = (id: string) => {
    const n = counts.get(id) ?? 0;
    return n === 0 ? "No transactions yet" : `${n} transaction${n === 1 ? "" : "s"}`;
  };

  /** Up / down arrows for Reorder mode. */
  const arrows = (item: Category) => {
    const canUp = !!siblingOf(item, -1);
    const canDown = !!siblingOf(item, 1);
    return (
      <View className="flex-row" style={{ gap: 4 }}>
        <Pressable
          onPress={() => handleMoveUp(item)}
          disabled={!canUp}
          className="w-10 h-10 rounded-control border border-border items-center justify-center"
          accessibilityRole="button"
          accessibilityLabel={`Move ${item.name} up`}
        >
          <Ionicons name="chevron-up" size={22} color={!canUp ? theme.faintForeground : theme.mutedForeground} />
        </Pressable>
        <Pressable
          onPress={() => handleMoveDown(item)}
          disabled={!canDown}
          className="w-10 h-10 rounded-control border border-border items-center justify-center"
          accessibilityRole="button"
          accessibilityLabel={`Move ${item.name} down`}
        >
          <Ionicons name="chevron-down" size={22} color={!canDown ? theme.faintForeground : theme.mutedForeground} />
        </Pressable>
      </View>
    );
  };

  const openEdit = (id: string) => router.push({ pathname: "/settings/category-edit", params: { id } });

  /** A sub-category's long-press: everything its row used to offer. */
  const subMenu = (sub: Category) =>
    alert(sub.name, undefined, [
      { text: "Edit", onPress: () => openEdit(sub.id) },
      { text: sub.is_active === 1 ? "Turn off" : "Turn on", onPress: () => handleToggleActive(sub) },
      { text: "Delete", style: "destructive", onPress: () => handleDelete(sub) },
      { text: "Cancel", style: "cancel" },
    ]);

  /** Board "Categories": each main category is its own card, its sub-categories as pills under it. */
  const renderMain = ({ parent, children }: { parent: Category; children: Category[] }) => {
    const off = parent.is_active === 0;
    return (
      <View key={parent.id} className="mx-4 mb-3 rounded-card bg-card border border-border overflow-hidden" style={{ opacity: off ? 0.7 : 1 }}>
        <View className="flex-row items-center pl-3.5 pr-2.5" style={{ minHeight: 60, gap: 10 }}>
          {reordering && arrows(parent)}
          <View className="w-9 h-9 rounded-control items-center justify-center" style={{ backgroundColor: tint(parent.color, 0.12) }}>
            <Ionicons name={parent.icon as keyof typeof Ionicons.glyphMap} size={18} color={parent.color} />
          </View>
          <Pressable
            onPress={() => openEdit(parent.id)}
            className="flex-1 py-2"
            style={{ minWidth: 0, gap: 3 }}
            accessibilityRole="button"
            accessibilityLabel={`${parent.name}, ${countLine(parent.id)}${off ? ", off" : ""}. Edit`}
          >
            <Text className="text-body font-bold text-foreground" numberOfLines={1}>
              {parent.name}
            </Text>
            <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
              {parent.is_unavoidable === 1 && (
                <View className="rounded-pill px-1.5" style={{ backgroundColor: theme.alpha("foreground", 0.07) }}>
                  <Text className="text-label font-semibold text-muted-foreground">Unavoidable</Text>
                </View>
              )}
              {off && (
                <View className="rounded-pill px-1.5" style={{ backgroundColor: theme.alpha("danger", 0.08) }}>
                  <Text className="text-label font-semibold" style={{ color: theme.danger }}>
                    Inactive
                  </Text>
                </View>
              )}
              <Text className="text-label text-muted-foreground">{countLine(parent.id)}</Text>
            </View>
          </Pressable>
          {!reordering && (
            <>
              <Toggle value={!off} onValueChange={() => handleToggleActive(parent)} accessibilityLabel={`${parent.name} on`} />
              <Pressable
                onPress={() => handleDelete(parent)}
                className="w-9 h-9 items-center justify-center"
                accessibilityRole="button"
                accessibilityLabel={`Delete ${parent.name}`}
              >
                <Ionicons name="trash-outline" size={17} color={theme.mutedForeground} />
              </Pressable>
            </>
          )}
        </View>

        {reordering ? (
          // Sub-categories keep their own order: one row each, with arrows, while reordering.
          children.map((sub) => (
            <View key={sub.id} className="flex-row items-center border-t border-border pl-14 pr-2.5" style={{ minHeight: 52, gap: 10 }}>
              <Text className="flex-1 text-meta font-semibold text-foreground" numberOfLines={1}>
                {sub.name}
              </Text>
              {arrows(sub)}
            </View>
          ))
        ) : (
          <View className="flex-row flex-wrap pb-3" style={{ gap: 8, paddingLeft: 60, paddingRight: 14 }}>
            {children.map((sub) => {
              const subOff = sub.is_active === 0;
              return (
                <Pressable
                  key={sub.id}
                  onPress={() => openEdit(sub.id)}
                  onLongPress={() => subMenu(sub)}
                  className="rounded-pill flex-row items-center px-3"
                  style={{ height: 30, gap: 5, backgroundColor: tint(sub.color, subOff ? 0.05 : 0.12), opacity: subOff ? 0.6 : 1 }}
                  accessibilityRole="button"
                  accessibilityLabel={`${sub.name}, ${countLine(sub.id)}${subOff ? ", off" : ""}. Edit; long-press for more`}
                >
                  <Ionicons name={sub.icon as keyof typeof Ionicons.glyphMap} size={13} color={sub.color} />
                  <Text className="text-meta font-semibold" style={{ color: sub.color, textDecorationLine: subOff ? "line-through" : "none" }} numberOfLines={1}>
                    {sub.name}
                  </Text>
                </Pressable>
              );
            })}
            {!off && (
              <Pressable
                onPress={() => router.push({ pathname: "/settings/category-edit", params: { parentId: parent.id } })}
                className="rounded-pill items-center justify-center px-3"
                style={{ height: 30, borderWidth: 1.5, borderStyle: "dashed", borderColor: theme.border }}
                accessibilityRole="button"
                accessibilityLabel={`Add a sub-category under ${parent.name}`}
              >
                <Text className="text-meta font-semibold text-muted-foreground">+ Sub-category</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
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
      <ScrollView contentContainerStyle={{ paddingBottom: 96 }} showsVerticalScrollIndicator={false}>
          <Pressable
            onPress={() => router.push("/settings/category-organise")}
            className="mx-4 mt-3 mb-3 flex-row items-center rounded-card px-4 py-3"
            style={{ backgroundColor: theme.alpha("primary", 0.08) }}
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
        {tree.length === 0 ? (
          <EmptyState
            icon="pricetag-outline"
            title="No categories yet"
            subtitle="Categories are how spending gets grouped in Budget and Insights. Tap + to add your first."
          />
        ) : (
          tree.map(renderMain)
        )}
        <Text className="text-label text-faint-foreground text-center mt-1 px-6">Tap a sub-category to edit it. Long-press it to turn it off or delete it.</Text>
      </ScrollView>
      {!reordering && <FAB icon="add" label="Category" onPress={() => router.push("/settings/category-edit")} />}
    </ScreenContainer>
  );
}
