import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { InsightsPage } from "@/components/home/pages/InsightsPage";
import { ReviewQueuePage } from "@/components/home/pages/ReviewQueuePage";
import { VaultPage } from "@/components/home/pages/VaultPage";
import { SimulatorPage } from "@/components/home/pages/SimulatorPage";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { AccountPickerSheet } from "@/components/expense/AccountPickerSheet";
import { ForecastActionBar } from "@/components/expense/ForecastActionBar";
import { LinkExpenseSheet } from "@/components/expense/LinkExpenseSheet";
import { BankBalanceSummary } from "@/components/home/BankBalanceSummary";
import { CreditCardDashboard } from "@/components/home/CreditCardDashboard";
import { DematSummaryCard } from "@/components/home/DematSummaryCard";
import { VoiceEntrySheet } from "@/components/home/VoiceEntrySheet";
import { LoanSummaryCard } from "@/components/home/LoanSummaryCard";
import { MinBalanceAlert } from "@/components/home/MinBalanceAlert";
import { PensionSummaryCard } from "@/components/home/PensionSummaryCard";
import { WalletSummary } from "@/components/home/WalletSummary";
import { Card, ContextualHeader, ProgressBar, ScreenContainer, StatusPill, SwipePager } from "@/components/ui";
import type { SwipePagerPage } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { StatusColors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useForecastActions } from "@/hooks/use-forecast-actions";
import { getComputedBalances, computeUnseededBalance } from "@/services/account-balance";
import { getDatabase } from "@/database";
import { getBudgetsForMonth, getCurrentMonth } from "@/services/budget";
import { scanAllDuplicatesCached } from "@/services/duplicate-detection";
import type { Expense } from "@/services/expense";
import {
    fulfillReminder,
    getDueRecurringReminders,
    getExpenseTotal,
    getForecastExpenses,
    getOverdueForecasts,
    getPendingExpenseCount,
    getUncategorizedCount,
    skipReminderCycle,
} from "@/services/expense";
import { getFlag } from "@/services/feature-flags";
import type { FinancialAccount } from "@/services/financial-account";
import { getActiveAccounts, getCcExpenseTotals, getDematSummary } from "@/services/financial-account";
import { getHisaabSummary } from "@/services/hisaab";
import { isHomeCardVisible } from "@/services/home-card-preferences";
import { consumeHomePreload } from "@/services/home-preload";
import type { LoansSummary } from "@/services/loan-accounts";
import { getLoansSummary } from "@/services/loan-accounts";
import {
    acknowledgeBreach,
    detectBreaches,
    unacknowledgedBreaches,
} from "@/services/min-balance";
import { isArthAIEnabled } from "@/services/ai-assistant";
import { dismissBackupWarning, getFYStartMonth, shouldShowBackupWarning } from "@/services/settings";
import { getCurrentFY, getFYRange } from "@/utils/fiscal-year";
import { findAutoMatches, dismissReminderMatch, clearDismissalsForRule, pruneExpiredDismissals } from "@/services/reminder-matching";
import { getSmsScanAccountIds, isSmsDetectionEnabled, runSmsScan } from "@/services/sms";
import type { ReminderAutoMatch } from "@/services/reminder-matching";
import { ac, acAlpha } from "@/utils/accent";
import {
    getBudgetStatus,
    getBudgetStatusColor,
    getDaysRemaining,
    getMonthDateRange,
} from "@/utils/budget-helpers";
import { formatAmount, formatDateForDisplay } from "@/utils/expense-validation";
import { logger } from "@/utils/logger";

const HOME_TABS: SwipePagerPage[] = [
  { key: "overview", label: "Overview" },
  { key: "insights", label: "Insights" },
  { key: "queue", label: "Queue" },
  { key: "simulator", label: "Simulator" },
  { key: "vault", label: "Vault" },
];

const preloaded = consumeHomePreload();

// Perf (v14.8.0): when the preloader has seeded state, skip the very first
// loadData() on focus — same 12 queries would run again identically, doubling
// cold-start query fan-out. This flag lives outside the component so a re-
// mount (navigating back) still fetches fresh data.
let skipNextHomeLoad = preloaded != null;

