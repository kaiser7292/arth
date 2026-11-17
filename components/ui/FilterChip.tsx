import { View } from "react-native";
import { Chip } from "./Chip";

interface FilterChipProps {
  label: string;
  active?: boolean;
  onPress: () => void;
  /** Right margin between adjacent chips in a row. */
  spacing?: "sm" | "md";
}

/**
 * A choice chip in a horizontal filter row. Kept for its existing callers; it is the shared
 * `Chip` (variant "choice") with a right margin. New code uses `Chip` and `ChipWrap`.
 */
export function FilterChip({ label, active = false, onPress, spacing = "md" }: FilterChipProps) {
  return (
    <View className={spacing === "sm" ? "mr-1.5" : "mr-2"}>
      <Chip label={label} on={active} onPress={onPress} />
    </View>
  );
}
