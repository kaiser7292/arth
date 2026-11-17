import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View } from "react-native";
import { Text } from "./Text";
import { useTheme } from "@/hooks/use-theme";
import { COMPONENTS } from "@/constants/design-tokens";

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Colour for this option when it is on, e.g. success for "Received". Defaults to primary. */
  color?: string;
}

/** A switch between two to four options: Any / Needs review / Approved, Spent / Received / Transfer. */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  disabled = false,
  className = "",
}: {
  options: SegmentedOption<V>[];
  value: V;
  onChange: (v: V) => void;
  disabled?: boolean;
  className?: string;
}) {
  const theme = useTheme();
  const S = COMPONENTS.segmented;
  return (
    <View className={`${S.base} ${className}`} style={{ gap: 4, backgroundColor: theme.alpha("foreground", 0.06) }} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        const fg = on ? o.color ?? theme.primary : theme.mutedForeground;
        return (
          <Pressable
            key={o.value || "any"}
            onPress={() => !disabled && onChange(o.value)}
            disabled={disabled && !on}
            className={`${S.item} flex-row px-1`}
            style={{ minHeight: 38, backgroundColor: on ? theme.card : "transparent", elevation: on ? 1 : 0, opacity: disabled && !on ? 0.5 : 1 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on, disabled }}
            accessibilityLabel={o.label}
          >
            {o.icon ? <Ionicons name={o.icon} size={15} color={fg} style={{ marginRight: 5 }} /> : null}
            <Text className={`${S.label} text-center`} numberOfLines={1} style={{ color: fg }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
