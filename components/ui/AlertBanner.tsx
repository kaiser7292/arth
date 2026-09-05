import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AlertSeverity } from "@/utils/course-correction";
import { useTheme } from "@/hooks/use-theme";
import { Text } from "./Text";

interface AlertBannerProps {
  severity: AlertSeverity;
  message: string;
  onDismiss?: () => void;
}

/**
 * Inline severity banner.
 *
 * Rebuilt on the token layer. The previous version carried a hand-written table of ten hex values
 * including `bgDark` and `textDark` entries that were never read — `config.bg` always resolved to
 * the light value, so the banner rendered a light background with dark text in dark mode. Deriving
 * everything from one semantic role per severity removes the table and the bug together.
 */
const SEVERITY = {
  info: { role: "primary", icon: "information-circle-outline" },
  warning: { role: "warning", icon: "alert-circle-outline" },
  critical: { role: "danger", icon: "warning-outline" },
} as const;

export function AlertBanner({ severity, message, onDismiss }: AlertBannerProps) {
  const theme = useTheme();
  const { role, icon } = SEVERITY[severity];

  return (
    <View
      className="mx-4 mb-2 px-4 py-3 rounded-card flex-row items-start"
      style={{
        backgroundColor: theme.alpha(role, 0.1),
        borderWidth: 1,
        borderColor: theme.alpha(role, 0.3),
      }}
      accessibilityRole="alert"
    >
      <Ionicons name={icon} size={18} color={theme[role]} style={{ marginTop: 1 }} />
      <Text className="flex-1 text-meta ml-2" style={{ color: theme[role] }}>
        {message}
      </Text>
      {onDismiss && (
        <Pressable
          onPress={onDismiss}
          className="ml-2"
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Dismiss alert"
        >
          <Ionicons name="close" size={16} color={theme[role]} />
        </Pressable>
      )}
    </View>
  );
}
