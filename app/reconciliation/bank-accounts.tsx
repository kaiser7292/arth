import { useState, useCallback, useMemo } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card, PeriodNavigator } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { acAlpha } from "@/utils/accent";
import { formatAmount } from "@/utils/format";
import { StatusColors } from "@/constants/theme";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getActiveAccounts, getAccountLatestStaleCheckDates } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import {
  getMonthBalanceSummary,
  getAccountExpensesTotal,
  getAccountCreditsTotal,
  getAccountAdjustmentNet,
  getAdjustmentAbsTotalByAccountType,
} from "@/services/account-balance";
import { getCurrentMonth } from "@/services/budget";
import { consumeBankAccountsPreload } from "@/services/home-preload";

const preloaded = consumeBankAccountsPreload();
import { getMonthDateRange } from "@/utils/budget-helpers";

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

export default function BankAccountsScreen() {
  const router = useRouter();
  const { accent, colors, colorScheme } = useColorScheme();
  const sc = StatusColors[colorScheme];
  const [summaries, setSummaries] = useState<AccountSummary[]>(preloaded?.summaries ?? []);
  const [adjustmentStats, setAdjustmentStats] = useState<{ total: number; count: number }>(preloaded?.adjustmentStats ?? { total: 0, count: 0 });
  const [month, setMonth] = useState(getCurrentMonth());

  const { startDate, endDate } = useMemo(() => getMonthDateRange(month), [month]);

  // monthLabel and handleMonthShift replaced by PeriodNavigator

  useDataRefresh(
    useCallback(async () => {
      const [allAccounts, staleDates, adjStats] = await Promise.all([
        getActiveAccounts(DEFAULT_USER_ID),
        getAccountLatestStaleCheckDates(DEFAULT_USER_ID, startDate, endDate),
        getAdjustmentAbsTotalByAccountType(DEFAULT_USER_ID, "savings", startDate, endDate),
      ]);
      const bankAccounts = allAccounts.filter((a) => a.account_type === "savings");
      setAdjustmentStats(adjStats);

      // Parallelise per-account fetches — one Promise.all across the group.
      const results: AccountSummary[] = await Promise.all(
        bankAccounts.map(async (account) => {
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
          // Not seeded — treat opening as 0; unseeded accounts still reflect
          // manual course-corrections via signed adjustments.
          const [expenses, credits, adjNet] = await Promise.all([
            getAccountExpensesTotal(account.id, startDate, endDate),
            getAccountCreditsTotal(account.id, startDate, endDate),
            getAccountAdjustmentNet(account.id, startDate, endDate),
          ]);
          return {
            account,
            opening: 0,
            expenses,
            credits,
            current: 0 - expenses + credits + adjNet,
            seeded: false,
            autoDetectedStale,
          };
        }),
      );

      setSummaries(results);
    }, [month, startDate, endDate]),
  );

  // Overall totals
  const totalBalance = summaries.reduce((sum, s) => sum + s.current, 0);
  const totalExpenses = summaries.reduce((sum, s) => sum + s.expenses, 0);
  const totalCredits = summaries.reduce((sum, s) => sum + s.credits, 0);

  return (
    <ScreenContainer padTop={false}>
      {/* Month navigator */}
      <PeriodNavigator mode="month" value={month} onChange={setMonth} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Overall summary card */}
        <Card className="mx-4 mt-3 mb-2">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary uppercase tracking-wider">
              Overall Summary
            </Text>
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
              {summaries.length} account{summaries.length !== 1 ? "s" : ""}
            </Text>
          </View>

          <View className="flex-row justify-between mb-1">
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Current Balance</Text>
            <Text
              className="text-sm font-bold"
              style={{ color: totalBalance >= 0 ? sc.success : sc.danger }}
            >
              {formatAmount(totalBalance)}
            </Text>
          </View>
          <View className="flex-row justify-between mb-1">
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Expenses this month</Text>
            <Text className="text-sm font-semibold" style={{ color: totalExpenses > 0 ? sc.danger : colors.text }}>
              {formatAmount(totalExpenses)}
            </Text>
          </View>
          {totalCredits > 0 && (
            <View className="flex-row justify-between">
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Credits this month</Text>
              <Text className="text-sm font-semibold" style={{ color: sc.success }}>
                {formatAmount(totalCredits)}
              </Text>
            </View>
          )}

          {/* Drift indicator — manual ledger adjustments across all savings accounts this month.
              Proxy for how much course-correction was needed — higher = less trust in auto-detected balances. */}
          {adjustmentStats.count > 0 && (
            <View className="mt-2 pt-2 border-t border-border-light dark:border-border-dark flex-row justify-between">
              <Text className="text-[11px] text-text-tertiary dark:text-text-dark-secondary">
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
              onPress={() => router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: account.id } })}
            >
              {/* Account header */}
              <View className="flex-row items-center mb-3">
                <View
                  className="w-9 h-9 rounded-full items-center justify-center mr-3"
                  style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}
                >
                  <Ionicons name="wallet-outline" size={18} color={accent[500]} />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
                    {account.bank_name} ••••{account.account_identifier}
                  </Text>
                  {account.account_label && (
                    <Text className="text-[10px] text-text-secondary dark:text-text-dark-secondary">
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
                    No opening balance set — showing from ₹0
                  </Text>
                </View>
              )}

              {/* Balance breakdown */}
              <View className="flex-row justify-between mb-1">
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Opening Balance</Text>
                <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                  {formatAmount(opening)}
                </Text>
              </View>
              {expenses > 0 && (
                <View className="flex-row justify-between mb-1">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Expenses</Text>
                  <Text className="text-sm font-semibold" style={{ color: sc.danger }}>
                    −{formatAmount(expenses)}
                  </Text>
                </View>
              )}
              {credits > 0 && (
                <View className="flex-row justify-between mb-1">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Credits / Refunds</Text>
                  <Text className="text-sm font-semibold" style={{ color: sc.success }}>
                    +{formatAmount(credits)}
                  </Text>
                </View>
              )}
              {/* Auto-detected (SMS) balance — crossed out when stale */}
              {account.last_known_balance != null && (
                <View className="flex-row justify-between mb-1">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                    Auto-detected{autoDetectedStale ? " · stale" : ""}
                  </Text>
                  <Text
                    className="text-sm font-semibold text-text-primary dark:text-text-dark-primary"
                    style={autoDetectedStale ? { textDecorationLine: "line-through", color: sc.muted } : undefined}
                  >
                    {formatAmount(account.last_known_balance)}
                  </Text>
                </View>
              )}
              <View className="flex-row justify-between pt-2 mt-1 border-t border-border-light dark:border-border-dark">
                <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary">
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
                <Text className="text-[10px] text-text-tertiary mt-1.5">
                  SMS balance updated {new Date(account.last_balance_date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </Text>
              )}
            </Pressable>
          </Card>
        ))}

        {/* Empty state */}
        {summaries.length === 0 && (
          <View className="items-center py-16">
            <Ionicons name="wallet-outline" size={48} color={colors.textSecondary} />
            <Text className="text-lg font-medium text-text-primary dark:text-text-dark-primary mt-4">
              No bank accounts
            </Text>
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-1 text-center px-8">
              Bank accounts will appear here once detected from SMS or added manually.
            </Text>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
