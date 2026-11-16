import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { Sheet } from "./Sheet";
import { Text } from "./Text";
import { useTheme } from "@/hooks/use-theme";

export interface MultiSelectOption {
  value: string;
  label: string;
  /** A colour dot before the label, e.g. a tag's colour. */
  color?: string;
}

interface MultiSelectSheetProps {
  visible: boolean;
  title: string;
  options: MultiSelectOption[];
  selected: string[];
  /** Called with the new choice when Done is tapped. Closing any other way changes nothing. */
  onApply: (values: string[]) => void;
  onClose: () => void;
  searchable?: boolean;
}

/** More options than this and the list gets a search box. */
const SEARCH_FROM = 8;

/**
 * Pick several from a list, in a bottom sheet: the multi-choice sibling of SelectSheet. Ticks are
 * kept in the sheet until Done, so swiping it away is a cancel.
 */
export function MultiSelectSheet({ visible, title, options, selected, onApply, onClose, searchable }: MultiSelectSheetProps) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));
  useEffect(() => {
    if (visible) {
      setPicked(new Set(selected));
      setQuery("");
    }
    // Only on opening: while open the sheet owns the ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const withSearch = searchable ?? options.length > SEARCH_FROM;
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  const toggle = (value: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });

  const done = () => {
    // In the options' own order, so the same choice always reads the same.
    onApply(options.map((o) => o.value).filter((v) => picked.has(v)));
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="flex-row items-center justify-between px-5 pb-3">
        <Text className="text-heading font-bold text-foreground">{title}</Text>
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
          <Ionicons name="close" size={20} color={theme.mutedForeground} />
        </Pressable>
      </View>

      {withSearch && (
        <View
          className="flex-row items-center rounded-xl border mx-5 mb-2 px-3"
          style={{ borderColor: theme.alpha("foreground", 0.15), minHeight: 42 }}
        >
          <Ionicons name="search" size={16} color={theme.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={theme.mutedForeground}
            className="flex-1 text-sm text-foreground ml-2 py-2"
            autoCorrect={false}
            accessibilityLabel={`Search ${title}`}
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={16} color={theme.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
      )}

      <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
        {shown.length === 0 && (
          <Text className="text-sm text-muted-foreground px-5 py-4">
            {options.length === 0 ? "Nothing to pick from yet." : `Nothing matches "${query.trim()}".`}
          </Text>
        )}
        {shown.map((opt) => {
          const on = picked.has(opt.value);
          return (
            <Pressable
              key={opt.value}
              onPress={() => toggle(opt.value)}
              className="flex-row items-center px-5 py-3"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
            >
              <View
                className="w-5 h-5 rounded items-center justify-center mr-3"
                style={{
                  backgroundColor: on ? theme.primary : "transparent",
                  borderWidth: on ? 0 : 1.5,
                  borderColor: theme.alpha("foreground", 0.3),
                }}
              >
                {on && <Ionicons name="checkmark" size={13} color={theme.primaryForeground} />}
              </View>
              {opt.color ? (
                <View className="w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: opt.color }} />
              ) : null}
              <Text className="flex-1 text-body text-foreground" numberOfLines={1}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View className="flex-row items-center px-5 pt-3 pb-2 border-t border-border" style={{ gap: 12 }}>
        <Pressable
          onPress={() => setPicked(new Set())}
          hitSlop={8}
          className="py-2.5"
          accessibilityRole="button"
          disabled={picked.size === 0}
        >
          <Text className="text-sm font-semibold" style={{ color: picked.size === 0 ? theme.mutedForeground : theme.primary }}>
            Clear
          </Text>
        </Pressable>
        <Pressable
          onPress={done}
          className="flex-1 items-center rounded-xl py-2.5"
          style={{ backgroundColor: theme.primary }}
          accessibilityRole="button"
        >
          <Text className="text-sm font-semibold text-primary-foreground">
            {picked.size > 0 ? `Show ${picked.size} selected` : "Show all"}
          </Text>
        </Pressable>
      </View>
    </Sheet>
  );
}
