import { useState, useCallback } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Card, LoadingState, ScreenContainer, SectionHeader, Text } from "@/components/ui";
import { ConfidenceDots } from "@/components/analytics/ConfidenceDots";
import { ActionSuggestionCard } from "@/components/analytics/ActionSuggestionCard";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";

import { getAnalyticsForecast, type AnalyticsForecast } from "@/services/analytics-forecast";
import { getCategories } from "@/services/category";
import { getActiveClassifications } from "@/services/analytics/classifier";
import { forecastCategoryRealistic } from "@/services/analytics/forecast-engine-v2";
import { getBudgetsForMonth } from "@/services/budget";
import { getMonthEndForecast } from "@/services/forecast-engine";
import { DEFAULT_USER_ID } from "@/constants/app";
import type { Expense } from "@/services/expense-types";
import type { MonthEndForecast } from "@/utils/forecast-engine";
import { formatAmount } from "@/utils/format";
import { useTheme } from "@/hooks/use-theme";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";

export default function ForecastDetailScreen() {
  const router = useRouter();
  
  const theme = useTheme();
  const [forecast, setForecast] = useState<AnalyticsForecast | null>(null);
  const [categoryForecast, setCategoryForecast] = useState<MonthEndForecast | null>(null);
  const [categoryNames, setCategoryNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  const [loadFailed, setLoadFailed] = useState(false);
  const loadData = useCallback(async () => {
    try {
      const [fData, cats] = await Promise.all([
        getAnalyticsForecast(DEFAULT_USER_ID),
        getCategories(DEFAULT_USER_ID),
      ]);
      setForecast(fData);
      setCategoryNames(new Map(cats.map((c) => [c.id, c.name])));

      // Try V2 category breach detection, fall back to old forecast engine
      const classifications = await getActiveClassifications(DEFAULT_USER_ID);
      if (classifications.length > 0) {
        const month = fData.month;
        const { getDatabase } = await import("@/database");
        const { getMonthDateRange } = await import("@/utils/budget-helpers");
        const db = getDatabase();
        const { startDate, endDate } = getMonthDateRange(month);
        const expenses = await db.getAllAsync<Expense>(
          `SELECT * FROM expenses WHERE user_id = ? AND date >= ? AND date <= ? AND status = 'approved' AND nature = 'realized' AND (expenses.reclassified_as_transfer IS NULL OR expenses.reclassified_as_transfer = 0) AND NOT EXISTS (SELECT 1 FROM expense_investment_links il WHERE il.expense_id = expenses.id) AND COALESCE(expenses.money_event, '') NOT IN ('fd_open', 'sip', 'self_transfer', 'balance_adjustment') AND deleted_at IS NULL;`,
          DEFAULT_USER_ID, startDate, endDate,
        );
        const budgets = await getBudgetsForMonth(DEFAULT_USER_ID, month);
        const v2Categories = forecastCategoryRealistic(expenses, classifications, budgets, month);
        const breachAlerts = v2Categories
          .filter((c) => c.budget != null && c.totalProjected > c.budget!)
          .map((c) => ({
            categoryId: c.categoryId,
            spentSoFar: c.fixedTotal + c.variableProjected * 0.5,
            budget: c.budget!,
            predictedTotal: c.totalProjected,
            paceBasedTotal: c.totalProjected,
            historicalTotal: c.totalProjected,
            willExceedBudget: true as const,
            predictedOverspend: c.totalProjected - c.budget!,
            confidence: "high" as const,
          }));
        setCategoryForecast({ totalPredictedSpend: fData.projectedTotal, totalBudget: fData.budget ?? 0, willExceedOverall: (fData.budget ?? 0) > 0 && fData.projectedTotal > (fData.budget ?? 0), predictedSurplusDeficit: (fData.budget ?? 0) - fData.projectedTotal, categories: [], breachAlerts });
      } else {
        const catForecast = await getMonthEndForecast(DEFAULT_USER_ID);
        setCategoryForecast(catForecast);
      }
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      // DB not ready
    } finally {
      setLoading(false);
    }
  }, []);

  useDataRefresh(loadData);

  if (loading || !forecast) {
    return (
      <ScreenContainer padTop={false}>
        {loadFailed && <LoadFailedBanner onRetry={loadData} />}
        <LoadingState message="Loading forecast..." />
      </ScreenContainer>
    );
  }

  const { fixedDone, fixedPending, variable, projectedTotal, budget, breathingRoom, confidence } = forecast;
  const isOverBudget = budget != null && projectedTotal > budget;
  const dayToDayToCome = Math.max(0, projectedTotal - forecast.monthSoFar - fixedPending.total);
  const parts = [
    { key: "spent", label: "Spent so far", amount: forecast.monthSoFar, color: theme.primary },
    { key: "bills", label: "Fixed bills still to come", amount: fixedPending.total, color: theme.warning },
    { key: "daily", label: "Day-to-day still to come", amount: dayToDayToCome, color: theme.alpha("primary", 0.45) },
  ];

  // Find breaching categories
  const breachingCategories = categoryForecast?.breachAlerts.slice(0, 3) ?? [];

  return (
    <ScreenContainer padTop={false}>
      {loadFailed && <LoadFailedBanner onRetry={loadData} />}
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Where the likely total comes from: the three parts add up to it. */}
        <View className="px-4 mt-3">
          <Card>
            <Text className="text-xs text-muted-foreground">Likely spend by month end</Text>
            <Text className="text-title font-bold text-foreground mt-0.5">{formatAmount(projectedTotal)}</Text>

            <View className="mt-3 flex-row h-3 rounded-full overflow-hidden bg-border" style={{ gap: 2 }}>
              {parts.filter((p) => p.amount > 0).map((p) => (
                <View key={p.key} className="h-full" style={{ flex: p.amount, backgroundColor: p.color }} />
              ))}
            </View>
            <View className="mt-2">
              {parts.map((p) => (
                <View key={p.key} className="flex-row items-center py-1">
                  <View className="w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: p.color }} />
                  <Text className="text-sm text-foreground flex-1 mr-2">{p.label}</Text>
                  <Text className="text-sm font-semibold text-foreground">{formatAmount(p.amount)}</Text>
                </View>
              ))}
            </View>

            {budget != null && (
              <Pressable
                onPress={() => router.push("/insights/budget-vs-actual")}
                className="flex-row items-center pt-2.5 mt-1.5 border-t border-border"
                accessibilityRole="button"
                accessibilityLabel="Open Budget vs actual"
              >
                <Text className="text-sm text-muted-foreground flex-1 mr-2">Budget {formatAmount(budget)}</Text>
                <Text className="text-sm font-semibold" style={{ color: isOverBudget ? theme.danger : theme.success }}>
                  {isOverBudget ? `${formatAmount(projectedTotal - budget)} over` : `${formatAmount(budget - projectedTotal)} to spare`}
                </Text>
                <Ionicons name="chevron-forward" size={13} color={theme.faintForeground} style={{ marginLeft: 4 }} />
              </Pressable>
            )}
            <Text className="text-xs text-muted-foreground mt-2">
              Based on {forecast.dataMonths} {forecast.dataMonths === 1 ? "month" : "months"} of your spending
            </Text>
          </Card>
        </View>

        {/* What's gone already */}
        <View className="px-4 mt-4">
          <SectionHeader title={`Spent so far - ${formatAmount(forecast.monthSoFar)}`} />
          <Card>
            <View className="flex-row justify-between py-1">
              <Text className="text-sm text-foreground">Fixed bills paid</Text>
              <Text className="text-sm font-semibold text-foreground">{formatAmount(fixedDone.total)}</Text>
            </View>
            <View className="flex-row justify-between py-1">
              <Text className="text-sm text-foreground">Day-to-day</Text>
              <Text className="text-sm font-semibold text-foreground">{formatAmount(Math.max(0, forecast.monthSoFar - fixedDone.total))}</Text>
            </View>
            {variable.daysLeft > 0 && dayToDayToCome > 0 && (
              <Text className="text-xs text-muted-foreground mt-1.5">
                About {formatAmount(Math.round(dayToDayToCome / variable.daysLeft))} a day for the {variable.daysLeft} {variable.daysLeft === 1 ? "day" : "days"} left
              </Text>
            )}
          </Card>
        </View>

        {/* Fixed Expenses Done */}
        <View className="px-4 mt-4">
          <SectionHeader title={`Fixed bills paid - ${formatAmount(fixedDone.total)}`} />
          <Card>
            {fixedDone.items.length === 0 ? (
              <Text className="text-sm text-muted-foreground">
                No fixed bills paid yet this month.
              </Text>
            ) : (
              fixedDone.items.map((item, idx) => (
                <View
                  key={item.id}
                  className={`flex-row items-center justify-between py-2.5 ${
                    idx < fixedDone.items.length - 1 ? "border-b border-border" : ""
                  }`}
                >
                  <Text className="text-sm text-foreground capitalize flex-1">
                    {item.merchant}
                  </Text>
                  <Text className="text-sm font-bold text-foreground mr-2">
                    {formatAmount(item.actualAmount ?? item.amount)}
                  </Text>
                  <Text className="text-xs text-muted-foreground mr-2">
                    {item.actualDate ? formatDay(item.actualDate) : ""}
                  </Text>
                  <Ionicons name="checkmark-circle" size={16} color={theme.success} />
                </View>
              ))
            )}
          </Card>
        </View>

        {/* Fixed Expenses Pending */}
        <View className="px-4 mt-4">
          <SectionHeader title={`Fixed bills still to come - ${formatAmount(fixedPending.total)}`} />
          <Card>
            {fixedPending.items.length === 0 ? (
              <View className="flex-row items-center gap-2">
                <Ionicons name="checkmark-circle" size={16} color={theme.success} />
                <Text className="text-sm" style={{ color: theme.success }}>
                  All the fixed bills you expect have been paid this month.
                </Text>
              </View>
            ) : (
              fixedPending.items.map((item, idx) => (
                <View
                  key={item.id}
                  className={`flex-row items-center justify-between py-2.5 ${
                    idx < fixedPending.items.length - 1 ? "border-b border-border" : ""
                  }`}
                >
                  <Text className="text-sm text-foreground capitalize flex-1">
                    {item.merchant}
                  </Text>
                  <Text className="text-sm font-bold text-foreground mr-2">
                    {formatAmount(item.amount)}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    ~Day {item.expectedDay}
                  </Text>
                </View>
              ))
            )}
          </Card>
        </View>

        {/* Variable Spending */}
        <View className="px-4 mt-4">
          <SectionHeader title={`Day-to-day spending - ${formatAmount(variable.projected)}`} />
          <Card>
            <View className="gap-1.5 mb-3">
              <MetricLine label="Daily pace" value={`${formatAmount(variable.dailyPace)}/day`} />
              <MetricLine label="Days left" value={String(variable.daysLeft)} />
              <MetricLine label="Projected remaining" value={formatAmount(variable.projected - variable.spentSoFar)} />
            </View>

            {/* Category Paces */}
            {forecast.categoryPaces.length > 0 && (
              <>
                <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-3 mb-2">
                  By Category
                </Text>
                {forecast.categoryPaces.slice(0, 5).map((cp) => (
                  <View key={cp.categoryId} className="flex-row items-center justify-between py-1.5">
                    <Text className="text-xs text-foreground flex-1 mr-2" numberOfLines={1}>
                      {categoryNames.get(cp.categoryId) || "Other"}
                    </Text>
                    <Text className="text-xs text-muted-foreground mr-2" numberOfLines={1}>
                      {formatAmount(cp.dailyPace)}/day
                    </Text>
                    {/* Non-breaking space between the arrow and the figure — a plain space
                        let RN wrap the arrow onto its own line when the figure ran long. */}
                    <Text className="text-xs font-bold text-foreground text-right" numberOfLines={1}>
                      {"→ "}{formatAmount(cp.projected)}
                    </Text>
                  </View>
                ))}
              </>
            )}

            <View className="border-t border-border mt-3 pt-3">
              <MetricLine label="Historical avg" value={`${formatAmount(variable.historicalAvg)}/month`} />
              <MetricLine
                label="Current pace"
                value={`${formatAmount(variable.projected)} (${variable.historicalAvg > 0 ? (variable.projected > variable.historicalAvg ? "+" : "") + Math.round(((variable.projected - variable.historicalAvg) / variable.historicalAvg) * 100) + "%" : "N/A"})`}
              />
              <View className="mt-2">
                <ConfidenceDots level={confidence} />
              </View>
            </View>
          </Card>
        </View>

        {/* Categories at Risk */}
        {breachingCategories.length > 0 && (
          <View className="px-4 mt-4">
            <SectionHeader title="Categories at Risk" />
            {breachingCategories.map((cat) => (
              <Pressable
                key={cat.categoryId}
                onPress={() =>
                  router.push({
                    pathname: "/insights/insight-detail",
                    params: { insightId: `breach_${cat.categoryId}_${forecast.month}`, title: `${categoryNames.get(cat.categoryId) ?? "Category"} Over Budget` },
                  })
                }
                className="mb-2"
              >
                <Card>
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1">
                      <View className="flex-row items-center gap-1.5">
                        <Ionicons name="warning-outline" size={14} color={theme.warning} />
                        <Text className="text-sm font-medium text-foreground">
                          {categoryNames.get(cat.categoryId) ?? "Category"} on pace for {formatAmount(cat.predictedTotal)}
                        </Text>
                      </View>
                      <Text className="text-xs text-muted-foreground mt-0.5 ml-5">
                        Budget: {formatAmount(cat.budget)} ({Math.round((cat.predictedTotal / cat.budget) * 100)}%)
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={theme.faintForeground} />
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        )}

        {/* Action Suggestion */}
        {breachingCategories.length > 0 && (
          <View className="px-4 mt-4">
            <SectionHeader title="Suggestion" />
            <ActionSuggestionCard
              suggestion={`Reduce ${categoryNames.get(breachingCategories[0].categoryId) ?? "spending"} by cutting back ${Math.round(breachingCategories[0].predictedOverspend / (variable.daysLeft || 1))}/day for the rest of the month.`}
              savingsAmount={breachingCategories[0].predictedOverspend}
              difficulty="Medium"
            />
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between items-center">
      <Text className="text-xs text-muted-foreground">{label}:</Text>
      <Text className="text-xs font-medium text-foreground">{value}</Text>
    </View>
  );
}


function formatDay(date: string): string {
  const d = new Date(date);
  return `${d.getDate()} ${d.toLocaleDateString("en-IN", { month: "short" })}`;
}
