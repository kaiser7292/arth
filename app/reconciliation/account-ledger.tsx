import { AccountPickerSheet } from "@/components/expense/AccountPickerSheet";
import { DematTransferTargetSheet } from "@/components/expense/DematTransferTargetSheet";
import { Button, Card, DateInput, FAB, FilterChip, PeriodNavigator, ScreenContainer } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { TRANSFER_COLOR } from "@/constants/semantic-colors";
import { StatusColors } from "@/constants/theme";
import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import {
    adjustAccountAvailable,
    clearAccountLedger,
    computeUnseededBalance,
    getEarliestMonth,
    getEarliestMonthForAccounts,
    getLedgerExpenses,
    getMonthBalanceSummary,
    isAccountSeeded,
} from "@/services/account-balance";
import {
    addCredit,
    deleteCredit,
    getCreditsForMonth,
    updateCredit,
} from "@/services/account-credit";
import {
    createTransfer,
    deleteTransfer,
    getTransfersForMonth,
    reclassifyCreditAsTransfer,
} from "@/services/account-transfer";
import { getCurrentMonth } from "@/services/budget";
import type { DematTarget } from "@/services/demat-transfer";
import { handleDematTransferSideEffects } from "@/services/demat-transfer";
import type { FinancialAccount } from "@/services/financial-account";
import { getActiveAccounts, getAllAccounts } from "@/services/financial-account";
import { getPersonsByIds, getSettlementsForCredits } from "@/services/hisaab";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { formatAdjustmentDescription, formatAmount } from "@/utils/format";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

interface LedgerEntry {
  id: string;
  type: "debit" | "credit" | "transfer_in" | "transfer_out";
  amount: number;
  splitPersonName: string | null;
  description: string;
  date: string;
  source: string;
  isRefund: boolean;
  isAdjustment?: boolean;
  canDelete: boolean;
  reclassifiedAsTransfer?: boolean;
  linkedTransferId?: string | null;
  counterAccountName?: string;
  /** For shared-pool CC ledgers: which sibling card this entry came from. */
  cardLast4?: string;
  /** Original account_id — used for per-card filter in shared pools. */
  sourceAccountId?: string;
  /** v15.12.1: full SMS body preserved when a transfer was reclassified from an SMS credit/debit. */
  rawSourceText?: string | null;
  /** v15.12.1: DLT sender ID of the originating SMS. */
  sourceSmsAddress?: string | null;
  /** v15.12.1: if this credit is linked as a hisaab settlement, the person's name + id for display and deep-link. */
  linkedHisaabPersonId?: string;
  linkedHisaabPersonName?: string;
  /**
   * v15.13.1: for SMS-detected refund credits AND manual refund rows, the
   * originating expense id. Tapping the ledger row deep-links to the
   * originating expense detail so the user can audit the refund→source pair.
   */
  refundOfExpenseId?: string;
  /** v17.x: updated_at timestamp for concurrent edit protection */
  updatedAt?: string;
  /**
   * For transfers: the linked expense id if the transfer was created by
   * reclassifying an expense. Tapping the transfer row deep-links to the
   * expense detail.
   */
  linkedExpenseId?: string | null;
}

