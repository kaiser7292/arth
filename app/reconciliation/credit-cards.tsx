import { useState, useCallback, useMemo } from "react";
import { View, ScrollView, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { PeriodNavigator, ScreenContainer, Text } from "@/components/ui";
import {
  AccountHead,
  CardNote,
  CardsLabel,
  ClosedAccountRow,
  ClosedToggle,
  FootRows,
  ShareBar,
  SummaryCard,
  shortDate,
  type NoteTone,
} from "@/components/account/AccountCards";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";

import { formatAmount } from "@/utils/format";

import { DEFAULT_USER_ID } from "@/constants/app";
import { getActiveAccounts, getCcExpenseTotals, clearCcDues, getClosedAccounts } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import { useAlert } from "@/hooks/use-alert";
import { getComputedBalanceComponents, getEarliestMonthForAccounts, getAdjustmentAbsTotalByAccountType } from "@/services/account-balance";
import { getBalanceSourceInfo } from "@/services/balance-source";
import type { BalanceComponents } from "@/services/account-balance";
import { getCurrentMonth } from "@/services/budget";
import { consumeCreditCardsPreload } from "@/services/home-preload";

const preloaded = consumeCreditCardsPreload();

import { getMonthDateRange } from "@/utils/budget-helpers";
import { useTheme, type Theme } from "@/hooks/use-theme";

/** Takes the theme as an argument: this is a plain helper, not a component, so it must not call a
 *  hook. It runs inside map callbacks, where a conditional hook call would break hook order. */
function getUtilColor(pct: number, theme: Theme): string {
  if (pct > 75) return theme.danger;
  if (pct > 50) return theme.warning;
  return theme.success;
}

/** Days from today to a YYYY-MM-DD date (negative: past). */
function daysUntil(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/** What the bank's SMS says about a pool's room left, against Arth's figure, as one note. */
function poolNote(remaining: number, bankLeft: number | null, stale: boolean): { tone: NoteTone; text: string } | null {
  if (bankLeft == null) return null;
  if (stale) return { tone: "info", text: `SMS said ${formatAmount(bankLeft)} left, before your latest payment · using Arth's figure` };
  const diff = remaining - bankLeft;
  if (Math.abs(diff) < 0.005) return { tone: "ok", text: `Matches the bank's SMS · ${formatAmount(bankLeft)} left` };
  return diff > 0
    ? { tone: "warn", text: `${formatAmount(Math.abs(diff))} of spending not in Arth yet · bank says ${formatAmount(bankLeft)} left` }
    : { tone: "warn", text: `${formatAmount(Math.abs(diff))} of payments not in Arth yet · bank says ${formatAmount(bankLeft)} left` };
}

function formatDueDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const label = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  if (diff < 0) return `Overdue (${label})`;
  if (diff === 0) return "Due today";
  if (diff <= 3) return `Due in ${diff}d`;
  return `Due ${label}`;
}

interface BankGroup {
  bankName: string;
  accounts: FinancialAccount[];
  sharedLimit: number;
  /** Calculated Available — derived from ledger (sharedLimit − pool utilization). Authoritative. */
  sharedAvailable: number;
  combinedSpend: number;
  utilized: number;
  /** Pool's SMS-reported available: min of siblings' last_known_balance when fresh. null when no SMS data. */
  autoDetectedAvailable: number | null;
  /** Freshest last_balance_date across siblings. */
  autoDetectedDate: string | null;
  /** True if any sibling had a credit/payment in this month dated after autoDetectedDate → SMS is stale. */
  autoDetectedStale: boolean;
}

export default function CreditCardsScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [closedCCs, setClosedCCs] = useState<FinancialAccount[]>([]);
  const [closedExpanded, setClosedExpanded] = useState(false);
  const [ccAccounts, setCcAccounts] = useState<FinancialAccount[]>(preloaded?.ccAccounts ?? []);
  const [expenseTotals, setExpenseTotals] = useState<Record<string, number>>(preloaded?.expenseTotals ?? {});
  const [balanceComponents, setBalanceComponents] = useState<Record<string, BalanceComponents | null>>(preloaded?.balanceComponents ?? {});
  // v15.9.2: pool staleness now comes from getBalanceSourceInfo (same decision
  // the Account Detail page uses), keyed by bank name. This replaces the old
  // month-scoped latestStaleCheckDates map, which was blind to any staleness
  // signal from outside the currently-selected month — letting the Credit
  // Cards screen display "fresh" while Account Detail showed "stale" for the
  // same pool (seen on 2026-05-01 for HDFC 8957/9628).
  const [poolStaleByBank, setPoolStaleByBank] = useState<Record<string, boolean>>(preloaded?.poolStaleByBank ?? {});
  const [adjustmentStats, setAdjustmentStats] = useState<{ total: number; count: number }>(preloaded?.adjustmentStats ?? { total: 0, count: 0 });
  const [month, setMonth] = useState(getCurrentMonth());
  const [minMonth, setMinMonth] = useState<string | undefined>(preloaded?.minMonth);
  const [refreshing, setRefreshing] = useState(false);
  const maxMonth = useMemo(() => {
    const now = new Date();
    const future = new Date(now.getFullYear(), now.getMonth() + 3, 1);
    return `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const { startDate, endDate } = useMemo(() => getMonthDateRange(month), [month]);

  // monthLabel and handleMonthShift replaced by PeriodNavigator

  const loadData = useCallback(async () => {
      const [allAccounts, totals, adjStats, closed] = await Promise.all([
        getActiveAccounts(DEFAULT_USER_ID),
        getCcExpenseTotals(DEFAULT_USER_ID, startDate, endDate),
        getAdjustmentAbsTotalByAccountType(DEFAULT_USER_ID, "credit_card", startDate, endDate),
        getClosedAccounts(DEFAULT_USER_ID, "credit_card"),
      ]);
      const ccOnly = allAccounts.filter((a) => a.account_type === "credit_card");
      setClosedCCs(closed);
      setCcAccounts(ccOnly);
      setExpenseTotals(totals);
      setAdjustmentStats(adjStats);

      // Resolve pool staleness via getBalanceSourceInfo — same logic the
      // Account Detail page uses. One call per bank group (pools are pool-
      // aware internally; picks up all siblings regardless of which id we
      // anchor on).
      const bankAnchors = new Map<string, string>();
      for (const a of ccOnly) {
        if (!bankAnchors.has(a.bank_name)) bankAnchors.set(a.bank_name, a.id);
      }
      const staleEntries = await Promise.all(
        Array.from(bankAnchors.entries()).map(async ([bankName, anchorId]) => {
          try {
            const info = await getBalanceSourceInfo(anchorId);
            return [bankName, info?.isStale ?? false] as const;
          } catch {
            return [bankName, false] as const;
          }
        }),
      );
      setPoolStaleByBank(Object.fromEntries(staleEntries));

      // Fetch ledger-based current balances for utilization computation
      if (ccOnly.length > 0) {
        const ccIds = ccOnly.map((a) => a.id);
        const [components, earliestMonth] = await Promise.all([
          getComputedBalanceComponents(ccIds),
          getEarliestMonthForAccounts(ccIds),
        ]);
        setBalanceComponents(components);
        setMinMonth(earliestMonth ?? undefined);
      } else {
        setMinMonth(undefined);
      }
  }, [startDate, endDate]);

  useDataRefresh(loadData);

  // Build bank groups for shared-limit reconciliation
  const bankGroups = useMemo((): BankGroup[] => {
    const groupMap = new Map<string, FinancialAccount[]>();
    for (const a of ccAccounts) {
      const group = groupMap.get(a.bank_name) ?? [];
      group.push(a);
      groupMap.set(a.bank_name, group);
    }

    return Array.from(groupMap.entries()).map(([bankName, accounts]) => {
      const sharedLimit = Math.max(...accounts.map((a) => a.credit_limit ?? 0), 0);
      // In the utilized model, closing IS the utilized amount for that card.
      // Pool utilized = sum of sibling closings (no cap — ledger is authoritative).
      let utilized = 0;
      for (const a of accounts) {
        const components = balanceComponents[a.id];
        if (components) utilized += components.closing;
      }
      const sharedAvailable = sharedLimit - utilized;
      const combinedSpend = accounts.reduce((sum, a) => sum + (expenseTotals[a.id] ?? 0), 0);

      // Pool-level auto-detected: latest-dated sibling wins (both balance value
      // and date come from the SAME sibling). For shared-limit pools, each
      // sibling's SMS reports the SAME pool remaining, so the freshest one is
      // authoritative.
      //
      // v15.9.1 fix: pre-v15.9.1 used "min balance wins" paired with
      // "max date wins" — mixing stale-sibling's number with fresh-sibling's
      // date. Result: pool thought it had a fresh auto-detected number that was
      // actually an older snapshot the pool had moved past, producing a phantom
      // "X untracked spend" label on the Credit Cards page even though every
      // individual card's account-detail page showed Auto-detected = Calculated.
      // The balance-source.ts winner query (used by account-detail) already
      // does date-wins; this brings the reconciliation page in line.
      let autoDetectedAvailable: number | null = null;
      let autoDetectedDate: string | null = null;
      for (const a of accounts) {
        if (a.last_known_balance == null || !a.last_balance_date) continue;
        if (autoDetectedDate == null || a.last_balance_date > autoDetectedDate) {
          autoDetectedAvailable = a.last_known_balance;
          autoDetectedDate = a.last_balance_date;
        }
      }
      // Staleness comes from getBalanceSourceInfo (authoritative, all-time
      // view). Keyed by bank name because pools are bank-scoped.
      const autoDetectedStale = poolStaleByBank[bankName] ?? false;

      return {
        bankName,
        accounts,
        sharedLimit,
        sharedAvailable,
        combinedSpend,
        utilized,
        autoDetectedAvailable,
        autoDetectedDate,
        autoDetectedStale,
      };
    });
  }, [ccAccounts, expenseTotals, balanceComponents, poolStaleByBank]);

  // Overall totals — Calculated is authoritative; Auto-detected is the sum of
  // pool-level SMS-reported availables (siblings: take min), only for groups where
  // it's fresh (non-stale). When any group is stale/missing, we skip it from the
  // auto-detected total and note that in the label.
  const totalLimit = bankGroups.reduce((sum, g) => sum + g.sharedLimit, 0);
  const totalAvailable = bankGroups.reduce((sum, g) => sum + g.sharedAvailable, 0);
  const totalSpend = bankGroups.reduce((sum, g) => sum + g.combinedSpend, 0);
  const totalAutoDetected = bankGroups.reduce(
    (sum, g) => sum + (g.autoDetectedAvailable != null && !g.autoDetectedStale ? g.autoDetectedAvailable : 0),
    0,
  );
  const anyAutoDetectedStaleOrMissing = bankGroups.some(
    (g) => g.autoDetectedAvailable == null || g.autoDetectedStale,
  );
  const overallUtil = totalLimit > 0 ? ((totalLimit - totalAvailable) / totalLimit) * 100 : 0;
  const overallUtilColor = getUtilColor(overallUtil, theme);

  return (
    <ScreenContainer padTop={false}>
      {/* Month navigator */}
      <PeriodNavigator mode="month" value={month} onChange={setMonth} minMonth={minMonth} maxMonth={maxMonth} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadData(); setRefreshing(false); }} />
        }
      >
        {/* Summary: what's used against the limit, the bills that need you, then what the banks say
            (owner, Nov 2026, "Arth account cards"). */}
        {ccAccounts.length > 0 && (() => {
          const utilized = totalLimit - totalAvailable;
          const remaining = totalAvailable;
          const autoDetectedUsable = !anyAutoDetectedStaleOrMissing && totalAutoDetected > 0;
          const totalDiff = autoDetectedUsable ? remaining - totalAutoDetected : 0;
          const dues = ccAccounts.filter((a) => a.total_due != null && a.total_due > 0 && a.due_date);
          const overdue = dues.filter((a) => daysUntil(a.due_date!) < 0);
          const next = dues.filter((a) => daysUntil(a.due_date!) >= 0).sort((a, b) => a.due_date!.localeCompare(b.due_date!))[0];
          const nextText = next
            ? `${overdue.length > 0 ? "Next: " : ""}${next.bank_name} ••${next.account_identifier} · ${formatAmount(next.total_due!)} ${(() => {
                const d = daysUntil(next.due_date!);
                return d === 0 ? "due today" : d === 1 ? "due tomorrow" : `in ${d} days`;
              })()}`
            : null;
          return (
            <SummaryCard
              label={`Used on all cards · ${ccAccounts.length}`}
              amount={utilized}
              amountAside={totalLimit > 0 ? `of ${formatAmount(totalLimit)}` : undefined}
            >
              {totalLimit > 0 && (
                <View style={{ gap: 6 }}>
                  <View>
                    <ShareBar value={overallUtil / 100} color={overallUtilColor} height={10} />
                    {/* Where the bar turns amber (50%) and red (75%). */}
                    <View className="absolute bg-card" style={{ left: "50%", top: -3, width: 2, height: 16 }} />
                    <View className="absolute bg-card" style={{ left: "75%", top: -3, width: 2, height: 16 }} />
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-meta font-semibold" style={{ color: overallUtilColor }}>{Math.round(overallUtil)}% used</Text>
                    <Text className="text-meta text-muted-foreground">{formatAmount(remaining)} left</Text>
                  </View>
                </View>
              )}
              {(overdue.length > 0 || nextText) && (
                <View className="flex-row items-center rounded-control px-3 py-2.5" style={{ gap: 10, backgroundColor: theme.alpha(overdue.length > 0 ? "danger" : "warning", overdue.length > 0 ? 0.07 : 0.08) }}>
                  <Ionicons name="time-outline" size={18} color={overdue.length > 0 ? theme.danger : theme.warning} />
                  <View className="flex-1" style={{ minWidth: 0 }}>
                    {overdue.length > 0 && (
                      <Text className="text-meta font-semibold" style={{ color: theme.danger }}>
                        {overdue.length} {overdue.length === 1 ? "bill" : "bills"} overdue · {formatAmount(overdue.reduce((s, a) => s + (a.total_due ?? 0), 0))}
                      </Text>
                    )}
                    {nextText && (
                      <Text className={overdue.length > 0 ? "text-label text-muted-foreground" : "text-meta font-semibold"} style={overdue.length > 0 ? undefined : { color: theme.warning }}>
                        {nextText}
                      </Text>
                    )}
                  </View>
                </View>
              )}
              <FootRows
                rows={[
                  ...(totalAutoDetected > 0
                    ? [{ label: `Banks say left${anyAutoDetectedStaleOrMissing ? " (not every card)" : ""}`, value: formatAmount(totalAutoDetected) }]
                    : []),
                  ...(totalAutoDetected > 0 && autoDetectedUsable && Math.abs(totalDiff) >= 0.005
                    ? [{
                        label: totalDiff > 0 ? "Spending not in Arth yet" : "Payments not in Arth yet",
                        value: formatAmount(Math.abs(totalDiff)),
                        color: theme.warning,
                      }]
                    : totalAutoDetected > 0 && autoDetectedUsable
                      ? [{ label: "Arth matches the banks", value: "✓", color: theme.success }]
                      : []),
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

        {bankGroups.length > 0 && <CardsLabel title="By bank" />}
        {bankGroups.map((group) => {
          const bankUtil = group.sharedLimit > 0 ? ((group.sharedLimit - group.sharedAvailable) / group.sharedLimit) * 100 : 0;
          const bankUtilColor = getUtilColor(bankUtil, theme);
          const isShared = group.accounts.length > 1;
          const note = poolNote(group.sharedAvailable, group.autoDetectedAvailable, group.autoDetectedStale);
          return (
            <View key={group.bankName} className="mx-4 mb-2 rounded-card bg-card border border-border p-4" style={{ gap: 12 }}>
              <AccountHead
                type="credit_card"
                title={group.bankName}
                subtitle={
                  isShared
                    ? `${group.accounts.length} cards · shared limit ${formatAmount(group.sharedLimit)}`
                    : group.sharedLimit > 0
                      ? `Limit ${formatAmount(group.sharedLimit)} · ${formatAmount(group.sharedAvailable)} left`
                      : "No limit set"
                }
                amount={group.utilized}
                changeText={group.sharedLimit > 0 ? `${Math.round(bankUtil)}% used` : "used"}
              />
              {group.sharedLimit > 0 && <ShareBar value={bankUtil / 100} color={bankUtilColor} />}

              {group.accounts.map((account) => {
                const limit = account.credit_limit ?? 0;
                const components = balanceComponents[account.id];
                const spent = components?.expenses ?? expenseTotals[account.id] ?? 0;
                const credits = components?.credits ?? 0;
                const adjNet = components?.adjustmentNet ?? 0;
                // In the utilized model, closing IS the utilized amount.
                // Fallback (unseeded + SMS present): limit − last_known_balance.
                const outstanding = components
                  ? components.closing
                  : account.last_known_balance != null
                    ? Math.max(0, limit - account.last_known_balance)
                    : 0;
                const hasDue = account.total_due != null && account.total_due > 0;
                const overdueNow = hasDue && !!account.due_date && daysUntil(account.due_date) < 0;
                const dueText = hasDue
                  ? `${account.due_date ? (overdueNow ? `Overdue since ${shortDate(account.due_date)}` : `Due ${shortDate(account.due_date)}`) : "Due"} · ${formatAmount(account.total_due!)}${account.min_due != null ? ` · min ${formatAmount(account.min_due)}` : ""}`
                  : "";
                const parts = [
                  `Spent ${formatAmount(spent)}`,
                  credits > 0 ? `paid back ${formatAmount(credits)}` : null,
                  adjNet !== 0 ? `corrections ${adjNet > 0 ? "+" : "−"}${formatAmount(Math.abs(adjNet))}` : null,
                ].filter(Boolean).join(" · ");
                return (
                  <Pressable
                    key={account.id}
                    onPress={() => router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: account.id, month } })}
                    className="border-t border-border pt-3"
                    style={{ gap: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Card ending ${account.account_identifier}, ${formatAmount(outstanding)} used, open ledger`}
                  >
                    <View className="flex-row items-center" style={{ gap: 8 }}>
                      <View className="flex-1" style={{ minWidth: 0 }}>
                        <Text className="text-body font-semibold text-foreground" numberOfLines={1}>
                          ••{account.account_identifier}{account.account_label ? ` · ${account.account_label}` : ""}
                        </Text>
                        <Text className="text-label text-muted-foreground" numberOfLines={1}>{parts}</Text>
                      </View>
                      <Text className="text-body font-bold text-foreground">{formatAmount(outstanding)}</Text>
                      <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                    </View>
                    {hasDue && (
                      <CardNote
                        boxed
                        tone={overdueNow ? "danger" : "warn"}
                        text={dueText}
                        action={{
                          label: "Mark paid",
                          onPress: () =>
                            alert("Clear dues", "Mark this card's dues as paid/resolved? This removes the overdue indicator.", [
                              { text: "Cancel", style: "cancel" },
                              { text: "Clear", style: "destructive", onPress: () => clearCcDues(account.id) },
                            ]),
                        }}
                      />
                    )}
                  </Pressable>
                );
              })}

              {note && <CardNote tone={note.tone} text={note.text} />}
            </View>
          );
        })}

        {/* Empty state */}
        {ccAccounts.length === 0 && closedCCs.length === 0 && (
          <View className="items-center py-16">
            <Ionicons name="card-outline" size={48} color={colors.textSecondary} />
            <Text className="text-lg font-medium text-foreground mt-4">
              No credit cards
            </Text>
            <Text className="text-sm text-muted-foreground mt-1 text-center px-8">
              Credit cards will appear here once detected from SMS or added manually.
            </Text>
          </View>
        )}

        {/* Closed credit cards */}
        {closedCCs.length > 0 && (
          <>
            <ClosedToggle count={closedCCs.length} noun={{ one: "card", many: "cards" }} open={closedExpanded} onToggle={() => setClosedExpanded((e) => !e)} />
            {closedExpanded &&
              closedCCs.map((acct) => (
                <ClosedAccountRow
                  key={acct.id}
                  type="credit_card"
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
