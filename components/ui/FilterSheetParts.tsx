import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import { Text } from "./Text";
import { Button } from "./Button";
import { useTheme } from "@/hooks/use-theme";
import { COMPONENTS } from "@/constants/design-tokens";

/**
 * The frame both filter sheets share (the Transactions sheet and every other list's): header with
 * Clear all and close, the left-hand icon rail, and the Cancel / Apply footer. Each sheet keeps its
 * own body; these make them look and read the same.
 */

export function FilterSheetHeader({
  title = "Filters",
  onClear,
  clearDisabled,
  onClose,
}: {
  title?: string;
  onClear: () => void;
  clearDisabled: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  return (
    <View className="flex-row items-center pl-5 pr-3 pb-2 border-b border-border" style={{ minHeight: 52 }}>
      <Text className="flex-1 text-title font-bold text-foreground" accessibilityRole="header">
        {title}
      </Text>
      <Pressable
        onPress={onClear}
        disabled={clearDisabled}
        hitSlop={6}
        className="px-3 justify-center"
        style={{ minHeight: 44 }}
        accessibilityRole="button"
        accessibilityState={{ disabled: clearDisabled }}
      >
        <Text className="text-body font-semibold" style={{ color: clearDisabled ? theme.mutedForeground : theme.primary }}>
          Clear all
        </Text>
      </Pressable>
      <Pressable
        onPress={onClose}
        className="items-center justify-center rounded-pill ml-1"
        style={{ width: 40, height: 40, backgroundColor: theme.alpha("foreground", 0.06) }}
        accessibilityRole="button"
        accessibilityLabel="Close filters"
      >
        <Ionicons name="close" size={18} color={theme.foreground} />
      </Pressable>
    </View>
  );
}

/** One item in the rail: icon in a pill, a count badge, and a label that may take two lines. */
export function FilterRailItem({
  label,
  title,
  icon,
  count,
  on,
  onPress,
  onLayout,
}: {
  label: string;
  /** The section's full title, read out instead of the short label. */
  title?: string;
  icon: keyof typeof Ionicons.glyphMap;
  count: number;
  on: boolean;
  onPress: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const theme = useTheme();
  const R = COMPONENTS.rail;
  const name = title ?? label;
  return (
    <Pressable
      onPress={onPress}
      onLayout={onLayout}
      className={R.item}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={count > 0 ? `${name}, ${count} on` : name}
    >
      <View className={R.pill} style={{ backgroundColor: on ? theme.alpha("primary", 0.12) : "transparent" }}>
        <Ionicons name={icon} size={R.icon} color={on ? theme.primary : theme.mutedForeground} />
        {count > 0 && (
          <View className={R.badge} style={{ backgroundColor: theme.primary, borderWidth: 2, borderColor: theme.card }}>
            <Text className="text-label font-bold" style={{ color: theme.primaryForeground, lineHeight: 14 }}>
              {count}
            </Text>
          </View>
        )}
      </View>
      <Text
        className={`${R.label} ${on ? "font-bold" : "font-medium"}`}
        numberOfLines={2}
        style={{ color: on ? theme.foreground : theme.mutedForeground }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Cancel + Apply. The Apply label says what will happen: "Show 24 transactions". */
export function FilterSheetFooter({
  onCancel,
  onApply,
  applyLabel,
  disabled,
  note,
}: {
  onCancel: () => void;
  onApply: () => void;
  applyLabel: string;
  disabled?: boolean;
  /** A line above the buttons, e.g. why Apply is off. */
  note?: string | null;
}) {
  return (
    <View className="px-4 pt-3 border-t border-border">
      {note ? <Text className="text-meta text-danger mb-2">{note}</Text> : null}
      <View className="flex-row" style={{ gap: 10 }}>
        <Button title="Cancel" variant="outline" onPress={onCancel} />
        <Button title={applyLabel} onPress={onApply} disabled={disabled} className="flex-1" />
      </View>
    </View>
  );
}

/** "Show 24 transactions" from a count; "Show all transactions" when nothing is on; "Apply" while unknown. */
export function applyLabelFor(count: number | null, active: number, noun: { one: string; many: string } = { one: "transaction", many: "transactions" }): string {
  if (count == null) return active === 0 ? `Show all ${noun.many}` : "Apply";
  if (count === 0) return `No ${noun.many} match`;
  return `Show ${count.toLocaleString("en-IN")} ${count === 1 ? noun.one : noun.many}`;
}

/** A sensible rail icon for a list field, from its key or label. */
export function iconForFilter(key: string, label = ""): keyof typeof Ionicons.glyphMap {
  const k = `${key} ${label}`.toLowerCase();
  if (/date|month|when|period/.test(k)) return "calendar-outline";
  if (/sort/.test(k)) return "swap-vertical-outline";
  if (/group/.test(k)) return "layers-outline";
  if (/categor/.test(k)) return "grid-outline";
  if (/merchant|payer|shop/.test(k)) return "storefront-outline";
  if (/account|bank|card|wallet/.test(k)) return "business-outline";
  if (/mode|paid/.test(k)) return "card-outline";
  if (/tag/.test(k)) return "pricetag-outline";
  if (/status|state|review/.test(k)) return "checkmark-circle-outline";
  if (/person|people|member|who/.test(k)) return "people-outline";
  if (/amount|value|price/.test(k)) return "cash-outline";
  if (/rule/.test(k)) return "flash-outline";
  if (/action|change|event/.test(k)) return "pulse-outline";
  if (/kind|type|nature/.test(k)) return "shapes-outline";
  if (/view|saved/.test(k)) return "bookmark-outline";
  return "funnel-outline";
}
