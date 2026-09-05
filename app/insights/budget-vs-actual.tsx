import { useState, useCallback, useMemo } from "react";
import { View, ScrollView, Pressable, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { Card, EmptyState, LoadingState, ScreenContainer, Sheet, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";

import { formatAmount } from "@/utils/format";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { getCurrentFY, getFYRange, getFYLabel, formatLocalDate } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";
import {
  getBudgetVsActual,
  type BudgetVsActualRow,
  type BudgetVsActualResult,
} from "@/services/budget";
import { getExpenseIdsByCategory } from "@/services/expense";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = "this_month" | "last_3m" | "last_6m" | "this_fy" | "last_fy" | "custom";
type SortOrder = "overspend" | "spent" | "alpha";

const SORT_LABELS: Record<SortOrder, string> = {
  overspend: "Overspend",
  spent: "Most Spent",
  alpha: "A–Z",
};

const PERIODS: Period[] = ["this_month", "last_3m", "last_6m", "this_fy", "last_fy", "custom"];

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPeriodRange(
  period: Period,
  fyStartMonth: number,
  customStart?: string,
  customEnd?: string,
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
    case "custom": {
      const sm = customStart ?? currentMonth;
      const em = customEnd ?? currentMonth;
      const endIsCurrentMonth = em >= currentMonth;
      return {
        startMonth: sm,
        endMonth: em,
        startDate: getMonthDateRange(sm).startDate,
        endDate: endIsCurrentMonth ? todayStr : getMonthDateRange(em).endDate,
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
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();

  const [period, setPeriod] = useState<Period>("this_month");
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

  const fyLabels = useMemo(() => {
    const thisYear = getCurrentFY(fyStartMonth);
    return {
      this_fy: getFYLabel(thisYear, fyStartMonth),
      last_fy: getFYLabel(thisYear - 1, fyStartMonth),
    };
  }, [fyStartMonth]);

  const getPeriodLabel = useCallback((p: Period): string => {
    if (p === "this_fy") return fyLabels.this_fy;
    if (p === "last_fy") return fyLabels.last_fy;
    if (p === "custom") return "Custom";
    const labels: Record<Period, string> = {
      this_month: "This Month", last_3m: "Last 3M", last_6m: "Last 6M",
      this_fy: "", last_fy: "", custom: "",
    };
    return labels[p];
  }, [fyLabels, customStartMonth, customEndMonth]);

  const range = useMemo(
    () => getPeriodRange(period, fyStartMonth, customStartMonth, customEndMonth),
    [period, fyStartMonth, customStartMonth, customEndMonth],
  );
  const isCurrentMonth = range.endMonth === range.startMonth &&
    range.startMonth === (() => {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
    })();

  const loadData = useCallback(async () => {
    try {
      const fySM = getFYStartMonth();
      setFyStartMonth(fySM);
      const r = getPeriodRange(period, fySM, customStartMonth, customEndMonth);
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
      } as never);
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
                  backgroundColor: selected ? theme.primary : "transparent",
                  borderColor: selected ? theme.primary : colors.border,
                }}
              >
                <Text
                  className="text-sm font-semibold"
                  style={{ color: selected ? "#fff" : colors.textSecondary }}
                >
                  {getPeriodLabel(p)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* ── Custom range selectors ────────────────── */}
        {period === "custom" && (
          <View className="flex-row items-center px-4 pb-2 gap-2">
            <Text className="text-xs text-muted-foreground">From</Text>
            <Pressable
              onPress={() => setShowMonthPicker("start")}
              className="flex-row items-center px-3 py-1.5 rounded-lg border"
              style={{ borderColor: colors.border }}
            >
              <Text className="text-sm font-medium text-foreground mr-1">
                {`${MONTH_SHORT[parseInt(customStartMonth.split("-")[1], 10) - 1]} ${customStartMonth.split("-")[0]}`}
              </Text>
              <Ionicons name="chevron-down" size={13} color={colors.textSecondary} />
            </Pressable>
            <Text className="text-xs text-muted-foreground">to</Text>
            <Pressable
              onPress={() => setShowMonthPicker("end")}
              className="flex-row items-center px-3 py-1.5 rounded-lg border"
              style={{ borderColor: colors.border }}
            >
              <Text className="text-sm font-medium text-foreground mr-1">
                {`${MONTH_SHORT[parseInt(customEndMonth.split("-")[1], 10) - 1]} ${customEndMonth.split("-")[0]}`}
              </Text>
              <Ionicons name="chevron-down" size={13} color={colors.textSecondary} />
            </Pressable>
          </View>
        )}

        {/* ── Month picker modal ────────────────────── */}
        <Sheet visible={showMonthPicker !== null} onClose={() => setShowMonthPicker(null)}>
              <MiniMonthPicker
                value={showMonthPicker === "start" ? customStartMonth : customEndMonth}
                maxMonth={showMonthPicker === "start" ? customEndMonth : undefined}
                minMonth={showMonthPicker === "end" ? customStartMonth : undefined}
                label={showMonthPicker === "start" ? "Start Month" : "End Month"}
                colors={colors}
                onSelect={(v) => {
                  if (showMonthPicker === "start") setCustomStartMonth(v);
                  else setCustomEndMonth(v);
                  setShowMonthPicker(null);
                  setLoading(true);
                }}
                onCancel={() => setShowMonthPicker(null)}
              />
        </Sheet>

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
                      <View key={mo.month} className="mb-3">
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
                      </View>
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

// ─── Mini Month Picker ────────────────────────────────────────────────────────

function MiniMonthPicker({
  value,
  minMonth,
  maxMonth,
  label,
  colors,
  onSelect,
  onCancel,
}: {
  value: string;
  minMonth?: string;
  maxMonth?: string;
  label: string;
  colors: any;
  onSelect: (v: string) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [y, m] = value.split("-").map(Number);
  const [pickerYear, setPickerYear] = useState(y);
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const minYear = minMonth ? parseInt(minMonth.split("-")[0], 10) : undefined;
  const maxYear = maxMonth ? parseInt(maxMonth.split("-")[0], 10) : undefined;

  return (
    <View className="px-4 pt-5 pb-4">
      <Text className="text-base font-bold text-foreground mb-4">{label}</Text>

      {/* Year navigation */}
      <View className="flex-row items-center justify-between mb-4">
        <Pressable
          onPress={() => setPickerYear((v) => v - 1)}
          disabled={minYear !== undefined && pickerYear <= minYear}
          className="p-2"
          style={minYear !== undefined && pickerYear <= minYear ? { opacity: 0.25 } : undefined}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </Pressable>
        <Text className="text-lg font-bold text-foreground">{pickerYear}</Text>
        <Pressable
          onPress={() => setPickerYear((v) => v + 1)}
          disabled={maxYear !== undefined && pickerYear >= maxYear}
          className="p-2"
          style={maxYear !== undefined && pickerYear >= maxYear ? { opacity: 0.25 } : undefined}
        >
          <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* Month grid */}
      <View className="flex-row flex-wrap mb-4">
        {MONTH_SHORT.map((name, idx) => {
          const monthNum = idx + 1;
          const monthVal = `${pickerYear}-${String(monthNum).padStart(2, "0")}`;
          const isSelected = pickerYear === y && monthNum === m;
          const isCurrent = monthVal === currentMonth;
          const isDisabled = (minMonth && monthVal < minMonth) || (maxMonth && monthVal > maxMonth);
          return (
            <Pressable
              key={name}
              onPress={() => !isDisabled && onSelect(monthVal)}
              disabled={!!isDisabled}
              className="w-1/3 items-center py-2.5"
              style={isDisabled ? { opacity: 0.25 } : undefined}
            >
              <View
                className={`w-16 py-2 rounded-xl items-center ${isSelected ? "" : isCurrent ? "border" : ""}`}
                style={
                  isSelected
                    ? { backgroundColor: theme.primary }
                    : isCurrent
                    ? { borderColor: theme.primary }
                    : undefined
                }
              >
                <Text
                  className="text-sm font-semibold"
                  style={{
                    color: isSelected ? "#fff" : isCurrent ? theme.primary : colors.text,
                  }}
                >
                  {name}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={onCancel}
        className="py-3 rounded-xl bg-background items-center"
      >
        <Text className="text-sm font-semibold text-muted-foreground">Cancel</Text>
      </Pressable>
    </View>
  );
}
