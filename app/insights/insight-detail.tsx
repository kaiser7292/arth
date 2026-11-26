import { useState, useCallback } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Button, Card, LoadingState, ScreenContainer, SectionHeader, Text } from "@/components/ui";
import { getCategoryMonthlyTrend, getExpenseIdsByCategory } from "@/services/expense-queries";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { DrillGroupRow } from "@/components/analytics/DrillGroupRow";
import { YoYComparisonRow } from "@/components/analytics/YoYComparisonRow";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { getInsightDrill, type InsightDetail } from "@/services/insight-engine";

import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";
import { useTheme } from "@/hooks/use-theme";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";

const SEVERITY_ROLE = {
  celebrate: "success" as const,
  info: "primary" as const,
  warning: "warning" as const,
  critical: "danger" as const,
};

/** The small label over an insight's title: what kind of thing happened. */
const KIND: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  budget_breach: { label: "Over budget", icon: "alert-circle-outline" },
  lifestyle_creep: { label: "Spending is up", icon: "trending-up-outline" },
  savings_win: { label: "Spending is down", icon: "sparkles-outline" },
  micro_leaks: { label: "Small payments", icon: "water-outline" },
  category_spike: { label: "Spending is up", icon: "trending-up-outline" },
};

const monthShort = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short" });
};

