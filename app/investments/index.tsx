import { useCallback, useState } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, EmptyState, FAB, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  batchInvestmentProducts,
  getUnifiedInvestmentValues,
  isDematLikeAccount,
  isPensionLikeAccount,
  INSTRUMENT_LABELS,
  type InvestmentProduct,
} from "@/services/investment-accounts";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { formatAmount } from "@/utils/format";
import { formatDate } from "@/utils/date";
import { useTheme } from "@/hooks/use-theme";

interface InvestmentRow {
  account: FinancialAccount;
  product: InvestmentProduct | null;
  value: number;
  isMarket: boolean;
  isPension: boolean;
}

export default function InvestmentsListScreen() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [rows, setRows] = useState<InvestmentRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const allAccounts = await getActiveAccounts(DEFAULT_USER_ID);
    const accounts = allAccounts.filter(
      (a) => a.account_type === "investment" || a.account_type === "demat" || a.account_type === "pension",
    );
    const ids = accounts.filter((a) => a.account_type === "investment").map((a) => a.id);
    const products = await batchInvestmentProducts(ids);
    const values = await getUnifiedInvestmentValues(DEFAULT_USER_ID, accounts, products);

    setRows(
      accounts.map((account) => {
        const product = products.get(account.id) ?? null;
        return {
          account,
          product,
          value: values.get(account.id) ?? 0,
          isMarket: isDematLikeAccount(account, product),
          isPension: isPensionLikeAccount(account, product),
        };
      }),
    );
    setLoaded(true);
  }, []);

  useDataRefresh(load);

  const total = rows.reduce((sum, r) => sum + r.value, 0);

  const handlePress = (row: InvestmentRow) => {
    if (row.isMarket) {
      router.push("/reconciliation/demat-portfolio");
    } else if (row.isPension) {
      router.push("/reconciliation/pension-accounts");
    } else {
      router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: row.account.id } });
    }
  };

  return (
    <ScreenContainer padTop={false}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {loaded && rows.length === 0 ? (
          <EmptyState
            icon="trending-up-outline"
            title="No investment accounts yet"
            subtitle="Add a demat, pension, or fixed deposit account to start tracking it here."
          />
        ) : (
          <>
            <Card className="mx-4 mt-4">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Total value
              </Text>
              <Text className="text-2xl font-bold text-foreground">{formatAmount(total)}</Text>
            </Card>

            <View className="mx-4 mt-4">
              {rows.map((row) => {
                const { account, product } = row;
                const name = account.account_label ?? `${account.bank_name} ••••${account.account_identifier}`;
                const instrument = product?.instrument;
                const instrumentLabel = instrument
                  ? (INSTRUMENT_LABELS[instrument] ?? instrument)
                  : row.isMarket
                    ? "Demat"
                    : row.isPension
                      ? "Pension"
                      : "Investment";
                const valuationLine = row.isMarket
                  ? "Market value"
                  : row.isPension
                    ? "Contributions"
                    : product?.status === "matured"
                      ? "Matured"
                      : product?.status === "closed"
                        ? "Closed"
                        : product?.maturity_date
                          ? `Matures ${formatDate(product.maturity_date)}`
                          : null;
                const icon = row.isMarket
                  ? "trending-up-outline"
                  : row.isPension
                    ? "briefcase-outline"
                    : "calendar-outline";
                return (
                  <Pressable key={account.id} onPress={() => handlePress(row)}>
                    <Card className="mb-2">
                      <View className="flex-row items-center">
                        <View
                          className="w-9 h-9 rounded-full items-center justify-center mr-3"
                          style={{ backgroundColor: theme.alpha("primary", 0.08) }}
                        >
                          <Ionicons name={icon} size={18} color={theme.primary} />
                        </View>
                        <View className="flex-1">
                          <Text className="text-sm font-semibold text-foreground">{name}</Text>
                          <Text className="text-xs text-muted-foreground mt-0.5">
                            {instrumentLabel}
                            {valuationLine ? ` · ${valuationLine}` : ""}
                          </Text>
                        </View>
                        <Text className="text-sm font-bold text-foreground">{formatAmount(row.value)}</Text>
                        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} style={{ marginLeft: 6 }} />
                      </View>
                    </Card>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
      <FAB icon="add" onPress={() => router.push("/investments/add")} accessibilityLabel="Add investment" />
    </ScreenContainer>
  );
}
