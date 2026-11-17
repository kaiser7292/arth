import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Text } from "./Text";
import { useTheme } from "@/hooks/use-theme";
import { COMPONENTS } from "@/constants/design-tokens";

/**
 * Label on the left, value on the right, inside a card. Tappable when it opens something (an
 * account, a rule, a picker): then it gets a chevron.
 */
export function FieldRow({
  label,
  value,
  children,
  onPress,
  valueColor,
  divider = true,
  multiline = false,
  accessibilityLabel,
}: {
  label: string;
  /** Plain text value. Use `children` for anything richer (a chip, a toggle). */
  value?: string | null;
  children?: ReactNode;
  onPress?: () => void;
  valueColor?: string;
  /** A hairline above the row. Off for the first row of a card. */
  divider?: boolean;
  /** Long text (a note, an SMS) goes under the label instead of beside it. */
  multiline?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const F = COMPONENTS.fieldRow;
  const content = (
    <>
      <Text className={`${F.label} ${multiline ? "mb-1" : "mr-3"}`}>{label}</Text>
      <View className={multiline ? "" : "flex-1 flex-row items-center justify-end"}>
        {value != null && value !== "" ? (
          <Text
            className={`${F.value} ${multiline ? "" : "text-right flex-shrink"}`}
            style={valueColor ? { color: valueColor } : undefined}
            numberOfLines={multiline ? undefined : 2}
            selectable={multiline}
          >
            {value}
          </Text>
        ) : null}
        {children}
        {onPress && !multiline ? <Ionicons name="chevron-forward" size={16} color={theme.faintForeground} style={{ marginLeft: 4 }} /> : null}
      </View>
    </>
  );
  const cls = `${multiline ? "py-3" : F.base} ${divider ? "border-t border-border" : ""}`;
  if (!onPress) {
    return (
      <View className={cls} style={{ minHeight: 48 }} accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      className={cls}
      style={{ minHeight: 48 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (value ? `${label}, ${value}` : label)}
    >
      {content}
    </Pressable>
  );
}
