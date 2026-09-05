import { useState, useCallback } from "react";
import { BRAND_COLOR } from "@/constants/semantic-colors";
import { View, ScrollView, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { Card, EmptyState, LoadingState, SectionHeader, Text } from "@/components/ui";
import { ForecastBreakdown } from "@/components/analytics/ForecastBreakdown";
import { InsightCard } from "@/components/analytics/InsightCard";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { getAnalyticsForecast, type AnalyticsForecast } from "@/services/analytics-forecast";
import { getInsights, type Insight } from "@/services/insight-engine";
import { getThisVsLastMonthTotals } from "@/services/comparison-insights";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";

export function InsightsPage() {
  const router = useRouter();
  const { colors, accent, colorScheme } = useColorScheme();
  const [forecast, setForecast] = useState<AnalyticsForecast | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [thisMonthTotal, setThisMonthTotal] = useState(0);
  const [lastMonthTotal, setLastMonthTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    // Spending pulse runs independently so forecast errors don't leave the
    // card showing stale data. Uses the same query as the Compare screen.
    try {
      const totals = await getThisVsLastMonthTotals(DEFAULT_USER_ID);
      setThisMonthTotal(totals.currentMonth);
      setLastMonthTotal(totals.previousMonth);
    } catch { /* DB not ready */ }

    try {
      const [forecastData, insightData] = await Promise.all([
        getAnalyticsForecast(DEFAULT_USER_ID),
        getInsights(DEFAULT_USER_ID),
      ]);
      setForecast(forecastData);
      setInsights(insightData);
    } catch { /* non-fatal */ }

    setLoading(false);
  }, []);

  useDataRefresh(loadData);

  if (loading) return <LoadingState message="Loading analytics..." />;

  const diff = lastMonthTotal > 0 ? thisMonthTotal - lastMonthTotal : 0;
  const diffPct = lastMonthTotal > 0 ? Math.round((diff / lastMonthTotal) * 100) : 0;

  return (
    <ScrollView
      style={{ flex: 1 }}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 80 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await loadData();
            setRefreshing(false);
          }}
        />
      }
    >
      {/* Forecast Card */}
      <View className="px-4 mt-3">
        {forecast && <ForecastBreakdown forecast={forecast} />}
      </View>

      {/* Insights */}
      {insights.length > 0 && (
        <View className="px-4">
          <SectionHeader title="Insights" />
          {insights.map((insight) => (
            <InsightCard
              key={insight.id}
              severity={insight.severity}
              title={insight.title}
              detail={insight.detail}
              trendData={insight.trendData}
              onPress={() =>
                router.push({
                  pathname: "/insights/insight-detail",
                  params: { insightId: insight.id, title: insight.title },
                } as never)
              }
            />
          ))}
        </View>
      )}

      {/* Spending Pulse */}
      <View className="px-4 mt-2">
        <SectionHeader title="Spending Pulse" />
        <Pressable onPress={() => router.push("/insights/compare" as never)} accessibilityRole="button" android_ripple={{ color: "transparent" }}>
          <Card>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-xs text-muted-foreground">
                This month vs Last month
              </Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
            </View>
            <View className="flex-row items-baseline gap-2 mb-1">
              <Text className="text-lg font-bold text-foreground">
                {formatAmount(thisMonthTotal)}
              </Text>
              <Text className="text-sm text-muted-foreground">
                vs {formatAmount(lastMonthTotal)}
              </Text>
            </View>
            {lastMonthTotal > 0 && (() => {
              const pulseColor =
                diff <= 0 ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger;
              return (
                <View className="flex-row items-center gap-1">
                  <Ionicons name={diff <= 0 ? "arrow-down" : "arrow-up"} size={14} color={pulseColor} />
                  <Text className="text-sm font-medium" style={{ color: pulseColor }}>
                    {formatAmount(Math.abs(diff))} ({Math.abs(diffPct)}%)
                  </Text>
                </View>
              );
            })()}
          </Card>
        </Pressable>
      </View>

      {/* Quick Actions */}
      <View className="px-4 mt-4">
        <SectionHeader title="Explore" />
        <View className="flex-row flex-wrap gap-3">
          <QuickAction icon="git-compare-outline" label="Compare" onPress={() => router.push("/insights/compare" as never)} color={accent[500]} />
          <QuickAction icon="trending-up-outline" label="Forecast" onPress={() => router.push("/insights/forecast" as never)} color={accent[600]} />
          <QuickAction icon="repeat-outline" label="Patterns" onPress={() => router.push("/insights/patterns" as never)} color={accent[700]} />
          <QuickAction icon="storefront-outline" label="Merchants" onPress={() => router.push("/insights/merchants" as never)} color={accent[800]} />
          <QuickAction icon="bar-chart-outline" label="Budget" onPress={() => router.push("/insights/budget-vs-actual" as never)} color={accent[500]} />
          <QuickAction icon="document-text-outline" label="Reports" onPress={() => router.push("/insights/reports" as never)} color={BRAND_COLOR} />
        </View>
      </View>

      {!forecast && insights.length === 0 && (
        <EmptyState
          icon="analytics-outline"
          title="No analytics yet"
          subtitle="Add expenses for 2-3 months and analytics will appear automatically."
          fillScreen={false}
        />
      )}
    </ScrollView>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  color: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-2 px-4 py-2.5 rounded-full border border-border"
      accessibilityLabel={label}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={16} color={color} />
      <Text className="text-sm font-medium text-foreground">
        {label}
      </Text>
    </Pressable>
  );
}
