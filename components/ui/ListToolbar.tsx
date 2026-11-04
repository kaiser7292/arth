import { useState, type ReactNode } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/hooks/use-theme";
import { SelectSheet, type SelectOption } from "./SelectSheet";
import { Text } from "./Text";

export interface ToolbarChip {
  key: string;
  label: string;
  onRemove: () => void;
}

export interface ToolbarChoice<K extends string> {
  value: K;
  defaultValue: K;
  options: SelectOption<K>[];
  onChange: (value: K) => void;
}

export interface ListToolbarProps<S extends string = string, G extends string = string> {
  search?: {
    value: string;
    onChangeText: (text: string) => void;
    /** Clears differently from typing, when the screen needs it to. */
    onClear?: () => void;
    placeholder?: string;
    /** Extra buttons inside the field, such as voice search. */
    accessory?: ReactNode;
    input?: TextInputProps;
  };
  /** A list that picks its own dates: this opens that screen's date sheet. */
  dates?: { onPress: () => void; active: boolean };
  filter?: { onPress: () => void; activeCount: number };
  sort?: ToolbarChoice<S>;
  group?: ToolbarChoice<G>;
  /** What's on, each with its own ×. A changed sort and group are added to these. */
  chips?: ToolbarChip[];
  onClearAll?: () => void;
  /** One more action at the end of the status line, such as "Save view". */
  action?: { label: string; onPress: () => void };
  /** False when the list's container already has side padding. */
  inset?: boolean;
}

function ToolButton({ icon, activeIcon, label, active, onPress }: {
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon?: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="items-center justify-center rounded-xl border"
      style={{
        width: 40,
        height: 40,
        borderColor: active ? theme.primary : theme.alpha("foreground", 0.15),
        backgroundColor: active ? theme.alpha("primary", 0.1) : "transparent",
      }}
      accessibilityRole="button"
      accessibilityLabel={active ? `${label}, on` : label}
    >
      <Ionicons name={active ? (activeIcon ?? icon) : icon} size={18} color={active ? theme.primary : theme.mutedForeground} />
      {active && (
        <View className="absolute rounded-full" style={{ top: 5, right: 5, width: 6, height: 6, backgroundColor: theme.primary }} />
      )}
    </Pressable>
  );
}

/**
 * The same four tools in the same place on every list: search, filter, sort, group by, then a line
 * saying what's on. A tool a list has no use for is left out and the rest keep their order.
 */
