import { useState, useCallback, useMemo } from "react";
import { View, ScrollView, Pressable, Modal } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { PeriodBar } from "@/components/insights/PeriodBar";
import { Card, EmptyState, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";

import { formatAmount } from "@/utils/format";
import { insightPeriodLabel, insightPeriodRange, isInsightPeriod, type InsightPeriod } from "@/utils/insight-periods";
import { getFYStartMonth } from "@/services/settings";
import {
  getBudgetVsActual,
  type BudgetVsActualRow,
  type BudgetVsActualResult,
} from "@/services/budget";
import { getExpenseIdsByCategory } from "@/services/expense";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = InsightPeriod;
type SortOrder = "overspend" | "spent" | "alpha";

const SORT_LABELS: Record<SortOrder, string> = {
  overspend: "Overspend",
  spent: "Most Spent",
  alpha: "A–Z",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function proratedBudget(totalBudget: number): number {
  const now = new Date();
  const daysElapsed = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.round((totalBudget * daysElapsed) / daysInMonth);
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortMonth(yyyyMM: string): string {
  const m = parseInt(yyyyMM.split("-")[1], 10);
  return MONTH_NAMES[m - 1] ?? yyyyMM;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BudgetVsActualScreen() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();

  const params = useLocalSearchParams<{ period?: string }>();
  const [period, setPeriod] = useState<Period>(isInsightPeriod(params.period) ? params.period : "this_month");
  const [sortOrder, setSortOrder] = useState<SortOrder>("overspend");
  const [result, setResult] = useState<BudgetVsActualResult | null>(null);
  const [fyStartMonth, setFyStartMonth] = useState(4);
  const [loading, setLoading] = useState(true);
  const [customStartMonth, setCustomStartMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [customEndMonth, setCustomEndMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [showMonthPicker, setShowMonthPicker] = useState<"start" | "end" | null>(null);

  const getPeriodLabel = useCallback((p: Period): string => insightPeriodLabel(p, fyStartMonth), [fyStartMonth]);

  const range = useMemo(
    () => insightPeriodRange(period, fyStartMonth, customStartMonth, customEndMonth),
    [period, fyStartMonth, customStartMonth, customEndMonth],
  );
  const isCurrentMonth = range.endMonth === range.startMonth &&
    range.startMonth === (() => {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
    })();

  const [loadFailed, setLoadFailed] = useState(false);
  const loadData = useCallback(async () => {
    try {
      const fySM = getFYStartMonth();
      setFyStartMonth(fySM);
      const r = insightPeriodRange(period, fySM, customStartMonth, customEndMonth);
      const data = await getBudgetVsActual(
        DEFAULT_USER_ID,
        r.startMonth,
        r.endMonth,
        r.startDate,
        r.endDate,
      );
      setResult(data);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      // DB not ready
    } finally {
      setLoading(false);
    }
  }, [period, customStartMonth, customEndMonth]);

  useDataRefresh(loadData);

  const drillDown = useCallback(async (row: BudgetVsActualRow) => {
    try {
      const ids = await getExpenseIdsByCategory(
        DEFAULT_USER_ID,
        row.categoryId,
        range.startDate,
        range.endDate,
      );
      if (ids.length === 0) return;
      router.push({
        pathname: "/insights/filtered",
        params: {
          expenseIds: ids.join(","),
          title: `${row.categoryName} · ${getPeriodLabel(period)}`,
        },
      });
    } catch {
      // silently ignore — DB not ready
    }
  }, [range, period, router, getPeriodLabel]);

  // Sorted category rows
  const sortedRows = useMemo(() => {
    if (!result) return [];
    const copy = [...result.rows];
    switch (sortOrder) {
      case "overspend":
        return copy.sort((a, b) => (b.totalActual - b.totalBudget) - (a.totalActual - a.totalBudget));
      case "spent":
        return copy.sort((a, b) => b.totalActual - a.totalActual);
      case "alpha":
        return copy.sort((a, b) => a.categoryName.localeCompare(b.categoryName));
    }
  }, [result, sortOrder]);

  const budgetForSummary = isCurrentMonth && result
    ? proratedBudget(result.totalBudget)
    : result?.totalBudget ?? 0;

  const variance = (result?.totalActual ?? 0) - budgetForSummary;
  const isOver = variance > 0;

  if (loading) {
    return <ScreenContainer padTop={false}><LoadingState message="Loading budget..." /></ScreenContainer>;
  }

  const hasAnyData = result && (result.rows.length > 0 || result.unbudgetedRows.length > 0);

  return (
    <ScreenContainer padTop={false}>
      {loadFailed && <LoadFailedBanner onRetry={loadData} />}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>

        <PeriodBar
          period={period}
          fyStartMonth={fyStartMonth}
          customStart={customStartMonth}
          customEnd={customEndMonth}
          onPeriod={(p) => { setPeriod(p); setLoading(true); }}
          onCustomStart={(m) => { setCustomStartMonth(m); setLoading(true); }}
          onCustomEnd={(m) => { setCustomEndMonth(m); setLoading(true); }}
        />

        {!hasAnyData ? (
          <EmptyState
            icon="wallet-outline"
            title="No budget data"
            subtitle="Set a budget for this period in Budget Config to see your tracking here."
            fillScreen={false}
          />
        ) : (
          <>
            {/* ── Summary card ─────────────────────────── */}
            <View className="px-4 mb-3">
              <Card>
                {isCurrentMonth && result && result.totalBudget > 0 && (
                  <Text className="text-xs text-muted-foreground mb-2">
                    {`Day ${new Date().getDate()} of ${new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()} — prorated budget`}
                  </Text>
                )}
                <View className="flex-row justify-between mb-3">
                  <View className="flex-1">
                    <Text className="text-xs text-muted-foreground mb-0.5">
                      {isCurrentMonth ? "Expected to date" : "Total Budget"}
                    </Text>
                    <Text className="text-lg font-bold text-foreground">
                      {formatAmount(budgetForSummary)}
                    </Text>
                    {isCurrentMonth && result && result.totalBudget > 0 && (
                      <Text className="text-xs text-muted-foreground">
                        Full month: {formatAmount(result.totalBudget)}
                      </Text>
                    )}
                  </View>
                  <View className="flex-1 items-center">
                    <Text className="text-xs text-muted-foreground mb-0.5">
                      Spent
                    </Text>
                    <Text className="text-lg font-bold text-foreground">
                      {formatAmount(result?.totalActual ?? 0)}
                    </Text>
                  </View>
                  <View className="flex-1 items-end">
                    <Text className="text-xs text-muted-foreground mb-0.5">
                      {isOver ? "Over by" : "Under by"}
                    </Text>
                    <Text
                      className="text-lg font-bold"
                      style={{ color: isOver ? theme.danger : theme.success }}
                    >
                      {formatAmount(Math.abs(variance))}
                    </Text>
                  </View>
                </View>

                {/* Aggregate progress bar */}
                {result && result.totalBudget > 0 && (
                  <View className="mt-1">
                    <View
                      className="h-2 rounded-full overflow-hidden"
                      style={{ backgroundColor: colors.border }}
                    >
                      <View
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, Math.round(((result.totalActual) / budgetForSummary) * 100))}%`,
                          backgroundColor: isOver ? theme.danger : theme.primary,
                        }}
                      />
                    </View>
                    <Text className="text-xs text-muted-foreground mt-1 text-right">
                      {result.totalBudget > 0
                        ? `${Math.round((result.totalActual / budgetForSummary) * 100)}% of ${isCurrentMonth ? "prorated " : ""}budget`
                        : ""}
                    </Text>
                  </View>
                )}
              </Card>
            </View>

            {/* ── Monthly bar chart (multi-month only) ─── */}
            {result && result.monthly.length > 1 && (
              <View className="px-4 mb-3">
                <Card>
                  <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Month by Month
                  </Text>
                  {result.monthly.map((mo) => {
                    const moOver = mo.actual > mo.budget && mo.budget > 0;
                    const barMax = Math.max(mo.budget, mo.actual, 1);
                    return (
                      <Pressable
                        key={mo.month}
                        onPress={() => router.push({ pathname: "/summary/my-month", params: { month: mo.month } })}
                        className="mb-3"
                        accessibilityRole="button"
                        accessibilityLabel={`${shortMonth(mo.month)}, ${formatAmount(mo.actual)} of ${formatAmount(mo.budget)}. Open My Month`}
                      >
                        <View className="flex-row items-center justify-between mb-1">
                          <Text className="text-xs font-medium text-muted-foreground w-8">
                            {shortMonth(mo.month)}
                          </Text>
                          <View className="flex-1 mx-2">
                            {/* Budget bar */}
                            <View className="flex-row items-center mb-0.5">
                              <View
                                className="h-1.5 rounded-full"
                                style={{
                                  width: `${Math.round((mo.budget / barMax) * 100)}%`,
                                  backgroundColor: colors.border,
                                  minWidth: mo.budget > 0 ? 4 : 0,
                                }}
                              />
                            </View>
                            {/* Actual bar */}
                            <View className="flex-row items-center">
                              <View
                                className="h-2 rounded-full"
                                style={{
                                  width: `${Math.round((mo.actual / barMax) * 100)}%`,
                                  backgroundColor: moOver ? theme.danger : theme.primary,
                                  minWidth: mo.actual > 0 ? 4 : 0,
                                }}
                              />
                            </View>
                          </View>
                          <View className="items-end" style={{ width: 72 }}>
                            <Text
                              className="text-xs font-semibold"
                              style={{ color: moOver ? theme.danger : colors.text }}
                            >
                              {formatAmount(mo.actual)}
                            </Text>
                            <Text className="text-xs text-muted-foreground">
                              / {formatAmount(mo.budget)}
                            </Text>
                          </View>
                        </View>
                      </Pressable>
                    );
                  })}
                  <View className="flex-row items-center gap-3 mt-1">
                    <View className="flex-row items-center gap-1.5">
                      <View className="w-4 h-1.5 rounded-full" style={{ backgroundColor: colors.border }} />
                      <Text className="text-xs text-muted-foreground">Budget</Text>
                    </View>
                    <View className="flex-row items-center gap-1.5">
                      <View className="w-4 h-2 rounded-full" style={{ backgroundColor: theme.primary }} />
                      <Text className="text-xs text-muted-foreground">Actual</Text>
                    </View>
                  </View>
                </Card>
              </View>
            )}

            {/* ── Sort controls ─────────────────────────── */}
            {result && result.rows.length > 1 && (
              <View className="px-4 mb-2 flex-row items-center gap-2">
                <Text className="text-xs text-muted-foreground">Sort:</Text>
                {(Object.keys(SORT_LABELS) as SortOrder[]).map((s) => {
                  const selected = sortOrder === s;
                  return (
                    <Pressable
                      key={s}
                      onPress={() => setSortOrder(s)}
                      className="px-2.5 py-1 rounded-full border"
                      style={{
                        backgroundColor: selected ? theme.alpha("primary", 0.1) : "transparent",
                        borderColor: selected ? theme.primary : colors.border,
                      }}
                    >
                      <Text
                        className="text-xs font-medium"
                        style={{ color: selected ? theme.primary : colors.textSecondary }}
                      >
                        {SORT_LABELS[s]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* ── Category rows ─────────────────────────── */}
            {result && sortedRows.length > 0 && (
              <View className="px-4 mb-2">
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  By Category
                </Text>
                {sortedRows.map((row) => (
                  <CategoryRow
                    key={row.categoryId}
                    row={row}
                    isCurrentMonth={isCurrentMonth}
                    colors={colors}
                    onPress={() => drillDown(row)}
                  />
                ))}
              </View>
            )}

            {/* ── Unbudgeted spend ──────────────────────── */}
            {result && result.unbudgetedRows.length > 0 && (
              <View className="px-4 mb-2">
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  No Budget Set
                </Text>
                {result.unbudgetedRows
                  .sort((a, b) => b.totalActual - a.totalActual)
                  .map((row) => (
                    <Pressable key={row.categoryId} onPress={() => drillDown(row)}>
                      <Card className="mb-2 py-2.5">
                        <View className="flex-row items-center">
                          <View
                            className="w-8 h-8 rounded-full items-center justify-center mr-3"
                            style={{ backgroundColor: row.categoryColor + "18" }}
                          >
                            <Ionicons
                              name={row.categoryIcon as any}
                              size={16}
                              color={row.categoryColor}
                            />
                          </View>
                          <Text className="flex-1 text-sm font-medium text-foreground">
                            {row.categoryName}
                          </Text>
                          <Text className="text-sm font-semibold mr-2" style={{ color: theme.danger }}>
                            {formatAmount(row.totalActual)}
                          </Text>
                          <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
                        </View>
                      </Card>
                    </Pressable>
                  ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

// ─── Category Row ─────────────────────────────────────────────────────────────

function CategoryRow({
  row,
  isCurrentMonth,
  colors,
  onPress,
}: {
  row: BudgetVsActualRow;
  isCurrentMonth: boolean;
  colors: any;
  onPress: () => void;
}) {
  const theme = useTheme();
  const prorated = isCurrentMonth ? proratedBudget(row.totalBudget) : row.totalBudget;
  const reference = prorated > 0 ? prorated : row.totalBudget;
  const ratio = reference > 0 ? row.totalActual / reference : row.totalActual > 0 ? 1 : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const isOver = row.totalActual > reference && reference > 0;
  const variance = row.totalActual - (isCurrentMonth ? prorated : row.totalBudget);
  const barColor = isOver ? theme.danger : ratio >= 0.8 ? theme.warning : theme.primary;

  return (
    <Pressable onPress={onPress} className="mb-2">
    <Card className="py-3">
      {/* Header row */}
      <View className="flex-row items-center mb-2">
        <View
          className="w-8 h-8 rounded-full items-center justify-center mr-2.5"
          style={{ backgroundColor: row.categoryColor + "18" }}
        >
          <Ionicons name={row.categoryIcon as any} size={15} color={row.categoryColor} />
        </View>
        <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={1}>
          {row.categoryName}
        </Text>
        <Text
          className="text-xs font-semibold ml-2"
          style={{ color: isOver ? theme.danger : variance < 0 ? theme.success : colors.textSecondary }}
        >
          {isOver
            ? `+${formatAmount(Math.abs(variance))} over`
            : variance < 0
            ? `-${formatAmount(Math.abs(variance))} left`
            : "on track"}
        </Text>
        <Ionicons name="chevron-forward" size={13} color={colors.textSecondary} className="ml-1" />
      </View>

      {/* Progress bar */}
      <View
        className="h-2 rounded-full overflow-hidden mb-1.5"
        style={{ backgroundColor: colors.border }}
      >
        <View
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </View>

      {/* Amounts */}
      <View className="flex-row items-center justify-between">
        <Text className="text-xs text-muted-foreground">
          {formatAmount(row.totalActual)} spent
        </Text>
        <Text className="text-xs text-muted-foreground">
          {isCurrentMonth && prorated !== row.totalBudget
            ? `${formatAmount(prorated)} exp. · ${formatAmount(row.totalBudget)} budget`
            : `${formatAmount(row.totalBudget)} budget`}
        </Text>
      </View>
    </Card>
    </Pressable>
  );
}
