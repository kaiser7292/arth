/**
 * Hisaab Ledger Screen — Task 15.1
 *
 * Shows all entries for one person: debits, credits, settlements.
 * Running balance, add entry form, edit/delete entries.
 */

import { transactionDayLabel } from "@/utils/day-label";
import { useState, useCallback, useMemo, useRef } from "react";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getDatabase } from "@/database";
import { useBackOverride } from "@/hooks/use-back-override";
import { View, ScrollView, Pressable, KeyboardAvoidingView } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ActionRow, Card, Chip, DateInput, GroupHeading, Input, ListToolbar, LoadFailed, LoadingState, ScreenContainer, Segmented, Text, type ActionRowItem } from "@/components/ui";
import { HeaderPill, Statement } from "@/components/ui/LinkRow";
import { FormFooter, FormGroup } from "@/components/ui/FormParts";
import { useListTools } from "@/hooks/use-list-tools";
import { formatMonthLabel } from "@/utils/date";
import type { ListField, ListSort } from "@/utils/list-tools";
import { transactionTitle } from "@/utils/transaction-title";

import { useAlert } from "@/hooks/use-alert";

import {
  getEntries,
  getEntriesByDateRange,
  getLinkedTransactionTypes,
  createEntry,
  updateEntry,
  deleteEntry,
  getPersonBalance,
  getPerson,
  recordSettlement,
    recordPaidBack,
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
import { todayIso } from "@/utils/local-date";

type ViewMode = "list" | "add_entry" | "settle";
type EntryType = "debit" | "credit";


const HISAAB_TYPE_LABELS: Record<string, string> = { debit: "You paid", credit: "They paid", settlement: "Settlements" };
const newestFirst = (a: HisaabEntry, b: HisaabEntry) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at);
const HISAAB_SORTS: ListSort<HisaabEntry>[] = [
  { id: "date_desc", label: "Newest first", compare: newestFirst },
  { id: "date_asc", label: "Oldest first", compare: (a, b) => newestFirst(b, a) },
  { id: "amount_desc", label: "Amount (highest first)", compare: (a, b) => b.amount - a.amount },
  { id: "amount_asc", label: "Amount (lowest first)", compare: (a, b) => a.amount - b.amount },
];
const hisaabAmount = (e: HisaabEntry) => (e.type === "debit" ? e.amount : -e.amount);

