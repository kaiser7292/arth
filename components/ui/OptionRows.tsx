import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Text } from "./Text";
import { useTheme } from "@/hooks/use-theme";
import { COMPONENTS } from "@/constants/design-tokens";

const R = COMPONENTS.optionRow;

interface OptionRowProps {
  label: string;
  /** Second line, e.g. an account's last digits. */
  sub?: string;
  on: boolean;
  onPress: () => void;
  /** A colour dot before the label (categories, tags). */
  color?: string;
  /** Anything on the right: a count, a star, a delete button. */
  trailing?: ReactNode;
}

/** One choice of several. 44px tall, so it is a full tap target. */
export function RadioRow({ label, sub, on, onPress, color, trailing }: OptionRowProps) {
  const theme = useTheme();
  return (
    <View className="flex-row items-center">
      <Pressable
        onPress={onPress}
        className={`flex-1 ${R.base}`}
        style={{ minHeight: R.minHeight, gap: 12 }}
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        accessibilityLabel={sub ? `${label}, ${sub}` : label}
      >
        <View
          className="items-center justify-center rounded-pill"
          style={{ width: R.mark, height: R.mark, borderWidth: 2, borderColor: on ? theme.primary : theme.alpha("foreground", 0.3) }}
        >
          {on && <View className="rounded-pill" style={{ width: R.mark / 2, height: R.mark / 2, backgroundColor: theme.primary }} />}
        </View>
        <Label label={label} sub={sub} color={color} on={on} />
      </Pressable>
      {trailing}
    </View>
  );
}

/** One of several that can all be on. */
export function CheckRow({ label, sub, on, onPress, color, trailing }: OptionRowProps) {
  const theme = useTheme();
  return (
    <View className="flex-row items-center">
      <Pressable
        onPress={onPress}
        className={`flex-1 ${R.base}`}
        style={{ minHeight: R.minHeight, gap: 12 }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        accessibilityLabel={sub ? `${label}, ${sub}` : label}
      >
        <View
          className="items-center justify-center rounded-[6px]"
          style={{
            width: R.mark,
            height: R.mark,
            backgroundColor: on ? theme.primary : "transparent",
            borderWidth: on ? 0 : 2,
            borderColor: theme.alpha("foreground", 0.3),
          }}
        >
          {on && <Ionicons name="checkmark" size={14} color={theme.primaryForeground} />}
        </View>
        <Label label={label} sub={sub} color={color} on={on} />
      </Pressable>
      {trailing}
    </View>
  );
}

function Label({ label, sub, color, on }: { label: string; sub?: string; color?: string; on: boolean }) {
  return (
    <>
      {color ? <View className="rounded-pill" style={{ width: 8, height: 8, marginLeft: -4, backgroundColor: color }} /> : null}
      <View className="flex-1">
        <Text className={`${R.label} ${on ? "font-semibold" : ""}`} numberOfLines={1}>
          {label}
        </Text>
        {sub ? <Text className={`${R.sub} mt-0.5`} numberOfLines={1}>{sub}</Text> : null}
      </View>
    </>
  );
}
