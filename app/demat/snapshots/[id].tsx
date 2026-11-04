import { useState, useCallback } from "react";
import { View, ScrollView, Pressable, KeyboardAvoidingView, Modal, Platform, RefreshControl } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, DateInput, FAB, Input, PeriodNavigator, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";

import { formatAmount } from "@/utils/format";

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
import { useTheme } from "@/hooks/use-theme";
import { getDematDailyStatement, type DematDay } from "@/services/demat-statement";
import { SegmentedControl } from "@/components/motion";
import { todayIso } from "@/utils/local-date";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";
import { HoldingsTotals, PortfolioNoMatches, PortfolioSearchSort, PortfolioSection, usePortfolioView } from "@/components/portfolio/PortfolioList";
import { BROKER_SCREENS, getHoldingsForAccount, type AccountHoldings } from "@/services/demat-holdings";
import { formatDisplayDate } from "@/utils/date";
import { HistoryTab } from "@/components/demat/HistoryTab";
import { SimpleMoneyTab } from "@/components/demat/SimpleMoneyTab";
import { isBrokerHistoryOn } from "@/services/broker-history/enabled";

type AccountTab = "snapshot" | "holding" | "history";
const ACCOUNT_TABS: { value: AccountTab; label: string }[] = [
  { value: "snapshot", label: "Snapshot" },
  { value: "holding", label: "Holding" },
  { value: "history", label: "History" },
];

