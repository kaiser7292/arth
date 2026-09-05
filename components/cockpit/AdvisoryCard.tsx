import { View, Pressable } from "react-native";
import { BRAND_COLOR, STATUS_COLORS } from "@/constants/semantic-colors";
import { Text } from "@/components/ui";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { Advisory, AdvisorySeverity } from "@/utils/financial-cockpit";

interface AdvisoryCardProps {
  advisory: Advisory;
  onPress?: () => void;
}

interface SeverityStyle {
  bg: string;
  bgDark: string;
  border: string;
  text: string;
  textDark: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const SEVERITY_STYLES: Record<AdvisorySeverity, SeverityStyle> = {
  critical: {
    bg: "#FEF2F2",
    bgDark: "#3B0000",
    border: STATUS_COLORS.error,
    text: "#991B1B",
    textDark: "#FCA5A5",
    icon: "warning-outline",
  },
  warning: {
    bg: "#FEF9E7",
    bgDark: "#332B00",
    border: STATUS_COLORS.warning,
    text: "#92400E",
    textDark: "#FBBF24",
    icon: "alert-circle-outline",
  },
  info: {
    bg: "#EFF6FF",
    bgDark: "#1E293B",
    border: BRAND_COLOR,
    text: BRAND_COLOR,
    textDark: "#93C5FD",
    icon: "information-circle-outline",
  },
  celebrate: {
    bg: "#F0FDF4",
    bgDark: "#052E16",
    border: STATUS_COLORS.success,
    text: "#166534",
    textDark: "#86EFAC",
    icon: "sparkles-outline",
  },
};

export function AdvisoryCard({ advisory, onPress }: AdvisoryCardProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const style = SEVERITY_STYLES[advisory.severity];

  const inner = (
    <View className="px-3 py-2.5">
      {/* Title row */}
      <View className="flex-row items-center mb-1">
        <Ionicons
          name={style.icon}
          size={16}
          color={style.border}
          style={{ marginRight: 6 }}
        />
        <Text
          className="text-sm font-semibold flex-1"
          style={{ color: isDark ? style.textDark : style.text }}
        >
          {advisory.title}
        </Text>
        {onPress && (
          <Ionicons name="chevron-forward" size={14} color={style.border} style={{ opacity: 0.6 }} />
        )}
      </View>

      {/* Message */}
      <Text
        className="text-xs"
        style={{ color: isDark ? style.textDark : style.text, marginLeft: 22, opacity: 0.85 }}
      >
        {advisory.message}
      </Text>

      {/* Action hint */}
      {advisory.action && (
        <View
          className="mt-1.5 py-1 px-2 rounded self-start"
          style={{
            backgroundColor: style.border + "14",
            marginLeft: 22,
          }}
        >
          <Text
            className="text-xs font-medium"
            style={{ color: style.border }}
          >
            {onPress ? "Tap for details" : `→ ${advisory.action}`}
          </Text>
        </View>
      )}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        className="mb-2 rounded-xl overflow-hidden"
        style={{
          backgroundColor: isDark ? style.bgDark : style.bg,
          borderLeftWidth: 3,
          borderLeftColor: style.border,
        }}
      >
        {inner}
      </Pressable>
    );
  }

  return (
    <View
      className="mb-2 rounded-xl overflow-hidden"
      style={{
        backgroundColor: isDark ? style.bgDark : style.bg,
        borderLeftWidth: 3,
        borderLeftColor: style.border,
      }}
    >
      {inner}
    </View>
  );
}
