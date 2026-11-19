import { isPartOn } from "@/services/customise";
import { useCustomisation } from "@/hooks/use-customisation";
import { useState, useCallback, useMemo, useRef } from "react";

import { View, ScrollView, Pressable, Switch, RefreshControl, Modal, TextInput } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, Chip, ChipWrap, ContextualHeader, FieldRow, PeriodNavigator, ProgressBar, ScreenContainer, SwipePager, Text } from "@/components/ui";
import { tint } from "@/constants/brand";
import { AnimatedNumber, Nudge, PressableScale } from "@/components/motion";
import { FoldGroup } from "@/components/ui/FormParts";
import { staggerDelay } from "@/components/motion/motion";
import { SpendingSplitPage } from "@/components/budget/SpendingSplitPage";
import { MonthlySummaryPage } from "@/components/budget/MonthlySummaryPage";
import { useColorScheme } from "@/hooks/use-color-scheme";


import { useDataRefresh } from "@/hooks/use-data-refresh";
import { getCategories } from "@/services/category";
import { getBudgetsForMonth, getCurrentMonth, getMonthlyBudgetTotals } from "@/services/budget";
import { getExpenseTotalsByCategory, getExpenseTotal, getUncategorizedTotal, getUncategorizedCount, getMonthlyExpenseTotals } from "@/services/expense";
import { getMonthSplit, type MonthSplit } from "@/services/month-split";
import { getYearlyPlanByFY } from "@/services/yearly-plan";
import type { YearlyPlan } from "@/services/yearly-plan";
import type { Category } from "@/services/category";
import { formatAmount } from "@/utils/expense-validation";
import { calculateMonthlyCompliance } from "@/utils/budget-compliance";
import type { MonthlyComplianceSnapshot } from "@/utils/budget-compliance";
import { getCurrentFY, getFYRange, getFiscalMonth } from "@/utils/fiscal-year";
import { getFYStartMonth, getBudgetWidgets, setBudgetWidgets, clearCollapsibleState, getBudgetCategorySort, setBudgetCategorySort, bumpDataVersion, getDataVersion } from "@/services/settings";
import type { BudgetWidgetId, BudgetCategorySort } from "@/services/settings";
import {
  getMonthDateRange,
  getDaysElapsed,
  getDaysRemaining,
  getTotalDaysInMonth,
  getBudgetStatus,
  getBudgetStatusColor,
  getPerDayRemaining,
} from "@/utils/budget-helpers";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getAnalyticsForecast, type AnalyticsForecast } from "@/services/analytics-forecast";
import { upsertBudget } from "@/services/budget";
import { useTheme } from "@/hooks/use-theme";
import { peekHomeTotals } from "@/services/home-preload";
import { Rows } from "@/components/ui/Rows";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";

interface BudgetDashboardRow {
  category: Category;
  budget: number;
  spent: number;
}

const WIDGET_CONFIG: { id: BudgetWidgetId; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "summary", label: "Budget Summary", icon: "wallet-outline" },
  { id: "projection", label: "Month-End Projection", icon: "trending-up-outline" },
];

