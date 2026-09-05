import { useState, useCallback, useRef } from "react";

import { logger } from "@/utils/logger";
import { View, ScrollView, Pressable, Keyboard, RefreshControl } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, DateInput, Input, PeriodNavigator, ScreenContainer, Text } from "@/components/ui";
import { BalanceSourceCard } from "@/components/account/BalanceSourceCard";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";

import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getAccountWithModes,
  getAllPaymentModes,
  addPaymentModeToAccount,
  removePaymentModeFromAccount,
  updateAccountLabel,
} from "@/services/account-master";
import type { PaymentMode, AccountWithModes } from "@/services/account-master";
import {
  deactivateAccount,
  closeAccount,
  reopenAccount,
  updateAccountFinancials,
  updateAccountType,
  getActiveAccounts,
  getLatestSnapshot,
  getLatestFundSnapshot,
  getSnapshotCountForAccount,
} from "@/services/financial-account";
import type { FinancialAccount, AccountType } from "@/services/financial-account";
import {
  getMonthBalanceSummary,
  seedOpeningBalance,
  adjustOpeningBalance,
  deleteOpeningAdjustment,
  hasOpeningAdjustment,
  isAccountSeeded,
  getAccountAdjustmentAbsTotal,
} from "@/services/account-balance";
import type { MonthBalanceSummary } from "@/services/account-balance";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { formatAmount } from "@/utils/format";
import { useTheme } from "@/hooks/use-theme";

