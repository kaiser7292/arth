import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Chip, SearchField, Sheet, Text } from "@/components/ui";
import { tint } from "@/constants/brand";
import { useTheme } from "@/hooks/use-theme";

/**
 * The one picker for the add / edit transaction form (board "Add / edit transaction"): a sheet
 * with a search box (the keyboard opens only when you tap it), how many there are, groups (recent, most used, a category's
 * sub-categories, account kinds), live filtering, and "+ Add <typed name>" when nothing matches.
 */

export interface PickerSheetItem {
  id: string;
  label: string;
  sub?: string;
  /** Right-hand text: a balance, "12×". */
  right?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** A drawn icon (account types), shown in place of `icon`. */
  glyph?: React.ReactNode;
  color?: string;
  /** Indent (a sub-category under its main one). */
  indent?: boolean;
  /** Extra words search should match (a sub-category's parent name). */
  keywords?: string;
}

export interface PickerSheetSection {
  key: string;
  title?: string;
  items: PickerSheetItem[];
}

export function PickerSheet({
  visible,
  onClose,
  title,
  sections,
  selectedId,
  onSelect,
  allowNone = false,
  noneLabel = "None",
  searchPlaceholder = "Search",
  onAdd,
  addLabel,
  addAlways,
  filters,
  noun = { one: "item", many: "items" },
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  sections: PickerSheetSection[];
  selectedId: string | null;
  onSelect: (id: string | null, item?: PickerSheetItem) => void;
  allowNone?: boolean;
  noneLabel?: string;
  searchPlaceholder?: string;
  /** "+ Add" when the typed text matches nothing exactly. Gets the typed text. */
  onAdd?: (typed: string) => void;
  /** Label for the add row; gets the typed text. Default: Add "<typed>". */
  addLabel?: (typed: string) => string;
  /** Show the add row even with nothing typed, with this label (e.g. "New category"). */
  addAlways?: string;
  /** Filter chips over the sections, by section key ("Savings", "Cards"). */
  filters?: { key: string; label: string }[];
  noun?: { one: string; many: string };
}) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const q = query.trim().toLowerCase();

  const shown = useMemo(() => {
    const seen = new Set<string>();
    return sections
      .filter((s) => !filter || s.key === filter)
      .map((s) => ({
        ...s,
        items: s.items.filter((i) => {
          // While searching, an item listed in two groups (recent and most used) shows once.
          if (q && seen.has(i.id)) return false;
          const hit = !q || `${i.label} ${i.sub ?? ""} ${i.keywords ?? ""}`.toLowerCase().includes(q);
          if (hit && q) seen.add(i.id);
          return hit;
        }),
      }))
      .filter((s) => s.items.length > 0);
  }, [sections, q, filter]);

  const total = useMemo(() => new Set(sections.flatMap((s) => s.items.map((i) => i.id))).size, [sections]);
  const matchCount = useMemo(() => new Set(shown.flatMap((s) => s.items.map((i) => i.id))).size, [shown]);
  const exact = q !== "" && sections.some((s) => s.items.some((i) => i.label.trim().toLowerCase() === q));

  const close = () => {
    setQuery("");
    setFilter(null);
    onClose();
  };
  const pick = (id: string | null, item?: PickerSheetItem) => {
    setQuery("");
    setFilter(null);
    onSelect(id, item);
  };

  return (
    <Sheet visible={visible} onClose={close} maxHeightPct={88}>
      <View className="px-4 pb-2" style={{ gap: 10 }}>
        <View className="flex-row items-center justify-between">
          <Text className="text-heading font-bold text-foreground">{title}</Text>
          <Text className="text-meta text-muted-foreground">
            {q ? `${matchCount} of ${total}` : `${total} ${total === 1 ? noun.one : noun.many}`}
          </Text>
        </View>
        <SearchField value={query} onChangeText={setQuery} placeholder={searchPlaceholder} accessibilityLabel={searchPlaceholder} />
        {filters && filters.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
            <Chip label="All" on={filter === null} onPress={() => setFilter(null)} />
            {filters.map((f) => (
              <Chip key={f.key} label={f.label} on={filter === f.key} onPress={() => setFilter(filter === f.key ? null : f.key)} />
            ))}
          </ScrollView>
        )}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }} style={{ maxHeight: 520 }}>
        {onAdd && addAlways && q === "" && (
          <Pressable
            onPress={() => onAdd("")}
            className="flex-row items-center mx-4 mb-2 px-3.5 rounded-control border border-dashed"
            style={{ minHeight: 48, gap: 10, borderColor: theme.primary }}
            accessibilityRole="button"
          >
            <Ionicons name="add" size={18} color={theme.primary} />
            <Text className="flex-1 text-body font-semibold" style={{ color: theme.primary }} numberOfLines={1}>
              {addAlways}
            </Text>
          </Pressable>
        )}
        {onAdd && q !== "" && !exact && (
          <Pressable
            onPress={() => {
              const typed = query.trim();
              setQuery("");
              onAdd(typed);
            }}
            className="flex-row items-center mx-4 mb-2 px-3.5 rounded-control border border-dashed"
            style={{ minHeight: 48, gap: 10, borderColor: theme.primary }}
            accessibilityRole="button"
          >
            <Ionicons name="add" size={18} color={theme.primary} />
            <Text className="flex-1 text-body font-semibold" style={{ color: theme.primary }} numberOfLines={1}>
              {addLabel ? addLabel(query.trim()) : `Add “${query.trim()}”`}
            </Text>
          </Pressable>
        )}
        {allowNone && !q && (
          <Row label={noneLabel} icon="remove-circle-outline" on={selectedId === null} onPress={() => pick(null)} />
        )}
        {shown.map((s) => (
          <View key={s.key} className="mt-1">
            {s.title && (
              <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground px-4 pt-2 pb-1">{s.title}</Text>
            )}
            {s.items.map((i) => (
              <Row
                key={`${s.key}-${i.id}`}
                label={i.label}
                sub={i.sub}
                right={i.right}
                icon={i.icon}
                glyph={i.glyph}
                color={i.color}
                indent={i.indent}
                on={selectedId === i.id}
                onPress={() => pick(i.id, i)}
              />
            ))}
          </View>
        ))}
        {shown.length === 0 && (
          <Text className="text-meta text-muted-foreground text-center py-6">{q ? "No matches" : `No ${noun.many} yet`}</Text>
        )}
      </ScrollView>
    </Sheet>
  );
}