export default function BudgetScreen() {
  const router = useRouter();
  const { colors, colorScheme } = useColorScheme();
  const theme = useTheme();
  const [month, setMonth] = useState(getCurrentMonth());
  const [rows, setRows] = useState<BudgetDashboardRow[]>([]);
  // Seeded from Home preload's already-computed current-month totals so the
  // header numbers don't flash 0 while loadData's full Promise.all resolves.
  const homeTotalsPeek = peekHomeTotals();
  const initialTotals =
    homeTotalsPeek && homeTotalsPeek.month === getCurrentMonth() ? homeTotalsPeek : null;
  const [totalBudget, setTotalBudget] = useState(initialTotals?.totalBudget ?? 0);
  const [totalSpent, setTotalSpent] = useState(initialTotals?.totalSpent ?? 0);
  const [uncategorized, setUncategorized] = useState(0);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [yearlyPlan, setYearlyPlan] = useState<YearlyPlan | null>(null);
  const [annualSpentYTD, setAnnualSpentYTD] = useState(0);
  const [visibleWidgets, setVisibleWidgets] = useState<BudgetWidgetId[]>(getBudgetWidgets);
  const [showWidgetManager, setShowWidgetManager] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [v2Forecast, setV2Forecast] = useState<AnalyticsForecast | null>(null);
  const [rollingSurplus, setRollingSurplus] = useState<number>(0);
  const [sortBy, setSortBy] = useState<BudgetCategorySort>(getBudgetCategorySort);
  const [quickBudgetRow, setQuickBudgetRow] = useState<BudgetDashboardRow | null>(null);
  const [quickBudgetAmount, setQuickBudgetAmount] = useState("");
  const quickBudgetInputRef = useRef<TextInput>(null);
  const [activePageIndex, setActivePageIndex] = useState(0);
  useCustomisation();
  const budgetPages = [
    { key: "overview", label: "Overview" },
    ...(isPartOn("budget_split") ? [{ key: "split", label: "Spending Split" }] : []),
    ...(isPartOn("budget_monthly") ? [{ key: "monthly", label: "Monthly Summary" }] : []),
  ];
  const [visitedSplit, setVisitedSplit] = useState(false);
  const [visitedMonthly, setVisitedMonthly] = useState(false);

  const WIDGET_STORAGE_KEYS: Record<BudgetWidgetId, string> = {
    summary: "budget_summary",
    projection: "budget_projection",
  };

  const toggleWidget = useCallback((id: BudgetWidgetId) => {
    setVisibleWidgets((prev) => {
      const isRemoving = prev.includes(id);
      if (isRemoving) {
        clearCollapsibleState(WIDGET_STORAGE_KEYS[id]);
      }
      const next = isRemoving
        ? prev.filter((w) => w !== id)
        : [...prev, id];
      setBudgetWidgets(next);
      return next;
    });
  }, []);

  const removeWidget = useCallback((id: BudgetWidgetId) => {
    clearCollapsibleState(WIDGET_STORAGE_KEYS[id]);
    setVisibleWidgets((prev) => {
      const next = prev.filter((w) => w !== id);
      setBudgetWidgets(next);
      return next;
    });
    // Close the drawer after X-button removal
    setShowWidgetManager(false);
  }, []);

  const { startDate, endDate } = getMonthDateRange(month);
  const daysRemaining = getDaysRemaining(month);
  const daysTotal = getTotalDaysInMonth(month);
  const daysElapsed = getDaysElapsed(month);
  // A month that has fully passed — no days left to spread a budget over.
  const isPastMonth = daysRemaining === 0;

  const [loadFailed, setLoadFailed] = useState(false);
  /**
   * The month's EMIs (the budget's fixed part, from the loan schedules) and the unavoidable /
   * discretionary split of spending. EMIs never fill a category budget.
   */
  const [monthSplit, setMonthSplit] = useState<MonthSplit | null>(null);
  const loadData = useCallback(async () => {
    try {
      // Pre-compute FY date ranges synchronously so all queries fire in one batch
      const fyStartMonth = getFYStartMonth();
      const fy = getCurrentFY(fyStartMonth);
      const { start: fyStartDate, end: fyEndDate } = getFYRange(fy, fyStartMonth);
      const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const fyStartStr = fmt(fyStartDate);
      const fyEndStr = fmt(fyEndDate);
      const rangeStartMonthStr = `${fyStartDate.getFullYear()}-${String(fyStartDate.getMonth() + 1).padStart(2, "0")}`;
      const [currentY, currentM] = month.split("-").map(Number);
      const prevMonthDate = new Date(currentY, currentM - 2, 1);
      const shouldComputeSurplus = prevMonthDate >= fyStartDate;
      const rangeEndMonthStr = shouldComputeSurplus
        ? `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`
        : "";
      const surplusStartDate = shouldComputeSurplus ? getMonthDateRange(rangeStartMonthStr).startDate : "";
      const surplusEndDate = shouldComputeSurplus && rangeEndMonthStr ? getMonthDateRange(rangeEndMonthStr).endDate : "";

      // Single parallel round-trip for all data
      const [
        categories, budgets, actuals, total, uncat, uncatCount,
        forecast, plan, ytd, budgetTotals, spendTotals,
      ] = await Promise.all([
        getCategories(DEFAULT_USER_ID),
        getBudgetsForMonth(DEFAULT_USER_ID, month),
        getExpenseTotalsByCategory(DEFAULT_USER_ID, startDate, endDate),
        getExpenseTotal(DEFAULT_USER_ID, startDate, endDate),
        getUncategorizedTotal(DEFAULT_USER_ID, startDate, endDate),
        getUncategorizedCount(DEFAULT_USER_ID),
        getAnalyticsForecast(DEFAULT_USER_ID, month).catch(() => null),
        getYearlyPlanByFY(DEFAULT_USER_ID, String(fy)).catch(() => null),
        getExpenseTotal(DEFAULT_USER_ID, fyStartStr, fyEndStr).catch(() => 0),
        shouldComputeSurplus
          ? getMonthlyBudgetTotals(DEFAULT_USER_ID, rangeStartMonthStr, rangeEndMonthStr).catch(() => new Map<string, number>())
          : Promise.resolve(new Map<string, number>()),
        shouldComputeSurplus
          ? getMonthlyExpenseTotals(DEFAULT_USER_ID, surplusStartDate, surplusEndDate).catch(() => new Map<string, number>())
          : Promise.resolve(new Map<string, number>()),
      ]);

      // Compute derived values in-memory
      const budgetMap = new Map(budgets.map((b) => [b.category_id, b.amount]));
      const actualMap = new Map(actuals.map((a) => [a.category_id, a.total]));
      // Budgets are set on top-level categories; a sub-category's spending is already in its parent's total.
      const merged: BudgetDashboardRow[] = categories.filter((cat) => !cat.parent_id).map((cat) => ({
        category: cat,
        budget: budgetMap.get(cat.id) ?? 0,
        spent: actualMap.get(cat.id) ?? 0,
      }));
      let surplus = 0;
      if (shouldComputeSurplus) {
        for (const [mStr, mBudgetTotal] of budgetTotals.entries()) {
          if (mBudgetTotal > 0) surplus += mBudgetTotal - (spendTotals.get(mStr) ?? 0);
        }
      }

      // Single batch of state updates → single re-render
      setRows(merged);
      setTotalBudget(budgets.reduce((sum, b) => sum + b.amount, 0));
      setTotalSpent(total);
      setUncategorized(uncat);
      setUncategorizedCount(uncatCount);
      setV2Forecast(forecast);
      setYearlyPlan(plan);
      setAnnualSpentYTD(plan ? ytd : 0);
      setRollingSurplus(surplus);
      setLoadFailed(false);
      // Only adds the breakdown; never in the way of the budget itself.
      getMonthSplit(month)
        .then(setMonthSplit)
        .catch(() => setMonthSplit(null));
    } catch {
      setLoadFailed(true);
      // Database not ready
    }
  }, [month, startDate, endDate]);

  // Keyed on the viewed period. The previous in-callback guard asked only "has anything
  // been written?", and changing the month writes nothing - so switching period left the
  // previous month's numbers on screen.
  useDataRefresh(loadData, { skipKey: `${month}|${startDate}|${endDate}` });

  // monthLabel kept for any non-header usage downstream
  const monthLabel = (() => {
    const [year, m] = month.split("-").map(Number);
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    return `${months[m - 1]} ${year}`;
  })();

  const isCurrentMonth = month === getCurrentMonth();

  // Budget compliance projection
  const compliance: MonthlyComplianceSnapshot | null = useMemo(() => {
    if (totalBudget <= 0) return null;

    const startMonth = getFYStartMonth();
    const monthsElapsedFY = getFiscalMonth(startMonth);

    return calculateMonthlyCompliance({
      daysElapsed,
      daysTotal,
      spentSoFar: totalSpent,
      monthlyBudget: totalBudget,
      ...(yearlyPlan
        ? {
            annualIncome:
              yearlyPlan.annual_salary_in_hand + yearlyPlan.expected_bonus,
            annualBudget: yearlyPlan.total_planned_expenses,
            annualSpentYTD,
            monthsElapsed: monthsElapsedFY,
          }
        : {}),
    });
  }, [totalSpent, totalBudget, daysElapsed, daysTotal, yearlyPlan, annualSpentYTD]);

  const displayRows = useMemo(() => {
    const visible = rows.filter((r) => r.budget > 0 || r.spent > 0);
    return [...visible].sort((a, b) => {
      switch (sortBy) {
        case "alphabetical":
          return a.category.name.localeCompare(b.category.name);
        case "budget_desc":
          return b.budget - a.budget;
        case "spent_amount":
          return b.spent - a.spent;
        case "spent_pct": {
          const aPct = a.budget > 0 ? a.spent / a.budget : a.spent > 0 ? 2 : 0;
          const bPct = b.budget > 0 ? b.spent / b.budget : b.spent > 0 ? 2 : 0;
          return bPct - aPct;
        }
        default: {
          const aOver = a.budget > 0 && a.spent > a.budget ? 1 : 0;
          const bOver = b.budget > 0 && b.spent > b.budget ? 1 : 0;
          if (aOver !== bOver) return bOver - aOver;
          return b.spent - a.spent;
        }
      }
    });
  }, [rows, sortBy]);

  const hiddenCount = rows.length - displayRows.length;

  const overallStatus = getBudgetStatus(totalSpent, totalBudget);
  const overallColor = getBudgetStatusColor(overallStatus);
  const overallPct = totalBudget > 0 ? totalSpent / totalBudget : 0;
  const perDayRemaining = getPerDayRemaining(totalBudget, totalSpent, daysRemaining);

  const budgetBadgeTone: "danger" | "warning" | "success" = overallStatus === "over" ? "danger" : overallStatus === "warning" ? "warning" : "success";
  const budgetBadgeLabel = overallStatus === "over" ? "Over" : overallStatus === "warning" ? "Watch" : "On track";

  // Money out = EMIs + spending. EMIs count at what was paid; planned counts what's due.
  const emis = monthSplit?.emis;
  const hasEmis = !!emis && (emis.paid > 0 || emis.due > 0);
  const moneyOut = totalSpent + (emis && hasEmis ? emis.paid : 0);
  const planned = totalBudget + (emis && hasEmis ? emis.due : 0);
  const left = totalBudget - totalSpent;
  const projected = isCurrentMonth ? v2Forecast?.projectedTotal ?? compliance?.projectedMonthEnd ?? null : null;
  const projectedOver = projected != null && totalBudget > 0 && projected > totalBudget;
  const saveQuickBudget = async () => {
    const amt = parseFloat(quickBudgetAmount);
    if (!quickBudgetRow || isNaN(amt) || amt <= 0) return;
    await upsertBudget({ user_id: DEFAULT_USER_ID, category_id: quickBudgetRow.category.id, month, amount: amt });
    bumpDataVersion();
    setQuickBudgetRow(null);
  };
  // Whole rupees on the Budget tab: paise made the figures wrap or get cut (owner, Nov 2026).
  const rs = (n: number) => formatAmount(Math.round(n));
  const signedAmt = (n: number) => (n >= 0 ? rs(n) : `−${rs(Math.abs(n))}`);

  return (
    <ScreenContainer>
      {loadFailed && <LoadFailedBanner onRetry={loadData} />}
      <ContextualHeader
        title="Budget"
        rightActions={
          activePageIndex === 0
            ? [
                {
                  icon: "apps-outline",
                  onPress: () => setShowWidgetManager((v) => !v),
                  color: showWidgetManager ? theme.primary : theme.mutedForeground,
                },
              ]
            : []
        }
      />
      <PeriodNavigator mode="month" value={month} onChange={setMonth} />

      {/* What shows on Overview, and how categories sort (only on Overview) */}
      {activePageIndex === 0 && showWidgetManager && (
        <View className="mx-4 mt-2 mb-1 p-3 rounded-card bg-card border border-border">
          <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-1">Show on Overview</Text>
          {WIDGET_CONFIG.map((w) => (
            <View key={w.id} className="flex-row items-center justify-between py-2">
              <View className="flex-row items-center flex-1" style={{ gap: 8 }}>
                <Ionicons name={w.icon} size={16} color={theme.mutedForeground} />
                <Text className="text-body text-foreground">{w.label}</Text>
              </View>
              <Switch
                value={visibleWidgets.includes(w.id)}
                onValueChange={() => toggleWidget(w.id)}
                accessibilityLabel={`Show ${w.label}`}
                trackColor={{ false: theme.border, true: theme.alpha("primary", 0.35) }}
                thumbColor={visibleWidgets.includes(w.id) ? theme.primary : theme.card}
              />
            </View>
          ))}
          <View className="mt-2 pt-2 border-t border-border">
            <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-2">Sort categories by</Text>
            <ChipWrap>
              {(
                [
                  { id: "default", label: "Over budget first" },
                  { id: "alphabetical", label: "Alphabetical" },
                  { id: "budget_desc", label: "Highest budget" },
                  { id: "spent_amount", label: "Most spent ₹" },
                  { id: "spent_pct", label: "Most spent %" },
                ] as { id: BudgetCategorySort; label: string }[]
              ).map((opt) => (
                <Chip
                  key={opt.id}
                  label={opt.label}
                  on={sortBy === opt.id}
                  onPress={() => {
                    setSortBy(opt.id);
                    setBudgetCategorySort(opt.id);
                  }}
                />
              ))}
            </ChipWrap>
          </View>
        </View>
      )}

      <SwipePager
        pages={budgetPages}
        activeIndex={Math.min(activePageIndex, budgetPages.length - 1)}
        onIndexChange={(i) => {
          setActivePageIndex(i);
          if (i !== 0) setShowWidgetManager(false);
          if (budgetPages[i]?.key === "split") setVisitedSplit(true);
          if (budgetPages[i]?.key === "monthly") setVisitedMonthly(true);
        }}
      >
        {/* Page 0 — Overview */}
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 16, paddingTop: 12, gap: 12 }}
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
          {/* ── This month: what's left and the month's numbers in one card, nothing said twice
               (owner, Nov 2026). The unavoidable / discretionary split is on the Spending Split page. ── */}
          {visibleWidgets.includes("summary") && (
            <Card>
              <View className="flex-row items-start justify-between" style={{ gap: 8 }}>
                <View className="flex-1" style={{ minWidth: 0 }}>
                  <Text className="text-meta text-muted-foreground">
                    {totalBudget <= 0 ? "Spent this month" : isPastMonth ? (left >= 0 ? "Saved" : "Overspent") : left >= 0 ? "Left to spend" : "Over budget by"}
                  </Text>
                  <AnimatedNumber
                    value={Math.round(totalBudget <= 0 ? totalSpent : Math.abs(left))}
                    className="text-hero font-bold"
                    style={{ color: totalBudget > 0 && left < 0 ? theme.danger : theme.foreground }}
                  />
                </View>
                {totalBudget > 0 && <Chip variant="status" className="self-start" tone={budgetBadgeTone} label={budgetBadgeLabel} />}
              </View>
              {totalBudget > 0 && <ProgressBar value={overallPct} color={overallColor} height={8} animated className="mt-3" />}
              <Text className="text-meta text-muted-foreground mt-2">
                {totalBudget > 0 ? `${rs(totalSpent)} spent of ${rs(totalBudget)}` : "No budget set"} ·{" "}
                {isPastMonth ? `${daysTotal} days` : `${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} left`}
              </Text>
              <View className="mt-1">
                {isPastMonth ? (
                  <FieldRow label="Average a day" value={rs(totalSpent / daysTotal)} divider={false} />
                ) : totalBudget > 0 && totalSpent >= totalBudget ? (
                  <FieldRow label="Per day left" value="None" valueColor={theme.danger} divider={false} />
                ) : totalBudget > 0 ? (
                  <FieldRow label="Per day left" value={rs(perDayRemaining)} divider={false} />
                ) : null}
                {hasEmis && <FieldRow label="Money out, with EMIs" value={`${rs(moneyOut)} of ${rs(planned)}`} divider={isPastMonth || totalBudget > 0} />}
              </View>

              {/* EMIs as a share of income */}
              {(() => {
                const income = monthSplit?.monthlyIncome;
                if (!emis || !income || Math.max(emis.paid, emis.due) <= 0) return null;
                const share = Math.round((Math.max(emis.paid, emis.due) / income) * 100);
                // Planners and lenders treat about 40% of take-home pay as the most EMIs should take.
                const high = share > 40;
                return (
                  <Text className="text-label mt-1" style={{ color: high ? theme.warning : theme.mutedForeground }}>
                    EMIs are {share}% of your monthly income{high ? ", above the 40% most planners suggest" : ""}
                  </Text>
                );
              })()}
            </Card>
          )}

          {/* Month-end projection: a drawer, closed until tapped (owner, Nov 2026); the line under its
               title gives the projection, the drawer the rest in one compact block. */}
          {visibleWidgets.includes("projection") && totalBudget > 0 && (() => {
            const stats: { label: string; value: string; color?: string }[] = [];
            let note: string | null = null;
            if (!isCurrentMonth) {
              stats.push({ label: left >= 0 ? "Saved" : "Overspent", value: rs(Math.abs(left)), color: left >= 0 ? theme.success : theme.danger });
              if (rollingSurplus !== 0) {
                stats.push({
                  label: `FY ${rollingSurplus >= 0 ? "surplus" : "deficit"} so far`,
                  value: signedAmt(Math.round(rollingSurplus)),
                  color: rollingSurplus >= 0 ? theme.success : theme.danger,
                });
              }
              note = `${daysTotal} days${rollingSurplus !== 0 ? " · FY figure: against budget from the FY start to this month" : ""}`;
            } else if (v2Forecast) {
              const room = v2Forecast.breathingRoom ?? 0;
              if (projected != null) stats.push({ label: "Projected spend", value: rs(projected), color: projectedOver ? theme.danger : undefined });
              stats.push({ label: room >= 0 ? "Projected savings" : "Projected deficit", value: signedAmt(Math.round(room)), color: room >= 0 ? theme.success : theme.danger });
              stats.push({ label: "Fixed", value: rs(v2Forecast.fixedDone.total + v2Forecast.fixedPending.total) });
              stats.push({ label: "Variable", value: rs(v2Forecast.variable.projected) });
              note = `${rs(v2Forecast.variable.dailyPace)} a day · ${v2Forecast.variable.daysElapsed} days gone, ${v2Forecast.variable.daysLeft} left`;
            } else if (compliance) {
              if (projected != null) stats.push({ label: "Projected spend", value: rs(projected), color: projectedOver ? theme.danger : undefined });
              stats.push({
                label: compliance.monthlyProjectedSavings >= 0 ? "Projected savings" : "Projected deficit",
                value: signedAmt(Math.round(compliance.monthlyProjectedSavings)),
                color: compliance.monthlyProjectedSavings >= 0 ? theme.success : theme.danger,
              });
              note = `${rs(compliance.dailySpendRate)} a day · ${compliance.daysRemaining} days left`;
            } else {
              note = "Not enough to go on yet";
            }
            const annual = isCurrentMonth && compliance && compliance.annualOnTrack !== null ? compliance : null;
            const annualRoom = annual ? annual.annualProjectedSavings ?? 0 : 0;
            const sub = isCurrentMonth
              ? projected != null
                ? `${rs(projected)} at this pace${v2Forecast ? ` · ${v2Forecast.confidence} confidence` : ""}`
                : "Not enough to go on yet"
              : `${left >= 0 ? "Saved" : "Overspent"} ${rs(Math.abs(left))}`;
            return (
              <FoldGroup
                icon={isCurrentMonth ? "trending-up-outline" : "checkmark-done-outline"}
                title={isCurrentMonth ? "Month-end projection" : "How the month ended"}
                sub={sub}
              >
                <View>
                {stats.length > 0 && (
                  <View className="flex-row flex-wrap" style={{ rowGap: 10 }}>
                    {stats.map((s) => (
                      <View key={s.label} style={{ width: "50%", paddingRight: 8 }}>
                        <Text className="text-label text-muted-foreground" numberOfLines={1}>{s.label}</Text>
                        <Text className="text-body font-bold" style={{ color: s.color ?? theme.foreground, fontVariant: ["tabular-nums"] }} numberOfLines={1} adjustsFontSizeToFit>
                          {s.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
                {note ? <Text className={`text-label text-muted-foreground${stats.length > 0 ? " mt-2" : ""}`}>{note}</Text> : null}
                {annual && (
                  <View className="flex-row items-center border-t border-border mt-2 pt-2" style={{ gap: 8 }}>
                    <View className="flex-1" style={{ minWidth: 0 }}>
                      <Text className="text-meta font-semibold text-foreground">This year</Text>
                      <Text className="text-label text-muted-foreground">
                        {rs(Math.round(annual.annualProjectedSpend ?? 0))} projected of {rs(annual.annualBudget ?? 0)} · {rs(Math.abs(annualRoom))} {annualRoom >= 0 ? "under" : "over"}
                      </Text>
                    </View>
                    <Chip variant="status" tone={annual.annualOnTrack ? "success" : "danger"} label={annual.annualOnTrack ? "On track" : "Over budget"} />
                  </View>
                )}
                </View>
              </FoldGroup>
            );
          })()}

          {/* ── Review-queue nudge: uncategorised spending ── */}
          {uncategorized > 0 && (
            <Pressable
              onPress={() => router.push({ pathname: "/expense/review-queue", params: { filter: "uncategorized" } })}
              className="flex-row items-center px-3.5 py-3 rounded-card"
              style={{ backgroundColor: theme.alpha("primary", 0.08), gap: 12 }}
              accessibilityRole="button"
            >
              <Ionicons name="help-circle-outline" size={20} color={theme.primary} />
              <View className="flex-1">
                <Text className="text-body font-semibold text-foreground">
                  {uncategorizedCount} uncategorised · {rs(uncategorized)}
                </Text>
                <Text className="text-meta text-muted-foreground">Tap to review and give them categories</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
            </Pressable>
          )}

          {/* ── Categories (loan EMIs first: read-only, no budget to set) ── */}
          {displayRows.length > 0 || hasEmis ? (
            <View className="rounded-card bg-card border border-border overflow-hidden">
              <View className="flex-row items-center justify-between px-4 pt-3 pb-1">
                <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground">Categories</Text>
                {hiddenCount > 0 && <Text className="text-label text-faint-foreground">{hiddenCount} empty hidden</Text>}
              </View>
              {monthSplit && hasEmis && (
                <PressableScale
                  onPress={() => router.push("/goals/loans")}
                  accessibilityRole="button"
                  accessibilityLabel={`Loan EMIs ${rs(monthSplit.emis.paid)} paid. Open loans`}
                  style={{ paddingHorizontal: 16, paddingVertical: 10 }}
                  className="border-t border-border"
                >
                  <View className="flex-row items-center" style={{ gap: 12 }}>
                    <View className="w-8 h-8 rounded-control items-center justify-center" style={{ backgroundColor: theme.alpha("foreground", 0.06) }}>
                      <Ionicons name="business-outline" size={17} color={theme.mutedForeground} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-body font-semibold text-foreground">Loan EMIs</Text>
                      <Text className="text-label text-muted-foreground" numberOfLines={1}>
                        {monthSplit.emis.loans.map((l) => l.name).join(", ")}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-body font-semibold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                        {rs(monthSplit.emis.paid)}
                      </Text>
                      {(() => {
                        const { paid, prepaid, due } = monthSplit.emis;
                        const emiPaid = paid - prepaid;
                        const done = due <= 0 || emiPaid >= due - 1;
                        const status =
                          due <= 0
                            ? prepaid > 0
                              ? "Prepaid"
                              : "Paid"
                            : done
                              ? prepaid > 0
                                ? `Paid + ${rs(prepaid)} prepaid`
                                : "Paid"
                              : `${rs(due - emiPaid)} still due`;
                        return (
                          <Text className="text-label" style={{ color: done ? theme.success : theme.warning }}>
                            {status}
                          </Text>
                        );
                      })()}
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={theme.faintForeground} />
                  </View>
                </PressableScale>
              )}
              {displayRows.map((item, rowIndex) => {
                const status = getBudgetStatus(item.spent, item.budget);
                // Spending is ink; only over budget turns red.
                const barColor = status === "over" ? theme.danger : status === "warning" ? theme.warning : theme.primary;
                const pct = item.budget > 0 ? item.spent / item.budget : 0;
                const remaining = item.budget - item.spent;
                // Over budget: one gentle nudge after the bars fill, never repeating.
                return (
                  <Nudge key={item.category.id} active={item.budget > 0 && item.spent > item.budget} delay={700 + staggerDelay(rowIndex)}>
                    <PressableScale
                      onPress={() => router.push({ pathname: "/budget/[categoryId]", params: { categoryId: item.category.id, month } })}
                      accessibilityRole="button"
                      accessibilityLabel={item.category.name}
                      style={{ paddingHorizontal: 16, paddingVertical: 10 }}
                      className="border-t border-border"
                    >
                      <View className="flex-row items-center" style={{ gap: 12 }}>
                        <View className="w-8 h-8 rounded-control items-center justify-center" style={{ backgroundColor: tint(item.category.color, 0.1) }}>
                          <Ionicons name={item.category.icon as keyof typeof Ionicons.glyphMap} size={17} color={item.category.color} />
                        </View>
                        <View className="flex-1" style={{ gap: 6 }}>
                          <View className="flex-row items-center">
                            <Text className="flex-1 text-body font-semibold text-foreground" numberOfLines={1}>
                              {item.category.name}
                            </Text>
                            <Text className="text-body font-semibold" style={{ color: status === "over" ? theme.danger : theme.foreground, fontVariant: ["tabular-nums"] }}>
                              {rs(item.spent)}
                            </Text>
                            {item.budget > 0 && <Text className="text-meta text-muted-foreground"> / {rs(item.budget)}</Text>}
                          </View>
                          {item.budget > 0 && <ProgressBar value={pct} color={barColor} height={6} delay={200 + staggerDelay(rowIndex)} />}
                          {item.budget > 0 && (
                            <View className="flex-row justify-between">
                              <Text className="text-label text-muted-foreground">
                                {remaining >= 0 ? `${rs(remaining)} left` : `${rs(Math.abs(remaining))} over`}
                              </Text>
                              <Text className="text-label text-muted-foreground">{Math.round(pct * 100)}%</Text>
                            </View>
                          )}
                          {item.budget === 0 && item.spent > 0 && (
                            <Chip
                              variant="add"
                              label={`Set budget for ${monthLabel}`}
                              className="self-start"
                              onPress={() => {
                                setQuickBudgetRow(item);
                                setQuickBudgetAmount("");
                              }}
                            />
                          )}
                        </View>
                      </View>
                    </PressableScale>
                  </Nudge>
                );
              })}
            </View>
          ) : (
            <View className="items-center justify-center py-20">
              <Ionicons name="calculator-outline" size={48} color={theme.faintForeground} />
              <Text className="text-heading font-semibold text-foreground mt-4">No budget data</Text>
              <Text className="text-meta text-muted-foreground mt-1 text-center px-8">Set up budgets in Settings › Budget configuration</Text>
            </View>
          )}

          {/* Quick-set budget for one category, this month only */}
          <Modal
            visible={quickBudgetRow !== null}
            transparent
            animationType="fade"
            onRequestClose={() => setQuickBudgetRow(null)}
            onShow={() => setTimeout(() => quickBudgetInputRef.current?.focus(), 80)}
          >
            <Pressable
              style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-start", paddingTop: 120, paddingHorizontal: 24 }}
              onPress={() => setQuickBudgetRow(null)}
            >
              <Pressable onPress={() => {}} className="rounded-sheet bg-card overflow-hidden">
                <View className="flex-row items-center px-4 py-3 border-b border-border" style={{ gap: 12 }}>
                  <View className="w-9 h-9 rounded-control items-center justify-center" style={{ backgroundColor: tint(quickBudgetRow?.category.color ?? theme.mutedForeground, 0.12) }}>
                    <Ionicons
                      name={(quickBudgetRow?.category.icon ?? "help-circle") as keyof typeof Ionicons.glyphMap}
                      size={18}
                      color={quickBudgetRow?.category.color}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-body font-semibold text-foreground">{quickBudgetRow?.category.name}</Text>
                    <Text className="text-meta text-muted-foreground">
                      {rs(quickBudgetRow?.spent ?? 0)} spent · {monthLabel} only
                    </Text>
                  </View>
                </View>
                <View className="px-4 pt-4 pb-2">
                  <Text className="text-label font-semibold text-muted-foreground mb-1.5">Budget for {monthLabel}</Text>
                  <View className="flex-row items-center rounded-control border px-3" style={{ borderColor: theme.primary }}>
                    <Text className="text-heading font-semibold text-muted-foreground mr-1">₹</Text>
                    <TextInput
                      ref={quickBudgetInputRef}
                      value={quickBudgetAmount}
                      onChangeText={setQuickBudgetAmount}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={theme.faintForeground}
                      className="flex-1 text-title font-bold text-foreground text-right"
                      style={{ paddingVertical: 10 }}
                      returnKeyType="done"
                      onSubmitEditing={saveQuickBudget}
                      accessibilityLabel={`Budget for ${quickBudgetRow?.category.name ?? "category"}`}
                    />
                  </View>
                  <Text className="text-label text-muted-foreground mt-2">
                    Won&apos;t affect other months. Use Settings › Budget configuration for budgets that repeat.
                  </Text>
                </View>
                <View className="flex-row px-4 pb-4 pt-2" style={{ gap: 10 }}>
                  <Pressable
                    onPress={() => setQuickBudgetRow(null)}
                    className="flex-1 rounded-pill border border-border items-center justify-center"
                    style={{ height: 44 }}
                    accessibilityRole="button"
                  >
                    <Text className="text-body font-semibold text-foreground">Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={saveQuickBudget}
                    className="rounded-pill items-center justify-center"
                    style={{ height: 44, flex: 2, backgroundColor: theme.primary }}
                    accessibilityRole="button"
                  >
                    <Text className="text-body font-bold" style={{ color: theme.primaryForeground }} numberOfLines={1}>
                      Save for {monthLabel}
                    </Text>
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
          </Modal>
        </ScrollView>

        {/* Page 1 — Spending Split (lazy: only mount after first visit) */}
        {!isPartOn("budget_split") ? null : visitedSplit
          ? <SpendingSplitPage month={month} />
          : <View style={{ flex: 1 }} />}

        {/* Page 2 — Monthly Summary (lazy: only mount after first visit) */}
        {!isPartOn("budget_monthly") ? null : visitedMonthly
          ? <MonthlySummaryPage month={month} />
          : <View style={{ flex: 1 }} />}
      </SwipePager>
    </ScreenContainer>
  );
}
