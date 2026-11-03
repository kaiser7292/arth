import { useCallback, useMemo, useState } from "react";
import { Pressable, SectionList, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ExpenseListRow } from "@/components/expense/ExpenseListRow";
import { Card, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getCategories, type Category } from "@/services/category";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { getMyMonthGroups, getMyMonthRangeGroups, type MyMonthGroup, type MyMonthRow, type MyMonthSection } from "@/services/my-month-rows";
import { getPaymentModes, type PaymentMode } from "@/services/payment-mode";
import { formatAmount, formatDateForDisplay } from "@/utils/expense-validation";

/** The transactions behind a figure on My Month. Each row opens its details. */
export default function MyMonthRowsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ month: string; endMonth?: string; section: MyMonthSection; categoryId?: string; title?: string }>();
  const [groups, setGroups] = useState<MyMonthGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [modes, setModes] = useState<PaymentMode[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);

  useDataRefresh(
    useCallback(async () => {
      try {
        const category = params.categoryId === undefined ? undefined : params.categoryId === "none" ? null : params.categoryId;
        setGroups(
          params.endMonth && params.endMonth !== params.month
            ? await getMyMonthRangeGroups(DEFAULT_USER_ID, params.month, params.endMonth, params.section, category)
            : await getMyMonthGroups(DEFAULT_USER_ID, params.month, params.section, category),
        );
        setFailed(false);
      } catch {
        setFailed(true);
      }
      // Names and icons only: without them the rows still open.
      setCategories(await getCategories(DEFAULT_USER_ID).catch(() => []));
      setModes(await getPaymentModes(DEFAULT_USER_ID).catch(() => []));
      setAccounts(await getActiveAccounts(DEFAULT_USER_ID).catch(() => []));
    }, [params.month, params.endMonth, params.section, params.categoryId]),
  );

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const modeMap = useMemo(() => new Map(modes.map((m) => [m.id, m])), [modes]);
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const openExpense = useCallback((id: string) => router.push(`/expense/${id}`), [router]);
  const noop = useCallback(() => {}, []);

  const sections = useMemo(() => (groups ?? []).map((g) => ({ title: g.title, total: g.total, data: g.rows })), [groups]);
  const single = sections.length === 1;

  const renderRow = ({ item }: { item: MyMonthRow }) => {
    if (item.kind === "expense") {
      return (
        <ExpenseListRow
          item={item.expense}
          categoryMap={categoryMap}
          paymentModeMap={modeMap}
          accountMap={accountMap}
          onPress={openExpense}
          onLongPress={noop}
        />
      );
    }
    const t = item.transfer;
    const to = accountMap.get(t.to_account_id);
    return (
      <Pressable
        onPress={() => router.push(t.linked_expense_id ? `/expense/${t.linked_expense_id}` : `/transfer/${t.id}`)}
        className="flex-row items-center px-4 py-3.5 border-b border-border"
        accessibilityRole="button"
      >
        <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.08) }}>
          <Ionicons name="swap-horizontal-outline" size={20} color={theme.primary} />
        </View>
        <View className="flex-1 mr-3">
          <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>{t.description || "Transfer"}</Text>
          {to && <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>To {to.account_label || to.bank_name}</Text>}
        </View>
        <View className="items-end shrink-0">
          <Text className="text-sm font-bold text-foreground">{formatAmount(t.amount)}</Text>
          <Text className="text-xs text-muted-foreground mt-0.5">{formatDateForDisplay(t.date)}</Text>
        </View>
      </Pressable>
    );
  };

  const count = sections.reduce((s, g) => s + g.data.length, 0);

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen options={{ title: params.title ?? "Transactions" }} />
      {failed ? (
        <View className="p-4">
          <Card>
            <Text className="text-sm text-muted-foreground">Couldn&apos;t load these transactions. Go back and try again.</Text>
          </Card>
        </View>
      ) : !groups ? (
        <LoadingState message="Finding the transactions..." icon="list-outline" />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item, i) => `${item.kind === "expense" ? item.expense.id : item.transfer.id}-${i}`}
          renderItem={renderRow}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListHeaderComponent={
            count > 0 ? (
              <Text className="text-xs text-muted-foreground px-4 pt-3">
                {count} transaction{count === 1 ? "" : "s"} in this figure
              </Text>
            ) : null
          }
          renderSectionHeader={({ section }) => (
            <View className="px-4 pt-4 pb-1.5 flex-row items-baseline justify-between">
              <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground">{section.title}</Text>
              <Text className={single ? "text-sm font-bold text-foreground" : "text-label font-semibold text-muted-foreground"}>
                {formatAmount(section.total)}
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <View className="items-center py-12 px-6">
              <Text className="text-sm text-muted-foreground text-center">No transactions behind this figure this month.</Text>
            </View>
          }
        />
      )}
    </ScreenContainer>
  );
}
