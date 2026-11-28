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
  /** "Not now": hide this card for the rest of the month (services/insight-dismiss.ts). */
  onNotNow?: () => void;
  /** "Don't show these": switch this kind of insight off. */
  onHideKind?: () => void;
}

/** One "Worth a look" insight: a tinted icon tile, what happened and why it matters (Nov 2026 redesign). */
export function InsightCard({ severity, type, title, detail, onPress, onNotNow, onHideKind }: InsightCardProps) {
  const theme = useTheme();
  const role = severity === "celebrate" ? "success" : severity === "critical" ? "danger" : severity === "warning" ? "warning" : "primary";
  const color = theme[role];
  const icon = (type && TYPE_ICONS[type]) || SEVERITY_ICONS[severity];
  return (
    <View className="rounded-card bg-card border border-border mb-2">
    <Pressable
      onPress={onPress}
      className="p-4 flex-row items-start"
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
    {(onNotNow || onHideKind) && (
      <View className="flex-row px-4 pb-3" style={{ gap: 18, paddingLeft: 68, marginTop: -6 }}>
        {onNotNow && (
          <Pressable onPress={onNotNow} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Not now: hide ${title} this month`}>
            <Text className="text-meta font-semibold" style={{ color: theme.primary }}>Not now</Text>
          </Pressable>
        )}
        {onHideKind && (
          <Pressable onPress={onHideKind} hitSlop={8} accessibilityRole="button" accessibilityLabel="Don't show insights like this">
            <Text className="text-meta font-semibold text-muted-foreground">Don't show these</Text>
          </Pressable>
        )}
      </View>
    )}
    </View>
  );
}
