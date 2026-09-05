import { Card, PeriodNavigator, ScreenContainer } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { StatusColors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import {
  getAccountCreditsTotal,
  getAdjustmentAbsTotalByAccountType,
  computeUnseededBalance,
  getMonthBalanceSummary,
} from "@/services/account-balance";
import { getCurrentMonth } from "@/services/budget";
import type { FinancialAccount } from "@/services/financial-account";
import { getAccountLatestStaleCheckDates, getActiveAccounts, getClosedAccounts } from "@/services/financial-account";
import { consumePensionAccountsPreload } from "@/services/home-preload";
import { getFYStartMonth } from "@/services/settings";
import { acAlpha } from "@/utils/accent";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { getCurrentFY, getFYRange } from "@/utils/fiscal-year";
import { formatAmount } from "@/utils/format";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

const preloaded = consumePensionAccountsPreload();

interface AccountSummary {
  account: FinancialAccount;
  opening: number;
  expenses: number;
  credits: number;
  current: number;
  seeded: boolean;
  /** True if latest SMS-parsed realized expense or any credit post-dates last_balance_date. */
  autoDetectedStale: boolean;
}

export default function PensionAccountsScreen() {
  const router = useRouter();
  const { accent, colors, colorScheme } = useColorScheme();
  const sc = StatusColors[colorScheme];
  const [summaries, setSummaries] = useState<AccountSummary[]>(preloaded?.summaries ?? []);
  const [adjustmentStats, setAdjustmentStats] = useState<{ total: number; count: number }>(preloaded?.adjustmentStats ?? { total: 0, count: 0 });
  const [closedAccounts, setClosedAccounts] = useState<FinancialAccount[]>([]);
  const [closedExpanded, setClosedExpanded] = useState(false);
  const [month, setMonth] = useState(getCurrentMonth());
  const [ytdCredits, setYtdCredits] = useState(0);
  const [ytdPerAccount, setYtdPerAccount] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);

  const { startDate, endDate } = useMemo(() => getMonthDateRange(month), [month]);

  const loadData = useCallback(async () => {
      const [allAccounts, staleDates, adjStats, closed] = await Promise.all([
        getActiveAccounts(DEFAULT_USER_ID),
        getAccountLatestStaleCheckDates(DEFAULT_USER_ID, startDate, endDate),
        getAdjustmentAbsTotalByAccountType(DEFAULT_USER_ID, "pension", startDate, endDate),
        getClosedAccounts(DEFAULT_USER_ID, "pension"),
      ]);
      const pensionAccounts = allAccounts.filter((a) => a.account_type === "pension");
      setAdjustmentStats(adjStats);
      setClosedAccounts(closed);


      // Parallelise per-account fetches — one Promise.all across the group.
      const results: AccountSummary[] = await Promise.all(
        pensionAccounts.map(async (account) => {
          const summary = await getMonthBalanceSummary(account.id, month);
          const latestActivity = staleDates[account.id];
          const autoDetectedStale = !!(
            account.last_balance_date &&
            latestActivity &&
            latestActivity > account.last_balance_date
          );
          if (summary) {
            return {
              account,
              opening: summary.opening_balance,
              expenses: summary.expenses,
              credits: summary.credits,
              current: summary.closing_balance,
              seeded: true,
              autoDetectedStale,
            };
          }
          // Not seeded — use computeUnseededBalance which chains forward
          // from the earliest activity month (same as account-ledger does).
          const unseeded = await computeUnseededBalance(account.id, month);
          return {
            account,
            opening: unseeded.opening,
            expenses: unseeded.expenses,
            credits: unseeded.credits,
            current: unseeded.closing,
            seeded: false,
            autoDetectedStale,
          };
        }),
      );

      setSummaries(results);

      // YTD contributions: FY start → end of viewed month
      const fyStartMonth = getFYStartMonth();
      const fy = getCurrentFY(fyStartMonth, new Date(`${month}-01`));
      const fyRange = getFYRange(fy, fyStartMonth);
      const fyStart = `${fyRange.start.getFullYear()}-${String(fyRange.start.getMonth() + 1).padStart(2, "0")}-01`;
      let ytdTotal = 0;
      const ytdMap: Record<string, number> = {};
      for (const { account } of results) {
        const acctYtd = await getAccountCreditsTotal(account.id, fyStart, endDate);
        ytdMap[account.id] = acctYtd;
        ytdTotal += acctYtd;
      }
      setYtdCredits(ytdTotal);
      setYtdPerAccount(ytdMap);
  }, [month, startDate, endDate]);

  useDataRefresh(loadData);

  // Overall totals
  const totalBalance = summaries.reduce((sum, s) => sum + s.current, 0);
  const totalOpening = summaries.reduce((sum, s) => sum + s.opening, 0);
  const totalCredits = summaries.reduce((sum, s) => sum + s.credits, 0);
  const lastContributionDate = summaries.reduce((latest, s) => {
    if (!s.account.last_balance_date) return latest;
    if (!latest) return s.account.last_balance_date;
    return s.account.last_balance_date > latest ? s.account.last_balance_date : latest;
  }, null as string | null);

  return (
    <ScreenContainer padTop={false}>
      {/* Month navigator */}
      <PeriodNavigator mode="month" value={month} onChange={setMonth} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadData(); setRefreshing(false); }} />
        }
      >
        {/* Overall summary card */}
        <Card className="mx-4 mt-3 mb-2">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Overall Summary
            </Text>
            <Text className="text-xs text-muted-foreground">
              {summaries.length} account{summaries.length !== 1 ? "s" : ""}
            </Text>
          </View>

          <View className="flex-row justify-between mb-1">
            <Text className="text-xs text-muted-foreground">Opening Balance</Text>
            <Text className="text-sm font-semibold text-foreground">
              {formatAmount(totalOpening)}
            </Text>
          </View>
          <View className="flex-row justify-between mb-1">
            <Text className="text-xs text-muted-foreground">Closing Balance</Text>
            <Text
              className="text-sm font-bold"
              style={{ color: totalBalance >= 0 ? sc.success : sc.danger }}
            >
              {formatAmount(totalBalance)}
            </Text>
          </View>
          {lastContributionDate && (
            <View className="flex-row justify-between mb-1">
              <Text className="text-xs text-muted-foreground">Last contribution</Text>
              <Text className="text-sm font-semibold text-foreground">
                {new Date(lastContributionDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </Text>
            </View>
          )}
          <View className="flex-row justify-between">
            <Text className="text-xs text-muted-foreground">YTD Contributions</Text>
            <Text className="text-sm font-semibold" style={{ color: ytdCredits > 0 ? sc.success : colors.text }}>
              {formatAmount(ytdCredits)}
            </Text>
          </View>

          {/* Drift indicator — manual ledger adjustments across all pension accounts this month.
              Proxy for how much course-correction was needed — higher = less trust in auto-detected balances. */}
          {adjustmentStats.count > 0 && (
            <View className="mt-2 pt-2 border-t border-border flex-row justify-between">
              <Text className="text-[11px] text-faint-foreground">
                Manual ledger adjustments
              </Text>
              <Text className="text-[11px]" style={{ color: sc.warning }}>
                {formatAmount(adjustmentStats.total)} · {adjustmentStats.count} entr{adjustmentStats.count === 1 ? "y" : "ies"}
              </Text>
            </View>
          )}
        </Card>

        {/* Per-account cards */}
        {summaries.map(({ account, opening, expenses, credits, current, seeded, autoDetectedStale }) => (
          <Card key={account.id} className="mx-4 mb-2">
            <Pressable
              onPress={() => router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: account.id, month } })}
            >
              {/* Account header */}
              <View className="flex-row items-center mb-3">
                <View
                  className="w-9 h-9 rounded-full items-center justify-center mr-3"
                  style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}
                >
                  <Ionicons name="briefcase-outline" size={18} color={accent[500]} />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-bold text-foreground">
                    {account.bank_name} ••••{account.account_identifier}
                  </Text>
                  {account.account_label && (
                    <Text className="text-[10px] text-muted-foreground">
                      {account.account_label}
                    </Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
              </View>

              {/* Not seeded warning */}
              {!seeded && (
                <View
                  className="flex-row items-center px-3 py-2 rounded-lg mb-3"
                  style={{ backgroundColor: sc.warning + "14" }}
                >
                  <Ionicons name="alert-circle" size={14} color={sc.warning} />
                  <Text className="text-[10px] font-medium ml-2" style={{ color: sc.warning }}>
                    No opening balance set - showing from ₹0
                  </Text>
                </View>
              )}

              {/* Balance breakdown */}
              <View className="flex-row justify-between mb-1">
                <Text className="text-xs text-muted-foreground">Opening Balance</Text>
                <Text className="text-sm font-semibold text-foreground">
                  {formatAmount(opening)}
                </Text>
              </View>
              {credits > 0 && (
                <View className="flex-row justify-between mb-1">
                  <Text className="text-xs text-muted-foreground">Contributions (month)</Text>
                  <Text className="text-sm font-semibold" style={{ color: sc.success }}>
                    +{formatAmount(credits)}
                  </Text>
                </View>
              )}
              {account.last_balance_date && (
                <View className="flex-row justify-between mb-1">
                  <Text className="text-xs text-muted-foreground">Last contribution</Text>
                  <Text className="text-sm font-semibold text-foreground">
                    {new Date(account.last_balance_date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </Text>
                </View>
              )}
              <View className="flex-row justify-between mb-1">
                <Text className="text-xs text-muted-foreground">YTD Contributions</Text>
                <Text className="text-sm font-semibold" style={{ color: (ytdPerAccount[account.id] ?? 0) > 0 ? sc.success : colors.text }}>
                  {formatAmount(ytdPerAccount[account.id] ?? 0)}
                </Text>
              </View>
              {/* Auto-detected (SMS) balance — crossed out when stale */}
              {account.last_known_balance != null && (
                <View className="flex-row justify-between mb-1">
                  <Text className="text-xs text-muted-foreground">
                    Auto-detected{autoDetectedStale ? " · stale" : ""}
                  </Text>
                  <Text
                    className="text-sm font-semibold text-foreground"
                    style={autoDetectedStale ? { textDecorationLine: "line-through", color: sc.muted } : undefined}
                  >
                    {formatAmount(account.last_known_balance)}
                  </Text>
                </View>
              )}
              <View className="flex-row justify-between pt-2 mt-1 border-t border-border">
                <Text className="text-xs font-semibold text-muted-foreground">
                  Current Balance{account.last_known_balance != null ? " · calculated" : ""}
                </Text>
                <Text
                  className="text-sm font-bold"
                  style={{ color: current >= 0 ? sc.success : sc.danger }}
                >
                  {formatAmount(current)}
                </Text>
              </View>

              {/* Last updated */}
              {account.last_balance_date && (
                <Text className="text-[10px] text-faint-foreground mt-1.5">
                  SMS balance updated {new Date(account.last_balance_date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </Text>
              )}
            </Pressable>
          </Card>
        ))}

        {/* Empty state */}
        {summaries.length === 0 && closedAccounts.length === 0 && (
          <View className="items-center py-16">
            <Ionicons name="briefcase-outline" size={48} color={colors.textSecondary} />
            <Text className="text-lg font-medium text-foreground mt-4">
              No pension accounts
            </Text>
            <Text className="text-sm text-muted-foreground mt-1 text-center px-8">
              Pension accounts will appear here once detected from SMS or added manually.
            </Text>
          </View>
        )}

        {/* Closed pension accounts */}
        {closedAccounts.length > 0 && (
          <>
            <View className="border-t border-border mx-4 mt-2 mb-3" />
            <Pressable
              onPress={() => setClosedExpanded(e => !e)}
              className="flex-row items-center px-4 mb-2"
            >
              <Ionicons name="archive-outline" size={14} color={colors.textSecondary} style={{ marginRight: 6 }} />
              <Text className="text-xs text-muted-foreground flex-1">
                {closedAccounts.length} closed {closedAccounts.length === 1 ? "account" : "accounts"}
              </Text>
              <Ionicons name={closedExpanded ? "chevron-up-outline" : "chevron-down-outline"} size={14} color={colors.textSecondary} />
            </Pressable>
            {closedExpanded && closedAccounts.map(acct => (
              <Card key={acct.id} className="mx-4 mb-2">
                <Pressable
                  onPress={() => router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: acct.id } })}
                  className="flex-row items-center"
                >
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2 mb-0.5">
                      <Text className="text-sm text-muted-foreground">
                        {acct.account_label || `${acct.bank_name} ****${acct.account_identifier}`}
                      </Text>
                      <View className="bg-danger/10 px-1.5 py-0.5 rounded">
                        <Text className="text-[10px] font-semibold text-danger">Closed</Text>
                      </View>
                    </View>
                    <Text className="text-xs text-faint-foreground">{acct.bank_name}</Text>
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
