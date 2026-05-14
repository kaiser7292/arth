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
import { getActiveAccounts, getCcExpenseTotals, clearCcDues } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import { useAlert } from "@/hooks/use-alert";
import { getComputedBalanceComponents, getEarliestMonthForAccounts, getAdjustmentAbsTotalByAccountType } from "@/services/account-balance";
import { getBalanceSourceInfo } from "@/services/balance-source";
import type { BalanceComponents } from "@/services/account-balance";
import { getCurrentMonth } from "@/services/budget";
import { consumeCreditCardsPreload } from "@/services/home-preload";

const preloaded = consumeCreditCardsPreload();

import { getMonthDateRange } from "@/utils/budget-helpers";

function getUtilColor(
  pct: number,
  sc: (typeof StatusColors)["light"] | (typeof StatusColors)["dark"],
): string {
  if (pct > 75) return sc.danger;
  if (pct > 50) return sc.warning;
  return sc.success;
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
  const { accent, colors, colorScheme } = useColorScheme();
  const sc = StatusColors[colorScheme];
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
  const maxMonth = useMemo(() => {
    const now = new Date();
    const future = new Date(now.getFullYear(), now.getMonth() + 3, 1);
    return `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const { startDate, endDate } = useMemo(() => getMonthDateRange(month), [month]);

  // monthLabel and handleMonthShift replaced by PeriodNavigator

  useDataRefresh(
    useCallback(async () => {
      const [allAccounts, totals, adjStats] = await Promise.all([
        getActiveAccounts(DEFAULT_USER_ID),
        getCcExpenseTotals(DEFAULT_USER_ID, startDate, endDate),
        getAdjustmentAbsTotalByAccountType(DEFAULT_USER_ID, "credit_card", startDate, endDate),
      ]);
      const ccOnly = allAccounts.filter((a) => a.account_type === "credit_card");
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
    }, [startDate, endDate]),
  );

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
  const overallUtilColor = getUtilColor(overallUtil, sc);

  return (
    <ScreenContainer padTop={false}>
      {/* Month navigator */}
      <PeriodNavigator mode="month" value={month} onChange={setMonth} minMonth={minMonth} maxMonth={maxMonth} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Overall summary card */}
        <Card className="mx-4 mt-3 mb-2">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary uppercase tracking-wider">
              Overall Summary
            </Text>
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
              {ccAccounts.length} card{ccAccounts.length !== 1 ? "s" : ""}
            </Text>
          </View>

          {(() => {
            // Ledger-authoritative available = limit − utilized (opening + expenses − credits ± adjustments)
            const utilized = totalLimit - totalAvailable;
            const remaining = totalAvailable;
            const autoDetectedUsable = !anyAutoDetectedStaleOrMissing && totalAutoDetected > 0;
            // Difference = ledger remaining − bank remaining.
            // Positive → ledger thinks there's more room than the bank → untracked spend.
            // Negative → ledger thinks there's less room → untracked credit/payment.
            const totalDiff = autoDetectedUsable ? remaining - totalAutoDetected : 0;
            const totalDiffColor = !autoDetectedUsable
              ? sc.muted
              : Math.abs(totalDiff) < 0.005
                ? sc.success
                : totalDiff > 0 ? sc.warning : sc.danger;
            const totalDiffLabel = !autoDetectedUsable
              ? "Partial SMS data"
              : Math.abs(totalDiff) < 0.005
                ? "Bank matches"
                : totalDiff > 0
                  ? `${formatAmount(Math.abs(totalDiff))} untracked spend`
                  : `${formatAmount(Math.abs(totalDiff))} untracked credit`;
            return (
              <>
                <View className="flex-row justify-between mb-1">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Credit Limit</Text>
                  <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary">{formatAmount(totalLimit)}</Text>
                </View>
                <View className="flex-row justify-between mb-1">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Utilized</Text>
                  <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary">{formatAmount(utilized)}</Text>
                </View>
                <View className="flex-row justify-between mb-2">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Remaining</Text>
                  <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary">{formatAmount(remaining)}</Text>
                </View>

                {/* Utilization bar — inline % at the right, sits under the 3-number summary */}
                <View className="flex-row items-center mb-2">
                  <View className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 mr-2">
                    <View
                      className="h-1.5 rounded-full"
                      style={{ width: `${Math.min(overallUtil, 100)}%`, backgroundColor: overallUtilColor }}
                    />
                  </View>
                  <Text className="text-[10px] font-medium" style={{ color: overallUtilColor }}>
                    {Math.round(overallUtil)}% used
                  </Text>
                </View>

                {/* Reconciliation — everything below is about comparing ledger vs bank */}
                {totalAutoDetected > 0 && (
                  <>
                    <View className="h-px bg-border-light dark:bg-border-dark mb-2" />
                    <View className="flex-row justify-between mb-1">
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                        Bank detected remaining{anyAutoDetectedStaleOrMissing ? " (partial)" : ""}
                      </Text>
                      <Text
                        className="text-sm font-bold text-text-primary dark:text-text-dark-primary"
                        style={anyAutoDetectedStaleOrMissing ? { color: sc.muted } : undefined}
                      >
                        {formatAmount(totalAutoDetected)}
                      </Text>
                    </View>
                    <View className="flex-row justify-between mb-2">
                      <Text className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary">Difference</Text>
                      <Text className="text-sm font-bold" style={{ color: totalDiffColor }}>{totalDiffLabel}</Text>
                    </View>
                  </>
                )}
              </>
            );
          })()}

          {/* Drift indicator — total manual ledger adjustments across all CCs this month.
              Proxy for SMS parser reliability: more adjustments → less trust the app should
              place in auto-detected balances. */}
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

        {/* Per-bank sections */}
        {bankGroups.map((group) => {
          const bankUtil = group.sharedLimit > 0
            ? ((group.sharedLimit - group.sharedAvailable) / group.sharedLimit) * 100
            : 0;
          const bankUtilColor = getUtilColor(bankUtil, sc);
          const isShared = group.accounts.length > 1;

          return (
            <Card key={group.bankName} className="mx-4 mb-2">
              {/* Bank header */}
              <View className="flex-row items-center mb-3">
                <View
                  className="w-9 h-9 rounded-full items-center justify-center mr-3"
                  style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}
                >
                  <Ionicons name="card-outline" size={18} color={accent[500]} />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
                    {group.bankName}
                  </Text>
                  <Text className="text-[10px] text-text-secondary dark:text-text-dark-secondary">
                    {group.accounts.length} card{group.accounts.length !== 1 ? "s" : ""}
                    {isShared ? " · Shared limit" : ""}
                  </Text>
                </View>
              </View>

              {/* Credit Limit / Utilized / Remaining / Bank detected remaining / Difference */}
              {(() => {
                const remaining = group.sharedAvailable;
                const autoDetectedUsable =
                  group.autoDetectedAvailable != null && !group.autoDetectedStale;
                const diff = autoDetectedUsable
                  ? remaining - (group.autoDetectedAvailable ?? 0)
                  : 0;
                const diffColor = !autoDetectedUsable
                  ? sc.muted
                  : Math.abs(diff) < 0.005
                    ? sc.success
                    : diff > 0 ? sc.warning : sc.danger;
                const diffLabel = !autoDetectedUsable
                  ? group.autoDetectedStale ? "SMS stale — using ledger" : "No SMS data"
                  : Math.abs(diff) < 0.005
                    ? "Bank matches"
                    : diff > 0
                      ? `${formatAmount(Math.abs(diff))} untracked spend`
                      : `${formatAmount(Math.abs(diff))} untracked credit`;
                return (
                  <>
                    <View className="flex-row justify-between mb-1">
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                        Credit Limit{isShared ? " (shared)" : ""}
                      </Text>
                      <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                        {formatAmount(group.sharedLimit)}
                      </Text>
                    </View>
                    <View className="flex-row justify-between mb-1">
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                        Utilized
                      </Text>
                      <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                        {formatAmount(group.utilized)}
                      </Text>
                    </View>
                    <View className="flex-row justify-between mb-2">
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                        Remaining
                      </Text>
                      <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                        {formatAmount(remaining)}
                      </Text>
                    </View>

                    {/* Utilization bar — inline % on the right, right under the 3-number block */}
                    <View className="flex-row items-center mb-2">
                      <View className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 mr-2">
                        <View
                          className="h-1.5 rounded-full"
                          style={{ width: `${Math.min(bankUtil, 100)}%`, backgroundColor: bankUtilColor }}
                        />
                      </View>
                      <Text className="text-[10px] font-medium" style={{ color: bankUtilColor }}>
                        {Math.round(bankUtil)}% used
                      </Text>
                    </View>

                    {/* Reconciliation block — only when SMS data exists */}
                    {group.autoDetectedAvailable != null && (
                      <>
                        <View className="h-px bg-border-light dark:bg-border-dark mb-2" />
                        <View className="flex-row justify-between mb-1">
                          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                            Bank detected remaining{group.autoDetectedStale ? " (stale)" : ""}
                          </Text>
                          <Text
                            className="text-sm font-semibold text-text-primary dark:text-text-dark-primary"
                            style={group.autoDetectedStale ? { textDecorationLine: "line-through", color: sc.muted } : undefined}
                          >
                            {formatAmount(group.autoDetectedAvailable)}
                          </Text>
                        </View>
                        <View className="flex-row justify-between mb-3">
                          <Text className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary">
                            Difference
                          </Text>
                          <Text className="text-sm font-bold" style={{ color: diffColor }}>
                            {diffLabel}
                          </Text>
                        </View>
                      </>
                    )}
                  </>
                );
              })()}

              {/* Per-card breakdown */}
              <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary uppercase tracking-wider mb-2">
                Per Card Breakdown
              </Text>
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
                const dueLabel = hasDue ? formatDueDate(account.due_date) : null;
                return (
                  <Pressable
                    key={account.id}
                    onPress={() => router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: account.id } })}
                    className="py-3 border-t border-border-light dark:border-border-dark"
                  >
                    {/* Card name + chevron */}
                    <View className="flex-row items-center justify-between">
                      <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                        {"\u2022\u2022\u2022\u2022"} {account.account_identifier}
                        {account.account_label ? ` · ${account.account_label}` : ""}
                      </Text>
                      <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
                    </View>

                    {/* Per-card visual bifurcation — ledger is pool-level, this is just visibility */}
                    <View className="flex-row justify-between mb-0.5">
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Spent this cycle</Text>
                      <Text className="text-xs text-text-primary dark:text-text-dark-primary">{formatAmount(spent)}</Text>
                    </View>
                    {credits > 0 && (
                      <View className="flex-row justify-between mb-0.5">
                        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Paid back</Text>
                        <Text className="text-xs" style={{ color: sc.success }}>{"−"}{formatAmount(credits)}</Text>
                      </View>
                    )}
                    {adjNet !== 0 && (
                      <View className="flex-row justify-between mb-0.5">
                        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Adjustments</Text>
                        <Text
                          className="text-xs"
                          style={{ color: adjNet > 0 ? sc.warning : sc.success }}
                        >
                          {adjNet > 0 ? "+" : "−"}{formatAmount(Math.abs(adjNet))}
                        </Text>
                      </View>
                    )}
                    <View className="flex-row justify-between mt-1 pt-1.5 border-t border-border-light dark:border-border-dark">
                      <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary">Utilized</Text>
                      <Text className="text-xs font-bold text-text-primary dark:text-text-dark-primary">{formatAmount(outstanding)}</Text>
                    </View>

                    {/* Dues */}
                    {hasDue && (
                      <View className="flex-row items-center justify-between mt-2">
                        <View className="flex-row items-center flex-1">
                          <Ionicons name="time-outline" size={10} color={sc.danger} />
                          <Text className="text-[10px] font-bold ml-1" style={{ color: sc.danger }}>
                            Due: {formatAmount(account.total_due!)}
                          </Text>
                          {dueLabel && (
                            <Text className="text-[10px] text-text-secondary dark:text-text-dark-secondary ml-1">
                              · {dueLabel}
                            </Text>
                          )}
                          {account.min_due != null && (
                            <Text className="text-[10px] text-text-secondary dark:text-text-dark-secondary ml-1">
                              · min {formatAmount(account.min_due)}
                            </Text>
                          )}
                        </View>
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            alert(
                              "Clear Dues",
                              "Mark this card's dues as paid/resolved? This removes the overdue indicator.",
                              [
                                { text: "Cancel", style: "cancel" },
                                {
                                  text: "Clear",
                                  style: "destructive",
                                  onPress: () => clearCcDues(account.id),
                                },
                              ],
                            );
                          }}
                          hitSlop={14}
                          className="ml-2 p-1"
                          accessibilityRole="button"
                          accessibilityLabel="Clear dues"
                        >
                          <Ionicons name="close-circle-outline" size={18} color={sc.danger} />
                        </Pressable>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </Card>
          );
        })}

        {/* Empty state */}
        {ccAccounts.length === 0 && (
          <View className="items-center py-16">
            <Ionicons name="card-outline" size={48} color={colors.textSecondary} />
            <Text className="text-lg font-medium text-text-primary dark:text-text-dark-primary mt-4">
              No credit cards
            </Text>
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-1 text-center px-8">
              Credit cards will appear here once detected from SMS or added manually.
            </Text>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
