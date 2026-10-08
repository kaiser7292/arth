import { useCallback, useMemo, useState } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, EmptyState, FAB, FilterChip, ScreenContainer, Text } from "@/components/ui";
import { StackedAreaChart, type StackedLayer } from "@/components/charts/StackedAreaChart";
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
  withoutFinishedInvestments,
} from "@/services/investment-accounts";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { formatAmount } from "@/utils/format";
import { formatDate } from "@/utils/date";
import { useTheme } from "@/hooks/use-theme";
import { consumeInvestmentsPreload } from "@/services/home-preload";
import { getInvestmentTrend, type InvestmentTrend } from "@/services/investment-trend";

const preloaded = consumeInvestmentsPreload();

type InvestmentGroup = "fd" | "market" | "pension";

interface InvestmentRow {
  account: FinancialAccount;
  product: InvestmentProduct | null;
  value: number;
  group: InvestmentGroup;
}

function buildRows(
  accounts: FinancialAccount[],
  products: Map<string, InvestmentProduct>,
  values: Map<string, number>,
): InvestmentRow[] {
  return accounts.map((account) => {
    const product = products.get(account.id) ?? null;
    const group: InvestmentGroup = isDematLikeAccount(account, product)
      ? "market"
      : isPensionLikeAccount(account, product)
        ? "pension"
        : "fd";
    return { account, product, value: values.get(account.id) ?? 0, group };
  });
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
  const [rows, setRows] = useState<InvestmentRow[]>(() =>
    preloaded ? buildRows(preloaded.accounts, preloaded.products, preloaded.values) : [],
  );
  const [maturities, setMaturities] = useState<UpcomingFDMaturity[]>(preloaded?.maturities ?? []);
  const [loaded, setLoaded] = useState(preloaded != null);
  const [trend, setTrend] = useState<InvestmentTrend | null>(null);
  /** null = all categories stacked; a group = that category's accounts stacked. */
  const [focus, setFocus] = useState<InvestmentGroup | null>(null);

  const load = useCallback(async () => {
    const allAccounts = await getActiveAccounts(DEFAULT_USER_ID);
    const investmentLike = allAccounts.filter(
      (a) => a.account_type === "investment" || a.account_type === "demat" || a.account_type === "pension",
    );
    const ids = investmentLike.filter((a) => a.account_type === "investment").map((a) => a.id);
    const products = await batchInvestmentProducts(ids);
    // Matured / closed FDs aren't shown (their money is back in the bank).
    const accounts = withoutFinishedInvestments(investmentLike, products);
    const [values, upcoming] = await Promise.all([
      getUnifiedInvestmentValues(DEFAULT_USER_ID, accounts, products),
      getUpcomingFDMaturities(DEFAULT_USER_ID, 5),
    ]);

    setRows(buildRows(accounts, products, values));
    setMaturities(upcoming);
    setLoaded(true);
    // History is the slow part - the list shows first, the chart fills in.
    try {
      setTrend(await getInvestmentTrend(accounts, products, values));
    } catch {
      setTrend(null);
    }
  }, []);

  useDataRefresh(load);

  const total = rows.reduce((sum, r) => sum + r.value, 0);

  const groupTotals = useMemo(() => {
    const totals: Record<InvestmentGroup, number> = { fd: 0, market: 0, pension: 0 };
    for (const r of rows) totals[r.group] += r.value;
    return totals;
  }, [rows]);

  const totalUpcomingInterest = maturities.reduce((sum, m) => sum + m.interestAmount, 0);

  const activeGroups = GROUP_ORDER.filter((g) => groupTotals[g] > 0);
  // A category that's since emptied out (e.g. its only account closed) drops back to All.
  const view: InvestmentGroup | null = focus && groupTotals[focus] > 0 ? focus : null;
  const viewRows = useMemo(
    () => (view ? rows.filter((r) => r.group === view).sort((x, y) => y.value - x.value) : []),
    [rows, view],
  );
  const viewTotal = view ? groupTotals[view] : total;

  // Bands, bottom first. All: one per category. A category: one per account, shaded from the
  // category's colour (biggest account darkest) so it still reads as that category.
  const layers = useMemo<StackedLayer[]>(() => {
    if (!trend) return [];
    if (!view) {
      return GROUP_ORDER.filter((g) => trend.byGroup[g].some((d) => d.total > 0)).map((g) => ({
        key: g,
        label: GROUP_META[g].label,
        color: GROUP_META[g].color,
        values: trend.byGroup[g].map((d) => d.total),
      }));
    }
    return [...viewRows].reverse().map((r) => ({
      key: r.account.id,
      label: accountName(r.account),
      color: GROUP_META[view].color,
      opacity: shadeFor(viewRows.indexOf(r)),
      values: trend.byAccount[r.account.id] ?? trend.months.map(() => 0),
    }));
  }, [trend, view, viewRows]);

  const change = useMemo(() => {
    if (!trend || layers.length === 0) return null;
    const first = layers.reduce((s, l) => s + (l.values[0] ?? 0), 0);
    return viewTotal - first;
  }, [trend, layers, viewTotal]);

  const pct = (value: number, of: number) => (of > 0 ? Math.round((value / of) * 100) : 0);

  const handlePress = (row: InvestmentRow) => {
    if (row.group === "market") {
      router.push({ pathname: "/demat/snapshots/[id]", params: { id: row.account.id } });
    } else if (row.group === "pension") {
      router.push("/reconciliation/pension-accounts");
    } else {
      // FD — no separate ledger view; tap straight into its editable properties.
      router.push({ pathname: "/settings/account-detail", params: { accountId: row.account.id } });
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
            {/* Value over the last 12 months as stacked bands - the top edge is the total, each
                band's thickness its share. Tap a band, chip or legend row to see that category's
                accounts; tap an account to open it. */}
            <Card className="mx-4 mt-4">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                {view ? `${GROUP_META[view].label} value` : "Total value"}
              </Text>
              <Text className="text-2xl font-bold text-foreground">{formatAmount(viewTotal)}</Text>
              {change != null && Math.abs(change) >= 1 ? (
                <Text className="text-xs mt-0.5" style={{ color: change >= 0 ? theme.success : theme.danger }}>
                  {change >= 0 ? "+" : "−"}{formatAmount(Math.abs(change))} in 12 months
                </Text>
              ) : null}

              {activeGroups.length > 1 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3 -mx-1" contentContainerStyle={{ paddingHorizontal: 4 }}>
                  <FilterChip label="All" active={view == null} onPress={() => setFocus(null)} />
                  {activeGroups.map((g) => (
                    <FilterChip key={g} label={GROUP_META[g].label} active={view === g} onPress={() => setFocus(g)} />
                  ))}
                </ScrollView>
              )}

              <View className="mt-3">
                {trend ? (
                  <StackedAreaChart
                    key={view ?? "all"}
                    months={trend.months}
                    layers={layers}
                    onLayerPress={view ? undefined : (key) => setFocus(key as InvestmentGroup)}
                  />
                ) : (
                  <View className="items-center justify-center" style={{ height: 150 }}>
                    <Ionicons name="analytics-outline" size={28} color={colors.textSecondary} />
                    <Text className="text-xs text-muted-foreground mt-2">Loading history…</Text>
                  </View>
                )}
              </View>

              <View className="mt-2">
                {view == null
                  ? [...activeGroups].reverse().map((g) => (
                      <LegendRow
                        key={g}
                        color={GROUP_META[g].color}
                        label={GROUP_META[g].label}
                        amount={groupTotals[g]}
                        percent={pct(groupTotals[g], total)}
                        onPress={() => setFocus(g)}
                        hint={`Show ${GROUP_META[g].label} accounts`}
                      />
                    ))
                  : viewRows.map((r, i) => (
                      <LegendRow
                        key={r.account.id}
                        color={GROUP_META[view].color}
                        opacity={shadeFor(i)}
                        label={accountName(r.account)}
                        amount={r.value}
                        percent={pct(r.value, viewTotal)}
                        onPress={() => handlePress(r)}
                        hint={`Open ${accountName(r.account)}`}
                      />
                    ))}
              </View>
              {view == null && activeGroups.length > 1 && (
                <Text className="text-label text-faint-foreground mt-1">Tap a band or category to see its accounts</Text>
              )}
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
              if (view && group !== view) return null;
              const groupRows = rows.filter((r) => r.group === group);
              if (groupRows.length === 0) return null;
              const meta = GROUP_META[group];
              return (
                <View key={group}>
                  <View className="mx-4 mt-4 mb-2 flex-row items-center">
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
                    const name = accountName(account);
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
    </ScreenContainer>
  );
}

function accountName(account: FinancialAccount): string {
  return account.account_label ?? `${account.bank_name} ••••${account.account_identifier}`;
}

/** Band opacity for the i-th biggest account in a category: darkest first, never too faint. */
function shadeFor(i: number): number {
  return Math.max(1 - i * 0.22, 0.3);
}

function LegendRow({
  color,
  opacity = 1,
  label,
  amount,
  percent,
  onPress,
  hint,
}: {
  color: string;
  opacity?: number;
  label: string;
  amount: number;
  percent: number;
  onPress: () => void;
  hint: string;
}) {
  const { colors } = useColorScheme();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center py-2"
      style={{ minHeight: 44 }}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${percent} percent, ${formatAmount(amount)}`}
      accessibilityHint={hint}
    >
      <View className="w-2.5 h-2.5 rounded-sm mr-2.5" style={{ backgroundColor: color, opacity }} />
      <Text className="text-sm text-foreground flex-1" numberOfLines={1}>{label}</Text>
      <Text className="text-xs text-muted-foreground w-24 text-right">{formatAmount(amount)}</Text>
      <Text className="text-sm font-semibold text-foreground w-11 text-right">{percent}%</Text>
      <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} style={{ marginLeft: 4 }} />
    </Pressable>
  );
}
