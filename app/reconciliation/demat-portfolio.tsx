import { useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { acAlpha } from "@/utils/accent";
import { formatAmount } from "@/utils/format";
import { StatusColors } from "@/constants/theme";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getDematAccountsWithSummary,
  getAggregateSnapshotsForMonth,
  getSnapshotsForMonth,
  getDematSummary,
  getClosedAccounts,
} from "@/services/financial-account";
import type { DematAccountSummary, FinancialAccount } from "@/services/financial-account";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import type { TrendSeries } from "@/components/charts/TrendLineChart";

const ACCOUNT_COLORS = [
  "#6366F1", // indigo
  "#F59E0B", // amber
  "#EC4899", // pink
  "#14B8A6", // teal
  "#8B5CF6", // violet
  "#F97316", // orange
  "#06B6D4", // cyan
  "#EF4444", // red
];

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getYearMonth(offsetMonths: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - offsetMonths);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatYearMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${SHORT_MONTHS[m - 1]} ${y}`;
}

export default function DematPortfolioScreen() {
  const router = useRouter();
  const { accent, colors, colorScheme } = useColorScheme();
  const sc = StatusColors[colorScheme];

  const [accounts, setAccounts] = useState<DematAccountSummary[]>([]);
  const [trendSeries, setTrendSeries] = useState<TrendSeries[]>([]);
  const [summary, setSummary] = useState({ totalPortfolio: 0, totalFund: 0, accountCount: 0 });
  const [monthOffset, setMonthOffset] = useState(0);
  const [noData, setNoData] = useState(false);
  const [closedDemats, setClosedDemats] = useState<FinancialAccount[]>([]);
  const [closedExpanded, setClosedExpanded] = useState(false);

  const currentYM = getYearMonth(monthOffset);

  const loadTrend = useCallback(async (accts: DematAccountSummary[], ym: string) => {
    const aggregateTrend = await getAggregateSnapshotsForMonth(DEFAULT_USER_ID, ym);
    const seriesList: TrendSeries[] = [];

    if (aggregateTrend.length === 0) {
      setNoData(true);
      setTrendSeries([]);
      return;
    }
    setNoData(false);

    if (accts.length > 1) {
      seriesList.push({
        label: "Total",
        data: aggregateTrend,
        color: sc.success,
      });
    }

    const perAccountTrends = await Promise.all(
      accts.map((a) => getSnapshotsForMonth(a.account.id, ym)),
    );

    accts.forEach((a, i) => {
      const trend = perAccountTrends[i];
      if (trend.length > 0 && trend.some((d) => d.total > 0)) {
        seriesList.push({
          label: a.account.account_label || a.account.bank_name,
          data: trend,
          color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length],
        });
      }
    });

    if (seriesList.length === 0 && aggregateTrend.length > 0) {
      seriesList.push({
        label: "Total",
        data: aggregateTrend,
        color: sc.success,
      });
    }

    setTrendSeries(seriesList);
  }, [sc.success]);

  useDataRefresh(
    useCallback(async () => {
      const [accts, sum, closed] = await Promise.all([
        getDematAccountsWithSummary(DEFAULT_USER_ID),
        getDematSummary(DEFAULT_USER_ID),
        getClosedAccounts(DEFAULT_USER_ID, "demat"),
      ]);
      setAccounts(accts);
      setSummary(sum);
      setClosedDemats(closed);
      await loadTrend(accts, getYearMonth(monthOffset));
    }, [monthOffset, loadTrend]),
  );

  const handlePeriodBack = useCallback(async () => {
    const newOffset = monthOffset + 1;
    setMonthOffset(newOffset);
    await loadTrend(accounts, getYearMonth(newOffset));
  }, [monthOffset, accounts, loadTrend]);

  const handlePeriodForward = useCallback(async () => {
    if (monthOffset === 0) return;
    const newOffset = monthOffset - 1;
    setMonthOffset(newOffset);
    await loadTrend(accounts, getYearMonth(newOffset));
  }, [monthOffset, accounts, loadTrend]);

  const total = summary.totalPortfolio + summary.totalFund;
  const hasTrend = trendSeries.length > 0 && trendSeries.some((s) => s.data.some((d) => d.total > 0));
  const showChartSection = hasTrend || noData;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Aggregate header card */}
        <Card className="mx-4 mt-3 mb-2">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Portfolio Summary
            </Text>
            <Text className="text-xs text-muted-foreground">
              {summary.accountCount} account{summary.accountCount !== 1 ? "s" : ""}
            </Text>
          </View>

          <View className="flex-row justify-between mb-1">
            <Text className="text-xs text-muted-foreground">Portfolio Value</Text>
            <Text
              className="text-sm font-bold"
              style={{ color: summary.totalPortfolio > 0 ? sc.success : colors.text }}
            >
              {formatAmount(summary.totalPortfolio)}
            </Text>
          </View>

          {summary.totalFund !== 0 && (
            <View className="flex-row justify-between mb-1">
              <Text className="text-xs text-muted-foreground">Idle Cash / Fund</Text>
              <Text
                className="text-sm font-semibold"
                style={{ color: summary.totalFund < 0 ? sc.danger : colors.text }}
              >
                {formatAmount(summary.totalFund)}
              </Text>
            </View>
          )}

          {summary.totalFund !== 0 && (
            <View className="flex-row justify-between pt-2 mt-1 border-t border-border">
              <Text className="text-xs font-semibold text-muted-foreground">Total</Text>
              <Text
                className="text-sm font-bold"
                style={{ color: total < 0 ? sc.danger : colors.text }}
              >
                {formatAmount(total)}
              </Text>
            </View>
          )}
        </Card>

        {/* Trend chart with month navigation */}
        {showChartSection && (
          <Card className="mx-4 mb-2">
            <View className="flex-row items-center justify-between mb-2">
              <Pressable
                onPress={handlePeriodBack}
                className="w-8 h-8 rounded-full items-center justify-center"
                style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}
                accessibilityLabel="Previous month"
              >
                <Ionicons name="chevron-back" size={16} color={colors.textSecondary} />
              </Pressable>
              <Text className="text-xs font-semibold text-faint-foreground uppercase tracking-wider">
                {formatYearMonth(currentYM)}
              </Text>
              <Pressable
                onPress={handlePeriodForward}
                className="w-8 h-8 rounded-full items-center justify-center"
                style={{ backgroundColor: monthOffset === 0 ? undefined : acAlpha(accent, 500, 0.08) }}
                accessibilityLabel="Next month"
                disabled={monthOffset === 0}
              >
                <Ionicons name="chevron-forward" size={16} color={monthOffset === 0 ? colors.border : colors.textSecondary} />
              </Pressable>
            </View>
            {hasTrend ? (
              <TrendLineChart key={currentYM} series={trendSeries} showLegend />
            ) : (
              <View className="items-center py-6">
                <Ionicons name="analytics-outline" size={32} color={colors.textSecondary} />
                <Text className="text-xs text-muted-foreground mt-2">
                  No snapshots in {formatYearMonth(currentYM)}
                </Text>
              </View>
            )}
          </Card>
        )}

        {/* Per-account breakdown */}
        {accounts.length > 0 && (
          <View className="mx-4 mt-3 mb-2">
            <Text className="text-xs font-semibold text-faint-foreground uppercase tracking-wider">
              Accounts
            </Text>
          </View>
        )}

        {accounts.map(({ account, latestPortfolioValue, latestSnapshotDate, snapshotCount, latestFundValue }, idx) => {
          const accountTotal = (latestPortfolioValue ?? 0) + latestFundValue;
          const showTotal = latestFundValue !== 0 && latestPortfolioValue != null;
          return (
            <Card key={account.id} className="mx-4 mb-2">
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/demat/snapshots/[id]",
                    params: { id: account.id },
                  })
                }
              >
                {/* Row 1: Icon + Name + Total + Chevron */}
                <View className="flex-row items-center">
                  <View
                    className="w-9 h-9 rounded-full items-center justify-center mr-3"
                    style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}
                  >
                    <Ionicons name="trending-up-outline" size={18} color={ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length]} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">
                      {account.account_label || account.bank_name}
                    </Text>
                    {account.account_number && (
                      <Text className="text-xs text-muted-foreground mt-0.5">
                        {account.account_number}
                        {snapshotCount > 0 ? ` · ${snapshotCount} snapshot${snapshotCount !== 1 ? "s" : ""}` : ""}
                      </Text>
                    )}
                  </View>
                  <Text
                    className="text-sm font-bold mr-2"
                    style={{ color: (showTotal ? accountTotal : (latestPortfolioValue ?? 0)) > 0 ? sc.success : colors.text }}
                  >
                    {showTotal ? formatAmount(accountTotal) : (latestPortfolioValue != null ? formatAmount(latestPortfolioValue) : "No data")}
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
                </View>

                {/* Row 2: Portfolio + Fund breakdown (only when both exist) */}
                {showTotal && (
                  <View className="flex-row mt-2 ml-12 pt-2 border-t border-border">
                    <View className="flex-1">
                      <Text className="text-xs text-muted-foreground">Portfolio</Text>
                      <Text className="text-xs font-medium text-foreground mt-0.5">
                        {formatAmount(latestPortfolioValue)}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-xs text-muted-foreground">Fund</Text>
                      <Text className="text-xs font-medium text-foreground mt-0.5">
                        {formatAmount(latestFundValue)}
                      </Text>
                    </View>
                  </View>
                )}
              </Pressable>
            </Card>
          );
        })}

        {/* Empty state */}
        {accounts.length === 0 && closedDemats.length === 0 && (
          <View className="items-center py-16">
            <Ionicons name="trending-up-outline" size={48} color={colors.textSecondary} />
            <Text className="text-lg font-medium text-foreground mt-4">
              No demat accounts
            </Text>
            <Text className="text-sm text-muted-foreground mt-1 text-center px-8">
              Demat accounts will appear here once added from Account Master.
            </Text>
          </View>
        )}

        {/* Closed demat accounts */}
        {closedDemats.length > 0 && (
          <>
            <View className="border-t border-border mx-4 mt-2 mb-3" />
            <Pressable
              onPress={() => setClosedExpanded(e => !e)}
              className="flex-row items-center px-4 mb-2"
            >
              <Ionicons name="archive-outline" size={14} color={colors.textSecondary} style={{ marginRight: 6 }} />
              <Text className="text-xs text-muted-foreground flex-1">
                {closedDemats.length} closed {closedDemats.length === 1 ? "account" : "accounts"}
              </Text>
              <Ionicons name={closedExpanded ? "chevron-up-outline" : "chevron-down-outline"} size={14} color={colors.textSecondary} />
            </Pressable>
            {closedExpanded && closedDemats.map(acct => (
              <Card key={acct.id} className="mx-4 mb-2">
                <Pressable
                  onPress={() => router.push({ pathname: "/demat/snapshots/[id]", params: { id: acct.id } })}
                  className="flex-row items-center"
                >
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2 mb-0.5">
                      <Text className="text-sm text-muted-foreground">
                        {acct.account_label || acct.bank_name}
                      </Text>
                      <View className="bg-danger/10 px-1.5 py-0.5 rounded">
                        <Text className="text-label font-semibold text-danger">Closed</Text>
                      </View>
                    </View>
                    {acct.account_number && (
                      <Text className="text-xs text-faint-foreground">{acct.account_number}</Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward-outline" size={14} color={colors.textSecondary} />
                </Pressable>
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
