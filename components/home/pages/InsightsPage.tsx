import { useState, useCallback } from "react";

import { View, ScrollView, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Card, EmptyState, LoadingState, SectionHeader, Text } from "@/components/ui";
import { InsightCard } from "@/components/analytics/InsightCard";

import { useDataRefresh } from "@/hooks/use-data-refresh";
import { getAnalyticsForecast, type AnalyticsForecast } from "@/services/analytics-forecast";
import { getCurrentMonth } from "@/services/budget";
import { getCashFlow, type CashFlow } from "@/services/cash-flow";
import { getInsights, type Insight } from "@/services/insight-engine";
import { getThisVsLastMonthTotals } from "@/services/comparison-insights";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";
import { useTheme } from "@/hooks/use-theme";
import { consumeInsightsPreload } from "@/services/home-preload";
import { LoadFailed } from "@/components/ui/ListToolbar";

const preloaded = consumeInsightsPreload();

const SHOWN_INSIGHTS = 4;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortMonth = (yyyyMM: string) => MONTH_NAMES[parseInt(yyyyMM.split("-")[1], 10) - 1] ?? yyyyMM;

/** The month five months before this one, so the card shows six in all. */
function sixMonthsBack(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 6, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The Insights dashboard: what's worth a look first, then the screens to explore (Nov 2026 redesign:
 * the budget and money in/out cards left, as Budget and Home already show them). Rendered both by the
 * Home swipe-pager and by app/insights/index.tsx.
 */
export function InsightsPage() {
  const router = useRouter();
  const theme = useTheme();
  const [forecast, setForecast] = useState<AnalyticsForecast | null>(preloaded?.forecast ?? null);
  const [insights, setInsights] = useState<Insight[]>(preloaded?.insights ?? []);
  const [thisMonthTotal, setThisMonthTotal] = useState(preloaded?.thisMonthTotal ?? 0);
  const [lastMonthTotal, setLastMonthTotal] = useState(preloaded?.lastMonthTotal ?? 0);
  const [flow, setFlow] = useState<CashFlow | null>(null);
  const [loading, setLoading] = useState(preloaded == null);
  const [refreshing, setRefreshing] = useState(false);
  const [allInsights, setAllInsights] = useState(false);

  const month = getCurrentMonth();

  const [loadFailed, setLoadFailed] = useState(false);
  const loadData = useCallback(async () => {
    // Each part runs on its own, so one failing doesn't blank the rest of the page.
    try {
      const totals = await getThisVsLastMonthTotals(DEFAULT_USER_ID);
      setThisMonthTotal(totals.currentMonth);
      setLastMonthTotal(totals.previousMonth);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }

    try {
      const [forecastData, insightData] = await Promise.all([
        getAnalyticsForecast(DEFAULT_USER_ID),
        getInsights(DEFAULT_USER_ID),
      ]);
      setForecast(forecastData);
      setInsights(insightData);
    } catch { /* non-fatal */ }
    setLoading(false);

    try {
      setFlow(await getCashFlow(DEFAULT_USER_ID, sixMonthsBack(month), month, month));
    } catch { /* non-fatal */ }
  }, [month]);

  useDataRefresh(loadData);

  if (loadFailed) return <LoadFailed onRetry={loadData} />;
  if (loading) return <LoadingState message="Loading insights..." />;

  const now = flow?.months[flow.months.length - 1] ?? null;
  const hasFlow = !!flow && flow.months.some((m) => m.cameIn > 0 || m.wentOut > 0);
  const shownInsights = allInsights ? insights : insights.slice(0, SHOWN_INSIGHTS);

  return (
    <ScrollView
      style={{ flex: 1 }}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 80, paddingHorizontal: 16, paddingTop: 12 }}
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
      {insights.length > 0 && (
        <>
          <SectionHeader
            title={`Worth a look · ${insights.length}`}
            action={insights.length > SHOWN_INSIGHTS ? { label: allInsights ? "Show less" : "See all", onPress: () => setAllInsights((v) => !v) } : undefined}
          />
          {shownInsights.map((insight) => (
            <InsightCard
              key={insight.id}
              severity={insight.severity}
              type={insight.type}
              title={insight.title}
              detail={insight.detail}
              onPress={() =>
                insight.href
                  ? router.push(insight.href as never)
                  : router.push({
                      pathname: "/insights/insight-detail",
                      params: { insightId: insight.id, title: insight.title },
                    })
              }
            />
          ))}
        </>
      )}

      <View className="mt-3"><SectionHeader title="Explore" /></View>
      <Card>
        <ExploreRow
          icon="trending-up-outline"
          title="Forecast"
          detail={forecast ? `Likely ${formatAmount(forecast.projectedTotal)} by month end` : "Where this month is heading"}
          onPress={() => router.push("/insights/forecast")}
        />
        <ExploreRow
          icon="swap-vertical-outline"
          title="Money in and out"
          detail={now ? `${formatAmount(now.cameIn)} in, ${formatAmount(now.wentOut)} out this month` : "Any month, 6 months or the year"}
          onPress={() => router.push("/insights/cash-flow")}
        />
        <ExploreRow icon="bar-chart-outline" title="Budget vs actual" detail="Any period against your budget" onPress={() => router.push("/insights/budget-vs-actual")} />
        <ExploreRow
          icon="git-compare-outline"
          title="Compare"
          detail={lastMonthTotal > 0 ? `${formatAmount(thisMonthTotal)} this month, ${formatAmount(lastMonthTotal)} last month` : "Any two periods, side by side"}
          onPress={() => router.push("/insights/compare")}
        />
        <ExploreRow icon="repeat-outline" title="Patterns" detail="What you spend on again and again" onPress={() => router.push("/insights/patterns")} />
        <ExploreRow icon="storefront-outline" title="Merchants" detail="Where your money goes most" onPress={() => router.push("/insights/merchants")} />
        <ExploreRow icon="star-outline" title="Year in review" detail="Your financial year as a story" onPress={() => router.push("/insights/year-review")} />
        <ExploreRow icon="document-text-outline" title="Reports" detail="Year in review, financial health and more" onPress={() => router.push("/insights/reports")} />
        <ExploreRow icon="sparkles-outline" title="Export for AI" detail="A file to ask an AI assistant about your money" onPress={() => router.push("/insights/export-for-ai")} last />
      </Card>

      {!forecast && insights.length === 0 && !hasFlow && (
        <EmptyState
          icon="analytics-outline"
          title="No insights yet"
          subtitle="Add some transactions and they'll appear here."
          fillScreen={false}
        />
      )}
    </ScrollView>
  );
}

function ExploreLine({ icon, title, detail }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string }) {
  const theme = useTheme();
  return (
    <View className="flex-row items-center">
      <Ionicons name={icon} size={18} color={theme.primary} />
      <View className="flex-1 mx-3">
        <Text className="text-body font-medium text-foreground">{title}</Text>
        <Text className="text-label text-muted-foreground mt-0.5" numberOfLines={1}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
    </View>
  );
}

function ExploreRow({
  icon,
  title,
  detail,
  onPress,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable onPress={onPress} className={`py-2.5 ${last ? "" : "border-b border-border"}`} accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`}>
      <ExploreLine icon={icon} title={title} detail={detail} />
    </Pressable>
  );
}
