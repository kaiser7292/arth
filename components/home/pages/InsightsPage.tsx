import { useState, useCallback } from "react";

import { View, ScrollView, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Card, EmptyState, LoadingState, SectionHeader, Text, useToast } from "@/components/ui";
import { InsightCard } from "@/components/analytics/InsightCard";

import { useDataRefresh } from "@/hooks/use-data-refresh";
import { getCurrentMonth } from "@/services/budget";
import { getCashFlow, type CashFlow } from "@/services/cash-flow";
import { getInsights, type Insight } from "@/services/insight-engine";
import { getThisVsLastMonthTotals } from "@/services/comparison-insights";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";
import { useTheme } from "@/hooks/use-theme";
import { consumeInsightsPreload } from "@/services/home-preload";
import { LoadFailed } from "@/components/ui/ListToolbar";
import { MonthStoryCard } from "@/components/insights/MonthStoryCard";
import { kindsOff, setKindOff, showAllKinds, snoozeInsight, visibleInsights } from "@/services/insight-dismiss";

const preloaded = consumeInsightsPreload();

const SHOWN_INSIGHTS = 3;

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
  const [insights, setInsights] = useState<Insight[]>(preloaded?.insights ?? []);
  const [thisMonthTotal, setThisMonthTotal] = useState(preloaded?.thisMonthTotal ?? 0);
  const [lastMonthTotal, setLastMonthTotal] = useState(preloaded?.lastMonthTotal ?? 0);
  const [flow, setFlow] = useState<CashFlow | null>(null);
  const [loading, setLoading] = useState(preloaded == null);
  const [refreshing, setRefreshing] = useState(false);
  const [allInsights, setAllInsights] = useState(false);
  const toast = useToast();

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
      setInsights(await getInsights(DEFAULT_USER_ID));
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
  // "Not now" and "Don't show these" answers apply here (services/insight-dismiss.ts).
  const visible = visibleInsights(insights);
  const shownInsights = allInsights ? visible : visible.slice(0, SHOWN_INSIGHTS);


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
      <MonthStoryCard />

      {visible.length > 0 && (
        <>
          <SectionHeader
            title={`Worth a look · ${visible.length}`}
            action={visible.length > SHOWN_INSIGHTS ? { label: allInsights ? "Show less" : "See all", onPress: () => setAllInsights((v) => !v) } : undefined}
          />
          {shownInsights.map((insight) => (
            <InsightCard
              key={insight.id}
              severity={insight.severity}
              type={insight.type}
              title={insight.title}
              detail={insight.detail}
              onNotNow={() => {
                snoozeInsight(insight.id);
                toast("Hidden for this month");
              }}
              onHideKind={() => {
                setKindOff(insight.type, true);
                toast("You won't see these again", { actionLabel: "Undo", onAction: () => setKindOff(insight.type, false) });
              }}
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

      {kindsOff().length > 0 && (
        <Pressable onPress={() => showAllKinds()} hitSlop={6} className="self-start mb-1" accessibilityRole="button">
          <Text className="text-label text-muted-foreground">
            {kindsOff().length} kind{kindsOff().length === 1 ? "" : "s"} of finding hidden · <Text className="text-label font-semibold" style={{ color: theme.primary }}>Show again</Text>
          </Text>
        </Pressable>
      )}

      <View className="mt-3"><SectionHeader title="Explore" /></View>
      <Card>
        <ExploreRow
          icon="swap-vertical-outline"
          title="Money in and out"
          detail={now ? `${formatAmount(now.cameIn)} in, ${formatAmount(now.wentOut)} out this month` : "Income, spending and what you kept"}
          onPress={() => router.push("/insights/cash-flow")}
        />
        <ExploreRow
          icon="git-compare-outline"
          title="Compare"
          detail={lastMonthTotal > 0 ? `${formatAmount(thisMonthTotal)} so far, ${formatAmount(lastMonthTotal)} all of last month` : "Any two periods, side by side"}
          onPress={() => router.push("/insights/compare")}
        />
        <ExploreRow icon="storefront-outline" title="Where it goes" detail="Merchants, regulars and bills" onPress={() => router.push("/insights/where-it-goes")} />
        <ExploreRow icon="star-outline" title="Year in review" detail="Your financial year as a story" onPress={() => router.push("/insights/year-review")} />
        <ExploreRow icon="sparkles-outline" title="Ask your AI assistant" detail="A file to ask ChatGPT, Gemini or Claude about your money" onPress={() => router.push("/insights/export-for-ai")} last />
      </Card>

      {insights.length === 0 && !hasFlow && (
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
