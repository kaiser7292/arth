/**
 * Hisaab Ledger Screen — Task 15.1
 *
 * Shows all entries for one person: debits, credits, settlements.
 * Running balance, add entry form, edit/delete entries.
 */

import { useState, useCallback, useMemo } from "react";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useBackOverride } from "@/hooks/use-back-override";
import { View, ScrollView, Pressable, KeyboardAvoidingView } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, DateInput, FAB, Input, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { useAlert } from "@/hooks/use-alert";

import {
  getEntries,
  getEntriesByDateRange,
  createEntry,
  updateEntry,
  deleteEntry,
  getPersonBalance,
  getPerson,
  recordSettlement,
  enrichEntriesFromExpenses,
  getLinkedAccountIdsForEntries,
  getBalanceAsOfDate,
} from "@/services/hisaab";
import type { HisaabEntry, HisaabPerson } from "@/services/hisaab";
import { getCategories } from "@/services/category";
import { formatAmount } from "@/utils/expense-validation";
import { ExportFormatPicker } from "@/components/hisaab/ExportFormatPicker";
import { AccountPickerSheet } from "@/components/expense/AccountPickerSheet";
import { getActiveAccounts } from "@/services/financial-account";
import { useTheme } from "@/hooks/use-theme";

type ViewMode = "list" | "add_entry" | "settle";
type EntryType = "debit" | "credit";
type SortOption = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