export function ListToolbar<S extends string = string, G extends string = string>({
  search,
  dates,
  filter,
  sort,
  group,
  chips = [],
  onClearAll,
  action,
  inset = true,
}: ListToolbarProps<S, G>) {
  const theme = useTheme();
  const [sheet, setSheet] = useState<"sort" | "group" | null>(null);

  const sortOn = !!sort && sort.value !== sort.defaultValue;
  const groupOn = !!group && group.value !== group.defaultValue;
  const nameOf = <K extends string>(choice: ToolbarChoice<K>) => choice.options.find((o) => o.value === choice.value)?.label ?? "";
  const all: ToolbarChip[] = [
    ...chips,
    ...(sortOn ? [{ key: "__sort", label: `Sorted: ${nameOf(sort!)}`, onRemove: () => sort!.onChange(sort!.defaultValue) }] : []),
    ...(groupOn ? [{ key: "__group", label: `Grouped: ${nameOf(group!)}`, onRemove: () => group!.onChange(group!.defaultValue) }] : []),
  ];

  const clearAll = () => {
    onClearAll?.();
    if (sortOn) sort!.onChange(sort!.defaultValue);
    if (groupOn) group!.onChange(group!.defaultValue);
  };

  return (
    <View className={`pt-2 pb-1 ${inset ? "px-4" : ""}`}>
      <View className="flex-row items-center" style={{ gap: 6 }}>
        {search ? (
          <View
            className="flex-1 flex-row items-center rounded-xl border px-3"
            style={{ height: 40, minWidth: 0, borderColor: theme.alpha("foreground", 0.15) }}
          >
            <Ionicons name="search-outline" size={16} color={theme.mutedForeground} />
            <TextInput
              value={search.value}
              onChangeText={search.onChangeText}
              placeholder={search.placeholder ?? "Search"}
              placeholderTextColor={theme.mutedForeground}
              className="flex-1 text-sm text-foreground ml-2"
              style={{ paddingVertical: 0 }}
              maxLength={100}
              numberOfLines={1}
              accessibilityLabel="Search"
              {...search.input}
            />
            {search.value !== "" && (
              <Pressable
                onPress={() => (search.onClear ? search.onClear() : search.onChangeText(""))}
                hitSlop={8}
                className="ml-1"
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={16} color={theme.mutedForeground} />
              </Pressable>
            )}
            {search.accessory}
          </View>
        ) : (
          <View className="flex-1" />
        )}
        {dates && <ToolButton icon="calendar-outline" label="Dates" active={dates.active} onPress={dates.onPress} />}
        {filter && (
          <ToolButton icon="funnel-outline" activeIcon="funnel" label="Filter" active={filter.activeCount > 0} onPress={filter.onPress} />
        )}
        {sort && <ToolButton icon="swap-vertical-outline" label="Sort" active={sortOn} onPress={() => setSheet("sort")} />}
        {group && <ToolButton icon="layers-outline" label="Group by" active={groupOn} onPress={() => setSheet("group")} />}
      </View>

      {(all.length > 0 || action) && (
        <View className="flex-row flex-wrap items-center pt-2">
          {all.map((chip) => (
            <Pressable
              key={chip.key}
              onPress={chip.onRemove}
              hitSlop={4}
              className="flex-row items-center mr-3 mb-1"
              accessibilityRole="button"
              accessibilityLabel={`Remove ${chip.label}`}
            >
              <Text className="text-xs text-muted-foreground">{chip.label}</Text>
              <Ionicons name="close" size={12} color={theme.mutedForeground} style={{ marginLeft: 2 }} />
            </Pressable>
          ))}
          {all.length > 0 && (
            <Pressable onPress={clearAll} hitSlop={8} className="mr-3 mb-1" accessibilityRole="button">
              <Text className="text-xs font-semibold" style={{ color: theme.primary }}>Clear all</Text>
            </Pressable>
          )}
          {action && (
            <Pressable onPress={action.onPress} hitSlop={8} className="mb-1" accessibilityRole="button">
              <Text className="text-xs font-semibold" style={{ color: theme.primary }}>{action.label}</Text>
            </Pressable>
          )}
        </View>
      )}

      {sort && (
        <SelectSheet<S>
          visible={sheet === "sort"}
          title="Sort by"
          options={sort.options}
          value={sort.value}
          onChange={sort.onChange}
          onClose={() => setSheet(null)}
        />
      )}
      {group && (
        <SelectSheet<G>
          visible={sheet === "group"}
          title="Group by"
          options={group.options}
          value={group.value}
          onChange={group.onChange}
          onClose={() => setSheet(null)}
        />
      )}
    </View>
  );
}

/** At the end of a list that hit the most we load at once. */
export function ListCapNote({ limit }: { limit: number }) {
  return (
    <Text className="text-xs text-muted-foreground text-center px-6 py-4">
      Showing the first {limit.toLocaleString("en-IN")}. Narrow the dates or filters to see the rest.
    </Text>
  );
}

/** A list that couldn't load: not the same as having nothing in it. */
export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const theme = useTheme();
  return (
    <View className="items-center px-8 py-12">
      <Ionicons name="alert-circle-outline" size={40} color={theme.mutedForeground} />
      <Text className="text-base font-medium text-foreground mt-3">Couldn&apos;t load this</Text>
      <Text className="text-sm text-muted-foreground text-center mt-1">Your data is safe. This is a problem showing it.</Text>
      <Pressable onPress={onRetry} hitSlop={8} className="mt-3" accessibilityRole="button">
        <Text className="text-sm font-semibold" style={{ color: theme.primary }}>Try again</Text>
      </Pressable>
    </View>
  );
}

/** At the top of a screen that couldn't load everything, above whatever it could. */
export function LoadFailedBanner({ onRetry }: { onRetry?: () => void }) {
  const theme = useTheme();
  return (
    <View className="flex-row items-center mx-4 mt-3 mb-1 px-3 py-2.5 rounded-lg" style={{ backgroundColor: theme.alpha("warning", 0.12) }} accessibilityRole="alert">
      <Ionicons name="alert-circle-outline" size={16} color={theme.warning} />
      <Text className="flex-1 text-xs text-foreground ml-2">
        Couldn&apos;t load everything here, so this may be incomplete. Your data is safe.
      </Text>
      {onRetry && (
        <Pressable onPress={onRetry} hitSlop={8} className="ml-3" accessibilityRole="button">
          <Text className="text-xs font-semibold" style={{ color: theme.primary }}>Try again</Text>
        </Pressable>
      )}
    </View>
  );
}
