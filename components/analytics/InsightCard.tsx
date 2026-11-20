import { View, Pressable } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Text } from "@/components/ui";
import type { InsightSeverity, InsightType } from "@/services/insight-engine";
import { useTheme } from "@/hooks/use-theme";

const TYPE_ICONS: Partial<Record<InsightType, keyof typeof Ionicons.glyphMap>> = {
  budget_breach: "alert-circle-outline",
  lifestyle_creep: "trending-up-outline",
  savings_win: "sparkles-outline",
  micro_leaks: "water-outline",
  category_spike: "trending-up-outline",
  card_use: "card-outline",
  idle_cash: "business-outline",
};

const SEVERITY_ICONS: Record<InsightSeverity, keyof typeof Ionicons.glyphMap> = {
  celebrate: "sparkles-outline",
  info: "bulb-outline",
  warning: "warning-outline",
  critical: "alert-circle-outline",
};

interface InsightCardProps {
  severity: InsightSeverity;
  type?: InsightType;
  title: string;
  detail: string;
  /** Kept for callers; the redesigned card leaves the trend to the insight's own screen. */
  trendData?: number[];
  onPress?: () => void;
}

/** One "Worth a look" insight: a tinted icon tile, what happened and why it matters (Nov 2026 redesign). */
export function InsightCard({ severity, type, title, detail, onPress }: InsightCardProps) {
  const theme = useTheme();
  const role = severity === "celebrate" ? "success" : severity === "critical" ? "danger" : severity === "warning" ? "warning" : "primary";
  const color = theme[role];
  const icon = (type && TYPE_ICONS[type]) || SEVERITY_ICONS[severity];
  return (
    <Pressable
      onPress={onPress}
      className="rounded-card bg-card border border-border p-4 mb-2 flex-row items-start"
      style={{ gap: 12 }}
      accessibilityLabel={`${title}. ${detail}. Tap for details`}
      accessibilityRole="button"
    >
      <View className="w-10 h-10 rounded-control items-center justify-center" style={{ backgroundColor: theme.alpha(role, role === "danger" ? 0.08 : 0.1) }}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View className="flex-1" style={{ minWidth: 0 }}>
        <Text className="text-body font-bold text-foreground">{title}</Text>
        <Text className="text-meta text-muted-foreground" numberOfLines={3}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} style={{ marginTop: 4 }} />
    </Pressable>
  );
}
