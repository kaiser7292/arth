import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { usePressScale } from "@/components/motion/motion";
import { Text } from "./Text";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { useTheme } from "@/hooks/use-theme";
import { COMPONENTS } from "@/constants/design-tokens";

interface FilterChipProps {
  label: string;
  active?: boolean;
  onPress: () => void;
  /** Right margin between adjacent chips in a row. */
  spacing?: "sm" | "md";
}

/**
 * Shared chip for horizontal filter rows.
 * Used across the Accounts list, the account-ledger per-card filter, and
 * anywhere else a single-select or toggleable filter affordance appears.
 *
 * Active treatment uses the accent palette (`theme.alpha("primary", 0.1)`)
 * and keeps inactive chips on the subtle surface-alt background so the group
 * reads as a single control.
 */
export function FilterChip({ label, active = false, onPress, spacing = "md" }: FilterChipProps) {
  const theme = useTheme();
  const mr = spacing === "sm" ? "mr-1.5" : "mr-2";
  const press = usePressScale();
  // Margin on a plain outer View; the press scale on an animated layer with no className.
  return (
    <View className={mr}>
    <Animated.View style={press.style}>
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      className={`${COMPONENTS.chip.base} ${active ? "border" : "bg-card"}`}
      style={
        active
          ? { backgroundColor: theme.alpha("primary", 0.1), borderColor: theme.primary }
          : undefined
      }
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text
        className={`${COMPONENTS.chip.label} ${active ? "font-medium" : "text-muted-foreground"}`}
        style={active ? { color: theme.primary } : undefined}
      >
        {label}
      </Text>
    </Pressable>
    </Animated.View>
    </View>
  );
}
