import { Ionicons } from "@expo/vector-icons";
import { Text } from "./Text";
import { Pressable, View } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { useTheme } from "@/hooks/use-theme";

export interface ContextualHeaderAction {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
}

export interface ContextualHeaderBadge {
  label: string;
  variant: "warning" | "success" | "danger";
  onPress?: () => void;
}

interface Props {
  title: string;
  subtitle?: string;
  badge?: ContextualHeaderBadge;
  rightActions?: ContextualHeaderAction[];
}

export function ContextualHeader({ title, subtitle, badge, rightActions }: Props) {
  const { colors } = useColorScheme();
  const theme = useTheme();

  const badgeColors = badge
    ? {
        warning: { bg: theme.warning + "1A", text: theme.warning },
        success: { bg: theme.success + "1A", text: theme.success },
        danger:  { bg: theme.danger  + "1A", text: theme.danger  },
      }[badge.variant]
    : null;

  return (
    <View
      className="flex-row items-center px-4 pt-3 pb-3 border-b border-border"
      style={{ minHeight: 52 }}
    >
      {/* Left: title + optional subtitle */}
      <View className="flex-1">
        <Text
          className="text-base font-semibold text-foreground"
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            className="text-xs text-muted-foreground mt-0.5"
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      {/* Right: badge + action icons */}
      <View className="flex-row items-center gap-x-3 ml-3">
        {badge && badgeColors ? (
          <Pressable
            onPress={badge.onPress}
            disabled={!badge.onPress}
            accessibilityRole={badge.onPress ? "button" : "text"}
            accessibilityLabel={badge.label}
            className="rounded-full px-2.5 py-1"
            style={{ backgroundColor: badgeColors.bg }}
          >
            <Text className="text-xs font-semibold" style={{ color: badgeColors.text }}>
              {badge.label}
            </Text>
          </Pressable>
        ) : null}

        {rightActions?.map((action, i) => (
          <Pressable
            key={i}
            onPress={action.onPress}
            disabled={action.disabled}
            hitSlop={8}
            accessibilityRole="button"
            style={{ opacity: action.disabled ? 0.4 : 1 }}
          >
            <Ionicons
              name={action.icon}
              size={20}
              color={action.color ?? colors.textSecondary}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
