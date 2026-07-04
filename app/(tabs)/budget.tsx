import { useState, useCallback, useMemo } from "react";
import { View, Text, ScrollView, Pressable, Switch, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, ProgressBar, StatusPill, WidgetCard, PeriodNavigator } from "@/components/ui";
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
import { getFYStartMonth, getBudgetWidgets, setBudgetWidgets, clearCollapsibleState } from "@/services/settings";
import type { BudgetWidgetId } from "@/services/settings";
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
    try {
      const [categories, budgets, actuals, total, uncat, uncatCount] = await Promise.all([
        getCategories(DEFAULT_USER_ID),
        getBudgetsForMonth(DEFAULT_USER_ID, month),
        getExpenseTotalsByCategory(DEFAULT_USER_ID, startDate, endDate),
        getExpenseTotal(DEFAULT_USER_ID, startDate, endDate),
        getUncategorizedTotal(DEFAULT_USER_ID, startDate, endDate),
        getUncategorizedCount(DEFAULT_USER_ID),
      ]);

      const budgetMap = new Map(budgets.map((b) => [b.category_id, b.amount]));
      const actualMap = new Map(actuals.map((a) => [a.category_id, a.total]));

      const merged: BudgetDashboardRow[] = categories.map((cat) => ({
        category: cat,
        budget: budgetMap.get(cat.id) ?? 0,
        spent: actualMap.get(cat.id) ?? 0,
      }));

      // Sort: over-budget first, then by spent descending
      merged.sort((a, b) => {
        const aOver = a.budget > 0 && a.spent > a.budget ? 1 : 0;
        const bOver = b.budget > 0 && b.spent > b.budget ? 1 : 0;
        if (aOver !== bOver) return bOver - aOver;
        return b.spent - a.spent;
      });

      setRows(merged);
      setTotalBudget(budgets.reduce((sum, b) => sum + b.amount, 0));
      setTotalSpent(total);
      setUncategorized(uncat);
      setUncategorizedCount(uncatCount);

      // Load V2 forecast for current month
      try {
        const forecast = await getAnalyticsForecast(DEFAULT_USER_ID, month);
        setV2Forecast(forecast);
      } catch {
        setV2Forecast(null);
      }

      // Compute rolling surplus: sum of (budget - actual) for all prior months in FY
      try {
        const startMonth = getFYStartMonth();
        const fy = getCurrentFY(startMonth);
        const plan = await getYearlyPlanByFY(DEFAULT_USER_ID, String(fy));
        setYearlyPlan(plan);

        if (plan) {
          const { start, end } = getFYRange(fy, startMonth);
          const fyStart = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
          const fyEnd = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
          const ytd = await getExpenseTotal(DEFAULT_USER_ID, fyStart, fyEnd);
          setAnnualSpentYTD(ytd);
        }

        // Calculate rolling surplus from FY start to previous month.
        // Batched: one aggregate query for budget totals + one for expense
        // totals across the whole range, then an in-memory month-by-month
        // diff. Replaces the v15.8.0 loop that fired 2×N serial queries.
        const { start: fyStartDate } = getFYRange(fy, startMonth);
        const [currentY, currentM] = month.split("-").map(Number);
        const rangeStartMonth = `${fyStartDate.getFullYear()}-${String(fyStartDate.getMonth() + 1).padStart(2, "0")}`;
        // Previous month (exclusive end of range)
        const prevMonthDate = new Date(currentY, currentM - 2, 1);
        if (prevMonthDate >= fyStartDate) {
          const rangeEndMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
          const { startDate: rangeStartDate } = getMonthDateRange(rangeStartMonth);
          const { endDate: rangeEndDate } = getMonthDateRange(rangeEndMonth);
          const [budgetTotals, spendTotals] = await Promise.all([
            getMonthlyBudgetTotals(DEFAULT_USER_ID, rangeStartMonth, rangeEndMonth),
            getMonthlyExpenseTotals(DEFAULT_USER_ID, rangeStartDate, rangeEndDate),
          ]);
          let surplus = 0;
          for (const [mStr, mBudgetTotal] of budgetTotals.entries()) {
            if (mBudgetTotal > 0) {
              surplus += mBudgetTotal - (spendTotals.get(mStr) ?? 0);
            }
          }
          setRollingSurplus(surplus);
        } else {
          setRollingSurplus(0);
        }
      } catch {
        // Yearly plan not set up yet — that's fine
      }
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

  const overallStatus = getBudgetStatus(totalSpent, totalBudget);
  const overallColor = getBudgetStatusColor(overallStatus);
  const overallPct = totalBudget > 0 ? totalSpent / totalBudget : 0;
  const perDayRemaining = getPerDayRemaining(totalBudget, totalSpent, daysRemaining);

  return (
    <ScreenContainer padTop={false}>
      {/* Month selector + widget manager toggle */}
      <PeriodNavigator
        mode="month"
        value={month}
        onChange={setMonth}
        trailing={
          <Pressable
            onPress={() => setShowWidgetManager((v) => !v)}
            accessibilityLabel="Manage widgets"
            accessibilityRole="button"
            className="p-2 ml-1"
            hitSlop={6}
          >
            <Ionicons
              name="options-outline"
              size={18}
              color={showWidgetManager ? colors.blue : "#6B7280"}
            />
          </Pressable>
        }
      />

      {/* Widget management panel */}
      {showWidgetManager && (
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
        </View>
      )}

      <ScrollView
        className="flex-1"
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

            {/* Action buttons */}
            <View className="flex-row mt-3 gap-2">
              <Pressable
                onPress={() =>
                  router.push({ pathname: "/summary/[month]", params: { month } })
                }
                className="flex-1 py-2 rounded-xl items-center"
                style={{ backgroundColor: ac(accent, colorScheme, 50, 700) }}
              >
                <Text className="text-xs font-medium" style={{ color: ac(accent, colorScheme, 500, 200) }}>
                  Monthly Summary
                </Text>
              </Pressable>
              <Pressable
                onPress={() => router.push({ pathname: "/budget/spending-split", params: { month } })}
                className="flex-1 py-2 rounded-xl items-center"
                style={{ backgroundColor: ac(accent, colorScheme, 50, 700) }}
              >
                <Text className="text-xs font-medium" style={{ color: ac(accent, colorScheme, 500, 200) }}>
                  Spending Split
                </Text>
              </Pressable>
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
        {rows.length > 0 ? (
          rows.map((item) => {
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
                  <Text className="text-xs text-text-tertiary mt-1">No budget set</Text>
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
      </ScrollView>
    </ScreenContainer>
  );
}
