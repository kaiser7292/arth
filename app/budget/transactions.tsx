import { useEffect, useMemo, useState, useCallback } from "react";
import { View, FlatList, ActivityIndicator, Pressable, Modal } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Text } from "@/components/ui";
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
import { settingsStorage } from "@/services/storage";

type ExpenseSortBy = "date_desc" | "date_asc" | "amount_desc" | "amount_asc" | "name_asc";
const SORT_OPTIONS: { value: ExpenseSortBy; label: string; icon: string }[] = [
  { value: "date_desc", label: "Date (newest first)", icon: "calendar-outline" },
  { value: "date_asc", label: "Date (oldest first)", icon: "calendar-outline" },
  { value: "amount_desc", label: "Amount (highest first)", icon: "trending-down-outline" },
  { value: "amount_asc", label: "Amount (lowest first)", icon: "trending-up-outline" },
  { value: "name_asc", label: "Alphabetical (A–Z)", icon: "text-outline" },
];
const BUDGET_SORT_KEY = "budget.transactions.sortBy";

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
  const [sortBy, setSortBy] = useState<ExpenseSortBy>(
    () => (settingsStorage.getString(BUDGET_SORT_KEY) as ExpenseSortBy | undefined) ?? "date_desc",
  );
  const [showSortSheet, setShowSortSheet] = useState(false);

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
      sortBy,
    }),
    [startDate, endDate, filterAvoidability, sortBy],
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
      <Stack.Screen
        options={{
          title: screenTitle,
          headerRight: () => (
            <Pressable onPress={() => setShowSortSheet(true)} style={{ marginRight: 8 }} hitSlop={8}>
              <Ionicons
                name="swap-vertical-outline"
                size={22}
                color={sortBy !== "date_desc" ? colors.blue : colors.textSecondary}
              />
            </Pressable>
          ),
        }}
      />
      <ScreenContainer padTop={false}>
        {summary && (
          <View className="mx-4 my-2 p-4 rounded-xl bg-card">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-medium text-muted-foreground">
                Total (approved)
              </Text>
              <Text className="text-lg font-bold text-foreground">
                {formatAmount(summary.total)}
              </Text>
            </View>
            <Text className="text-xs text-muted-foreground mt-0.5">
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
            <Text className="text-lg font-medium text-foreground mt-4">
              No transactions
            </Text>
            <Text className="text-sm text-muted-foreground text-center mt-2">
              No approved expenses for this period.
            </Text>
          </View>
        ) : (
          <FlatList
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={7}
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

      {/* Sort sheet */}
      <Modal transparent animationType="slide" visible={showSortSheet} onRequestClose={() => setShowSortSheet(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={() => setShowSortSheet(false)} />
        <View
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0,
            backgroundColor: colors.surface,
            borderTopLeftRadius: 20, borderTopRightRadius: 20,
            paddingBottom: 28,
          }}
        >
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
                  settingsStorage.set(BUDGET_SORT_KEY, opt.value);
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