export default function HomeScreen() {
  const router = useRouter();
  const { colorScheme, colors, accent } = useColorScheme();
  const month = getCurrentMonth();
  const { startDate, endDate } = getMonthDateRange(month);
  const daysRemaining = getDaysRemaining(month);

  const [totalSpent, setTotalSpent] = useState(preloaded?.totalSpent ?? 0);
  const [totalBudget, setTotalBudget] = useState(preloaded?.totalBudget ?? 0);
  const [pendingCount, setPendingCount] = useState(preloaded?.pendingCount ?? 0);
  const [overdueCount, setOverdueCount] = useState(preloaded?.overdueCount ?? 0);
  const [upcomingDues, setUpcomingDues] = useState<Expense[]>(preloaded?.upcomingDues ?? []);
  const [dueReminders, setDueReminders] = useState<
    Awaited<ReturnType<typeof getDueRecurringReminders>>
  >(preloaded?.dueReminders ?? []);
  const [linkSheetFor, setLinkSheetFor] = useState<{
    ruleId: string;
    description: string;
    preloadedCandidates?: Expense[];
  } | null>(null);
  const [autoMatches, setAutoMatches] = useState<ReminderAutoMatch[]>(preloaded?.autoMatches ?? []);
  const [hisaabSummary, setHisaabSummary] = useState(preloaded?.hisaabSummary ?? {
    totalOwedToYou: 0,
    totalYouOwe: 0,
    netBalance: 0,
  });
  const [duplicateCount, setDuplicateCount] = useState(preloaded?.duplicateCount ?? 0);
  const [uncategorizedCount, setUncategorizedCount] = useState(preloaded?.uncategorizedCount ?? 0);
  const [showBackupReminder, setShowBackupReminder] = useState(shouldShowBackupWarning());
  const [ccAccounts, setCcAccounts] = useState<FinancialAccount[]>(preloaded?.ccAccounts ?? []);
  const [bankAccounts, setBankAccounts] = useState<FinancialAccount[]>(preloaded?.bankAccounts ?? []);
  const [walletAccounts, setWalletAccounts] = useState<FinancialAccount[]>(preloaded?.walletAccounts ?? []);
  const [pensionAccounts, setPensionAccounts] = useState<FinancialAccount[]>(preloaded?.pensionAccounts ?? []);
  const [ccExpenseTotals, setCcExpenseTotals] = useState<Record<string, number>>(preloaded?.ccExpenseTotals ?? {});
  const [computedBalanceMap, setComputedBalanceMap] = useState<Record<string, number | null>>(preloaded?.computedBalanceMap ?? {});
  const [dematSummary, setDematSummary] = useState(preloaded?.dematSummary ?? { totalPortfolio: 0, totalFund: 0, accountCount: 0 });
  const [pensionCreditTotals, setPensionCreditTotals] = useState<Record<string, number>>(preloaded?.pensionCreditTotals ?? {});
  const [pensionLastContributionDate, setPensionLastContributionDate] = useState<string | null>(preloaded?.pensionLastContributionDate ?? null);
  const [pensionYtdContributions, setPensionYtdContributions] = useState<number>(preloaded?.pensionYtdContributions ?? 0);
  // v17.4.0 — Loans summary (home stat card + Goals entry)
  const [loansSummary, setLoansSummary] = useState<LoansSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [smsScanning, setSmsScanning] = useState(false);
  const [activeHomeIndex, setActiveHomeIndex] = useState(0);
  const [visitedHomePages, setVisitedHomePages] = useState(new Set([0]));
  const handleHomeIndexChange = useCallback((idx: number) => {
    setActiveHomeIndex(idx);
    setVisitedHomePages((prev) => new Set([...prev, idx]));
  }, []);

  const handleHomeScan = useCallback(async () => {
    if (smsScanning) return;
    setSmsScanning(true);
    try {
      const accountIds = getSmsScanAccountIds();
      await runSmsScan({ manual: true, accountIds });
    } finally {
      setSmsScanning(false);
    }
  }, [smsScanning]);

  // Collapsible sections — closed by default
  const [duesOpen, setDuesOpen] = useState(false);

  const loadData = useCallback(async (source?: "focus" | "data-version") => {
    // Perf (v14.8.0): preloader already ran the same 12 queries; skip the
    // very first focus-triggered load only. v17.5.0 fix: data-version
    // triggers (SMS scan creating new pending_review expenses, smart-rules
    // re-categorising, etc) MUST NOT be skipped — those carry fresh data
    // the preloader couldn't possibly have captured. Without this guard
    // the Home Action Required card stayed stale until user manually
    // reloaded (bug surfaced after v17.4.0).
    if (skipNextHomeLoad && source !== "data-version") {
      skipNextHomeLoad = false;
      return;
    }
    // If we got here via data-version, the preloader-skip no longer applies.
    skipNextHomeLoad = false;
    try {
      const today = new Date().toISOString().split("T")[0];
      pruneExpiredDismissals();
      const [budgets, total, pending, hisaab, overdue, forecasts, dupScan, allAccounts, ccTotals, uncatCount, dematSum, reminders, matches] = await Promise.all([
        getBudgetsForMonth(DEFAULT_USER_ID, month),
        getExpenseTotal(DEFAULT_USER_ID, startDate, endDate),
        getPendingExpenseCount(DEFAULT_USER_ID),
        getHisaabSummary(DEFAULT_USER_ID),
        getOverdueForecasts(DEFAULT_USER_ID, today),
        getForecastExpenses(DEFAULT_USER_ID),
        scanAllDuplicatesCached(DEFAULT_USER_ID),
        getActiveAccounts(DEFAULT_USER_ID),
        getCcExpenseTotals(DEFAULT_USER_ID, startDate, endDate),
        getUncategorizedCount(DEFAULT_USER_ID),
        getDematSummary(DEFAULT_USER_ID),
        getDueRecurringReminders(DEFAULT_USER_ID),
        findAutoMatches(DEFAULT_USER_ID).catch(() => [] as ReminderAutoMatch[]),
      ]);

      // Await the second-phase query BEFORE any setState so that React 18
      // auto-batching covers every update in a single render pass. The
      // previous structure interleaved awaits with setStates, splitting
      // into two render cycles — on Android this produced a mid-flight
      // touch responder rebind that ate the first tap on hero cards
      // until the user scrolled to force a re-layout.
      const allIds = allAccounts.map((a) => a.id);
      const balances = await getComputedBalances(allIds);

      const pensionAccts = allAccounts.filter((a) => a.account_type === "pension");
      for (const p of pensionAccts) {
        if (balances[p.id] === null || balances[p.id] === undefined) {
          const unseeded = await computeUnseededBalance(p.id, month);
          balances[p.id] = unseeded.closing;
        }
      }

      const activeDues = forecasts.filter(
        (f) => f.due_date && f.status !== "rejected",
      );
      const backupReminder = shouldShowBackupWarning();

      // v17.4.0 — load loans summary for the home stat card (non-blocking)
      try {
        const summary = await getLoansSummary(DEFAULT_USER_ID);
        setLoansSummary(summary);
      } catch (e) {
        logger.warn("getLoansSummary failed (non-fatal)", e);
        setLoansSummary(null);
      }

      // All setStates below run synchronously in one batch.
      setDueReminders(reminders);
      setAutoMatches(matches);
      setTotalSpent(total);
      setTotalBudget(budgets.reduce((sum, b) => sum + b.amount, 0));
      setPendingCount(pending);
      setOverdueCount(overdue.length);
      setUpcomingDues(activeDues);
      setHisaabSummary(hisaab);
      setDuplicateCount(dupScan.duplicateGroupCount);
      setUncategorizedCount(uncatCount);
      setShowBackupReminder(backupReminder);
      setCcAccounts(allAccounts.filter((a) => a.account_type === "credit_card"));
      setBankAccounts(allAccounts.filter((a) => a.account_type === "savings"));
      setWalletAccounts(allAccounts.filter((a) => a.account_type === "wallet"));
      setPensionAccounts(pensionAccts);
      setCcExpenseTotals(ccTotals);
      setComputedBalanceMap(balances);
      setDematSummary(dematSum);

      // Calculate pension contribution metrics
      const pensionCreditTotalsMap: Record<string, number> = {};
      let lastContributionDate: string | null = null;
      let ytdCredits = 0;

      const fyStartMonth = getFYStartMonth();
      const fy = getCurrentFY(fyStartMonth);
      const fyRange = getFYRange(fy, fyStartMonth);
      const fyStart = `${fyRange.start.getFullYear()}-${String(fyRange.start.getMonth() + 1).padStart(2, "0")}-01`;

      for (const acct of pensionAccts) {
        if (acct.last_balance_date && (!lastContributionDate || acct.last_balance_date > lastContributionDate)) {
          lastContributionDate = acct.last_balance_date;
        }
      }

      if (pensionAccts.length > 0) {
        const db = getDatabase();
        const ids = pensionAccts.map((a) => a.id);
        const ph = ids.map(() => "?").join(",");

        const [monthRows, ytdRows] = await Promise.all([
          db.getAllAsync<{ account_id: string; total: number }>(
            `SELECT account_id, COALESCE(SUM(amount), 0) AS total
             FROM expenses WHERE account_id IN (${ph}) AND deleted_at IS NULL
               AND nature = 'credit' AND status = 'approved'
               AND date >= ? AND date <= ?
             GROUP BY account_id`,
            ...ids, startDate, endDate,
          ),
          db.getAllAsync<{ account_id: string; total: number }>(
            `SELECT account_id, COALESCE(SUM(amount), 0) AS total
             FROM expenses WHERE account_id IN (${ph}) AND deleted_at IS NULL
               AND nature = 'credit' AND status = 'approved'
               AND date >= ? AND date <= ?
             GROUP BY account_id`,
            ...ids, fyStart, today,
          ),
        ]);

        for (const r of monthRows) pensionCreditTotalsMap[r.account_id] = r.total;
        for (const r of ytdRows) ytdCredits += r.total;
      }

      setPensionCreditTotals(pensionCreditTotalsMap);
      setPensionLastContributionDate(lastContributionDate);
      setPensionYtdContributions(ytdCredits);
    } catch {
      // DB not ready
    }
  }, [month, startDate, endDate]);

  useDataRefresh(loadData);

  // Forecast lifecycle actions (shared hook)
  const {
    handleMarkPaid: handleForecastMarkPaid,
    handleRealise: handleForecastRealise,
    handleDelete: handleForecastDelete,
    handleRepaymentPaid: handleForecastRepaymentPaid,
    handlePaidExternally: handleForecastPaidExternally,
    handleAccountSelected,
    handleAccountPickerClose,
    accountPickerVisible,
  } = useForecastActions(loadData, setUpcomingDues);

  const remaining = totalBudget - totalSpent;
  const overallStatus = getBudgetStatus(totalSpent, totalBudget);
  const statusColor = getBudgetStatusColor(overallStatus);
  const budgetPct = totalBudget > 0 ? totalSpent / totalBudget : 0;

  // v15.5: Savings min-balance alerts. Filter down to unacknowledged-for-
  // this-month. Flag-gated — OFF means nothing renders. Recomputes when
  // the account list / balance map change, so as soon as a credit pushes
  // the balance back above min, the alert disappears.
  const [dismissTick, setDismissTick] = useState(0);
  const minBalanceBreaches = useMemo(() => {
    if (!getFlag("v15_min_balance_alert")) return [];
    const all = detectBreaches(bankAccounts, computedBalanceMap);
    return unacknowledgedBreaches(all, month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankAccounts, computedBalanceMap, month, dismissTick]);

  const handleDismissBreach = useCallback((accountId: string) => {
    acknowledgeBreach(accountId, month);
    setDismissTick((t) => t + 1);
  }, [month]);

  const healthLabel =
    overallStatus === "under" ? "On Track" :
    overallStatus === "warning" ? "Watch Spending" : "Over Budget";

  const [showVoiceSheet, setShowVoiceSheet] = useState(false);

  const smsScanIcon: "sync-outline" | "scan-outline" = smsScanning ? "sync-outline" : "scan-outline";
  const homeHeaderActions = [
    ...(isArthAIEnabled() ? [{
      icon: "sparkles-outline" as const,
      onPress: () => router.push("/ai-chat" as never),
      color: colors.tint,
    }] : []),
    { icon: "mic-outline" as const, onPress: () => setShowVoiceSheet(true) },
    ...(isSmsDetectionEnabled() ? [{
      icon: smsScanIcon,
      onPress: handleHomeScan,
      disabled: smsScanning,
    }] : []),
  ];

  return (
    <ScreenContainer>
      <ContextualHeader
        title="Arth · अर्थ"
        rightActions={homeHeaderActions}
      />
      <SwipePager
        pages={HOME_TABS}
        activeIndex={activeHomeIndex}
        onIndexChange={handleHomeIndexChange}
      >
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 80 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await loadData();
                setRefreshing(false);
              }}
            />
          }
        >
        {/* Stale backup warning */}
        {showBackupReminder && (
          <Pressable
            onPress={() => router.push("/settings/backup-restore")}
            className="mx-4 mb-3 p-3 rounded-xl flex-row items-center"
            style={{ backgroundColor: StatusColors[colorScheme].warning + "1A" }}
          >
            <Ionicons name="shield-outline" size={20} color={StatusColors[colorScheme].warning} />
            <View className="flex-1 ml-3">
              <Text className="text-sm font-semibold" style={{ color: StatusColors[colorScheme].warning }}>
                Back up your data
              </Text>
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                No backup for 30+ days. Tap to create one.
              </Text>
            </View>
            <Pressable
              onPress={() => {
                dismissBackupWarning();
                setShowBackupReminder(false);
              }}
              hitSlop={10}
              accessibilityLabel="Dismiss backup reminder"
            >
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </Pressable>
          </Pressable>
        )}

        {/* v15.5: Savings min-balance breach alerts (one per breached account) */}
        {isHomeCardVisible("min_balance_alert") && minBalanceBreaches.map((breach) => (
          <MinBalanceAlert
            key={breach.account.id}
            breach={breach}
            onDismiss={handleDismissBreach}
          />
        ))}

        {/* Action Required Card — unified review queue entry */}
        {isHomeCardVisible("review_queue") && (pendingCount > 0 || duplicateCount > 0 || uncategorizedCount > 0) && (() => {
          const totalActionItems = pendingCount + duplicateCount + uncategorizedCount;
          const lines: { label: string; count: number; icon: keyof typeof Ionicons.glyphMap }[] = [];
          if (pendingCount > 0) lines.push({ label: "pending review", count: pendingCount, icon: "swap-horizontal-outline" });
          if (overdueCount > 0) lines.push({ label: "overdue", count: overdueCount, icon: "alert-circle-outline" });
          if (duplicateCount > 0) lines.push({ label: "possible duplicate" + (duplicateCount !== 1 ? "s" : ""), count: duplicateCount, icon: "copy-outline" });
          if (uncategorizedCount > 0) lines.push({ label: "uncategorized", count: uncategorizedCount, icon: "help-circle-outline" });

          return (
            <Pressable
              onPress={() => router.push("/expense/review-queue")}
              accessibilityLabel={`${totalActionItems} items need action`}
              accessibilityRole="button"
            >
              <Card className="mx-4 mt-3">
                <View className="flex-row items-center justify-between mb-2">
                  <View className="flex-row items-center">
                    <View className="w-9 h-9 rounded-full items-center justify-center mr-3" style={{ backgroundColor: ac(accent, colorScheme, 100, 800) }}>
                      <Ionicons name="clipboard-outline" size={18} color={ac(accent, colorScheme, 500, 300)} />
                    </View>
                    <View>
                      <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                        Action Required
                      </Text>
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                        Tap to review and resolve
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row items-center">
                    <StatusPill label={`${totalActionItems}`} color={ac(accent, colorScheme, 500, 300)} />
                    <Ionicons name="chevron-forward" size={16} color={ac(accent, colorScheme, 300, 500)} style={{ marginLeft: 6 }} />
                  </View>
                </View>
                {lines.map((line) => (
                  <View key={line.label} className="flex-row items-center ml-12 mb-0.5">
                    <Ionicons name={line.icon} size={12} color={ac(accent, colorScheme, 400, 400)} style={{ marginRight: 6 }} />
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                      {line.count} {line.label}
                    </Text>
                  </View>
                ))}
              </Card>
            </Pressable>
          );
        })()}

        {/* Budget Health Card */}
        {isHomeCardVisible("total_spent") && (
          <Pressable onPress={() => router.push("/(tabs)/budget")}>
          <Card className="mx-4 mt-3">
            <View className="flex-row items-center justify-between mb-3">
              <View>
                <Text className="text-xs text-text-tertiary dark:text-text-dark-secondary">Total Spent</Text>
                <Text className="text-2xl font-bold text-text-primary dark:text-text-dark-primary">
                  {formatAmount(totalSpent)}
                </Text>
              </View>
              <StatusPill label={healthLabel} color={statusColor} />
            </View>

            {totalBudget > 0 && (
              <>
                <ProgressBar value={budgetPct} color={statusColor} height={8} animated />
                <View className="flex-row justify-between mt-2">
                  <Text
                    className="text-xs font-semibold"
                    style={{ color: remaining >= 0 ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger }}
                  >
                    {remaining >= 0
                      ? `${formatAmount(remaining)} remaining`
                      : `${formatAmount(Math.abs(remaining))} over`}
                  </Text>
                  <Text className="text-xs text-text-tertiary dark:text-text-dark-secondary">
                    {daysRemaining} days left
                  </Text>
                </View>
              </>
            )}

            {totalBudget === 0 && (
              <Pressable
                onPress={() => router.push("/settings/budget-config")}
                accessibilityLabel="Set up your budget"
                accessibilityRole="button"
                className="mt-1 py-2 rounded-lg items-center"
                style={{ backgroundColor: ac(accent, colorScheme, 50, 700) }}
              >
                <Text className="text-xs font-semibold" style={{ color: ac(accent, colorScheme, 500, 200) }}>
                  Set up your budget
                </Text>
              </Pressable>
            )}

          </Card>
          </Pressable>
        )}

        {/* Recurring reminders — pending/overdue with auto-match suggestions. */}
        {isHomeCardVisible("reminders") && dueReminders.length > 0 && (
          <Card className="mx-4 mt-3">
            <View className="flex-row items-center mb-2">
              <Ionicons name="repeat-outline" size={18} color={accent[500]} />
              <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary ml-2">
                Reminders
              </Text>
              <View className="ml-2 px-1.5 py-0.5 rounded-full" style={{ backgroundColor: accent[500] + "1A" }}>
                <Text className="text-xs font-bold" style={{ color: ac(accent, colorScheme, 600, 300) }}>
                  {dueReminders.length}
                </Text>
              </View>
              {autoMatches.length > 0 && (
                <View className="ml-1.5 px-1.5 py-0.5 rounded-full" style={{ backgroundColor: StatusColors[colorScheme].success + "22" }}>
                  <Text className="text-xs font-bold" style={{ color: StatusColors[colorScheme].success }}>
                    {autoMatches.length} matched
                  </Text>
                </View>
              )}
            </View>
            {dueReminders.map((r, i) => {
              const description =
                r.source?.description ?? r.source?.merchant_name ?? "Recurring";
              const isOverdue = r.state === "overdue";
              const last = r.lastFulfillment;
              const match = autoMatches.find((m) => m.ruleId === r.rule.id);
              const hasSingleMatch = match?.matches.length === 1;
              const hasMultipleMatches = (match?.matches.length ?? 0) > 1;
              const matchedExpense = hasSingleMatch ? match!.matches[0] : null;

              return (
                <View
                  key={r.rule.id}
                  className={`py-2 ${i < dueReminders.length - 1 ? "border-b border-border-light dark:border-border-dark" : ""}`}
                >
                  {/* Row header: name + due date + action button */}
                  <View className="flex-row items-center justify-between">
                    <Pressable
                      className="flex-1 mr-2"
                      onPress={() => router.push(`/settings/recurring-rule-detail?ruleId=${r.rule.id}` as never)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open reminder details for ${description}`}
                    >
                      <Text
                        className="text-sm text-text-primary dark:text-text-dark-primary"
                        numberOfLines={1}
                      >
                        {description}
                      </Text>
                      <Text
                        className="text-[11px] mt-0.5"
                        style={{
                          color: isOverdue
                            ? StatusColors[colorScheme].danger
                            : StatusColors[colorScheme].warning,
                        }}
                      >
                        {isOverdue
                          ? `Was due ${r.rule.next_due_date}`
                          : `Due ${r.rule.next_due_date === new Date().toISOString().slice(0, 10) ? "today" : "tomorrow"}`}
                        {last ? ` · Last paid ${last.cycle_due_date}` : ""}
                      </Text>
                    </Pressable>

                    {/* State C — multiple matches → "Review" opens sheet */}
                    {hasMultipleMatches && (
                      <Pressable
                        onPress={() => setLinkSheetFor({
                          ruleId: r.rule.id,
                          description,
                          preloadedCandidates: match!.matches,
                        })}
                        accessibilityRole="button"
                        className="px-3 py-1.5 rounded-lg flex-row items-center"
                        style={{ backgroundColor: StatusColors[colorScheme].success + "22" }}
                      >
                        <Text className="text-xs font-semibold mr-1" style={{ color: StatusColors[colorScheme].success }}>
                          {match!.matches.length} matches
                        </Text>
                        <Ionicons name="chevron-forward" size={12} color={StatusColors[colorScheme].success} />
                      </Pressable>
                    )}

                    {/* State B — no match → Link + Skip */}
                    {!match && (
                      <View className="flex-row items-center" style={{ gap: 6 }}>
                        <Pressable
                          onPress={async () => {
                            try {
                              await skipReminderCycle(r.rule.id);
                              await loadData();
                            } catch (e) {
                              logger.warn("Skip reminder failed", e);
                            }
                          }}
                          accessibilityRole="button"
                          accessibilityLabel="Skip this reminder cycle"
                          className="px-3 py-1.5 rounded-lg border"
                          style={{ borderColor: colors.border }}
                        >
                          <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary">Skip</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setLinkSheetFor({ ruleId: r.rule.id, description })}
                          accessibilityRole="button"
                          accessibilityLabel="Link expense to this reminder"
                          className="px-3 py-1.5 rounded-lg"
                          style={{ backgroundColor: accent[500] }}
                        >
                          <Text className="text-xs font-semibold text-white">Link</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>

                  {/* State A — single match → inline approve/dismiss row */}
                  {hasSingleMatch && matchedExpense && (
                    <View
                      className="flex-row items-center mt-2 px-2 py-1.5 rounded-lg"
                      style={{ backgroundColor: StatusColors[colorScheme].success + "12" }}
                    >
                      <Ionicons name="checkmark-circle" size={14} color={StatusColors[colorScheme].success} />
                      <View className="flex-1 mx-2">
                        <Text className="text-xs font-medium text-text-primary dark:text-text-dark-primary" numberOfLines={1}>
                          {matchedExpense.merchant_name ?? matchedExpense.description ?? "Expense"} · {matchedExpense.date}
                        </Text>
                        <Text className="text-[11px]" style={{ color: StatusColors[colorScheme].success }}>
                          {formatAmount(matchedExpense.amount)}
                        </Text>
                      </View>
                      <Pressable
                        onPress={async () => {
                          const ruleId = r.rule.id;
                          const expenseId = matchedExpense.id;
                          setAutoMatches((prev) => prev.filter((m) => m.ruleId !== ruleId));
                          try {
                            await fulfillReminder(ruleId, expenseId);
                            clearDismissalsForRule(ruleId);
                            await loadData();
                          } catch (e) {
                            logger.warn("Auto-match approve failed", e);
                            await loadData();
                          }
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Approve match"
                        className="px-2.5 py-1 rounded-md mr-1.5"
                        style={{ backgroundColor: StatusColors[colorScheme].success }}
                      >
                        <Text className="text-xs font-semibold text-white">Approve</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          dismissReminderMatch(r.rule.id, matchedExpense.id);
                          setAutoMatches((prev) =>
                            prev
                              .map((m) =>
                                m.ruleId === r.rule.id
                                  ? { ...m, matches: m.matches.filter((e) => e.id !== matchedExpense.id) }
                                  : m,
                              )
                              .filter((m) => m.matches.length > 0),
                          );
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Dismiss match"
                        hitSlop={8}
                      >
                        <Ionicons name="close" size={16} color={colors.textSecondary} />
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </Card>
        )}

        {/* Upcoming Dues — collapsible */}
        {isHomeCardVisible("upcoming_dues") && upcomingDues.length > 0 && (
          <View>
          <Card className="mx-4 mt-3">
            <Pressable
              onPress={() => setDuesOpen(!duesOpen)}
              accessibilityLabel={`${duesOpen ? "Collapse" : "Expand"} upcoming dues`}
              accessibilityRole="button"
              className="flex-row items-center justify-between"
            >
              <View className="flex-row items-center flex-1">
                <Ionicons name="time-outline" size={18} color={StatusColors[colorScheme].warning} />
                <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary ml-2">
                  Upcoming Dues
                </Text>
                <View className="ml-2 px-1.5 py-0.5 rounded-full bg-[#F59E0B14]">
                  <Text className="text-xs font-bold" style={{ color: StatusColors[colorScheme].warning }}>
                    {upcomingDues.length}
                  </Text>
                </View>
              </View>
              <View className="flex-row items-center">
                <Text className="text-sm font-semibold mr-2" style={{ color: StatusColors[colorScheme].warning }}>
                  {formatAmount(upcomingDues.reduce((s, f) => s + f.amount, 0))}
                </Text>
                <Ionicons
                  name={duesOpen ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={colors.textSecondary}
                />
              </View>
            </Pressable>
            {duesOpen && (
              <>
                {upcomingDues.slice(0, 4).map((f) => {
                  const today = new Date().toISOString().split("T")[0];
                  const isOverdue = f.due_date != null && f.due_date < today;
                  return (
                    <View key={f.id} className="border-t border-border-light dark:border-border-dark">
                      <Pressable
                        onPress={() => router.push(`/expense/${f.id}`)}
                        accessibilityLabel={`${f.description || f.merchant_name || "Upcoming expense"}, ${formatAmount(f.amount)}`}
                        accessibilityRole="button"
                        className="flex-row items-center py-2"
                      >
                        <View
                          className="w-7 h-7 rounded-full items-center justify-center mr-2.5"
                          style={{ backgroundColor: isOverdue ? "#EF444414" : "#F59E0B14" }}
                        >
                          <Ionicons
                            name={isOverdue ? "alert-circle" : "time-outline"}
                            size={14}
                            color={isOverdue ? StatusColors[colorScheme].danger : StatusColors[colorScheme].warning}
                          />
                        </View>
                        <View className="flex-1">
                          <Text
                            className="text-sm text-text-primary dark:text-text-dark-primary"
                            numberOfLines={1}
                          >
                            {f.description || f.merchant_name || "Upcoming expense"}
                          </Text>
                          <Text className="text-xs text-text-tertiary dark:text-text-dark-secondary">
                            {isOverdue ? "Overdue" : "Due"}: {formatDateForDisplay(f.due_date!)}
                          </Text>
                        </View>
                        <Text
                          className="text-sm font-semibold"
                          style={{ color: isOverdue ? StatusColors[colorScheme].danger : StatusColors[colorScheme].warning }}
                        >
                          {formatAmount(f.amount)}
                        </Text>
                      </Pressable>
                      <ForecastActionBar
                        forecastId={f.id}
                        forecastType={f.forecast_type}
                        compact
                        onMarkAsPaid={handleForecastMarkPaid}
                        onRealiseNow={handleForecastRealise}
                        onDelete={handleForecastDelete}
                        onRepaymentPaid={handleForecastRepaymentPaid}
                        onPaidExternally={handleForecastPaidExternally}
                      />
                    </View>
                  );
                })}
                {upcomingDues.length > 4 && (
                  <Pressable
                    onPress={() => router.push("/expense/review-queue")}
                    accessibilityLabel={`View all ${upcomingDues.length} dues`}
                    accessibilityRole="button"
                    className="pt-2 items-center"
                  >
                    <Text className="text-xs font-medium" style={{ color: accent[500] }}>
                      +{upcomingDues.length - 4} more - view all
                    </Text>
                  </Pressable>
                )}
              </>
            )}
          </Card>
          </View>
        )}



        {/* ── People & Money ── */}
        <View className="mx-4 mt-5 mb-1">
          <Text className="text-xs font-semibold uppercase tracking-wider text-text-tertiary dark:text-text-dark-secondary">
            People & Money
          </Text>
        </View>

        {/* Hisaab Quick Access */}
        {isHomeCardVisible("hisaab") && <View>
        <Pressable onPress={() => router.push("/hisaab/persons")} accessibilityLabel="Open Hisaab family ledger" accessibilityRole="button">
          <Card className="mx-4 mt-2">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: accent[500] + '14' }}>
                  <Ionicons name="people-outline" size={20} color={colors.blue} />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                    Hisaab - Family Ledger
                  </Text>
                  {hisaabSummary.netBalance !== 0 ? (
                    <View className="flex-row items-center mt-0.5">
                      {hisaabSummary.totalOwedToYou > 0 && (
                        <Text className="text-xs text-success mr-3">
                          +{formatAmount(hisaabSummary.totalOwedToYou)} owed
                        </Text>
                      )}
                      {hisaabSummary.totalYouOwe > 0 && (
                        <Text className="text-xs text-danger">
                          -{formatAmount(hisaabSummary.totalYouOwe)} you owe
                        </Text>
                      )}
                    </View>
                  ) : (
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                      Track shared expenses with family & friends
                    </Text>
                  )}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </View>
          </Card>
        </Pressable>
        </View>}

        {/* ── Your Accounts ── */}
        {(ccAccounts.length > 0 || bankAccounts.length > 0 || walletAccounts.length > 0 || dematSummary.accountCount > 0 || (loansSummary && loansSummary.activeCount > 0)) && (
          <View className="mx-4 mt-5 mb-1">
            <Text className="text-xs font-semibold uppercase tracking-wider text-text-tertiary dark:text-text-dark-secondary">
              Your Accounts
            </Text>
          </View>
        )}
        {isHomeCardVisible("credit_cards") && (
          <CreditCardDashboard accounts={ccAccounts} expenseTotals={ccExpenseTotals} computedBalances={computedBalanceMap} />
        )}
        {isHomeCardVisible("bank_balances") && (
          <BankBalanceSummary accounts={bankAccounts} />
        )}
        {isHomeCardVisible("wallets") && (
          <WalletSummary accounts={walletAccounts} />
        )}
        {isHomeCardVisible("demat") && (
          <DematSummaryCard totalPortfolio={dematSummary.totalPortfolio} totalFund={dematSummary.totalFund} accountCount={dematSummary.accountCount} />
        )}
        {isHomeCardVisible("pension") && (
          <PensionSummaryCard accounts={pensionAccounts} computedBalances={computedBalanceMap} creditTotals={pensionCreditTotals} lastContributionDate={pensionLastContributionDate} ytdContributions={pensionYtdContributions} />
        )}
        {isHomeCardVisible("loans") && loansSummary && loansSummary.activeCount > 0 && (
          <LoanSummaryCard summary={loansSummary} />
        )}

        </ScrollView>

        {visitedHomePages.has(1) ? <InsightsPage /> : <View style={{ flex: 1 }} />}
        {visitedHomePages.has(2) ? <ReviewQueuePage /> : <View style={{ flex: 1 }} />}
        {visitedHomePages.has(3) ? <SimulatorPage /> : <View style={{ flex: 1 }} />}
        {visitedHomePages.has(4) ? <VaultPage /> : <View style={{ flex: 1 }} />}
      </SwipePager>

      <AccountPickerSheet
        visible={accountPickerVisible}
        onSelect={handleAccountSelected}
        onClose={handleAccountPickerClose}
        title="Pay from which account?"
      />

      {/* Recurring-reminder link sheet. Picked expense → fulfillReminder. */}
      {linkSheetFor && (
        <LinkExpenseSheet
          visible={true}
          ruleId={linkSheetFor.ruleId}
          ruleDescription={linkSheetFor.description}
          preloadedCandidates={linkSheetFor.preloadedCandidates}
          onPickExisting={async (expenseId) => {
            const ruleId = linkSheetFor.ruleId;
            setLinkSheetFor(null);
            try {
              await fulfillReminder(ruleId, expenseId);
              clearDismissalsForRule(ruleId);
              await loadData();
            } catch (e) {
              // Alerts for failures handled elsewhere; log-and-continue here.
              logger.warn("Couldn't link expense", e);
            }
          }}
          onLogNew={() => {
            const ruleId = linkSheetFor.ruleId;
            setLinkSheetFor(null);
            router.push({
              pathname: "/expense/add",
              params: { fulfillsReminderId: ruleId },
            });
          }}
          onClose={() => setLinkSheetFor(null)}
        />
      )}
      <VoiceEntrySheet visible={showVoiceSheet} onClose={() => setShowVoiceSheet(false)} />
    </ScreenContainer>
  );
}