function Row({
  label,
  sub,
  right,
  icon,
  glyph,
  color,
  indent,
  on,
  onPress,
}: {
  label: string;
  sub?: string;
  right?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  glyph?: React.ReactNode;
  color?: string;
  indent?: boolean;
  on: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const c = color ?? theme.mutedForeground;
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-4"
      style={{ minHeight: 52, gap: 12, paddingLeft: indent ? 36 : 16, backgroundColor: on ? theme.alpha("primary", 0.08) : "transparent" }}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
    >
      {glyph ? (
        <View className="w-8 h-8 rounded-control items-center justify-center" style={{ backgroundColor: tint(c, 0.1) }}>
          {glyph}
        </View>
      ) : icon ? (
        <View className="w-8 h-8 rounded-control items-center justify-center" style={{ backgroundColor: color ? tint(c, 0.1) : theme.alpha("foreground", 0.06) }}>
          <Ionicons name={icon} size={16} color={c} />
        </View>
      ) : null}
      <View className="flex-1" style={{ minWidth: 0 }}>
        <Text className="text-body text-foreground" numberOfLines={1}>
          {label}
        </Text>
        {sub ? (
          <Text className="text-meta text-muted-foreground" numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {right ? (
        <Text className="text-meta text-muted-foreground" style={{ fontVariant: ["tabular-nums"] }} numberOfLines={1}>
          {right}
        </Text>
      ) : null}
      {on ? <Ionicons name="checkmark" size={18} color={theme.primary} /> : null}
    </Pressable>
  );
}
