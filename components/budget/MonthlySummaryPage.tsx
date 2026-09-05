import { useState, useCallback } from "react";

import { View, ScrollView, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { getCategories } from "@/services/category";
import { getBudgetsForMonth } from "@/services/budget";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getExpenseTotal,
  getTopCategoriesBySpending,
  getExpenseCount,
} from "@/services/expense";
import { getSpendClassificationTotals } from "@/services/spend-classification";
import type { Category } from "@/services/category";
import { formatAmount } from "@/utils/expense-validation";
import { getMonthDateRange, getDaysRemaining, getTotalDaysInMonth } from "@/utils/budget-helpers";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";

interface TopCategory {
  category: Category | null;
  total: number;
  pctOfTotal: number;
}

interface SummaryData {
  totalSpent: number;
  totalBudget: number;
  rightSpendTotal: number;
  rightSpendPct: number;
  transactionCount: number;
  prevMonthSpent: number;
  topCategories: TopCategory[];
  budgetCompliancePct: number;
  daysInMonth: number;
  daysRemaining: number;
  avgPerDay: number;
}

interface MonthlySummaryPageProps {
  month: string;
}

/**
 * The month's summary: total spent, budget compliance, top categories, unavoidable ratio.
 *
 * The single implementation, rendered by the Budget tab's swipe-pager and by
 * app/summary/[month].tsx. Each previously kept its own ~340-line copy of the same computation
 * and layout.
 *
 * The month is a prop because the callers source it differently - the pager inherits the Budget
 * tab's month, the route reads a URL param and owns a PeriodNavigator.
 */
