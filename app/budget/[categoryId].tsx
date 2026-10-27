import { useState, useEffect, useCallback } from "react";
import { SelectSheet } from "@/components/ui";
import { EXPENSE_SORT_OPTIONS, type ExpenseSortBy } from "@/constants/sort-options";
import { View, FlatList, Pressable, RefreshControl, Modal } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, EmptyState, LoadingState, ProgressBar, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { TrendBarChart } from "@/components/charts/TrendBarChart";
import { ExpenseListItem } from "@/components/expense/ExpenseListItem";
import { SpendBreakdown } from "@/components/expense/SpendBreakdown";
import { getPersonsByIds } from "@/services/hisaab";
import type { HisaabPerson } from "@/services/hisaab";
import { buildSplitNote } from "@/utils/split-note";
import { getCategoryById } from "@/services/category";
import type { Category } from "@/services/category";
import { getPaymentModes } from "@/services/payment-mode";
import type { PaymentMode } from "@/services/payment-mode";
import { getActiveAccounts } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import { getBudget } from "@/services/budget";
import { getExpensesPaginated, getCategoryMonthlyTrend, getFilteredExpenseSummary } from "@/services/expense";
import type { SummaryBreakdown } from "@/services/expense";
import { sumRefundsByExpenseIds } from "@/services/expense-effective-amount";
import type { Expense } from "@/services/expense";
import type { MonthlyTotal } from "@/services/expense";
import { formatAmount } from "@/utils/expense-validation";
import {
  getMonthDateRange,
  getBudgetStatus,
  getBudgetStatusColor,
} from "@/utils/budget-helpers";
import { DEFAULT_USER_ID } from "@/constants/app";
import { settingsStorage } from "@/services/storage";

const CATEGORY_SORT_KEY = "budget.category.sortBy";

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
  const [txCount, setTxCount] = useState(0);
  const [refunds, setRefunds] = useState<Map<string, number>>(new Map());
  const [breakdown, setBreakdown] = useState<SummaryBreakdown | null>(null);
  const [personMap, setPersonMap] = useState<Map<string, HisaabPerson>>(new Map());
  const [trend, setTrend] = useState<MonthlyTotal[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState<ExpenseSortBy>(
    () => (settingsStorage.getString(CATEGORY_SORT_KEY) as ExpenseSortBy | undefined) ?? "date_desc",
  );
  const [showSortSheet, setShowSortSheet] = useState(false);

  // Sync when navigating to this screen with new params
  useEffect(() => {
    if (initialMonth) setSelectedMonth(initialMonth);
  }, [initialMonth]);

  const loadData = useCallback(async () => {
    if (!categoryId || !selectedMonth) return;
    const { startDate, endDate } = getMonthDateRange(selectedMonth);

    // Same scope as the Budget tab's figure for this category: approved spending, investment and
    // loan payments left out, linked refunds taken off.
    const filters = {
      categoryIds: [categoryId],
      startDate,
      endDate,
      sortBy,
      status: "approved" as const,
      segment: "spend" as const,
    };
    const [cat, budget, exps, summary, trendData, pms, accts] = await Promise.all([
      getCategoryById(categoryId),
      getBudget(DEFAULT_USER_ID, categoryId, selectedMonth),
      getExpensesPaginated(DEFAULT_USER_ID, filters, 200, 0),
      getFilteredExpenseSummary(DEFAULT_USER_ID, filters, "category"),
      getCategoryMonthlyTrend(DEFAULT_USER_ID, categoryId, 6, initialMonth),
      getPaymentModes(DEFAULT_USER_ID),
      getActiveAccounts(DEFAULT_USER_ID),
    ]);

    setCategory(cat);
    setBudgetAmount(budget?.amount ?? 0);
    setExpenses(exps);
    setTotalSpent(summary.total);
    setTxCount(summary.count);
    setBreakdown(summary.breakdown ?? null);
    const [refundMap, persons] = await Promise.all([
      sumRefundsByExpenseIds(exps.map((e) => e.id)),
      getPersonsByIds([...new Set(exps.map((e) => e.split_person_id).filter(Boolean) as string[])]),
    ]);
    setRefunds(refundMap);
    setPersonMap(persons);
    setTrend(trendData);
    setPaymentModes(pms);
    setAccounts(accts);
  }, [categoryId, selectedMonth, sortBy]);

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
  const pct = budgetAmount > 0 ? totalSpent / budgetAmount : 0;

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
      refundedAmount={refunds.get(item.id) ?? 0}
      splitNote={buildSplitNote(item, personMap)}
      onPress={() => router.push(`/expense/${item.id}`)}
    />
  );

  return (
    <>
    <ScreenContainer>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-border">
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
          <Text className="text-lg font-semibold text-foreground">
            {category.name}
          </Text>
          <Text className="text-xs text-muted-foreground">
            {monthLabel}
          </Text>
        </View>
        <Pressable onPress={() => setShowSortSheet(true)} className="p-2" hitSlop={8}>
          <Ionicons
            name="swap-vertical-outline"
            size={22}
            color={sortBy !== "date_desc" ? category.color : colors.textSecondary}
          />
        </Pressable>
      </View>

      {/* Summary card */}
      <Card className="mx-4 mt-3 mb-2">
        <View className="flex-row items-center justify-between mb-2">
          <View>
            <Text className="text-xs text-faint-foreground">Spent</Text>
            <Text className="text-xl font-bold" style={{ color }}>
              {formatAmount(totalSpent)}
            </Text>
          </View>
          {budgetAmount > 0 && (
            <View className="items-end">
              <Text className="text-xs text-faint-foreground">Budget</Text>
              <Text className="text-xl font-bold text-foreground">
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
            <Text className="text-xs text-faint-foreground">
              {remaining >= 0
                ? `${formatAmount(remaining)} remaining (${Math.round(pct * 100)}% used)`
                : `${formatAmount(Math.abs(remaining))} over budget (${Math.round(pct * 100)}% used)`}
            </Text>
          </>
        )}
        {/* Paid → others' share → refunds → counted; just the count when nothing was split or refunded. */}
        {breakdown && (
          <SpendBreakdown
            count={txCount}
            gross={breakdown.gross}
            othersShare={breakdown.othersShare}
            refunds={breakdown.refunds}
            net={totalSpent}
          />
        )}
      </Card>

      {/* Monthly trend chart */}
      {trend.some((t) => t.total > 0) && (
        <Card className="mx-4 mt-2 mb-2">
          <Text className="text-xs font-medium text-muted-foreground mb-3">
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
        <Text className="text-sm font-medium text-muted-foreground">
          {txCount} transaction{txCount !== 1 ? "s" : ""}
        </Text>
      </View>

      {/* Transactions */}
      <FlatList
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
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
          <EmptyState
            icon="receipt-outline"
            title="Nothing here yet"
            subtitle={`No expenses in this category for ${monthLabel}.`}
          />
        }
      />
    </ScreenContainer>

      {/* Sort sheet */}
      <SelectSheet
        visible={showSortSheet}
        title="Sort by"
        options={EXPENSE_SORT_OPTIONS}
        value={sortBy}
        onChange={(v) => {
          setSortBy(v);
          settingsStorage.set(CATEGORY_SORT_KEY, v);
        }}
        onClose={() => setShowSortSheet(false)}
      />
    </>
  );
}