export default function InsightDetailScreen() {
  const router = useRouter();
  // month: from "Your month in words" on a past month; without it, this month.
  const { insightId, month } = useLocalSearchParams<{ insightId: string; title: string; month?: string }>();
  
  const theme = useTheme();
  const [detail, setDetail] = useState<InsightDetail | null>(null);
  // Six months of the insight's category, oldest first: the chart, each bar opening that month.
  const [trend, setTrend] = useState<{ month: string; total: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const [loadFailed, setLoadFailed] = useState(false);
  const loadData = useCallback(async () => {
    if (!insightId) return;
    try {
      const data = await getInsightDrill(DEFAULT_USER_ID, insightId, month || undefined);
      setDetail(data);
      const catId = data?.insight.categoryId ?? (insightId.split("_").length > 2 ? insightId.split("_")[1] : undefined);
      setTrend(catId ? await getCategoryMonthlyTrend(DEFAULT_USER_ID, catId, 6).catch(() => []) : []);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      // DB not ready
    } finally {
      setLoading(false);
    }
  }, [insightId]);

  useDataRefresh(loadData);

  if (loading) {
    return (
      <ScreenContainer padTop={false}>
        {loadFailed && <LoadFailedBanner onRetry={loadData} />}
        <LoadingState message="Loading insight..." />
      </ScreenContainer>
    );
  }

  if (!detail) {
    return (
      <ScreenContainer padTop={false}>
        {loadFailed && <LoadFailedBanner onRetry={loadData} />}
        <View className="items-center py-16 px-8">
          <Ionicons name="alert-circle-outline" size={48} color={theme.faintForeground} />
          <Text className="text-heading font-medium text-foreground mt-4">
            Insight not available
          </Text>
          <Text className="text-meta text-muted-foreground mt-1 text-center">
            This insight may no longer be relevant for the current month.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  const { insight, drillGroups, totalAmount, budgetAmount, yoyComparison } = detail;
  const role = SEVERITY_ROLE[insight.severity];
  const severityColor = theme[role];
  const kind = KIND[insight.type] ?? { label: "Worth a look", icon: "bulb-outline" as const };
  const categoryId = insight.categoryId ?? (insightId && insightId.split("_").length > 2 ? insightId.split("_")[1] : undefined);
  const allIds = drillGroups.flatMap((g) => g.expenseIds);
  const past = trend.slice(0, -1).filter((t) => t.total > 0);
  const average = past.length > 0 ? past.reduce((s, t) => s + t.total, 0) / past.length : 0;
  const trendMax = Math.max(1, average, ...trend.map((t) => t.total));
  const openMonth = async (month: string) => {
    if (!categoryId) return;
    const { startDate, endDate } = getMonthDateRange(month);
    const ids = await getExpenseIdsByCategory(DEFAULT_USER_ID, categoryId, startDate, endDate).catch(() => [] as string[]);
    if (ids.length === 1) router.push(`/expense/${ids[0]}`);
    else if (ids.length > 1) router.push({ pathname: "/insights/filtered", params: { expenseIds: ids.join(","), title: `${insight.categoryName ?? insight.title} · ${monthShort(month)}` } });
  };
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
      {loadFailed && <LoadFailedBanner onRetry={loadData} />}
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Insight Hero */}
        <View className="px-4 mt-3">
          <Card>
            <View className="flex-row items-center" style={{ gap: 12 }}>
              <View className="w-10 h-10 rounded-control items-center justify-center" style={{ backgroundColor: theme.alpha(role, role === "danger" ? 0.08 : 0.1) }}>
                <Ionicons name={kind.icon} size={20} color={severityColor} />
              </View>
              <Text className="text-label font-semibold uppercase tracking-wider" style={{ color: severityColor }}>{kind.label}</Text>
            </View>

            <Text className="text-title font-bold text-foreground mt-3">
              {insight.title}
            </Text>

            {/* Generic detail — suppressed for creep drill because the YoY summary below is more informative */}
            {!isCreepDrill && (
              <Text className="text-meta text-muted-foreground mt-1">
                {insight.detail}
              </Text>
            )}

            {/* YoY summary (lifestyle-creep only) */}
            {isCreepDrill && yoyComparison && (
              <View className="mt-3">
                <View className="flex-row">
                  <View className="flex-1 pr-2">
                    <Text className="text-label font-semibold uppercase tracking-wider text-faint-foreground">
                      {yoyComparison.currentLabel}
                    </Text>
                    <Text
                      className="text-heading font-bold mt-0.5"
                      style={{ color: grandDelta >= 0 ? theme.danger : theme.success }}
                    >
                      {formatAmount(yoyComparison.currentTotal)}
                    </Text>
                  </View>
                  <View className="flex-1 pl-2 border-l border-border">
                    <Text className="text-label font-semibold uppercase tracking-wider text-faint-foreground">
                      {yoyComparison.previousLabel}
                    </Text>
                    <Text className="text-heading font-bold text-muted-foreground mt-0.5">
                      {formatAmount(yoyComparison.previousTotal)}
                    </Text>
                  </View>
                </View>

                <View className="mt-3 pt-3 border-t border-border flex-row items-center justify-between">
                  <Text className="text-label font-medium text-muted-foreground">
                    Change YoY
                  </Text>
                  <View className="flex-row items-center">
                    <Ionicons
                      name={grandDelta >= 0 ? "arrow-up" : "arrow-down"}
                      size={14}
                      color={grandDelta >= 0 ? theme.danger : theme.success}
                    />
                    <Text
                      className="text-body font-bold ml-1"
                      style={{ color: grandDelta >= 0 ? theme.danger : theme.success }}
                    >
                      {grandDelta >= 0 ? "+" : "−"}
                      {formatAmount(Math.abs(grandDelta))}
                      {grandDeltaPct != null && ` (${grandDelta >= 0 ? "+" : ""}${grandDeltaPct}%)`}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {trend.length > 1 && trend.some((t) => t.total > 0) && (
              <View className="mt-4">
                <View className="flex-row items-end" style={{ height: 110, gap: 10 }}>
                  {trend.map((t, i) => {
                    const isNow = i === trend.length - 1;
                    return (
                      <Pressable
                        key={t.month}
                        onPress={() => openMonth(t.month)}
                        className="flex-1 justify-end"
                        style={{ height: "100%" }}
                        accessibilityRole="button"
                        accessibilityLabel={`${monthShort(t.month)}, ${formatAmount(t.total)}, see transactions`}
                      >
                        <View style={{ height: `${Math.max(3, (t.total / trendMax) * 100)}%`, backgroundColor: isNow ? severityColor : theme.border, borderTopLeftRadius: 6, borderTopRightRadius: 6 }} />
                      </Pressable>
                    );
                  })}
                  {average > 0 && (
                    <View pointerEvents="none" className="absolute left-0 right-0" style={{ bottom: `${(average / trendMax) * 100}%`, borderTopWidth: 1.5, borderStyle: "dashed", borderColor: theme.mutedForeground }} />
                  )}
                </View>
                <View className="flex-row mt-1.5" style={{ gap: 10 }}>
                  {trend.map((t, i) => (
                    <Text key={t.month} className={`flex-1 text-label text-center${i === trend.length - 1 ? " font-bold" : ""}`} style={{ color: i === trend.length - 1 ? severityColor : theme.mutedForeground }}>
                      {monthShort(t.month)}
                    </Text>
                  ))}
                </View>
                <Text className="text-label text-muted-foreground mt-1.5">
                  {average > 0 ? `Dashed line: your average, ${formatAmount(Math.round(average))} a month. ` : ""}Tap a month to see its payments.
                </Text>
              </View>
            )}

            {budgetAmount != null && budgetAmount > 0 && (
              <View className="mt-4">
                <ProgressBar
                  value={Math.min(progressValue, 1)}
                  color={overPct > 0 ? theme.danger : theme.success}
                  height={8}
                />
                <View className="flex-row justify-between mt-1.5">
                  <Text className="text-label text-muted-foreground">
                    {overPct > 0 ? `${overPct}% over` : "Within budget"}
                  </Text>
                  <Text className="text-label text-muted-foreground">
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
              title={isCreepDrill ? "Where the money went - vs last year" : "What's behind it"}
            />
            <Card>
              {isCreepDrill && (
                <Text className="text-label text-muted-foreground mb-2">
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
                            pathname: "/insights/filtered",
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
              <Text className="text-label font-semibold text-muted-foreground mb-2">
                How to read this
              </Text>
              <Text className="text-label text-muted-foreground leading-5">
                Each row shows one category. The red/green bar is what you spent in the last 3 months. The grey bar is what you spent in the same 3 months last year. A big gap between the two is where lifestyle creep is happening.
                {"\n\n"}
                <Text className="font-semibold">"New this year"</Text> means Arth has no data for that category last year - either you weren't tracking yet, or the category name is new. That can inflate the headline YoY % even when your real spending is similar.
              </Text>
            </Card>
          </View>
        ) : (
          <View className="px-4 mt-4">
            <Card>
              <View className="flex-row justify-between items-center">
                <Text className="text-body font-medium text-muted-foreground">
                  Total
                </Text>
                <Text className="text-body font-bold text-foreground">
                  {formatAmount(totalAmount)}
                </Text>
              </View>
              {drillGroups.length > 0 && (
                <Text className="text-label text-muted-foreground mt-1">
                  Across {drillGroups.reduce((s, g) => s + g.count, 0)} transactions
                </Text>
              )}
            </Card>
          </View>
        )}

        {/* What to do next */}
        <View className="px-4 mt-4" style={{ gap: 8 }}>
          {allIds.length > 0 && (
            <Button
              title={allIds.length === 1 ? "See the payment" : `See all ${allIds.length} payments`}
              onPress={() =>
                allIds.length === 1
                  ? router.push(`/expense/${allIds[0]}`)
                  : router.push({ pathname: "/insights/filtered", params: { expenseIds: allIds.join(","), title: insight.title } })
              }
            />
          )}
          {categoryId && (
            <Button
              title={budgetAmount != null && budgetAmount > 0 ? "Open in Budget" : "Set a budget for it"}
              variant="outline"
              onPress={() => router.push({ pathname: "/budget/[categoryId]", params: { categoryId } })}
            />
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