export default function LedgerScreen() {
  const alert = useAlert();
  const [linkedTypes, setLinkedTypes] = useState<Map<string, string>>(new Map());
  const { personId, personName, fromDate: fromDateParam, toDate: toDateParam } = useLocalSearchParams<{
    personId: string;
    personName: string;
    fromDate?: string;
    toDate?: string;
  }>();
  const router = useRouter();
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
  const [loadFailed, setLoadFailed] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const backToList = useCallback(() => setViewMode("list"), []);
  useBackOverride(viewMode !== "list", backToList);

  // Filter & sort state — seeded from URL params when navigating from expense split
  const [filterActive, setFilterActive] = useState(!!(fromDateParam && toDateParam));
  // The range actually used for loading. filterFrom/filterTo are the editable
  // inputs; editing them must not re-query until Apply is tapped.
  const [appliedFrom, setAppliedFrom] = useState(fromDateParam ?? "");
  const [appliedTo, setAppliedTo] = useState(toDateParam ?? "");
  // Only the latest load may write state — an earlier unfiltered load that
  // resolves after a filtered one would otherwise overwrite the filtered list.
  const loadSeqRef = useRef(0);

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
    todayIso(),
  );
  const [formType, setFormType] = useState<EntryType>("debit");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Settlement form state
  const [settleAmount, setSettleAmount] = useState("");
  /** Which way the money went: they paid you (a settlement), or you paid them (owner, Nov 2026). */
  const [settleDirection, setSettleDirection] = useState<"received" | "paid">("received");
  const [settleDescription, setSettleDescription] = useState("");
  const [settleDate, setSettleDate] = useState(
    todayIso(),
  );
  const [settleAccountId, setSettleAccountId] = useState<string | null>(null);
  const [settleAccountLabel, setSettleAccountLabel] = useState("");
  const [showSettleAccountPicker, setShowSettleAccountPicker] = useState(false);

  const loadData = useCallback(async () => {
    if (!personId) return;
    const seq = ++loadSeqRef.current;
    try {
      const rangeActive = filterActive && !!appliedFrom && !!appliedTo;
      const entriesPromise = rangeActive
        ? getEntriesByDateRange(personId, appliedFrom, appliedTo)
        : getEntries(personId);
      // v16.0.5 — opening balance (as of filterFrom, exclusive) only
      // needed when a filter is active. Running balance = opening +
      // (range debits) − (range credits + settlements).
      const openingPromise = rangeActive
        ? getBalanceAsOfDate(personId, appliedFrom)
        : Promise.resolve(0);
      const [personData, entriesData, bal, cats, opening] = await Promise.all([
        getPerson(personId),
        entriesPromise,
        getPersonBalance(personId),
        getCategories(DEFAULT_USER_ID),
        openingPromise,
      ]);
      if (seq !== loadSeqRef.current) return;
      // Only labels the row's link, so it can't be allowed to stop the ledger loading.
      getLinkedTransactionTypes(entriesData.map((e) => e.linked_expense_id).filter((id): id is string => !!id))
        .then((types) => {
          if (seq === loadSeqRef.current) setLinkedTypes(types);
        })
        .catch(() => {});
      setPerson(personData);
      setBalance(bal);
      const catMap = new Map<string, string>();
      for (const c of cats) catMap.set(c.id, c.name);
      setCategoryMap(catMap);
      const [acctMap, acctIdMap] = await Promise.all([
        enrichEntriesFromExpenses(entriesData),
        getLinkedAccountIdsForEntries(entriesData),
      ]);
      if (seq !== loadSeqRef.current) return;
      // Together: an entry written from a household member's shared bill opens "Paid by …", my
      // share of that bill (the two carry the same household_ref).
      const refs = entriesData.filter((e) => e.household_ref && !e.linked_expense_id).map((e) => e.household_ref as string);
      if (refs.length) {
        const rows = await getDatabase().getAllAsync<{ id: string; household_ref: string }>(
          `SELECT id, household_ref FROM expenses WHERE deleted_at IS NULL AND household_ref IN (${refs.map(() => "?").join(",")});`,
          ...refs,
        );
        const byRef = new Map(rows.map((r) => [r.household_ref, r.id]));
        for (const e of entriesData) {
          if (e.household_ref && !e.linked_expense_id && byRef.has(e.household_ref)) e.linked_expense_id = byRef.get(e.household_ref) ?? null;
        }
      }
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
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
    setLoaded(true);
  }, [personId, filterActive, appliedFrom, appliedTo]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  // ─── Actions ───────────────────────────────────────────

  const handleSaveEntry = async () => {
    const amount = parseFloat(formAmount);
    if (isNaN(amount) || amount <= 0) {
      alert("Invalid amount", "Enter a valid positive amount.");
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
      alert("Invalid amount", "Enter a valid settlement amount.");
      return;
    }

    if (settleDirection === "paid") {
      // Paying someone back is spending (owner, Nov 2026): an expense, on the account it came from.
      await recordPaidBack(personId!, amount, settleDate, settleDescription.trim() || undefined, settleAccountId ?? undefined);
    } else {
      await recordSettlement(
        personId!,
        amount,
        settleDate,
        settleDescription.trim() || undefined,
        settleAccountId ?? undefined,
      );
    }

    setSettleAmount("");
    setSettleDescription("");
    setSettleDate(todayIso());
    setSettleAccountId(null);
    setSettleAccountLabel("");
    setViewMode("list");
    await loadData();
  };

  const handleDeleteEntry = (entry: HisaabEntry) => {
    if (entry.household_ref) {
      alert(
        `From ${person?.name ?? "their"}'s phone`,
        `This entry comes from ${person?.name ?? "their"}'s side of your household; it would come back on the next sync. Ask them to remove it there.`,
      );
      return;
    }
    alert("Delete entry", `Delete this ${entry.type} of ${formatAmount(entry.amount)}?`, [
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
    if (entry.household_ref) {
      alert(
        `From ${person?.name ?? "their"}'s phone`,
        `This entry comes from ${person?.name ?? "their"}'s side of your household and updates when they change it. Ask them to change it there.`,
      );
      return;
    }
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
    setFormDate(todayIso());
    setFormType("debit");
    setEditingId(null);
    setViewMode("list");
  };

  // ─── Filter & Sort ─────────────────────────────────────

  const handleClearFilter = useCallback(() => {
    setAppliedFrom("");
    setAppliedTo("");
    setFilterActive(false);
  }, []);

  const fields = useMemo<ListField<HisaabEntry>[]>(
    () => [
      { id: "date", label: "Date", keyOf: (e) => e.date.slice(0, 10), labelOf: transactionDayLabel, group: true, groupOrder: "first" },
      { id: "month", label: "Month", keyOf: (e) => e.date.slice(0, 7), labelOf: (k) => formatMonthLabel(k, "long"), group: true, groupOrder: "first" },
      { id: "type", label: "Transaction type", keyOf: (e) => e.type, labelOf: (k) => HISAAB_TYPE_LABELS[k] ?? k, group: true, filter: true },
      {
        id: "category",
        label: "Category",
        keyOf: (e) => e.category_id,
        labelOf: (k) => categoryMap.get(k) ?? "Unknown",
        noneLabel: "Uncategorized",
        group: true,
        filter: true,
        searchable: true,
      },
      { id: "merchant", label: "Merchant", keyOf: (e) => e.merchant_name?.trim(), noneLabel: "No merchant", group: true, filter: true, searchable: true },
    ],
    [categoryMap],
  );
  const hisaabSearch = useCallback(
    (e: HisaabEntry) => ({ texts: [e.description, e.merchant_name, e.category_id ? categoryMap.get(e.category_id) : null], amounts: [e.amount] }),
    [categoryMap],
  );
  const tools = useListTools<HisaabEntry>({
    screen: "hisaab_ledger",
    noun: { one: "entry", many: "entries" },
    rows: entries,
    fields,
    search: hisaabSearch,
    searchPlaceholder: "Search name or >5000",
    sorts: HISAAB_SORTS,
    amountOf: hisaabAmount,
    // Grouped by day unless you pick another grouping (owner, Nov 2026).
    defaultGroup: "date",
    // Dates decide what gets loaded and the opening and closing balance, so they stay this screen's.
    extraFilter: {
      sections: [{ key: "dates", label: "Dates", type: "dates", options: [], selectedIds: filterActive ? [appliedFrom, appliedTo] : [] }],
      chips: filterActive ? [{ key: "dates", label: `${appliedFrom} → ${appliedTo}`, onRemove: handleClearFilter }] : [],
      activeCount: filterActive ? 1 : 0,
      onReset: handleClearFilter,
      onApply: (selections) => {
        const [from, to] = selections.dates ?? [];
        if (from && to) {
          setAppliedFrom(from);
          setAppliedTo(to);
          setFilterActive(true);
        } else {
          handleClearFilter();
        }
      },
    },
  });
  const sortedEntries = tools.rows;
  const groupedEntries = tools.grouped;

  // ─── Loading ───────────────────────────────────────────

  if (!loaded) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Loading ledger..." icon="book-outline" />
      </ScreenContainer>
    );
  }

  // ─── Settlement Form ───────────────────────────────────

  const name = personName || person?.name || "";
  const firstName = name.split(" ")[0] || name;
  const settleNum = parseFloat(settleAmount);
  const accountPicker = (
    <AccountPickerSheet
      visible={showSettleAccountPicker}
      onSelect={(id) => {
        (async () => {
          const accts = await getActiveAccounts(DEFAULT_USER_ID);
          const acct = accts.find((a) => a.id === id);
          setSettleAccountId(id);
          setSettleAccountLabel(acct ? acct.account_label || `${acct.bank_name} ****${acct.account_identifier}` : "Selected");
          setShowSettleAccountPicker(false);
        })();
      }}
      onClose={() => setShowSettleAccountPicker(false)}
      title={settleDirection === "paid" ? "Paid from which account?" : "Received in which account?"}
      filterTypes={settleDirection === "paid" ? ["savings", "credit_card", "wallet"] : ["savings"]}
    />
  );

  if (viewMode === "settle") {
    const full = Math.abs(balance);
    return (
      <ScreenContainer padTop={false}>
        <Stack.Screen options={{ title: `Settle with ${firstName}` }} />
        <KeyboardAvoidingView behavior="padding" className="flex-1">
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
            <View className="px-4 py-4" style={{ gap: 12 }}>
              <FormGroup
                icon="checkmark-done-outline"
                title="Record a settlement"
                hint={
                  balance === 0
                    ? "All settled up right now"
                    : `${balance > 0 ? `${firstName} owes you` : `You owe ${firstName}`} ${formatAmount(full)}`
                }
              >
                <Segmented<"received" | "paid">
                  options={[
                    { value: "received", label: `${firstName} paid me` },
                    { value: "paid", label: `I paid ${firstName}` },
                  ]}
                  value={settleDirection}
                  onChange={setSettleDirection}
                />
                <Input
                  label="Amount"
                  prefix="₹"
                  value={settleAmount}
                  onChangeText={setSettleAmount}
                  keyboardType="numeric"
                  formula
                  placeholder={full > 0 ? String(full) : "0"}
                />
                {full > 0 && (
                  <View className="flex-row" style={{ gap: 8 }}>
                    <Chip label={`Full ${formatAmount(full)}`} on={settleNum === full} onPress={() => setSettleAmount(String(full))} />
                    <Chip
                      label={`Half ${formatAmount(Math.round(full / 2))}`}
                      on={settleNum === Math.round(full / 2)}
                      onPress={() => setSettleAmount(String(Math.round(full / 2)))}
                    />
                  </View>
                )}
                <View>
                  <Text className="text-label font-semibold text-muted-foreground mb-1.5">
                    {settleDirection === "paid" ? "Paid from (optional)" : "Received in (optional)"}
                  </Text>
                  <Pressable
                    onPress={() => setShowSettleAccountPicker(true)}
                    className="flex-row items-center rounded-control border bg-card px-3"
                    style={{ height: 52, gap: 10, borderColor: settleAccountId ? theme.primary : theme.border }}
                    accessibilityRole="button"
                    accessibilityLabel={settleAccountLabel ? `Received in ${settleAccountLabel}` : "Choose the account it came into"}
                  >
                    <Ionicons name="wallet-outline" size={18} color={settleAccountId ? theme.primary : theme.mutedForeground} />
                    <Text className="flex-1 text-body" style={{ color: settleAccountId ? theme.foreground : theme.mutedForeground }} numberOfLines={1}>
                      {settleAccountLabel || "No account · paid outside your accounts"}
                    </Text>
                    {settleAccountId ? (
                      <Pressable
                        onPress={() => {
                          setSettleAccountId(null);
                          setSettleAccountLabel("");
                        }}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Clear the account"
                      >
                        <Ionicons name="close-circle" size={18} color={theme.mutedForeground} />
                      </Pressable>
                    ) : (
                      <Ionicons name="chevron-forward" size={16} color={theme.faintForeground} />
                    )}
                  </Pressable>
                  {settleAccountId && (
                    <Text className="text-label text-muted-foreground mt-1.5">
                      {settleDirection === "paid"
                        ? "Shows as money out on that account's ledger."
                        : "Shows as money in on that account's ledger."}
                    </Text>
                  )}
                  {settleDirection === "paid" && (
                    <Text className="text-label text-muted-foreground mt-1.5">Counts as spending, like any other payment.</Text>
                  )}
                </View>
                <View className="flex-row" style={{ gap: 10 }}>
                  <DateInput label="Date" value={settleDate} onChange={setSettleDate} containerClassName="flex-1" />
                  <Input
                    label="Note (optional)"
                    value={settleDescription}
                    onChangeText={setSettleDescription}
                    placeholder="e.g. GPay transfer"
                    maxLength={200}
                    containerClassName="flex-1"
                  />
                </View>
              </FormGroup>
            </View>
          </ScrollView>
          <FormFooter
            primary={settleNum > 0 ? `Record ${formatAmount(settleNum)}` : "Record"}
            onPrimary={handleSettlement}
            onCancel={() => setViewMode("list")}
          />
        </KeyboardAvoidingView>
        {accountPicker}
      </ScreenContainer>
    );
  }

  // ─── Add/Edit Entry Form ───────────────────────────────

  if (viewMode === "add_entry") {
    return (
      <ScreenContainer padTop={false}>
        <Stack.Screen
          options={{ title: editingId ? "Edit entry" : formType === "debit" ? `Lent to ${firstName}` : `Borrowed from ${firstName}` }}
        />
        <KeyboardAvoidingView behavior="padding" className="flex-1">
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
            <View className="px-4 py-4" style={{ gap: 12 }}>
              <FormGroup icon="swap-vertical-outline" title={editingId ? "Edit entry" : "New entry"} hint={name}>
                <Segmented<"debit" | "credit">
                  options={[
                    { value: "debit", label: "Lent · they owe" },
                    { value: "credit", label: "Borrowed · they paid" },
                  ]}
                  value={formType === "credit" ? "credit" : "debit"}
                  onChange={setFormType}
                />
                <Input label="Amount" prefix="₹" value={formAmount} onChangeText={setFormAmount} keyboardType="numeric" formula placeholder="3000" />
                <DateInput label="Date" value={formDate} onChange={setFormDate} />
                <Input
                  label="Description (optional)"
                  value={formDescription}
                  onChangeText={setFormDescription}
                  placeholder="e.g. Dinner bill, movie tickets"
                />
              </FormGroup>
            </View>
          </ScrollView>
          <FormFooter
            primary={editingId ? "Save entry" : formType === "debit" ? "Record lent" : "Record borrowed"}
            onPrimary={handleSaveEntry}
            onCancel={resetForm}
          />
        </KeyboardAvoidingView>
      </ScreenContainer>
    );
  }

  // ─── Main Ledger ───────────────────────────────────────

  const startEntry = (type: "debit" | "credit") => {
    setEditingId(null);
    setFormAmount("");
    setFormDescription("");
    setFormDate(todayIso());
    setFormType(type);
    setViewMode("add_entry");
  };
  const openMore = () =>
    alert(name, person?.phone ? person.phone : undefined, [
      { text: "Export the ledger", onPress: handleShare },
      ...(person ? [{ text: "Edit person", onPress: openEditPerson }] : []),
      { text: "Cancel", style: "cancel" as const },
    ]);
  function openEditPerson() {
    router.push({ pathname: "/hisaab/persons", params: { edit: personId } });
  }

  const actions: ActionRowItem[] = [
    { key: "lent", label: "Lent", icon: "return-up-forward-outline", onPress: () => startEntry("debit") },
    { key: "borrowed", label: "Borrowed", icon: "return-down-back-outline", onPress: () => startEntry("credit") },
    {
      key: "settle",
      label: "Settle",
      icon: "checkmark-outline",
      onPress: () => {
        setSettleDirection(balance < 0 ? "paid" : "received");
        setViewMode("settle");
      },
    },
    { key: "more", label: "More", icon: "ellipsis-horizontal", onPress: openMore },
  ];

  // Opening → closing for a date range, as a statement that adds up.
  let rangeDebits = 0;
  let rangeCredits = 0;
  let rangeSettlements = 0;
  if (filterActive) {
    for (const e of entries) {
      if (e.type === "debit") rangeDebits += e.amount;
      else if (e.type === "credit") rangeCredits += e.amount;
      else if (e.type === "settlement") rangeSettlements += e.amount;
    }
  }
  const signed = (n: number) => `${n < 0 ? "−" : ""}${formatAmount(Math.abs(n))}`;

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen
        options={{
          title: "",
          headerRight: person ? () => <HeaderPill label="Edit" onPress={openEditPerson} accessibilityLabel={`Edit ${name}`} /> : undefined,
        }}
      />
      {(entries.length > 0 || filterActive) && <ListToolbar {...tools.toolbar} />}
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-4 pb-4">
          {/* Hero: who, which way, how much */}
          <View className="items-center pt-2 pb-4" style={{ gap: 2 }}>
            <View className="w-14 h-14 rounded-pill items-center justify-center mb-2" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
              <Text className="text-heading font-bold" style={{ color: theme.primary }}>
                {initialsOf(name)}
              </Text>
            </View>
            <Text className="text-heading font-semibold text-foreground" numberOfLines={1}>
              {name}
            </Text>
            <Text className="text-meta text-muted-foreground">{balance === 0 ? "All settled up" : balance > 0 ? "owes you" : "you owe"}</Text>
            <Text
              className="text-hero font-bold"
              style={{ color: balance > 0 ? theme.success : theme.foreground, fontVariant: ["tabular-nums"] }}
              numberOfLines={1}
            >
              {formatAmount(Math.abs(balance))}
            </Text>
            {person?.phone ? (
              <View className="flex-row items-center mt-1" style={{ gap: 4 }}>
                <Ionicons name="call-outline" size={13} color={theme.mutedForeground} />
                <Text className="text-meta text-muted-foreground">{person.phone}</Text>
              </View>
            ) : null}
          </View>

          <ActionRow items={actions} className="mb-4" />

          {filterActive && (
            <Card className="mb-3">
              <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                {appliedFrom} → {appliedTo}
              </Text>
              <Statement
                lines={[
                  { label: "Opening balance", amount: signed(openingBalance) },
                  ...(rangeDebits > 0 ? [{ label: "They owed (lent)", sign: "+" as const, amount: formatAmount(rangeDebits) }] : []),
                  ...(rangeCredits > 0 ? [{ label: "They paid (borrowed)", sign: "−" as const, amount: formatAmount(rangeCredits) }] : []),
                  ...(rangeSettlements > 0 ? [{ label: "Settlements", sign: "−" as const, amount: formatAmount(rangeSettlements) }] : []),
                ]}
                total={{
                  label: "Closing balance",
                  amount: signed(closingBalance),
                  sub:
                    closingBalance > 0
                      ? "They owe you as of the end of the range."
                      : closingBalance < 0
                        ? "You owe them as of the end of the range."
                        : "All settled as of the end of the range.",
                }}
              />
            </Card>
          )}

          {tools.filterSheet}

          {sortedEntries.length > 0 && (
            <Text className="text-label text-faint-foreground mb-2">
              {sortedEntries.length} {sortedEntries.length === 1 ? "entry" : "entries"}
              {filterActive ? " (filtered)" : ""}
            </Text>
          )}

          {loadFailed ? (
            <LoadFailed onRetry={loadData} />
          ) : sortedEntries.length === 0 ? (
            <Card className="mb-4">
              <View className="items-center py-4">
                <Ionicons name="document-text-outline" size={48} color={theme.faintForeground} />
                <Text className="text-body font-semibold text-foreground mt-2">
                  {tools.narrowed && entries.length > 0 ? "Nothing matches" : filterActive ? "No entries in this range" : "No entries yet"}
                </Text>
                <Text className="text-meta text-muted-foreground mt-1 text-center">
                  {tools.narrowed && entries.length > 0
                    ? "Try another name, amount or filter"
                    : filterActive
                      ? "Try a different date range"
                      : "Record what you lent or borrowed to start"}
                </Text>
              </View>
            </Card>
          ) : (
            <View className="rounded-card bg-card border border-border overflow-hidden">
              {groupedEntries.map((row, i) => {
                if (row.type === "heading") {
                  return (
                    <View key={`group-${row.key}`} className={`px-3.5 pt-2 ${i > 0 ? "border-t border-border" : ""}`}>
                      <GroupHeading label={row.label} count={row.count} total={row.total} inset={false} open={row.open} onToggle={row.onToggle} noun={row.noun} />
                    </View>
                  );
                }
                const entry = row.item;
                const linkedAccountId = accountIdMap.get(entry.id);
                const isSettlementWithAccount = entry.type === "settlement" && !!linkedAccountId;
                return (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    divider={i > 0}
                    onPress={() => {
                      if (isSettlementWithAccount) {
                        router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: linkedAccountId!, month: entry.date.slice(0, 7) } });
                        return;
                      }
                      if (entry.linked_expense_id) {
                        router.push(`/expense/${entry.linked_expense_id}`);
                        return;
                      }
                      handleEditEntry(entry);
                    }}
                    onLongPress={() =>
                      alert(entry.description?.trim() || HISAAB_TYPE_LABELS[entry.type] || "Entry", undefined, [
                        { text: "Edit", onPress: () => handleEditEntry(entry) },
                        { text: "Delete", style: "destructive", onPress: () => handleDeleteEntry(entry) },
                        { text: "Cancel", style: "cancel" },
                      ])
                    }
                    onViewExpense={(expenseId) => router.push(`/expense/${expenseId}`)}
                    categoryMap={categoryMap}
                    accountMap={accountMap}
                    linkedType={entry.linked_expense_id ? linkedTypes.get(entry.linked_expense_id) : undefined}
                  />
                );
              })}
            </View>
          )}

          {sortedEntries.length > 0 && (
            <Text className="text-label text-faint-foreground text-center mt-3">Tap to open. Long-press to edit or delete.</Text>
          )}
        </View>
      </ScrollView>

      <ExportFormatPicker
        visible={showExportPicker}
        onClose={() => setShowExportPicker(false)}
        target={{ type: "person", personId: personId!, userId: DEFAULT_USER_ID }}
      />
      {accountPicker}
    </ScreenContainer>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// ─── Entry row ──────────────────────────────────────────

