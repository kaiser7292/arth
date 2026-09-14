import { useCallback, useMemo, useRef, useState } from "react";
import { View, ScrollView, Pressable, type LayoutChangeEvent } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, EmptyState, FAB, ScreenContainer, Sheet, Text } from "@/components/ui";
import { DonutChart } from "@/components/charts/DonutChart";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { DEFAULT_USER_ID } from "@/constants/app";
import { DATA_HEX } from "@/constants/brand";
import {
  batchInvestmentProducts,
  getUnifiedInvestmentValues,
  getUpcomingFDMaturities,
  isDematLikeAccount,
  isFDIncomplete,
  isPensionLikeAccount,
  INSTRUMENT_LABELS,
  type InvestmentProduct,
  type UpcomingFDMaturity,
} from "@/services/investment-accounts";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { formatAmount, formatCompact } from "@/utils/format";
import { formatDate } from "@/utils/date";
import { useTheme } from "@/hooks/use-theme";

type InvestmentGroup = "fd" | "market" | "pension";

interface InvestmentRow {
  account: FinancialAccount;
  product: InvestmentProduct | null;
  value: number;
  group: InvestmentGroup;
}

const GROUP_META: Record<InvestmentGroup, { label: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  fd: { label: "Fixed Deposits", icon: "cash-outline", color: DATA_HEX.series[1] },
  market: { label: "Market (Demat)", icon: "trending-up-outline", color: DATA_HEX.series[2] },
  pension: { label: "Pension", icon: "briefcase-outline", color: DATA_HEX.series[0] },
};
const GROUP_ORDER: InvestmentGroup[] = ["fd", "market", "pension"];

