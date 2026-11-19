import type React from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "./Text";
import { useTheme } from "@/hooks/use-theme";
import { tint } from "@/constants/brand";
import { PickerSheet } from "@/components/expense/PickerSheet";

export interface ChoiceOption<V extends string> {
  value: V;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** A drawn icon (account types), used instead of `icon`, with its own colour. */
  glyph?: (size: number) => React.ReactNode;
  color?: string;
  sub?: string;
}

/**
 * A single choice from more than a handful of options (owner, Nov 2026: "this is just a single
 * selection, should be similar to how we set category in a transaction"): one field showing the
 * current choice with its icon and "Change"; tapping opens the searchable sheet with a tick on the
 * current one, and picking closes it. Two to four options stay a Segmented switch.
 */
export function ChoiceField<V extends string>({
  label,
  value,
  options,
  onChange,
  title,
  placeholder = "Choose",
  searchPlaceholder,
  color,
  disabled = false,
  className = "",
}: {
  label: string;
  value: V | null;
  options: ChoiceOption<V>[];
  onChange: (v: V) => void;
  /** The sheet's title. Defaults to the label. */
  title?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  /** The icon square's colour (hex). Defaults to the brand teal. */
  color?: string;
  disabled?: boolean;
  className?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? null;
  const c = color ?? theme.primary;
  return (
    <View className={className}>
      <Text className="text-label font-semibold text-muted-foreground mb-1.5">{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        className="flex-row items-center rounded-control border border-border bg-card px-3"
        style={{ minHeight: 52, gap: 12, opacity: disabled ? 0.5 : 1 }}
        accessibilityRole="button"
        accessibilityLabel={`${label}${current ? `, ${current.label}` : ""}. Change`}
      >
        <View className="w-8 h-8 rounded-control items-center justify-center" style={{ backgroundColor: tint(current?.color ?? c, 0.1) }}>
          {current?.glyph ? current.glyph(17) : <Ionicons name={current?.icon ?? "ellipse-outline"} size={17} color={current?.color ?? c} />}
        </View>
        <Text className={`flex-1 text-body ${current ? "font-semibold text-foreground" : "text-faint-foreground"}`} numberOfLines={1}>
          {current ? current.label : placeholder}
        </Text>
        {!disabled && (
          <Text className="text-meta font-semibold" style={{ color: theme.primary }}>
            Change
          </Text>
        )}
      </Pressable>
      <PickerSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={title ?? label}
        sections={[{ key: "all", items: options.map((o) => ({ id: o.value, label: o.label, sub: o.sub, icon: o.icon, glyph: o.glyph?.(16), color: o.color ?? c })) }]}
        selectedId={value}
        onSelect={(id) => {
          setOpen(false);
          if (id) onChange(id as V);
        }}
        searchPlaceholder={searchPlaceholder ?? `Search ${label.toLowerCase()}`}
        noun={{ one: "option", many: "options" }}
      />
    </View>
  );
}
