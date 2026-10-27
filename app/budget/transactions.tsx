import { useEffect, useMemo, useState, useCallback } from "react";
import { SelectSheet } from "@/components/ui";
import { EXPENSE_SORT_OPTIONS, type ExpenseSortBy } from "@/constants/sort-options";
import { View, FlatList, ActivityIndicator, Pressable, Modal } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect, Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, LoadingState, ScreenContainer, Text, useToast } from "@/components/ui";
import { bulkUpdateExpenses } from "@/services/expense-bulk";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getExpensesPaginated,
  getFilteredExpenseSummary,
} from "@/services/expense";
import type { Expense, FilteredSummary } from "@/services/expense";
import { sumRefundsByExpenseIds } from "@/services/expense-effective-amount";
import { NOT_SET } from "@/services/expense-types";
import { getCategories } from "@/services/category";
import type { Category } from "@/services/category";
import { getPaymentModes } from "@/services/payment-mode";
import type { PaymentMode } from "@/services/payment-mode";
import { getActiveAccounts } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import { ExpenseListRow } from "@/components/expense/ExpenseListRow";
import { SpendBreakdown } from "@/components/expense/SpendBreakdown";
import { getPersonsByIds } from "@/services/hisaab";
import type { HisaabPerson } from "@/services/hisaab";
import { buildSplitNote } from "@/utils/split-note";
import { formatAmount } from "@/utils/format";
import { settingsStorage } from "@/services/storage";

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
 *   filterAvoidability — 'unavoidable' | 'avoidable' | 'unclassified' | undefined
 *   categoryId        — optional, one category ("none" = expenses with no category)
 *   title             — optional header label
 *
 * "Select" (or a long press) picks rows to mark unavoidable or discretionary in one go - the way
 * through "Classify these" on Spending Split, and for moving rows between the two groups.
 */