const ACCOUNT_TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  savings: "wallet-outline",
  credit_card: "card-outline",
  loan: "document-text-outline",
  wallet: "phone-portrait-outline",
  demat: "trending-up-outline",
  pension: "briefcase-outline",
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  savings: "Savings",
  credit_card: "Credit Card",
  loan: "Loan",
  wallet: "Wallet",
  demat: "Demat",
  pension: "Pension",
};

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function AccountDetailScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  const scrollRef = useRef<ScrollView>(null);

  const [data, setData] = useState<AccountWithModes | null>(null);
  const [allModes, setAllModes] = useState<PaymentMode[]>([]);
  const [siblingCards, setSiblingCards] = useState<FinancialAccount[]>([]);
  const [ledgerMonth, setLedgerMonth] = useState(getCurrentMonth());
  const [ledgerSummary, setLedgerSummary] = useState<MonthBalanceSummary | null>(null);
  const [seeded, setSeeded] = useState(false);

  // Edit state
  const [labelValue, setLabelValue] = useState("");
  // v15.5: savings min-balance alert threshold (rendered only for savings)
  const [minBalanceValue, setMinBalanceValue] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("savings");
  const [creditLimitValue, setCreditLimitValue] = useState("");
  const [balanceValue, setBalanceValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Seed state (for first-time balance setup)
  const [seedBalance, setSeedBalance] = useState("");
  const [seedMonth, setSeedMonth] = useState(getCurrentMonth());

  // Opening balance override
  const [editingMonth, setEditingMonth] = useState<string | null>(null);
  const [editingOpeningValue, setEditingOpeningValue] = useState("");
  const [adjustedMonths, setAdjustedMonths] = useState<Record<string, boolean>>({});
  const [adjustmentStats, setAdjustmentStats] = useState<{ total: number; count: number }>({ total: 0, count: 0 });

  // Demat-specific state
  const [dematLatestValue, setDematLatestValue] = useState<number | null>(null);
  const [dematLatestFund, setDematLatestFund] = useState<number | null>(null);
  const [dematLatestDate, setDematLatestDate] = useState<string | null>(null);
  const [dematSnapshotCount, setDematSnapshotCount] = useState(0);

  const loadData = useCallback(async () => {
    if (!accountId) return;
    try {
      const [acctData, modes, allAccounts] = await Promise.all([
        getAccountWithModes(accountId),
        getAllPaymentModes(DEFAULT_USER_ID),
        getActiveAccounts(DEFAULT_USER_ID),
      ]);
      if (!acctData) return;

      setData(acctData);
      setAllModes(modes);

      // Find sibling CC cards from same bank (shared credit limit)
      if (acctData.account.account_type === "credit_card") {
        const siblings = allAccounts.filter(
          (a) =>
            a.id !== accountId &&
            a.account_type === "credit_card" &&
            a.bank_name === acctData.account.bank_name,
        );
        setSiblingCards(siblings);
      } else {
        setSiblingCards([]);
      }

      // Initialize edit values
      const acct = acctData.account;
      setAccountType(acct.account_type as AccountType);
      setLabelValue(acct.account_label ?? "");
      setCreditLimitValue(
        acct.credit_limit != null ? String(acct.credit_limit) : "",
      );
      setBalanceValue(
        acct.last_known_balance != null ? String(acct.last_known_balance) : "",
      );
      // v15.5: min-balance — default 0 means feature off for this account
      setMinBalanceValue(
        acct.min_balance != null && acct.min_balance > 0 ? String(acct.min_balance) : "",
      );
      setDirty(false);

      // Load balance ledger (for non-demat types)
      if (acct.account_type !== "demat") {
        const hasLedger = await isAccountSeeded(accountId);
        setSeeded(hasLedger);
        if (hasLedger) {
          const summary = await getMonthBalanceSummary(accountId, ledgerMonth);
          setLedgerSummary(summary);
          const hasAdj = await hasOpeningAdjustment(accountId, ledgerMonth);
          setAdjustedMonths((prev) => ({ ...prev, [ledgerMonth]: hasAdj }));
          const { startDate, endDate } = getMonthDateRange(ledgerMonth);
          const adjStats = await getAccountAdjustmentAbsTotal(accountId, startDate, endDate);
          setAdjustmentStats(adjStats);
        }
      }

      // Load demat-specific data
      if (acct.account_type === "demat") {
        const [latest, latestFund, count] = await Promise.all([
          getLatestSnapshot(accountId),
          getLatestFundSnapshot(accountId),
          getSnapshotCountForAccount(accountId),
        ]);
        setDematLatestValue(latest?.portfolio_value ?? null);
        setDematLatestFund(latestFund?.fund_value ?? null);
        setDematLatestDate(latest?.snapshot_date ?? null);
        setDematSnapshotCount(count);
      }
    } catch (e) {
      logger.warn("account-detail load failed", e);
    }
  }, [accountId, ledgerMonth]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const account = data?.account;
  const linkedModes = data?.linkedModes ?? [];
  const linkedModeIds = new Set(linkedModes.map((m) => m.id));

  const headerTitle = account
    ? `${account.bank_name} ****${account.account_identifier}`
    : "Account";

  const handleSave = useCallback(async () => {
    if (!account) return;
    setSaving(true);
    try {
      const trimmedLabel = labelValue.trim();
      const currentLabel = account.account_label ?? "";
      if (trimmedLabel !== currentLabel) {
        await updateAccountLabel(account.id, trimmedLabel || null);
      }

      // Update account type if changed
      if (accountType !== account.account_type) {
        await updateAccountType(account.id, accountType);
      }

      if (accountType === "credit_card") {
        const cl = creditLimitValue.trim()
          ? parseFloat(creditLimitValue.replace(/,/g, ""))
          : null;
        await updateAccountFinancials(account.id, {
          credit_limit: cl != null && !isNaN(cl) && cl >= 0 ? cl : undefined,
        });
      }

      // v15.5: min-balance is savings-only. 0 or empty = feature off.
      if (accountType === "savings") {
        const mb = minBalanceValue.trim()
          ? parseFloat(minBalanceValue.replace(/,/g, ""))
          : 0;
        const safe = !isNaN(mb) && mb >= 0 ? mb : 0;
        await updateAccountFinancials(account.id, { min_balance: safe });
      }

      setDirty(false);
      loadData();
    } finally {
      setSaving(false);
    }
  }, [account, accountType, labelValue, creditLimitValue, minBalanceValue, loadData]);

  const handleSeedBalance = useCallback(async () => {
    if (!accountId) return;
    const amount = parseFloat(seedBalance.replace(/,/g, ""));
    if (isNaN(amount) || amount < 0) return;
    await seedOpeningBalance(accountId, seedMonth, amount);
    // Seed sibling cards with same starting balance (shared credit limit)
    if (accountType === "credit_card" && siblingCards.length > 0) {
      for (const sibling of siblingCards) {
        const alreadySeeded = await isAccountSeeded(sibling.id);
        if (!alreadySeeded) {
          await seedOpeningBalance(sibling.id, seedMonth, amount);
        }
      }
    }
    setSeedBalance("");
    loadData();
  }, [accountId, seedBalance, seedMonth, accountType, siblingCards, loadData]);

  const handleOverrideOpening = useCallback(async (month: string) => {
    if (!accountId) return;
    const amount = parseFloat(editingOpeningValue.replace(/,/g, ""));
    if (isNaN(amount) || amount < 0) {
      setEditingMonth(null);
      return;
    }
    await adjustOpeningBalance({
      accountId,
      userId: DEFAULT_USER_ID,
      month,
      desiredOpening: amount,
    });
    setEditingMonth(null);
    setEditingOpeningValue("");
    loadData();
  }, [accountId, editingOpeningValue, loadData]);

  const handleRemoveAdjustment = useCallback(async (month: string) => {
    if (!accountId) return;
    alert(
      "Remove Override",
      "Delete the opening-balance adjustment for this month? The balance will revert to the chained value from the previous month.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await deleteOpeningAdjustment(accountId, month);
            loadData();
          },
        },
      ],
    );
  }, [accountId, loadData, alert]);

  const handleClose = useCallback(() => {
    if (!account) return;
    const displayName =
      account.account_label ??
      `${account.bank_name} ****${account.account_identifier}`;
    alert(
      "Close this account?",
      `${displayName} will be removed from active tracking. All transactions and history are preserved — you can browse them any time from the closed accounts section.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Close account",
          style: "destructive",
          onPress: async () => {
            await closeAccount(account.id);
            router.back();
          },
        },
      ],
    );
  }, [account, router, alert]);

  const handleReopen = useCallback(async () => {
    if (!account) return;
    await reopenAccount(account.id);
    loadData();
  }, [account, loadData]);

  const handleDelete = useCallback(() => {
    if (!account) return;
    const displayName =
      account.account_label ??
      `${account.bank_name} ****${account.account_identifier}`;
    alert(
      "Remove Account",
      `Remove "${displayName}"? The account will be hidden but linked expenses are preserved.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await deactivateAccount(account.id);
            router.back();
          },
        },
      ],
    );
  }, [account, router, alert]);

  const handleToggleMode = useCallback(
    async (mode: PaymentMode, isLinked: boolean) => {
      if (!account) return;
      if (isLinked) {
        alert("Remove Link", `Remove "${mode.name}" from this account?`, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              await removePaymentModeFromAccount(account.id, mode.id);
              loadData();
            },
          },
        ]);
      } else {
        await addPaymentModeToAccount(account.id, mode.id);
        loadData();
      }
    },
    [account, loadData],
  );

  if (!account) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            title: "Account",
            headerStyle: { backgroundColor: colors.background },
            headerTitleStyle: { fontWeight: "700", fontSize: 18, color: colors.text },
            headerTintColor: colors.tint,
            headerShadowVisible: false,
          }}
        />
        <ScreenContainer padTop={false} keyboardAware>
          <View className="items-center py-16">
            <Ionicons name="alert-circle-outline" size={48} color={colors.textSecondary} />
            <Text className="text-lg font-medium text-foreground mt-4">
              Account not found
            </Text>
          </View>
        </ScreenContainer>
      </>
    );
  }

  const ACCOUNT_TYPES: Array<{ key: AccountType; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
    { key: "savings", label: "Savings", icon: "wallet-outline" },
    { key: "credit_card", label: "Credit Card", icon: "card-outline" },
    { key: "loan", label: "Loan", icon: "document-text-outline" },
    { key: "wallet", label: "Wallet", icon: "phone-portrait-outline" },
    { key: "demat", label: "Demat", icon: "trending-up-outline" },
    { key: "pension", label: "Pension", icon: "briefcase-outline" },
  ];

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: headerTitle,
          headerStyle: { backgroundColor: colors.background },
          headerTitleStyle: { fontWeight: "700", fontSize: 18, color: colors.text },
          headerTintColor: colors.tint,
          headerShadowVisible: false,
        }}
      />
      <ScreenContainer padTop={false} keyboardAware>
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadData(); setRefreshing(false); }} />
          }
        >
          <View className="px-4 py-4">
          {/* Closed account banner */}
          {account.closed_at && (
            <View className="bg-warning/10 border border-warning/30 rounded-xl px-4 py-3 mb-3 flex-row items-center gap-3">
              <Ionicons name="lock-closed-outline" size={18} color={theme.warning} />
              <Text className="text-sm text-warning flex-1">
                This account is closed. History is read-only.
              </Text>
            </View>
          )}

          {/* Account identity */}
          <Card className="mb-3">
            <View className="flex-row items-center mb-4">
              <View
                className="w-12 h-12 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: theme.alpha("primary", 0.08) }}
              >
                <Ionicons
                  name={ACCOUNT_TYPE_ICONS[accountType] ?? "help-outline"}
                  size={24}
                  color={colors.blue}
                />
              </View>
              <View>
                <Text className="text-base font-bold text-foreground">
                  {account.bank_name}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  ****{account.account_identifier}
                </Text>
              </View>
            </View>

            {/* Account type picker — hidden for loans (switching type would
                orphan the loan_accounts row and its schedule). */}
            {account.account_type !== "loan" && (
              <>
                <Text className="text-xs font-medium text-muted-foreground mb-2">
                  Account Type
                </Text>
                <View className="flex-row flex-wrap mb-4" style={{ gap: 8 }}>
                  {ACCOUNT_TYPES.map((t) => {
                    const isSelected = accountType === t.key;
                    return (
                      <Pressable
                        key={t.key}
                        onPress={() => { setAccountType(t.key); setDirty(true); }}
                        className="flex-row items-center px-3 py-2.5 rounded-lg border"
                        style={{
                          width: "48%",
                          backgroundColor: isSelected ? theme.primary : undefined,
                          borderColor: isSelected ? theme.primary : colors.border,
                        }}
                      >
                        <Ionicons
                          name={t.icon}
                          size={16}
                          color={isSelected ? "#FFFFFF" : colors.textSecondary}
                          style={{ marginRight: 6 }}
                        />
                        <Text
                          className="text-xs font-semibold"
                          style={{ color: isSelected ? "#FFFFFF" : colors.textSecondary }}
                        >
                          {t.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            <Input
              label="Nickname"
              value={labelValue}
              onChangeText={(v) => { setLabelValue(v); setDirty(true); }}
              placeholder={account ? `${account.bank_name} ****${account.account_identifier}` : "e.g., Salary Account"}
              maxLength={50}
            />
          </Card>

          {/* Financial details — credit cards only */}
          {accountType === "credit_card" && (
            <Card className="mb-3" title="Financial Details">
              <Input
                label="Credit Limit"
                value={creditLimitValue}
                onChangeText={(v) => { setCreditLimitValue(v); setDirty(true); }}
                placeholder="e.g., 200000"
                keyboardType="numeric"
                formula
              />
              {siblingCards.length > 0 && (
                <View
                  className="flex-row items-start mt-3 p-3 rounded-lg"
                  style={{ backgroundColor: theme.warning + "14" }}
                >
                  <Ionicons name="information-circle" size={16} color={theme.warning} style={{ marginTop: 1 }} />
                  <View className="flex-1 ml-2">
                    <Text className="text-xs font-medium" style={{ color: theme.warning }}>
                      Shared limit - changes sync to all {siblingCards.length + 1} {account.bank_name} cards
                    </Text>
                    {siblingCards.map((s) => (
                      <Text key={s.id} className="text-xs text-muted-foreground mt-0.5">
                        ****{s.account_identifier}
                        {s.credit_limit != null ? ` · Limit ${formatAmount(s.credit_limit)}` : ""}
                      </Text>
                    ))}
                  </View>
                </View>
              )}
              {account.total_due != null && account.total_due > 0 && (
                <View className="mt-4 pt-3 border-t border-border">
                  <Text className="text-xs font-semibold text-muted-foreground mb-2">
                    Statement Dues (from SMS)
                  </Text>
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-foreground">Total Due</Text>
                    <Text className="text-sm font-bold" style={{ color: theme.danger }}>
                      {formatAmount(account.total_due)}
                    </Text>
                  </View>
                  {account.min_due != null && (
                    <View className="flex-row justify-between mt-1">
                      <Text className="text-sm text-foreground">Minimum Due</Text>
                      <Text className="text-sm font-semibold text-foreground">
                        {formatAmount(account.min_due)}
                      </Text>
                    </View>
                  )}
                  {account.due_date && (
                    <View className="flex-row justify-between mt-1">
                      <Text className="text-sm text-foreground">Due Date</Text>
                      <Text className="text-sm text-foreground">
                        {new Date(account.due_date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </Card>
          )}

          {/* v15.5: Savings min-balance alert (savings only) */}
          {accountType === "savings" && (
            <Card className="mb-3" title="Minimum Balance Alert">
              <Input
                label="Minimum Balance (₹)"
                value={minBalanceValue}
                onChangeText={(v) => {
                  setMinBalanceValue(v);
                  setDirty(true);
                }}
                placeholder="e.g., 10000 (0 or blank to turn off)"
                keyboardType="numeric"
                formula
              />
              <Text className="text-xs text-faint-foreground mt-2">
                Arth will show an alert on Home if this account's closing balance drops below this. Leave at 0 or blank to disable for this account.
              </Text>
            </Card>
          )}

          {/* Demat: Current value summary */}
          {accountType === "demat" && (
            <Card className="mb-3">
              <Text className="text-xs font-semibold text-faint-foreground uppercase tracking-wider mb-3">
                Current Value
              </Text>
              <View className="flex-row justify-between mb-2">
                <View className="flex-1">
                  <Text className="text-xs text-muted-foreground mb-0.5">Portfolio</Text>
                  <Text className="text-base font-bold text-foreground">
                    {dematLatestValue != null ? formatAmount(dematLatestValue) : "—"}
                  </Text>
                </View>
                <View className="flex-1 items-center">
                  <Text className="text-xs text-muted-foreground mb-0.5">Idle Cash</Text>
                  <Text className="text-base font-bold text-foreground">
                    {dematLatestFund != null ? formatAmount(dematLatestFund) : "—"}
                  </Text>
                </View>
                <View className="flex-1 items-end">
                  <Text className="text-xs text-muted-foreground mb-0.5">Total</Text>
                  <Text className="text-base font-bold text-foreground">
                    {dematLatestValue != null ? formatAmount((dematLatestValue ?? 0) + (dematLatestFund ?? 0)) : "—"}
                  </Text>
                </View>
              </View>
              {dematLatestDate && (
                <Text className="text-label text-faint-foreground">
                  As of {formatSnapshotDate(dematLatestDate)}
                </Text>
              )}
            </Card>
          )}

          {/* Demat: View Snapshots link */}
          {accountType === "demat" && (
            <Pressable
              onPress={() => router.push({ pathname: "/demat/snapshots/[id]", params: { id: accountId } } as never)}
              className="mx-0 mb-3 flex-row items-center py-3.5 px-4 rounded-xl bg-card"
            >
              <View className="w-8 h-8 rounded-full items-center justify-center mr-3" style={{ backgroundColor: colors.border }}>
                <Ionicons name="stats-chart-outline" size={16} color={colors.textSecondary} />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-semibold text-foreground">
                  Demat Account Details
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  {dematSnapshotCount > 0 ? `${dematSnapshotCount} snapshots recorded` : "No snapshots yet"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Pressable>
          )}

          {/* Loan accounts — surface a direct link to the loan detail
              (amortization, prepayments, corrections). Replaces the generic
              Monthly Balance Ledger which doesn't apply to loans. */}
          {account && accountType === "loan" && (
            <Pressable
              onPress={async () => {
                try {
                  const { getLoanByFinancialAccountId } = await import(
                    "@/services/loan-accounts"
                  );
                  const loan = await getLoanByFinancialAccountId(accountId);
                  if (loan) {
                    router.push({
                      pathname: "/loans/[id]",
                      params: { id: loan.id },
                    } as never);
                  }
                } catch {
                  // If we can't resolve, stay on this screen
                }
              }}
              accessibilityRole="button"
              accessibilityLabel="Open loan details"
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Card className="mb-3">
                <View className="flex-row items-center">
                  <View
                    className="w-10 h-10 rounded-full items-center justify-center mr-3"
                    style={{ backgroundColor: colors.surface }}
                  >
                    <Ionicons
                      name="document-text-outline"
                      size={20}
                      color={colors.blue}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">
                      View loan details
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      Amortization schedule, prepayments, corrections
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.textSecondary}
                  />
                </View>
              </Card>
            </Pressable>
          )}

          {/* Monthly Balance Ledger — hidden for loans (schedule is source of
              truth), demat (own snapshot system), and credit cards (the
              Bank-Reported Balance card below already owns the authoritative
              utilized/remaining figures; two overlapping concepts confuse
              users). v17.5.10 extends the earlier loan/demat guard. */}
          {accountType !== "demat" && accountType !== "loan" && accountType !== "credit_card" && <Card className="mb-3" title="Monthly Balance Ledger">
            {!seeded ? (
              <View>
                <Text className="text-xs text-muted-foreground mb-3">
                  Set a starting balance and month to begin tracking. The chain continues automatically from there.
                </Text>
                <Input
                  label="Starting Balance"
                  value={seedBalance}
                  onChangeText={setSeedBalance}
                  placeholder="Account balance"
                  keyboardType="numeric"
                  formula
                  containerClassName="mb-3"
                />
                <Input
                  label="Starting Month (YYYY-MM)"
                  value={seedMonth}
                  onChangeText={setSeedMonth}
                  placeholder="e.g., 2025-04"
                  containerClassName="mb-4"
                />
                <Button
                  title="Start Tracking"
                  onPress={handleSeedBalance}
                  variant="outline"
                />
              </View>
            ) : (
              <View>
                <PeriodNavigator mode="month" value={ledgerMonth} onChange={setLedgerMonth} variant="inline" />

                {!ledgerSummary ? (
                  <Text className="text-xs text-muted-foreground text-center py-4">
                    No balance data for this month.
                  </Text>
                ) : (
                  <View className="mt-2">
                    {/* Opening balance — editable */}
                    <View className="flex-row items-center justify-between">
                      <Text className="text-xs text-muted-foreground">
                        Opening
                        {ledgerSummary.is_manual_override && (
                          <Text className="text-xs text-faint-foreground"> (override)</Text>
                        )}
                      </Text>
                      {editingMonth === ledgerMonth ? (
                        <View className="flex-row items-center">
                          <Input
                            value={editingOpeningValue}
                            onChangeText={setEditingOpeningValue}
                            keyboardType="numeric"
                            formula
                            className="text-xs py-1"
                            containerClassName="w-28"
                          />
                          <Pressable
                            onPress={() => handleOverrideOpening(ledgerMonth)}
                            className="ml-2 p-1"
                          >
                            <Ionicons name="checkmark-circle" size={22} color={theme.success} />
                          </Pressable>
                          <Pressable
                            onPress={() => setEditingMonth(null)}
                            className="ml-1 p-1"
                          >
                            <Ionicons name="close-circle" size={22} color={theme.faintForeground} />
                          </Pressable>
                        </View>
                      ) : (
                        <View className="flex-row items-center">
                          <Text className="text-xs font-medium text-foreground">
                            {formatAmount(ledgerSummary.opening_balance)}
                          </Text>
                          <Pressable
                            onPress={() => {
                              setEditingMonth(ledgerMonth);
                              setEditingOpeningValue(String(ledgerSummary.opening_balance));
                            }}
                            hitSlop={8}
                            className="ml-2"
                          >
                            <Ionicons name="create-outline" size={14} color={colors.blue} />
                          </Pressable>
                          {adjustedMonths[ledgerMonth] && (
                            <Pressable
                              onPress={() => handleRemoveAdjustment(ledgerMonth)}
                              hitSlop={8}
                              className="ml-2"
                              accessibilityLabel="Remove opening balance adjustment"
                            >
                              <Ionicons name="trash-outline" size={14} color={theme.danger} />
                            </Pressable>
                          )}
                        </View>
                      )}
                    </View>

                    {/* Expenses */}
                    {ledgerSummary.expenses > 0 && (
                      <View className="flex-row justify-between mt-1">
                        <Text className="text-xs text-muted-foreground">
                          Expenses
                        </Text>
                        <Text className="text-xs" style={{ color: theme.danger }}>
                          −{formatAmount(ledgerSummary.expenses)}
                        </Text>
                      </View>
                    )}

                    {/* Credits */}
                    {ledgerSummary.credits > 0 && (
                      <View className="flex-row justify-between mt-1">
                        <Text className="text-xs text-muted-foreground">
                          Credits / Refunds
                        </Text>
                        <Text className="text-xs" style={{ color: theme.success }}>
                          +{formatAmount(ledgerSummary.credits)}
                        </Text>
                      </View>
                    )}

                    {/* Manual adjustments — drift indicator */}
                    {adjustmentStats.count > 0 && (
                      <View className="flex-row justify-between mt-1">
                        <Text className="text-xs text-muted-foreground">
                          Manual adjustments
                        </Text>
                        <Text className="text-xs" style={{ color: theme.warning }}>
                          {formatAmount(adjustmentStats.total)} · {adjustmentStats.count} entr{adjustmentStats.count === 1 ? "y" : "ies"}
                        </Text>
                      </View>
                    )}

                    {/* Closing / Current balance */}
                    <View className="flex-row justify-between mt-2 pt-2 border-t border-border">
                      <Text className="text-xs font-semibold text-muted-foreground">
                        {ledgerMonth === getCurrentMonth() ? "Current" : "Closing"}
                      </Text>
                      <Text className="text-xs font-bold text-foreground">
                        {formatAmount(ledgerSummary.closing_balance)}
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            )}
          </Card>}

          {/* Bank-Reported Balance — SMS traceability + auto-apply newer SMS.
              Skipped for loans (the amortization schedule is authoritative). */}
          {account && account.account_type !== "demat" && account.account_type !== "loan" && (
            <BalanceSourceCard
              accountId={accountId}
              isShared={siblingCards.length > 0}
              accountType={account.account_type}
            />
          )}

          {/* Payment Modes — hidden for loans (loans aren't payment instruments)
              and demat (investment accounts don't route expenses). v17.5.10. */}
          {accountType !== "loan" && accountType !== "demat" && <Card className="mb-3" title="Linked Payment Modes">
            {allModes.length > 0 ? (
              allModes.map((mode) => {
                const isLinked = linkedModeIds.has(mode.id);
                return (
                  <Pressable
                    key={mode.id}
                    onPress={() => handleToggleMode(mode, isLinked)}
                    className="flex-row items-center py-2.5"
                  >
                    <Ionicons
                      name={isLinked ? "checkbox" : "square-outline"}
                      size={22}
                      color={isLinked ? colors.blue : theme.faintForeground}
                    />
                    <Text
                      className={`text-sm ml-3 ${
                        isLinked
                          ? "text-foreground font-medium"
                          : "text-muted-foreground"
                      }`}
                    >
                      {mode.name}
                    </Text>
                    <Text className="text-label text-muted-foreground ml-auto">
                      {mode.type.replace("_", " ")}
                    </Text>
                  </Pressable>
                );
              })
            ) : (
              <Text className="text-xs text-muted-foreground text-center py-2">
                No payment modes created yet. Add them in Settings → Payment Modes.
              </Text>
            )}
          </Card>}

          {/* Save button */}
          {dirty && (
            <View className="mb-4">
              <Button title="Save Changes" onPress={handleSave} loading={saving} />
            </View>
          )}

          {/* Danger zone */}
          <Card className="mb-3">
            {account.closed_at ? (
              <Pressable onPress={handleReopen} className="flex-row items-center justify-center py-1">
                <Ionicons name="refresh-outline" size={18} color={colors.blue} />
                <Text className="text-sm font-medium ml-2" style={{ color: colors.blue }}>Reopen account</Text>
              </Pressable>
            ) : (
              <Pressable onPress={handleClose} className="flex-row items-center justify-center py-1">
                <Ionicons name="lock-closed-outline" size={18} color={theme.danger} />
                <Text className="text-sm font-medium ml-2" style={{ color: theme.danger }}>Close account</Text>
              </Pressable>
            )}
            <View className="border-t border-border mt-3 pt-3">
              <Pressable onPress={handleDelete} className="flex-row items-center justify-center py-1">
                <Ionicons name="trash-outline" size={16} color={colors.textSecondary} />
                <Text className="text-sm ml-2 text-muted-foreground">Remove account</Text>
              </Pressable>
            </View>
          </Card>
          </View>
        </ScrollView>
      </ScreenContainer>
    </>
  );
}

function formatSnapshotDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}
