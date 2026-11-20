import { PeriodNavigator, ScreenContainer, Text } from "@/components/ui";
import {
  AccountCard,
  AccountHead,
  CardNote,
  CardsLabel,
  ChangeChip,
  ClosedAccountRow,
  ClosedToggle,
  FlowTiles,
  FootRows,
  SummaryCard,
  smsNote,
} from "@/components/account/AccountCards";
import { DEFAULT_USER_ID } from "@/constants/app";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import {
    getAdjustmentAbsTotalByAccountType,
    computeUnseededBalance,
    getMonthBalanceSummary,
} from "@/services/account-balance";
import { getTransfersInTotal, getTransfersOutTotal } from "@/services/account-transfer";
import { getCurrentMonth } from "@/services/budget";
import type { FinancialAccount } from "@/services/financial-account";
import { getAccountLatestStaleCheckDates, getActiveAccounts, getClosedAccounts } from "@/services/financial-account";
import { consumeWalletsPreload } from "@/services/home-preload";

import { getMonthDateRange } from "@/utils/budget-helpers";
import { formatAmount } from "@/utils/format";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { useGuardedLoad } from "@/hooks/use-guarded-load";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";
import { OpeningBalanceBanner } from "@/components/account/OpeningBalanceBanner";

const preloaded = consumeWalletsPreload();

interface WalletSummary {
  account: FinancialAccount;
  opening: number;
  expenses: number;
  credits: number;
  transfersOut: number;
  transfersIn: number;
  current: number;
  seeded: boolean;
  autoDetectedStale: boolean;
}

export default function WalletsScreen() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [summaries, setSummaries] = useState<WalletSummary[]>(preloaded?.summaries ?? []);
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
        getAdjustmentAbsTotalByAccountType(DEFAULT_USER_ID, "wallet", startDate, endDate),
        getClosedAccounts(DEFAULT_USER_ID, "wallet"),
      ]);
      const wallets = allAccounts.filter((a) => a.account_type === "wallet");
      setAdjustmentStats(adjStats);
      setClosedAccounts(closed);

      const results: WalletSummary[] = await Promise.all(
        wallets.map(async (account) => {
          const [summary, txOut, txIn] = await Promise.all([
            getMonthBalanceSummary(account.id, month),
            getTransfersOutTotal(account.id, startDate, endDate),
            getTransfersInTotal(account.id, startDate, endDate),
          ]);
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
              transfersOut: txOut,
              transfersIn: txIn,
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
            transfersOut: txOut,
            transfersIn: txIn,
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

  const totalOpening = summaries.reduce((sum, s) => sum + s.opening, 0);
  const totalBalance = summaries.reduce((sum, s) => sum + s.current, 0);
  const totalExpenses = summaries.reduce((sum, s) => sum + s.expenses, 0);
  const totalCredits = summaries.reduce((sum, s) => sum + s.credits, 0);
  const totalTransfersOut = summaries.reduce((sum, s) => sum + s.transfersOut, 0);
  const totalTransfersIn = summaries.reduce((sum, s) => sum + s.transfersIn, 0);

  return (
    <ScreenContainer padTop={false}>
      {guarded.failed && <LoadFailedBanner onRetry={guarded.load} />}
      <PeriodNavigator mode="month" value={month} onChange={setMonth} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadData(); setRefreshing(false); }} />
        }
      >
        {/* Summary: what's in the wallets now, then top-ups against spending (owner, Nov 2026). */}
        {summaries.length > 0 && (() => {
          const isNow = month === getCurrentMonth();
          const ins = [totalCredits > 0 ? `Top-ups and refunds ${formatAmount(totalCredits)}` : null, totalTransfersIn > 0 ? `transfers in ${formatAmount(totalTransfersIn)}` : null].filter(Boolean).join(" · ");
          const outs = [totalExpenses > 0 ? `Payments ${formatAmount(totalExpenses)}` : null, totalTransfersOut > 0 ? `transfers out ${formatAmount(totalTransfersOut)}` : null].filter(Boolean).join(" · ");
          return (
            <SummaryCard
              label={`All wallets · ${summaries.length}`}
              amount={totalBalance}
              amountColor={totalBalance < 0 ? theme.danger : undefined}
              under={
                <>
                  <ChangeChip amount={totalBalance - totalOpening} suffix="this month" />
                  <Text className="text-meta text-muted-foreground">{isNow ? "in wallets now" : "at month end"}</Text>
                </>
              }
            >
              <FlowTiles
                inLabel="Topped up"
                inAmount={totalCredits + totalTransfersIn}
                inSub={ins || "Nothing added"}
                outLabel="Spent"
                outAmount={totalExpenses + totalTransfersOut}
                outSub={outs || "Nothing spent"}
              />
              <FootRows
                rows={[
                  { label: "Opened the month at", value: formatAmount(totalOpening) },
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

        {summaries.length > 0 && <CardsLabel title="Wallets" />}
        {summaries.map(({ account, opening, expenses, credits, transfersOut, transfersIn, current, seeded, autoDetectedStale }) => {
          const title = account.account_label ?? account.bank_name ?? "Wallet";
          const spent = expenses + transfersOut;
          const added = credits + transfersIn;
          const sub = [
            account.account_label && account.bank_name && account.account_label !== account.bank_name ? account.bank_name : null,
            spent > 0 ? `Spent ${formatAmount(spent)}` : null,
            added > 0 ? `topped up ${formatAmount(added)}` : null,
          ].filter(Boolean).join(" · ") || "Nothing this month";
          const note = smsNote(account, current, autoDetectedStale, "wallet");
          return (
            <AccountCard
              key={account.id}
              label={`${title}, ${formatAmount(current)}, open ledger`}
              onPress={() => router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: account.id, month } })}
            >
              <AccountHead type="wallet" title={title} subtitle={sub} amount={current} amountColor={current < 0 ? theme.danger : undefined} change={current - opening} />
              {!seeded && <OpeningBalanceBanner accountId={account.id} message="Counting from ₹0. No opening balance yet." />}
              <Text className="text-label text-muted-foreground">Opened the month at {formatAmount(opening)}</Text>
              {note && <CardNote tone={note.tone} text={note.text} />}
            </AccountCard>
          );
        })}

        {summaries.length === 0 && closedAccounts.length === 0 && (
          <View className="items-center py-16">
            <Ionicons name="phone-portrait-outline" size={48} color={colors.textSecondary} />
            <Text className="text-lg font-medium text-foreground mt-4">
              No wallets
            </Text>
            <Text className="text-sm text-muted-foreground mt-1 text-center px-8">
              Wallets will appear here once detected from SMS or added manually.
            </Text>
          </View>
        )}

        {/* Closed wallets */}
        {closedAccounts.length > 0 && (
          <>
            <ClosedToggle count={closedAccounts.length} noun={{ one: "wallet", many: "wallets" }} open={closedExpanded} onToggle={() => setClosedExpanded((e) => !e)} />
            {closedExpanded &&
              closedAccounts.map((acct) => (
                <ClosedAccountRow
                  key={acct.id}
                  type="wallet"
                  title={acct.account_label || acct.bank_name}
                  subtitle={acct.account_label && acct.account_label !== acct.bank_name ? acct.bank_name : null}
                  onPress={() => router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: acct.id } })}
                />
              ))}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