function formatSyncedAt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${formatDisplayDate(d)}, ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`;
}

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

function readAmount(text: string): number | null {
  const n = parseFloat(text.replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function getDefaultDate(selectedMonth: string): string {
  const today = todayIso();
  const todayMonth = today.slice(0, 7);
  if (todayMonth === selectedMonth) return today;
  return `${selectedMonth}-01`;
}

export default function DematSnapshotsScreen() {
  const { id, tab: openOn } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const alert = useAlert();

  const [account, setAccount] = useState<FinancialAccount | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonth());
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [fundSnapshots, setFundSnapshots] = useState<FundSnapshot[]>([]);
  const [latestPortfolio, setLatestPortfolio] = useState<number | null>(null);
  const [latestFund, setLatestFund] = useState<number | null>(null);
  const [latestDate, setLatestDate] = useState<string | null>(null);
  const [totalDeposited, setTotalDeposited] = useState<number>(0);
  const [totalWithdrawn, setTotalWithdrawn] = useState<number>(0);
  const [days, setDays] = useState<DematDay[]>([]);
  const [holdings, setHoldings] = useState<AccountHoldings[]>([]);
  // Not remembered: the page opens on Snapshot, unless a link asked for History.
  const [tab, setTab] = useState<AccountTab>(openOn === "history" ? "history" : "snapshot");
  const { query, setQuery, sort, chooseSort, view } = usePortfolioView("demat");

  // The day open in the edit pop-up
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editingPortfolioValue, setEditingPortfolioValue] = useState("");
  const [editingFundValue, setEditingFundValue] = useState("");
  const [editError, setEditError] = useState<string | undefined>(undefined);

  // Inline add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDate, setAddDate] = useState("");
  const [addPortfolio, setAddPortfolio] = useState("");
  const [addFund, setAddFund] = useState("");
  const [addFundError, setAddFundError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [loadFailed, setLoadFailed] = useState(false);
  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [acct, latest, latestF, snaps, funds, totals, stmt] = await Promise.all([
        getAccountById(id),
        getLatestSnapshot(id),
        getLatestFundSnapshot(id),
        getPortfolioSnapshotsForMonth(id, selectedMonth),
        getFundSnapshotsForMonth(id, selectedMonth),
        getDematTransferTotals(id),
        getDematDailyStatement(id, selectedMonth),
      ]);
      setAccount(acct);
      setLatestPortfolio(latest?.portfolio_value ?? null);
      setLatestDate(latest?.snapshot_date ?? null);
      setLatestFund(latestF?.fund_value ?? null);
      setSnapshots(snaps);
      setFundSnapshots(funds);
      setTotalDeposited(totals.totalDeposited);
      setTotalWithdrawn(totals.totalWithdrawn);
      setDays(stmt);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      // db not ready
    }
    // Apart from the rest: a bad saved sync must not take the account's figures down with it.
    try {
      setHoldings(getHoldingsForAccount(id));
    } catch {
      setHoldings([]);
    }
  }, [id, selectedMonth]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const handleOpenAdd = useCallback(() => {
    setAddDate(getDefaultDate(selectedMonth));
    setAddPortfolio("");
    setAddFund("");
    setAddFundError(undefined);
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
    // A withdrawal can leave idle cash below zero (it's taken off cash even when holdings were
    // sold). Carrying that forward would read as a loss on this snapshot - ask instead.
    if (addFund.trim().length === 0 && latestFund != null && latestFund < 0) {
      setAddFundError("Enter today's idle cash - it went below zero after a withdrawal");
      return;
    }
    setAddFundError(undefined);
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

  const handleDeletePortfolio = useCallback((snap: PortfolioSnapshot) => {
    alert(
      "Delete snapshot",
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
      "Delete fund snapshot",
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

  const portfolioByDate = new Map(snapshots.map((s) => [s.snapshot_date, s]));
  const fundByDate = new Map(fundSnapshots.map((f) => [f.snapshot_date, f]));
  const editingPortfolio = editingDate ? portfolioByDate.get(editingDate) : undefined;
  const editingFund = editingDate ? fundByDate.get(editingDate) : undefined;
  const editedPortfolio = readAmount(editingPortfolioValue);
  const editedFund = readAmount(editingFundValue);

  const handleSaveEdit = async () => {
    if (!editingDate) return;
    if (editingPortfolio && (editedPortfolio === null || editedPortfolio < 0)) {
      setEditError("Enter a portfolio value");
      return;
    }
    if (editingFund && editedFund === null) {
      setEditError("Enter the idle cash");
      return;
    }
    if (editingPortfolio) await addOrUpdateSnapshot(id, editingDate, editedPortfolio as number);
    if (editingFund) await addOrUpdateFundSnapshot(id, editingDate, editedFund as number);
    setEditingDate(null);
    loadData();
  };

  const accountLabel = account
    ? (account.account_label || `${account.bank_name} ****${account.account_identifier}`)
    : "Demat Account";

  const totalLatest = (latestPortfolio ?? 0) + (latestFund ?? 0);

  return (
    <ScreenContainer padTop={false}>
      {loadFailed && <LoadFailedBanner onRetry={loadData} />}
      <Stack.Screen options={{ title: "Demat Account Details" }} />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadData(); setRefreshing(false); }} />
          }
        >
          {/* Account name */}
          <View className="px-4 pt-3 pb-1 flex-row items-center">
            <Ionicons name="trending-up-outline" size={18} color={theme.primary} style={{ marginRight: 8 }} />
            <Text className="text-base font-semibold text-foreground">
              {accountLabel}
            </Text>
          </View>

          {/* Summary card */}
          <Card className="mx-4 mb-3">
            <Text className="text-xs font-semibold text-faint-foreground uppercase tracking-wider mb-3">
              Current Value
            </Text>
            <View className="flex-row justify-between mb-2">
              <View className="flex-1">
                <Text className="text-xs text-muted-foreground mb-0.5">Portfolio</Text>
                <Text className="text-base font-bold text-foreground">
                  {latestPortfolio != null ? formatAmount(latestPortfolio) : "—"}
                </Text>
              </View>
              <View className="flex-1 items-center">
                <Text className="text-xs text-muted-foreground mb-0.5">Idle Cash</Text>
                <Text className="text-base font-bold text-foreground">
                  {latestFund != null ? formatAmount(latestFund) : "—"}
                </Text>
              </View>
              <View className="flex-1 items-end">
                <Text className="text-xs text-muted-foreground mb-0.5">Total</Text>
                <Text className="text-base font-bold" style={{ color: theme.primary }}>
                  {latestPortfolio != null ? formatAmount(totalLatest) : "—"}
                </Text>
              </View>
            </View>
            {latestDate && (
              <Text className="text-label text-faint-foreground mt-1 mb-3">
                As of {formatSnapshotDate(latestDate)}
              </Text>
            )}

            {/* Transfer totals row */}
            {(totalDeposited > 0 || totalWithdrawn > 0) && (
              <>
                <View className="border-t border-border pt-3">
                  <View className="flex-row justify-between">
                    <View className="flex-1">
                      <Text className="text-xs text-muted-foreground mb-0.5">Deposited</Text>
                      <Text className="text-sm font-semibold" style={{ color: theme.success }}>
                        {formatAmount(totalDeposited)}
                      </Text>
                    </View>
                    <View className="flex-1 items-center">
                      <Text className="text-xs text-muted-foreground mb-0.5">Withdrawn</Text>
                      <Text className="text-sm font-semibold" style={{ color: theme.danger }}>
                        {totalWithdrawn > 0 ? formatAmount(totalWithdrawn) : "—"}
                      </Text>
                    </View>
                  </View>
                </View>
              </>
            )}

          </Card>

          <SegmentedControl
            accessibilityLabel="Snapshot or holding"
            className="mx-4 mb-3"
            options={ACCOUNT_TABS}
            value={tab}
            onChange={setTab}
          />

          {tab === "history" && (isBrokerHistoryOn() ? <HistoryTab accountId={id} /> : <SimpleMoneyTab accountId={id} />)}

          {/* What the linked broker held at its last sync. */}
          {tab === "holding" && holdings.length > 0 && (
            <View className="-mt-2 mb-2">
              <PortfolioSearchSort query={query} onQuery={setQuery} sort={sort} onSort={chooseSort} />
            </View>
          )}
          {tab === "holding" && holdings.length === 0 && (
            <Card className="mx-4 mb-3">
              <View className="items-center py-4">
                <Ionicons name="pulse-outline" size={28} color={colors.textSecondary} />
                <Text className="text-sm font-semibold text-foreground mt-2">No holdings for this account</Text>
                <Text className="text-xs text-muted-foreground text-center mt-1">
                  Holdings come from your broker. Link one to see them here.
                </Text>
                <View className="flex-row flex-wrap justify-center mt-3" style={{ gap: 8 }}>
                  {BROKER_SCREENS.map((b) => (
                    <Pressable
                      key={b.broker}
                      onPress={() => router.push(b.route)}
                      className="rounded-full border border-border px-3 py-1.5"
                      accessibilityRole="link"
                    >
                      <Text className="text-xs font-medium text-foreground">{b.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </Card>
          )}
          {tab === "holding" && holdings.length > 0 && holdings.every((h) => view(h.rows).length === 0) && (
            <PortfolioNoMatches query={query} />
          )}
          {tab === "holding" && holdings.map((h) => (
            <View key={h.broker}>
              <PortfolioSection
                title={holdings.length > 1 ? `${h.brokerLabel} holdings` : "Holdings"}
                rows={view(h.rows)}
                total={h.rows.length}
                top={
                  <HoldingsTotals
                    current={h.current}
                    invested={h.invested}
                    caption={`${h.brokerLabel}${h.lastSynced && formatSyncedAt(h.lastSynced) ? ` · as of ${formatSyncedAt(h.lastSynced)}` : ""}`}
                  />
                }
              />
              <Pressable
                onPress={() => router.push(h.route)}
                className="flex-row items-center justify-end mx-4 mb-3 -mt-1 py-1"
                accessibilityRole="link"
              >
                <Text className="text-xs font-semibold" style={{ color: theme.primary }}>
                  Open {h.brokerLabel} to sync
                </Text>
                <Ionicons name="chevron-forward" size={12} color={theme.primary} style={{ marginLeft: 2 }} />
              </Pressable>
            </View>
          ))}

          {/* Inline add form — appears above the table when FAB is tapped */}
          {tab === "snapshot" && showAddForm && (
            <Card className="mx-4 mb-3">
              <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Add snapshot
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
                onChangeText={(t) => {
                  setAddFund(t);
                  setAddFundError(undefined);
                }}
                keyboardType="numeric"
                formula
                error={addFundError}
                placeholder={
                  latestFund != null && latestFund >= 0
                    ? `Leave blank to carry ₹${latestFund.toLocaleString("en-IN")}`
                    : latestFund != null
                      ? "Idle cash today (needed)"
                      : "e.g. 5,000"
                }
                containerClassName="mb-3"
              />
              <View className="flex-row">
                <Pressable
                  onPress={handleCancelAdd}
                  className="flex-1 py-2.5 rounded-lg items-center mr-2 border border-border"
                >
                  <Text className="text-sm font-semibold text-muted-foreground">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSaveAdd}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-lg items-center"
                  style={{ backgroundColor: theme.primary, opacity: saving ? 0.6 : 1 }}
                >
                  <Text className="text-sm font-semibold text-primary-foreground">
                    {saving ? "Saving…" : "Save Snapshot"}
                  </Text>
                </Pressable>
              </View>
            </Card>
          )}

          {/* Day by day for the month: each snapshot, the money added or withdrawn that day,
              and the gain or loss the market made (value change minus your own money). */}
          {tab === "snapshot" && <Card className="mx-4 mb-3">
            <PeriodNavigator
              mode="month"
              value={selectedMonth}
              onChange={(m) => {
                setSelectedMonth(m);
              }}
              variant="inline"
            />

            {/* Table header */}
            <View className="flex-row items-center pt-3 pb-1.5 border-b border-border">
              <Text className="flex-1 text-label font-semibold text-faint-foreground uppercase tracking-wider">
                Date
              </Text>
              <Text className="w-28 text-right text-label font-semibold text-faint-foreground uppercase tracking-wider">
                Portfolio
              </Text>
              <Text className="w-24 text-right text-label font-semibold text-faint-foreground uppercase tracking-wider">
                Fund
              </Text>
              <View className="w-16" />
            </View>

            {/* Rows */}
            {days.length === 0 ? (
              <View className="items-center py-8">
                <Ionicons name="calendar-outline" size={28} color={colors.textSecondary} />
                <Text className="text-sm text-muted-foreground mt-2">
                  No snapshots or transfers this month
                </Text>
                <Text className="text-xs text-faint-foreground mt-1">
                  Tap + to add one
                </Text>
              </View>
            ) : (
              days.map((day, idx) => {
                const date = day.date;
                const portSnap = portfolioByDate.get(date);
                const fundSnap = fundByDate.get(date);
                const isLast = idx === days.length - 1;
                const hasSnap = portSnap != null || fundSnap != null;

                return (
                  <View key={date} className={`py-2.5 ${!isLast ? "border-b border-border" : ""}`}>
                  <View className="flex-row items-center">
                    {/* Date */}
                    <Text className="flex-1 text-xs text-muted-foreground">
                      {formatDay(date)}
                    </Text>

                    {/* Portfolio value */}
                    <View className="w-28 items-end">
                      <Text className="text-xs font-semibold text-foreground">
                        {portSnap ? formatAmount(portSnap.portfolio_value) : "—"}
                      </Text>
                    </View>

                    {/* Fund value */}
                    <View className="w-24 items-end">
                      <Text className="text-xs font-semibold text-foreground">
                        {fundSnap ? formatAmount(fundSnap.fund_value) : "—"}
                      </Text>
                    </View>

                    {/* Actions */}
                    <View className="w-16 flex-row items-center justify-end gap-1">
                      {!hasSnap ? null : (
                        <>
                          <Pressable
                            onPress={() => {
                              setEditingPortfolioValue(portSnap ? String(portSnap.portfolio_value) : "");
                              setEditingFundValue(fundSnap ? String(fundSnap.fund_value) : "");
                              setEditError(undefined);
                              setEditingDate(date);
                            }}
                            hitSlop={6}
                            className="mr-1"
                            accessibilityRole="button"
                            accessibilityLabel={`Edit ${formatDay(date)}`}
                          >
                            <Ionicons name="create-outline" size={16} color={colors.blue} />
                          </Pressable>
                          <Pressable
                            onPress={() => {
                              if (portSnap) handleDeletePortfolio(portSnap);
                              else if (fundSnap) handleDeleteFund(fundSnap);
                            }}
                            hitSlop={6}
                            accessibilityRole="button"
                            accessibilityLabel={`Delete ${formatDay(date)}`}
                          >
                            <Ionicons name="trash-outline" size={16} color={theme.danger} />
                          </Pressable>
                        </>
                      )}
                    </View>
                  </View>
                  <DayActivity day={day} />
                  </View>
                );
              })
            )}
          </Card>}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={editingDate !== null} transparent animationType="fade" onRequestClose={() => setEditingDate(null)}>
        {/* Sits high on the screen, so the keyboard can't reach it. */}
        <Pressable
          onPress={() => setEditingDate(null)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-start", paddingTop: 100, paddingHorizontal: 16 }}
        >
          <Pressable onPress={() => {}}>
            <Card>
              <Text className="text-base font-semibold text-foreground mb-3">
                {editingDate ? formatSnapshotDate(editingDate) : ""}
              </Text>
              {editingPortfolio && (
                <Input
                  label="Portfolio value"
                  value={editingPortfolioValue}
                  onChangeText={(t) => {
                    setEditingPortfolioValue(t);
                    setEditError(undefined);
                  }}
                  keyboardType="numeric"
                  formula
                  autoFocus
                  containerClassName="mb-3"
                />
              )}
              {editingFund && (
                <Input
                  label="Idle cash"
                  value={editingFundValue}
                  onChangeText={(t) => {
                    setEditingFundValue(t);
                    setEditError(undefined);
                  }}
                  keyboardType="numeric"
                  formula
                  autoFocus={!editingPortfolio}
                  containerClassName="mb-3"
                />
              )}
              {editingPortfolio && editingFund && editedPortfolio !== null && editedFund !== null && (
                <View className="flex-row justify-between mb-3">
                  <Text className="text-sm text-muted-foreground">Total</Text>
                  <Text className="text-sm font-semibold text-foreground">{formatAmount(editedPortfolio + editedFund)}</Text>
                </View>
              )}
              {editError && <Text className="text-xs mb-3" style={{ color: theme.danger }}>{editError}</Text>}
              <View className="flex-row">
                <Pressable onPress={() => setEditingDate(null)} className="flex-1 py-2.5 rounded-lg items-center mr-2 border border-border">
                  <Text className="text-sm font-semibold text-muted-foreground">Cancel</Text>
                </Pressable>
                <Pressable onPress={handleSaveEdit} className="flex-1 py-2.5 rounded-lg items-center" style={{ backgroundColor: theme.primary }}>
                  <Text className="text-sm font-semibold text-primary-foreground">Save</Text>
                </Pressable>
              </View>
            </Card>
          </Pressable>
        </Pressable>
      </Modal>

      {/* FAB — hidden while add form is open */}
      {tab === "snapshot" && !showAddForm && (
        <FAB icon="add" onPress={handleOpenAdd} accessibilityLabel="Add snapshot" />
      )}
    </ScreenContainer>
  );
}

/** Under a day's row: money added / withdrawn (with where it came from or went) and the day's gain. */
function DayActivity({ day }: { day: DematDay }) {
  const theme = useTheme();
  const showGain = day.hasSnapshot && Math.abs(day.gain) >= 0.01;
  if (day.entries.length === 0 && !showGain && !day.isStart) return null;
  return (
    <View className="mt-1">
      {day.entries.map((e) => (
        <View key={e.id} className="flex-row items-center mt-0.5">
          <Ionicons
            name={e.direction === "in" ? "arrow-down-circle-outline" : "arrow-up-circle-outline"}
            size={13}
            color={e.direction === "in" ? theme.success : theme.danger}
          />
          <Text className="text-xs text-muted-foreground ml-1 flex-1" numberOfLines={1}>
            {e.direction === "in" ? `Added from ${e.counterparty}` : `Withdrawn to ${e.counterparty}`}
          </Text>
          <Text className="text-xs font-semibold" style={{ color: e.direction === "in" ? theme.success : theme.danger }}>
            {e.direction === "in" ? "+" : "−"}{formatAmount(e.amount)}
          </Text>
        </View>
      ))}
      {day.isStart && (
        <View className="flex-row items-center mt-0.5">
          <Ionicons name="flag-outline" size={13} color={theme.mutedForeground} />
          <Text className="text-xs text-muted-foreground ml-1">Starting value - gains are counted from here</Text>
        </View>
      )}
      {showGain && (
        <View className="flex-row items-center mt-0.5">
          <Ionicons
            name={day.gain > 0 ? "trending-up-outline" : "trending-down-outline"}
            size={13}
            color={day.gain > 0 ? theme.success : theme.danger}
          />
          <Text className="text-xs text-muted-foreground ml-1 flex-1" numberOfLines={1}>
            {day.gain > 0 ? "Market gain" : "Market loss"}
            {day.gainSince ? ` since ${formatDay(day.gainSince)}` : ""}
          </Text>
          <Text className="text-xs font-semibold" style={{ color: day.gain > 0 ? theme.success : theme.danger }}>
            {day.gain > 0 ? "+" : "−"}{formatAmount(Math.abs(day.gain))}
            {day.gainPct != null ? ` (${day.gain > 0 ? "+" : "−"}${Math.abs(day.gainPct).toFixed(1)}%)` : ""}
          </Text>
        </View>
      )}
    </View>
  );
}


