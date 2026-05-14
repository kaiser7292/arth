import { View, Text } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors, Shadows } from "@/constants/theme";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ConfidenceDots } from "./ConfidenceDots";
import { formatAmount } from "@/utils/format";
import type { AnalyticsForecast } from "@/services/analytics-forecast";

interface ForecastBreakdownProps {
  forecast: AnalyticsForecast;
}

export function ForecastBreakdown({ forecast }: ForecastBreakdownProps) {
  const { colorScheme, colors } = useColorScheme();
  const statusColors = StatusColors[colorScheme];

  const { fixedDone, fixedPending, variable, projectedTotal, budget, breathingRoom, confidence, dataMonths } = forecast;

  const totalForBar = projectedTotal || 1;
  const fixedDonePct = fixedDone.total / totalForBar;
  const fixedPendingPct = fixedPending.total / totalForBar;
  const variablePct = variable.projected / totalForBar;

  const allFixedArrived = fixedPending.items.length === 0;
  const isOverBudget = budget != null && projectedTotal > budget;

  return (
    <View
      className="rounded-2xl bg-surface-light-alt dark:bg-surface-dark-alt p-5 mb-4"
      style={Shadows.card}
    >
      {/* Month so far */}
      <View className="flex-row justify-between items-center mb-4">
        <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
          Month so far
        </Text>
        <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
          {formatAmount(forecast.monthSoFar)}
        </Text>
      </View>

      {/* Fixed Done */}
      <View className="mb-3">
        <View className="flex-row justify-between items-center mb-1.5">
          <Text className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary">
            Fixed (done)
          </Text>
          <Text className="text-xs font-bold text-text-primary dark:text-text-dark-primary">
            {formatAmount(fixedDone.total)}
          </Text>
        </View>
        <ProgressBar value={fixedDonePct} color={statusColors.success} height={6} />
        {fixedDone.items.length > 0 && (
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-1" numberOfLines={1}>
            {fixedDone.items.slice(0, 3).map((i) => `${capitalize(i.merchant)} ${formatCompact(i.actualAmount ?? i.amount)}`).join(" · ")}
          </Text>
        )}
      </View>

      {/* Fixed Pending */}
      <View className="mb-3">
        <View className="flex-row justify-between items-center mb-1.5">
          <Text className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary">
            Fixed (pending)
          </Text>
          <Text className="text-xs font-bold text-text-primary dark:text-text-dark-primary">
            {formatAmount(fixedPending.total)}
          </Text>
        </View>
        <ProgressBar value={fixedPendingPct} color={statusColors.muted} height={6} />
        {allFixedArrived ? (
          <Text className="text-xs mt-1" style={{ color: statusColors.success }}>
            All fixed expenses arrived {"\u2713"}
          </Text>
        ) : (
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-1" numberOfLines={1}>
            {fixedPending.items.slice(0, 3).map((i) => `${capitalize(i.merchant)} ~Day ${i.expectedDay}`).join(" · ")}
          </Text>
        )}
      </View>

      {/* Variable */}
      <View className="mb-4">
        <View className="flex-row justify-between items-center mb-1.5">
          <Text className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary">
            Variable (projected)
          </Text>
          <Text className="text-xs font-bold text-text-primary dark:text-text-dark-primary">
            {formatAmount(variable.projected)}
          </Text>
        </View>
        <ProgressBar value={variablePct} height={6} />
        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-1">
          {formatAmount(variable.dailyPace)}/day pace · {variable.daysLeft} days left
        </Text>
      </View>

      {/* Divider */}
      <View className="border-t border-border-light dark:border-border-dark mb-3" />

      {/* Summary */}
      <View className="gap-1.5">
        <View className="flex-row justify-between">
          <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
            Projected total
          </Text>
          <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary">
            {formatAmount(projectedTotal)}
          </Text>
        </View>

        {budget != null && (
          <>
            <View className="flex-row justify-between">
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
                Budget
              </Text>
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
                {formatAmount(budget)}
              </Text>
            </View>
            <View className="flex-row justify-between items-center">
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
                Breathing room
              </Text>
              <Text
                className="text-sm font-bold"
                style={{ color: isOverBudget ? statusColors.danger : statusColors.success }}
              >
                {isOverBudget ? "-" : ""}{formatAmount(Math.abs(breathingRoom ?? 0))} {isOverBudget ? "\u2717" : "\u2713"}
              </Text>
            </View>
          </>
        )}
      </View>

      {/* Confidence */}
      <View className="mt-3">
        <ConfidenceDots level={confidence} />
        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-1">
          Based on {dataMonths} month{dataMonths !== 1 ? "s" : ""} of data
        </Text>
      </View>
    </View>
  );
}

function formatCompact(n: number): string {
  if (n >= 100000) return `\u20B9${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `\u20B9${(n / 1000).toFixed(0)}K`;
  return `\u20B9${Math.round(n)}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