export function MonthlySummaryPage({ month }: MonthlySummaryPageProps) {
  const router = useRouter();
  
  const theme = useTheme();
  const [data, setData] = useState<SummaryData | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!month) return;
    try {
      const { startDate, endDate } = getMonthDateRange(month);
      const [year, m] = month.split("-").map(Number);
      const prevDate = new Date(year, m - 2, 1);
      const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
      const prevRange = getMonthDateRange(prevMonth);

      const [categories, budgets, classification, topCats, txCount, prevSpent] = await Promise.all([
        getCategories(DEFAULT_USER_ID),
        getBudgetsForMonth(DEFAULT_USER_ID, month),
        getSpendClassificationTotals(DEFAULT_USER_ID, startDate, endDate),
        getTopCategoriesBySpending(DEFAULT_USER_ID, startDate, endDate, 5),
        getExpenseCount(DEFAULT_USER_ID, startDate, endDate),
        getExpenseTotal(DEFAULT_USER_ID, prevRange.startDate, prevRange.endDate),
      ]);

      const totalSpent = classification.total;
      const catMap = new Map(categories.map((c) => [c.id, c]));
      const totalBudget = budgets.reduce((sum, b) => sum + b.amount, 0);
      const daysTotal = getTotalDaysInMonth(month);
      const daysLeft = getDaysRemaining(month);
      const daysElapsed = daysTotal - daysLeft;

      setData({
        totalSpent,
        totalBudget,
        rightSpendTotal: classification.unavoidable,
        rightSpendPct: classification.unavoidablePct,
        transactionCount: txCount,
        prevMonthSpent: prevSpent,
        topCategories: topCats.map((tc) => ({
          category: catMap.get(tc.category_id) ?? null,
          total: tc.total,
          pctOfTotal: totalSpent > 0 ? (tc.total / totalSpent) * 100 : 0,
        })),
        budgetCompliancePct: totalBudget > 0 ? Math.min((totalSpent / totalBudget) * 100, 999) : 0,
        daysInMonth: daysTotal,
        daysRemaining: daysLeft,
        avgPerDay: daysElapsed > 0 ? totalSpent / daysElapsed : 0,
      });
    } catch {
      // DB not ready
    }
  }, [month]);

  useDataRefresh(loadData);

  if (!data) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="bar-chart-outline" size={32} color={theme.faintForeground} />
        <Text style={{ color: theme.faintForeground, marginTop: 8, fontSize: 14 }}>Loading summary…</Text>
      </View>
    );
  }

  const spendChange =
    data.prevMonthSpent > 0
      ? ((data.totalSpent - data.prevMonthSpent) / data.prevMonthSpent) * 100
      : 0;
  const spendChangeUp = data.totalSpent > data.prevMonthSpent;

  return (
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
      {/* Total Spend */}
      <Pressable
        onPress={() =>
          router.push({
            pathname: "/budget/transactions" as never,
            params: { filterMonth: month, title: "Expenses" },
          })
        }
      >
        <Card className="mx-4 mt-3">
          <Text className="text-xs text-faint-foreground mb-1">Total Spent</Text>
          <Text className="text-3xl font-bold text-foreground">
            {formatAmount(data.totalSpent)}
          </Text>
          <View className="flex-row items-center mt-2">
            <Text className="text-sm text-muted-foreground">
              {data.transactionCount} transaction{data.transactionCount !== 1 ? "s" : ""}
            </Text>
            <Text className="text-sm text-faint-foreground mx-2">|</Text>
            <Text className="text-sm text-muted-foreground">
              {formatAmount(data.avgPerDay)}/day avg
            </Text>
          </View>
        </Card>
      </Pressable>

      {/* Budget Compliance */}
      <Card className="mx-4 mt-3">
        <Text className="text-xs text-faint-foreground mb-2">Budget Compliance</Text>
        {data.totalBudget > 0 ? (
          <>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-xl font-bold text-foreground">
                {Math.round(data.budgetCompliancePct)}% used
              </Text>
              <Text className="text-sm text-muted-foreground">
                of {formatAmount(data.totalBudget)}
              </Text>
            </View>
            <View className="h-3 rounded-full bg-border overflow-hidden">
              <View
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(data.budgetCompliancePct, 100)}%`,
                  backgroundColor:
                    data.budgetCompliancePct < 70
                      ? theme.success
                      : data.budgetCompliancePct <= 90
                        ? theme.warning
                        : theme.danger,
                }}
              />
            </View>
            <View className="flex-row justify-between mt-2">
              <Text className="text-xs text-faint-foreground">{data.daysRemaining} days remaining</Text>
              <Text
                className="text-xs font-medium"
                style={{
                  color:
                    data.totalBudget - data.totalSpent >= 0
                      ? theme.success
                      : theme.danger,
                }}
              >
                {data.totalBudget - data.totalSpent >= 0
                  ? `${formatAmount(data.totalBudget - data.totalSpent)} left`
                  : `${formatAmount(Math.abs(data.totalBudget - data.totalSpent))} over`}
              </Text>
            </View>
          </>
        ) : (
          <Text className="text-sm text-muted-foreground">
            No budget set for this month
          </Text>
        )}
      </Card>

      {/* vs Last Month */}
      <Card className="mx-4 mt-3">
        <Text className="text-xs text-faint-foreground mb-2">vs Last Month</Text>
        {data.prevMonthSpent > 0 ? (
          <View className="flex-row items-center">
            <Ionicons
              name={spendChangeUp ? "trending-up" : "trending-down"}
              size={24}
              color={spendChangeUp ? theme.danger : theme.success}
            />
            <View className="ml-3">
              <Text
                className="text-lg font-bold"
                style={{
                  color: spendChangeUp ? theme.danger : theme.success,
                }}
              >
                {spendChangeUp ? "+" : ""}
                {Math.round(spendChange)}%
              </Text>
              <Text className="text-xs text-faint-foreground">
                Last month: {formatAmount(data.prevMonthSpent)}
              </Text>
            </View>
          </View>
        ) : (
          <Text className="text-sm text-muted-foreground">
            No data for previous month
          </Text>
        )}
      </Card>

      {/* Unavoidable Spend Ratio */}
      <Card className="mx-4 mt-3">
        <Text className="text-xs text-faint-foreground mb-2">Unavoidable Spend Ratio</Text>
        <View className="flex-row items-center justify-between">
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/budget/transactions" as never,
                params: { filterMonth: month, filterAvoidability: "unavoidable", title: "Unavoidable Expenses" },
              })
            }
          >
            <Text className="text-xl font-bold text-foreground">
              {Math.round(data.rightSpendPct)}%
            </Text>
            <Text className="text-xs text-faint-foreground">
              {formatAmount(data.rightSpendTotal)} of {formatAmount(data.totalSpent)}
            </Text>
          </Pressable>
          <View
            className="w-14 h-14 rounded-full items-center justify-center"
            style={{
              backgroundColor:
                data.rightSpendPct >= 70 ? "#22C55E14" : data.rightSpendPct >= 40 ? "#F59E0B14" : "#EF444414",
            }}
          >
            <Ionicons
              name={
                data.rightSpendPct >= 70 ? "thumbs-up" : data.rightSpendPct >= 40 ? "hand-right" : "thumbs-down"
              }
              size={24}
              color={
                data.rightSpendPct >= 70
                  ? theme.success
                  : data.rightSpendPct >= 40
                    ? theme.warning
                    : theme.danger
              }
            />
          </View>
        </View>
        {data.totalSpent > 0 && (
          <View className="h-2 rounded-full bg-border overflow-hidden mt-3">
            <View
              className="h-full rounded-full"
              style={{
                width: `${data.rightSpendPct}%`,
                backgroundColor:
                  data.rightSpendPct >= 70
                    ? theme.success
                    : data.rightSpendPct >= 40
                      ? theme.warning
                      : theme.danger,
              }}
            />
          </View>
        )}
      </Card>

      {/* Top Categories */}
      <Card className="mx-4 mt-3">
        <Text className="text-xs text-faint-foreground mb-3">Top Categories</Text>
        {data.topCategories.length > 0 ? (
          data.topCategories.map((tc, idx) => (
            <View key={tc.category?.id ?? `unknown-${idx}`} className="mb-3 last:mb-0">
              <View className="flex-row items-center justify-between mb-1">
                <View className="flex-row items-center flex-1">
                  {tc.category && (
                    <View
                      className="w-6 h-6 rounded-full items-center justify-center mr-2"
                      style={{ backgroundColor: tc.category.color + "14" }}
                    >
                      <Ionicons
                        name={tc.category.icon as keyof typeof Ionicons.glyphMap}
                        size={12}
                        color={tc.category.color}
                      />
                    </View>
                  )}
                  <Text
                    className="text-sm text-foreground flex-1"
                    numberOfLines={1}
                  >
                    {tc.category?.name ?? "Unknown"}
                  </Text>
                </View>
                <Text className="text-sm font-semibold text-foreground ml-2">
                  {formatAmount(tc.total)}
                </Text>
              </View>
              <View className="flex-row items-center">
                <View className="h-2 flex-1 rounded-full bg-border overflow-hidden">
                  <View
                    className="h-full rounded-full"
                    style={{
                      width: `${tc.pctOfTotal}%`,
                      backgroundColor: tc.category?.color ?? theme.mutedForeground,
                    }}
                  />
                </View>
                <Text className="text-label text-faint-foreground ml-2 w-10 text-right">
                  {Math.round(tc.pctOfTotal)}%
                </Text>
              </View>
            </View>
          ))
        ) : (
          <Text className="text-sm text-muted-foreground">
            No expenses this month
          </Text>
        )}
      </Card>
    </ScrollView>
  );
}
