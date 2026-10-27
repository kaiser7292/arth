import { useEffect, useMemo, useState, useCallback } from "react";
import { SelectSheet } from "@/components/ui";
import { EXPENSE_SORT_OPTIONS, type ExpenseSortBy } from "@/constants/sort-options";
import { View, FlatList, ActivityIndicator, Pressable, Modal } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect, Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LoadingState, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { DEFAULT_USER_ID } from "@/constants/app";
import { settingsStorage } from "@/services/storage";

const INSIGHTS_SORT_KEY = "insights.filtered.sortBy";
import { getExpensesByIds, sumRefundsByExpenseIds } from "@/services/expense";
import type { Expense } from "@/services/expense";
import { getCategories } from "@/services/category";
import type { Category } from "@/services/category";
import { getPaymentModes } from "@/services/payment-mode";
import type { PaymentMode } from "@/services/payment-mode";
import { getActiveAccounts } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import { getPersonsByIds } from "@/services/hisaab";
import type { HisaabPerson } from "@/services/hisaab";
import { ExpenseListRow } from "@/components/expense/ExpenseListRow";
import { SpendBreakdown } from "@/components/expense/SpendBreakdown";
import { buildSplitNote } from "@/utils/split-note";
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
  const [personMap, setPersonMap] = useState<Map<string, HisaabPerson>>(new Map());
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<ExpenseSortBy>(
    () => (settingsStorage.getString(INSIGHTS_SORT_KEY) as ExpenseSortBy | undefined) ?? "date_desc",
  );
  const [showSortSheet, setShowSortSheet] = useState(false);

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

      const [refunds, persons] = await Promise.all([
        sumRefundsByExpenseIds(rows.map((e) => e.id)),
        (async () => {
          const splitIds = [...new Set(rows.map((e) => e.split_person_id).filter(Boolean) as string[])];
          return getPersonsByIds(splitIds);
        })(),
      ]);
      setRefundedMap(refunds);
      setPersonMap(persons);
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

  // Net total (what the analytics count): refund-adjusted, split-adjusted
  const total = useMemo(
    () => expenses.reduce((sum, e) => {
      const refunded = refundedMap.get(e.id) ?? 0;
      const original = e.split_original_amount ?? e.amount;
      const myProportion = original > 0 ? e.amount / original : 1;
      return sum + Math.max(0, Math.round((original - refunded) * myProportion * 100) / 100);
    }, 0),
    [expenses, refundedMap],
  );

  // Gross total before any adjustments (full pre-split amounts)
  const grossTotal = useMemo(
    () => expenses.reduce((sum, e) => sum + (e.split_original_amount ?? e.amount), 0),
    [expenses],
  );

  // How much was trimmed by splits (others' shares)
  const splitDeduction = useMemo(
    () => expenses.reduce((sum, e) => {
      if (!e.split_original_amount) return sum;
      return sum + Math.max(0, e.split_original_amount - e.amount);
    }, 0),
    [expenses],
  );

  // Your share of the refunds (on a split bill the rest went back on the other person's share), so
  // gross − others' share − refunds comes to the net total.
  const refundDeduction = useMemo(
    () => expenses.reduce((sum, e) => {
      const refunded = refundedMap.get(e.id) ?? 0;
      const original = e.split_original_amount ?? e.amount;
      const myProportion = original > 0 ? e.amount / original : 1;
      return sum + Math.min(refunded, original) * myProportion;
    }, 0),
    [expenses, refundedMap],
  );

  // Per-expense split note string
  const splitNoteMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of expenses) {
      const note = buildSplitNote(e, personMap);
      if (note) map.set(e.id, note);
    }
    return map;
  }, [expenses, personMap]);

  const sortedExpenses = useMemo(() => {
    const arr = [...expenses];
    switch (sortBy) {
      case "date_asc": return arr.sort((a, b) => a.date.localeCompare(b.date));
      case "amount_desc": return arr.sort((a, b) => b.amount - a.amount);
      case "amount_asc": return arr.sort((a, b) => a.amount - b.amount);
      case "name_asc": return arr.sort((a, b) => (a.merchant_name ?? a.description ?? "").localeCompare(b.merchant_name ?? b.description ?? ""));
      default: return arr.sort((a, b) => b.date.localeCompare(a.date));
    }
  }, [expenses, sortBy]);

  const handleItemPress = useCallback(
    (id: string) => router.push(`/expense/${id}`),
    [router],
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: "Transactions",
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
        {title && (
          <View className="px-4 pt-3 pb-2">
            <Text
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              numberOfLines={2}
            >
              {title}
            </Text>
          </View>
        )}

        {/* ── Summary card ──────────────────────────────────────────── */}
        <View className="mx-4 my-2 p-4 rounded-xl bg-card">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-medium text-muted-foreground">
              Total
            </Text>
            <Text className="text-lg font-bold text-foreground">
              {formatAmount(total)}
            </Text>
          </View>

          <SpendBreakdown
            count={expenses.length}
            gross={grossTotal}
            othersShare={splitDeduction}
            refunds={refundDeduction}
            net={total}
          />
        </View>

        {/* ── Transaction list ──────────────────────────────────────── */}
        {loading ? (
          <LoadingState />
        ) : expenses.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <Ionicons name="receipt-outline" size={48} color={colors.textSecondary} />
            <Text className="text-lg font-medium text-foreground mt-4">
              No transactions
            </Text>
            <Text className="text-sm text-muted-foreground text-center mt-2">
              The expenses that fed this insight may have been deleted.
            </Text>
          </View>
        ) : (
          <FlatList
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={7}
            data={sortedExpenses}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ExpenseListRow
                item={item}
                categoryMap={categoryMap}
                paymentModeMap={paymentModeMap}
                accountMap={accountMap}
                refundedMap={refundedMap}
                onPress={handleItemPress}
                onLongPress={() => {}}
                splitNote={splitNoteMap.get(item.id)}
              />
            )}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
          />
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
          settingsStorage.set(INSIGHTS_SORT_KEY, v);
        }}
        onClose={() => setShowSortSheet(false)}
      />
    </>
  );
}
