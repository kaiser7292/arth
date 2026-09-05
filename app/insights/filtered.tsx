import { useEffect, useMemo, useState, useCallback } from "react";
import { View, FlatList, ActivityIndicator, Pressable, Modal } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
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
import { formatAmount } from "@/utils/format";

import { useTheme } from "@/hooks/use-theme";

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
  const theme = useTheme();

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

  // How much was refunded (applied to the gross/original amount)
  const refundDeduction = useMemo(
    () => expenses.reduce((sum, e) => {
      const refunded = refundedMap.get(e.id) ?? 0;
      const original = e.split_original_amount ?? e.amount;
      return sum + Math.min(refunded, original);
    }, 0),
    [expenses, refundedMap],
  );

  const hasAdjustments = grossTotal !== total;

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

          {hasAdjustments ? (
            // Expanded breakdown when adjustments exist
            <View className="mt-2 pt-2 border-t border-border">
              {/* Gross row */}
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-xs text-muted-foreground">
                  {expenses.length} {expenses.length === 1 ? "transaction" : "transactions"} · gross
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {formatAmount(grossTotal)}
                </Text>
              </View>
              {/* Split deduction */}
              {splitDeduction > 0 && (
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-xs" style={{ color: theme.warning }}>
                    🤝 Others' share (split)
                  </Text>
                  <Text className="text-xs font-medium" style={{ color: theme.warning }}>
                    −{formatAmount(splitDeduction)}
                  </Text>
                </View>
              )}
              {/* Refund deduction */}
              {refundDeduction > 0 && (
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-xs" style={{ color: theme.success }}>
                    ↩ Refunds
                  </Text>
                  <Text className="text-xs font-medium" style={{ color: theme.success }}>
                    −{formatAmount(refundDeduction)}
                  </Text>
                </View>
              )}
              {/* Net line */}
              <View className="flex-row items-center justify-between pt-1.5 border-t border-border mt-0.5">
                <Text className="text-xs font-semibold text-foreground">
                  Net counted
                </Text>
                <Text className="text-xs font-bold text-foreground">
                  {formatAmount(total)}
                </Text>
              </View>
            </View>
          ) : (
            <Text className="text-xs text-muted-foreground mt-0.5">
              {expenses.length} {expenses.length === 1 ? "transaction" : "transactions"}
            </Text>
          )}
        </View>

        {/* ── Transaction list ──────────────────────────────────────── */}
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
                  settingsStorage.set(INSIGHTS_SORT_KEY, opt.value);
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildSplitNote(
  expense: Expense,
  personMap: Map<string, HisaabPerson>,
): string | null {
  // No split at all
  if (!expense.split_original_amount && !expense.split_person_id) return null;

  const personName = expense.split_person_id
    ? (personMap.get(expense.split_person_id)?.name ?? null)
    : null;

  const original = expense.split_original_amount;

  switch (expense.split_mode) {
    case "they_owe_full":
      return personName
        ? `Paid for ${personName} · ₹0 counted (they owe you)`
        : "Paid for someone · ₹0 counted";

    case "i_owe_full":
      return personName
        ? `${personName} paid · full amount counted`
        : "Full amount counted (you owed)";

    case "equal":
      return original
        ? `Your half of ${formatAmount(original)}`
        : "Your half";

    case "percentage":
      return original && expense.split_pct != null
        ? `Your ${expense.split_pct}% of ${formatAmount(original)}`
        : null;

    case "exact":
      return original && original !== expense.amount
        ? `Your ${formatAmount(expense.amount)} of ${formatAmount(original)}`
        : null;

    default:
      // Legacy rows (pre-migration-024): reconstruct from amounts
      if (original && original !== expense.amount) {
        const pct = original > 0 ? Math.round((expense.amount / original) * 100) : null;
        return pct != null
          ? `Your ${pct}% of ${formatAmount(original)}`
          : `Your share of ${formatAmount(original)}`;
      }
      return null;
  }
}
