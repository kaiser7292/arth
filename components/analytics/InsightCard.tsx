import { View, Pressable } from "react-native";
import { Text } from "@/components/ui";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Shadows } from "@/constants/theme";
import { MiniTrendSpark } from "./MiniTrendSpark";
import type { InsightSeverity } from "@/services/insight-engine";
import { useTheme } from "@/hooks/use-theme";

const SEVERITY_ICONS: Record<InsightSeverity, keyof typeof Ionicons.glyphMap> = {
  celebrate: "sparkles",
  info: "bulb-outline",
  warning: "warning-outline",
  critical: "alert-circle",
};

interface InsightCardProps {
  severity: InsightSeverity;
  title: string;
  detail: string;
  trendData?: number[];
  onPress?: () => void;
}

export function InsightCard({
  severity,
  title,
  detail,
  trendData,
  onPress,
}: InsightCardProps) {
  
  const theme = useTheme();

  const severityColor = {
    celebrate: theme.success,
    info: theme.faintForeground,
    warning: theme.warning,
    critical: theme.danger,
  }[severity];

  return (
    <Pressable
      onPress={onPress}
      className="rounded-2xl bg-card p-4 mb-3"
      style={Shadows.card}
      accessibilityLabel={`${severity}: ${title}. ${detail}. Tap for details`}
      accessibilityRole="button"
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-row items-start flex-1 mr-3">
          <View
            className="w-7 h-7 rounded-full items-center justify-center mr-3 mt-0.5"
            style={{ backgroundColor: `${severityColor}18` }}
          >
            <Ionicons name={SEVERITY_ICONS[severity]} size={16} color={severityColor} />
          </View>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-foreground mb-1">
              {title}
            </Text>
            <Text className="text-xs text-muted-foreground" numberOfLines={2}>
              {detail}
            </Text>
          </View>
        </View>

        <View className="flex-row items-center gap-2">
          {trendData && trendData.length >= 2 && (
            <MiniTrendSpark data={trendData} color={severityColor} />
          )}
          <Ionicons
            name="chevron-forward"
            size={16}
            color={theme.faintForeground}
          />
        </View>
      </View>
    </Pressable>
  );
}
