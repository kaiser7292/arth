import { useState, useCallback } from "react";

import { View, ScrollView, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Card, EmptyState, LoadingState, ProgressBar, SectionHeader, Text } from "@/components/ui";
import { InsightCard } from "@/components/analytics/InsightCard";

import { useDataRefresh } from "@/hooks/use-data-refresh";
import { getAnalyticsForecast, type AnalyticsForecast } from "@/services/analytics-forecast";
import { getBudgetVsActual, getCurrentMonth, type BudgetVsActualResult, type BudgetVsActualRow } from "@/services/budget";
import { getCashFlow, type CashFlow } from "@/services/cash-flow";
import { getInsights, type Insight } from "@/services/insight-engine";
import { getThisVsLastMonthTotals } from "@/services/comparison-insights";
import { getExpenseIdsByCategory } from "@/services/expense";
import type { MyMonthSection } from "@/services/my-month-rows";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { formatLocalDate } from "@/utils/fiscal-year";
import { formatAmount } from "@/utils/format";
import { useTheme } from "@/hooks/use-theme";
import { consumeInsightsPreload } from "@/services/home-preload";
import { LoadFailed } from "@/components/ui/ListToolbar";

const preloaded = consumeInsightsPreload();

const SHOWN_INSIGHTS = 2;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortMonth = (yyyyMM: string) => MONTH_NAMES[parseInt(yyyyMM.split("-")[1], 10) - 1] ?? yyyyMM;

