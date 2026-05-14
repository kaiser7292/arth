import { useEffect, useMemo, useState, useCallback } from "react";
import { View, Text, FlatList, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getExpensesByIds, sumRefundsByExpenseIds } from "@/services/expense";
import type { Expense } from "@/services/expense";
import { getCategories } from "@/services/category";
import type { Category } from "@/services/category";
import { getPaymentModes } from "@/services/payment-mode";
import type { PaymentMode } from "@/services/payment-mode";
import { getActiveAccounts } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import { ExpenseListRow } from "@/components/expense/ExpenseListRow";
import { formatAmount } from "@/utils/format";

/**
 * Insight drill-down list.
 *
 * Shows the exact set of expenses that contributed to a breakdown row in the
 * insight-detail screen. Lives under the insights Stack so the back button
 * returns to insight-detail (not to the Expenses tab).
 *
 * Params:
 *   expenseIds — comma-separated list of expense IDs to display
 *   title      — short label shown under the header (e.g. "Food → Zomato")
 */
export default function InsightFilteredListScreen() {
  const router = useRouter();
  const { expenseIds, title } = useLocalSearchParams<{
    expenseIds?: string;
    title?: string;
  }>();
  const { colors } = useColorScheme();

  const ids = useMemo(
    () => (expenseIds ? expenseIds.split(",").filter((s) => s.length > 0) : []),
    [expenseIds],
  );

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [refundedMap, setRefundedMap] = useState<Map<string, number>>(new Map());
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [loading, setLoading] = useState(true);

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
        // DB not ready — list will render without enriched labels
      }
    })();
  }, []);

  const load = useCallback(async () => {
    try {
      const rows = await getExpensesByIds(ids);
      setExpenses(rows);
      const refunds = await sumRefundsByExpenseIds(rows.map((e) => e.id));
      setRefundedMap(refunds);
    } catch {
      // fall through — empty state handles it
    } finally {
      setLoading(false);
    }
  }, [ids]);

  // Reload on focus so edits to an individual expense are reflected when the
  // user navigates back to this list.
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

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

  const total = useMemo(
    () => expenses.reduce((sum, e) => {
      const refunded = refundedMap.get(e.id) ?? 0;
      return sum + Math.max((e.amount ?? 0) - refunded, 0);
    }, 0),
    [expenses, refundedMap],
  );

  const handleItemPress = useCallback(
    (id: string) => router.push(`/expense/${id}`),
    [router],
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: "Transactions",
        }}
      />
      <ScreenContainer padTop={false}>
        {/* Header: title from insight + total */}
        {title && (
          <View className="px-4 pt-3 pb-2">
            <Text
              className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary"
              numberOfLines={2}
            >
              {title}
            </Text>
          </View>
        )}

        <View className="mx-4 my-2 p-4 rounded-xl bg-surface-light-alt dark:bg-surface-dark-alt">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-medium text-text-secondary dark:text-text-dark-secondary">
              Total
            </Text>
            <Text className="text-lg font-bold text-text-primary dark:text-text-dark-primary">
              {formatAmount(total)}
            </Text>
          </View>
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
            {expenses.length} {expenses.length === 1 ? "transaction" : "transactions"}
          </Text>
        </View>

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
              The expenses that fed this insight may have been deleted.
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
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
          />
        )}
      </ScreenContainer>
    </>
  );
}
