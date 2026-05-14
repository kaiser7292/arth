import { useState, useEffect, useCallback } from "react";
import { View, Text, FlatList, Pressable, RefreshControl } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, ProgressBar, Card, LoadingState } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { TrendBarChart } from "@/components/charts/TrendBarChart";
import { ExpenseListItem } from "@/components/expense/ExpenseListItem";
import { getCategoryById } from "@/services/category";
import type { Category } from "@/services/category";
import { getPaymentModes } from "@/services/payment-mode";
import type { PaymentMode } from "@/services/payment-mode";
import { getActiveAccounts } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import { getBudget } from "@/services/budget";
import { getExpensesPaginated, getCategoryMonthlyTrend } from "@/services/expense";
import type { Expense } from "@/services/expense";
import type { MonthlyTotal } from "@/services/expense";
import { formatAmount } from "@/utils/expense-validation";
import {
  getMonthDateRange,
  getBudgetStatus,
  getBudgetStatusColor,
} from "@/utils/budget-helpers";
import { DEFAULT_USER_ID } from "@/constants/app";

export default function CategoryDetailScreen() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const { categoryId, month: initialMonth } = useLocalSearchParams<{
    categoryId: string;
    month: string;
  }>();

  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [category, setCategory] = useState<Category | null>(null);
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [budgetAmount, setBudgetAmount] = useState(0);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [trend, setTrend] = useState<MonthlyTotal[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Sync when navigating to this screen with new params
  useEffect(() => {
    if (initialMonth) setSelectedMonth(initialMonth);
  }, [initialMonth]);

  const loadData = useCallback(async () => {
    if (!categoryId || !selectedMonth) return;
    const { startDate, endDate } = getMonthDateRange(selectedMonth);

    const [cat, budget, exps, trendData, pms, accts] = await Promise.all([
      getCategoryById(categoryId),
      getBudget(DEFAULT_USER_ID, categoryId, selectedMonth),
      getExpensesPaginated(
        DEFAULT_USER_ID,
        { categoryIds: [categoryId], startDate, endDate },
        200,
        0,
      ),
      getCategoryMonthlyTrend(DEFAULT_USER_ID, categoryId, 6, initialMonth),
      getPaymentModes(DEFAULT_USER_ID),
      getActiveAccounts(DEFAULT_USER_ID),
    ]);

    setCategory(cat);
    setBudgetAmount(budget?.amount ?? 0);
    setExpenses(exps);
    setTotalSpent(exps.reduce((sum, e) => sum + e.amount, 0));
    setTrend(trendData);
    setPaymentModes(pms);
    setAccounts(accts);
  }, [categoryId, selectedMonth]);

  useDataRefresh(loadData);

  if (!category) {
    return (
      <ScreenContainer>
        <LoadingState message="Loading budget..." icon="calculator-outline" />
      </ScreenContainer>
    );
  }

  const remaining = budgetAmount - totalSpent;
  const status = getBudgetStatus(totalSpent, budgetAmount);
  const color = getBudgetStatusColor(status);
  const pct = budgetAmount > 0 ? Math.min(totalSpent / budgetAmount, 1) : 0;

  const monthLabel = (() => {
    const [year, m] = (selectedMonth ?? "").split("-").map(Number);
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    return `${months[m - 1]} ${year}`;
  })();

  const paymentModeMap = new Map(paymentModes.map((p) => [p.id, p]));
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const renderExpense = ({ item }: { item: Expense }) => (
    <ExpenseListItem
      expense={item}
      category={category}
      paymentMode={item.payment_mode_id ? paymentModeMap.get(item.payment_mode_id) : null}
      account={item.account_id ? accountMap.get(item.account_id) : null}
      onPress={() => router.push(`/expense/${item.id}`)}
    />
  );

  return (
    <ScreenContainer>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-border-light dark:border-border-dark">
        <Pressable onPress={() => router.back()} className="p-2 -ml-2 mr-2">
          <Ionicons name="arrow-back" size={22} color={colors.textSecondary} />
        </Pressable>
        <View
          className="w-9 h-9 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: category.color + "14" }}
        >
          <Ionicons
            name={category.icon as keyof typeof Ionicons.glyphMap}
            size={18}
            color={category.color}
          />
        </View>
        <View className="flex-1">
          <Text className="text-lg font-semibold text-text-primary dark:text-text-dark-primary">
            {category.name}
          </Text>
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
            {monthLabel}
          </Text>
        </View>
      </View>

      {/* Summary card */}
      <Card className="mx-4 mt-3 mb-2">
        <View className="flex-row items-center justify-between mb-2">
          <View>
            <Text className="text-xs text-text-tertiary">Spent</Text>
            <Text className="text-xl font-bold" style={{ color }}>
              {formatAmount(totalSpent)}
            </Text>
          </View>
          {budgetAmount > 0 && (
            <View className="items-end">
              <Text className="text-xs text-text-tertiary">Budget</Text>
              <Text className="text-xl font-bold text-text-primary dark:text-text-dark-primary">
                {formatAmount(budgetAmount)}
              </Text>
            </View>
          )}
        </View>

        {budgetAmount > 0 && (
          <>
            <View className="mb-2">
              <ProgressBar value={pct} color={color} height={8} animated={false} />
            </View>
            <Text className="text-xs text-text-tertiary">
              {remaining >= 0
                ? `${formatAmount(remaining)} remaining (${Math.round(pct * 100)}% used)`
                : `${formatAmount(Math.abs(remaining))} over budget`}
            </Text>
          </>
        )}
      </Card>

      {/* Monthly trend chart */}
      {trend.some((t) => t.total > 0) && (
        <Card className="mx-4 mt-2 mb-2">
          <Text className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary mb-3">
            Monthly Trend (Last 6 Months)
          </Text>
          <TrendBarChart
            data={trend}
            color={category.color}
            budgetAmount={budgetAmount}
            selectedMonth={selectedMonth}
            onBarPress={(month) => setSelectedMonth(month)}
          />
        </Card>
      )}

      {/* Transaction count */}
      <View className="px-4 py-2">
        <Text className="text-sm font-medium text-text-secondary dark:text-text-dark-secondary">
          {expenses.length} transaction{expenses.length !== 1 ? "s" : ""}
        </Text>
      </View>

      {/* Transactions */}
      <FlatList
        data={expenses}
        keyExtractor={(item) => item.id}
        renderItem={renderExpense}
        contentContainerStyle={{ paddingBottom: 32 }}
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
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text className="text-text-secondary dark:text-text-dark-secondary">
              No expenses in this category for {monthLabel}
            </Text>
          </View>
        }
      />
    </ScreenContainer>
  );
}