function EntryRow({
  entry,
  divider,
  onPress,
  onLongPress,
  onViewExpense,
  categoryMap,
  accountMap,
  linkedType,
}: {
  linkedType?: string;
  entry: HisaabEntry;
  divider: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onViewExpense?: (expenseId: string) => void;
  categoryMap?: Map<string, string>;
  accountMap?: Map<string, string>;
}) {
  const theme = useTheme();
  const isDebit = entry.type === "debit";
  const isSettlement = entry.type === "settlement";

  // They owe you more: green (money coming to you). They paid / settled: ink.
  // One icon per meaning: a split bill, money you paid them, money they paid you, a settlement.
  const icon = isSettlement
    ? "checkmark-done-outline"
    : linkedType === "Split"
      ? "git-network-outline"
      : isDebit
        ? "return-up-forward-outline"
        : "return-down-back-outline";
  const color = isDebit ? theme.success : theme.foreground;
  const prefix = isDebit ? "+" : "−";
  const label = isDebit ? "They owe" : isSettlement ? "Settlement" : "They paid";
  const description = entry.description?.trim() || null;
  const merchant = entry.merchant_name?.trim() || null;
  // With no description the merchant is the title — don't repeat it below.
  const categoryName = entry.category_id ? categoryMap?.get(entry.category_id) : null;
  const meta = [
    entry.date,
    // With neither description nor merchant the category is the title.
    description || merchant ? categoryName : null,
    description ? merchant : null,
    accountMap?.get(entry.id),
    entry.status !== "confirmed" ? entry.status : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className={`flex-row items-center px-3.5 py-3 ${divider ? "border-t border-border" : ""}`}
      style={{ gap: 12 }}
      accessibilityRole="button"
      accessibilityLabel={`${transactionTitle(entry, categoryName, label)}, ${prefix}${formatAmount(entry.amount)}`}
      accessibilityHint="Long-press to edit or delete"
    >
      <View
        className="w-9 h-9 rounded-control items-center justify-center"
        style={{ backgroundColor: isDebit ? theme.alpha("success", 0.1) : theme.alpha("foreground", 0.06) }}
      >
        <Ionicons name={icon} size={17} color={isDebit ? theme.success : theme.mutedForeground} />
      </View>
      <View className="flex-1" style={{ minWidth: 0, gap: 2 }}>
        <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
          <Text className="text-body font-semibold text-foreground flex-1" numberOfLines={1}>
            {transactionTitle(entry, categoryName, label)}
          </Text>
          <Text className="text-body font-bold" style={{ color, fontVariant: ["tabular-nums"] }}>
            {prefix}
            {formatAmount(entry.amount)}
          </Text>
        </View>
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <Text className="text-meta text-muted-foreground flex-shrink" numberOfLines={1}>
            {meta}
          </Text>
          {entry.linked_expense_id && onViewExpense ? (
            <Chip variant="status" className="self-center"
              tone="primary"
              icon="receipt-outline"
              label={linkedType ?? "Transaction"}
              onPress={() => onViewExpense(entry.linked_expense_id!)}
            />
          ) : isSettlement ? (
            <Chip variant="status" className="self-center" label="Settlement" />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
