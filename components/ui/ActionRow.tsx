import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View } from "react-native";
import { Text } from "./Text";
import { useTheme } from "@/hooks/use-theme";
import { COMPONENTS } from "@/constants/design-tokens";

export interface ActionRowItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /** The one action this state is about (Approve, Mark paid): filled instead of tinted. */
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * Up to four equal tiles, each a tinted circle with its label under it - the most likely next
 * steps for a transaction. Anything else goes behind the last one, "More".
 */
export function ActionRow({ items, className = "" }: { items: ActionRowItem[]; className?: string }) {
  const theme = useTheme();
  const A = COMPONENTS.actionRow;
  return (
    <View className={`${A.base} ${className}`} style={{ gap: 8 }}>
      {items.slice(0, 4).map((it) => {
        const fg = it.primary ? theme.primaryForeground : it.danger ? theme.danger : theme.primary;
        const bg = it.primary ? theme.primary : it.danger ? theme.alpha("danger", 0.1) : theme.alpha("primary", 0.1);
        return (
          <Pressable
            key={it.key}
            onPress={it.onPress}
            disabled={it.disabled}
            className={A.button}
            style={{ opacity: it.disabled ? 0.5 : 1, minHeight: 72, borderColor: it.primary ? theme.primary : undefined }}
            accessibilityRole="button"
            accessibilityLabel={it.label}
            accessibilityState={{ disabled: !!it.disabled }}
          >
            <View className={A.circle} style={{ backgroundColor: bg }}>
              <Ionicons name={it.icon} size={A.icon} color={fg} />
            </View>
            <Text className={`${A.label} text-center`} numberOfLines={2}>
              {it.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
