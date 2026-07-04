import { useState, useCallback, useRef } from "react";
import { logger } from "@/utils/logger";
import { View, Text, ScrollView, Pressable, Keyboard } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card, Input, Button, DateInput, PeriodNavigator } from "@/components/ui";
import { BalanceSourceCard } from "@/components/account/BalanceSourceCard";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import { StatusColors } from "@/constants/theme";
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
  updateAccountFinancials,
  updateAccountType,
  getActiveAccounts,
  updateFundBalance,
  getCurrentFundBalance,
  addOrUpdateSnapshot,
  deleteSnapshot,
  getSnapshots,
  getLatestSnapshot,
  addOrUpdateFundSnapshot,
  deleteFundSnapshot,
  getFundSnapshots,
} from "@/services/financial-account";
import type { FinancialAccount, PortfolioSnapshot, FundSnapshot, AccountType } from "@/services/financial-account";
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
  const { colors, accent, colorScheme } = useColorScheme();
  const sc = StatusColors[colorScheme];
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

  // Seed state (for first-time balance setup)
  const [seedBalance, setSeedBalance] = useState("");
  const [seedMonth, setSeedMonth] = useState(getCurrentMonth());

  // Opening balance override
  const [editingMonth, setEditingMonth] = useState<string | null>(null);
  const [editingOpeningValue, setEditingOpeningValue] = useState("");
  const [adjustedMonths, setAdjustedMonths] = useState<Record<string, boolean>>({});
  const [adjustmentStats, setAdjustmentStats] = useState<{ total: number; count: number }>({ total: 0, count: 0 });

  // Demat-specific state
  const [fundBalanceValue, setFundBalanceValue] = useState("");
  const [dematSnapshots, setDematSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [dematFundSnapshots, setDematFundSnapshots] = useState<FundSnapshot[]>([]);
  const [dematLatestValue, setDematLatestValue] = useState<number | null>(null);
  const [newSnapshotDate, setNewSnapshotDate] = useState(new Date().toISOString().split("T")[0]);
  const [newSnapshotValue, setNewSnapshotValue] = useState("");
  const [newFundSnapshotValue, setNewFundSnapshotValue] = useState("");
  const [addingSnapshot, setAddingSnapshot] = useState(false);
  const [editingSnapshotId, setEditingSnapshotId] = useState<string | null>(null);
  const [editingSnapshotValue, setEditingSnapshotValue] = useState("");
  const [editingFundSnapshotId, setEditingFundSnapshotId] = useState<string | null>(null);
  const [editingFundSnapshotValue, setEditingFundSnapshotValue] = useState("");

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
      // Load current fund from the snapshots table (single source of truth).
      // The legacy acct.fund_balance scalar is deprecated; seed the input with
      // the latest snapshot value instead.
      if (acct.account_type === "demat") {
        const currentFund = await getCurrentFundBalance(acct.id);
        setFundBalanceValue(String(currentFund));
      } else {
        setFundBalanceValue("0");
      }
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
        const [latest, snaps, fundSnaps] = await Promise.all([
          getLatestSnapshot(accountId),
          getSnapshots(accountId),
          getFundSnapshots(accountId),
        ]);
        setDematLatestValue(latest?.portfolio_value ?? null);
        setDematSnapshots(snaps);
        setDematFundSnapshots(fundSnaps);
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
      } else if (accountType === "demat") {
        const fund = parseFloat(fundBalanceValue.replace(/,/g, ""));
        if (!isNaN(fund)) {
          await updateFundBalance(account.id, fund);
        }
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
  }, [account, accountType, labelValue, creditLimitValue, fundBalanceValue, minBalanceValue, loadData]);

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

  const handleDelete = useCallback(() => {
    if (!account) return;
    const displayName =
      account.account_label ??
      `${account.bank_name} ****${account.account_identifier}`;
    alert(
      "Delete Account",
      `Remove "${displayName}"? The account will be hidden but linked expenses are preserved.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deactivateAccount(account.id);
            router.back();
          },
        },
      ],
    );
  }, [account, router]);

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
            <Text className="text-lg font-medium text-text-primary dark:text-text-dark-primary mt-4">
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
        >
          <View className="px-4 py-4">
          {/* Account identity */}
          <Card className="mb-3">
            <View className="flex-row items-center mb-4">
              <View
                className="w-12 h-12 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: accent[500] + "14" }}
              >
                <Ionicons
                  name={ACCOUNT_TYPE_ICONS[accountType] ?? "help-outline"}
                  size={24}
                  color={colors.blue}
                />
              </View>
              <View>
                <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
                  {account.bank_name}
                </Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  ****{account.account_identifier}
                </Text>
              </View>
            </View>

            {/* Account type picker — hidden for loans (switching type would
                orphan the loan_accounts row and its schedule). */}
            {account.account_type !== "loan" && (
              <>
                <Text className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary mb-2">
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
                          backgroundColor: isSelected ? accent[500] : undefined,
                          borderColor: isSelected ? accent[500] : colors.border,
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
                  style={{ backgroundColor: sc.warning + "14" }}
                >
                  <Ionicons name="information-circle" size={16} color={sc.warning} style={{ marginTop: 1 }} />
                  <View className="flex-1 ml-2">
                    <Text className="text-xs font-medium" style={{ color: sc.warning }}>
                      Shared limit - changes sync to all {siblingCards.length + 1} {account.bank_name} cards
                    </Text>
                    {siblingCards.map((s) => (
                      <Text key={s.id} className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                        ****{s.account_identifier}
                        {s.credit_limit != null ? ` · Limit ${formatAmount(s.credit_limit)}` : ""}
                      </Text>
                    ))}
                  </View>
                </View>
              )}
              {account.total_due != null && account.total_due > 0 && (
                <View className="mt-4 pt-3 border-t border-border-light dark:border-border-dark">
                  <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary mb-2">
                    Statement Dues (from SMS)
                  </Text>
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-text-primary dark:text-text-dark-primary">Total Due</Text>
                    <Text className="text-sm font-bold" style={{ color: sc.danger }}>
                      {formatAmount(account.total_due)}
                    </Text>
                  </View>
                  {account.min_due != null && (
                    <View className="flex-row justify-between mt-1">
                      <Text className="text-sm text-text-primary dark:text-text-dark-primary">Minimum Due</Text>
                      <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                        {formatAmount(account.min_due)}
                      </Text>
                    </View>
                  )}
                  {account.due_date && (
                    <View className="flex-row justify-between mt-1">
                      <Text className="text-sm text-text-primary dark:text-text-dark-primary">Due Date</Text>
                      <Text className="text-sm text-text-primary dark:text-text-dark-primary">
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
              <Text className="text-xs text-text-tertiary mt-2">
                Arth will show an alert on Home if this account's closing balance drops below this. Leave at 0 or blank to disable for this account.
              </Text>
            </Card>
          )}

          {/* Demat: Fund Balance */}
          {accountType === "demat" && (
            <Card className="mb-3">
              <Text className="text-xs font-semibold text-text-tertiary dark:text-text-dark-secondary uppercase tracking-wider mb-3">
                Idle Cash / Fund Balance
              </Text>
              <Input
                value={fundBalanceValue}
                onChangeText={(v) => { setFundBalanceValue(v); setDirty(true); }}
                keyboardType="numeric"
                formula
                placeholder="0"
                onFocus={() => {
                  const sub = Keyboard.addListener("keyboardDidShow", () => {
                    scrollRef.current?.scrollToEnd({ animated: true });
                    sub.remove();
                  });
                  setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 400);
                }}
              />
            </Card>
          )}

          {/* Demat: Portfolio Snapshots */}
          {accountType === "demat" && (
            <Card className="mb-3">
              <Text className="text-xs font-semibold text-text-tertiary dark:text-text-dark-secondary uppercase tracking-wider mb-3">
                Portfolio Snapshots
              </Text>

              {/* Add new snapshot row — date on top, portfolio + fund side-by-side, save */}
              <View className="mb-3 pb-3 border-b border-border-light dark:border-border-dark">
                <View className="mb-2">
                  <DateInput label="Date" value={newSnapshotDate} onChange={setNewSnapshotDate} />
                </View>
                <View className="flex-row items-end">
                  <View className="flex-1 mr-2">
                    <Input
                      label="Portfolio value"
                      value={newSnapshotValue}
                      onChangeText={setNewSnapshotValue}
                      keyboardType="numeric"
                      formula
                      placeholder="e.g. 1,25,000"
                      onFocus={() => {
                        const sub = Keyboard.addListener("keyboardDidShow", () => {
                          scrollRef.current?.scrollToEnd({ animated: true });
                          sub.remove();
                        });
                        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 400);
                      }}
                    />
                  </View>
                  <View className="flex-1 mr-2">
                    <Input
                      label="Fund (optional)"
                      value={newFundSnapshotValue}
                      onChangeText={setNewFundSnapshotValue}
                      keyboardType="numeric"
                      formula
                      placeholder="Leave blank to carry forward"
                      onFocus={() => {
                        const sub = Keyboard.addListener("keyboardDidShow", () => {
                          scrollRef.current?.scrollToEnd({ animated: true });
                          sub.remove();
                        });
                        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 400);
                      }}
                    />
                  </View>
                  <Pressable
                    onPress={async () => {
                      const val = parseFloat(newSnapshotValue.replace(/,/g, ""));
                      if (isNaN(val) || val < 0 || !newSnapshotDate) return;
                      setAddingSnapshot(true);
                      await addOrUpdateSnapshot(account.id, newSnapshotDate, val);
                      // Fund snapshot is optional: if user typed a value, record it
                      // on the same date; if blank, the prior fund snapshot carries
                      // forward automatically via getFundAsOf in the trend math.
                      const fundRaw = newFundSnapshotValue.trim();
                      if (fundRaw.length > 0) {
                        const fundVal = parseFloat(fundRaw.replace(/,/g, ""));
                        if (!isNaN(fundVal) && fundVal >= 0) {
                          await addOrUpdateFundSnapshot(account.id, newSnapshotDate, fundVal);
                        }
                      }
                      setNewSnapshotValue("");
                      setNewFundSnapshotValue("");
                      setNewSnapshotDate(new Date().toISOString().split("T")[0]);
                      setAddingSnapshot(false);
                      loadData();
                    }}
                    disabled={addingSnapshot}
                    className="pb-1"
                  >
                    <Ionicons
                      name="checkmark-circle"
                      size={28}
                      color={addingSnapshot ? colors.textSecondary : sc.success}
                    />
                  </Pressable>
                </View>
              </View>

              {/* Snapshot list */}
              {dematSnapshots.length === 0 ? (
                <View className="items-center py-4">
                  <Text className="text-xs text-text-tertiary dark:text-text-dark-secondary">
                    No snapshots yet. Add your first portfolio value above.
                  </Text>
                </View>
              ) : (
                dematSnapshots.map((snap) => {
                  const isEditing = editingSnapshotId === snap.id;
                  return (
                    <View key={snap.id} className="flex-row items-center py-2.5 border-b border-border-light dark:border-border-dark">
                      <View className="flex-1">
                        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                          {formatSnapshotDate(snap.snapshot_date)}
                        </Text>
                        {isEditing ? (
                          <View className="flex-row items-center mt-1">
                            <Input
                              value={editingSnapshotValue}
                              onChangeText={setEditingSnapshotValue}
                              keyboardType="numeric"
                              formula
                              className="text-xs py-1"
                              containerClassName="flex-1"
                            />
                            <Pressable
                              onPress={async () => {
                                const val = parseFloat(editingSnapshotValue.replace(/,/g, ""));
                                if (isNaN(val) || val < 0) return;
                                await addOrUpdateSnapshot(account.id, snap.snapshot_date, val);
                                setEditingSnapshotId(null);
                                loadData();
                              }}
                              className="ml-2"
                            >
                              <Ionicons name="checkmark-circle" size={22} color={sc.success} />
                            </Pressable>
                            <Pressable onPress={() => setEditingSnapshotId(null)} className="ml-1">
                              <Ionicons name="close-circle" size={22} color={sc.muted} />
                            </Pressable>
                          </View>
                        ) : (
                          <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary mt-0.5">
                            {formatAmount(snap.portfolio_value)}
                          </Text>
                        )}
                      </View>
                      {!isEditing && (
                        <View className="flex-row items-center">
                          <Pressable
                            onPress={() => {
                              setEditingSnapshotId(snap.id);
                              setEditingSnapshotValue(String(snap.portfolio_value));
                            }}
                            hitSlop={8}
                            className="mr-3"
                          >
                            <Ionicons name="create-outline" size={16} color={colors.blue} />
                          </Pressable>
                          <Pressable
                            onPress={() => {
                              alert("Delete Snapshot", `Delete portfolio value for ${formatSnapshotDate(snap.snapshot_date)}?`, [
                                { text: "Cancel", style: "cancel" },
                                { text: "Delete", style: "destructive", onPress: async () => { await deleteSnapshot(snap.id); loadData(); } },
                              ]);
                            }}
                            hitSlop={8}
                          >
                            <Ionicons name="trash-outline" size={16} color={sc.danger} />
                          </Pressable>
                        </View>
                      )}
                    </View>
                  );
                })
              )}

              {/* Fund snapshot history */}
              {dematFundSnapshots.length > 0 && (
                <>
                  <Text className="text-xs font-semibold text-text-tertiary dark:text-text-dark-secondary uppercase tracking-wider mt-4 mb-2">
                    Fund Snapshots
                  </Text>
                  {dematFundSnapshots.map((snap) => {
                    const isEditing = editingFundSnapshotId === snap.id;
                    return (
                      <View key={snap.id} className="flex-row items-center py-2.5 border-b border-border-light dark:border-border-dark">
                        <View className="flex-1">
                          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                            {formatSnapshotDate(snap.snapshot_date)}
                          </Text>
                          {isEditing ? (
                            <View className="flex-row items-center mt-1">
                              <Input
                                value={editingFundSnapshotValue}
                                onChangeText={setEditingFundSnapshotValue}
                                keyboardType="numeric"
                                formula
                                className="text-xs py-1"
                                containerClassName="flex-1"
                              />
                              <Pressable
                                onPress={async () => {
                                  const val = parseFloat(editingFundSnapshotValue.replace(/,/g, ""));
                                  if (isNaN(val) || val < 0) return;
                                  await addOrUpdateFundSnapshot(account.id, snap.snapshot_date, val);
                                  setEditingFundSnapshotId(null);
                                  loadData();
                                }}
                                className="ml-2"
                              >
                                <Ionicons name="checkmark-circle" size={22} color={sc.success} />
                              </Pressable>
                              <Pressable onPress={() => setEditingFundSnapshotId(null)} className="ml-1">
                                <Ionicons name="close-circle" size={22} color={sc.muted} />
                              </Pressable>
                            </View>
                          ) : (
                            <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary mt-0.5">
                              {formatAmount(snap.fund_value)}
                            </Text>
                          )}
                        </View>
                        {!isEditing && (
                          <View className="flex-row items-center">
                            <Pressable
                              onPress={() => {
                                setEditingFundSnapshotId(snap.id);
                                setEditingFundSnapshotValue(String(snap.fund_value));
                              }}
                              hitSlop={8}
                              className="mr-3"
                            >
                              <Ionicons name="create-outline" size={16} color={colors.blue} />
                            </Pressable>
                            <Pressable
                              onPress={() => {
                                alert("Delete Fund Snapshot", `Delete fund value for ${formatSnapshotDate(snap.snapshot_date)}?`, [
                                  { text: "Cancel", style: "cancel" },
                                  { text: "Delete", style: "destructive", onPress: async () => { await deleteFundSnapshot(snap.id); loadData(); } },
                                ]);
                              }}
                              hitSlop={8}
                            >
                              <Ionicons name="trash-outline" size={16} color={sc.danger} />
                            </Pressable>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </>
              )}
            </Card>
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
                    <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                      View loan details
                    </Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
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
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-3">
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
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary text-center py-4">
                    No balance data for this month.
                  </Text>
                ) : (
                  <View className="mt-2">
                    {/* Opening balance — editable */}
                    <View className="flex-row items-center justify-between">
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                        Opening
                        {ledgerSummary.is_manual_override && (
                          <Text className="text-xs text-text-tertiary dark:text-text-dark-tertiary"> (override)</Text>
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
                            <Ionicons name="checkmark-circle" size={22} color={sc.success} />
                          </Pressable>
                          <Pressable
                            onPress={() => setEditingMonth(null)}
                            className="ml-1 p-1"
                          >
                            <Ionicons name="close-circle" size={22} color={sc.muted} />
                          </Pressable>
                        </View>
                      ) : (
                        <View className="flex-row items-center">
                          <Text className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
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
                              <Ionicons name="trash-outline" size={14} color={sc.danger} />
                            </Pressable>
                          )}
                        </View>
                      )}
                    </View>

                    {/* Expenses */}
                    {ledgerSummary.expenses > 0 && (
                      <View className="flex-row justify-between mt-1">
                        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                          Expenses
                        </Text>
                        <Text className="text-xs" style={{ color: sc.danger }}>
                          −{formatAmount(ledgerSummary.expenses)}
                        </Text>
                      </View>
                    )}

                    {/* Credits */}
                    {ledgerSummary.credits > 0 && (
                      <View className="flex-row justify-between mt-1">
                        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                          Credits / Refunds
                        </Text>
                        <Text className="text-xs" style={{ color: sc.success }}>
                          +{formatAmount(ledgerSummary.credits)}
                        </Text>
                      </View>
                    )}

                    {/* Manual adjustments — drift indicator */}
                    {adjustmentStats.count > 0 && (
                      <View className="flex-row justify-between mt-1">
                        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                          Manual adjustments
                        </Text>
                        <Text className="text-xs" style={{ color: sc.warning }}>
                          {formatAmount(adjustmentStats.total)} · {adjustmentStats.count} entr{adjustmentStats.count === 1 ? "y" : "ies"}
                        </Text>
                      </View>
                    )}

                    {/* Closing / Current balance */}
                    <View className="flex-row justify-between mt-2 pt-2 border-t border-border-light dark:border-border-dark">
                      <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary">
                        {ledgerMonth === getCurrentMonth() ? "Current" : "Closing"}
                      </Text>
                      <Text className="text-xs font-bold text-text-primary dark:text-text-dark-primary">
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
                      color={isLinked ? colors.blue : "#9CA3AF"}
                    />
                    <Text
                      className={`text-sm ml-3 ${
                        isLinked
                          ? "text-text-primary dark:text-text-dark-primary font-medium"
                          : "text-text-secondary dark:text-text-dark-secondary"
                      }`}
                    >
                      {mode.name}
                    </Text>
                    <Text className="text-[10px] text-text-secondary dark:text-text-dark-secondary ml-auto">
                      {mode.type.replace("_", " ")}
                    </Text>
                  </Pressable>
                );
              })
            ) : (
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary text-center py-2">
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
            <Pressable
              onPress={handleDelete}
              className="flex-row items-center justify-center py-1"
            >
              <Ionicons name="trash-outline" size={18} color={sc.danger} />
              <Text className="text-sm font-medium ml-2" style={{ color: sc.danger }}>
                Delete Account
              </Text>
            </Pressable>
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