export default function BudgetTransactionsScreen() {
  const router = useRouter();
  const { filterMonth, filterAvoidability, categoryId, title } = useLocalSearchParams<{
    filterMonth?: string;
    filterAvoidability?: string;
    categoryId?: string;
    title?: string;
  }>();
  const { colors } = useColorScheme();
  const toast = useToast();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [classifying, setClassifying] = useState(false);
  const [refundedMap, setRefundedMap] = useState<Map<string, number>>(new Map());
  const [personMap, setPersonMap] = useState<Map<string, HisaabPerson>>(new Map());
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
      avoidability: (["unavoidable", "avoidable", "unclassified"] as const).find((a) => a === filterAvoidability),
      categoryIds: categoryId ? [categoryId === "none" ? NOT_SET : categoryId] : undefined,
      sortBy,
    }),
    [startDate, endDate, filterAvoidability, categoryId, sortBy],
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
        // Refunds linked to these rows, so a refunded expense shows struck through / reduced,
        // matching the total above (which already takes them off).
        // ...and the people split ones are shared with, for the note under each.
        const [refunds, persons] = await Promise.all([
          sumRefundsByExpenseIds(data.map((e) => e.id)),
          getPersonsByIds([...new Set(data.map((e) => e.split_person_id).filter(Boolean) as string[])]),
        ]);
        if (reset) {
          setExpenses(data);
          setRefundedMap(refunds);
          setPersonMap(persons);
          if (summaryResult) setSummary(summaryResult);
        } else {
          setExpenses((prev) => [...prev, ...data]);
          setRefundedMap((prev) => new Map([...prev, ...refunds]));
          setPersonMap((prev) => new Map([...prev, ...persons]));
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
      : filterAvoidability === "unclassified"
        ? "Not Classified Yet"
        : "Expenses");

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleItemPress = useCallback(
    (id: string) => (selecting ? toggle(id) : router.push(`/expense/${id}`)),
    [router, selecting, toggle],
  );

  const handleLongPress = useCallback(
    (e: Expense) => {
      setSelecting(true);
      toggle(e.id);
    },
    [toggle],
  );

  const stopSelecting = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  const classify = useCallback(
    async (isRightSpend: 0 | 1) => {
      const ids = [...selected];
      if (ids.length === 0) return;
      setClassifying(true);
      try {
        await bulkUpdateExpenses(ids, { is_right_spend: isRightSpend });
        toast(
          `Marked ${ids.length} ${isRightSpend === 1 ? "unavoidable" : "discretionary"}`,
          { tone: "success" },
        );
        stopSelecting();
        await load(true);
      } catch {
        toast("Couldn't change them. Try again.", { tone: "danger" });
      } finally {
        setClassifying(false);
      }
    },
    [selected, toast, stopSelecting, load],
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: screenTitle,
          headerRight: () => (
            // Icons only, spaced like HeaderBackHome on the left: iOS 26 puts header buttons in a
            // glass capsule, and a text label beside an icon looked cramped and lopsided in it.
            <View style={{ flexDirection: "row", alignItems: "center", marginRight: 4, gap: 4 }}>
              {expenses.length > 0 && (
                <Pressable
                  onPress={selecting ? stopSelecting : () => setSelecting(true)}
                  hitSlop={8}
                  style={{ padding: 4 }}
                  accessibilityRole="button"
                  accessibilityLabel={selecting ? "Cancel selecting" : "Select transactions"}
                >
                  <Ionicons name={selecting ? "close" : "checkmark-circle-outline"} size={22} color={colors.tint} />
                </Pressable>
              )}
              <Pressable
                onPress={() => setShowSortSheet(true)}
                hitSlop={8}
                style={{ padding: 4 }}
                accessibilityRole="button"
                accessibilityLabel="Sort"
              >
                <Ionicons
                  name="swap-vertical-outline"
                  size={22}
                  color={sortBy !== "date_desc" ? colors.blue : colors.textSecondary}
                />
              </Pressable>
            </View>
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
            <SpendBreakdown
              count={summary.count}
              gross={summary.breakdown?.gross ?? summary.total}
              othersShare={summary.breakdown?.othersShare ?? 0}
              refunds={summary.breakdown?.refunds ?? 0}
              net={summary.total}
            />
          </View>
        )}

        {loading ? (
          <LoadingState />
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
                refundedMap={refundedMap}
                splitNote={buildSplitNote(item, personMap)}
                onPress={handleItemPress}
                onLongPress={handleLongPress}
                rightElement={
                  selecting ? (
                    <Ionicons
                      name={selected.has(item.id) ? "checkbox" : "square-outline"}
                      size={22}
                      color={selected.has(item.id) ? colors.blue : colors.textSecondary}
                      style={{ marginLeft: 10 }}
                    />
                  ) : undefined
                }
              />
            )}
            extraData={selecting ? selected : personMap}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.3}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: selecting ? 160 : 40 }}
          />
        )}

        {selecting && (
          <View className="absolute left-0 right-0 bottom-0 px-4 pt-3 pb-6 bg-card border-t border-border">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-sm text-foreground">
                {selected.size === 0 ? "Tap transactions to pick them" : `${selected.size} selected`}
              </Text>
              <Pressable
                onPress={() =>
                  setSelected(selected.size === expenses.length ? new Set() : new Set(expenses.map((e) => e.id)))
                }
                hitSlop={8}
              >
                <Text className="text-sm font-semibold text-primary">
                  {selected.size === expenses.length ? "Select none" : `Select all ${expenses.length}`}
                </Text>
              </Pressable>
            </View>
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button
                  title="Unavoidable"
                  onPress={() => void classify(1)}
                  disabled={selected.size === 0 || classifying}
                />
              </View>
              <View className="flex-1">
                <Button
                  title="Discretionary"
                  variant="outline"
                  onPress={() => void classify(0)}
                  disabled={selected.size === 0 || classifying}
                />
              </View>
            </View>
          </View>
        )}
      </ScreenContainer>

      {/* Sort sheet */}
      <SelectSheet
        visible={showSortSheet}
        title="Sort by"
        options={EXPENSE_SORT_OPTIONS}
        value={sortBy}
        onChange={(v) => {
          setSortBy(v);
          settingsStorage.set(BUDGET_SORT_KEY, v);
        }}
        onClose={() => setShowSortSheet(false)}
      />
    </>
  );
}
