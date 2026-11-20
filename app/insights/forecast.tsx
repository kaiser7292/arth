import { useState, useCallback, useRef } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Card, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { useDataRefresh } from "@/hooks/use-data-refresh";

import { getAnalyticsForecast, type AnalyticsForecast } from "@/services/analytics-forecast";
import { getCategories } from "@/services/category";
import { getActiveClassifications } from "@/services/analytics/classifier";
import { forecastCategoryRealistic } from "@/services/analytics/forecast-engine-v2";
import { getBudgetsForMonth } from "@/services/budget";
import { getMonthEndForecast } from "@/services/forecast-engine";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getDatabase } from "@/database";
import type { Expense } from "@/services/expense-types";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { formatAmount } from "@/utils/format";
import { useTheme } from "@/hooks/use-theme";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";

/** A category likely to end the month over its budget. */
interface AtRisk {
  categoryId: string;
  spent: number;
  budget: number;
  likely: number;
}

/**
 * Forecast (Nov 2026 redesign, "Arth Insights"): the likely month-end total with its three parts as
 * one bar against the budget, the day-to-day pace, the bills still to come, and the categories likely
 * to go over. Every part opens what's behind it, down to the transactions.
 */
export default function ForecastDetailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [forecast, setForecast] = useState<AnalyticsForecast | null>(null);
  const [monthRows, setMonthRows] = useState<Expense[]>([]);
  const [atRisk, setAtRisk] = useState<AtRisk[]>([]);
  const [categoryNames, setCategoryNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [paidOpen, setPaidOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Record<string, number>>({});

  const [loadFailed, setLoadFailed] = useState(false);
  const loadData = useCallback(async () => {
    try {
      const [fData, cats] = await Promise.all([getAnalyticsForecast(DEFAULT_USER_ID), getCategories(DEFAULT_USER_ID)]);
      setForecast(fData);
      setCategoryNames(new Map(cats.map((c) => [c.id, c.name])));

      // This month's spending, the rows behind "Spent so far" and each category's figure.
      const { startDate, endDate } = getMonthDateRange(fData.month);
      const expenses = await getDatabase().getAllAsync<Expense>(
        `SELECT * FROM expenses WHERE user_id = ? AND date >= ? AND date <= ? AND status = 'approved' AND nature = 'realized' AND (expenses.reclassified_as_transfer IS NULL OR expenses.reclassified_as_transfer = 0) AND NOT EXISTS (SELECT 1 FROM expense_investment_links il WHERE il.expense_id = expenses.id) AND COALESCE(expenses.money_event, '') NOT IN ('fd_open', 'sip', 'investment', 'self_transfer') AND deleted_at IS NULL ORDER BY date DESC;`,
        DEFAULT_USER_ID, startDate, endDate,
      );
      setMonthRows(expenses);
      const spentBy = new Map<string, number>();
      for (const e of expenses) if (e.category_id) spentBy.set(e.category_id, (spentBy.get(e.category_id) ?? 0) + e.amount);

      const classifications = await getActiveClassifications(DEFAULT_USER_ID);
      if (classifications.length > 0) {
        const budgets = await getBudgetsForMonth(DEFAULT_USER_ID, fData.month);
        const v2 = forecastCategoryRealistic(expenses, classifications, budgets, fData.month);
        setAtRisk(
          v2
            .filter((c) => c.budget != null && c.totalProjected > c.budget!)
            .map((c) => ({ categoryId: c.categoryId, spent: spentBy.get(c.categoryId) ?? 0, budget: c.budget!, likely: c.totalProjected }))
            .sort((a, b) => b.likely - b.budget - (a.likely - a.budget)),
        );
      } else {
        const old = await getMonthEndForecast(DEFAULT_USER_ID);
        setAtRisk(old.breachAlerts.map((b) => ({ categoryId: b.categoryId, spent: b.spentSoFar, budget: b.budget, likely: b.predictedTotal })));
      }
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useDataRefresh(loadData);

  const openRows = useCallback(
    (rows: Expense[], title: string) => {
      if (rows.length === 0) return;
      router.push({ pathname: "/insights/filtered", params: { expenseIds: rows.map((e) => e.id).join(","), title } });
    },
    [router],
  );
  const scrollTo = (key: string) => {
    const y = sectionY.current[key];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  };

  if (loading || !forecast) {
    return (
      <ScreenContainer padTop={false}>
        {loadFailed && <LoadFailedBanner onRetry={loadData} />}
        <LoadingState message="Loading forecast..." />
      </ScreenContainer>
    );
  }

  const { fixedDone, fixedPending, variable, projectedTotal, budget, confidence } = forecast;
  const isOver = budget != null && projectedTotal > budget;
  const dayToDayToCome = Math.max(0, projectedTotal - forecast.monthSoFar - fixedPending.total);
  const [y, mo] = forecast.month.split("-").map(Number);
  const daysInMonth = new Date(y, mo, 0).getDate();
  const monthEnd = new Date(y, mo - 1, daysInMonth).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const room = budget != null ? Math.max(0, budget - projectedTotal) : 0;
  const parts = [
    { key: "spent", label: "Spent so far", amount: forecast.monthSoFar, color: theme.foreground, onPress: () => openRows(monthRows, "Spent this month") },
    { key: "bills", label: "Bills to come", amount: fixedPending.total, color: theme.warning, onPress: () => scrollTo("bills") },
    { key: "daily", label: "Day-to-day left", amount: dayToDayToCome, color: theme.alpha("primary", 0.55), onPress: () => scrollTo("pace") },
  ];
  const usualPerDay = variable.historicalAvg > 0 ? variable.historicalAvg / daysInMonth : null;
  const toStayIn = budget != null && variable.daysLeft > 0 ? (budget - forecast.monthSoFar - fixedPending.total) / variable.daysLeft : null;
  const worst = atRisk[0];
  const worstName = worst ? categoryNames.get(worst.categoryId) ?? "This category" : "";
  const confLabel = `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)} confidence · ${forecast.dataMonths} ${forecast.dataMonths === 1 ? "month" : "months"} of data`;

  return (
    <ScreenContainer padTop={false}>
      {loadFailed && <LoadFailedBanner onRetry={loadData} />}
      <ScrollView ref={scrollRef} className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 16, paddingTop: 12, gap: 12 }}>
        {/* The likely total and its three parts, as one bar measured against the budget. */}
        <Card>
          <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground">Likely by {monthEnd}</Text>
          <Text className="text-hero font-bold text-foreground mt-1.5" numberOfLines={1} adjustsFontSizeToFit>{formatAmount(projectedTotal)}</Text>
          <View className="flex-row flex-wrap mt-1.5" style={{ gap: 8 }}>
            {budget != null && (
              <View className="rounded-pill px-2.5 py-0.5" style={{ backgroundColor: theme.alpha(isOver ? "danger" : "success", 0.08) }}>
                <Text className="text-meta font-semibold" style={{ color: isOver ? theme.danger : theme.success }}>
                  {isOver ? `${formatAmount(projectedTotal - budget)} over budget` : `${formatAmount(budget - projectedTotal)} under budget`}
                </Text>
              </View>
            )}
            <View className="rounded-pill px-2.5 py-0.5" style={{ backgroundColor: theme.alpha("foreground", 0.05) }}>
              <Text className="text-meta font-semibold text-muted-foreground">{confLabel}</Text>
            </View>
          </View>

          <View className="flex-row rounded-pill overflow-hidden mt-4" style={{ height: 14, gap: 2, backgroundColor: theme.border }}>
            {parts.filter((p) => p.amount > 0).map((p) => (
              <Pressable key={p.key} onPress={p.onPress} style={{ flex: p.amount, backgroundColor: p.color }} accessibilityRole="button" accessibilityLabel={`${p.label}, ${formatAmount(p.amount)}`} />
            ))}
            {room > 0 && <View style={{ flex: room }} />}
          </View>
          {budget != null && (
            <View className="flex-row justify-between mt-1.5">
              <Text className="text-label text-muted-foreground">₹0</Text>
              <Text className="text-label text-muted-foreground">Budget {formatAmount(budget)}</Text>
            </View>
          )}
          <View className="mt-2" style={{ gap: 2 }}>
            {parts.map((p) => (
              <Pressable key={p.key} onPress={p.onPress} className="flex-row items-center" style={{ minHeight: 36, gap: 8 }} accessibilityRole="button" accessibilityLabel={`${p.label}, ${formatAmount(p.amount)}`}>
                <View className="w-2.5 h-2.5 rounded-pill" style={{ backgroundColor: p.color }} />
                <Text className="text-meta text-foreground flex-1">{p.label}</Text>
                <Text className="text-body font-semibold text-foreground">{formatAmount(p.amount)}</Text>
                <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
              </Pressable>
            ))}
            {budget != null && room > 0 && (
              <View className="flex-row items-center" style={{ minHeight: 36, gap: 8 }}>
                <View className="w-2.5 h-2.5 rounded-pill" style={{ backgroundColor: theme.border }} />
                <Text className="text-meta text-foreground flex-1">Room left</Text>
                <Text className="text-body font-semibold text-foreground">{formatAmount(room)}</Text>
                <View style={{ width: 14 }} />
              </View>
            )}
          </View>
        </Card>

        {/* Day-to-day pace */}
        <View onLayout={(e) => (sectionY.current.pace = e.nativeEvent.layout.y)}>
          <Card>
            <View className="flex-row justify-between items-baseline mb-3">
              <Text className="text-body font-bold text-foreground">Day-to-day pace</Text>
              <Text className="text-meta text-muted-foreground">{variable.daysLeft} {variable.daysLeft === 1 ? "day" : "days"} left</Text>
            </View>
            <View className="flex-row" style={{ gap: 8 }}>
              <PaceTile label="This month" value={`${formatAmount(Math.round(variable.dailyPace))}/day`} />
              {usualPerDay != null && <PaceTile label="Your usual" value={`${formatAmount(Math.round(usualPerDay))}/day`} />}
              {toStayIn != null && <PaceTile label="To stay in" value={toStayIn > 0 ? `${formatAmount(Math.round(toStayIn))}/day` : "Over"} color={toStayIn > 0 ? theme.success : theme.danger} />}
            </View>
            {forecast.categoryPaces.length > 0 && (
              <View className="mt-3 border-t border-border pt-1">
                {forecast.categoryPaces.slice(0, 5).map((cp) => (
                  <Pressable
                    key={cp.categoryId}
                    onPress={() => openRows(monthRows.filter((e) => e.category_id === cp.categoryId), `${categoryNames.get(cp.categoryId) ?? cp.categoryName ?? "Other"} this month`)}
                    className="flex-row items-center"
                    style={{ minHeight: 40, gap: 8 }}
                    accessibilityRole="button"
                  >
                    <Text className="text-meta text-foreground flex-1" numberOfLines={1}>{categoryNames.get(cp.categoryId) || cp.categoryName || "Other"}</Text>
                    <Text className="text-label text-muted-foreground">{formatAmount(Math.round(cp.dailyPace))}/day</Text>
                    <Text className="text-meta font-semibold text-foreground">{"→ "}{formatAmount(Math.round(cp.projected))}</Text>
                    <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
                  </Pressable>
                ))}
              </View>
            )}
            {variable.historicalAvg > 0 && (
              <Text className="text-label text-muted-foreground mt-2">
                Day-to-day usually comes to {formatAmount(Math.round(variable.historicalAvg))} a month; this one is heading for {formatAmount(Math.round(variable.projected))}.
              </Text>
            )}
          </Card>
        </View>

        {/* Bills still to come, then the ones already paid */}
        <View onLayout={(e) => (sectionY.current.bills = e.nativeEvent.layout.y)}>
          <View className="rounded-card bg-card border border-border overflow-hidden">
            <View className="flex-row justify-between items-baseline px-4 pt-4 pb-2">
              <Text className="text-body font-bold text-foreground">Bills still to come · {fixedPending.items.length}</Text>
              <Text className="text-meta font-semibold" style={{ color: fixedPending.total > 0 ? theme.warning : theme.success }}>{formatAmount(fixedPending.total)}</Text>
            </View>
            {fixedPending.items.length === 0 ? (
              <Text className="text-meta px-4 pb-4" style={{ color: theme.success }}>All the regular bills you expect are paid this month.</Text>
            ) : (
              fixedPending.items.map((item) => (
                <View key={item.id} className="flex-row items-center px-4 py-2.5 border-t border-border" style={{ gap: 12 }}>
                  <Text className="text-body text-foreground flex-1 capitalize" numberOfLines={1}>{item.merchant}</Text>
                  <Text className="text-meta text-muted-foreground">~{dayLabel(forecast.month, item.expectedDay)}</Text>
                  <Text className="text-body font-semibold text-foreground" style={{ minWidth: 84, textAlign: "right" }}>{formatAmount(item.amount)}</Text>
                </View>
              ))
            )}
            {fixedDone.items.length > 0 && (
              <Pressable onPress={() => setPaidOpen((o) => !o)} className="flex-row items-center px-4 border-t border-border" style={{ minHeight: 44 }} accessibilityRole="button" accessibilityState={{ expanded: paidOpen }}>
                <Text className="text-meta text-muted-foreground flex-1">
                  {fixedDone.items.length} {fixedDone.items.length === 1 ? "bill" : "bills"} already paid · {formatAmount(fixedDone.total)}
                </Text>
                <Ionicons name={paidOpen ? "chevron-up" : "chevron-down"} size={16} color={theme.mutedForeground} />
              </Pressable>
            )}
            {paidOpen &&
              fixedDone.items.map((item) => {
                const paid = monthRows.find((e) => e.date.slice(0, 10) === item.actualDate?.slice(0, 10) && Math.abs(e.amount - (item.actualAmount ?? item.amount)) < 0.5);
                return (
                  <Pressable
                    key={item.id}
                    onPress={paid ? () => router.push(`/expense/${paid.id}`) : undefined}
                    className="flex-row items-center px-4 py-2.5 border-t border-border"
                    style={{ gap: 12 }}
                    accessibilityRole={paid ? "button" : undefined}
                  >
                    <Ionicons name="checkmark-circle" size={16} color={theme.success} />
                    <Text className="text-body text-foreground flex-1 capitalize" numberOfLines={1}>{item.merchant}</Text>
                    <Text className="text-meta text-muted-foreground">{item.actualDate ? dayOf(item.actualDate) : ""}</Text>
                    <Text className="text-body font-semibold text-foreground">{formatAmount(item.actualAmount ?? item.amount)}</Text>
                    {paid && <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />}
                  </Pressable>
                );
              })}
          </View>
        </View>

        {/* Categories likely to go over */}
        {atRisk.length > 0 && (
          <View className="rounded-card bg-card border border-border overflow-hidden">
            <Text className="text-body font-bold text-foreground px-4 pt-4 pb-2">Likely to go over · {atRisk.length}</Text>
            {atRisk.slice(0, 5).map((c) => {
              const name = categoryNames.get(c.categoryId) ?? "Category";
              return (
                <Pressable
                  key={c.categoryId}
                  onPress={() => router.push({ pathname: "/insights/insight-detail", params: { insightId: `breach_${c.categoryId}_${forecast.month}`, title: `${name} over budget` } })}
                  className="px-4 pt-2.5 pb-3 border-t border-border"
                  style={{ gap: 6 }}
                  accessibilityRole="button"
                  accessibilityLabel={`${name}, likely ${formatAmount(c.likely - c.budget)} over`}
                >
                  <View className="flex-row justify-between">
                    <Text className="text-body font-semibold text-foreground">{name}</Text>
                    <Text className="text-body font-semibold" style={{ color: theme.danger }}>{formatAmount(Math.round(c.likely - c.budget))} over</Text>
                  </View>
                  <View className="rounded-pill overflow-hidden" style={{ height: 6, backgroundColor: theme.border }}>
                    <View style={{ height: 6, width: `${Math.min(100, (c.spent / c.budget) * 100)}%`, backgroundColor: c.spent > c.budget ? theme.danger : theme.warning }} />
                  </View>
                  <Text className="text-label text-muted-foreground">
                    Likely {formatAmount(Math.round(c.likely))} of {formatAmount(c.budget)} · {formatAmount(Math.round(c.spent))} spent
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {worst && (
          <View className="flex-row rounded-control p-3" style={{ gap: 10, backgroundColor: theme.alpha("primary", 0.07) }}>
            <Ionicons name="bulb-outline" size={18} color={theme.primary} />
            <Text className="text-meta text-foreground flex-1">
              {worst.spent >= worst.budget
                ? `${worstName} is already ${formatAmount(Math.round(worst.spent - worst.budget))} over its budget. Holding off for the ${variable.daysLeft} days left saves about ${formatAmount(Math.round(Math.max(0, worst.likely - worst.spent)))} more.`
                : `Keep ${worstName} to ${formatAmount(Math.round((worst.budget - worst.spent) / Math.max(1, variable.daysLeft)))} a day for the rest of the month and it stays within budget.`}
            </Text>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function PaceTile({ label, value, color }: { label: string; value: string; color?: string }) {
  const theme = useTheme();
  return (
    <View className="flex-1 rounded-control p-2.5" style={{ backgroundColor: theme.background, minWidth: 0 }}>
      <Text className="text-label text-muted-foreground" numberOfLines={1}>{label}</Text>
      <Text className="text-body font-bold" style={{ color: color ?? theme.foreground }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

/** "24 Nov" for a day of the forecast's month. */
function dayLabel(month: string, day: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function dayOf(date: string): string {
  const d = new Date(date);
  return `${d.getDate()} ${d.toLocaleDateString("en-IN", { month: "short" })}`;
}
