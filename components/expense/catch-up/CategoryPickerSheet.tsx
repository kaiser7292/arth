import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { Chip, ChipWrap, SearchField, Sheet, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { tint } from "@/constants/brand";
import { DEFAULT_USER_ID } from "@/constants/app";
import { createCategory, getRecentCategoriesForMerchant, type Category } from "@/services/category";
import { buildCategoryTree, categoryPath } from "@/utils/category-tree";

interface CategoryPickerSheetProps {
  visible: boolean;
  categories: Category[];
  selectedId: string | null;
  onSelect: (categoryId: string) => void;
  onClose: () => void;
  /** Shows "Used for <merchant> before" from this merchant's past expenses. */
  merchantName?: string | null;
  /** Offer "+ New" under each category, to add a sub-category and pick it in one go. */
  allowCreate?: boolean;
}

/**
 * Pick a category, or a sub-category of one. Search at the top, then what this merchant was filed
 * under before, then each category with its sub-categories as chips. Tapping one saves it - there is
 * no separate Done.
 */
export function CategoryPickerSheet({
  visible,
  categories,
  selectedId,
  onSelect,
  onClose,
  merchantName,
  allowCreate = false,
}: CategoryPickerSheetProps) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [addingUnder, setAddingUnder] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setQuery("");
    setAddingUnder(null);
    setNewName("");
    let live = true;
    if (merchantName) {
      getRecentCategoriesForMerchant(DEFAULT_USER_ID, merchantName)
        .then((ids) => live && setRecentIds(ids))
        .catch(() => live && setRecentIds([]));
    } else setRecentIds([]);
    return () => {
      live = false;
    };
  }, [visible, merchantName]);

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const tree = useMemo(() => buildCategoryTree(categories), [categories]);
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!q) return tree;
    return tree
      .map((g) => {
        const parentHit = g.parent.name.toLowerCase().includes(q);
        const kids = parentHit ? g.children : g.children.filter((c) => c.name.toLowerCase().includes(q));
        return parentHit || kids.length > 0 ? { parent: g.parent, children: kids } : null;
      })
      .filter((g): g is (typeof tree)[number] => g != null);
  }, [tree, q]);
  const recent = recentIds.map((id) => byId.get(id)).filter((c): c is Category => !!c);

  const pick = (id: string) => onSelect(id);

  const addChild = async (parent: Category) => {
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      const id = await createCategory({ user_id: DEFAULT_USER_ID, name, parent_id: parent.id });
      setAddingUnder(null);
      setNewName("");
      onSelect(id);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} maxHeightPct={85}>
      <View className="px-4 pb-2">
        <Text className="text-title font-bold text-foreground mb-3" accessibilityRole="header">
          Choose a category
        </Text>
        <SearchField value={query} onChangeText={setQuery} placeholder="Search categories" accessibilityLabel="Search categories" />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        {recent.length > 0 && !q && (
          <View className="px-4 pt-2 pb-3 border-b border-border">
            <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Used for {merchantName} before
            </Text>
            <ChipWrap>
              {recent.map((c) => (
                <Chip
                  key={c.id}
                  label={categoryPath(c, byId)}
                  on={c.id === selectedId}
                  onPress={() => pick(c.id)}
                  accessibilityLabel={`Use ${categoryPath(c, byId)}`}
                />
              ))}
            </ChipWrap>
          </View>
        )}

        {groups.map(({ parent, children }) => {
          const parentOn = parent.id === selectedId;
          return (
            <View key={parent.id} className="px-4 pt-3 pb-3 border-b border-border">
              <Pressable
                onPress={() => pick(parent.id)}
                className="flex-row items-center"
                style={{ minHeight: 44 }}
                accessibilityRole="button"
                accessibilityState={{ selected: parentOn }}
                accessibilityLabel={children.length > 0 ? `${parent.name}, the whole category` : parent.name}
              >
                <View className="w-9 h-9 rounded-control items-center justify-center mr-3" style={{ backgroundColor: tint(parent.color, 0.12) }}>
                  <Ionicons name={parent.icon as keyof typeof Ionicons.glyphMap} size={18} color={parent.color} />
                </View>
                <Text className="flex-1 text-body font-semibold text-foreground" numberOfLines={1}>
                  {parent.name}
                </Text>
                {parentOn ? (
                  <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
                ) : children.length > 0 ? (
                  <Text className="text-meta text-muted-foreground">Use whole</Text>
                ) : null}
              </Pressable>

              {(children.length > 0 || allowCreate) && (
                <ChipWrap className="mt-2 ml-12">
                  {children.map((c) => (
                    <Chip
                      key={c.id}
                      variant="choice"
                      label={c.name}
                      on={c.id === selectedId}
                      onPress={() => pick(c.id)}
                      accessibilityLabel={`${parent.name}, ${c.name}`}
                    />
                  ))}
                  {allowCreate && addingUnder !== parent.id && (
                    <Chip variant="add" label="New" onPress={() => { setAddingUnder(parent.id); setNewName(""); }} accessibilityLabel={`New sub-category under ${parent.name}`} />
                  )}
                </ChipWrap>
              )}

              {allowCreate && addingUnder === parent.id && (
                <View className="flex-row items-center mt-2 ml-12" style={{ gap: 8 }}>
                  <TextInput
                    value={newName}
                    onChangeText={setNewName}
                    placeholder={`Under ${parent.name}`}
                    placeholderTextColor={theme.mutedForeground}
                    autoFocus
                    maxLength={40}
                    returnKeyType="done"
                    onSubmitEditing={() => addChild(parent)}
                    className="flex-1 rounded-control border border-border bg-card px-3 text-body text-foreground"
                    style={{ minHeight: 40 }}
                    accessibilityLabel={`New sub-category under ${parent.name}`}
                  />
                  <Pressable
                    onPress={() => addChild(parent)}
                    disabled={!newName.trim() || saving}
                    className="rounded-pill px-4 justify-center"
                    style={{ minHeight: 40, backgroundColor: theme.primary, opacity: !newName.trim() || saving ? 0.5 : 1 }}
                    accessibilityRole="button"
                  >
                    <Text className="text-meta font-semibold text-primary-foreground">Add</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
        {groups.length === 0 && <Text className="text-meta text-muted-foreground text-center py-8">Nothing matches</Text>}
      </ScrollView>
    </Sheet>
  );
}