export default function AccountLedgerScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { accountId, month: monthParam, autoOpenAdjust, transferId: focusTransferId } = useLocalSearchParams<{
    accountId: string;
    month?: string;
    autoOpenAdjust?: string;
    transferId?: string;
  }>();
  const { accent, colors, colorScheme } = useColorScheme();
  // Theme-aware status colors (migrated from flat STATUS_COLORS in v14.8.0).
  const sc = StatusColors[colorScheme];
  const scrollRef = useRef<ScrollView>(null);

  // When keyboard opens for the bottom "clear ledger" area we previously
  // auto-scrolled to the end. Forms now render at top of the scroll view, so
  // auto-scroll on keyboard was actively hiding them. KeyboardAvoidingView
  // handles field visibility without this listener.

  const [month, setMonth] = useState(monthParam ?? getCurrentMonth());
  const [opening, setOpening] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [totalCredits, setTotalCredits] = useState(0);
  const [closing, setClosing] = useState(0);
  const [seeded, setSeeded] = useState(false);
  const [isCreditCard, setIsCreditCard] = useState(false);
  const [poolSiblings, setPoolSiblings] = useState<{ id: string; last4: string }[]>([]);
  const [cardFilter, setCardFilter] = useState<string>("all");
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  // All active accounts, refreshed alongside the ledger. Lets callbacks
  // (e.g. handleSaveTransfer) look up the destination account type without
  // another round-trip to the DB.
  const [allAccountsState, setAllAccountsState] = useState<FinancialAccount[]>([]);
  const [showAddCredit, setShowAddCredit] = useState(false);
  const [editingCreditId, setEditingCreditId] = useState<string | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditDescription, setCreditDescription] = useState("");
  const [creditDate, setCreditDate] = useState("");

  // Transfer form state
  const [showAddTransfer, setShowAddTransfer] = useState(false);
  const [transferDirection, setTransferDirection] = useState<"in" | "out">("in");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferDescription, setTransferDescription] = useState("");
  const [transferDate, setTransferDate] = useState("");
  const [transferAccountId, setTransferAccountId] = useState<string | null>(null);
  const [transferAccountLabel, setTransferAccountLabel] = useState("");
  const [showTransferAccountPicker, setShowTransferAccountPicker] = useState(false);

  // When a transfer lands in a demat account, open the follow-up sheet so the
  // user can declare fund/portfolio + optional bucket link. Holding the
  // context here lets us chain the two flows without prop-drilling.
  const [pendingDematTransfer, setPendingDematTransfer] = useState<
    | {
        transferId: string;
        dematAccountId: string;
        dematAccountLabel: string;
        amount: number;
        date: string;
      }
    | null
  >(null);

  // Adjust-available form state
  const [showAdjust, setShowAdjust] = useState(autoOpenAdjust === "1");
  const [adjustActual, setAdjustActual] = useState("");
  const [adjustDescription, setAdjustDescription] = useState("");

  // FAB action sheet
  const [showFabMenu, setShowFabMenu] = useState(false);

  // Convert credit to transfer
  const [showConvertPicker, setShowConvertPicker] = useState(false);
  const [convertingCreditId, setConvertingCreditId] = useState<string | null>(null);
  const [convertingCreditUpdatedAt, setConvertingCreditUpdatedAt] = useState<string | null>(null);

  // v15.12.1: Source SMS viewer — shown when the user taps a transfer row that
  // was reclassified from an SMS-sourced credit/debit.
  const [sourceSmsModal, setSourceSmsModal] = useState<
    | { body: string; address: string | null; description: string }
    | null
  >(null);

  // Account lookup for transfer display
  const [accountMap, setAccountMap] = useState<Map<string, string>>(new Map());

  // Month bounds for navigation
  const [minMonth, setMinMonth] = useState<string | undefined>(undefined);
  const maxMonth = useMemo(() => {
    const now = new Date();
    const future = new Date(now.getFullYear(), now.getMonth() + 3, 1);
    return `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const { startDate, endDate } = useMemo(() => getMonthDateRange(month), [month]);

  const filteredEntries = useMemo(() => {
    if (cardFilter === "all" || poolSiblings.length <= 1) return entries;
    return entries.filter((e) => e.sourceAccountId === cardFilter);
  }, [entries, cardFilter, poolSiblings]);

useDataRefresh(
    useCallback(async () => {
      if (!accountId) return;

      // For shared-limit CCs, sibling cards may have older activity.
      // Expand the period selector's min-month to cover the whole bank group.
      const allAccountsForMin = await getActiveAccounts(DEFAULT_USER_ID);
      const current = allAccountsForMin.find((a) => a.id === accountId);
      setIsCreditCard(current?.account_type === "credit_card");
      const groupIds =
        current?.account_type === "credit_card"
          ? allAccountsForMin
              .filter(
                (a) =>
                  a.account_type === "credit_card" &&
                  a.bank_name === current.bank_name,
              )
              .map((a) => a.id)
          : [accountId];
      const earliest =
        groupIds.length > 1
          ? await getEarliestMonthForAccounts(groupIds)
          : await getEarliestMonth(accountId);
      setMinMonth(earliest ?? undefined);

      const accountSeeded = await isAccountSeeded(accountId);
      setSeeded(accountSeeded);

      // For shared-pool CCs, aggregate ledger summary AND transactions across
      // siblings so the user sees a single pool-level ledger.
      const isPoolCC =
        current?.account_type === "credit_card" && groupIds.length > 1;
      const ledgerAccountIds = isPoolCC ? groupIds : [accountId];
      const poolIdSet = new Set(ledgerAccountIds);

      // Publish pool siblings for the filter chip row.
      if (isPoolCC) {
        const siblings = allAccountsForMin
          .filter((a) => poolIdSet.has(a.id))
          .map((a) => ({ id: a.id, last4: a.account_identifier }));
        setPoolSiblings(siblings);
      } else {
        setPoolSiblings([]);
      }

      let balanceData: { opening: number; expenses: number; credits: number; closing: number };

      if (accountSeeded) {
        // Perf (v14.8.0): parallel fan-out across pool siblings instead of a
        // serial for-await loop. Shared-pool CCs with 5 sibling cards drop
        // from 5 serial queries to 1 round-trip.
        const summaries = await Promise.all(
          ledgerAccountIds.map((id) => getMonthBalanceSummary(id, month)),
        );
        let opening = 0, expenses = 0, credits = 0, closing = 0;
        for (const summary of summaries) {
          if (!summary) continue;
          opening += summary.opening_balance;
          expenses += summary.expenses;
          credits += summary.credits;
          closing += summary.closing_balance;
        }
        balanceData = { opening, expenses, credits, closing };
      } else {
        balanceData = await computeUnseededBalance(accountId, month);
      }

      setOpening(balanceData.opening);
      setTotalExpenses(balanceData.expenses);
      setTotalCredits(balanceData.credits);
      setClosing(balanceData.closing);

      // Fetch individual transactions — aggregated across pool siblings when applicable.
      const expenseLists = await Promise.all(
        ledgerAccountIds.map((id) => getLedgerExpenses(id, startDate, endDate)),
      );
      const creditLists = await Promise.all(
        ledgerAccountIds.map((id) => getCreditsForMonth(id, startDate, endDate)),
      );
      const transferLists = await Promise.all(
        ledgerAccountIds.map((id) => getTransfersForMonth(id, startDate, endDate)),
      );
      const expenses = expenseLists.flat();
      const credits = creditLists.flat();
      // Dedup transfers — intra-pool transfers would otherwise show twice (once per side).
      const seenTransferIds = new Set<string>();
      const transfers = transferLists.flat().filter((t) => {
        if (seenTransferIds.has(t.id)) return false;
        seenTransferIds.add(t.id);
        return true;
      });
      // Perf (v14.8.0): reuse allAccountsForMin fetched above; no second
      // round-trip for the same query.
      setAllAccountsState(allAccountsForMin);

      // Build account name map for transfer display with inactive account fallback
      const activeAcctMap = new Map<string, string>();
      const inactiveAcctMap = new Map<string, { name: string; isInactive: boolean }>();
      
      // Build active account map
      for (const a of allAccountsForMin) {
        activeAcctMap.set(a.id, a.account_label || `${a.bank_name} ****${a.account_identifier}`);
      }
      
      // Fetch inactive accounts for fallback
      const allAccounts = await getAllAccounts(DEFAULT_USER_ID);
      for (const a of allAccounts) {
        if (a.is_active === 0) {
          inactiveAcctMap.set(a.id, {
            name: a.account_label || `${a.bank_name} ****${a.account_identifier}`,
            isInactive: true,
          });
        }
      }
      
      // Combined lookup function: check active first, then inactive
      const getAccountName = (accountId: string | null): string => {
        if (!accountId) return "(Account deleted)";
        
        // Check active accounts first
        const activeName = activeAcctMap.get(accountId);
        if (activeName) return activeName;
        
        // Check inactive accounts as fallback
        const inactiveInfo = inactiveAcctMap.get(accountId);
        if (inactiveInfo) return `${inactiveInfo.name} (Inactive)`;
        
        // Account not found at all
        return "(Account deleted)";
      };
      
      setAccountMap(activeAcctMap);

      // Lookup of accountId → last-4, used to stamp individual ledger entries
      // with which sibling card they belong to (shared-pool CC view).
      const last4Map = new Map<string, string>();
      if (isPoolCC) {
        for (const a of allAccountsForMin) {
          if (poolIdSet.has(a.id)) last4Map.set(a.id, a.account_identifier);
        }
      }

      // Build combined ledger entries
      const ledger: LedgerEntry[] = [];

      // Batch-resolve hisaab person names for split expenses — single query
      // via getPersonsByIds. Previously fired one getPerson() per split
      // partner (N+1).
      const personIds = Array.from(
        new Set(expenses.filter((e) => e.split_person_id).map((e) => e.split_person_id!)),
      );
      const personsById = await getPersonsByIds(personIds);
      const personMap = new Map<string, string>();
      for (const [pid, p] of personsById) personMap.set(pid, p.name);

      // v15.12.1: for every credit row, look up any linked hisaab settlement
      // (both recordSettlement-created AND linkCreditAsSettlement-linked).
      // One batch query — previously there was no UI surface for this on the
      // account ledger at all.
      const settlementByCreditId = await getSettlementsForCredits(credits.map((c) => c.id));

      for (const exp of expenses) {
        const isAdjustment = exp.nature === "ledger_adjustment";
        const isNegativeAdj = isAdjustment && (exp.description ?? "").includes(" -]");
        const type: LedgerEntry["type"] = isAdjustment
          ? (isNegativeAdj ? "debit" : "credit")
          : (exp.refund_of_expense_id ? "credit" : "debit");
        ledger.push({
          id: exp.id,
          type,
          amount: exp.split_original_amount ?? exp.amount,
          splitPersonName: exp.split_person_id ? (personMap.get(exp.split_person_id) ?? null) : null,
          description: isAdjustment
            ? formatAdjustmentDescription(exp.description)
            : (exp.description || exp.merchant_name || "Expense"),
          reclassifiedAsTransfer: exp.reclassified_as_transfer === 1,
          linkedTransferId: exp.linked_transfer_id,
          date: exp.date,
          source: exp.source,
          isRefund: !!exp.refund_of_expense_id,
          refundOfExpenseId: exp.refund_of_expense_id ?? undefined,
          isAdjustment,
          canDelete: isAdjustment,
          sourceAccountId: exp.account_id ?? undefined,
          cardLast4: exp.account_id ? last4Map.get(exp.account_id) : undefined,
        });
      }

      for (const cr of credits) {
        const settlement = settlementByCreditId.get(cr.id);
        // v15.13.1: SMS refund credits carry refund_of_expense_id pointing at
        // the original expense. Tapping the ledger row deep-links there.
        const isRefundCredit = !!cr.refund_of_expense_id;
        ledger.push({
          id: cr.id,
          type: "credit",
          amount: cr.amount,
          splitPersonName: null,
          description: cr.description || "Credit",
          linkedHisaabPersonId: settlement?.personId,
          linkedHisaabPersonName: settlement?.personName,
          date: cr.date,
          source: cr.source,
          isRefund: isRefundCredit,
          refundOfExpenseId: cr.refund_of_expense_id ?? undefined,
          canDelete: true,
          sourceAccountId: cr.account_id ?? undefined,
          cardLast4: cr.account_id ? last4Map.get(cr.account_id) : undefined,
          rawSourceText: cr.raw_source_text,
          sourceSmsAddress: cr.source_sms_address,
          updatedAt: cr.updated_at,
        });
      }

      for (const tr of transfers) {
        const isIn = poolIdSet.has(tr.to_account_id);
        const counterId = isIn ? tr.from_account_id : tr.to_account_id;
        // For pool ledgers, attribute the transfer to whichever side belongs
        // to the pool — that's the sibling the money moved in/out of.
        const poolSideId = poolIdSet.has(tr.to_account_id)
          ? tr.to_account_id
          : poolIdSet.has(tr.from_account_id)
            ? tr.from_account_id
            : undefined;
        ledger.push({
          id: tr.id,
          type: isIn ? "transfer_in" : "transfer_out",
          amount: tr.amount,
          splitPersonName: null,
          description: tr.description || "Transfer",
          date: tr.date,
          source: tr.source,
          isRefund: false,
          canDelete: true,
          counterAccountName: getAccountName(counterId),
          sourceAccountId: poolSideId,
          cardLast4: poolSideId ? last4Map.get(poolSideId) : undefined,
          rawSourceText: tr.raw_source_text,
          sourceSmsAddress: tr.source_sms_address,
          linkedExpenseId: tr.linked_expense_id,
        });
      }

      // Sort by date descending
      ledger.sort((a, b) => b.date.localeCompare(a.date));
      setEntries(ledger);
    }, [accountId, month, startDate, endDate]),
  );

  const handleStartEditCredit = useCallback((entry: LedgerEntry) => {
    setEditingCreditId(entry.id);
    setCreditAmount(String(entry.amount));
    setCreditDescription(entry.description);
    setCreditDate(entry.date);
    setShowAddCredit(true);
    // Scroll to top so the edit form is immediately visible, not hidden below
    // the transactions list.
    setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 50);
  }, []);

  const handleCancelCreditForm = useCallback(() => {
    setShowAddCredit(false);
    setEditingCreditId(null);
    setCreditAmount("");
    setCreditDescription("");
    setCreditDate("");
  }, []);

  const handleSaveCreditForm = useCallback(async () => {
    if (!accountId) return;
    const amount = parseFloat(creditAmount);
    if (isNaN(amount) || amount <= 0) {
      alert("Invalid Amount", "Please enter a valid positive amount.");
      return;
    }
    const date = creditDate.trim() || new Date().toISOString().split("T")[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      alert("Invalid Date", "Please pick a valid date.");
      return;
    }

    if (editingCreditId) {
      await updateCredit(editingCreditId, {
        amount,
        description: creditDescription.trim() || "Credit",
        date,
      });
    } else {
      await addCredit({
        accountId,
        userId: DEFAULT_USER_ID,
        amount,
        description: creditDescription.trim() || "Manual credit",
        date,
        source: "manual",
      });
    }

    handleCancelCreditForm();
  }, [accountId, creditAmount, creditDescription, creditDate, editingCreditId, handleCancelCreditForm]);

  const handleDeleteCredit = useCallback(
    (id: string, description: string) => {
      alert("Delete Credit", `Delete "${description}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteCredit(id);
          },
        },
      ]);
    },
    [],
  );

  // ── Transfer handlers ──

  const handleCancelTransferForm = useCallback(() => {
    setShowAddTransfer(false);
    setTransferAmount("");
    setTransferDescription("");
    setTransferDate("");
    setTransferAccountId(null);
    setTransferAccountLabel("");
    setTransferDirection("in");
  }, []);

  const handleSaveTransfer = useCallback(async () => {
    if (!accountId || !transferAccountId) return;
    const amount = parseFloat(transferAmount);
    // Reject NaN, Infinity, zero, negatives, and absurdly large values that
    // are almost certainly input typos rather than legitimate amounts.
    if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e12) {
      alert("Invalid Amount", "Please enter a valid positive amount.");
      return;
    }
    const fallbackDate = new Date().toISOString().split("T")[0];
    const date = transferDate.trim() || fallbackDate;
    // Only accept a fully-formed YYYY-MM-DD date (or the fallback). Prevents
    // a stray string from reaching date.slice(0,7) in the side-effect path.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      alert("Invalid Date", "Please pick a valid date.");
      return;
    }

    const toAccountId = transferDirection === "out" ? transferAccountId : accountId;
    const transferId = await createTransfer({
      userId: DEFAULT_USER_ID,
      fromAccountId: transferDirection === "out" ? accountId : transferAccountId,
      toAccountId,
      amount,
      description: transferDescription.trim() || undefined,
      date,
      source: "manual",
    });

    // If the money landed in a demat account, open the follow-up sheet so the
    // user can declare fund/portfolio + optional bucket. The sheet is
    // dismissible — skipping leaves demat_target NULL and nothing is synced
    // to snapshots or buckets. Reuses the in-memory account list populated
    // by the data-refresh effect; no extra DB round-trip.
    const toAccount = allAccountsState.find((a) => a.id === toAccountId);
    if (toAccount?.account_type === "demat") {
      const label =
        toAccount.account_label ||
        `${toAccount.bank_name} ****${toAccount.account_identifier}`;
      setPendingDematTransfer({
        transferId,
        dematAccountId: toAccount.id,
        dematAccountLabel: label,
        amount,
        date,
      });
    }

    handleCancelTransferForm();
  }, [accountId, allAccountsState, transferAccountId, transferAmount, transferDate, transferDirection, transferDescription, handleCancelTransferForm]);

  const handleConfirmDematTarget = useCallback(
    async (target: DematTarget, bucketId: string | null) => {
      if (!pendingDematTransfer) return;
      try {
        await handleDematTransferSideEffects(
          pendingDematTransfer.transferId,
          pendingDematTransfer.dematAccountId,
          pendingDematTransfer.amount,
          pendingDematTransfer.date,
          { target, bucketId },
        );
      } catch (e) {
        alert("Error", e instanceof Error ? e.message : String(e));
      } finally {
        setPendingDematTransfer(null);
      }
    },
    [pendingDematTransfer],
  );

  const handleDeleteTransfer = useCallback(
    (id: string, description: string) => {
      alert("Delete Transfer", `Delete "${description}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            // Surface errors — without this, a thrown exception in the
            // demat reverse chain silently aborts the Promise and the row
            // stays visible, making it look like "delete doesn't work".
            try {
              await deleteTransfer(id);
            } catch (e) {
              alert("Delete failed", e instanceof Error ? e.message : String(e));
            }
          },
        },
      ]);
    },
    [],
  );

  const handleConvertCreditToTransfer = useCallback(
    (creditId: string, updatedAt: string) => {
      setConvertingCreditId(creditId);
      setConvertingCreditUpdatedAt(updatedAt);
      setShowConvertPicker(true);
    },
    [],
  );

  const handleConvertConfirm = useCallback(
    async (fromAccountId: string) => {
      if (!convertingCreditId) return;
      setShowConvertPicker(false);
      try {
        await reclassifyCreditAsTransfer(convertingCreditId, fromAccountId, convertingCreditUpdatedAt ?? undefined);
      } catch (e) {
        logger.error("reclassifyCreditAsTransfer failed", e);
        alert(
          "Error",
          `Could not convert credit to transfer.${e instanceof Error ? `\n${e.message}` : ""}`,
        );
      }
      setConvertingCreditId(null);
      setConvertingCreditUpdatedAt(null);
    },
    [convertingCreditId, convertingCreditUpdatedAt],
  );

  const handleTransferAccountSelected = useCallback(
    (selectedAccountId: string) => {
      setTransferAccountId(selectedAccountId);
      setTransferAccountLabel(accountMap.get(selectedAccountId) ?? "Selected");
      setShowTransferAccountPicker(false);
    },
    [accountMap],
  );

  const handleSaveAdjustment = useCallback(async () => {
    if (!accountId) return;
    const actual = parseFloat(adjustActual.replace(/,/g, ""));
    if (isNaN(actual)) {
      alert("Invalid Amount", "Enter the actual available balance.");
      return;
    }
    const trimmed = adjustDescription.trim();
    const delta = await adjustAccountAvailable({
      accountId,
      userId: DEFAULT_USER_ID,
      actualAvailable: actual,
      // Empty string means "no reason" — formatAdjustmentDescription renders
      // these as just "Adjustment" at display time.
      description: trimmed || undefined,
    });
    setShowAdjust(false);
    setAdjustActual("");
    setAdjustDescription("");
    if (delta === 0) {
      alert("No Change", "Ledger already matches the actual available.");
    }
  }, [accountId, adjustActual, adjustDescription, alert]);

  const handleClearLedger = useCallback(() => {
    if (!accountId) return;
    alert(
      "Clear All Ledger Data",
      "This will delete all opening balance records and manual credits for this account. Expenses are not affected. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            await clearAccountLedger(accountId);
          },
        },
      ],
    );
  }, [accountId]);

  const formatEntryDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  };

  return (
    <ScreenContainer padTop={false}>
      {/* Month navigator */}
      <PeriodNavigator mode="month" value={month} onChange={setMonth} minMonth={minMonth} maxMonth={maxMonth} />

      <KeyboardAvoidingView
        className="flex-1"
        behavior="padding"
        keyboardVerticalOffset={100}
      >
        <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
          {/* Balance summary card */}
          <Card className="mx-4 mt-3 mb-2">
            {!seeded && (
              <View
                className="flex-row items-center px-3 py-2 rounded-lg mb-3"
                style={{ backgroundColor: sc.warning + "14" }}
              >
                <Ionicons name="alert-circle" size={14} color={sc.warning} />
                <Text className="text-[10px] font-medium ml-2" style={{ color: sc.warning }}>
                  No opening balance set — computed from ₹0
                </Text>
              </View>
            )}

            <View className="flex-row justify-between mb-1">
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                {isCreditCard ? "Starting utilized" : "Opening Balance"}
              </Text>
              <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                {formatAmount(opening)}
              </Text>
            </View>
            {totalExpenses > 0 && (
              <View className="flex-row justify-between mb-1">
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  {isCreditCard ? "Spent this cycle" : "Expenses"}
                </Text>
                <Text className="text-sm font-semibold" style={{ color: sc.danger }}>
                  −{formatAmount(totalExpenses)}
                </Text>
              </View>
            )}
            {totalCredits > 0 && (
              <View className="flex-row justify-between mb-1">
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  {isCreditCard ? "Paid back" : "Credits / Refunds"}
                </Text>
                <Text className="text-sm font-semibold" style={{ color: sc.success }}>
                  +{formatAmount(totalCredits)}
                </Text>
              </View>
            )}
            <View className="flex-row justify-between pt-2 mt-1 border-t border-border-light dark:border-border-dark">
              <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary">
                {isCreditCard ? "Utilized" : "Closing Balance"}
              </Text>
              <Text
                className="text-sm font-bold"
                style={{
                  color: isCreditCard
                    ? (closing === 0 ? sc.success : sc.danger)
                    : (closing >= 0 ? sc.success : sc.danger),
                }}
              >
                {formatAmount(closing)}
              </Text>
            </View>
          </Card>

          {/* Inline forms render above the transactions list so edit/add
              actions are visible without scrolling past the full ledger. */}

          {/* Credit form (inline, for add or edit) */}
          {showAddCredit && (
            <Card className="mx-4 mt-4">
              <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary uppercase tracking-wider mb-3">
                {editingCreditId ? "Edit Credit" : "Add Manual Credit"}
              </Text>
              <TextInput
                className="border border-border-light dark:border-border-dark rounded-lg px-3 py-2.5 mb-3 text-sm text-text-primary dark:text-text-dark-primary"
                placeholder="Amount"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                value={creditAmount}
                onChangeText={setCreditAmount}
              />
              <TextInput
                className="border border-border-light dark:border-border-dark rounded-lg px-3 py-2.5 mb-3 text-sm text-text-primary dark:text-text-dark-primary"
                placeholder="Description (e.g. Salary, UPI received)"
                placeholderTextColor={colors.textSecondary}
                maxLength={200}
                value={creditDescription}
                onChangeText={setCreditDescription}
              />
              <DateInput
                label="Date"
                value={creditDate || new Date().toISOString().split("T")[0]}
                onChange={setCreditDate}
                containerClassName="mb-3"
              />
              <View className="flex-row">
                <Pressable
                  onPress={handleCancelCreditForm}
                  className="flex-1 py-2.5 rounded-lg items-center mr-2 border border-border-light dark:border-border-dark"
                >
                  <Text className="text-sm font-semibold text-text-secondary dark:text-text-dark-secondary">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSaveCreditForm}
                  className="flex-1 py-2.5 rounded-lg items-center"
                  style={{ backgroundColor: accent[500] }}
                >
                  <Text className="text-sm font-semibold text-white">{editingCreditId ? "Save" : "Add Credit"}</Text>
                </Pressable>
              </View>
            </Card>
          )}

          {/* Transfer form (inline) */}
          {showAddTransfer && (
            <Card className="mx-4 mt-4">
              <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary uppercase tracking-wider mb-3">
                Add Transfer
              </Text>

              {/* Direction toggle */}
              <View className="flex-row mb-3">
                <Pressable
                  onPress={() => setTransferDirection("in")}
                  className="flex-1 py-2 rounded-l-lg items-center border"
                  style={transferDirection === "in"
                    ? { borderColor: sc.success, backgroundColor: sc.success + "14" }
                    : { borderColor: colors.border }
                  }
                >
                  <Text className="text-xs font-medium" style={{ color: transferDirection === "in" ? sc.success : colors.textSecondary }}>
                    Money In ↓
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setTransferDirection("out")}
                  className="flex-1 py-2 rounded-r-lg items-center border border-l-0"
                  style={transferDirection === "out"
                    ? { borderColor: sc.danger, backgroundColor: sc.danger + "14" }
                    : { borderColor: colors.border }
                  }
                >
                  <Text className="text-xs font-medium" style={{ color: transferDirection === "out" ? sc.danger : colors.textSecondary }}>
                    Money Out ↑
                  </Text>
                </Pressable>
              </View>

              {/* Account picker */}
              <Text className="text-[10px] font-medium text-text-secondary dark:text-text-dark-secondary mb-1">
                {transferDirection === "in" ? "From Account" : "To Account"}
              </Text>
              <Pressable
                onPress={() => setShowTransferAccountPicker(true)}
                className="flex-row items-center border rounded-lg px-3 py-2.5 mb-3"
                style={{ borderColor: colors.border }}
              >
                <Ionicons name="wallet-outline" size={16} color={transferAccountId ? accent[500] : colors.textSecondary} />
                <Text
                  className="flex-1 text-sm ml-2"
                  style={{ color: transferAccountId ? colors.text : colors.textSecondary }}
                >
                  {transferAccountLabel || "Select account"}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
              </Pressable>

              <TextInput
                className="border border-border-light dark:border-border-dark rounded-lg px-3 py-2.5 mb-3 text-sm text-text-primary dark:text-text-dark-primary"
                placeholder="Amount"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                value={transferAmount}
                onChangeText={setTransferAmount}
              />
              <TextInput
                className="border border-border-light dark:border-border-dark rounded-lg px-3 py-2.5 mb-3 text-sm text-text-primary dark:text-text-dark-primary"
                placeholder="Description (optional)"
                placeholderTextColor={colors.textSecondary}
                maxLength={200}
                value={transferDescription}
                onChangeText={setTransferDescription}
              />
              <DateInput
                label="Date"
                value={transferDate || new Date().toISOString().split("T")[0]}
                onChange={setTransferDate}
                containerClassName="mb-3"
              />
              <View className="flex-row">
                <Pressable
                  onPress={handleCancelTransferForm}
                  className="flex-1 py-2.5 rounded-lg items-center mr-2 border border-border-light dark:border-border-dark"
                >
                  <Text className="text-sm font-semibold text-text-secondary dark:text-text-dark-secondary">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSaveTransfer}
                  className="flex-1 py-2.5 rounded-lg items-center"
                  style={{ backgroundColor: transferAccountId ? accent[500] : colors.textSecondary + "40" }}
                  disabled={!transferAccountId}
                >
                  <Text className="text-sm font-semibold text-white">Add Transfer</Text>
                </Pressable>
              </View>
            </Card>
          )}

          {/* Adjust Available inline form */}
          {showAdjust && (
            <Card className="mx-4 mt-4 mb-2">
              <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary mb-1">
                Adjust available balance
              </Text>
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-3">
                Current closing: {formatAmount(closing)}. Enter the actual available and we'll add a single adjustment entry dated today.
              </Text>
              <Text className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary mb-1">Actual available</Text>
              <TextInput
                value={adjustActual}
                onChangeText={setAdjustActual}
                placeholder="e.g. 1,55,000"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                className="border rounded-lg px-3 py-2.5 mb-3 text-sm text-text-primary dark:text-text-dark-primary"
                style={{ borderColor: colors.border }}
              />
              <Text className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary mb-1">Reason (optional)</Text>
              <TextInput
                value={adjustDescription}
                onChangeText={setAdjustDescription}
                placeholder="e.g. Prepayment, untracked spend"
                placeholderTextColor={colors.textSecondary}
                className="border rounded-lg px-3 py-2.5 mb-3 text-sm text-text-primary dark:text-text-dark-primary"
                style={{ borderColor: colors.border }}
              />
              <View className="flex-row">
                <Button
                  title="Cancel"
                  onPress={() => { setShowAdjust(false); setAdjustActual(""); }}
                  variant="outline"
                  className="flex-1 mr-2 py-2.5"
                />
                <Button
                  title="Confirm Adjustment"
                  onPress={handleSaveAdjustment}
                  variant="primary"
                  className="flex-1 py-2.5"
                />
              </View>
            </Card>
          )}

          {/* Transactions header */}
          <View className="flex-row items-center justify-between mx-4 mt-3 mb-2">
            <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary uppercase tracking-wider">
              Transactions ({filteredEntries.length}{filteredEntries.length !== entries.length ? ` of ${entries.length}` : ""})
            </Text>
          </View>

          {/* Per-card filter chips — only for shared-pool CCs */}
          {poolSiblings.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="mx-4 mb-2"
              contentContainerStyle={{ paddingRight: 4, alignItems: "center" }}
            >
              <FilterChip label="All" active={cardFilter === "all"} onPress={() => setCardFilter("all")} />
              {poolSiblings.map((s) => (
                <FilterChip
                  key={s.id}
                  label={`•••• ${s.last4}`}
                  active={cardFilter === s.id}
                  onPress={() => setCardFilter(s.id)}
                />
              ))}
            </ScrollView>
          )}

          {/* Transaction list */}
          {filteredEntries.map((entry) => {
            const isTransfer = entry.type === "transfer_in" || entry.type === "transfer_out";
            const isDebitSide = entry.type === "debit" || entry.type === "transfer_out";
            const entryColor = isDebitSide ? sc.danger : sc.success;
            const transferColor = TRANSFER_COLOR;
            const isReclassified = entry.reclassifiedAsTransfer === true;
            // When the ledger is opened via a cross-link (e.g. "From transfer"
            // on an investment contribution), soft-highlight the matching
            // transfer row so the user's eye lands on it.
            const isFocused = !!focusTransferId && entry.id === focusTransferId && isTransfer;

            return (
              <Pressable
                key={entry.id}
                style={
                  isFocused
                    ? {
                        backgroundColor: accent[500] + "33",
                        borderLeftWidth: 3,
                        borderLeftColor: accent[500],
                      }
                    : undefined
                }
                onPress={
                  entry.type === "debit" && !entry.isRefund
                    ? () => router.push(`/expense/${entry.id}`)
                    : // v15.13.1: refund rows (manual refund expense OR SMS
                      // refund credit) deep-link to the originating expense
                      // when the link is known. Higher priority than hisaab /
                      // credit-edit so the refund → source flow wins.
                      entry.isRefund && entry.refundOfExpenseId
                      ? () => router.push(`/expense/${entry.refundOfExpenseId}` as never)
                      : // Manual refund rows with no link OR the row itself:
                        // still tap to open the refund row's own expense detail.
                        entry.type === "credit" && entry.isRefund && !entry.refundOfExpenseId
                        ? () => router.push(`/expense/${entry.id}`)
                        : // Transfer rows with linked expense: navigate to expense details
                        isTransfer && entry.linkedExpenseId
                        ? () => router.push(`/expense/${entry.linkedExpenseId}` as never)
                        : entry.type === "credit" && entry.linkedHisaabPersonId
                          ? () => router.push(`/hisaab/ledger?personId=${entry.linkedHisaabPersonId}` as never)
                          : // v17.6.0: SMS-detected credits show source SMS modal
                            entry.type === "credit" && entry.rawSourceText && !entry.isRefund
                            ? () =>
                                setSourceSmsModal({
                                  body: entry.rawSourceText!,
                                  address: entry.sourceSmsAddress ?? null,
                                  description: entry.description,
                                })
                            : entry.type === "credit" && entry.canDelete
                              ? () => handleStartEditCredit(entry)
                              : isTransfer && entry.rawSourceText
                                ? () =>
                                    setSourceSmsModal({
                                      body: entry.rawSourceText!,
                                      address: entry.sourceSmsAddress ?? null,
                                      description: entry.description,
                                    })
                                : undefined
                }
                onLongPress={
                  entry.type === "credit" && entry.canDelete
                    ? () => {
                          alert("Credit Options", `"${entry.description}"`, [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Convert to Transfer",
                              onPress: () => handleConvertCreditToTransfer(entry.id, entry.updatedAt || ""),
                            },
                            {
                              text: "Delete",
                              style: "destructive",
                              onPress: async () => { await deleteCredit(entry.id); },
                            },
                          ]);
                        }
                      : undefined
                }
              >
                <View className="flex-row items-center mx-4 py-3 border-b border-border-light dark:border-border-dark">
                  {/* Icon */}
                  <View
                    className="w-8 h-8 rounded-full items-center justify-center mr-3"
                    style={{
                      backgroundColor: isTransfer
                        ? transferColor + "14"
                        : entryColor + "14",
                    }}
                  >
                    <Ionicons
                      name={
                        isTransfer
                          ? "swap-horizontal"
                          : entry.isRefund
                            ? "return-down-back"
                            : isDebitSide
                              ? "arrow-up-outline"
                              : "arrow-down-outline"
                      }
                      size={14}
                      color={isTransfer ? transferColor : entryColor}
                    />
                  </View>

                  {/* Description + date */}
                  <View className="flex-1">
                    <View className="flex-row items-center">
                      <Text
                        className="text-sm text-text-primary dark:text-text-dark-primary"
                        numberOfLines={1}
                        style={{ flex: 1 }}
                      >
                        {entry.description}
                      </Text>
                      {isReclassified && (
                        <View className="ml-2 px-2 py-0.5 rounded-full" style={{ backgroundColor: transferColor + "20" }}>
                          <Text className="text-xs" style={{ color: transferColor }}>
                            Transfer
                          </Text>
                        </View>
                      )}
                    </View>
                    {isTransfer && entry.counterAccountName && (
                      <Text className="text-[10px] mt-0.5" style={{ color: transferColor }}>
                        {entry.type === "transfer_in" ? "From" : "To"} {entry.counterAccountName}
                      </Text>
                    )}
                    <View className="flex-row items-center mt-0.5">
                      <Text className="text-[10px] text-text-secondary dark:text-text-dark-secondary">
                        {formatEntryDate(entry.date)}
                      </Text>
                      {poolSiblings.length > 1 && entry.cardLast4 && (
                        <Text className="text-[10px] text-text-tertiary dark:text-text-dark-secondary ml-1.5">
                          · {"••••"} {entry.cardLast4}
                        </Text>
                      )}
                      {(entry.source === "sms_auto" || (isTransfer && !!entry.rawSourceText)) && (
                        <View className="ml-1.5 px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900">
                          <Text className="text-[8px] font-semibold text-blue-600 dark:text-blue-300">SMS</Text>
                        </View>
                      )}
                      {entry.isRefund && (
                        <View className="ml-1.5 px-1 py-0.5 rounded" style={{ backgroundColor: sc.success + "14" }}>
                          <Text className="text-[8px] font-semibold" style={{ color: sc.success }}>REFUND</Text>
                        </View>
                      )}
                      {isTransfer && (
                        <View className="ml-1.5 px-1 py-0.5 rounded" style={{ backgroundColor: transferColor + "14" }}>
                          <Text className="text-[8px] font-semibold" style={{ color: transferColor }}>TRANSFER</Text>
                        </View>
                      )}
                      {isTransfer && entry.linkedExpenseId && (
                        <View className="ml-1.5 px-1 py-0.5 rounded bg-orange-100 dark:bg-orange-900">
                          <Text className="text-[8px] font-semibold text-orange-600 dark:text-orange-300">RECLASSIFIED</Text>
                        </View>
                      )}
                      {entry.type === "credit" && entry.linkedHisaabPersonName && (
                        <View className="ml-1.5 px-1 py-0.5 rounded" style={{ backgroundColor: accent[500] + "1A" }}>
                          <Text className="text-[8px] font-semibold" style={{ color: accent[500] }} numberOfLines={1}>
                            HISAAB · {entry.linkedHisaabPersonName.toUpperCase()}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Amount */}
                  <View className="items-end shrink-0 ml-2">
                    <Text
                      className="text-sm font-bold"
                      style={{ color: isTransfer ? transferColor : entryColor }}
                    >
                      {isDebitSide ? "−" : "+"}{formatAmount(entry.amount)}
                    </Text>
                    {entry.splitPersonName && (
                      <Text className="text-[9px] text-text-secondary dark:text-text-dark-secondary mt-0.5">
                        Split w/ {entry.splitPersonName}
                      </Text>
                    )}
                  </View>

                  {/* Delete button for credits and transfers */}
                  {entry.canDelete && !isTransfer && (
                    <Pressable
                      onPress={() => handleDeleteCredit(entry.id, entry.description)}
                      className="ml-2 p-1.5"
                      hitSlop={12}
                      accessibilityRole="button"
                      accessibilityLabel="Delete entry"
                    >
                      <Ionicons name="trash-outline" size={18} color={sc.danger} />
                    </Pressable>
                  )}
                  {isTransfer && (
                    <Pressable
                      onPress={() => handleDeleteTransfer(entry.id, entry.description)}
                      className="ml-2 p-1.5"
                      hitSlop={12}
                      accessibilityRole="button"
                      accessibilityLabel="Delete transfer"
                    >
                      <Ionicons name="trash-outline" size={18} color={sc.danger} />
                    </Pressable>
                  )}

                  {/* Chevron for tappable rows */}
                  {((entry.type === "debit" && !entry.isRefund)
                    || entry.isRefund
                    || (entry.type === "credit" && entry.canDelete)
                    || (entry.type === "credit" && !!entry.linkedHisaabPersonId)
                    || (isTransfer && !!entry.rawSourceText)
                    || (isTransfer && !!entry.linkedExpenseId)) && (
                    <Ionicons name="chevron-forward" size={12} color={colors.textSecondary} className="ml-1" />
                  )}
                </View>
              </Pressable>
            );
          })}

          {/* Empty state */}
          {filteredEntries.length === 0 && (
            <View className="items-center py-12">
              <Ionicons name="receipt-outline" size={40} color={colors.textSecondary} />
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-3">
                No transactions this month
              </Text>
            </View>
          )}

          {/* Cleanup actions — Adjust lives in FAB menu; only Clear remains here. */}
          <View className="mx-4 mt-6 mb-2">
            <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary uppercase tracking-wider mb-2">
              Manage
            </Text>
            <Pressable
              onPress={handleClearLedger}
              className="flex-row items-center py-3"
            >
              <Ionicons name="trash-outline" size={16} color={sc.danger} />
              <Text className="text-sm ml-3 flex-1" style={{ color: sc.danger }}>
                Clear all ledger data
              </Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* FAB — opens action menu */}
      {!showAddCredit && !showAddTransfer && !showAdjust && !showFabMenu && (
        <FAB icon="add" onPress={() => setShowFabMenu(true)} accessibilityLabel="Add transaction" />
      )}

      {/* FAB action menu */}
      {showFabMenu && (
        <Pressable
          className="absolute inset-0"
          onPress={() => setShowFabMenu(false)}
        >
          <View className="absolute bottom-24 right-6">
            <Pressable
              onPress={() => {
                setShowFabMenu(false);
                setCreditDate(new Date().toISOString().split("T")[0]);
                setShowAddCredit(true);
                setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 50);
              }}
              className="flex-row items-center mb-2 px-4 py-3 rounded-xl shadow-sm"
              style={{ backgroundColor: colors.surface }}
            >
              <View className="w-8 h-8 rounded-full items-center justify-center mr-3" style={{ backgroundColor: sc.success + "14" }}>
                <Ionicons name="arrow-down-outline" size={16} color={sc.success} />
              </View>
              <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">Add Credit</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setShowFabMenu(false);
                setTransferDate(new Date().toISOString().split("T")[0]);
                setShowAddTransfer(true);
                setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 50);
              }}
              className="flex-row items-center mb-2 px-4 py-3 rounded-xl shadow-sm"
              style={{ backgroundColor: colors.surface }}
            >
              <View className="w-8 h-8 rounded-full items-center justify-center mr-3" style={{ backgroundColor: TRANSFER_COLOR + "14" }}>
                <Ionicons name="swap-horizontal" size={16} color={TRANSFER_COLOR} />
              </View>
              <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">Add Transfer</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setShowFabMenu(false);
                setShowAdjust(true);
                setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 50);
              }}
              className="flex-row items-center px-4 py-3 rounded-xl shadow-sm"
              style={{ backgroundColor: colors.surface }}
            >
              <View className="w-8 h-8 rounded-full items-center justify-center mr-3" style={{ backgroundColor: sc.warning + "14" }}>
                <Ionicons name="swap-vertical-outline" size={16} color={sc.warning} />
              </View>
              <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">Adjust Balance</Text>
            </Pressable>
          </View>
        </Pressable>
      )}

      {/* Account picker for transfers.
          When direction is "out" the user is moving money FROM this account
          TO another — demat is a valid destination (idle-cash or direct
          portfolio bump). When direction is "in", we keep it to savings/wallet
          sources; money coming OUT of demat is a redemption/withdrawal flow
          that is out of scope for this release. */}
      <AccountPickerSheet
        visible={showTransferAccountPicker}
        onSelect={handleTransferAccountSelected}
        onClose={() => setShowTransferAccountPicker(false)}
        title={transferDirection === "in" ? "Transfer From" : "Transfer To"}
        filterTypes={transferDirection === "out" ? ["savings", "wallet", "demat"] : ["savings", "wallet"]}
        excludeAccountId={accountId}
      />

      {/* Account picker for convert-credit-to-transfer */}
      <AccountPickerSheet
        visible={showConvertPicker}
        onSelect={handleConvertConfirm}
        onClose={() => { setShowConvertPicker(false); setConvertingCreditId(null); }}
        title="Money came from..."
        filterTypes={["savings"]}
        excludeAccountId={accountId}
      />

      {/* Demat fund/portfolio + optional bucket follow-up after a transfer
          lands in a demat account. Dismissible — skipping just leaves the
          transfer as a plain account_transfers row. */}
      {pendingDematTransfer && (
        <DematTransferTargetSheet
          visible={true}
          dematAccountLabel={pendingDematTransfer.dematAccountLabel}
          amount={pendingDematTransfer.amount}
          date={pendingDematTransfer.date}
          onConfirm={handleConfirmDematTarget}
          onClose={() => setPendingDematTransfer(null)}
        />
      )}

      {/* v15.12.1: Source SMS viewer — shown when the user taps a transfer
          that was reclassified from an SMS credit/debit. The raw body + DLT
          sender ID preserve the audit trail even after the source expense
          row was soft-deleted by reclassify. */}
      {sourceSmsModal && (
        <Modal
          transparent
          visible
          animationType="fade"
          onRequestClose={() => setSourceSmsModal(null)}
        >
          <Pressable
            className="flex-1 bg-black/50 items-center justify-center px-6"
            onPress={() => setSourceSmsModal(null)}
            accessibilityLabel="Close source SMS"
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={{
                backgroundColor: colors.surface,
                borderRadius: 16,
                padding: 20,
                maxWidth: 480,
                width: "100%",
              }}
            >
              <View className="flex-row items-start justify-between mb-3">
                <View className="flex-1 mr-3">
                  <Text className="text-base font-bold" style={{ color: colors.text }}>
                    Source SMS
                  </Text>
                  <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }} numberOfLines={2}>
                    {sourceSmsModal.description}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setSourceSmsModal(null)}
                  hitSlop={12}
                  accessibilityLabel="Close"
                >
                  <Ionicons name="close" size={22} color={colors.textSecondary} />
                </Pressable>
              </View>

              {sourceSmsModal.address && (
                <View className="mb-3">
                  <Text className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: colors.textSecondary }}>
                    Sender
                  </Text>
                  <Text className="text-xs" style={{ color: colors.text }}>
                    {sourceSmsModal.address}
                  </Text>
                </View>
              )}

              <Text className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: colors.textSecondary }}>
                Body
              </Text>
              <ScrollView
                style={{
                  maxHeight: 280,
                  backgroundColor: colors.background,
                  borderRadius: 8,
                  padding: 10,
                }}
              >
                <Text
                  className="text-xs"
                  style={{ color: colors.text, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}
                  selectable
                >
                  {sourceSmsModal.body}
                </Text>
              </ScrollView>

              <Text className="text-[10px] mt-3" style={{ color: colors.textSecondary }}>
                This SMS originally came in as a credit or expense and was reclassified as a transfer.
              </Text>
            </Pressable>
          </Pressable>
        </Modal>
      )}

    </ScreenContainer>
  );
}