export default function InvestmentsListScreen() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [rows, setRows] = useState<InvestmentRow[]>([]);
  const [maturities, setMaturities] = useState<UpcomingFDMaturity[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [breakdownVisible, setBreakdownVisible] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Partial<Record<InvestmentGroup, number>>>({});

  const load = useCallback(async () => {
    const allAccounts = await getActiveAccounts(DEFAULT_USER_ID);
    const accounts = allAccounts.filter(
      (a) => a.account_type === "investment" || a.account_type === "demat" || a.account_type === "pension",
    );
    const ids = accounts.filter((a) => a.account_type === "investment").map((a) => a.id);
    const products = await batchInvestmentProducts(ids);
    const [values, upcoming] = await Promise.all([
      getUnifiedInvestmentValues(DEFAULT_USER_ID, accounts, products),
      getUpcomingFDMaturities(DEFAULT_USER_ID, 5),
    ]);

    setRows(
      accounts.map((account) => {
        const product = products.get(account.id) ?? null;
        const group: InvestmentGroup = isDematLikeAccount(account, product)
          ? "market"
          : isPensionLikeAccount(account, product)
            ? "pension"
            : "fd";
        return { account, product, value: values.get(account.id) ?? 0, group };
      }),
    );
    setMaturities(upcoming);
    setLoaded(true);
  }, []);

  useDataRefresh(load);

  const total = rows.reduce((sum, r) => sum + r.value, 0);

  const groupTotals = useMemo(() => {
    const totals: Record<InvestmentGroup, number> = { fd: 0, market: 0, pension: 0 };
    for (const r of rows) totals[r.group] += r.value;
    return totals;
  }, [rows]);

  const totalUpcomingInterest = maturities.reduce((sum, m) => sum + m.interestAmount, 0);

  const donutSegments = GROUP_ORDER.map((g) => ({
    label: GROUP_META[g].label,
    value: groupTotals[g],
    color: GROUP_META[g].color,
  }));

  const scrollToGroup = useCallback((index: number) => {
    const group = GROUP_ORDER[index];
    const y = sectionY.current[group];
    if (y != null) scrollRef.current?.scrollTo({ y: y - 8, animated: true });
  }, []);

  const handlePress = (row: InvestmentRow) => {
    if (row.group === "market") {
      router.push("/reconciliation/demat-portfolio");
    } else if (row.group === "pension") {
      router.push("/reconciliation/pension-accounts");
    } else {
      // FD — no separate ledger view; tap straight into its editable properties.
      router.push({ pathname: "/settings/account-detail", params: { accountId: row.account.id } });
    }
  };

  return (
    <ScreenContainer padTop={false}>
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {loaded && rows.length === 0 ? (
          <EmptyState
            icon="trending-up-outline"
            title="No investment accounts yet"
            subtitle="Add a demat, pension, or fixed deposit account to start tracking it here."
          />
        ) : (
          <>
            {/* Allocation across the three investment forms — tap a slice to
                jump to that section below. */}
            <Card className="mx-4 mt-4 items-center">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground self-start mb-1">
                Total value
              </Text>
              <Text className="text-2xl font-bold text-foreground self-start mb-3">{formatAmount(total)}</Text>
              <DonutChart
                segments={donutSegments}
                centerValue={formatCompact(total)}
                centerLabel="Total"
                onSegmentPress={(index) => scrollToGroup(index)}
                onPress={() => setBreakdownVisible(true)}
              />
              <Text className="text-label text-faint-foreground mt-2">
                Tap the chart for exact amounts
              </Text>
            </Card>

            {/* Upcoming maturities — the one thing that had no visibility
                anywhere before: an FD's date was buried in its own detail screen. */}
            {maturities.length > 0 && (
              <Card className="mx-4 mt-3">
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Upcoming maturities
                  </Text>
                  <Text className="text-xs font-semibold" style={{ color: theme.success }}>
                    +{formatAmount(totalUpcomingInterest)} interest
                  </Text>
                </View>
                {maturities.map((m, i) => (
                  <Pressable
                    key={m.financialAccountId}
                    onPress={() => router.push({ pathname: "/settings/account-detail", params: { accountId: m.financialAccountId } })}
                    className="flex-row items-center py-2"
                    style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
                  >
                    <View
                      className="w-8 h-8 rounded-full items-center justify-center mr-3"
                      style={{ backgroundColor: GROUP_META.fd.color + "22" }}
                    >
                      <Ionicons name={GROUP_META.fd.icon} size={15} color={GROUP_META.fd.color} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-foreground" numberOfLines={1}>{m.label}</Text>
                      <Text className="text-xs text-muted-foreground mt-0.5">Matures {formatDate(m.maturityDate)}</Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-sm font-semibold text-foreground">{formatAmount(m.maturityAmount)}</Text>
                      <Text className="text-label" style={{ color: theme.success }}>+{formatAmount(m.interestAmount)}</Text>
                    </View>
                  </Pressable>
                ))}
              </Card>
            )}

            {/* Accounts, grouped by the three investment forms. */}
            {GROUP_ORDER.map((group) => {
              const groupRows = rows.filter((r) => r.group === group);
              if (groupRows.length === 0) return null;
              const meta = GROUP_META[group];
              return (
                <View key={group}>
                  <View
                    className="mx-4 mt-4 mb-2 flex-row items-center"
                    onLayout={(e: LayoutChangeEvent) => { sectionY.current[group] = e.nativeEvent.layout.y; }}
                  >
                    <View className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: meta.color }} />
                    <Text className="text-xs font-semibold uppercase tracking-wider text-faint-foreground flex-1">
                      {meta.label} · {groupRows.length}
                    </Text>
                    <Text className="text-xs font-semibold text-muted-foreground">
                      {formatAmount(groupTotals[group])}
                    </Text>
                  </View>

                  {groupRows.map((row) => {
                    const { account, product } = row;
                    const name = account.account_label ?? `${account.bank_name} ••••${account.account_identifier}`;
                    const instrument = product?.instrument;
                    const instrumentLabel = instrument
                      ? (INSTRUMENT_LABELS[instrument] ?? instrument)
                      : group === "market"
                        ? "Demat"
                        : group === "pension"
                          ? "Pension"
                          : "Deposit";
                    const valuationLine = group === "market"
                      ? "Market value"
                      : group === "pension"
                        ? "Contributions"
                        : product && isFDIncomplete(product)
                          ? "Rate & maturity not set"
                          : product?.status === "matured"
                            ? "Matured"
                            : product?.status === "closed"
                              ? "Closed"
                              : product?.maturity_date
                                ? `Matures ${formatDate(product.maturity_date)}`
                                : null;
                    return (
                      <Pressable key={account.id} onPress={() => handlePress(row)} className="mx-4">
                        <Card className="mb-2">
                          <View className="flex-row items-center">
                            <View
                              className="w-9 h-9 rounded-full items-center justify-center mr-3"
                              style={{ backgroundColor: meta.color + "22" }}
                            >
                              <Ionicons name={meta.icon} size={18} color={meta.color} />
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
              );
            })}
          </>
        )}
      </ScrollView>
      <FAB icon="add" onPress={() => router.push("/investments/add")} accessibilityLabel="Add investment" />

      <Sheet visible={breakdownVisible} onClose={() => setBreakdownVisible(false)}>
        <View className="px-5 pb-3">
          <Text className="text-base font-bold" style={{ color: colors.text }}>
            Value by category
          </Text>
        </View>
        <View className="px-5 pb-2">
          {GROUP_ORDER.map((group) => (
            <View key={group} className="flex-row items-center py-2.5" style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
              <View className="w-2.5 h-2.5 rounded-full mr-3" style={{ backgroundColor: GROUP_META[group].color }} />
              <Text className="text-sm text-foreground flex-1">{GROUP_META[group].label}</Text>
              <Text className="text-sm font-semibold text-foreground">{formatAmount(groupTotals[group])}</Text>
            </View>
          ))}
          <View className="flex-row items-center py-2.5" style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text className="text-sm font-bold text-foreground flex-1 ml-[22px]">Total</Text>
            <Text className="text-sm font-bold text-foreground">{formatAmount(total)}</Text>
          </View>
        </View>
        <View className="px-5 pt-2 pb-1">
          <Pressable
            onPress={() => setBreakdownVisible(false)}
            className="py-3 rounded-xl items-center"
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
          >
            <Text className="text-sm font-semibold" style={{ color: colors.textSecondary }}>Close</Text>
          </Pressable>
        </View>
      </Sheet>
    </ScreenContainer>
  );
}
