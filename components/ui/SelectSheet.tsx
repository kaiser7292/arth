import Ionicons from "@expo/vector-icons/Ionicons";
import { Pop } from "@/components/motion/Pop";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { Sheet } from "./Sheet";
import { Text } from "./Text";
import { useTheme } from "@/hooks/use-theme";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Optional second line, for choices that need a word of explanation. */
  description?: string;
}

interface SelectSheetProps<T extends string> {
  visible: boolean;
  title: string;
  options: SelectOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  onClose: () => void;
  /**
   * Keep the sheet open after a choice. Off by default: picking one of a set of
   * mutually exclusive options is the end of the interaction.
   */
  keepOpenOnSelect?: boolean;
  /** Show a search box. On by default once there are more options than fit comfortably. */
  searchable?: boolean;
}

/** More options than this and the list gets a search box. */
const SEARCH_FROM = 8;

/**
 * Single-choice picker in a bottom sheet.
 *
 * This is the `Select` the design plan asked for, and it arrived by deletion rather than
 * invention: three screens - budget transactions, a budget category drill-down and the insights
 * filtered list - each carried a byte-identical "Sort by" sheet AND a byte-identical options
 * array. Extracting the shape they already shared is what makes it a primitive; building one
 * speculatively is how the codebase ended up with ConfirmSheet and TimePickerModal, both of which
 * had zero call sites and have now been deleted.
 *
 * Options are data, so anything single-choice can use it, not just sorting.
 */
export function SelectSheet<T extends string>({
  visible,
  title,
  options,
  value,
  onChange,
  onClose,
  keepOpenOnSelect = false,
  searchable,
}: SelectSheetProps<T>) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!visible) setQuery("");
  }, [visible]);
  const withSearch = searchable ?? options.length > SEARCH_FROM;
  const q = query.trim().toLowerCase();
  const shown = q
    ? options.filter((o) =>
        `${o.label} ${o.description ?? ""}`.toLowerCase().includes(q),
      )
    : options;

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
          style={{
            borderColor: theme.alpha("foreground", 0.15),
            minHeight: 42,
          }}
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
            <Pressable
              onPress={() => setQuery("")}
              hitSlop={8}
              accessibilityLabel="Clear search"
            >
              <Ionicons
                name="close-circle"
                size={16}
                color={theme.mutedForeground}
              />
            </Pressable>
          ) : null}
        </View>
      )}

      {/* Scrolls once the list is taller than the sheet; shrinks to fit when it isn't. */}
      <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
        {shown.length === 0 && (
          <Text className="text-sm text-muted-foreground px-5 py-4">
            Nothing matches &quot;{query.trim()}&quot;.
          </Text>
        )}
        {shown.map((opt) => {
          const active = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => {
                onChange(opt.value);
                if (!keepOpenOnSelect) onClose();
              }}
              className="flex-row items-center px-5 py-3.5"
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
            >
              {opt.icon ? (
                <Ionicons
                  name={opt.icon}
                  size={18}
                  color={active ? theme.primary : theme.mutedForeground}
                />
              ) : null}
              <View className={opt.icon ? "flex-1 ml-3" : "flex-1"}>
                <Text
                  className="text-body"
                  style={{
                    color: active ? theme.primary : theme.foreground,
                    fontWeight: active ? "600" : "400",
                  }}
                >
                  {opt.label}
                </Text>
                {opt.description ? (
                  <Text className="text-meta text-muted-foreground mt-0.5">
                    {opt.description}
                  </Text>
                ) : null}
              </View>
              {active && (
                <Pop>
                  <Ionicons name="checkmark" size={18} color={theme.primary} />
                </Pop>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}
