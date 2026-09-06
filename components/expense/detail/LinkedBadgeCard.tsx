import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

interface Action {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}

interface LinkedBadgeCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  /** Defaults to the brand colour. */
  tint?: string;
  /** The filled button - "View bucket", "View loan", "View ledger". */
  primary?: Action;
  /** The outlined one, almost always "Unlink". */
  secondary?: Action;
}

/**
 * "This expense is linked to X", with the two things you can do about it.
 *
 * Expense detail carried four of these - investment bucket, loan, hisaab settlement, refund -
 * written out separately and drifting: the same card appeared with three different tint alphas
 * and two different button paddings. They are one component now.
 *
 * Split out of app/expense/[id].tsx as part of breaking up a 3,362-line screen.
 */
export function LinkedBadgeCard({
  icon,
  title,
  subtitle,
  tint,
  primary,
  secondary,
}: LinkedBadgeCardProps) {
  const theme = useTheme();
  const color = tint ?? theme.primary;

  return (
    <View
      className="mx-4 mt-3 p-3 rounded-xl"
      style={{ backgroundColor: theme.alpha("primary", 0.1) }}
    >
      <View className="flex-row items-center">
        <View
          className="w-10 h-10 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: theme.alpha("primary", 0.1) }}
        >
          <Ionicons name={icon} size={20} color={color} />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-semibold text-foreground">{title}</Text>
          <Text className="text-xs text-muted-foreground mt-0.5">{subtitle}</Text>
        </View>
      </View>

      {(primary || secondary) && (
        <View className="flex-row mt-3" style={{ gap: 8 }}>
          {primary && (
            <Pressable
              onPress={primary.onPress}
              className="flex-1 py-2 rounded-lg items-center"
              style={{ backgroundColor: theme.primary }}
              accessibilityRole="button"
              accessibilityLabel={primary.accessibilityLabel ?? primary.label}
            >
              <Text className="text-sm font-semibold text-primary-foreground">
                {primary.label}
              </Text>
            </Pressable>
          )}
          {secondary && (
            <Pressable
              onPress={secondary.onPress}
              className="flex-1 py-2 rounded-lg items-center bg-card"
              style={{ borderWidth: 1, borderColor: theme.border }}
              accessibilityRole="button"
              accessibilityLabel={secondary.accessibilityLabel ?? secondary.label}
            >
              <Text className="text-sm font-semibold text-muted-foreground">
                {secondary.label}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