/** The month five months before this one, so the card shows six in all. */
function sixMonthsBack(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 6, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The Insights dashboard: how the month is going against your budget, money in and out, then what's
 * worth a look. Rendered both by the Home swipe-pager and by app/insights/index.tsx.
 */
export function InsightsPage() {
  const router = useRouter();
  const theme = useTheme();
  const [forecast, setForecast] = useState<AnalyticsForecast | null>(preloaded?.forecast ?? null);
  const [insights, setInsights] = useState<Insight[]>(preloaded?.insights ?? []);
  const [thisMonthTotal, setThisMonthTotal] = useState(preloaded?.thisMonthTotal ?? 0);
  const [lastMonthTotal, setLastMonthTotal] = useState(preloaded?.lastMonthTotal ?? 0);
  const [budget, setBudget] = useState<BudgetVsActualResult | null>(null);
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
      const { startDate } = getMonthDateRange(month);
      setBudget(await getBudgetVsActual(DEFAULT_USER_ID, month, month, startDate, formatLocalDate(new Date())));
    } catch { /* non-fatal */ }

    try {
      setFlow(await getCashFlow(DEFAULT_USER_ID, sixMonthsBack(month), month, month));
    } catch { /* non-fatal */ }
  }, [month]);

  useDataRefresh(loadData);

  const openCategory = useCallback(
    async (row: BudgetVsActualRow) => {
      try {
        const { startDate } = getMonthDateRange(month);
        const ids = await getExpenseIdsByCategory(DEFAULT_USER_ID, row.categoryId, startDate, formatLocalDate(new Date()));
        if (ids.length === 0) return;
        router.push({ pathname: "/insights/filtered", params: { expenseIds: ids.join(","), title: `${row.categoryName} this month` } });
      } catch { /* DB not ready */ }
    },
    [month, router],
  );

  /** Opens the transactions behind one of this month's figures. */
  const drill = (section: MyMonthSection, title: string) => () =>
    router.push({ pathname: "/summary/my-month-rows", params: { month, section, title } });

  if (loadFailed) return <LoadFailed onRetry={loadData} />;
  if (loading) return <LoadingState message="Loading insights..." />;

  const hasBudget = !!budget && budget.totalBudget > 0;
  const now = flow?.months[flow.months.length - 1] ?? null;
  const hasFlow = !!flow && flow.months.some((m) => m.cameIn > 0 || m.wentOut > 0);
  const shownInsights = allInsights ? insights : insights.slice(0, SHOWN_INSIGHTS);

  // Budget
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - today.getDate();
  const usedPct = hasBudget ? Math.round((budget!.totalActual / budget!.totalBudget) * 100) : 0;
  const monthPct = Math.round((today.getDate() / daysInMonth) * 100);
  const over = hasBudget ? budget!.totalActual - budget!.totalBudget : 0;
  const overCategories = hasBudget
    ? budget!.rows
        .filter((r) => r.totalActual > r.totalBudget)
        .sort((a, b) => b.totalActual - b.totalBudget - (a.totalActual - a.totalBudget))
        .slice(0, 2)
    : [];
  const budgetNote =
    over > 0
      ? `${formatAmount(over)} over your budget`
      : usedPct > monthPct + 5
        ? `Ahead of pace: ${usedPct}% used, ${monthPct}% of the month gone`
        : `On track: ${usedPct}% used, ${monthPct}% of the month gone`;
  const budgetColor = over > 0 ? theme.danger : usedPct > monthPct + 5 ? theme.warning : theme.success;

  // Money in and out
  const biggest = Math.max(1, ...(flow?.months ?? []).flatMap((m) => [m.cameIn, m.wentOut]));
  const quietShort = !!now && now.left < 0 && !!flow?.incomeStillDue;

  const budgetCard = hasBudget && (
    <Card className="mb-3">
      <CardTitle title="Budget vs actual" onPress={() => router.push("/insights/budget-vs-actual")} />
      <Pressable onPress={() => router.push("/insights/budget-vs-actual")} accessibilityRole="button" accessibilityLabel="Open Budget vs actual">
        <Text className="text-xs text-muted-foreground">
          Spent of your {formatAmount(budget!.totalBudget)} budget{daysLeft > 0 ? `, ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left` : ""}
        </Text>
        <Text className="text-title font-bold text-foreground mt-0.5">{formatAmount(budget!.totalActual)}</Text>
        <ProgressBar value={Math.min(1, budget!.totalActual / budget!.totalBudget)} color={budgetColor} height={8} className="mt-2" />
        <Text className="text-xs mt-1.5" style={{ color: budgetColor }}>{budgetNote}</Text>
      </Pressable>
      {overCategories.length > 0 && (
        <View className="mt-2 pt-1 border-t border-border">
          {overCategories.map((r) => (
            <Pressable key={r.categoryId} onPress={() => openCategory(r)} className="flex-row items-center py-2" accessibilityRole="button" accessibilityLabel={`${r.categoryName}, ${formatAmount(r.totalActual - r.totalBudget)} over, see transactions`}>
              <Text className="text-sm text-foreground flex-1 mr-2" numberOfLines={1}>{r.categoryName}</Text>
              <Text className="text-sm font-semibold" style={{ color: theme.danger }}>{formatAmount(r.totalActual - r.totalBudget)} over</Text>
              <Ionicons name="chevron-forward" size={13} color={theme.mutedForeground} style={{ marginLeft: 4 }} />
            </Pressable>
          ))}
        </View>
      )}
    </Card>
  );

  const flowCard = hasFlow && now && (
    <Card className="mb-3">
      <CardTitle title="Money in and out" onPress={() => router.push("/insights/cash-flow")} />
      <FlowRow dot={theme.success} label="Came in" amount={now.cameIn} onPress={drill("in", "Came in")} />
      <FlowRow dot={theme.primary} label="Went out" amount={now.wentOut} onPress={drill("out", "Went out")} />
      <Pressable onPress={drill("left", "What's left")} className="flex-row items-center pt-2 mt-1 border-t border-border" accessibilityRole="button" accessibilityLabel="What's left this month, see transactions">
        <Text className="text-sm font-semibold text-foreground flex-1 mr-2">
          {quietShort ? "So far, before your income" : now.left < 0 ? "More went out, by" : "Left this month"}
        </Text>
        <Text className="text-base font-bold" style={{ color: quietShort ? theme.foreground : now.left < 0 ? theme.danger : theme.success }}>{formatAmount(Math.abs(now.left))}</Text>
        <Ionicons name="chevron-forward" size={13} color={theme.mutedForeground} style={{ marginLeft: 4 }} />
      </Pressable>

      <View className="flex-row justify-between items-end mt-4" style={{ height: 64 }}>
        {flow!.months.map((m) => (
          <Pressable
            key={m.month}
            onPress={() => router.push({ pathname: "/summary/my-month", params: { month: m.month } })}
            className="flex-row items-end justify-center flex-1"
            style={{ height: "100%", gap: 2 }}
            accessibilityRole="button"
            accessibilityLabel={`${shortMonth(m.month)}: came in ${formatAmount(m.cameIn)}, went out ${formatAmount(m.wentOut)}. Open My Month`}
          >
            <View className="rounded-t" style={{ width: 11, height: `${Math.max(2, (m.cameIn / biggest) * 100)}%`, backgroundColor: theme.success }} />
            <View className="rounded-t" style={{ width: 11, height: `${Math.max(2, (m.wentOut / biggest) * 100)}%`, backgroundColor: theme.primary }} />
          </Pressable>
        ))}
      </View>
      <View className="flex-row mt-1">
        {flow!.months.map((m) => (
          <Text key={m.month} className="flex-1 text-label text-muted-foreground text-center">{shortMonth(m.month)}</Text>
        ))}
      </View>
    </Card>
  );

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
      {/* With a budget, how it's going comes first. Without one, money in and out does the job. */}
      {budgetCard}
      {flowCard}
      {budget && !hasBudget && hasFlow && (
        <Pressable onPress={() => router.push("/settings/budget-config")} accessibilityRole="button">
          <Card className="mb-3">
            <ExploreLine icon="wallet-outline" title="Set a budget" detail="See how each month tracks against it" />
          </Card>
        </Pressable>
      )}

      {insights.length > 0 && (
        <>
          <SectionHeader title="Worth a look" />
          {shownInsights.map((insight) => (
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
                })
              }
            />
          ))}
          {insights.length > SHOWN_INSIGHTS && (
            <Pressable onPress={() => setAllInsights((v) => !v)} className="pb-2" accessibilityRole="button">
              <Text className="text-xs font-medium" style={{ color: theme.primary }}>
                {allInsights ? "Show less" : `See all ${insights.length}`}
              </Text>
            </Pressable>
          )}
        </>
      )}

      <SectionHeader title="Explore" />
      <Card>
        <ExploreRow
          icon="trending-up-outline"
          title="Forecast"
          detail={forecast ? `Likely ${formatAmount(forecast.projectedTotal)} by month end` : "Where this month is heading"}
          onPress={() => router.push("/insights/forecast")}
        />
        <ExploreRow
          icon="git-compare-outline"
          title="Compare"
          detail={lastMonthTotal > 0 ? `${formatAmount(thisMonthTotal)} this month, ${formatAmount(lastMonthTotal)} last month` : "Any two periods, side by side"}
          onPress={() => router.push("/insights/compare")}
        />
        <ExploreRow icon="repeat-outline" title="Patterns" detail="What you spend on again and again" onPress={() => router.push("/insights/patterns")} />
        <ExploreRow icon="storefront-outline" title="Merchants" detail="Where your money goes most" onPress={() => router.push("/insights/merchants")} />
        <ExploreRow icon="document-text-outline" title="Reports" detail="Year in review, financial health and more" onPress={() => router.push("/insights/reports")} />
        <ExploreRow icon="sparkles-outline" title="Export for AI" detail="A file to ask an AI assistant about your money" onPress={() => router.push("/insights/export-for-ai")} last />
      </Card>

      {!forecast && insights.length === 0 && !hasFlow && !hasBudget && (
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

function CardTitle({ title, onPress }: { title: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} className="flex-row items-center justify-between mb-2" accessibilityRole="button" accessibilityLabel={`Open ${title}`} hitSlop={6}>
      <Text className="text-base font-semibold text-foreground">{title}</Text>
      <View className="flex-row items-center">
        <Text className="text-xs font-medium" style={{ color: theme.primary }}>See more</Text>
        <Ionicons name="chevron-forward" size={13} color={theme.primary} />
      </View>
    </Pressable>
  );
}

function FlowRow({ dot, label, amount, onPress }: { dot: string; label: string; amount: number; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} className="flex-row items-center py-1.5" accessibilityRole="button" accessibilityLabel={`${label}, ${formatAmount(amount)}, see transactions`}>
      <View className="w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: dot }} />
      <Text className="text-sm text-foreground flex-1 mr-2">{label}</Text>
      <Text className="text-sm font-semibold text-foreground">{formatAmount(amount)}</Text>
      <Ionicons name="chevron-forward" size={13} color={theme.mutedForeground} style={{ marginLeft: 4 }} />
    </Pressable>
  );
}

function ExploreLine({ icon, title, detail }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string }) {
  const theme = useTheme();
  return (
    <View className="flex-row items-center">
      <Ionicons name={icon} size={18} color={theme.primary} />
      <View className="flex-1 mx-3">
        <Text className="text-sm font-medium text-foreground">{title}</Text>
        <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>{detail}</Text>
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
