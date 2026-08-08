import { useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform, RefreshControl } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card, Input, DateInput, PeriodNavigator, FAB } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import { StatusColors } from "@/constants/theme";
import { formatAmount } from "@/utils/format";
import { ac } from "@/utils/accent";
import {
  getAccountById,
  getLatestSnapshot,
  getLatestFundSnapshot,
  getPortfolioSnapshotsForMonth,
  getFundSnapshotsForMonth,
  addOrUpdateSnapshot,
  addOrUpdateFundSnapshot,
  deleteSnapshot,
  deleteFundSnapshot,
  getDematTransferTotals,
} from "@/services/financial-account";
import type { FinancialAccount, PortfolioSnapshot, FundSnapshot } from "@/services/financial-account";

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatDay(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]}`;
}

function formatSnapshotDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}

function getDefaultDate(selectedMonth: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const todayMonth = today.slice(0, 7);
  if (todayMonth === selectedMonth) return today;
  return `${selectedMonth}-01`;
}

export default function DematSnapshotsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors, accent, colorScheme } = useColorScheme();
  const alert = useAlert();
  const sc = StatusColors[colorScheme];

  const [account, setAccount] = useState<FinancialAccount | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonth());
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [fundSnapshots, setFundSnapshots] = useState<FundSnapshot[]>([]);
  const [latestPortfolio, setLatestPortfolio] = useState<number | null>(null);
  const [latestFund, setLatestFund] = useState<number | null>(null);
  const [latestDate, setLatestDate] = useState<string | null>(null);
  const [totalDeposited, setTotalDeposited] = useState<number>(0);
  const [totalWithdrawn, setTotalWithdrawn] = useState<number>(0);

  // Inline edit state
  const [editingPortfolioId, setEditingPortfolioId] = useState<string | null>(null);
  const [editingPortfolioValue, setEditingPortfolioValue] = useState("");
  const [editingFundId, setEditingFundId] = useState<string | null>(null);
  const [editingFundValue, setEditingFundValue] = useState("");

  // Inline add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDate, setAddDate] = useState("");
  const [addPortfolio, setAddPortfolio] = useState("");
  const [addFund, setAddFund] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [acct, latest, latestF, snaps, funds, totals] = await Promise.all([
        getAccountById(id),
        getLatestSnapshot(id),
        getLatestFundSnapshot(id),
        getPortfolioSnapshotsForMonth(id, selectedMonth),
        getFundSnapshotsForMonth(id, selectedMonth),
        getDematTransferTotals(id),
      ]);
      setAccount(acct);
      setLatestPortfolio(latest?.portfolio_value ?? null);
      setLatestDate(latest?.snapshot_date ?? null);
      setLatestFund(latestF?.fund_value ?? null);
      setSnapshots(snaps);
      setFundSnapshots(funds);
      setTotalDeposited(totals.totalDeposited);
      setTotalWithdrawn(totals.totalWithdrawn);
    } catch {
      // db not ready
    }
  }, [id, selectedMonth]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const handleOpenAdd = useCallback(() => {
    setAddDate(getDefaultDate(selectedMonth));
    setAddPortfolio("");
    setAddFund("");
    setShowAddForm(true);
  }, [selectedMonth]);

  const handleCancelAdd = useCallback(() => {
    setShowAddForm(false);
    setAddDate("");
    setAddPortfolio("");
    setAddFund("");
  }, []);

  const handleSaveAdd = useCallback(async () => {
    const portVal = parseFloat(addPortfolio.replace(/,/g, ""));
    if (isNaN(portVal) || portVal < 0 || !addDate) return;
    setSaving(true);
    try {
      await addOrUpdateSnapshot(id, addDate, portVal);
      const fundRaw = addFund.trim();
      if (fundRaw.length > 0) {
        const fundVal = parseFloat(fundRaw.replace(/,/g, ""));
        if (!isNaN(fundVal)) {
          await addOrUpdateFundSnapshot(id, addDate, fundVal);
        }
      } else if (latestFund != null) {
        // Carry the last known fund value forward as an explicit DB row so it
        // appears in the table and can be edited later.
        await addOrUpdateFundSnapshot(id, addDate, latestFund);
      }
      setShowAddForm(false);
      loadData();
    } finally {
      setSaving(false);
    }
  }, [id, addDate, addPortfolio, addFund, latestFund, loadData]);

  const handleSavePortfolioEdit = useCallback(async (snap: PortfolioSnapshot) => {
    const val = parseFloat(editingPortfolioValue.replace(/,/g, ""));
    if (isNaN(val) || val < 0) return;
    await addOrUpdateSnapshot(id, snap.snapshot_date, val);
    setEditingPortfolioId(null);
    loadData();
  }, [id, editingPortfolioValue, loadData]);

  const handleSaveFundEdit = useCallback(async (snap: FundSnapshot) => {
    const val = parseFloat(editingFundValue.replace(/,/g, ""));
    if (isNaN(val)) return;
    await addOrUpdateFundSnapshot(id, snap.snapshot_date, val);
    setEditingFundId(null);
    loadData();
  }, [id, editingFundValue, loadData]);

  const handleDeletePortfolio = useCallback((snap: PortfolioSnapshot) => {
    alert(
      "Delete Snapshot",
      `Delete portfolio value for ${formatSnapshotDate(snap.snapshot_date)}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => { await deleteSnapshot(snap.id); loadData(); },
        },
      ],
    );
  }, [alert, loadData]);

  const handleDeleteFund = useCallback((snap: FundSnapshot) => {
    alert(
      "Delete Fund Snapshot",
      `Delete fund value for ${formatSnapshotDate(snap.snapshot_date)}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => { await deleteFundSnapshot(snap.id); loadData(); },
        },
      ],
    );
  }, [alert, loadData]);

  // Merged date list (portfolio + fund rows by date, most recent first)
  const allDates = [...new Set([
    ...snapshots.map((s) => s.snapshot_date),
    ...fundSnapshots.map((f) => f.snapshot_date),
  ])].sort((a, b) => b.localeCompare(a));

  const portfolioByDate = new Map(snapshots.map((s) => [s.snapshot_date, s]));
  const fundByDate = new Map(fundSnapshots.map((f) => [f.snapshot_date, f]));

  const accountLabel = account
    ? (account.account_label || `${account.bank_name} ****${account.account_identifier}`)
    : "Demat Account";

  const totalLatest = (latestPortfolio ?? 0) + (latestFund ?? 0);
  const netInvested = totalDeposited - totalWithdrawn;

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen options={{ title: "Demat Account Details" }} />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadData(); setRefreshing(false); }} />
          }
        >
          {/* Account name */}
          <View className="px-4 pt-3 pb-1 flex-row items-center">
            <Ionicons name="trending-up-outline" size={18} color={ac(accent, colorScheme, 500, 300)} style={{ marginRight: 8 }} />
            <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary">
              {accountLabel}
            </Text>
          </View>

          {/* Summary card */}
          <Card className="mx-4 mb-3">
            <Text className="text-xs font-semibold text-text-tertiary dark:text-text-dark-secondary uppercase tracking-wider mb-3">
              Current Value
            </Text>
            <View className="flex-row justify-between mb-2">
              <View className="flex-1">
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-0.5">Portfolio</Text>
                <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
                  {latestPortfolio != null ? formatAmount(latestPortfolio) : "—"}
                </Text>
              </View>
              <View className="flex-1 items-center">
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-0.5">Idle Cash</Text>
                <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
                  {latestFund != null ? formatAmount(latestFund) : "—"}
                </Text>
              </View>
              <View className="flex-1 items-end">
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-0.5">Total</Text>
                <Text className="text-base font-bold" style={{ color: ac(accent, colorScheme, 500, 300) }}>
                  {latestPortfolio != null ? formatAmount(totalLatest) : "—"}
                </Text>
              </View>
            </View>
            {latestDate && (
              <Text className="text-[10px] text-text-tertiary dark:text-text-dark-secondary mt-1 mb-3">
                As of {formatSnapshotDate(latestDate)}
              </Text>
            )}

            {/* Transfer totals row */}
            {(totalDeposited > 0 || totalWithdrawn > 0) && (
              <>
                <View className="border-t border-border-light dark:border-border-dark pt-3">
                  <View className="flex-row justify-between">
                    <View className="flex-1">
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-0.5">Deposited</Text>
                      <Text className="text-sm font-semibold" style={{ color: sc.success }}>
                        {formatAmount(totalDeposited)}
                      </Text>
                    </View>
                    <View className="flex-1 items-center">
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-0.5">Withdrawn</Text>
                      <Text className="text-sm font-semibold" style={{ color: sc.danger }}>
                        {totalWithdrawn > 0 ? formatAmount(totalWithdrawn) : "—"}
                      </Text>
                    </View>
                    <View className="flex-1 items-end">
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-0.5">Net Invested</Text>
                      <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                        {formatAmount(netInvested)}
                      </Text>
                    </View>
                  </View>
                </View>
              </>
            )}
          </Card>

          {/* Inline add form — appears above the table when FAB is tapped */}
          {showAddForm && (
            <Card className="mx-4 mb-3">
              <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary uppercase tracking-wider mb-3">
                Add Snapshot
              </Text>
              <DateInput
                label="Date"
                value={addDate}
                onChange={setAddDate}
                maximumDate={null}
                containerClassName="mb-3"
              />
              <Input
                label="Portfolio value"
                value={addPortfolio}
                onChangeText={setAddPortfolio}
                keyboardType="numeric"
                formula
                placeholder="e.g. 5,25,000"
                containerClassName="mb-3"
              />
              <Input
                label="Idle Cash / Fund (optional)"
                value={addFund}
                onChangeText={setAddFund}
                keyboardType="numeric"
                formula
                placeholder={latestFund != null ? `Leave blank to carry ₹${latestFund.toLocaleString("en-IN")}` : "e.g. 5,000"}
                containerClassName="mb-3"
              />
              <View className="flex-row">
                <Pressable
                  onPress={handleCancelAdd}
                  className="flex-1 py-2.5 rounded-lg items-center mr-2 border border-border-light dark:border-border-dark"
                >
                  <Text className="text-sm font-semibold text-text-secondary dark:text-text-dark-secondary">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSaveAdd}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-lg items-center"
                  style={{ backgroundColor: ac(accent, colorScheme, 500, 400), opacity: saving ? 0.6 : 1 }}
                >
                  <Text className="text-sm font-semibold text-white">
                    {saving ? "Saving…" : "Save Snapshot"}
                  </Text>
                </Pressable>
              </View>
            </Card>
          )}

          {/* Month navigator + table */}
          <Card className="mx-4 mb-3">
            <PeriodNavigator
              mode="month"
              value={selectedMonth}
              onChange={(m) => {
                setEditingPortfolioId(null);
                setEditingFundId(null);
                setSelectedMonth(m);
              }}
              variant="inline"
            />

            {/* Table header */}
            <View className="flex-row items-center pt-3 pb-1.5 border-b border-border-light dark:border-border-dark">
              <Text className="flex-1 text-[10px] font-semibold text-text-tertiary dark:text-text-dark-secondary uppercase tracking-wider">
                Date
              </Text>
              <Text className="w-28 text-right text-[10px] font-semibold text-text-tertiary dark:text-text-dark-secondary uppercase tracking-wider">
                Portfolio
              </Text>
              <Text className="w-24 text-right text-[10px] font-semibold text-text-tertiary dark:text-text-dark-secondary uppercase tracking-wider">
                Fund
              </Text>
              <View className="w-16" />
            </View>

            {/* Rows */}
            {allDates.length === 0 ? (
              <View className="items-center py-8">
                <Ionicons name="calendar-outline" size={28} color={colors.textSecondary} />
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-2">
                  No snapshots for this month
                </Text>
                <Text className="text-xs text-text-tertiary dark:text-text-dark-secondary mt-1">
                  Tap + to add one
                </Text>
              </View>
            ) : (
              allDates.map((date, idx) => {
                const portSnap = portfolioByDate.get(date);
                const fundSnap = fundByDate.get(date);
                const isEditingPort = editingPortfolioId === portSnap?.id;
                const isEditingFund = editingFundId === fundSnap?.id;
                const isLast = idx === allDates.length - 1;

                return (
                  <View
                    key={date}
                    className={`flex-row items-center py-2.5 ${!isLast ? "border-b border-border-light dark:border-border-dark" : ""}`}
                  >
                    {/* Date */}
                    <Text className="flex-1 text-xs text-text-secondary dark:text-text-dark-secondary">
                      {formatDay(date)}
                    </Text>

                    {/* Portfolio value */}
                    <View className="w-28 items-end">
                      {isEditingPort ? (
                        <Input
                          value={editingPortfolioValue}
                          onChangeText={setEditingPortfolioValue}
                          keyboardType="numeric"
                          formula
                          containerClassName="w-24"
                          className="text-xs py-0.5 text-right"
                        />
                      ) : (
                        <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary">
                          {portSnap ? formatAmount(portSnap.portfolio_value) : "—"}
                        </Text>
                      )}
                    </View>

                    {/* Fund value */}
                    <View className="w-24 items-end">
                      {isEditingFund ? (
                        <Input
                          value={editingFundValue}
                          onChangeText={setEditingFundValue}
                          keyboardType="numeric"
                          formula
                          containerClassName="w-20"
                          className="text-xs py-0.5 text-right"
                        />
                      ) : (
                        <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary">
                          {fundSnap ? formatAmount(fundSnap.fund_value) : "—"}
                        </Text>
                      )}
                    </View>

                    {/* Actions */}
                    <View className="w-16 flex-row items-center justify-end gap-1">
                      {(isEditingPort || isEditingFund) ? (
                        <>
                          <Pressable
                            onPress={async () => {
                              if (isEditingPort && portSnap) await handleSavePortfolioEdit(portSnap);
                              if (isEditingFund && fundSnap) await handleSaveFundEdit(fundSnap);
                            }}
                            hitSlop={6}
                          >
                            <Ionicons name="checkmark-circle" size={20} color={sc.success} />
                          </Pressable>
                          <Pressable
                            onPress={() => {
                              setEditingPortfolioId(null);
                              setEditingFundId(null);
                            }}
                            hitSlop={6}
                          >
                            <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                          </Pressable>
                        </>
                      ) : (
                        <>
                          <Pressable
                            onPress={() => {
                              if (portSnap) {
                                setEditingPortfolioId(portSnap.id);
                                setEditingPortfolioValue(String(portSnap.portfolio_value));
                              }
                              if (fundSnap) {
                                setEditingFundId(fundSnap.id);
                                setEditingFundValue(String(fundSnap.fund_value));
                              }
                            }}
                            hitSlop={6}
                            className="mr-1"
                          >
                            <Ionicons name="create-outline" size={16} color={colors.blue} />
                          </Pressable>
                          <Pressable
                            onPress={() => {
                              if (portSnap) handleDeletePortfolio(portSnap);
                              else if (fundSnap) handleDeleteFund(fundSnap);
                            }}
                            hitSlop={6}
                          >
                            <Ionicons name="trash-outline" size={16} color={sc.danger} />
                          </Pressable>
                        </>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* FAB — hidden while add form is open */}
      {!showAddForm && (
        <FAB icon="add" onPress={handleOpenAdd} accessibilityLabel="Add snapshot" />
      )}
    </ScreenContainer>
  );
}
