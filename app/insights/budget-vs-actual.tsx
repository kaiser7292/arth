import { useState, useCallback, useMemo } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ScreenContainer, Card, LoadingState, EmptyState } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { StatusColors } from "@/constants/theme";
import { formatAmount } from "@/utils/format";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { getCurrentFY, getFYRange, formatLocalDate } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";
import {
  getBudgetVsActual,
  type BudgetVsActualRow,
  type BudgetVsActualResult,
} from "@/services/budget";
import { DEFAULT_USER_ID } from "@/constants/app";

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = "this_month" | "last_3m" | "last_6m" | "this_fy" | "last_fy";
type SortOrder = "overspend" | "spent" | "alpha";

const PERIOD_LABELS: Record<Period, string> = {
  this_month: "This Month",
  last_3m: "Last 3M",
  last_6m: "Last 6M",
  this_fy: "This FY",
  last_fy: "Last FY",
};

const SORT_LABELS: Record<SortOrder, string> = {
  overspend: "Overspend",
  spent: "Most Spent",
  alpha: "A–Z",
};

const PERIODS: Period[] = ["this_month", "last_3m", "last_6m", "this_fy", "last_fy"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPeriodRange(
  period: Period,
  fyStartMonth: number,
): { startMonth: string; endMonth: string; startDate: string; endDate: string } {
  const now = new Date();
  const todayStr = formatLocalDate(now);
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  const currentMonth = `${y}-${pad(m)}`;

  const toMonthStr = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

  switch (period) {
    case "this_month": {
      const { startDate } = getMonthDateRange(currentMonth);
      return { startMonth: currentMonth, endMonth: currentMonth, startDate, endDate: todayStr };
    }
    case "last_3m": {
      const sm = toMonthStr(new Date(y, m - 3, 1));
      return { startMonth: sm, endMonth: currentMonth, startDate: getMonthDateRange(sm).startDate, endDate: todayStr };
    }
    case "last_6m": {
      const sm = toMonthStr(new Date(y, m - 6, 1));
      return { startMonth: sm, endMonth: currentMonth, startDate: getMonthDateRange(sm).startDate, endDate: todayStr };
    }
    case "this_fy": {
      const fyYear = getCurrentFY(fyStartMonth);
      const { start } = getFYRange(fyYear, fyStartMonth);
      const sm = toMonthStr(start);
      return { startMonth: sm, endMonth: currentMonth, startDate: getMonthDateRange(sm).startDate, endDate: todayStr };
    }
    case "last_fy": {
      const fyYear = getCurrentFY(fyStartMonth) - 1;
      const { start, end } = getFYRange(fyYear, fyStartMonth);
      const sm = toMonthStr(start);
      const em = toMonthStr(end);
      return {
        startMonth: sm,
        endMonth: em,
        startDate: getMonthDateRange(sm).startDate,
        endDate: getMonthDateRange(em).endDate,
      };
    }
  }
}

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
  const { colors, accent, colorScheme } = useColorScheme();
  const sc = StatusColors[colorScheme];

  const [period, setPeriod] = useState<Period>("this_month");
  const [sortOrder, setSortOrder] = useState<SortOrder>("overspend");
  const [result, setResult] = useState<BudgetVsActualResult | null>(null);
  const [fyStartMonth, setFyStartMonth] = useState(4);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => getPeriodRange(period, fyStartMonth), [period, fyStartMonth]);
  const isCurrentMonth = range.endMonth === range.startMonth &&
    range.startMonth === (() => {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
    })();

  const loadData = useCallback(async () => {
    try {
      const fySM = getFYStartMonth();
      setFyStartMonth(fySM);
      const r = getPeriodRange(period, fySM);
      const data = await getBudgetVsActual(
        DEFAULT_USER_ID,
        r.startMonth,
        r.endMonth,
        r.startDate,
        r.endDate,
      );
      setResult(data);
    } catch {
      // DB not ready
    } finally {
      setLoading(false);
    }
  }, [period]);

  useDataRefresh(loadData);

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
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>

        {/* ── Period chips ─────────────────────────────── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}
        >
          {PERIODS.map((p) => {
            const selected = period === p;
            return (
              <Pressable
                key={p}
                onPress={() => { setPeriod(p); setLoading(true); }}
                className="px-4 py-2 rounded-full border"
                style={{
                  backgroundColor: selected ? accent[500] : "transparent",
                  borderColor: selected ? accent[500] : colors.border,
                }}
              >
                <Text
                  className="text-sm font-semibold"
                  style={{ color: selected ? "#fff" : colors.textSecondary }}
                >
                  {PERIOD_LABELS[p]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

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
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-2">
                    {`Day ${new Date().getDate()} of ${new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()} — prorated budget`}
                  </Text>
                )}
                <View className="flex-row justify-between mb-3">
                  <View className="flex-1">
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-0.5">
                      {isCurrentMonth ? "Expected to date" : "Total Budget"}
                    </Text>
                    <Text className="text-lg font-bold text-text-primary dark:text-text-dark-primary">
                      {formatAmount(budgetForSummary)}
                    </Text>
                    {isCurrentMonth && result && result.totalBudget > 0 && (
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                        Full month: {formatAmount(result.totalBudget)}
                      </Text>
                    )}
                  </View>
                  <View className="flex-1 items-center">
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-0.5">
                      Spent
                    </Text>
                    <Text className="text-lg font-bold text-text-primary dark:text-text-dark-primary">
                      {formatAmount(result?.totalActual ?? 0)}
                    </Text>
                  </View>
                  <View className="flex-1 items-end">
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-0.5">
                      {isOver ? "Over by" : "Under by"}
                    </Text>
                    <Text
                      className="text-lg font-bold"
                      style={{ color: isOver ? sc.danger : sc.success }}
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
                          backgroundColor: isOver ? sc.danger : accent[500],
                        }}
                      />
                    </View>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-1 text-right">
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
                  <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary mb-3">
                    Month by Month
                  </Text>
                  {result.monthly.map((mo) => {
                    const moOver = mo.actual > mo.budget && mo.budget > 0;
                    const barMax = Math.max(mo.budget, mo.actual, 1);
                    return (
                      <View key={mo.month} className="mb-3">
                        <View className="flex-row items-center justify-between mb-1">
                          <Text className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary w-8">
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
                                  backgroundColor: moOver ? sc.danger : accent[500],
                                  minWidth: mo.actual > 0 ? 4 : 0,
                                }}
                              />
                            </View>
                          </View>
                          <View className="items-end" style={{ width: 72 }}>
                            <Text
                              className="text-xs font-semibold"
                              style={{ color: moOver ? sc.danger : colors.text }}
                            >
                              {formatAmount(mo.actual)}
                            </Text>
                            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                              / {formatAmount(mo.budget)}
                            </Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                  <View className="flex-row items-center gap-3 mt-1">
                    <View className="flex-row items-center gap-1.5">
                      <View className="w-4 h-1.5 rounded-full" style={{ backgroundColor: colors.border }} />
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Budget</Text>
                    </View>
                    <View className="flex-row items-center gap-1.5">
                      <View className="w-4 h-2 rounded-full" style={{ backgroundColor: accent[500] }} />
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Actual</Text>
                    </View>
                  </View>
                </Card>
              </View>
            )}

            {/* ── Sort controls ─────────────────────────── */}
            {result && result.rows.length > 1 && (
              <View className="px-4 mb-2 flex-row items-center gap-2">
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Sort:</Text>
                {(Object.keys(SORT_LABELS) as SortOrder[]).map((s) => {
                  const selected = sortOrder === s;
                  return (
                    <Pressable
                      key={s}
                      onPress={() => setSortOrder(s)}
                      className="px-2.5 py-1 rounded-full border"
                      style={{
                        backgroundColor: selected ? accent[100] : "transparent",
                        borderColor: selected ? accent[400] : colors.border,
                      }}
                    >
                      <Text
                        className="text-xs font-medium"
                        style={{ color: selected ? accent[700] : colors.textSecondary }}
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
                <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary mb-2">
                  By Category
                </Text>
                {sortedRows.map((row) => (
                  <CategoryRow
                    key={row.categoryId}
                    row={row}
                    isCurrentMonth={isCurrentMonth}
                    accent={accent}
                    colors={colors}
                    sc={sc}
                  />
                ))}
              </View>
            )}

            {/* ── Unbudgeted spend ──────────────────────── */}
            {result && result.unbudgetedRows.length > 0 && (
              <View className="px-4 mb-2">
                <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary mb-2">
                  No Budget Set
                </Text>
                {result.unbudgetedRows
                  .sort((a, b) => b.totalActual - a.totalActual)
                  .map((row) => (
                    <Card key={row.categoryId} className="mb-2 py-2.5">
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
                        <Text className="flex-1 text-sm font-medium text-text-primary dark:text-text-dark-primary">
                          {row.categoryName}
                        </Text>
                        <Text className="text-sm font-semibold" style={{ color: sc.danger }}>
                          {formatAmount(row.totalActual)}
                        </Text>
                      </View>
                    </Card>
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
  accent,
  colors,
  sc,
}: {
  row: BudgetVsActualRow;
  isCurrentMonth: boolean;
  accent: any;
  colors: any;
  sc: any;
}) {
  const prorated = isCurrentMonth ? proratedBudget(row.totalBudget) : row.totalBudget;
  const reference = prorated > 0 ? prorated : row.totalBudget;
  const ratio = reference > 0 ? row.totalActual / reference : row.totalActual > 0 ? 1 : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const isOver = row.totalActual > reference && reference > 0;
  const variance = row.totalActual - (isCurrentMonth ? prorated : row.totalBudget);
  const barColor = isOver ? sc.danger : ratio >= 0.8 ? sc.warning : accent[500];

  return (
    <Card className="mb-2 py-3">
      {/* Header row */}
      <View className="flex-row items-center mb-2">
        <View
          className="w-8 h-8 rounded-full items-center justify-center mr-2.5"
          style={{ backgroundColor: row.categoryColor + "18" }}
        >
          <Ionicons name={row.categoryIcon as any} size={15} color={row.categoryColor} />
        </View>
        <Text className="flex-1 text-sm font-medium text-text-primary dark:text-text-dark-primary" numberOfLines={1}>
          {row.categoryName}
        </Text>
        <Text
          className="text-xs font-semibold ml-2"
          style={{ color: isOver ? sc.danger : variance < 0 ? sc.success : colors.textSecondary }}
        >
          {isOver
            ? `+${formatAmount(Math.abs(variance))} over`
            : variance < 0
            ? `-${formatAmount(Math.abs(variance))} left`
            : "on track"}
        </Text>
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
        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
          {formatAmount(row.totalActual)} spent
        </Text>
        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
          {isCurrentMonth && prorated !== row.totalBudget
            ? `${formatAmount(prorated)} exp. · ${formatAmount(row.totalBudget)} budget`
            : `${formatAmount(row.totalBudget)} budget`}
        </Text>
      </View>
    </Card>
  );
}
