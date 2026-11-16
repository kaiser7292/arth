import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import Animated from "react-native-reanimated";
import { usePressScale } from "@/components/motion/motion";
import { Text } from "./Text";

import { useTheme } from "@/hooks/use-theme";
import { COMPONENTS } from "@/constants/design-tokens";

interface FilterChipProps {
  label: string;
  active?: boolean;
  onPress: () => void;
  /** Right margin between adjacent chips in a row. */
  spacing?: "sm" | "md";
  /** An icon before the label, such as a funnel on an "all filters" chip. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** A small down arrow: tapping opens a list of choices rather than switching something on. */
  caret?: boolean;
  /** When on, an × that clears this chip on its own. */
  onClear?: () => void;
  /** A count after the label, e.g. how many filters are on. Hidden at 0. */
  count?: number;
}

/**
 * Shared chip for horizontal filter rows.
 * Used across the Accounts list, the account-ledger per-card filter, the Transactions filter row,
 * and anywhere else a single-select or toggleable filter affordance appears.
 *
 * Active treatment uses the accent palette (`theme.alpha("primary", 0.1)`)
 * and keeps inactive chips on the subtle surface-alt background so the group
 * reads as a single control.
 */
export function FilterChip({ label, active = false, onPress, spacing = "md", icon, caret, onClear, count }: FilterChipProps) {
  const theme = useTheme();
  const mr = spacing === "sm" ? "mr-1.5" : "mr-2";
  const press = usePressScale();
  const tint = active ? theme.primary : theme.mutedForeground;
  const showClear = active && !!onClear;
  // Margin on a plain outer View; the press scale on an animated layer with no className.
  return (
    <View className={mr}>
    <Animated.View style={press.style}>
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      className={`${COMPONENTS.chip.base} flex-row items-center ${active ? "border" : "bg-card"}`}
      style={
        active
          ? { backgroundColor: theme.alpha("primary", 0.1), borderColor: theme.primary }
          : undefined
      }
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {icon && <Ionicons name={icon} size={13} color={tint} style={{ marginRight: 4 }} />}
      <Text
        className={`${COMPONENTS.chip.label} ${active ? "font-medium" : "text-muted-foreground"}`}
        style={active ? { color: theme.primary } : undefined}
        numberOfLines={1}
      >
        {label}
        {count ? ` · ${count}` : ""}
      </Text>
      {showClear ? (
        <Pressable
          onPress={onClear}
          hitSlop={10}
          style={{ marginLeft: 4 }}
          accessibilityRole="button"
          accessibilityLabel={`Clear ${label}`}
        >
          <Ionicons name="close" size={13} color={tint} />
        </Pressable>
      ) : caret ? (
        <Ionicons name="chevron-down" size={12} color={tint} style={{ marginLeft: 3 }} />
      ) : null}
    </Pressable>
    </Animated.View>
    </View>
  );
}
