import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Button, Input, Sheet, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { tint } from "@/constants/brand";
import { useAlert } from "@/hooks/use-alert";
import { useTheme } from "@/hooks/use-theme";
import { createCategory, getCategoryById, type Category } from "@/services/category";
import { formatError } from "@/utils/error-message";

/**
 * Add a category right where you're choosing one (owner, Nov 2026: "add then and there along with
 * sub categories if needed"): a name, and which main category it sits under, if any. A
 * sub-category takes its parent's icon and colour. The new one is picked straight away.
 */
export function QuickAddCategorySheet({
  visible,
  initialName,
  initialParentId = null,
  categories,
  onCreated,
  onClose,
}: {
  visible: boolean;
  initialName: string;
  initialParentId?: string | null;
  /** Every category; only main ones are offered as a parent. */
  categories: Category[];
  onCreated: (category: Category) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const alert = useAlert();
  const [name, setName] = useState(initialName);
  const [parentId, setParentId] = useState<string | null>(initialParentId);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(initialName);
    setParentId(initialParentId);
  }, [visible, initialName, initialParentId]);

  const mains = categories.filter((c) => !c.parent_id && c.is_active !== 0);
  const parent = parentId ? mains.find((c) => c.id === parentId) : undefined;

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      alert("Name it", "Type a name for the category.");
      return;
    }
    const clash = categories.find((c) => c.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (clash) {
      // Already there: just pick it.
      onCreated(clash);
      return;
    }
    setSaving(true);
    try {
      const id = await createCategory({ user_id: DEFAULT_USER_ID, name: trimmed, parent_id: parentId });
      const created = await getCategoryById(id);
      if (created) onCreated(created);
    } catch (e) {
      alert("Couldn't add it", formatError("New category", e));
    } finally {
      setSaving(false);
    }
  };

  const chip = (id: string | null, label: string, color: string, icon?: string) => {
    const on = parentId === id;
    return (
      <Pressable
        key={id ?? "none"}
        onPress={() => setParentId(id)}
        className="flex-row items-center rounded-pill border px-3"
        style={{ height: 34, gap: 6, borderColor: on ? color : theme.border, backgroundColor: on ? tint(color, 0.12) : theme.card }}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
      >
        {icon ? <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={14} color={color} /> : null}
        <Text className="text-meta font-semibold" style={{ color: on ? color : theme.foreground }} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose} page>
      <View className="px-5 pb-5" style={{ gap: 12 }}>
        <Text className="text-heading font-bold text-foreground">New category</Text>
        <Input label="Name" value={name} onChangeText={setName} placeholder="Groceries, Pet care" maxLength={50} autoFocus />
        <View>
          <Text className="text-label font-semibold text-muted-foreground mb-1.5">Sits under</Text>
          <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled">
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {chip(null, "Nothing · a main category", theme.primary)}
              {mains.map((c) => chip(c.id, c.name, c.color, c.icon))}
            </View>
          </ScrollView>
          <Text className="text-label text-muted-foreground mt-1.5">
            {parent ? `A sub-category of ${parent.name}: it counts toward ${parent.name}'s budget.` : "A main category of its own."}
          </Text>
        </View>
        <Button
          title={name.trim() ? (parent ? `Add “${name.trim()}” under ${parent.name}` : `Add “${name.trim()}”`) : "Add category"}
          onPress={() => void create()}
          loading={saving}
          disabled={!name.trim()}
        />
      </View>
    </Sheet>
  );
}
