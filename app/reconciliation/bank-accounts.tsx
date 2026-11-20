import { useState, useCallback, useMemo } from "react";
import { View, ScrollView, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { PeriodNavigator, ScreenContainer, Text } from "@/components/ui";
import {
  AccountCard,
  AccountHead,
  CardNote,
  CardsLabel,
  ChangeChip,
  ClosedAccountRow,
  ClosedToggle,
  FlowBar,
  FlowTiles,
  FootRows,
  SummaryCard,
  smsNote,
} from "@/components/account/AccountCards";
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
import { useGuardedLoad } from "@/hooks/use-guarded-load";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";
import { OpeningBalanceBanner } from "@/components/account/OpeningBalanceBanner";

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

  const guarded = useGuardedLoad(loadData);
  useDataRefresh(guarded.load);

  // Overall totals
  const totalOpening = summaries.reduce((sum, s) => sum + s.opening, 0);
  const totalBalance = summaries.reduce((sum, s) => sum + s.current, 0);
  const totalExpenses = summaries.reduce((sum, s) => sum + s.expenses, 0);
  const totalCredits = summaries.reduce((sum, s) => sum + s.credits, 0);
  const totalTransfersOut = summaries.reduce((sum, s) => sum + s.transfersOut, 0);
  const totalTransfersIn = summaries.reduce((sum, s) => sum + s.transfersIn, 0);

  return (
    <ScreenContainer padTop={false}>
      {guarded.failed && <LoadFailedBanner onRetry={guarded.load} />}
      {/* Month navigator */}
      <PeriodNavigator mode="month" value={month} onChange={setMonth} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadData(); setRefreshing(false); }} />
        }
      >
        {/* Summary: the total first, then what moved it (owner, Nov 2026, "Arth account cards"). */}
        {summaries.length > 0 && (() => {
          const inflow = totalCredits + totalTransfersIn;
          const outflow = totalExpenses + totalTransfersOut;
          const isNow = month === getCurrentMonth();
          const parts = (a: number, an: string, b: number, bn: string) =>
            [a > 0 ? `${an} ${formatAmount(a)}` : null, b > 0 ? `${bn} ${formatAmount(b)}` : null].filter(Boolean).join(" · ") || "Nothing this month";
          return (
            <SummaryCard
              label={`All savings · ${summaries.length} ${summaries.length === 1 ? "account" : "accounts"}`}
              amount={totalBalance}
              amountColor={totalBalance < 0 ? theme.danger : undefined}
              under={
                <>
                  <ChangeChip amount={totalBalance - totalOpening} suffix="this month" />
                  <Text className="text-meta text-muted-foreground">{isNow ? "closing today" : "at month end"}</Text>
                </>
              }
            >
              <FlowTiles
                inAmount={inflow}
                inSub={parts(totalCredits, "Credits", totalTransfersIn, "transfers in")}
                outAmount={outflow}
                outSub={parts(totalExpenses, "Spent", totalTransfersOut, "transfers out")}
              />
              <FootRows
                rows={[
                  { label: "Opened the month at", value: formatAmount(totalOpening) },
                  // Drift: how much was corrected by hand this month (more = less trust in what SMS gave).
                  ...(adjustmentStats.count > 0
                    ? [{
                        label: `Includes ${adjustmentStats.count} balance ${adjustmentStats.count === 1 ? "correction" : "corrections"}`,
                        value: formatAmount(adjustmentStats.total),
                        color: theme.warning,
                      }]
                    : []),
                ]}
              />
            </SummaryCard>
          );
        })()}

        {summaries.length > 0 && <CardsLabel title="Accounts" />}
        {summaries.map(({ account, opening, expenses, credits, transfersOut, transfersIn, current, seeded, autoDetectedStale }) => {
          const inflow = credits + transfersIn;
          const outflow = expenses + transfersOut;
          const note = smsNote(account, current, autoDetectedStale);
          const title = account.bank_name || account.account_label || "Account";
          const sub = [account.account_label && account.account_label !== title ? account.account_label : null, account.account_identifier ? `••${account.account_identifier.slice(-4)}` : null]
            .filter(Boolean)
            .join(" · ");
          return (
            <AccountCard
              key={account.id}
              label={`${title} ${sub}, ${formatAmount(current)}, open ledger`}
              onPress={() => router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: account.id, month } })}
            >
              <AccountHead
                type="savings"
                title={title}
                subtitle={sub}
                amount={current}
                amountColor={current < 0 ? theme.danger : undefined}
                change={current - opening}
              />
              {!seeded && <OpeningBalanceBanner accountId={account.id} message="Counting from ₹0. No opening balance yet." />}
              <FlowBar
                inflow={inflow}
                outflow={outflow}
                inText={`In ${formatAmount(inflow)}${transfersIn > 0 ? ` · ${formatAmount(transfersIn)} transfers` : ""}`}
                outText={`Out ${formatAmount(outflow)}${transfersOut > 0 ? ` · ${formatAmount(transfersOut)} transfers` : ""}`}
              />
              <Text className="text-label text-muted-foreground">
                Opened the month at {formatAmount(opening)}
              </Text>
              {note && <CardNote tone={note.tone} text={note.text} />}
            </AccountCard>
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
            <ClosedToggle count={closedAccounts.length} noun={{ one: "account", many: "accounts" }} open={closedExpanded} onToggle={() => setClosedExpanded((e) => !e)} />
            {closedExpanded &&
              closedAccounts.map((acct) => (
                <ClosedAccountRow
                  key={acct.id}
                  type="savings"
                  title={acct.account_label || `${acct.bank_name} ••${acct.account_identifier}`}
                  subtitle={acct.bank_name}
                  onPress={() => router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: acct.id } })}
                />
              ))}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
