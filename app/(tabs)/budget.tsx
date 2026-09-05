import { useState, useCallback, useMemo, useRef } from "react";
import { View, Text, ScrollView, Pressable, Switch, RefreshControl, Modal, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ContextualHeader, ScreenContainer, ProgressBar, StatusPill, WidgetCard, PeriodNavigator, SwipePager } from "@/components/ui";
import { SpendingSplitPage } from "@/components/budget/SpendingSplitPage";
import { MonthlySummaryPage } from "@/components/budget/MonthlySummaryPage";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import { StatusColors } from "@/constants/theme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { getCategories } from "@/services/category";
import { getBudgetsForMonth, getCurrentMonth, getMonthlyBudgetTotals } from "@/services/budget";
import { getExpenseTotalsByCategory, getExpenseTotal, getUncategorizedTotal, getUncategorizedCount, getMonthlyExpenseTotals } from "@/services/expense";
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
  getDaysRemaining,
  getTotalDaysInMonth,
  getBudgetStatus,
  getBudgetStatusColor,
  getPerDayRemaining,
} from "@/utils/budget-helpers";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getAnalyticsForecast, type AnalyticsForecast } from "@/services/analytics-forecast";
import { upsertBudget } from "@/services/budget";

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
  const { colors, accent, colorScheme } = useColorScheme();
  const [month, setMonth] = useState(getCurrentMonth());
  const [rows, setRows] = useState<BudgetDashboardRow[]>([]);
  const [totalBudget, setTotalBudget] = useState(0);
  const [totalSpent, setTotalSpent] = useState(0);
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
  const lastVersionRef = useRef<number | null>(null);
  const [activePageIndex, setActivePageIndex] = useState(0);
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
  const daysElapsed = daysTotal - daysRemaining;

  const loadData = useCallback(async () => {
    const currentVersion = getDataVersion();
    if (lastVersionRef.current === currentVersion) return;
    lastVersionRef.current = currentVersion;
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
      const merged: BudgetDashboardRow[] = categories.map((cat) => ({
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
    } catch {
      // Database not ready
    }
  }, [month, startDate, endDate]);

  useDataRefresh(loadData);

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

  const budgetBadgeVariant = overallStatus === "over" ? "danger" : overallStatus === "warning" ? "warning" : "success";
  const budgetBadgeLabel = overallStatus === "over" ? "Over" : overallStatus === "warning" ? "Watch" : "On track";

  return (
    <ScreenContainer>
      <ContextualHeader
        title="Budget"
        rightActions={activePageIndex === 0 ? [{
          icon: "apps-outline",
          onPress: () => setShowWidgetManager((v) => !v),
          color: showWidgetManager ? colors.blue : "#6B7280",
        }] : []}
      />
      {/* Month selector */}
      <PeriodNavigator
        mode="month"
        value={month}
        onChange={setMonth}
      />

      {/* Widget management panel (only on Overview page) */}
      {activePageIndex === 0 && showWidgetManager && (
        <View className="mx-4 mt-2 mb-1 p-3 rounded-xl bg-surface-light-alt dark:bg-surface-dark-alt border border-border-light dark:border-border-dark">
          <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary mb-2">
            Manage Widgets
          </Text>
          {WIDGET_CONFIG.map((w) => (
            <View
              key={w.id}
              className="flex-row items-center justify-between py-2"
            >
              <View className="flex-row items-center flex-1">
                <Ionicons name={w.icon} size={16} color={colors.textSecondary} style={{ marginRight: 8 }} />
                <Text className="text-sm text-text-primary dark:text-text-dark-primary">
                  {w.label}
                </Text>
              </View>
              <Switch
                value={visibleWidgets.includes(w.id)}
                onValueChange={() => toggleWidget(w.id)}
                accessibilityLabel={`Toggle ${w.label}`}
                trackColor={{ false: "#D1D5DB", true: accent[300] }}
                thumbColor={visibleWidgets.includes(w.id) ? colors.blue : "#F3F4F6"}
              />
            </View>
          ))}

          <View className="mt-2 pt-2 border-t border-border-light dark:border-border-dark">
            <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary mb-2">
              Sort categories by
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {(
                [
                  { id: "default", label: "Over budget first" },
                  { id: "alphabetical", label: "Alphabetical" },
                  { id: "budget_desc", label: "Highest budget" },
                  { id: "spent_amount", label: "Most spent ₹" },
                  { id: "spent_pct", label: "Most spent %" },
                ] as { id: BudgetCategorySort; label: string }[]
              ).map((opt) => {
                const selected = sortBy === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => {
                      setSortBy(opt.id);
                      setBudgetCategorySort(opt.id);
                    }}
                    className="px-3 py-1 rounded-full border"
                    style={{
                      backgroundColor: selected ? colors.blue : "transparent",
                      borderColor: selected ? colors.blue : colors.border,
                    }}
                  >
                    <Text
                      className="text-xs font-medium"
                      style={{ color: selected ? "#fff" : colors.textSecondary }}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      )}

      <SwipePager
        pages={[
          { key: "overview", label: "Overview" },
          { key: "split", label: "Spending Split" },
          { key: "monthly", label: "Monthly Summary" },
        ]}
        tabWidth={120}
        activeIndex={activePageIndex}
        onIndexChange={(i) => {
          setActivePageIndex(i);
          if (i !== 0) setShowWidgetManager(false);
          if (i === 1) setVisitedSplit(true);
          if (i === 2) setVisitedMonthly(true);
        }}
      >
        {/* Page 0 — Overview */}
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
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
        {/* Budget Summary Widget */}
        {visibleWidgets.includes("summary") && (
          <WidgetCard
            title="Budget Summary"
            storageKey="budget_summary"
            defaultExpanded={true}
            icon="wallet-outline"
            iconColor={overallColor}
            onClose={() => removeWidget("summary")}
            className="mx-4 mt-3 mb-3"
            rightContent={
              <StatusPill
                label={overallStatus === "under" ? "On Track" : overallStatus === "warning" ? "Watch" : "Over"}
                color={overallColor}
              />
            }
          >
            <View className="flex-row items-center justify-between mb-2 mt-2">
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
                Total Spent
              </Text>
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
                Budget
              </Text>
            </View>
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-2xl font-bold" style={{ color: overallColor }}>
                {formatAmount(totalSpent)}
              </Text>
              <Text className="text-2xl font-bold text-text-primary dark:text-text-dark-primary">
                {formatAmount(totalBudget)}
              </Text>
            </View>

            {totalBudget > 0 && (
              <ProgressBar value={overallPct} color={overallColor} height={12} animated />
            )}

            <View className="flex-row justify-between mt-3">
              <View>
                <Text className="text-xs text-text-tertiary">Days left</Text>
                <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                  {daysRemaining}
                </Text>
              </View>
              <View className="items-center">
                <Text className="text-xs text-text-tertiary">Remaining</Text>
                <Text
                  className="text-sm font-semibold"
                  style={{
                    color:
                      totalBudget - totalSpent >= 0 ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger,
                  }}
                >
                  {totalBudget - totalSpent >= 0
                    ? formatAmount(totalBudget - totalSpent)
                    : `-${formatAmount(Math.abs(totalBudget - totalSpent))}`}
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-xs text-text-tertiary">Per day</Text>
                <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                  {formatAmount(perDayRemaining)}
                </Text>
              </View>
            </View>

          </WidgetCard>
        )}

        {/* Budget Projection / Month-End Actual Widget */}
        {visibleWidgets.includes("projection") && totalBudget > 0 && (
          <WidgetCard
            title={isCurrentMonth ? "Month-End Projection" : "Month-End Actual"}
            storageKey="budget_projection"
            defaultExpanded={false}
            icon={isCurrentMonth ? "trending-up-outline" : "checkmark-done-outline"}
            iconColor={(() => {
              if (isCurrentMonth) {
                const proj = v2Forecast?.projectedTotal ?? (compliance?.projectedMonthEnd ?? 0);
                return proj <= totalBudget ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger;
              }
              return totalSpent <= totalBudget ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger;
            })()}
            onClose={() => removeWidget("projection")}
            className={`mx-4 mb-2 ${!visibleWidgets.includes("summary") ? "mt-3" : ""}`}
            rightContent={
              <StatusPill
                label={(() => {
                  if (isCurrentMonth) {
                    const proj = v2Forecast?.projectedTotal ?? (compliance?.projectedMonthEnd ?? 0);
                    return proj <= totalBudget ? "On Track" : "Over Budget";
                  }
                  return totalSpent <= totalBudget ? "Under Budget" : "Overspent";
                })()}
                color={(() => {
                  if (isCurrentMonth) {
                    const proj = v2Forecast?.projectedTotal ?? (compliance?.projectedMonthEnd ?? 0);
                    return proj <= totalBudget ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger;
                  }
                  return totalSpent <= totalBudget ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger;
                })()}
              />
            }
          >
            {isCurrentMonth ? (
              <>
                {/* V2 Realistic Forecast for current month */}
                {v2Forecast ? (
                  <>
                    <View className="flex-row justify-between mb-2 mt-2">
                      <View>
                        <Text className="text-xs text-text-tertiary">Projected Spend</Text>
                        <Text
                          className="text-lg font-bold"
                          style={{ color: v2Forecast.projectedTotal <= totalBudget ? colors.text : StatusColors[colorScheme].danger }}
                        >
                          {formatAmount(v2Forecast.projectedTotal)}
                        </Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-xs text-text-tertiary">
                          {(v2Forecast.breathingRoom ?? 0) >= 0 ? "Projected Savings" : "Projected Deficit"}
                        </Text>
                        <Text
                          className="text-lg font-bold"
                          style={{ color: (v2Forecast.breathingRoom ?? 0) >= 0 ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger }}
                        >
                          {(v2Forecast.breathingRoom ?? 0) >= 0
                            ? formatAmount(v2Forecast.breathingRoom ?? 0)
                            : `-${formatAmount(Math.abs(v2Forecast.breathingRoom ?? 0))}`}
                        </Text>
                      </View>
                    </View>

                    <ProgressBar
                      value={Math.min(v2Forecast.projectedTotal / totalBudget, 1)}
                      color={v2Forecast.projectedTotal <= totalBudget ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger}
                      height={8}
                      animated
                    />

                    {/* Fixed/Variable split */}
                    <View className="flex-row justify-between mt-3">
                      <View>
                        <Text className="text-xs text-text-tertiary">Fixed</Text>
                        <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                          {formatAmount(v2Forecast.fixedDone.total + v2Forecast.fixedPending.total)}
                        </Text>
                      </View>
                      <View className="items-center">
                        <Text className="text-xs text-text-tertiary">Variable</Text>
                        <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                          {formatAmount(v2Forecast.variable.projected)}
                        </Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-xs text-text-tertiary">Daily Pace</Text>
                        <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                          {formatAmount(v2Forecast.variable.dailyPace)}/day
                        </Text>
                      </View>
                    </View>

                    {/* Days info */}
                    <View className="flex-row justify-between mt-2">
                      <View>
                        <Text className="text-xs text-text-tertiary">Days Elapsed</Text>
                        <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                          {v2Forecast.variable.daysElapsed}
                        </Text>
                      </View>
                      <View className="items-center">
                        <Text className="text-xs text-text-tertiary">Days Left</Text>
                        <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                          {v2Forecast.variable.daysLeft}
                        </Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-xs text-text-tertiary">Confidence</Text>
                        <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary capitalize">
                          {v2Forecast.confidence}
                        </Text>
                      </View>
                    </View>
                  </>
                ) : compliance ? (
                  <>
                    {/* Fallback: naive projection if V2 not available */}
                    <View className="flex-row justify-between mb-2 mt-2">
                      <View>
                        <Text className="text-xs text-text-tertiary">Projected Spend</Text>
                        <Text className="text-lg font-bold" style={{ color: compliance.monthlyOnTrack ? colors.text : StatusColors[colorScheme].danger }}>
                          {formatAmount(Math.round(compliance.projectedMonthEnd))}
                        </Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-xs text-text-tertiary">
                          {compliance.monthlyProjectedSavings >= 0 ? "Projected Savings" : "Projected Deficit"}
                        </Text>
                        <Text className="text-lg font-bold" style={{ color: compliance.monthlyProjectedSavings >= 0 ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger }}>
                          {compliance.monthlyProjectedSavings >= 0
                            ? formatAmount(Math.round(compliance.monthlyProjectedSavings))
                            : `-${formatAmount(Math.abs(Math.round(compliance.monthlyProjectedSavings)))}`}
                        </Text>
                      </View>
                    </View>
                    <ProgressBar
                      value={Math.min(compliance.projectedMonthEnd / totalBudget, 1)}
                      color={compliance.monthlyOnTrack ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger}
                      height={8}
                      animated
                    />
                    <View className="flex-row justify-between mt-2">
                      <View>
                        <Text className="text-xs text-text-tertiary">Daily Rate</Text>
                        <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">{formatAmount(Math.round(compliance.dailySpendRate))}/day</Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-xs text-text-tertiary">Days Left</Text>
                        <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">{compliance.daysRemaining}</Text>
                      </View>
                    </View>
                  </>
                ) : null}
              </>
            ) : (
              <>
                {/* Past month: Actual results with rolling surplus */}
                <View className="flex-row justify-between mb-2 mt-2">
                  <View>
                    <Text className="text-xs text-text-tertiary">Total Spent</Text>
                    <Text
                      className="text-lg font-bold"
                      style={{ color: totalSpent <= totalBudget ? colors.text : StatusColors[colorScheme].danger }}
                    >
                      {formatAmount(totalSpent)}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-xs text-text-tertiary">
                      {totalBudget - totalSpent >= 0 ? "Saved" : "Overspent"}
                    </Text>
                    <Text
                      className="text-lg font-bold"
                      style={{ color: totalBudget - totalSpent >= 0 ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger }}
                    >
                      {totalBudget - totalSpent >= 0
                        ? formatAmount(totalBudget - totalSpent)
                        : `-${formatAmount(Math.abs(totalBudget - totalSpent))}`}
                    </Text>
                  </View>
                </View>

                <ProgressBar
                  value={Math.min(totalSpent / totalBudget, 1)}
                  color={totalSpent <= totalBudget ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger}
                  height={8}
                  animated={false}
                />

                <View className="flex-row justify-between mt-2">
                  <View>
                    <Text className="text-xs text-text-tertiary">Budget</Text>
                    <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                      {formatAmount(totalBudget)}
                    </Text>
                  </View>
                  <View className="items-center">
                    <Text className="text-xs text-text-tertiary">Avg/Day</Text>
                    <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                      {formatAmount(Math.round(totalSpent / daysTotal))}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-xs text-text-tertiary">Days</Text>
                    <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                      {daysTotal}
                    </Text>
                  </View>
                </View>

                {/* Rolling surplus/deficit from FY start */}
                {rollingSurplus !== 0 && (
                  <View className="mt-3 pt-3 border-t border-border-light dark:border-border-dark">
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center">
                        <Ionicons
                          name={rollingSurplus >= 0 ? "trending-up" : "trending-down"}
                          size={14}
                          color={rollingSurplus >= 0 ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger}
                        />
                        <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary ml-1">
                          Rolling {rollingSurplus >= 0 ? "Surplus" : "Deficit"} (FY)
                        </Text>
                      </View>
                      <Text
                        className="text-sm font-bold"
                        style={{ color: rollingSurplus >= 0 ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger }}
                      >
                        {rollingSurplus >= 0
                          ? formatAmount(rollingSurplus)
                          : `-${formatAmount(Math.abs(rollingSurplus))}`}
                      </Text>
                    </View>
                    <Text className="text-xs text-text-tertiary mt-1">
                      Cumulative savings vs budget from FY start to this month
                    </Text>
                  </View>
                )}
              </>
            )}

            {/* Annual Projection (if yearly plan exists) — only for current month */}
            {isCurrentMonth && compliance && compliance.annualOnTrack !== null && (
              <View className="mt-3 pt-3 border-t border-border-light dark:border-border-dark">
                <View className="flex-row items-center mb-2">
                  <Ionicons
                    name="calendar-outline"
                    size={14}
                    color={compliance.annualOnTrack ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger}
                  />
                  <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary ml-1">
                    Annual Projection
                  </Text>
                  <View className="ml-auto">
                    <StatusPill
                      label={compliance.annualOnTrack ? "On Track" : "Over Budget"}
                      color={compliance.annualOnTrack ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger}
                    />
                  </View>
                </View>
                <View className="flex-row justify-between">
                  <View>
                    <Text className="text-xs text-text-tertiary">Projected</Text>
                    <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                      {formatAmount(Math.round(compliance.annualProjectedSpend ?? 0))}
                    </Text>
                  </View>
                  <View className="items-center">
                    <Text className="text-xs text-text-tertiary">Annual Budget</Text>
                    <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                      {formatAmount(compliance.annualBudget ?? 0)}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-xs text-text-tertiary">
                      {(compliance.annualProjectedSavings ?? 0) >= 0 ? "Under Budget" : "Over Budget"}
                    </Text>
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: (compliance.annualProjectedSavings ?? 0) >= 0 ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger }}
                    >
                      {(compliance.annualProjectedSavings ?? 0) >= 0
                        ? formatAmount(Math.round(compliance.annualProjectedSavings ?? 0))
                        : `-${formatAmount(Math.abs(Math.round(compliance.annualProjectedSavings ?? 0)))}`}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </WidgetCard>
        )}
        {/* Uncategorized banner */}
        {uncategorized > 0 && (
          <Pressable
            onPress={() => router.push({ pathname: "/expense/review-queue", params: { filter: "uncategorized" } })}
            className="mx-4 mb-2 flex-row items-center p-3 rounded-xl border"
            style={{ borderColor: ac(accent, colorScheme, 200, 800), backgroundColor: ac(accent, colorScheme, 50, 900) }}
          >
            <View className="w-9 h-9 rounded-full items-center justify-center mr-3" style={{ backgroundColor: ac(accent, colorScheme, 100, 800) }}>
              <Ionicons name="help-circle-outline" size={18} color={ac(accent, colorScheme, 400, 300)} />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-semibold" style={{ color: ac(accent, colorScheme, 600, 200) }}>
                {uncategorizedCount} uncategorized ({formatAmount(uncategorized)})
              </Text>
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                Tap to review and assign categories
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={ac(accent, colorScheme, 300, 500)} />
          </Pressable>
        )}

        {/* Category list */}
        {hiddenCount > 0 && (
          <View className="px-4 pt-2 pb-1 flex-row items-center justify-between">
            <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary">
              Categories
            </Text>
            <Text className="text-xs text-text-tertiary">
              {hiddenCount} empty hidden
            </Text>
          </View>
        )}
        {displayRows.length > 0 ? (
          displayRows.map((item) => {
            const status = getBudgetStatus(item.spent, item.budget);
            const color = getBudgetStatusColor(status);
            const pct = item.budget > 0 ? item.spent / item.budget : 0;
            const remaining = item.budget - item.spent;

            return (
              <Pressable
                key={item.category.id}
                onPress={() =>
                  router.push({
                    pathname: "/budget/[categoryId]",
                    params: { categoryId: item.category.id, month },
                  })
                }
                className="px-4 py-3 border-b border-border-light dark:border-border-dark"
              >
                <View className="flex-row items-center mb-2">
                  <View
                    className="w-7 h-7 rounded-full items-center justify-center mr-3"
                    style={{ backgroundColor: item.category.color + "14" }}
                  >
                    <Ionicons
                      name={item.category.icon as keyof typeof Ionicons.glyphMap}
                      size={16}
                      color={item.category.color}
                    />
                  </View>
                  <Text
                    className="flex-1 text-sm font-medium text-text-primary dark:text-text-dark-primary"
                    numberOfLines={1}
                  >
                    {item.category.name}
                  </Text>
                  <Text className="text-sm font-semibold" style={{ color }}>
                    {formatAmount(item.spent)}
                  </Text>
                  {item.budget > 0 && (
                    <Text className="text-xs text-text-tertiary ml-1">
                      / {formatAmount(item.budget)}
                    </Text>
                  )}
                </View>

                {item.budget > 0 && (
                  <ProgressBar value={pct} color={color} height={8} animated={false} />
                )}

                {item.budget > 0 && (
                  <View className="flex-row justify-between mt-1">
                    <Text className="text-xs text-text-tertiary">
                      {remaining >= 0
                        ? `${formatAmount(remaining)} left`
                        : `${formatAmount(Math.abs(remaining))} over`}
                    </Text>
                    <Text className="text-xs text-text-tertiary">
                      {Math.round(pct * 100)}%
                    </Text>
                  </View>
                )}

                {item.budget === 0 && item.spent > 0 && (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      setQuickBudgetRow(item);
                      setQuickBudgetAmount("");
                    }}
                    className="self-start mt-2 flex-row items-center px-2 py-1 rounded-full border"
                    style={{ borderColor: colors.blue + "66", backgroundColor: colors.blue + "14" }}
                    hitSlop={6}
                  >
                    <Ionicons name="add" size={12} color={colors.blue} />
                    <Text className="text-xs font-medium ml-0.5" style={{ color: colors.blue }}>
                      Set budget for {monthLabel}
                    </Text>
                  </Pressable>
                )}
              </Pressable>
            );
          })
        ) : (
          <View className="flex-1 items-center justify-center py-20">
            <Ionicons name="calculator-outline" size={48} color={colors.textSecondary} />
            <Text className="text-lg font-medium text-text-primary dark:text-text-dark-primary mt-4">
              No budget data
            </Text>
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-1 text-center px-8">
              {"Set up budgets in Settings > Budget Configuration"}
            </Text>
          </View>
        )}

          {/* Quick-set budget modal (centered dialog, keyboard-safe) */}
          <Modal
          visible={quickBudgetRow !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setQuickBudgetRow(null)}
          onShow={() => setTimeout(() => quickBudgetInputRef.current?.focus(), 80)}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-start", paddingTop: 120, paddingHorizontal: 32 }}
            onPress={() => setQuickBudgetRow(null)}
          >
            <Pressable onPress={() => {}} style={{ borderRadius: 16, overflow: "hidden" }}>
              <View
                className="rounded-2xl border border-border-light dark:border-border-dark"
                style={{ backgroundColor: colorScheme === "dark" ? "#1C2230" : "#fff" }}
              >
                {/* Category row */}
                <View className="flex-row items-center gap-3 px-4 py-3 border-b border-border-light dark:border-border-dark">
                  <View
                    className="w-9 h-9 rounded-full items-center justify-center"
                    style={{ backgroundColor: (quickBudgetRow?.category.color ?? "#000") + "20" }}
                  >
                    <Ionicons
                      name={(quickBudgetRow?.category.icon ?? "help-circle") as keyof typeof Ionicons.glyphMap}
                      size={18}
                      color={quickBudgetRow?.category.color}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                      {quickBudgetRow?.category.name}
                    </Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                      {formatAmount(quickBudgetRow?.spent ?? 0)} spent · {monthLabel} only
                    </Text>
                  </View>
                </View>

                {/* Amount input */}
                <View className="px-4 pt-4 pb-2">
                  <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary mb-2">
                    Budget amount
                  </Text>
                  <View
                    className="flex-row items-center rounded-xl border px-3"
                    style={{ borderColor: colors.blue, backgroundColor: colorScheme === "dark" ? "#0D1117" : "#F8F9FA" }}
                  >
                    <Text className="text-lg font-semibold text-text-secondary dark:text-text-dark-secondary mr-1">₹</Text>
                    <TextInput
                      ref={quickBudgetInputRef}
                      value={quickBudgetAmount}
                      onChangeText={setQuickBudgetAmount}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={colors.textSecondary + "80"}
                      style={{ flex: 1, fontSize: 20, fontWeight: "700", color: colors.text, paddingVertical: 10, textAlign: "right" }}
                      returnKeyType="done"
                      onSubmitEditing={async () => {
                        const amt = parseFloat(quickBudgetAmount);
                        if (!quickBudgetRow || isNaN(amt) || amt <= 0) return;
                        await upsertBudget({ user_id: DEFAULT_USER_ID, category_id: quickBudgetRow.category.id, month, amount: amt });
                        bumpDataVersion();
                        setQuickBudgetRow(null);
                      }}
                    />
                  </View>
                  <Text className="text-xs text-text-tertiary mt-2">
                    Won't affect other months. Use Settings › Budget Config to set recurring budgets.
                  </Text>
                </View>

                {/* Actions */}
                <View className="flex-row border-t border-border-light dark:border-border-dark">
                  <Pressable
                    onPress={() => setQuickBudgetRow(null)}
                    className="flex-1 py-3 items-center border-r border-border-light dark:border-border-dark"
                  >
                    <Text className="text-sm font-medium text-text-secondary dark:text-text-dark-secondary">Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={async () => {
                      const amt = parseFloat(quickBudgetAmount);
                      if (!quickBudgetRow || isNaN(amt) || amt <= 0) return;
                      await upsertBudget({ user_id: DEFAULT_USER_ID, category_id: quickBudgetRow.category.id, month, amount: amt });
                      bumpDataVersion();
                      setQuickBudgetRow(null);
                    }}
                    className="flex-2 py-3 items-center"
                    style={{ flex: 2 }}
                  >
                    <Text className="text-sm font-semibold" style={{ color: colors.blue }}>
                      Save for {monthLabel}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
        </ScrollView>

        {/* Page 1 — Spending Split (lazy: only mount after first visit) */}
        {visitedSplit
          ? <SpendingSplitPage month={month} />
          : <View style={{ flex: 1 }} />}

        {/* Page 2 — Monthly Summary (lazy: only mount after first visit) */}
        {visitedMonthly
          ? <MonthlySummaryPage month={month} />
          : <View style={{ flex: 1 }} />}
      </SwipePager>
    </ScreenContainer>
  );
}
