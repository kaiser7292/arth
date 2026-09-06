import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { Text } from "./Text";
import { useTheme } from "@/hooks/use-theme";
import { withAlpha } from "@/constants/brand";

export interface IconRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  /** Defaults to the brand colour. Pass a role (theme.danger, theme.success) for meaning. */
  tint?: string;
  /** Colour for the title. Defaults to the normal foreground. */
  titleColor?: string;
  /** Rendered at the trailing edge - a value, a badge, an inline button. */
  right?: React.ReactNode;
  /** Show a chevron at the trailing edge. Ignored when `right` is given. */
  chevron?: boolean;
  onPress?: () => void;
  /** Layout only - margins and the row's own background. */
  className?: string;
  accessibilityLabel?: string;
}

/**
 * Icon in a tinted circle, a title, an optional second line, and something at the end.
 *
 * This shape was hand-written 52 times across 28 files - 21 of them in expense detail alone -
 * which is why its circle sizes, gaps and text sizes had drifted apart. Extracted while splitting
 * that screen up, because half of what made the file long was this row repeated with small
 * variations.
 *
 * Renders a Pressable only when there is an onPress, so a static row is not falsely tappable.
 */
export function IconRow({
  icon,
  title,
  subtitle,
  tint,
  titleColor,
  right,
  chevron = false,
  onPress,
  className = "",
  accessibilityLabel,
}: IconRowProps) {
  const theme = useTheme();
  const color = tint ?? theme.primary;

  const body = (
    <>
      <View
        className="w-10 h-10 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: withAlpha(color, 0.1) }}
      >
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold" style={titleColor ? { color: titleColor } : undefined}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-xs text-muted-foreground mt-0.5">{subtitle}</Text>
        ) : null}
      </View>
      {right ?? (chevron ? (
        <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
      ) : null)}
    </>
  );

  const layout = `flex-row items-center py-3 px-4 rounded-xl ${className}`;

  if (!onPress) {
    return <View className={layout}>{body}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      className={layout}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
    >
      {body}
    </Pressable>
  );
}
