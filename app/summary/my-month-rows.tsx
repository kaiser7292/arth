import { useCallback, useMemo, useState } from "react";
import { Pressable, SectionList, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ExpenseListRow } from "@/components/expense/ExpenseListRow";
import { Card, ListToolbar, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { useListTools } from "@/hooks/use-list-tools";
import { creditLook } from "@/services/expense-types";
import { transactionDayLabel } from "@/utils/day-label";
import type { ListField, ListSort } from "@/utils/list-tools";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getCategories, type Category } from "@/services/category";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { getMyMonthGroups, getMyMonthRangeGroups, type MyMonthGroup, type MyMonthRow, type MyMonthSection } from "@/services/my-month-rows";
import { getPaymentModes, type PaymentMode } from "@/services/payment-mode";
import { formatAmount, formatDateForDisplay } from "@/utils/expense-validation";

/** A row and the part of the figure it belongs to. */
type FigureRow = { figure: string; row: MyMonthRow };
const dateOf = ({ row: r }: FigureRow) => (r.kind === "expense" ? r.expense.date : r.transfer.date);
const amountOf = ({ row: r }: FigureRow) => (r.kind === "expense" ? r.expense.amount : r.transfer.amount);
const ROW_SORTS: ListSort<FigureRow>[] = [
  { id: "date_desc", label: "Newest first", compare: (a, b) => dateOf(b).localeCompare(dateOf(a)) },
  { id: "date_asc", label: "Oldest first", compare: (a, b) => dateOf(a).localeCompare(dateOf(b)) },
  { id: "amount_desc", label: "Amount (highest first)", compare: (a, b) => amountOf(b) - amountOf(a) },
  { id: "amount_asc", label: "Amount (lowest first)", compare: (a, b) => amountOf(a) - amountOf(b) },
];

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

  const allRows = useMemo<FigureRow[]>(() => (groups ?? []).flatMap((g) => g.rows.map((row) => ({ figure: g.title, row }))), [groups]);
  const fields = useMemo<ListField<FigureRow>[]>(() => {
    const accountName = (key: string) => {
      const account = accountMap.get(key);
      return account ? account.account_label || account.bank_name : "Other account";
    };
    return [
      { id: "figure", label: "This figure's parts", keyOf: (r) => r.figure, group: true, groupOrder: "first" },
      { id: "date", label: "Date", keyOf: (r) => dateOf(r).slice(0, 10), labelOf: transactionDayLabel, group: true, groupOrder: "first" },
      {
        id: "category",
        label: "Category or type",
        keyOf: ({ row: r }) => {
          if (r.kind === "transfer") return "Transfers";
          const e = r.expense;
          return e.nature === "credit" ? creditLook(e.credit_kind).name : e.category_id ? (categoryMap.get(e.category_id)?.name ?? "Unknown") : null;
        },
        noneLabel: "Uncategorized",
        group: true,
        filter: true,
        searchable: true,
      },
      {
        id: "merchant",
        label: "Merchant or payer",
        keyOf: ({ row: r }) => (r.kind === "transfer" ? r.transfer.description : r.expense.merchant_name?.trim()),
        noneLabel: "No merchant",
        group: true,
        filter: true,
        searchable: true,
      },
      {
        id: "account",
        label: "Account",
        keyOf: ({ row: r }) => (r.kind === "transfer" ? r.transfer.from_account_id : r.expense.account_id),
        labelOf: accountName,
        noneLabel: "No account",
        group: true,
        filter: true,
      },
    ];
  }, [categoryMap, accountMap]);
  const rowSearch = useCallback(({ row: r }: FigureRow) => {
    if (r.kind === "transfer") return { texts: [r.transfer.description], amounts: [r.transfer.amount] };
    const e = r.expense;
    return {
      texts: [e.merchant_name, e.description, e.nature === "credit" ? creditLook(e.credit_kind).name : e.category_id ? categoryMap.get(e.category_id)?.name : null],
      amounts: [e.amount],
    };
  }, [categoryMap]);
  const tools = useListTools<FigureRow>({
    screen: `my_month_${params.section}`,
    rows: allRows,
    fields,
    search: rowSearch,
    searchPlaceholder: "Search name or >5000",
    sorts: ROW_SORTS,
    amountOf,
    // "Other money in" is every kind of credit in one list, so it starts split up by type.
    defaultGroup: params.section === "other" ? "category" : "figure",
    noGrouping: false,
  });
  const sections = useMemo(() => {
    const out: { title: string; total: number; data: MyMonthRow[] }[] = [];
    for (const row of tools.grouped) {
      if (row.type === "heading") out.push({ title: row.label, total: row.total, data: [] });
      else out[out.length - 1].data.push(row.item.row);
    }
    return out;
  }, [tools.grouped]);
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

  const count = allRows.length;

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
        <>
        {allRows.length > 0 && <ListToolbar {...tools.toolbar} />}
        {tools.filterSheet}
        <SectionList
          sections={sections}
          keyExtractor={(item, i) => `${item.kind === "expense" ? item.expense.id : item.transfer.id}-${i}`}
          renderItem={renderRow}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListHeaderComponent={
            count > 0 ? (
              <>
                <Text className="text-xs text-muted-foreground px-4 pt-3">
                  {count} transaction{count === 1 ? "" : "s"} in this figure
                </Text>
              </>
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
              <Text className="text-sm text-muted-foreground text-center">
                {tools.narrowed ? "Nothing matches." : "No transactions behind this figure this month."}
              </Text>
            </View>
          }
        />
        </>
      )}
    </ScreenContainer>
  );
}
