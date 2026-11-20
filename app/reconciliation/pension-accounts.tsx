import { PeriodNavigator, ScreenContainer, Text } from "@/components/ui";
import {
  AccountCard,
  AccountHead,
  CardNote,
  CardsLabel,
  ChangeChip,
  ClosedAccountRow,
  ClosedToggle,
  FootRows,
  MonthStrip,
  SummaryCard,
  smsNote,
} from "@/components/account/AccountCards";
import { OpeningBalanceBanner } from "@/components/account/OpeningBalanceBanner";
import { DEFAULT_USER_ID } from "@/constants/app";

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
import { getAccountLatestStaleCheckDates, getActiveAccounts, getClosedPensionLikeAccounts } from "@/services/financial-account";
import { batchInvestmentProducts, isPensionLikeAccount } from "@/services/investment-accounts";
import { consumePensionAccountsPreload } from "@/services/home-preload";
import { getFYStartMonth } from "@/services/settings";

import { getMonthDateRange } from "@/utils/budget-helpers";
import { getCurrentFY, getFYRange } from "@/utils/fiscal-year";
import { formatAmount } from "@/utils/format";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { useGuardedLoad } from "@/hooks/use-guarded-load";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";

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
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [summaries, setSummaries] = useState<AccountSummary[]>(preloaded?.summaries ?? []);
  const [adjustmentStats, setAdjustmentStats] = useState<{ total: number; count: number }>(preloaded?.adjustmentStats ?? { total: 0, count: 0 });
  const [closedAccounts, setClosedAccounts] = useState<FinancialAccount[]>([]);
  const [closedExpanded, setClosedExpanded] = useState(false);
  const [month, setMonth] = useState(getCurrentMonth());
  const [ytdCredits, setYtdCredits] = useState(0);
  const [ytdPerAccount, setYtdPerAccount] = useState<Record<string, number>>({});
  // Contributions per month of the financial year, per account (null: a month still to come).
  const [fyMonths, setFyMonths] = useState<string[]>([]);
  const [monthlyPerAccount, setMonthlyPerAccount] = useState<Record<string, (number | null)[]>>({});
  const [refreshing, setRefreshing] = useState(false);

  const { startDate, endDate } = useMemo(() => getMonthDateRange(month), [month]);

  const loadData = useCallback(async () => {
      const [allAccounts, staleDates, adjStats, closed] = await Promise.all([
        getActiveAccounts(DEFAULT_USER_ID),
        getAccountLatestStaleCheckDates(DEFAULT_USER_ID, startDate, endDate),
        getAdjustmentAbsTotalByAccountType(DEFAULT_USER_ID, "pension", startDate, endDate),
        getClosedPensionLikeAccounts(DEFAULT_USER_ID),
      ]);
      const investmentIds = allAccounts.filter((a) => a.account_type === "investment").map((a) => a.id);
      const investmentProducts = await batchInvestmentProducts(investmentIds);
      const pensionAccounts = allAccounts.filter((a) => isPensionLikeAccount(a, investmentProducts.get(a.id)));
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
      // Each month of the FY up to the viewed one: what came in (contributions), for the strip.
      const months: string[] = [];
      for (let i = 0; i < 12; i++) {
        const d = new Date(fyRange.start.getFullYear(), fyRange.start.getMonth() + i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
      let ytdTotal = 0;
      const ytdMap: Record<string, number> = {};
      const monthlyMap: Record<string, (number | null)[]> = {};
      await Promise.all(
        results.map(async ({ account }) => {
          const byMonth = await Promise.all(
            months.map(async (mo) => {
              if (mo > month) return null;
              const r = getMonthDateRange(mo);
              return getAccountCreditsTotal(account.id, r.startDate, r.endDate);
            }),
          );
          monthlyMap[account.id] = byMonth;
          const acctYtd = byMonth.reduce<number>((s, v) => s + (v ?? 0), 0);
          ytdMap[account.id] = acctYtd;
          ytdTotal += acctYtd;
        }),
      );
      setYtdCredits(ytdTotal);
      setYtdPerAccount(ytdMap);
      setFyMonths(months);
      setMonthlyPerAccount(monthlyMap);
  }, [month, startDate, endDate]);

  const guarded = useGuardedLoad(loadData);
  useDataRefresh(guarded.load);

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
        {/* Summary: the balance first, then this year's contributions month by month (owner, Nov 2026). */}
        {summaries.length > 0 && (() => {
          const all = fyMonths.map((_, i) => {
            const vals = Object.values(monthlyPerAccount).map((v) => v[i]);
            return vals.every((v) => v == null) ? null : vals.reduce<number>((s, v) => s + (v ?? 0), 0);
          });
          const gone = all.filter((v) => v != null).length;
          const paid = all.filter((v) => v != null && v > 0).length;
          const lastIdx = all.reduce<number>((li, v, i) => (v != null && v > 0 ? i : li), -1);
          const monLabel = (mo: string) => new Date(`${mo}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" });
          return (
            <SummaryCard
              label={`Retirement · ${summaries.length} ${summaries.length === 1 ? "account" : "accounts"}`}
              amount={totalBalance}
              amountColor={totalBalance < 0 ? theme.danger : undefined}
              under={
                <>
                  <ChangeChip amount={totalBalance - totalOpening} suffix="this month" />
                  <Text className="text-meta text-muted-foreground">from {formatAmount(totalOpening)}</Text>
                </>
              }
            >
              <View className="rounded-control p-3" style={{ gap: 10, backgroundColor: theme.background }}>
                <View className="flex-row justify-between items-baseline">
                  <Text className="text-meta text-muted-foreground">Contributed this FY</Text>
                  <Text className="text-heading font-bold" style={{ color: ytdCredits > 0 ? theme.success : theme.foreground }}>
                    {ytdCredits > 0 ? "+" : ""}{formatAmount(ytdCredits)}
                  </Text>
                </View>
                {fyMonths.length === 12 && (
                  <>
                    <MonthStrip values={all} height={20} label={`Contributions arrived in ${paid} of ${gone} months so far this year`} />
                    <View className="flex-row justify-between">
                      <Text className="text-label text-muted-foreground">{monLabel(fyMonths[0])}</Text>
                      <Text className="text-label text-muted-foreground">{paid} of {gone} months so far</Text>
                      <Text className="text-label text-muted-foreground">{monLabel(fyMonths[11])}</Text>
                    </View>
                  </>
                )}
              </View>
              <FootRows
                rows={[
                  ...(totalCredits > 0 ? [{ label: "Contributed this month", value: `+${formatAmount(totalCredits)}`, color: theme.success }] : []),
                  ...(lastIdx >= 0 ? [{ label: "Last contribution", value: new Date(`${fyMonths[lastIdx]}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) }] : []),
                  ...(lastContributionDate ? [{ label: "Latest balance SMS", value: new Date(lastContributionDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) }] : []),
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
        {summaries.map(({ account, opening, credits, current, seeded, autoDetectedStale }) => {
          const title = account.bank_name || account.account_label || "Pension";
          const sub = [account.account_label && account.account_label !== title ? account.account_label : null, account.account_identifier ? `••${account.account_identifier.slice(-4)}` : null]
            .filter(Boolean)
            .join(" · ");
          const strip = monthlyPerAccount[account.id];
          const lastIdx = strip ? strip.reduce<number>((li, v, i) => (v != null && v > 0 ? i : li), -1) : -1;
          const note = smsNote(account, current, autoDetectedStale);
          return (
            <AccountCard
              key={account.id}
              label={`${title} ${sub}, ${formatAmount(current)}, open ledger`}
              onPress={() => router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: account.id, month } })}
            >
              <AccountHead type="pension" title={title} subtitle={sub} amount={current} amountColor={current < 0 ? theme.danger : undefined} change={current - opening} />
              {!seeded && <OpeningBalanceBanner accountId={account.id} message="Counting from ₹0. No opening balance yet." />}
              {strip && <MonthStrip values={strip} label={`Contributions this year in ${strip.filter((v) => v != null && v > 0).length} months`} />}
              <View className="flex-row" style={{ gap: 8 }}>
                <View className="flex-1">
                  <Text className="text-meta text-muted-foreground">This FY</Text>
                  <Text className="text-meta font-semibold text-foreground">{formatAmount(ytdPerAccount[account.id] ?? 0)}</Text>
                </View>
                <View className="flex-1 items-center">
                  <Text className="text-meta text-muted-foreground">This month</Text>
                  <Text className="text-meta font-semibold" style={{ color: credits > 0 ? theme.success : theme.foreground }}>{credits > 0 ? `+${formatAmount(credits)}` : "None"}</Text>
                </View>
                <View className="flex-1 items-end">
                  <Text className="text-meta text-muted-foreground">Last in</Text>
                  <Text className="text-meta font-semibold text-foreground">
                    {lastIdx >= 0 ? new Date(`${fyMonths[lastIdx]}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" }) : "None yet"}
                  </Text>
                </View>
              </View>
              <Text className="text-label text-muted-foreground">Opened the month at {formatAmount(opening)}</Text>
              {note ? <CardNote tone={note.tone} text={note.text} /> : <CardNote tone="info" text="No balance SMS yet · worked out from contributions" />}
            </AccountCard>
          );
        })}

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
            <ClosedToggle count={closedAccounts.length} noun={{ one: "account", many: "accounts" }} open={closedExpanded} onToggle={() => setClosedExpanded((e) => !e)} />
            {closedExpanded &&
              closedAccounts.map((acct) => (
                <ClosedAccountRow
                  key={acct.id}
                  type="pension"
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
