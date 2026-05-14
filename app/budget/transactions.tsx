import { useEffect, useMemo, useState, useCallback } from "react";
import { View, Text, FlatList, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getExpensesPaginated,
  getFilteredExpenseSummary,
} from "@/services/expense";
import type { Expense, FilteredSummary } from "@/services/expense";
import { getCategories } from "@/services/category";
import type { Category } from "@/services/category";
import { getPaymentModes } from "@/services/payment-mode";
import type { PaymentMode } from "@/services/payment-mode";
import { getActiveAccounts } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import { ExpenseListRow } from "@/components/expense/ExpenseListRow";
import { formatAmount } from "@/utils/format";

const PAGE_SIZE = 50;

/**
 * Budget-context transaction drill-down.
 *
 * Shows expenses scoped to a month and optional avoidability filter,
 * using status='approved' so totals match budget screen math exactly.
 * Lives inside the budget stack so the back button returns to the
 * originating budget screen (Monthly Summary or Spending Split).
 *
 * Params:
 *   filterMonth       — YYYY-MM, required
 *   filterAvoidability — 'unavoidable' | 'avoidable' | undefined
 *   title             — optional header label
 */
export default function BudgetTransactionsScreen() {
  const router = useRouter();
  const { filterMonth, filterAvoidability, title } = useLocalSearchParams<{
    filterMonth?: string;
    filterAvoidability?: string;
    title?: string;
  }>();
  const { colors } = useColorScheme();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<FilteredSummary | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);

  // Compute date range from filterMonth
  const { startDate, endDate } = useMemo(() => {
    if (!filterMonth) return { startDate: "", endDate: "" };
    const [y, m] = filterMonth.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return {
      startDate: `${filterMonth}-01`,
      endDate: `${filterMonth}-${String(lastDay).padStart(2, "0")}`,
    };
  }, [filterMonth]);

  const filters = useMemo(
    () => ({
      startDate,
      endDate,
      nature: "realized" as const,
      segment: "spend" as const,
      status: "approved" as const,
      avoidability: filterAvoidability === "unavoidable"
        ? ("unavoidable" as const)
        : filterAvoidability === "avoidable"
          ? ("avoidable" as const)
          : undefined,
    }),
    [startDate, endDate, filterAvoidability],
  );

  useEffect(() => {
    (async () => {
      try {
        const [cats, pms, accts] = await Promise.all([
          getCategories(DEFAULT_USER_ID),
          getPaymentModes(DEFAULT_USER_ID),
          getActiveAccounts(DEFAULT_USER_ID),
        ]);
        setCategories(cats);
        setPaymentModes(pms);
        setAccounts(accts);
      } catch {
        // DB not ready
      }
    })();
  }, []);

  const load = useCallback(
    async (reset = true) => {
      if (!startDate || !endDate) return;
      try {
        const offset = reset ? 0 : expenses.length;
        const [data, summaryResult] = await Promise.all([
          getExpensesPaginated(DEFAULT_USER_ID, filters, PAGE_SIZE, offset),
          reset ? getFilteredExpenseSummary(DEFAULT_USER_ID, filters, "category") : Promise.resolve(null),
        ]);
        if (reset) {
          setExpenses(data);
          if (summaryResult) setSummary(summaryResult);
        } else {
          setExpenses((prev) => [...prev, ...data]);
        }
        setHasMore(data.length === PAGE_SIZE);
      } catch {
        // DB not ready
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startDate, endDate, filters],
  );

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load(true);
    }, [load]),
  );

  const handleLoadMore = useCallback(() => {
    if (hasMore && !loading) {
      load(false);
    }
  }, [hasMore, loading, load]);

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );
  const paymentModeMap = useMemo(
    () => new Map(paymentModes.map((p) => [p.id, p])),
    [paymentModes],
  );
  const accountMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );

  const screenTitle = title ?? (filterAvoidability === "unavoidable"
    ? "Unavoidable Expenses"
    : filterAvoidability === "avoidable"
      ? "Discretionary Expenses"
      : "Expenses");

  const handleItemPress = useCallback(
    (id: string) => router.push(`/expense/${id}`),
    [router],
  );

  return (
    <>
      <Stack.Screen options={{ title: screenTitle }} />
      <ScreenContainer padTop={false}>
        {summary && (
          <View className="mx-4 my-2 p-4 rounded-xl bg-surface-light-alt dark:bg-surface-dark-alt">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-medium text-text-secondary dark:text-text-dark-secondary">
                Total (approved)
              </Text>
              <Text className="text-lg font-bold text-text-primary dark:text-text-dark-primary">
                {formatAmount(summary.total)}
              </Text>
            </View>
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
              {summary.count} {summary.count === 1 ? "transaction" : "transactions"}
            </Text>
          </View>
        )}

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={colors.blue} />
          </View>
        ) : expenses.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <Ionicons name="receipt-outline" size={48} color={colors.textSecondary} />
            <Text className="text-lg font-medium text-text-primary dark:text-text-dark-primary mt-4">
              No transactions
            </Text>
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary text-center mt-2">
              No approved expenses for this period.
            </Text>
          </View>
        ) : (
          <FlatList
            data={expenses}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ExpenseListRow
                item={item}
                categoryMap={categoryMap}
                paymentModeMap={paymentModeMap}
                accountMap={accountMap}
                onPress={handleItemPress}
                onLongPress={() => {}}
              />
            )}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.3}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
          />
        )}
      </ScreenContainer>
    </>
  );
}
