import { View, Text } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import type { ConfidenceLevel } from "@/services/analytics-forecast";

const CONFIDENCE_CONFIG: Record<ConfidenceLevel, { dots: number; label: string }> = {
  learning: { dots: 0, label: "Learning" },
  low: { dots: 1, label: "Low" },
  moderate: { dots: 3, label: "Moderate" },
  high: { dots: 4, label: "High" },
  confirmed: { dots: 5, label: "Confirmed" },
};

interface ConfidenceDotsProps {
  level: ConfidenceLevel;
  showLabel?: boolean;
}

export function ConfidenceDots({ level, showLabel = true }: ConfidenceDotsProps) {
  const { colorScheme, accent, colors } = useColorScheme();
  const config = CONFIDENCE_CONFIG[level];
  const statusColors = StatusColors[colorScheme];

  const fillColor = level === "learning"
    ? statusColors.muted
    : level === "low"
      ? statusColors.warning
      : accent[500];

  const emptyColor = colors.border;

  return (
    <View
      className="flex-row items-center gap-1"
      accessibilityLabel={`Confidence: ${config.label}, ${config.dots} out of 5`}
    >
      {showLabel && (
        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mr-1">
          Confidence: {config.label}
        </Text>
      )}
      {Array.from({ length: 5 }).map((_, i) => (
        <View
          key={i}
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: i < config.dots ? fillColor : emptyColor }}
        />
      ))}
    </View>
  );
}
