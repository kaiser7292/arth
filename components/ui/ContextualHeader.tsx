import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";

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
  titleSuffix?: string;
  subtitle?: string;
  badge?: ContextualHeaderBadge;
  rightActions?: ContextualHeaderAction[];
}

export function ContextualHeader({ title, titleSuffix, subtitle, badge, rightActions }: Props) {
  const { colorScheme, colors } = useColorScheme();

  const badgeColors = badge
    ? {
        warning: { bg: StatusColors[colorScheme].warning + "1A", text: StatusColors[colorScheme].warning },
        success: { bg: StatusColors[colorScheme].success + "1A", text: StatusColors[colorScheme].success },
        danger:  { bg: StatusColors[colorScheme].danger  + "1A", text: StatusColors[colorScheme].danger  },
      }[badge.variant]
    : null;

  return (
    <View
      className="flex-row items-center px-4 pt-3 pb-3 border-b border-border-light dark:border-border-dark"
      style={{ minHeight: 52 }}
    >
      {/* Left: title + optional subtitle */}
      <View className="flex-1">
        <View className="flex-row items-baseline gap-x-2">
          <Text
            className="text-base font-semibold text-text-primary dark:text-text-dark-primary"
            numberOfLines={1}
          >
            {title}
          </Text>
          {titleSuffix ? (
            <Text
              className="text-sm text-text-secondary dark:text-text-dark-secondary"
              numberOfLines={1}
            >
              {titleSuffix}
            </Text>
          ) : null}
        </View>
        {subtitle ? (
          <Text
            className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5"
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
