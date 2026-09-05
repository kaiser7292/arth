import { Pressable } from "react-native";
import { Text } from "./Text";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";

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
 * Active treatment uses the accent palette (`ac(accent, colorScheme, 100, 700)`)
 * and keeps inactive chips on the subtle surface-alt background so the group
 * reads as a single control.
 */
export function FilterChip({ label, active = false, onPress, spacing = "md" }: FilterChipProps) {
  const { accent, colorScheme } = useColorScheme();
  const mr = spacing === "sm" ? "mr-1.5" : "mr-2";
  return (
    <Pressable
      onPress={onPress}
      className={`px-3 py-1.5 rounded-full ${mr} ${active ? "border" : "bg-card"}`}
      style={
        active
          ? { backgroundColor: ac(accent, colorScheme, 100, 700), borderColor: accent[500] }
          : undefined
      }
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text
        className={`text-xs ${active ? "font-medium" : "text-muted-foreground"}`}
        style={active ? { color: ac(accent, colorScheme, 500, 200) } : undefined}
      >
        {label}
      </Text>
    </Pressable>
  );
}
