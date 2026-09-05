import { useState, useEffect, useCallback } from "react";
import { View, Text, FlatList, Pressable, RefreshControl, Modal } from "react-native";
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
import { settingsStorage } from "@/services/storage";

type ExpenseSortBy = "date_desc" | "date_asc" | "amount_desc" | "amount_asc" | "name_asc";
const SORT_OPTIONS: { value: ExpenseSortBy; label: string; icon: string }[] = [
  { value: "date_desc", label: "Date (newest first)", icon: "calendar-outline" },
  { value: "date_asc", label: "Date (oldest first)", icon: "calendar-outline" },
  { value: "amount_desc", label: "Amount (highest first)", icon: "trending-down-outline" },
  { value: "amount_asc", label: "Amount (lowest first)", icon: "trending-up-outline" },
  { value: "name_asc", label: "Alphabetical (A–Z)", icon: "text-outline" },
];
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

    const [cat, budget, exps, trendData, pms, accts] = await Promise.all([
      getCategoryById(categoryId),
      getBudget(DEFAULT_USER_ID, categoryId, selectedMonth),
      getExpensesPaginated(
        DEFAULT_USER_ID,
        { categoryIds: [categoryId], startDate, endDate, sortBy },
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
            <Text className="text-muted-foreground">
              No expenses in this category for {monthLabel}
            </Text>
          </View>
        }
      />
    </ScreenContainer>

      {/* Sort sheet */}
      <Modal transparent animationType="slide" visible={showSortSheet} onRequestClose={() => setShowSortSheet(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={() => setShowSortSheet(false)} />
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 28 }}>
          <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 4 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12, paddingTop: 4 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>Sort by</Text>
            <Pressable onPress={() => setShowSortSheet(false)} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          {SORT_OPTIONS.map((opt) => {
            const active = sortBy === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => {
                  setSortBy(opt.value);
                  settingsStorage.set(CATEGORY_SORT_KEY, opt.value);
                  setShowSortSheet(false);
                }}
                style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14 }}
              >
                <Ionicons name={opt.icon as never} size={18} color={active ? colors.blue : colors.textSecondary} />
                <Text style={{ flex: 1, fontSize: 14, marginLeft: 12, color: active ? colors.blue : colors.text, fontWeight: active ? "600" : "400" }}>
                  {opt.label}
                </Text>
                {active && <Ionicons name="checkmark" size={18} color={colors.blue} />}
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </>
  );
}
