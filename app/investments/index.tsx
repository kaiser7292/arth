import { useCallback, useState } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, EmptyState, FAB, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  listActiveInvestmentProducts,
  getContractCurrentValue,
  type InvestmentProduct,
} from "@/services/investment-accounts";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { formatAmount } from "@/utils/format";
import { formatDate } from "@/utils/date";
import { useTheme } from "@/hooks/use-theme";

const INSTRUMENT_LABEL: Record<string, string> = {
  fd: "Fixed deposit",
  bond: "Bond",
  equity: "Equity",
  mutual_fund: "Mutual fund",
  gold: "Gold",
  epf: "EPF",
  nps: "NPS",
  ppf: "PPF",
  other: "Investment",
};

/** v1: FD only. Equity/EPF/etc. still live under demat/pension until Phase 2's conversion lands. */
export default function InvestmentsListScreen() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [products, setProducts] = useState<InvestmentProduct[]>([]);
  const [accountsById, setAccountsById] = useState<Map<string, FinancialAccount>>(new Map());
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [productList, accounts] = await Promise.all([
      listActiveInvestmentProducts(DEFAULT_USER_ID),
      getActiveAccounts(DEFAULT_USER_ID),
    ]);
    setProducts(productList);
    setAccountsById(new Map(accounts.map((a) => [a.id, a])));
    setLoaded(true);
  }, []);

  useDataRefresh(load);

  const total = products.reduce((sum, p) => sum + getContractCurrentValue(p), 0);

  return (
    <ScreenContainer padTop={false}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {loaded && products.length === 0 ? (
          <EmptyState
            icon="trending-up-outline"
            title="No investment accounts yet"
            subtitle="Add a fixed deposit to start tracking it here."
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
              {products.map((p) => {
                const account = accountsById.get(p.financial_account_id);
                if (!account) return null;
                const value = getContractCurrentValue(p);
                const name = account.account_label ?? `${account.bank_name} ••••${account.account_identifier}`;
                const statusLine =
                  p.status === "matured"
                    ? "Matured"
                    : p.status === "closed"
                    ? "Closed"
                    : p.maturity_date
                    ? `Matures ${formatDate(p.maturity_date)}`
                    : null;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() =>
                      router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: account.id } })
                    }
                  >
                    <Card className="mb-2">
                      <View className="flex-row items-center">
                        <View
                          className="w-9 h-9 rounded-full items-center justify-center mr-3"
                          style={{ backgroundColor: theme.alpha("primary", 0.08) }}
                        >
                          <Ionicons name="calendar-outline" size={18} color={theme.primary} />
                        </View>
                        <View className="flex-1">
                          <Text className="text-sm font-semibold text-foreground">{name}</Text>
                          <Text className="text-xs text-muted-foreground mt-0.5">
                            {INSTRUMENT_LABEL[p.instrument] ?? p.instrument}
                            {statusLine ? ` · ${statusLine}` : ""}
                          </Text>
                        </View>
                        <Text className="text-sm font-bold text-foreground">{formatAmount(value)}</Text>
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
