import { useState, useCallback } from "react";
import { View, Text, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ScreenContainer, Card, SectionHeader, LoadingState } from "@/components/ui";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusPill } from "@/components/ui/StatusPill";
import { DrillGroupRow } from "@/components/analytics/DrillGroupRow";
import { YoYComparisonRow } from "@/components/analytics/YoYComparisonRow";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { getInsightDrill, type InsightDetail } from "@/services/insight-engine";
import { StatusColors } from "@/constants/theme";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";

const SEVERITY_COLORS = {
  celebrate: "success" as const,
  info: "muted" as const,
  warning: "warning" as const,
  critical: "danger" as const,
};

export default function InsightDetailScreen() {
  const router = useRouter();
  const { insightId } = useLocalSearchParams<{ insightId: string; title: string }>();
  const { colorScheme } = useColorScheme();
  const statusColors = StatusColors[colorScheme];
  const [detail, setDetail] = useState<InsightDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!insightId) return;
    try {
      const data = await getInsightDrill(DEFAULT_USER_ID, insightId);
      setDetail(data);
    } catch {
      // DB not ready
    } finally {
      setLoading(false);
    }
  }, [insightId]);

  useDataRefresh(loadData);

  if (loading) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Loading insight..." />
      </ScreenContainer>
    );
  }

  if (!detail) {
    return (
      <ScreenContainer padTop={false}>
        <View className="items-center py-16 px-8">
          <Ionicons name="alert-circle-outline" size={48} color={statusColors.muted} />
          <Text className="text-lg font-medium text-text-primary dark:text-text-dark-primary mt-4">
            Insight not available
          </Text>
          <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-1 text-center">
            This insight may no longer be relevant for the current month.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  const { insight, drillGroups, totalAmount, budgetAmount, yoyComparison } = detail;
  const severityColor = statusColors[SEVERITY_COLORS[insight.severity]];
  const overPct = budgetAmount && budgetAmount > 0
    ? Math.round(((totalAmount - budgetAmount) / budgetAmount) * 100)
    : 0;
  const progressValue = budgetAmount && budgetAmount > 0
    ? Math.min(totalAmount / budgetAmount, 1.5)
    : 0;

  const isCreepDrill = insight.type === "lifestyle_creep" && yoyComparison != null;

  // Max bar value: largest across either side of the comparison so bars are comparable.
  const maxBarValue = isCreepDrill
    ? Math.max(
        ...drillGroups.map((g) =>
          Math.max(g.amount, g.comparison?.previousAmount ?? 0),
        ),
        1,
      )
    : 0;

  const grandDelta = yoyComparison
    ? yoyComparison.currentTotal - yoyComparison.previousTotal
    : 0;
  const grandDeltaPct = yoyComparison && yoyComparison.previousTotal > 0
    ? Math.round((grandDelta / yoyComparison.previousTotal) * 100)
    : null;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Insight Hero */}
        <View className="px-4 mt-3">
          <Card>
            <StatusPill
              label={insight.severity.toUpperCase()}
              color={severityColor}
            />

            <Text className="text-lg font-bold text-text-primary dark:text-text-dark-primary mt-3">
              {insight.title}
            </Text>

            {/* Generic detail — suppressed for creep drill because the YoY summary below is more informative */}
            {!isCreepDrill && (
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-1">
                {insight.detail}
              </Text>
            )}

            {/* YoY summary (lifestyle-creep only) */}
            {isCreepDrill && yoyComparison && (
              <View className="mt-3">
                <View className="flex-row">
                  <View className="flex-1 pr-2">
                    <Text className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary dark:text-text-dark-tertiary">
                      {yoyComparison.currentLabel}
                    </Text>
                    <Text
                      className="text-lg font-bold mt-0.5"
                      style={{ color: grandDelta >= 0 ? statusColors.danger : statusColors.success }}
                    >
                      {formatAmount(yoyComparison.currentTotal)}
                    </Text>
                  </View>
                  <View className="flex-1 pl-2 border-l border-border-light dark:border-border-dark">
                    <Text className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary dark:text-text-dark-tertiary">
                      {yoyComparison.previousLabel}
                    </Text>
                    <Text className="text-lg font-bold text-text-secondary dark:text-text-dark-secondary mt-0.5">
                      {formatAmount(yoyComparison.previousTotal)}
                    </Text>
                  </View>
                </View>

                <View className="mt-3 pt-3 border-t border-border-light dark:border-border-dark flex-row items-center justify-between">
                  <Text className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary">
                    Change YoY
                  </Text>
                  <View className="flex-row items-center">
                    <Ionicons
                      name={grandDelta >= 0 ? "arrow-up" : "arrow-down"}
                      size={14}
                      color={grandDelta >= 0 ? statusColors.danger : statusColors.success}
                    />
                    <Text
                      className="text-sm font-bold ml-1"
                      style={{ color: grandDelta >= 0 ? statusColors.danger : statusColors.success }}
                    >
                      {grandDelta >= 0 ? "+" : "−"}
                      {formatAmount(Math.abs(grandDelta))}
                      {grandDeltaPct != null && ` (${grandDelta >= 0 ? "+" : ""}${grandDeltaPct}%)`}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {budgetAmount != null && budgetAmount > 0 && (
              <View className="mt-4">
                <ProgressBar
                  value={Math.min(progressValue, 1)}
                  color={overPct > 0 ? statusColors.danger : statusColors.success}
                  height={8}
                />
                <View className="flex-row justify-between mt-1.5">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                    {overPct > 0 ? `${overPct}% over` : "Within budget"}
                  </Text>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                    Budget: {formatAmount(budgetAmount)}
                  </Text>
                </View>
              </View>
            )}
          </Card>
        </View>

        {/* Drill Down */}
        {drillGroups.length > 0 && (
          <View className="px-4 mt-4">
            <SectionHeader
              title={isCreepDrill ? "Where the money went — vs last year" : "Breakdown"}
            />
            <Card>
              {isCreepDrill && (
                <Text className="text-[11px] text-text-secondary dark:text-text-dark-secondary mb-2">
                  Sorted by largest absolute increase. Bars share the same scale so you can compare sizes.
                </Text>
              )}
              {drillGroups.map((group, i) => {
                const onPress =
                  group.expenseIds.length === 0
                    ? undefined
                    : group.expenseIds.length === 1
                      ? () => router.push(`/expense/${group.expenseIds[0]}`)
                      : () =>
                          router.push({
                            pathname: "/insights/filtered" as never,
                            params: {
                              expenseIds: group.expenseIds.join(","),
                              title: `${insight.title} → ${group.label}`,
                            },
                          });

                if (isCreepDrill && group.comparison) {
                  return (
                    <YoYComparisonRow
                      key={`${group.label}-${i}`}
                      label={group.label}
                      currentAmount={group.amount}
                      previousAmount={group.comparison.previousAmount}
                      deltaAmount={group.comparison.deltaAmount}
                      deltaPct={group.comparison.deltaPct}
                      count={group.count}
                      maxBarValue={maxBarValue}
                      onPress={onPress}
                    />
                  );
                }

                return (
                  <DrillGroupRow
                    key={`${group.label}-${i}`}
                    label={group.label}
                    amount={group.amount}
                    count={group.count}
                    percentage={group.percentage}
                    onPress={onPress}
                  />
                );
              })}
            </Card>
          </View>
        )}

        {/* Creep drill — plain-English footnote. Other insights keep the generic total card. */}
        {isCreepDrill ? (
          <View className="px-4 mt-4">
            <Card>
              <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary mb-2">
                How to read this
              </Text>
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary leading-5">
                Each row shows one category. The red/green bar is what you spent in the last 3 months. The grey bar is what you spent in the same 3 months last year. A big gap between the two is where lifestyle creep is happening.
                {"\n\n"}
                <Text className="font-semibold">"New this year"</Text> means Artha has no data for that category last year — either you weren't tracking yet, or the category name is new. That can inflate the headline YoY % even when your real spending is similar.
              </Text>
            </Card>
          </View>
        ) : (
          <View className="px-4 mt-4">
            <Card>
              <View className="flex-row justify-between items-center">
                <Text className="text-sm font-medium text-text-secondary dark:text-text-dark-secondary">
                  Total
                </Text>
                <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
                  {formatAmount(totalAmount)}
                </Text>
              </View>
              {drillGroups.length > 0 && (
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-1">
                  Across {drillGroups.reduce((s, g) => s + g.count, 0)} transactions
                </Text>
              )}
            </Card>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