export default function LedgerScreen() {
  const alert = useAlert();
  const { personId, personName, fromDate: fromDateParam, toDate: toDateParam } = useLocalSearchParams<{
    personId: string;
    personName: string;
    fromDate?: string;
    toDate?: string;
  }>();
  const router = useRouter();
  const { colors, colorScheme } = useColorScheme();
  const theme = useTheme();

  const [person, setPerson] = useState<HisaabPerson | null>(null);
  const [entries, setEntries] = useState<HisaabEntry[]>([]);
  const [balance, setBalance] = useState(0);
  // v16.0.5 — when a date filter is active, these hold the balance as it
  // stood at filter start (exclusive of the start date's entries by the
  // service's contract? Actually `getBalanceAsOfDate` is exclusive of the
  // passed date — we pass filterFrom which means entries ON that date are
  // NOT in the opening, matching the account-ledger convention where a
  // month's opening is the close of the day before).
  const [openingBalance, setOpeningBalance] = useState(0);
  const [closingBalance, setClosingBalance] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const backToList = useCallback(() => setViewMode("list"), []);
  useBackOverride(viewMode !== "list", backToList);

  // Filter & sort state — seeded from URL params when navigating from expense split
  const [showFilters, setShowFilters] = useState(() => !!(fromDateParam && toDateParam));
  const [filterFrom, setFilterFrom] = useState(fromDateParam ?? "");
  const [filterTo, setFilterTo] = useState(toDateParam ?? "");
  const [filterActive, setFilterActive] = useState(!!(fromDateParam && toDateParam));
  const [sortBy, setSortBy] = useState<SortOption>("date_desc");

  // Export picker state
  const [showExportPicker, setShowExportPicker] = useState(false);

  // Category + account name lookup for display
  const [categoryMap, setCategoryMap] = useState<Map<string, string>>(new Map());
  const [accountMap, setAccountMap] = useState<Map<string, string>>(new Map());
  const [accountIdMap, setAccountIdMap] = useState<Map<string, string>>(new Map());

  // Entry form state
  const [formAmount, setFormAmount] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formDate, setFormDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [formType, setFormType] = useState<EntryType>("debit");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Settlement form state
  const [settleAmount, setSettleAmount] = useState("");
  const [settleDescription, setSettleDescription] = useState("");
  const [settleDate, setSettleDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [settleAccountId, setSettleAccountId] = useState<string | null>(null);
  const [settleAccountLabel, setSettleAccountLabel] = useState("");
  const [showSettleAccountPicker, setShowSettleAccountPicker] = useState(false);

  const loadData = useCallback(async () => {
    if (!personId) return;
    try {
      const rangeActive = filterActive && !!filterFrom && !!filterTo;
      const entriesPromise = rangeActive
        ? getEntriesByDateRange(personId, filterFrom, filterTo)
        : getEntries(personId);
      // v16.0.5 — opening balance (as of filterFrom, exclusive) only
      // needed when a filter is active. Running balance = opening +
      // (range debits) − (range credits + settlements).
      const openingPromise = rangeActive
        ? getBalanceAsOfDate(personId, filterFrom)
        : Promise.resolve(0);
      const [personData, entriesData, bal, cats, opening] = await Promise.all([
        getPerson(personId),
        entriesPromise,
        getPersonBalance(personId),
        getCategories(DEFAULT_USER_ID),
        openingPromise,
      ]);
      setPerson(personData);
      setBalance(bal);
      const catMap = new Map<string, string>();
      for (const c of cats) catMap.set(c.id, c.name);
      setCategoryMap(catMap);
      const [acctMap, acctIdMap] = await Promise.all([
        enrichEntriesFromExpenses(entriesData),
        getLinkedAccountIdsForEntries(entriesData),
      ]);
      setEntries(entriesData);
      setAccountMap(acctMap);
      setAccountIdMap(acctIdMap);
      if (rangeActive) {
        // Closing = opening + debits − (credits + settlements) in range.
        let debitsInRange = 0;
        let creditsInRange = 0;
        for (const e of entriesData) {
          if (e.type === "debit") debitsInRange += e.amount;
          else creditsInRange += e.amount; // credit + settlement both reduce balance
        }
        setOpeningBalance(opening);
        setClosingBalance(opening + debitsInRange - creditsInRange);
      } else {
        setOpeningBalance(0);
        setClosingBalance(0);
      }
    } catch {
      // DB not ready
    }
    setLoaded(true);
  }, [personId, filterActive, filterFrom, filterTo]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  // ─── Actions ───────────────────────────────────────────

  const handleSaveEntry = async () => {
    const amount = parseFloat(formAmount);
    if (isNaN(amount) || amount <= 0) {
      alert("Invalid Amount", "Enter a valid positive amount.");
      return;
    }

    if (editingId) {
      await updateEntry(editingId, {
        amount,
        description: formDescription.trim() || undefined,
        date: formDate,
        type: formType,
      });
    } else {
      await createEntry({
        hisaab_person_id: personId!,
        amount,
        description: formDescription.trim() || undefined,
        date: formDate,
        type: formType,
      });
    }

    resetForm();
    await loadData();
  };

  const handleSettlement = async () => {
    const amount = parseFloat(settleAmount);
    if (isNaN(amount) || amount <= 0) {
      alert("Invalid Amount", "Enter a valid settlement amount.");
      return;
    }

    await recordSettlement(
      personId!,
      amount,
      settleDate,
      settleDescription.trim() || undefined,
      settleAccountId ?? undefined,
    );

    setSettleAmount("");
    setSettleDescription("");
    setSettleDate(new Date().toISOString().split("T")[0]);
    setSettleAccountId(null);
    setSettleAccountLabel("");
    setViewMode("list");
    await loadData();
  };

  const handleDeleteEntry = (entry: HisaabEntry) => {
    alert("Delete Entry", `Delete this ${entry.type} of ${formatAmount(entry.amount)}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteEntry(entry.id);
          await loadData();
        },
      },
    ]);
  };

  const handleEditEntry = (entry: HisaabEntry) => {
    setEditingId(entry.id);
    setFormAmount(String(entry.amount));
    setFormDescription(entry.description ?? "");
    setFormDate(entry.date);
    setFormType(entry.type === "settlement" ? "credit" : entry.type);
    setViewMode("add_entry");
  };

  const handleShare = () => {
    setShowExportPicker(true);
  };

  const resetForm = () => {
    setFormAmount("");
    setFormDescription("");
    setFormDate(new Date().toISOString().split("T")[0]);
    setFormType("debit");
    setEditingId(null);
    setViewMode("list");
  };

  // ─── Filter & Sort ─────────────────────────────────────

  const handleApplyFilter = useCallback(() => {
    if (!filterFrom || !filterTo) return;
    if (filterFrom > filterTo) return;
    setFilterActive(true);
  }, [filterFrom, filterTo]);

  const handleClearFilter = useCallback(() => {
    setFilterFrom("");
    setFilterTo("");
    setFilterActive(false);
  }, []);

  const sortedEntries = useMemo(() => {
    const sorted = [...entries];
    switch (sortBy) {
      case "date_desc":
        sorted.sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
        break;
      case "date_asc":
        sorted.sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));
        break;
      case "amount_desc":
        sorted.sort((a, b) => b.amount - a.amount);
        break;
      case "amount_asc":
        sorted.sort((a, b) => a.amount - b.amount);
        break;
    }
    return sorted;
  }, [entries, sortBy]);

  // ─── Loading ───────────────────────────────────────────

  if (!loaded) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Loading ledger..." icon="book-outline" />
      </ScreenContainer>
    );
  }

  // ─── Settlement Form ───────────────────────────────────

  if (viewMode === "settle") {
    return (
      <ScreenContainer padTop={false}>
        <KeyboardAvoidingView
          behavior="padding"
          className="flex-1"
        >
          <ScrollView
            className="flex-1"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
          >
            <View className="px-4 py-4">
              <Card title="Record Settlement" className="mb-4">
                <Text className="text-sm text-muted-foreground mb-3">
                  Current balance:{" "}
                  <Text
                    className={`font-bold ${balance >= 0 ? "text-success" : "text-danger"}`}
                  >
                    {formatAmount(Math.abs(balance))}
                  </Text>{" "}
                  {balance >= 0 ? "(they owe you)" : "(you owe them)"}
                </Text>
                <Input
                  label="Settlement Amount (Rs)"
                  value={settleAmount}
                  onChangeText={setSettleAmount}
                  keyboardType="numeric"
                  formula
                  placeholder={`e.g. ${Math.abs(balance)}`}
                  containerClassName="mb-3"
                />
                <DateInput
                  label="Date"
                  value={settleDate}
                  onChange={setSettleDate}
                  containerClassName="mb-3"
                />
                <Input
                  label="Description (optional)"
                  value={settleDescription}
                  onChangeText={setSettleDescription}
                  placeholder="e.g. GPay transfer"
                  maxLength={200}
                  containerClassName="mb-3"
                />

                {/* Optional: which account received the money */}
                <Text className="text-xs font-medium text-muted-foreground mb-1">
                  Received in (optional)
                </Text>
                <Pressable
                  onPress={() => setShowSettleAccountPicker(true)}
                  className="flex-row items-center border rounded-lg px-3 py-2.5 mb-4"
                  style={{ borderColor: colors.border }}
                >
                  <Ionicons name="wallet-outline" size={16} color={settleAccountId ? theme.primary : colors.textSecondary} />
                  <Text
                    className="flex-1 text-sm ml-2"
                    style={{ color: settleAccountId ? colors.text : colors.textSecondary }}
                  >
                    {settleAccountLabel || "No account - external payment"}
                  </Text>
                  {settleAccountId && (
                    <Pressable
                      onPress={() => { setSettleAccountId(null); setSettleAccountLabel(""); }}
                      hitSlop={8}
                    >
                      <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
                    </Pressable>
                  )}
                  {!settleAccountId && (
                    <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
                  )}
                </Pressable>

                <View className="flex-row">
                  <View className="flex-1 mr-2">
                    <Button
                      title="Cancel"
                      variant="outline"
                      onPress={() => setViewMode("list")}
                    />
                  </View>
                  <View className="flex-1">
                    <Button title="Record" onPress={handleSettlement} />
                  </View>
                </View>
              </Card>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        <AccountPickerSheet
          visible={showSettleAccountPicker}
          onSelect={(id) => {
            (async () => {
              const accts = await getActiveAccounts(DEFAULT_USER_ID);
              const acct = accts.find((a) => a.id === id);
              setSettleAccountId(id);
              setSettleAccountLabel(
                acct ? (acct.account_label || `${acct.bank_name} ****${acct.account_identifier}`) : "Selected",
              );
              setShowSettleAccountPicker(false);
            })();
          }}
          onClose={() => setShowSettleAccountPicker(false)}
          title="Received in which account?"
          filterTypes={["savings"]}
        />
      </ScreenContainer>
    );
  }

  // ─── Add/Edit Entry Form ───────────────────────────────

  if (viewMode === "add_entry") {
    return (
      <ScreenContainer padTop={false}>
        <KeyboardAvoidingView
          behavior="padding"
          className="flex-1"
        >
          <ScrollView
            className="flex-1"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
          >
            <View className="px-4 py-4">
              <Card
                title={editingId ? "Edit Entry" : "Add Entry"}
                className="mb-4"
              >
                {/* Type selector */}
                <Text className="text-xs font-medium text-muted-foreground mb-2">
                  Type
                </Text>
                <View className="flex-row mb-3">
                  <Pressable
                    onPress={() => setFormType("debit")}
                    className={`flex-1 py-2 rounded-l-lg items-center border ${
                      formType === "debit"
                        ? "bg-danger/8"
                        : "bg-transparent border-border"
                    }`}
                    style={formType === "debit" ? { borderColor: theme.danger } : undefined}
                  >
                    <Text
                      className={`text-sm font-medium ${
                        formType === "debit"
                          ? "text-danger"
                          : "text-muted-foreground"
                      }`}
                    >
                      Debit (they owe)
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setFormType("credit")}
                    className={`flex-1 py-2 rounded-r-lg items-center border border-l-0 ${
                      formType === "credit"
                        ? "bg-success/8"
                        : "bg-transparent border-border"
                    }`}
                    style={formType === "credit" ? { borderColor: theme.success } : undefined}
                  >
                    <Text
                      className={`text-sm font-medium ${
                        formType === "credit"
                          ? "text-success"
                          : "text-muted-foreground"
                      }`}
                    >
                      Credit (they paid)
                    </Text>
                  </Pressable>
                </View>

                <Input
                  label="Amount (Rs)"
                  value={formAmount}
                  onChangeText={setFormAmount}
                  keyboardType="numeric"
                  formula
                  placeholder="e.g. 3000"
                  containerClassName="mb-3"
                />
                <DateInput
                  label="Date"
                  value={formDate}
                  onChange={setFormDate}
                  containerClassName="mb-3"
                />
                <Input
                  label="Description (optional)"
                  value={formDescription}
                  onChangeText={setFormDescription}
                  placeholder="e.g. Dinner bill, Movie tickets"
                  containerClassName="mb-4"
                />
                <View className="flex-row">
                  <View className="flex-1 mr-2">
                    <Button
                      title="Cancel"
                      variant="outline"
                      onPress={resetForm}
                    />
                  </View>
                  <View className="flex-1">
                    <Button
                      title={editingId ? "Update" : "Add"}
                      onPress={handleSaveEntry}
                    />
                  </View>
                </View>
              </Card>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </ScreenContainer>
    );
  }

  // ─── Main Ledger ───────────────────────────────────────

  const isPositive = balance >= 0;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <View className="px-4 py-4">
          {/* Balance Header */}
          <Card className="mb-4">
            <View className="items-center py-2">
              <Text className="text-xs text-muted-foreground mb-1">
                {personName || person?.name}
              </Text>
              <Text
                className={`text-2xl font-bold ${isPositive ? "text-success" : "text-danger"}`}
              >
                {isPositive ? "+" : ""}
                {formatAmount(balance)}
              </Text>
              <Text className="text-sm text-muted-foreground mt-1">
                {balance === 0
                  ? "All settled up"
                  : isPositive
                    ? "owes you"
                    : "you owe"}
              </Text>

              {/* Quick actions */}
              <View className="flex-row mt-3">
                <Pressable
                  onPress={() => setViewMode("settle")}
                  className="flex-row items-center px-3 py-1.5 rounded-full mr-2"
                  style={{ backgroundColor: theme.alpha("primary", 0.08) }}
                >
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={14}
                    color={colors.blue}
                  />
                  <Text className="text-xs font-medium ml-1" style={{ color: theme.primary }}>
                    Settle
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleShare}
                  className="flex-row items-center px-3 py-1.5 rounded-full mr-2"
                  style={{ backgroundColor: theme.alpha("primary", 0.08) }}
                >
                  <Ionicons
                    name="download-outline"
                    size={14}
                    color={colors.blue}
                  />
                  <Text className="text-xs font-medium ml-1" style={{ color: theme.primary }}>
                    Export
                  </Text>
                </Pressable>
                {person?.phone && (
                  <View className="flex-row items-center px-3 py-1.5 rounded-full bg-border/40">
                    <Ionicons
                      name="call-outline"
                      size={14}
                      color={colors.textSecondary}
                    />
                    <Text className="text-xs text-muted-foreground ml-1">
                      {person.phone}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </Card>

          {/* Filter & Sort Bar */}
          <View className="flex-row items-center justify-between mb-3">
            <Pressable
              onPress={() => setShowFilters(!showFilters)}
              className="flex-row items-center px-3 py-1.5 rounded-full border"
              style={filterActive
                ? { borderColor: theme.primary, backgroundColor: theme.alpha("primary", 0.1) }
                : { borderColor: colors.border }
              }
            >
              <Ionicons
                name="funnel-outline"
                size={14}
                color={filterActive ? theme.primary : colors.textSecondary}
              />
              <Text
                className="text-xs font-medium ml-1"
                style={{ color: filterActive ? theme.primary : colors.textSecondary }}
              >
                {filterActive ? `${filterFrom} → ${filterTo}` : "Filter"}
              </Text>
              {filterActive && (
                <Pressable onPress={handleClearFilter} hitSlop={6} className="ml-1.5">
                  <Ionicons name="close-circle" size={14} color={theme.primary} />
                </Pressable>
              )}
            </Pressable>

            {/* Sort chips */}
            <View className="flex-row items-center">
              {([
                { key: "date_desc" as SortOption, icon: "arrow-down" as const, label: "New" },
                { key: "date_asc" as SortOption, icon: "arrow-up" as const, label: "Old" },
                { key: "amount_desc" as SortOption, icon: "trending-down" as const, label: "₹↓" },
                { key: "amount_asc" as SortOption, icon: "trending-up" as const, label: "₹↑" },
              ]).map((opt) => (
                <Pressable
                  key={opt.key}
                  onPress={() => setSortBy(opt.key)}
                  className="px-2 py-1 rounded-full ml-1"
                  style={sortBy === opt.key
                    ? { backgroundColor: theme.alpha("primary", 0.1) }
                    : undefined
                  }
                >
                  <Text
                    className="text-label font-semibold"
                    style={{ color: sortBy === opt.key ? theme.primary : colors.textSecondary }}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Date filter inputs */}
          {showFilters && (
            <Card className="mb-3">
              <View className="flex-row items-center mb-2">
                <View className="flex-1 mr-2">
                  <DateInput
                    label="From"
                    value={filterFrom}
                    onChange={setFilterFrom}
                  />
                </View>
                <View className="flex-1">
                  <DateInput
                    label="To"
                    value={filterTo}
                    onChange={setFilterTo}
                  />
                </View>
              </View>
              <View className="flex-row">
                {filterActive && (
                  <Pressable
                    onPress={handleClearFilter}
                    className="flex-1 py-2 rounded-lg items-center mr-2 border"
                    style={{ borderColor: colors.border }}
                  >
                    <Text className="text-xs font-medium" style={{ color: colors.textSecondary }}>
                      Clear
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={handleApplyFilter}
                  disabled={!filterFrom || !filterTo || filterFrom > filterTo}
                  className="flex-1 py-2 rounded-lg items-center"
                  style={{
                    backgroundColor: !filterFrom || !filterTo || filterFrom > filterTo
                      ? "#9CA3AF40"
                      : theme.primary,
                  }}
                >
                  <Text className="text-xs font-medium text-white">
                    Apply
                  </Text>
                </Pressable>
              </View>
              {filterFrom && filterTo && filterFrom > filterTo && (
                <Text className="text-xs text-danger mt-1">
                  'From' must be before 'To'
                </Text>
              )}
            </Card>
          )}

          {/* v16.0.5 — when filter is active, show a bank-statement-style
              opening → closing summary for the selected range. Matches
              the account ledger's semantics (opening at start, closing
              at end, range totals in between). */}
          {filterActive && (() => {
            let rangeDebits = 0;
            let rangeCredits = 0;
            let rangeSettlements = 0;
            for (const e of entries) {
              if (e.type === "debit") rangeDebits += e.amount;
              else if (e.type === "credit") rangeCredits += e.amount;
              else if (e.type === "settlement") rangeSettlements += e.amount;
            }
            const openIsPositive = openingBalance >= 0;
            const closeIsPositive = closingBalance >= 0;
            const netChange = closingBalance - openingBalance;
            const netColor = netChange === 0 ? colors.textSecondary : netChange > 0 ? theme.success : theme.danger;
            return (
              <Card className="mb-3">
                <Text
                  className="text-label font-semibold uppercase tracking-wider mb-2"
                  style={{ color: colors.textSecondary }}
                >
                  {filterFrom} → {filterTo}
                </Text>
                {/* Opening */}
                <View className="flex-row items-center justify-between py-1">
                  <Text className="text-xs" style={{ color: colors.textSecondary }}>
                    Opening balance
                  </Text>
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: openIsPositive ? theme.success : theme.danger }}
                  >
                    {openIsPositive ? "+" : ""}
                    {formatAmount(openingBalance)}
                  </Text>
                </View>
                {/* Activity */}
                {rangeDebits > 0 && (
                  <View className="flex-row items-center justify-between py-0.5">
                    <Text className="text-xs" style={{ color: colors.textSecondary }}>
                      They owed (debits)
                    </Text>
                    <Text className="text-xs font-semibold" style={{ color: theme.danger }}>
                      +{formatAmount(rangeDebits)}
                    </Text>
                  </View>
                )}
                {rangeCredits > 0 && (
                  <View className="flex-row items-center justify-between py-0.5">
                    <Text className="text-xs" style={{ color: colors.textSecondary }}>
                      They paid (credits)
                    </Text>
                    <Text className="text-xs font-semibold" style={{ color: theme.success }}>
                      −{formatAmount(rangeCredits)}
                    </Text>
                  </View>
                )}
                {rangeSettlements > 0 && (
                  <View className="flex-row items-center justify-between py-0.5">
                    <Text className="text-xs" style={{ color: colors.textSecondary }}>
                      Settlements
                    </Text>
                    <Text className="text-xs font-semibold" style={{ color: theme.success }}>
                      −{formatAmount(rangeSettlements)}
                    </Text>
                  </View>
                )}
                {/* Net change */}
                <View className="flex-row items-center justify-between py-1 mt-1 pt-2 border-t border-border">
                  <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
                    Net change in range
                  </Text>
                  <Text className="text-sm font-semibold" style={{ color: netColor }}>
                    {netChange > 0 ? "+" : ""}
                    {formatAmount(netChange)}
                  </Text>
                </View>
                {/* Closing */}
                <View className="flex-row items-center justify-between py-1 mt-1">
                  <Text className="text-xs font-bold" style={{ color: colors.text }}>
                    Closing balance
                  </Text>
                  <Text
                    className="text-base font-bold"
                    style={{ color: closeIsPositive ? theme.success : theme.danger }}
                  >
                    {closeIsPositive ? "+" : ""}
                    {formatAmount(closingBalance)}
                  </Text>
                </View>
                <Text className="text-label mt-1" style={{ color: colors.textSecondary }}>
                  {closeIsPositive
                    ? "They owe you as of filter end."
                    : closingBalance < 0
                      ? "You owe them as of filter end."
                      : "All settled as of filter end."}
                </Text>
              </Card>
            );
          })()}

          {/* Entry count */}
          {sortedEntries.length > 0 && (
            <Text className="text-xs text-faint-foreground mb-2">
              {sortedEntries.length} {sortedEntries.length === 1 ? "entry" : "entries"}
              {filterActive ? " (filtered)" : ""}
            </Text>
          )}

          {/* Entries */}
          {sortedEntries.length === 0 ? (
            <Card className="mb-4">
              <View className="items-center py-4">
                <Ionicons name="document-text-outline" size={48} color={colors.textSecondary} />
                <Text className="text-base font-medium text-foreground mt-2">
                  {filterActive ? "No entries in this range" : "No entries yet"}
                </Text>
                <Text className="text-sm text-muted-foreground mt-1 text-center">
                  {filterActive ? "Try a different date range" : "Add a debit or credit to start tracking"}
                </Text>
              </View>
            </Card>
          ) : (
            sortedEntries.map((entry) => {
              const linkedAccountId = accountIdMap.get(entry.id);
              const isSettlementWithAccount =
                entry.type === "settlement" && !!linkedAccountId;
              return (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  onPress={() => {
                    if (isSettlementWithAccount) {
                      const month = entry.date.slice(0, 7);
                      router.push({
                        pathname: "/reconciliation/account-ledger",
                        params: { accountId: linkedAccountId!, month },
                      });
                      return;
                    }
                    if (entry.linked_expense_id) {
                      router.push(`/expense/${entry.linked_expense_id}`);
                      return;
                    }
                    handleEditEntry(entry);
                  }}
                  onLongPress={() => handleDeleteEntry(entry)}
                  onViewExpense={(expenseId) => router.push(`/expense/${expenseId}`)}
                  categoryMap={categoryMap}
                  accountMap={accountMap}
                />
              );
            })
          )}

          {sortedEntries.length > 0 && (
            <Text className="text-xs text-faint-foreground text-center mt-2">
              Tap to view/edit. Long-press to delete.
            </Text>
          )}
        </View>
      </ScrollView>

      {/* FAB */}
      <FAB icon="add" onPress={() => setViewMode("add_entry")} />

      {/* Export Format Picker */}
      <ExportFormatPicker
        visible={showExportPicker}
        onClose={() => setShowExportPicker(false)}
        target={{ type: "person", personId: personId!, userId: DEFAULT_USER_ID }}
      />

      {/* Account picker for settlement */}
      <AccountPickerSheet
        visible={showSettleAccountPicker}
        onSelect={(id) => {
          (async () => {
            const accts = await getActiveAccounts(DEFAULT_USER_ID);
            const acct = accts.find((a) => a.id === id);
            setSettleAccountId(id);
            setSettleAccountLabel(
              acct ? (acct.account_label || `${acct.bank_name} ****${acct.account_identifier}`) : "Selected",
            );
            setShowSettleAccountPicker(false);
          })();
        }}
        onClose={() => setShowSettleAccountPicker(false)}
        title="Received in which account?"
        filterTypes={["savings"]}
      />
    </ScreenContainer>
  );
}

// ─── Entry Card Component ───────────────────────────────

function EntryCard({
  entry,
  onPress,
  onLongPress,
  onViewExpense,
  categoryMap,
  accountMap,
}: {
  entry: HisaabEntry;
  onPress: () => void;
  onLongPress: () => void;
  onViewExpense?: (expenseId: string) => void;
  categoryMap?: Map<string, string>;
  accountMap?: Map<string, string>;
}) {
  const { colors, colorScheme } = useColorScheme();
  const theme = useTheme();
  const isDebit = entry.type === "debit";
  const isSettlement = entry.type === "settlement";
  const isCredit = entry.type === "credit";

  const icon = isDebit
    ? "arrow-up-outline"
    : isSettlement
      ? "checkmark-circle-outline"
      : "arrow-down-outline";
  const color = isDebit ? theme.danger : theme.success;
  const prefix = isDebit ? "+" : "-";
  const label = isDebit ? "They owe" : isSettlement ? "Settlement" : "They paid";

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress}>
      <Card className="mb-2">
        <View className="flex-row items-center">
          {/* Icon */}
          <View
            className="w-7 h-7 rounded-full items-center justify-center mr-3"
            style={{ backgroundColor: `${color}14` }}
          >
            <Ionicons name={icon} size={16} color={color} />
          </View>

          {/* Description + date */}
          <View className="flex-1">
            <Text
              className="text-sm font-medium text-foreground"
              numberOfLines={1}
            >
              {entry.description || label}
            </Text>
            {(entry.category_id || entry.merchant_name || accountMap?.get(entry.id)) && (
              <Text className="text-label text-faint-foreground" numberOfLines={1}>
                {[entry.category_id ? categoryMap?.get(entry.category_id) : null, entry.merchant_name, accountMap?.get(entry.id)].filter(Boolean).join(" · ")}
              </Text>
            )}
            <View className="flex-row items-center">
              <Text className="text-xs text-muted-foreground">
                {entry.date}
                {isSettlement && " · Settlement"}
                {entry.status !== "confirmed" &&
                  ` · ${entry.status}`}
              </Text>
              {entry.linked_expense_id && onViewExpense && (
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation?.();
                    onViewExpense(entry.linked_expense_id!);
                  }}
                  className="flex-row items-center ml-2 px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: theme.alpha("primary", 0.1) }}
                  hitSlop={4}
                >
                  <Ionicons name="receipt-outline" size={10} color={colors.blue} />
                  <Text className="text-label font-medium ml-0.5" style={{ color: theme.primary }}>
                    Expense
                  </Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* Amount */}
          <Text className={`text-sm font-bold`} style={{ color }}>
            {prefix}
            {formatAmount(entry.amount)}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}
