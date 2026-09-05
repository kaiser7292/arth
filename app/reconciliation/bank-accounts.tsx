import { useState, useCallback, useMemo } from "react";
import { View, ScrollView, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, PeriodNavigator, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";

import { formatAmount } from "@/utils/format";

import { DEFAULT_USER_ID } from "@/constants/app";
import { getActiveAccounts, getClosedAccounts, getAccountLatestStaleCheckDates } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import {
  getMonthBalanceSummary,
  computeUnseededBalance,
  getAdjustmentAbsTotalByAccountType,
} from "@/services/account-balance";
import { getTransfersOutTotal, getTransfersInTotal } from "@/services/account-transfer";
import { getCurrentMonth } from "@/services/budget";
import { consumeBankAccountsPreload } from "@/services/home-preload";

const preloaded = consumeBankAccountsPreload();
import { getMonthDateRange } from "@/utils/budget-helpers";
import { useTheme } from "@/hooks/use-theme";

interface AccountSummary {
  account: FinancialAccount;
  opening: number;
  expenses: number;
  credits: number;
  transfersOut: number;
  transfersIn: number;
  current: number;
  seeded: boolean;
  /** True if latest SMS-parsed realized expense or any credit post-dates last_balance_date. */
  autoDetectedStale: boolean;
}

export default function BankAccountsScreen() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [summaries, setSummaries] = useState<AccountSummary[]>(preloaded?.summaries ?? []);
  const [adjustmentStats, setAdjustmentStats] = useState<{ total: number; count: number }>(preloaded?.adjustmentStats ?? { total: 0, count: 0 });
  const [closedAccounts, setClosedAccounts] = useState<FinancialAccount[]>([]);
  const [closedExpanded, setClosedExpanded] = useState(false);
  const [month, setMonth] = useState(getCurrentMonth());
  const [refreshing, setRefreshing] = useState(false);

  const { startDate, endDate } = useMemo(() => getMonthDateRange(month), [month]);

  const loadData = useCallback(async () => {
      const [allAccounts, staleDates, adjStats, closed] = await Promise.all([
        getActiveAccounts(DEFAULT_USER_ID),
        getAccountLatestStaleCheckDates(DEFAULT_USER_ID, startDate, endDate),
        getAdjustmentAbsTotalByAccountType(DEFAULT_USER_ID, "savings", startDate, endDate),
        getClosedAccounts(DEFAULT_USER_ID, "savings"),
      ]);
      const bankAccounts = allAccounts.filter((a) => a.account_type === "savings");
      setAdjustmentStats(adjStats);
      setClosedAccounts(closed);

      const results: AccountSummary[] = await Promise.all(
        bankAccounts.map(async (account) => {
          const latestActivity = staleDates[account.id];
          const autoDetectedStale = !!(
            account.last_balance_date &&
            latestActivity &&
            latestActivity > account.last_balance_date
          );
          const [summary, tOut, tIn] = await Promise.all([
            getMonthBalanceSummary(account.id, month),
            getTransfersOutTotal(account.id, startDate, endDate),
            getTransfersInTotal(account.id, startDate, endDate),
          ]);
          if (summary) {
            return {
              account,
              opening: summary.opening_balance,
              expenses: summary.expenses,
              credits: summary.credits,
              transfersOut: tOut,
              transfersIn: tIn,
              current: summary.closing_balance,
              seeded: true,
              autoDetectedStale,
            };
          }
          const unseeded = await computeUnseededBalance(account.id, month);
          return {
            account,
            opening: unseeded.opening,
            expenses: unseeded.expenses,
            credits: unseeded.credits,
            transfersOut: tOut,
            transfersIn: tIn,
            current: unseeded.closing,
            seeded: false,
            autoDetectedStale,
          };
        }),
      );

      setSummaries(results);
  }, [month, startDate, endDate]);

  useDataRefresh(loadData);

  // Overall totals
  const totalBalance = summaries.reduce((sum, s) => sum + s.current, 0);
  const totalExpenses = summaries.reduce((sum, s) => sum + s.expenses, 0);
  const totalCredits = summaries.reduce((sum, s) => sum + s.credits, 0);
  const totalTransfersOut = summaries.reduce((sum, s) => sum + s.transfersOut, 0);
  const totalTransfersIn = summaries.reduce((sum, s) => sum + s.transfersIn, 0);

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
            <Text className="text-xs text-muted-foreground">Closing Balance</Text>
            <Text
              className="text-sm font-bold"
              style={{ color: totalBalance >= 0 ? theme.success : theme.danger }}
            >
              {formatAmount(totalBalance)}
            </Text>
          </View>
          <View className="flex-row justify-between mb-1">
            <Text className="text-xs text-muted-foreground">Expenses this month</Text>
            <Text className="text-sm font-semibold" style={{ color: totalExpenses > 0 ? theme.danger : colors.text }}>
              {formatAmount(totalExpenses)}
            </Text>
          </View>
          {totalCredits > 0 && (
            <View className="flex-row justify-between mb-1">
              <Text className="text-xs text-muted-foreground">Credits this month</Text>
              <Text className="text-sm font-semibold" style={{ color: theme.success }}>
                {formatAmount(totalCredits)}
              </Text>
            </View>
          )}
          {totalTransfersOut > 0 && (
            <View className="flex-row justify-between mb-1">
              <Text className="text-xs text-muted-foreground">Transfers Out</Text>
              <Text className="text-sm font-semibold" style={{ color: theme.danger }}>
                −{formatAmount(totalTransfersOut)}
              </Text>
            </View>
          )}
          {totalTransfersIn > 0 && (
            <View className="flex-row justify-between">
              <Text className="text-xs text-muted-foreground">Transfers In</Text>
              <Text className="text-sm font-semibold" style={{ color: theme.success }}>
                +{formatAmount(totalTransfersIn)}
              </Text>
            </View>
          )}

          {/* Drift indicator — manual ledger adjustments across all savings accounts this month.
              Proxy for how much course-correction was needed — higher = less trust in auto-detected balances. */}
          {adjustmentStats.count > 0 && (
            <View className="mt-2 pt-2 border-t border-border flex-row justify-between">
              <Text className="text-label text-faint-foreground">
                Manual ledger adjustments
              </Text>
              <Text className="text-label" style={{ color: theme.warning }}>
                {formatAmount(adjustmentStats.total)} · {adjustmentStats.count} entr{adjustmentStats.count === 1 ? "y" : "ies"}
              </Text>
            </View>
          )}
        </Card>

        {/* Per-account cards */}
        {summaries.map(({ account, opening, expenses, credits, transfersOut, transfersIn, current, seeded, autoDetectedStale }) => {
          const smsDelta = account.last_known_balance != null
            ? Math.abs(account.last_known_balance - current)
            : null;

          return (
            <Card key={account.id} className="mx-4 mb-2">
              {/* Tappable area: header + balance breakdown */}
              <Pressable
                onPress={() => router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: account.id, month } })}
              >
                {/* Account header */}
                <View className="flex-row items-center mb-3">
                  <View
                    className="w-9 h-9 rounded-full items-center justify-center mr-3"
                    style={{ backgroundColor: theme.alpha("primary", 0.08) }}
                  >
                    <Ionicons name="wallet-outline" size={18} color={theme.primary} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-bold text-foreground">
                      {account.bank_name} ••••{account.account_identifier}
                    </Text>
                    {account.account_label && (
                      <Text className="text-label text-muted-foreground">
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
                    style={{ backgroundColor: theme.warning + "14" }}
                  >
                    <Ionicons name="alert-circle" size={14} color={theme.warning} />
                    <Text className="text-label font-medium ml-2" style={{ color: theme.warning }}>
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
                {expenses > 0 && (
                  <View className="flex-row justify-between mb-1">
                    <Text className="text-xs text-muted-foreground">Expenses</Text>
                    <Text className="text-sm font-semibold" style={{ color: theme.danger }}>
                      −{formatAmount(expenses)}
                    </Text>
                  </View>
                )}
                {credits > 0 && (
                  <View className="flex-row justify-between mb-1">
                    <Text className="text-xs text-muted-foreground">Credits / Refunds</Text>
                    <Text className="text-sm font-semibold" style={{ color: theme.success }}>
                      +{formatAmount(credits)}
                    </Text>
                  </View>
                )}
                {transfersOut > 0 && (
                  <View className="flex-row justify-between mb-1">
                    <Text className="text-xs text-muted-foreground">Transfers Out</Text>
                    <Text className="text-sm font-semibold" style={{ color: theme.danger }}>
                      −{formatAmount(transfersOut)}
                    </Text>
                  </View>
                )}
                {transfersIn > 0 && (
                  <View className="flex-row justify-between mb-1">
                    <Text className="text-xs text-muted-foreground">Transfers In</Text>
                    <Text className="text-sm font-semibold" style={{ color: theme.success }}>
                      +{formatAmount(transfersIn)}
                    </Text>
                  </View>
                )}

                {/* Closing balance */}
                <View className="flex-row justify-between pt-2 mt-1 border-t border-border">
                  <Text className="text-xs font-semibold text-muted-foreground">
                    Closing Balance
                  </Text>
                  <Text
                    className="text-sm font-bold"
                    style={{ color: current >= 0 ? theme.success : theme.danger }}
                  >
                    {formatAmount(current)}
                  </Text>
                </View>

                {/* SMS auto-detected balance — compact inline note */}
                {account.last_known_balance != null && (
                  <View className="flex-row items-center justify-between mt-1.5">
                    <Text className="text-label text-faint-foreground">
                      {autoDetectedStale ? "SMS (stale)" : "SMS detected"}
                      {account.last_balance_date
                        ? " · " + new Date(account.last_balance_date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                        : ""}
                      {" · "}
                      <Text
                        style={autoDetectedStale ? { textDecorationLine: "line-through" } : undefined}
                      >
                        {formatAmount(account.last_known_balance)}
                      </Text>
                    </Text>
                    {smsDelta != null && smsDelta > 0 && (
                      <Text className="text-label font-medium" style={{ color: theme.warning }}>
                        Δ {formatAmount(smsDelta)}
                      </Text>
                    )}
                  </View>
                )}
              </Pressable>

            </Card>
          );
        })}

        {/* Empty state */}
        {summaries.length === 0 && closedAccounts.length === 0 && (
          <View className="items-center py-16">
            <Ionicons name="wallet-outline" size={48} color={colors.textSecondary} />
            <Text className="text-lg font-medium text-foreground mt-4">
              No bank accounts
            </Text>
            <Text className="text-sm text-muted-foreground mt-1 text-center px-8">
              Bank accounts will appear here once detected from SMS or added manually.
            </Text>
          </View>
        )}

        {/* Closed accounts */}
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
                        <Text className="text-label font-semibold text-danger">Closed</Text>
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
