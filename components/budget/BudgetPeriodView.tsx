import { useState, useCallback, useMemo, useRef } from "react";
import { View, ScrollView, Pressable } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { PeriodBar } from "@/components/insights/PeriodBar";
import { Amount, Card, EmptyState, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";

import { formatAmount, formatReportShort } from "@/utils/format";
import { insightPeriodLabel, insightPeriodRange, isInsightPeriod, type InsightPeriod } from "@/utils/insight-periods";
import { getFYStartMonth } from "@/services/settings";
import { getSpendClassificationTotals } from "@/services/spend-classification";
import {
  getBudgetVsActual,
  type BudgetVsActualRow,
  type BudgetVsActualResult,
} from "@/services/budget";
import { getExpenseIdsByCategory } from "@/services/expense";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";
import { tint } from "@/constants/brand";

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

/**
 * Budget against spending for any period. Two homes:
 *  - the Budget tab, in place, when Month · 3M · 6M · FY isn't Month (`embedded`, period from the tab);
 *  - its own screen (app/budget/vs-actual.tsx), with every period including a custom one, for Search.
 */
export function BudgetPeriodView({ period: fixedPeriod, embedded = false }: { period?: Period; embedded?: boolean } = {}) {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();

  const params = useLocalSearchParams<{ period?: string }>();
  const [ownPeriod, setPeriod] = useState<Period>(isInsightPeriod(params.period) ? params.period : "this_month");
  const period = fixedPeriod ?? ownPeriod;
  /** Months opened to their exact figures (a tap on the row). */
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
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
  /** All spending in the period, categorised or not: the figure Spending Split and Monthly
   *  Summary show for the same span, so swiping between the pages shows one total. */
  const [allSpent, setAllSpent] = useState<number | null>(null);
  const loadSeq = useRef(0);
  const loadData = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const fySM = getFYStartMonth();
      setFyStartMonth(fySM);
      const r = insightPeriodRange(period, fySM, customStartMonth, customEndMonth);
      const [data, classified] = await Promise.all([
        getBudgetVsActual(DEFAULT_USER_ID, r.startMonth, r.endMonth, r.startDate, r.endDate),
        getSpendClassificationTotals(DEFAULT_USER_ID, r.startDate, r.endDate).catch(() => null),
      ]);
      if (seq !== loadSeq.current) return; // a newer period is loading
      setResult(data);
      setAllSpent(classified ? classified.total : null);
      setLoadFailed(false);
    } catch {
      if (seq !== loadSeq.current) return;
      setLoadFailed(true);
      // DB not ready
    } finally {
      if (seq === loadSeq.current) setLoading(false);
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
  // Categories with neither a budget nor any spending say nothing; they're listed in one line at the end.
  const idleRows = useMemo(
    () => (result ? result.rows.filter((r) => r.totalBudget <= 0 && r.totalActual <= 0) : []),
    [result],
  );
  const sortedRows = useMemo(() => {
    if (!result) return [];
    const copy = result.rows.filter((r) => r.totalBudget > 0 || r.totalActual > 0);
    // The same "expected so far" figure each row shows, so the order matches the labels.
    const expected = (r: BudgetVsActualRow) => (isCurrentMonth ? proratedBudget(r.totalBudget) : r.totalBudget);
    switch (sortOrder) {
      case "overspend":
        return copy.sort((a, b) => (b.totalActual - expected(b)) - (a.totalActual - expected(a)));
      case "spent":
        return copy.sort((a, b) => b.totalActual - a.totalActual);
      case "alpha":
        return copy.sort((a, b) => a.categoryName.localeCompare(b.categoryName));
    }
  }, [result, sortOrder, isCurrentMonth]);

  const budgetForSummary = isCurrentMonth && result
    ? proratedBudget(result.totalBudget)
    : result?.totalBudget ?? 0;

  // The hero total: everything spent, as on the other Budget pages. Categories below add up to
  // the part that has a category; the note under the total says how much hasn't.
  const spentTotal = Math.max(allSpent ?? 0, result?.totalActual ?? 0);
  const notInCategories = spentTotal - (result?.totalActual ?? 0);
  const variance = spentTotal - budgetForSummary;
  const isOver = variance > 0;

  if (loading) {
    return embedded ? <LoadingState message="Loading budget..." /> : <ScreenContainer padTop={false}><LoadingState message="Loading budget..." /></ScreenContainer>;
  }

  const hasAnyData = result && (result.rows.length > 0 || result.unbudgetedRows.length > 0);

  return (
    <Wrap embedded={embedded}>
      {loadFailed && <LoadFailedBanner onRetry={loadData} />}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80, paddingTop: embedded ? 12 : 0 }}>

        {!embedded && <PeriodBar
          period={period}
          fyStartMonth={fyStartMonth}
          customStart={customStartMonth}
          customEnd={customEndMonth}
          onPeriod={(p) => { setPeriod(p); setLoading(true); }}
          onCustomStart={(m) => { setCustomStartMonth(m); setLoading(true); }}
          onCustomEnd={(m) => { setCustomEndMonth(m); setLoading(true); }}
        />}

        {!hasAnyData ? (
          <EmptyState
            icon="wallet-outline"
            title="No budget data"
            subtitle="Set a budget for this period in Budget Config to see your tracking here."
            fillScreen={false}
          />
        ) : (
          <>
            {/* ── Summary: one hero figure, the rest on a line below (numbers never wrap) ── */}
            <View className="px-4 mb-3">
              <Card>
                <Text className="text-label text-muted-foreground mb-0.5">
                  {isCurrentMonth ? "Spent so far" : `Spent · ${getPeriodLabel(period)}`}
                </Text>
                <View className="flex-row items-baseline" style={{ gap: 10 }}>
                  <Amount value={spentTotal} className="text-hero font-bold text-foreground flex-shrink" />
                  {budgetForSummary > 0 && (
                    <Text className="text-meta font-bold ml-auto" style={{ color: isOver ? theme.danger : theme.success }}>
                      {Math.round((spentTotal / budgetForSummary) * 100)}%
                    </Text>
                  )}
                </View>
                {budgetForSummary > 0 && (
                  <Text className="text-meta text-muted-foreground mt-1">
                    {isCurrentMonth ? "Expected by today " : "Budget "}
                    {formatAmount(budgetForSummary)}
                    {" · "}
                    <Text className="text-meta" style={{ color: isOver ? theme.danger : theme.success }}>
                      {isOver ? "over by " : "under by "}
                      {formatAmount(Math.abs(variance))}
                    </Text>
                  </Text>
                )}
                {notInCategories >= 1 && (
                  <Text className="text-label text-muted-foreground mt-0.5">
                    {`Includes ${formatAmount(notInCategories)} not in a budget category`}
                  </Text>
                )}
                {isCurrentMonth && result && result.totalBudget > 0 && (
                  <Text className="text-label text-muted-foreground mt-0.5">
                    {`Day ${new Date().getDate()} of ${new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()} · full month ${formatAmount(result.totalBudget)}`}
                  </Text>
                )}
                {result && result.totalBudget > 0 && (
                  <View className="h-2 rounded-full overflow-hidden mt-3" style={{ backgroundColor: theme.border }}>
                    <View
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, Math.round((spentTotal / budgetForSummary) * 100))}%`,
                        backgroundColor: isOver ? theme.danger : theme.primary,
                      }}
                    />
                  </View>
                )}
              </Card>
            </View>

            {/* ── Monthly bar chart (multi-month only) ─── */}
            {result && result.monthly.length > 1 && (
              <View className="px-4 mb-3">
                <Card>
                  <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Month by Month
                  </Text>
                  {result.monthly.map((mo) => {
                    const moOver = mo.actual > mo.budget && mo.budget > 0;
                    // The bar is the share of that month's budget spent (full when over, or with no budget).
                    const barPct = mo.budget > 0 ? Math.min(100, Math.round((mo.actual / mo.budget) * 100)) : mo.actual > 0 ? 100 : 0;
                    const open = openMonths.has(mo.month);
                    return (
                      <Pressable
                        key={mo.month}
                        onPress={() =>
                          setOpenMonths((now) => {
                            const next = new Set(now);
                            if (next.has(mo.month)) next.delete(mo.month);
                            else next.add(mo.month);
                            return next;
                          })
                        }
                        className="mb-3"
                        accessibilityRole="button"
                        accessibilityState={{ expanded: open }}
                        accessibilityLabel={`${shortMonth(mo.month)}, ${formatAmount(mo.actual)} of ${formatAmount(mo.budget)}`}
                      >
                        <View className="flex-row items-baseline mb-1.5" style={{ gap: 8 }}>
                          <Text className="text-meta font-medium text-muted-foreground w-9">{shortMonth(mo.month)}</Text>
                          <Text className="text-meta flex-1" numberOfLines={1}>
                            <Text className="text-meta font-bold" style={{ color: moOver ? theme.danger : theme.foreground }}>
                              {formatReportShort(mo.actual)}
                            </Text>
                            <Text className="text-meta text-muted-foreground">{mo.budget > 0 ? ` of ${formatReportShort(mo.budget)}` : ""}</Text>
                          </Text>
                          {mo.budget > 0 && (
                            <Text className="text-label font-bold" style={{ color: moOver ? theme.danger : theme.primary }}>
                              {Math.round((mo.actual / mo.budget) * 100)}%
                            </Text>
                          )}
                        </View>
                        <View className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: theme.border }}>
                          <View
                            className="h-full rounded-full"
                            style={{
                              width: `${barPct}%`,
                              backgroundColor: moOver ? theme.danger : theme.primary,
                              minWidth: mo.actual > 0 ? 4 : 0,
                            }}
                          />
                        </View>
                        {open && (
                          <View className="mt-2 rounded-control px-3 py-2" style={{ backgroundColor: theme.alpha("foreground", 0.05), gap: 2 }}>
                            <Text className="text-meta text-foreground">
                              Spent {formatAmount(mo.actual)}
                              {mo.budget > 0 ? ` of ${formatAmount(mo.budget)}` : ", no budget set"}
                            </Text>
                            {mo.budget > 0 && (
                              <Text className="text-meta" style={{ color: moOver ? theme.danger : theme.success }}>
                                {moOver ? "Over by " : "Under by "}
                                {formatAmount(Math.abs(mo.actual - mo.budget))}
                              </Text>
                            )}
                            <Pressable
                              onPress={() => router.push({ pathname: "/budget/transactions", params: { filterMonth: mo.month, title: `Spending · ${shortMonth(mo.month)}` } })}
                              hitSlop={6}
                              accessibilityRole="button"
                            >
                              <Text className="text-meta font-semibold mt-1" style={{ color: theme.primary }}>See its transactions</Text>
                            </Pressable>
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                  <Text className="text-label text-muted-foreground">Tap a month for its exact figures</Text>
                </Card>
              </View>
            )}

            {/* ── Sort controls ─────────────────────────── */}
            {result && result.rows.length > 1 && (
              <View className="px-4 mb-2 flex-row items-center gap-2">
                <Text className="text-label text-muted-foreground">Sort:</Text>
                {(Object.keys(SORT_LABELS) as SortOrder[]).map((s) => {
                  const selected = sortOrder === s;
                  return (
                    <Pressable
                      key={s}
                      onPress={() => setSortOrder(s)}
                      className="px-2.5 py-1 rounded-full border"
                      style={{
                        backgroundColor: selected ? theme.alpha("primary", 0.1) : "transparent",
                        borderColor: selected ? theme.primary : theme.border,
                      }}
                    >
                      <Text
                        className="text-label font-medium"
                        style={{ color: selected ? theme.primary : theme.mutedForeground }}
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
                <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-2">
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
                {idleRows.length > 0 && (
                  <Text className="text-label text-muted-foreground mt-1 mb-2">
                    No budget and nothing spent: {idleRows.map((r) => r.categoryName).join(", ")}
                  </Text>
                )}
              </View>
            )}

            {/* ── Unbudgeted spend ──────────────────────── */}
            {result && result.unbudgetedRows.length > 0 && (
              <View className="px-4 mb-2">
                <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  No Budget Set
                </Text>
                {[...result.unbudgetedRows]
                  .sort((a, b) => b.totalActual - a.totalActual)
                  .map((row) => (
                    <Pressable key={row.categoryId} onPress={() => drillDown(row)}>
                      <Card className="mb-2 py-2.5">
                        <View className="flex-row items-center">
                          <View
                            className="w-8 h-8 rounded-full items-center justify-center mr-3"
                            style={{ backgroundColor: tint(row.categoryColor, 0.09) }}
                          >
                            <Ionicons
                              name={row.categoryIcon as any}
                              size={16}
                              color={row.categoryColor}
                            />
                          </View>
                          <Text className="flex-1 text-body font-medium text-foreground">
                            {row.categoryName}
                          </Text>
                          <Text className="text-body font-semibold mr-2" style={{ color: theme.danger }}>
                            {formatAmount(row.totalActual)}
                          </Text>
                          <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
                        </View>
                      </Card>
                    </Pressable>
                  ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </Wrap>
  );
}

function Wrap({ embedded, children }: { embedded: boolean; children: React.ReactNode }) {
  return embedded ? <View style={{ flex: 1 }}>{children}</View> : <ScreenContainer padTop={false}>{children}</ScreenContainer>;
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
  const noBudget = row.totalBudget <= 0 && row.totalActual > 0;
  const isOver = noBudget || (row.totalActual > reference && reference > 0);
  const variance = row.totalActual - (isCurrentMonth ? prorated : row.totalBudget);
  const barColor = isOver ? theme.danger : ratio >= 0.8 ? theme.warning : theme.primary;

  return (
    <Pressable onPress={onPress} className="mb-2">
    <Card className="py-3">
      {/* Header row */}
      <View className="flex-row items-center mb-2">
        <View
          className="w-8 h-8 rounded-full items-center justify-center mr-2.5"
          style={{ backgroundColor: tint(row.categoryColor, 0.09) }}
        >
          <Ionicons name={row.categoryIcon as any} size={15} color={row.categoryColor} />
        </View>
        <Text className="flex-1 text-body font-medium text-foreground" numberOfLines={1}>
          {row.categoryName}
        </Text>
        <Text
          className="text-label font-semibold ml-2"
          style={{ color: isOver ? theme.danger : variance < 0 ? theme.success : theme.mutedForeground }}
        >
          {noBudget
            ? "no budget"
            : isOver
            ? `+${formatAmount(Math.abs(variance))} over`
            : variance < 0
            ? `${formatAmount(Math.abs(variance))} left`
            : "on track"}
        </Text>
        <Ionicons name="chevron-forward" size={13} color={theme.mutedForeground} className="ml-1" />
      </View>

      {/* Progress bar */}
      <View
        className="h-2 rounded-full overflow-hidden mb-1.5"
        style={{ backgroundColor: theme.border }}
      >
        <View
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </View>

      {/* Amounts */}
      <View className="flex-row items-center justify-between">
        <Text className="text-label text-muted-foreground">
          {formatAmount(row.totalActual)} spent
        </Text>
        <Text className="text-label text-muted-foreground">
          {isCurrentMonth && prorated !== row.totalBudget
            ? `${formatAmount(prorated)} exp. · ${formatAmount(row.totalBudget)} budget`
            : `${formatAmount(row.totalBudget)} budget`}
        </Text>
      </View>
    </Card>
    </Pressable>
  );
}
