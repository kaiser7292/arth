import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { isNLSearchEnabled } from "@/services/ai-assistant";
import { parseNLQuery } from "@/utils/nl-search";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { View, FlatList, Pressable, TextInput, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, ContextualHeader, DateInput, EmptyState, FABMenu, Input, ScreenContainer, SwipePager, Text } from "@/components/ui";
import type { FABMenuItem, SwipePagerPage } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

import { AccountPickerSheet } from "@/components/expense/AccountPickerSheet";
import { DematTransferTargetSheet } from "@/components/expense/DematTransferTargetSheet";
import { addCredit } from "@/services/account-credit";
import { handleDematTransferSideEffects, handleDematWithdrawalSideEffects } from "@/services/demat-transfer";
import type { DematTarget } from "@/services/demat-transfer";

import { DEFAULT_USER_ID } from "@/constants/app";
import { getDataVersion } from "@/services/settings";
import {
  getExpensesPaginated,
  getFilteredExpenseSummary,
  getPendingExpenseCount,
  getPreviousPeriodTotal,
  deleteExpense,
  deleteSplitExpense,
  sumRefundsByExpenseIds,
} from "@/services/expense";
import {
  getTransfersForUser,
  createTransfer,
  deleteTransfer,
} from "@/services/account-transfer";
import type { AccountTransfer } from "@/services/account-transfer";
import type { FilteredSummary } from "@/services/expense";
import { FilterSummaryCard } from "@/components/expense/FilterSummaryCard";
import { getCategories } from "@/services/category";
import { getPaymentModes } from "@/services/payment-mode";
import { getActiveAccounts } from "@/services/financial-account";
import { getTags, getTagsForExpenses } from "@/services/tags";
import { getDistinctMerchantNames } from "@/services/merchant-alias";
import { listRules, type SmartRule } from "@/services/smart-rules";
import type { Expense } from "@/services/expense";
import type { Category } from "@/services/category";
import type { PaymentMode } from "@/services/payment-mode";
import type { FinancialAccount } from "@/services/financial-account";
import type { Tag } from "@/services/tags";
import { formatAmount } from "@/utils/expense-validation";
import { ExpenseListRow } from "@/components/expense/ExpenseListRow";
import { FilterDropdown } from "@/components/expense/FilterDropdown";
import { FullScreenFilter } from "@/components/expense/FullScreenFilter";
import { BulkActionBar } from "@/components/expense/BulkActionBar";
import { bulkUpdateExpenses } from "@/services/expense-bulk";
import {
  getSavedFilterViews,
  saveFilterView,
  deleteFilterView,
  getDefaultFilterView,
  getDefaultFilterViewId,
  setDefaultFilterView,
  clearDefaultFilterView,
  resolveDatePreset,
  DATE_PRESET_LABELS,
  DATE_PRESET_ORDER,
  type SavedFilterView,
  type FilterViewState,
  type DatePreset,
} from "@/services/saved-filter-views";
import { STATUS_COLORS, TRANSFER_COLOR } from "@/constants/semantic-colors";

import { settingsStorage } from "@/services/storage";
import { Modal } from "react-native";
import { useTheme } from "@/hooks/use-theme";

type ExpenseSortBy = "date_desc" | "date_asc" | "amount_desc" | "amount_asc" | "name_asc";
const SORT_OPTIONS: { value: ExpenseSortBy; label: string; icon: string }[] = [
  { value: "date_desc", label: "Date (newest first)", icon: "calendar-outline" },
  { value: "date_asc", label: "Date (oldest first)", icon: "calendar-outline" },
  { value: "amount_desc", label: "Amount (highest first)", icon: "trending-down-outline" },
  { value: "amount_asc", label: "Amount (lowest first)", icon: "trending-up-outline" },
  { value: "name_asc", label: "Alphabetical (A–Z)", icon: "text-outline" },
];
const SORT_KEY = "expenses.sortBy";

const PAGE_SIZE = 50;

const NATURE_TABS: SwipePagerPage[] = [
  { key: "all", label: "All" },
  { key: "realized", label: "Expenses" },
  { key: "committed", label: "Committed" },
  { key: "credit", label: "Credits" },
  { key: "transfers", label: "Transfers" },
];

export default function ExpensesScreen() {
  const alert = useAlert();
  const router = useRouter();
  const { colors, accent } = useColorScheme();
  const theme = useTheme();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [transfers, setTransfers] = useState<AccountTransfer[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [refundedMap, setRefundedMap] = useState<Map<string, number>>(new Map());
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [allMerchantNames, setAllMerchantNames] = useState<string[]>([]);
  const [allRules, setAllRules] = useState<SmartRule[]>([]);
  const [filterRuleIds, setFilterRuleIds] = useState<string[]>([]);
  const [expenseTagMap, setExpenseTagMap] = useState<Record<string, Tag[]>>({});
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [summary, setSummary] = useState<FilteredSummary | null>(null);
  const [previousTotal, setPreviousTotal] = useState<number | null>(null);
  const [summaryGroupBy, setSummaryGroupBy] = useState<"category" | "account" | "payment_mode" | "merchant">("category");
  // Track last user-picked group-by per nature so switching Expenses↔Credits
  // doesn't force the user to re-pick. Credits default to "account" since
  // most credits don't carry a category.
  const groupByForRealizedRef = useRef<"category" | "account" | "payment_mode" | "merchant">("category");
  const groupByForCreditRef = useRef<"category" | "account" | "payment_mode" | "merchant">("account");

  // Date filter — dynamic presets
  const [datePreset, setDatePreset] = useState<DatePreset>("this_month");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);

  const { start: filterStartDate, end: filterEndDate } = useMemo(
    () => resolveDatePreset(datePreset, customStartDate, customEndDate),
    [datePreset, customStartDate, customEndDate],
  );

  const nlEnabled = isNLSearchEnabled();

  // Filters (all multi-select)
  const [search, setSearch] = useState("");
  // Debounce search so every keystroke doesn't refire the 5-query load.
  const debouncedSearch = useDebouncedValue(search, 300);
  const [filterCategoryIds, setFilterCategoryIds] = useState<string[]>([]);
  const [filterPaymentModeIds, setFilterPaymentModeIds] = useState<string[]>([]);
  const [filterAccountIds, setFilterAccountIds] = useState<string[]>([]);
  const [filterTagIds, setFilterTagIds] = useState<string[]>([]);
  const [filterMerchantNames, setFilterMerchantNames] = useState<string[]>([]);
  const [filterRefundedStatus, setFilterRefundedStatus] = useState<"" | "refunded" | "not_refunded">("");
  const [filterStatus, setFilterStatus] = useState<"" | "pending_review" | "approved">("");
  const [filterAvoidability, setFilterAvoidability] = useState<"" | "avoidable" | "unavoidable">("");
  const [filterNature, setFilterNature] = useState<"realized" | "committed" | "credit" | "transfers" | "all">("realized");
  const [showFilters, setShowFilters] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedFilterView[]>(() => getSavedFilterViews());
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [showViewsPicker, setShowViewsPicker] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<string>>(new Set());

  const [sortBy, setSortBy] = useState<ExpenseSortBy>(
    () => (settingsStorage.getString(SORT_KEY) as ExpenseSortBy | undefined) ?? "date_desc",
  );
  const [showSortSheet, setShowSortSheet] = useState(false);

  // Inline credit form
  const [showAddCredit, setShowAddCredit] = useState(false);
  const [creditAccountId, setCreditAccountId] = useState<string | null>(null);
  const [creditAccountLabel, setCreditAccountLabel] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditDescription, setCreditDescription] = useState("");
  const [creditDate, setCreditDate] = useState("");
  const [showCreditAccountPicker, setShowCreditAccountPicker] = useState(false);

  // Inline transfer form
  const [showAddTransfer, setShowAddTransfer] = useState(false);
  const [transferFromAccountId, setTransferFromAccountId] = useState<string | null>(null);
  const [transferFromLabel, setTransferFromLabel] = useState("");
  const [transferToAccountId, setTransferToAccountId] = useState<string | null>(null);
  const [transferToLabel, setTransferToLabel] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferDescription, setTransferDescription] = useState("");
  const [transferDate, setTransferDate] = useState("");
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [pendingDematTransfer, setPendingDematTransfer] = useState<{
    transferId: string;
    dematAccountId: string;
    dematAccountLabel: string;
    amount: number;
    date: string;
  } | null>(null);

  // Preset: navigate to a specific tab after save (refund → credits, etc.)
  const params = useLocalSearchParams<{ preset?: string; filterMonth?: string; filterAvoidability?: string }>();
  const presetParam = params.preset;
  const presetAppliedRef = useRef(false);
  useEffect(() => {
    if (presetAppliedRef.current) return;
    if (presetParam === "credits") {
      setFilterNature("credit");
      presetAppliedRef.current = true;
    } else if (presetParam === "refunded") {
      setFilterNature("realized");
      setFilterRefundedStatus("refunded");
      presetAppliedRef.current = true;
    } else if (presetParam === "month" && params.filterMonth) {
      setDatePreset("custom");
      const [y, m] = params.filterMonth.split("-").map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      setCustomStartDate(`${params.filterMonth}-01`);
      setCustomEndDate(`${params.filterMonth}-${String(lastDay).padStart(2, "0")}`);
      setFilterNature("realized");
      if (params.filterAvoidability === "unavoidable") setFilterAvoidability("unavoidable");
      else if (params.filterAvoidability === "avoidable") setFilterAvoidability("avoidable");
      presetAppliedRef.current = true;
    }
  }, [presetParam]);

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const paymentModeMap = useMemo(() => new Map(paymentModes.map((p) => [p.id, p])), [paymentModes]);
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  // v17.5.3 — offset read via ref to avoid re-creating callback on every
  // append (was ripping through useCallback deps via `expenses.length`).
  const expensesLenRef = useRef(0);
  useEffect(() => {
    expensesLenRef.current = expenses.length;
  }, [expenses.length]);

  const lastVersionRef = useRef<number | null>(null);

  const loadExpenses = useCallback(
    async (reset = true) => {
      if (reset) {
        const currentVersion = getDataVersion();
        if (lastVersionRef.current === currentVersion) return;
        lastVersionRef.current = currentVersion;
      }
      if (loading) return;
      setLoading(true);
      try {
        // Handle transfers separately
        if (filterNature === "transfers") {
          const transferData = await getTransfersForUser(
            DEFAULT_USER_ID,
            filterStartDate || "",
            filterEndDate || "",
          );
          if (reset) {
            setTransfers(transferData);
            setSummary(null);
            setPreviousTotal(null);
          } else {
            setTransfers((prev) => [...prev, ...transferData]);
          }
          setHasMore(false);
          setExpenses([]);
          setLoading(false);
          return;
        }

        const offset = reset ? 0 : expensesLenRef.current;
        const nature: "realized" | "credit" | "all" = filterNature === "credit" ? "credit" : filterNature === "all" ? "all" : "realized";
        const segment = filterNature === "committed" ? "committed" as const
          : filterNature === "realized" ? "spend" as const
          : undefined;
        const filters = {
          startDate: filterStartDate,
          endDate: filterEndDate,
          search: debouncedSearch.trim() || undefined,
          categoryIds: filterCategoryIds.length > 0 ? filterCategoryIds : undefined,
          paymentModeIds: filterPaymentModeIds.length > 0 ? filterPaymentModeIds : undefined,
          accountIds: filterAccountIds.length > 0 ? filterAccountIds : undefined,
          tagIds: filterTagIds.length > 0 ? filterTagIds : undefined,
          merchantNames: filterMerchantNames.length > 0 ? filterMerchantNames : undefined,
          refundedStatus: filterRefundedStatus || undefined,
          avoidability: filterAvoidability || undefined,
          ruleIds: filterRuleIds.length > 0 ? filterRuleIds : undefined,
          status: filterStatus || undefined,
          sortBy,
          nature,
          segment,
        };
        const [data, summaryResult, prevTotal] = await Promise.all([
          getExpensesPaginated(DEFAULT_USER_ID, filters, PAGE_SIZE, offset),
          reset ? getFilteredExpenseSummary(DEFAULT_USER_ID, filters, summaryGroupBy) : Promise.resolve(null),
          reset ? getPreviousPeriodTotal(DEFAULT_USER_ID, filters) : Promise.resolve(null),
        ]);
        if (reset) {
          setExpenses(data);
          setTransfers([]);
          if (summaryResult) setSummary(summaryResult);
          setPreviousTotal(prevTotal);
        } else {
          setExpenses((prev) => [...prev, ...data]);
        }
        setHasMore(data.length === PAGE_SIZE);

        // Load tags and refund totals for these expenses (batch queries)
        const [tagMap, refundMap] = await Promise.all([
          getTagsForExpenses(data.map((e) => e.id)),
          sumRefundsByExpenseIds(data.map((e) => e.id)),
        ]);
        if (reset) {
          setExpenseTagMap(tagMap);
          setRefundedMap(refundMap);
        } else {
          setExpenseTagMap((prev) => ({ ...prev, ...tagMap }));
          setRefundedMap((prev) => {
            const next = new Map(prev);
            refundMap.forEach((v, k) => next.set(k, v));
            return next;
          });
        }
      } catch {
        // Database not ready
      } finally {
        setLoading(false);
      }
    },
    [debouncedSearch, filterStartDate, filterEndDate, filterCategoryIds, filterPaymentModeIds, filterAccountIds, filterTagIds, filterMerchantNames, filterRefundedStatus, filterAvoidability, filterRuleIds, filterStatus, sortBy, filterNature, summaryGroupBy, loading],
  );

  // Load reference data once
  useEffect(() => {
    async function loadReferenceData() {
      try {
        const [cats, pms, accts, tags, merchants, rules, pending] = await Promise.all([
          getCategories(DEFAULT_USER_ID),
          getPaymentModes(DEFAULT_USER_ID),
          getActiveAccounts(DEFAULT_USER_ID),
          getTags(DEFAULT_USER_ID),
          getDistinctMerchantNames(DEFAULT_USER_ID),
          listRules(),
          getPendingExpenseCount(DEFAULT_USER_ID),
        ]);
        setCategories(cats);
        setPaymentModes(pms);
        setAccounts(accts);
        setAllTags(tags);
        setAllMerchantNames(merchants);
        setAllRules(rules);
        setPendingCount(pending);
      } catch {
        // Database not ready
      }
    }
    loadReferenceData();
  }, []);

  // Reload expenses when screen gains focus or filters change
  useFocusEffect(
    useCallback(() => {
      loadExpenses(true);
      getPendingExpenseCount(DEFAULT_USER_ID).then(setPendingCount).catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearch, filterStartDate, filterEndDate, filterCategoryIds, filterPaymentModeIds, filterAccountIds, filterTagIds, filterMerchantNames, filterRefundedStatus, filterAvoidability, filterRuleIds, filterStatus, filterNature, summaryGroupBy, sortBy]),
  );

  const handleDelete = useCallback(
    (expense: Expense) => {
      const desc = expense.description || expense.merchant_name || formatAmount(expense.amount);
      const isSplit = expense.split_hisaab_entry_id != null;
      alert(
        "Delete Expense",
        isSplit
          ? `Delete "${desc}"? This will also remove the linked hisaab entry.`
          : `Delete "${desc}"?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              if (isSplit) {
                await deleteSplitExpense(expense.id);
              } else {
                await deleteExpense(expense.id);
              }
              setExpenses((prev) => prev.filter((e) => e.id !== expense.id));
              setSummary((prev) =>
                prev
                  ? {
                      ...prev,
                      total: prev.total - expense.amount,
                      count: prev.count - 1,
                    }
                  : prev,
              );
            },
          },
        ],
      );
    },
    [],
  );

  const handleLoadMore = useCallback(() => {
    if (hasMore && !loading) {
      loadExpenses(false);
    }
  }, [hasMore, loading, loadExpenses]);

  const handleNatureChange = useCallback((index: number) => {
    const tab = NATURE_TABS[index];
    if (!tab) return;
    const newKey = tab.key as typeof filterNature;
    if (newKey === filterNature) return;
    if (filterNature === "realized") groupByForRealizedRef.current = summaryGroupBy;
    else if (filterNature === "credit") groupByForCreditRef.current = summaryGroupBy;
    setFilterNature(newKey);
    setSummaryGroupBy(newKey === "credit" ? groupByForCreditRef.current : groupByForRealizedRef.current);
    if (newKey !== "realized") {
      setFilterRefundedStatus("");
      setFilterAvoidability("");
    }
    if (newKey === "transfers") {
      setFilterCategoryIds([]);
      setFilterPaymentModeIds([]);
      setFilterTagIds([]);
      setFilterMerchantNames([]);
    }
  }, [filterNature, summaryGroupBy]);

  const clearFilters = useCallback(() => {
    setDatePreset("this_month");
    setCustomStartDate("");
    setCustomEndDate("");
    setSearch("");
    setFilterCategoryIds([]);
    setFilterPaymentModeIds([]);
    setFilterAccountIds([]);
    setFilterTagIds([]);
    setFilterMerchantNames([]);
    setFilterRefundedStatus("");
    setFilterAvoidability("");
    setFilterRuleIds([]);
    setFilterStatus("");
    setFilterNature("realized");
  }, []);

  const applyFilterView = useCallback((view: SavedFilterView) => {
    try {
      const f = view.filters;
      // Handle legacy views saved with old format (dateFilterMode instead of datePreset)
      const preset: DatePreset = f.datePreset ?? (f as any).dateFilterMode === "all" ? "all" : (f as any).dateFilterMode === "custom" ? "custom" : "this_fy";
      setDatePreset(preset);
      if (f.customStartDate) setCustomStartDate(f.customStartDate);
      else setCustomStartDate("");
      if (f.customEndDate) setCustomEndDate(f.customEndDate);
      else setCustomEndDate("");
      setFilterNature(f.nature ?? "realized");
      setFilterCategoryIds(f.categoryIds ?? []);
      setFilterPaymentModeIds(f.paymentModeIds ?? []);
      setFilterAccountIds(f.accountIds ?? []);
      setFilterTagIds(f.tagIds ?? []);
      setFilterMerchantNames(f.merchantNames ?? []);
      setFilterRefundedStatus(f.refundedStatus ?? "");
      setFilterAvoidability(f.avoidability ?? "");
      setSearch(f.search ?? "");
      setActiveViewId(view.id);
      setShowFilters(false);
    } catch {
      // Corrupted view — ignore silently
    }
  }, []);

  const getCurrentFilterState = useCallback((): FilterViewState => ({
    datePreset,
    customStartDate: customStartDate || undefined,
    customEndDate: customEndDate || undefined,
    nature: filterNature,
    categoryIds: filterCategoryIds,
    paymentModeIds: filterPaymentModeIds,
    accountIds: filterAccountIds,
    tagIds: filterTagIds,
    merchantNames: filterMerchantNames,
    refundedStatus: filterRefundedStatus,
    avoidability: filterAvoidability,
    search,
  }), [datePreset, customStartDate, customEndDate, filterNature, filterCategoryIds, filterPaymentModeIds, filterAccountIds, filterTagIds, filterMerchantNames, filterRefundedStatus, filterAvoidability, search]);

  const [saveViewName, setSaveViewName] = useState("");
  const [showSaveViewInput, setShowSaveViewInput] = useState(false);

  const handleSaveView = useCallback(() => {
    setShowSaveViewInput(true);
    setSaveViewName("");
  }, []);

  const confirmSaveView = useCallback(() => {
    if (!saveViewName.trim()) return;
    const view = saveFilterView(saveViewName.trim(), getCurrentFilterState());
    setSavedViews(getSavedFilterViews());
    setActiveViewId(view.id);
    setShowSaveViewInput(false);
    setSaveViewName("");
  }, [saveViewName, getCurrentFilterState]);

  const handleDeleteView = useCallback((id: string, name: string) => {
    alert("Delete view", `Remove "${name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deleteFilterView(id);
          setSavedViews(getSavedFilterViews());
          if (activeViewId === id) setActiveViewId(null);
        },
      },
    ]);
  }, [activeViewId]);

  const handleSetDefault = useCallback((id: string) => {
    const currentDefault = getDefaultFilterViewId();
    if (currentDefault === id) {
      clearDefaultFilterView();
    } else {
      setDefaultFilterView(id);
    }
    setSavedViews(getSavedFilterViews());
  }, []);

  // Load default view on first mount
  const defaultAppliedRef = useRef(false);
  useEffect(() => {
    if (defaultAppliedRef.current) return;
    if (presetAppliedRef.current) return;
    const defaultView = getDefaultFilterView();
    if (defaultView) {
      applyFilterView(defaultView);
      defaultAppliedRef.current = true;
    }
  }, [applyFilterView]);

  const handleSearchChange = useCallback((text: string) => {
    setSearch(text);
  }, []);

  const applyNLSearchWith = useCallback((text: string) => {
    if (!nlEnabled || !text.trim()) { setSearch(text); return; }
    const { textSearch, datePreset: parsedPreset } = parseNLQuery(text);
    setSearch(textSearch);
    if (parsedPreset) setDatePreset(parsedPreset);
  }, [nlEnabled, setDatePreset]);

  const applyNLSearch = useCallback(() => {
    applyNLSearchWith(search);
  }, [applyNLSearchWith, search]);

  // Voice search
  const [isVoiceSearching, setIsVoiceSearching] = useState(false);

  useSpeechRecognitionEvent("result", (event) => {
    if (!isVoiceSearching || !event.isFinal) return;
    const transcript = event.results[0]?.transcript ?? "";
    setIsVoiceSearching(false);
    if (transcript) applyNLSearchWith(transcript);
  });

  useSpeechRecognitionEvent("error", () => {
    if (isVoiceSearching) setIsVoiceSearching(false);
  });

  useSpeechRecognitionEvent("end", () => {
    setIsVoiceSearching((prev) => (prev ? false : prev));
  });

  const startVoiceSearch = useCallback(async () => {
    const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) return;
    setIsVoiceSearching(true);
    ExpoSpeechRecognitionModule.start({ lang: "en-IN", interimResults: false, maxAlternatives: 1 });
  }, []);

  const cancelVoiceSearch = useCallback(() => {
    ExpoSpeechRecognitionModule.abort();
    setIsVoiceSearching(false);
  }, []);

  const hasNonDateFilters = !!search || filterCategoryIds.length > 0 || filterPaymentModeIds.length > 0 || filterAccountIds.length > 0 || filterTagIds.length > 0 || filterMerchantNames.length > 0 || !!filterRefundedStatus || !!filterAvoidability || filterRuleIds.length > 0 || !!filterStatus;
  const activeNatureIndex = NATURE_TABS.findIndex((t) => t.key === filterNature);
  const hasActiveFilters = hasNonDateFilters || datePreset !== "this_month";

  const handleItemPress = useCallback(
    (id: string) => {
      if (bulkMode) {
        setSelectedExpenseIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          if (next.size === 0) setBulkMode(false);
          return next;
        });
      } else {
        router.push(`/expense/${id}`);
      }
    },
    [router, bulkMode],
  );

  const handleLongPress = useCallback(
    (expense: Expense) => {
      if (!bulkMode) {
        setBulkMode(true);
        setSelectedExpenseIds(new Set([expense.id]));
      }
    },
    [bulkMode],
  );

  const exitBulkMode = useCallback(() => {
    setBulkMode(false);
    setSelectedExpenseIds(new Set());
  }, []);

  const [bulkPickerType, setBulkPickerType] = useState<"category" | "paymentMode" | "account" | "merchant" | "date" | null>(null);

  const handleBulkApply = useCallback(async (field: string, value: string) => {
    const ids = [...selectedExpenseIds];
    const fields: Record<string, string> = {};
    if (field === "category") fields.category_id = value;
    else if (field === "paymentMode") fields.payment_mode_id = value;
    else if (field === "account") fields.account_id = value;
    else if (field === "merchant") fields.merchant_name = value;
    else if (field === "date") fields.date = value;
    await bulkUpdateExpenses(ids, fields);
    exitBulkMode();
    setBulkPickerType(null);
    loadExpenses(true);
  }, [selectedExpenseIds, exitBulkMode, loadExpenses]);

  // ── Credit handlers ──

  const handleSaveCredit = useCallback(async () => {
    if (!creditAccountId) {
      alert("No Account", "Please select an account to credit.");
      return;
    }
    const amount = parseFloat(creditAmount.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Invalid Amount", "Please enter a valid positive amount.");
      return;
    }
    const date = creditDate.trim() || new Date().toISOString().split("T")[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      alert("Invalid Date", "Please pick a valid date.");
      return;
    }
    await addCredit({
      accountId: creditAccountId,
      userId: DEFAULT_USER_ID,
      amount,
      description: creditDescription.trim() || "Manual credit",
      date,
      source: "manual",
    });
    setShowAddCredit(false);
    setCreditAccountId(null);
    setCreditAccountLabel("");
    setCreditAmount("");
    setCreditDescription("");
    setCreditDate("");
    loadExpenses(true);
  }, [creditAccountId, creditAmount, creditDescription, creditDate, alert, loadExpenses]);

  const handleCancelCredit = useCallback(() => {
    setShowAddCredit(false);
    setCreditAccountId(null);
    setCreditAccountLabel("");
    setCreditAmount("");
    setCreditDescription("");
    setCreditDate("");
  }, []);

  // ── Transfer handlers ──

  const handleSaveTransfer = useCallback(async () => {
    if (!transferFromAccountId || !transferToAccountId) {
      alert("Incomplete", "Please select both From and To accounts.");
      return;
    }
    if (transferFromAccountId === transferToAccountId) {
      alert("Same Account", "From and To accounts must be different.");
      return;
    }
    const amount = parseFloat(transferAmount.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e12) {
      alert("Invalid Amount", "Please enter a valid positive amount.");
      return;
    }
    const date = transferDate.trim() || new Date().toISOString().split("T")[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      alert("Invalid Date", "Please pick a valid date.");
      return;
    }
    const transferId = await createTransfer({
      userId: DEFAULT_USER_ID,
      fromAccountId: transferFromAccountId,
      toAccountId: transferToAccountId,
      amount,
      description: transferDescription.trim() || undefined,
      date,
      source: "manual",
    });
    // If money came FROM a demat account, subtract from the idle fund snapshot automatically.
    const fromAccount = accounts.find((a) => a.id === transferFromAccountId);
    if (fromAccount?.account_type === "demat") {
      try {
        await handleDematWithdrawalSideEffects(transferId, fromAccount.id, amount, date);
      } catch (e) {
        alert("Warning", `Transfer saved but fund snapshot could not be updated: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // If money landed IN a demat account, open the follow-up sheet
    const toAccount = accounts.find((a) => a.id === transferToAccountId);
    if (toAccount?.account_type === "demat") {
      const label = toAccount.account_label || `${toAccount.bank_name} ****${toAccount.account_identifier}`;
      setPendingDematTransfer({ transferId, dematAccountId: toAccount.id, dematAccountLabel: label, amount, date });
    }
    setShowAddTransfer(false);
    setTransferFromAccountId(null);
    setTransferFromLabel("");
    setTransferToAccountId(null);
    setTransferToLabel("");
    setTransferAmount("");
    setTransferDescription("");
    setTransferDate("");
    loadExpenses(true);
  }, [transferFromAccountId, transferToAccountId, transferAmount, transferDescription, transferDate, accounts, alert, loadExpenses]);

  const handleCancelTransfer = useCallback(() => {
    setShowAddTransfer(false);
    setTransferFromAccountId(null);
    setTransferFromLabel("");
    setTransferToAccountId(null);
    setTransferToLabel("");
    setTransferAmount("");
    setTransferDescription("");
    setTransferDate("");
  }, []);

  const handleConfirmDematTarget = useCallback(async (target: DematTarget, bucketId: string | null) => {
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
  }, [pendingDematTransfer, alert]);

  const renderTransferItem = useCallback(
    ({ item }: { item: AccountTransfer }) => {
      const fromAccount = accountMap.get(item.from_account_id);
      const toAccount = accountMap.get(item.to_account_id);
      const accountName = fromAccount ? `${fromAccount.bank_name} ****${fromAccount.account_identifier}` : "Unknown";
      const toAccountName = toAccount ? `${toAccount.bank_name} ****${toAccount.account_identifier}` : "Unknown";
      return (
        <Pressable
          onPress={() => {
            if (item.linked_expense_id) {
              router.push(`/expense/${item.linked_expense_id}`);
            } else if (item.source === "sms_auto") {
              router.push(`/transfer/${item.id}`);
            }
            // manual transfers with no linked expense: all info is in the row, no drilldown
          }}
          className="flex-row items-center px-4 py-3 border-b border-border"
        >
          <View className="flex-1">
            <Text className="text-sm font-medium" style={{ color: colors.text }}>
              {item.description || "Transfer"}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {accountName} → {toAccountName}
            </Text>
            <Text className="text-label text-faint-foreground">{item.date}</Text>
          </View>
          <View className="items-end">
            <Text className="text-sm font-bold" style={{ color: theme.primary }}>
              {formatAmount(item.amount)}
            </Text>
            <Pressable
              onPress={() => {
                alert("Delete Transfer", "Are you sure you want to delete this transfer?", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                      try {
                        await deleteTransfer(item.id);
                        loadExpenses(true);
                      } catch (e) {
                        alert("Error", e instanceof Error ? e.message : String(e));
                      }
                    },
                  },
                ]);
              }}
              className="mt-1"
              hitSlop={8}
            >
              <Ionicons name="trash-outline" size={16} color={colors.textSecondary} />
            </Pressable>
          </View>
        </Pressable>
      );
    },
    [accountMap, colors, accent, alert, loadExpenses, router],
  );

  // Group expenses by date for display. Each entry is either a date header
  // sentinel or an expense item. useMemo keeps it O(n) and only reruns when
  // the expenses array reference changes.
  type DateGroupRow =
    | { _type: "header"; date: string; label: string }
    | { _type: "item"; expense: Expense };

  const groupedExpenses = useMemo<DateGroupRow[]>(() => {
    if (expenses.length === 0) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);
    const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const currentYear = today.getFullYear();

    function dateLabel(dateStr: string): string {
      const d = new Date(dateStr + "T00:00:00");
      if (d.getTime() === today.getTime()) {
        return `Today · ${d.getDate()} ${MONTHS[d.getMonth()]}`;
      }
      if (d.getTime() === yesterday.getTime()) {
        return `Yesterday · ${d.getDate()} ${MONTHS[d.getMonth()]}`;
      }
      if (d >= sevenDaysAgo) {
        return `${WEEKDAYS[d.getDay()]} · ${d.getDate()} ${MONTHS[d.getMonth()]}`;
      }
      if (d.getFullYear() === currentYear) {
        return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
      }
      return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    }

    const rows: DateGroupRow[] = [];
    let lastDate = "";
    for (const expense of expenses) {
      const expDate = expense.date?.slice(0, 10) ?? "";
      if (expDate !== lastDate) {
        rows.push({ _type: "header", date: expDate, label: dateLabel(expDate) });
        lastDate = expDate;
      }
      rows.push({ _type: "item", expense });
    }
    return rows;
  }, [expenses]);

  const renderExpenseItem = useCallback(
    ({ item }: { item: DateGroupRow }) => {
      if (item._type === "header") {
        return (
          <View className="px-4 pt-4 pb-1.5">
            <Text
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              style={{ letterSpacing: 0.6 }}
            >
              {item.label}
            </Text>
          </View>
        );
      }
      const expense = item.expense;
      return (
        <View className="flex-row items-center">
          {bulkMode && (
            <Pressable
              onPress={() => handleItemPress(expense.id)}
              className="pl-4 pr-1 py-3"
            >
              <View
                className="w-5 h-5 rounded items-center justify-center"
                style={{
                  backgroundColor: selectedExpenseIds.has(expense.id) ? theme.primary : "transparent",
                  borderWidth: selectedExpenseIds.has(expense.id) ? 0 : 1.5,
                  borderColor: selectedExpenseIds.has(expense.id) ? theme.primary : colors.border,
                }}
              >
                {selectedExpenseIds.has(expense.id) && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
              </View>
            </Pressable>
          )}
          <View className="flex-1">
            <ExpenseListRow
              item={expense}
              categoryMap={categoryMap}
              paymentModeMap={paymentModeMap}
              accountMap={accountMap}
              refundedMap={refundedMap}
              onPress={handleItemPress}
              onLongPress={handleLongPress}
            />
          </View>
        </View>
      );
    },
    [categoryMap, paymentModeMap, accountMap, refundedMap, handleItemPress, handleLongPress, bulkMode, selectedExpenseIds, accent, colors],
  );

  return (
    <ScreenContainer>
      <ContextualHeader
        title="Transactions"
        subtitle={pendingCount > 0 ? `${pendingCount} pending review` : undefined}
        badge={pendingCount > 0 ? {
          label: `${pendingCount} pending`,
          variant: "warning",
          onPress: () => router.push("/expense/review-queue"),
        } : undefined}
        rightActions={[{
          icon: "swap-vertical-outline",
          color: sortBy !== "date_desc" ? theme.primary : undefined,
          onPress: () => setShowSortSheet(true),
        }]}
      />
      {/* Search bar */}
      <View className="px-4 pt-3 pb-2">
        <View className="flex-row items-center rounded-lg bg-card px-3 py-2">
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            value={search}
            onChangeText={handleSearchChange}
            onSubmitEditing={nlEnabled ? applyNLSearch : undefined}
            placeholder={nlEnabled ? "Try 'food last month'…" : "Search expenses…"}
            placeholderTextColor={colors.tabIconDefault}
            maxLength={100}
            accessibilityLabel="Search expenses"
            className="flex-1 ml-2 text-base text-foreground"
            returnKeyType={nlEnabled ? "go" : "search"}
            blurOnSubmit={false}
          />
          {search !== "" && (
            <Pressable onPress={() => setSearch("")} accessibilityLabel="Clear search" accessibilityRole="button">
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </Pressable>
          )}
          {/* Apply button — only shown for typed input; voice auto-applies */}
          {nlEnabled && search.trim() !== "" && !isVoiceSearching && (
            <Pressable
              onPress={applyNLSearch}
              accessibilityLabel="Apply smart search"
              accessibilityRole="button"
              className="ml-2 px-2 py-1 rounded-md"
              style={{ backgroundColor: theme.primary }}
            >
              <Text className="text-xs font-semibold text-primary-foreground">Apply</Text>
            </Pressable>
          )}
          {/* Voice search mic */}
          <Pressable
            onPress={isVoiceSearching ? cancelVoiceSearch : startVoiceSearch}
            accessibilityLabel={isVoiceSearching ? "Cancel voice search" : "Voice search"}
            accessibilityRole="button"
            className="ml-2 p-1"
          >
            <Ionicons
              name={isVoiceSearching ? "radio-button-on" : "mic-outline"}
              size={18}
              color={isVoiceSearching ? STATUS_COLORS.error : colors.textSecondary}
            />
          </Pressable>
          <Pressable
            onPress={() => setShowFilters(!showFilters)}
            accessibilityLabel={showFilters ? "Hide filters" : "Show filters"}
            accessibilityRole="button"
            className="ml-2 p-1"
          >
            <Ionicons
              name="options-outline"
              size={20}
              color={hasActiveFilters ? colors.blue : STATUS_COLORS.muted}
            />
          </Pressable>
        </View>
      </View>

      {/* Save view inline input */}
      {showSaveViewInput && (
        <View className="px-4 pb-2 flex-row items-center">
          <TextInput
            value={saveViewName}
            onChangeText={setSaveViewName}
            placeholder="View name..."
            placeholderTextColor={colors.tabIconDefault}
            autoFocus
            maxLength={30}
            onSubmitEditing={confirmSaveView}
            returnKeyType="done"
            className="flex-1 text-sm text-foreground bg-card rounded-lg px-3 py-2 mr-2"
          />
          <Pressable onPress={confirmSaveView} className="px-3 py-2 rounded-lg" style={{ backgroundColor: theme.primary }}>
            <Text className="text-xs font-medium text-primary-foreground">Save</Text>
          </Pressable>
          <Pressable onPress={() => setShowSaveViewInput(false)} className="ml-2">
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      )}

      {/* Saved filter views — dropdown */}
      {savedViews.length > 0 && (
        <View className="px-4 pb-2">
          <Pressable
            onPress={() => setShowViewsPicker(!showViewsPicker)}
            className="flex-row items-center justify-between py-3 px-3 rounded-lg bg-card"
          >
            <View className="flex-row items-center">
              <Ionicons name="bookmark-outline" size={14} color={theme.primary} style={{ marginRight: 6 }} />
              <Text className="text-sm font-medium" style={{ color: activeViewId ? theme.primary : colors.textSecondary }}>
                {activeViewId ? savedViews.find((v) => v.id === activeViewId)?.name ?? "Saved Views" : "Saved Views"}
              </Text>
            </View>
            <Ionicons name={showViewsPicker ? "chevron-up" : "chevron-down"} size={14} color={colors.textSecondary} />
          </Pressable>

          {showViewsPicker && (
            <View className="mt-1 rounded-lg bg-card overflow-hidden">
              {savedViews.map((view) => {
                const isActive = activeViewId === view.id;
                const isDefault = getDefaultFilterViewId() === view.id;
                return (
                  <View key={view.id} className="flex-row items-center border-b border-border">
                    <Pressable
                      onPress={() => { applyFilterView(view); setShowViewsPicker(false); }}
                      className="flex-1 flex-row items-center px-3 py-2.5"
                    >
                      {isDefault && <Ionicons name="star" size={11} color={STATUS_COLORS.warning} style={{ marginRight: 5 }} />}
                      <Text className={`text-sm flex-1 ${isActive ? "font-semibold" : "text-foreground"}`} style={isActive ? { color: theme.primary } : undefined}>
                        {view.name}
                      </Text>
                      {isActive && <Ionicons name="checkmark" size={14} color={theme.primary} />}
                    </Pressable>
                    <Pressable
                      onPress={() => handleSetDefault(view.id)}
                      className="px-2 py-2.5"
                    >
                      <Ionicons name={isDefault ? "star" : "star-outline"} size={14} color={STATUS_COLORS.warning} />
                    </Pressable>
                    <Pressable
                      onPress={() => { handleDeleteView(view.id, view.name); }}
                      className="px-2 py-2.5 mr-1"
                    >
                      <Ionicons name="trash-outline" size={14} color={colors.textSecondary} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}

      {/* Date preset selector */}
      <View className="px-4 pb-2">
        <Pressable
          onPress={() => setShowDatePicker(!showDatePicker)}
          className="flex-row items-center justify-between py-3 px-3 rounded-lg bg-card"
        >
          <View className="flex-row items-center">
            <Ionicons name="calendar-outline" size={14} color={theme.primary} style={{ marginRight: 6 }} />
            <Text className="text-sm font-medium" style={{ color: theme.primary }}>
              {DATE_PRESET_LABELS[datePreset]}
            </Text>
          </View>
          <Ionicons name={showDatePicker ? "chevron-up" : "chevron-down"} size={14} color={colors.textSecondary} />
        </Pressable>

        {showDatePicker && (
          <ScrollView
            className="mt-1 rounded-lg bg-card overflow-hidden"
            style={{ maxHeight: 300 }}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            {DATE_PRESET_ORDER.map((preset) => {
              const isSelected = datePreset === preset;
              return (
                <Pressable
                  key={preset}
                  onPress={() => {
                    setDatePreset(preset);
                    if (preset !== "custom") setShowDatePicker(false);
                  }}
                  className="flex-row items-center justify-between px-3 py-3 border-b border-border"
                >
                  <Text
                    className="text-sm text-foreground"
                    style={isSelected ? { color: theme.primary, fontWeight: "600" } : undefined}
                  >
                    {DATE_PRESET_LABELS[preset]}
                  </Text>
                  {isSelected && <Ionicons name="checkmark" size={16} color={theme.primary} />}
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {datePreset === "custom" && (
          <View className="flex-row mt-2 gap-3">
            <View className="flex-1">
              <DateInput
                label="From"
                value={customStartDate}
                onChange={setCustomStartDate}
                maximumDate={null}
              />
            </View>
            <View className="flex-1">
              <DateInput
                label="To"
                value={customEndDate}
                onChange={setCustomEndDate}
                maximumDate={null}
              />
            </View>
          </View>
        )}
      </View>

      {/* Full-screen filter modal */}
      <FullScreenFilter
        visible={showFilters}
        sections={[
          { key: "category", label: "Category", type: "multi", options: categories.map((c) => ({ id: c.id, label: c.name })), selectedIds: filterCategoryIds, searchable: true },
          { key: "paymentMode", label: "Payment Mode", type: "multi", options: paymentModes.map((p) => ({ id: p.id, label: p.name })), selectedIds: filterPaymentModeIds },
          { key: "account", label: "Account", type: "multi", options: accounts.map((a) => ({ id: a.id, label: `${a.bank_name} ****${a.account_identifier}` })), selectedIds: filterAccountIds, searchable: true },
          { key: "tags", label: "Tags", type: "multi", options: allTags.map((t) => ({ id: t.id, label: t.name, color: t.color })), selectedIds: filterTagIds },
          { key: "merchant", label: "Merchant", type: "multi", options: allMerchantNames.map((m) => ({ id: m, label: m })), selectedIds: filterMerchantNames, searchable: true },
          ...(allRules.length > 0 ? [{ key: "rule", label: "Smart Rule", type: "multi" as const, options: allRules.map((r) => ({ id: r.id, label: r.name })), selectedIds: filterRuleIds }] : []),
          ...(filterNature !== "transfers" ? [
            { key: "status", label: "Status", type: "single" as const, options: [{ id: "pending_review", label: "Pending Review" }, { id: "approved", label: "Approved" }], selectedIds: filterStatus ? [filterStatus] : [] },
          ] : []),
          ...(filterNature === "realized" ? [
            { key: "refundStatus", label: "Refund Status", type: "single" as const, options: [{ id: "refunded", label: "Refunded" }, { id: "not_refunded", label: "Not Refunded" }], selectedIds: filterRefundedStatus ? [filterRefundedStatus] : [] },
            { key: "avoidability", label: "Avoidability", type: "single" as const, options: [{ id: "unavoidable", label: "Unavoidable" }, { id: "avoidable", label: "Avoidable" }], selectedIds: filterAvoidability ? [filterAvoidability] : [] },
          ] : []),
        ]}
        onApply={(selections) => {
          setFilterCategoryIds(selections.category ?? []);
          setFilterPaymentModeIds(selections.paymentMode ?? []);
          setFilterAccountIds(selections.account ?? []);
          setFilterTagIds(selections.tags ?? []);
          setFilterMerchantNames(selections.merchant ?? []);
          setFilterRuleIds(selections.rule ?? []);
          setFilterStatus(((selections.status ?? [])[0] ?? "") as typeof filterStatus);
          setFilterRefundedStatus(((selections.refundStatus ?? [])[0] ?? "") as typeof filterRefundedStatus);
          setFilterAvoidability(((selections.avoidability ?? [])[0] ?? "") as typeof filterAvoidability);
        }}
        onReset={() => {
          setFilterCategoryIds([]);
          setFilterPaymentModeIds([]);
          setFilterAccountIds([]);
          setFilterTagIds([]);
          setFilterMerchantNames([]);
          setFilterRuleIds([]);
          setFilterStatus("");
          setFilterRefundedStatus("");
          setFilterAvoidability("");
          setActiveViewId(null);
        }}
        onClose={() => setShowFilters(false)}
      />

      {/* Active filters — subtle inline text with × */}
      {hasNonDateFilters && !showFilters && (
        <View className="px-4 pb-2 flex-row flex-wrap">
          {filterCategoryIds.map((id) => {
            const cat = categoryMap.get(id);
            if (!cat) return null;
            return (
              <Pressable key={`cat-${id}`} onPress={() => setFilterCategoryIds((prev) => prev.filter((x) => x !== id))} className="flex-row items-center mr-3 mb-1">
                <Text className="text-label text-faint-foreground">{cat.name}</Text>
                <Ionicons name="close" size={10} color={colors.textSecondary} style={{ marginLeft: 2 }} />
              </Pressable>
            );
          })}
          {filterPaymentModeIds.map((id) => {
            const pm = paymentModeMap.get(id);
            if (!pm) return null;
            return (
              <Pressable key={`pm-${id}`} onPress={() => setFilterPaymentModeIds((prev) => prev.filter((x) => x !== id))} className="flex-row items-center mr-3 mb-1">
                <Text className="text-label text-faint-foreground">{pm.name}</Text>
                <Ionicons name="close" size={10} color={colors.textSecondary} style={{ marginLeft: 2 }} />
              </Pressable>
            );
          })}
          {filterAccountIds.map((id) => {
            const acct = accountMap.get(id);
            if (!acct) return null;
            return (
              <Pressable key={`acct-${id}`} onPress={() => setFilterAccountIds((prev) => prev.filter((x) => x !== id))} className="flex-row items-center mr-3 mb-1">
                <Text className="text-label text-faint-foreground">{acct.bank_name}</Text>
                <Ionicons name="close" size={10} color={colors.textSecondary} style={{ marginLeft: 2 }} />
              </Pressable>
            );
          })}
          {filterMerchantNames.map((name) => (
            <Pressable key={`merchant-${name}`} onPress={() => setFilterMerchantNames((prev) => prev.filter((x) => x !== name))} className="flex-row items-center mr-3 mb-1">
              <Text className="text-label text-faint-foreground">{name}</Text>
              <Ionicons name="close" size={10} color={colors.textSecondary} style={{ marginLeft: 2 }} />
            </Pressable>
          ))}
          {filterRuleIds.map((rid) => {
            const rule = allRules.find((r) => r.id === rid);
            if (!rule) return null;
            return (
              <Pressable key={`rule-${rid}`} onPress={() => setFilterRuleIds((prev) => prev.filter((x) => x !== rid))} className="flex-row items-center mr-3 mb-1">
                <Text className="text-label text-faint-foreground">Rule: {rule.name}</Text>
                <Ionicons name="close" size={10} color={colors.textSecondary} style={{ marginLeft: 2 }} />
              </Pressable>
            );
          })}
          {filterRefundedStatus !== "" && (
            <Pressable onPress={() => setFilterRefundedStatus("")} className="flex-row items-center mr-3 mb-1">
              <Text className="text-label text-faint-foreground">{filterRefundedStatus === "refunded" ? "Refunded" : "Not refunded"}</Text>
              <Ionicons name="close" size={10} color={colors.textSecondary} style={{ marginLeft: 2 }} />
            </Pressable>
          )}
          {filterStatus !== "" && (
            <Pressable onPress={() => setFilterStatus("")} className="flex-row items-center mr-3 mb-1">
              <Text className="text-label text-faint-foreground">{filterStatus === "pending_review" ? "Pending Review" : "Approved"}</Text>
              <Ionicons name="close" size={10} color={colors.textSecondary} style={{ marginLeft: 2 }} />
            </Pressable>
          )}
          {filterAvoidability !== "" && (
            <Pressable onPress={() => setFilterAvoidability("")} className="flex-row items-center mr-3 mb-1">
              <Text className="text-label text-faint-foreground">{filterAvoidability === "avoidable" ? "Avoidable" : "Unavoidable"}</Text>
              <Ionicons name="close" size={10} color={colors.textSecondary} style={{ marginLeft: 2 }} />
            </Pressable>
          )}
          {search !== "" && (
            <Pressable onPress={() => setSearch("")} className="flex-row items-center mr-3 mb-1">
              <Text className="text-label text-faint-foreground">"{search}"</Text>
              <Ionicons name="close" size={10} color={colors.textSecondary} style={{ marginLeft: 2 }} />
            </Pressable>
          )}
          <Pressable onPress={() => { clearFilters(); setActiveViewId(null); }} className="flex-row items-center mb-1">
            <Text className="text-label font-medium" style={{ color: theme.primary }}>Clear all</Text>
          </Pressable>
        </View>
      )}

      {/* Nature tabs + transaction list */}
      <SwipePager
        pages={NATURE_TABS}
        activeIndex={activeNatureIndex}
        onIndexChange={handleNatureChange}
        trailing={
          <View className="flex-row items-center">
            {hasActiveFilters && (
              <Pressable onPress={handleSaveView} className="mr-3">
                <Ionicons name="bookmark-outline" size={16} color={theme.primary} />
              </Pressable>
            )}
            {activeViewId && (
              <Pressable onPress={() => handleSetDefault(activeViewId)}>
                <Ionicons name={getDefaultFilterViewId() === activeViewId ? "star" : "star-outline"} size={16} color={STATUS_COLORS.warning} />
              </Pressable>
            )}
          </View>
        }
      >
        {NATURE_TABS.map((page, pageIdx) => (
          <View key={page.key} style={{ flex: 1 }}>
            {activeNatureIndex === pageIdx ? (
              filterNature === "transfers" ? (
                <FlatList
                  data={transfers}
                  keyExtractor={(item) => item.id}
                  renderItem={renderTransferItem}
                  contentContainerStyle={{ paddingBottom: 80 }}
                  refreshing={loading && transfers.length === 0}
                  onRefresh={() => loadExpenses(true)}
                  ListHeaderComponent={
                    transfers.length > 0 ? (
                      <View className="mx-4 my-2 p-4 rounded-xl bg-card">
                        <View className="flex-row items-center justify-between">
                          <Text className="text-sm font-medium text-muted-foreground">
                            Total transfers
                          </Text>
                          <Text className="text-lg font-bold" style={{ color: TRANSFER_COLOR }}>
                            {formatAmount(transfers.reduce((sum, t) => sum + t.amount, 0))}
                          </Text>
                        </View>
                        <Text className="text-xs text-muted-foreground mt-0.5">
                          {transfers.length} {transfers.length === 1 ? "transfer" : "transfers"}
                        </Text>
                      </View>
                    ) : null
                  }
                  ListEmptyComponent={
                    !loading ? (
                      <EmptyState
                        icon="swap-horizontal-outline"
                        title="No transfers yet"
                        subtitle="Transfers between accounts will appear here"
                      />
                    ) : null
                  }
                />
              ) : (
                <FlatList
                  data={groupedExpenses}
                  keyExtractor={(item) => item._type === "header" ? `header-${item.date}` : item.expense.id}
                  renderItem={renderExpenseItem}
                  onEndReached={handleLoadMore}
                  onEndReachedThreshold={0.3}
                  contentContainerStyle={{ paddingBottom: 80 }}
                  refreshing={loading && expenses.length === 0}
                  onRefresh={() => loadExpenses(true)}
                  ListHeaderComponent={
                    summary && summary.count > 0 ? (
                      <FilterSummaryCard
                        summary={summary}
                        groupLabelHeader={
                          summaryGroupBy === "category"
                            ? "Category"
                            : summaryGroupBy === "account"
                              ? "Account"
                              : summaryGroupBy === "merchant"
                                ? "Merchant"
                                : "Payment Mode"
                        }
                        resolveGroupLabel={(key) => {
                          if (!key) return summaryGroupBy === "merchant" ? "No merchant" : "Uncategorized";
                          if (summaryGroupBy === "category") return categoryMap.get(key)?.name ?? "Unknown";
                          if (summaryGroupBy === "payment_mode") return paymentModeMap.get(key)?.name ?? "Unknown";
                          if (summaryGroupBy === "merchant") return key;
                          const acct = accountMap.get(key);
                          return acct
                            ? `${acct.bank_name} ****${acct.account_identifier}`
                            : "Unknown";
                        }}
                        allowGroupByChange
                        onChangeGroupBy={setSummaryGroupBy}
                        previousTotal={previousTotal}
                        natureKind={filterNature === "credit" ? "credit" : "realized" as const}
                        availableGroupBys={
                          filterNature === "credit"
                            ? (["account", "payment_mode", "merchant"] as const)
                            : (["category", "account", "payment_mode", "merchant"] as const)
                        }
                      />
                    ) : null
                  }
                  ListEmptyComponent={
                    !loading ? (() => {
                      const isCreditView = filterNature === "credit";
                      const emptyIcon = isCreditView ? "arrow-down-circle-outline" : "receipt-outline";
                      const emptyTitle = hasActiveFilters
                        ? isCreditView ? "No matching credits" : "No matching expenses"
                        : isCreditView ? "No credits yet" : "No expenses yet";
                      const emptySubtitle = hasActiveFilters
                        ? "Try adjusting your filters"
                        : isCreditView
                          ? "Credits appear here when an incoming SMS is parsed"
                          : "Tap + to add your first expense";
                      return <EmptyState icon={emptyIcon} title={emptyTitle} subtitle={emptySubtitle} />;
                    })() : null
                  }
                  ListFooterComponent={
                    loading ? (
                      <View className="py-4 items-center">
                        <Text className="text-sm text-muted-foreground">
                          Loading expenses...
                        </Text>
                      </View>
                    ) : null
                  }
                />
              )
            ) : (
              <View style={{ flex: 1 }} />
            )}
          </View>
        ))}
      </SwipePager>

      <FABMenu
        hidden={bulkMode}
        items={[
          {
            icon: "receipt-outline",
            label: "Add Expense",
            color: theme.danger,
            onPress: () => router.push("/expense/add"),
          },
          {
            icon: "arrow-down-outline",
            label: "Add Credit",
            color: theme.success,
            onPress: () => {
              setCreditDate(new Date().toISOString().split("T")[0]);
              setShowAddCredit(true);
            },
          },
          {
            icon: "swap-horizontal",
            label: "Add Transfer",
            color: TRANSFER_COLOR,
            onPress: () => {
              setTransferDate(new Date().toISOString().split("T")[0]);
              setShowAddTransfer(true);
            },
          },
        ] satisfies FABMenuItem[]}
      />
      {/* Bulk action bar */}
      {bulkMode && (
        <BulkActionBar
          selectedCount={selectedExpenseIds.size}
          onChangeCategory={() => setBulkPickerType("category")}
          onChangePaymentMode={() => setBulkPickerType("paymentMode")}
          onChangeAccount={() => setBulkPickerType("account")}
          onChangeMerchant={() => setBulkPickerType("merchant")}
          onChangeDate={() => setBulkPickerType("date")}
          onCancel={exitBulkMode}
        />
      )}

      {/* Bulk picker modals */}
      {bulkPickerType === "category" && (
        <FilterDropdown
          label="Set Category"
          options={categories.map((c) => ({ id: c.id, label: c.name }))}
          selectedIds={[]}
          onSelectionChange={(ids) => { if (ids[0]) handleBulkApply("category", ids[0]); }}
          singleSelect
          searchable
          autoOpen
          onDismiss={() => setBulkPickerType(null)}
        />
      )}
      {bulkPickerType === "paymentMode" && (
        <FilterDropdown
          label="Set Payment Mode"
          options={paymentModes.map((p) => ({ id: p.id, label: p.name }))}
          selectedIds={[]}
          onSelectionChange={(ids) => { if (ids[0]) handleBulkApply("paymentMode", ids[0]); }}
          singleSelect
          autoOpen
          onDismiss={() => setBulkPickerType(null)}
        />
      )}
      {bulkPickerType === "account" && (
        <FilterDropdown
          label="Set Account"
          options={accounts.map((a) => ({ id: a.id, label: `${a.bank_name} ****${a.account_identifier}` }))}
          selectedIds={[]}
          onSelectionChange={(ids) => { if (ids[0]) handleBulkApply("account", ids[0]); }}
          singleSelect
          searchable
          autoOpen
          onDismiss={() => setBulkPickerType(null)}
        />
      )}
      {bulkPickerType === "merchant" && (
        <FilterDropdown
          label="Set Merchant"
          options={allMerchantNames.map((m) => ({ id: m, label: m }))}
          selectedIds={[]}
          onSelectionChange={(ids) => { if (ids[0]) handleBulkApply("merchant", ids[0]); }}
          singleSelect
          searchable
          autoOpen
          onDismiss={() => setBulkPickerType(null)}
        />
      )}
      {bulkPickerType === "date" && (
        <View className="absolute left-0 right-0 bottom-0 top-0 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.4)", zIndex: 100 }}>
          <Pressable className="flex-1" onPress={() => setBulkPickerType(null)} />
          <View className="rounded-t-2xl px-4 pt-4 pb-8" style={{ backgroundColor: colors.background }}>
            <Text className="text-sm font-semibold text-foreground mb-3">Set Date</Text>
            <DateInput
              label=""
              value=""
              onChange={(date) => { if (date) handleBulkApply("date", date); }}
              maximumDate={null}
            />
            <Pressable onPress={() => setBulkPickerType(null)} className="mt-3">
              <Text className="text-xs text-center" style={{ color: theme.primary }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
      {/* Add Credit bottom sheet */}
      {showAddCredit && (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 0, zIndex: 50, justifyContent: "flex-end" }}
        >
          <Pressable style={{ flex: 1 }} onPress={handleCancelCredit} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginRight: 10, backgroundColor: theme.success + "20" }}>
                <Ionicons name="arrow-down-outline" size={16} color={theme.success} />
              </View>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.text }}>Add Credit</Text>
            </View>
            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.textSecondary, marginBottom: 4 }}>Account</Text>
            <Pressable
              onPress={() => setShowCreditAccountPicker(true)}
              style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 }}
            >
              <Ionicons name="wallet-outline" size={16} color={creditAccountId ? theme.success : colors.textSecondary} />
              <Text style={{ flex: 1, fontSize: 14, marginLeft: 8, color: creditAccountId ? colors.text : colors.textSecondary }}>
                {creditAccountLabel || "Select account"}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
            </Pressable>
            <Input
              placeholder="Amount"
              formula
              value={creditAmount}
              onChangeText={setCreditAmount}
              containerClassName="mb-3"
            />
            <TextInput
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, fontSize: 14, color: colors.text }}
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
              containerClassName="mb-4"
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={handleCancelCredit}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center", borderWidth: 1, borderColor: colors.border }}
              >
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.textSecondary }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSaveCredit}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center", backgroundColor: theme.success }}
              >
                <Text style={{ fontSize: 14, fontWeight: "600", color: "#fff" }}>Add Credit</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Add Transfer bottom sheet */}
      {showAddTransfer && (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 0, zIndex: 50, justifyContent: "flex-end" }}
        >
          <Pressable style={{ flex: 1 }} onPress={handleCancelTransfer} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginRight: 10, backgroundColor: TRANSFER_COLOR + "20" }}>
                <Ionicons name="swap-horizontal" size={16} color={TRANSFER_COLOR} />
              </View>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.text }}>Add Transfer</Text>
            </View>
            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.textSecondary, marginBottom: 4 }}>From Account</Text>
            <Pressable
              onPress={() => setShowFromPicker(true)}
              style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 }}
            >
              <Ionicons name="wallet-outline" size={16} color={transferFromAccountId ? TRANSFER_COLOR : colors.textSecondary} />
              <Text style={{ flex: 1, fontSize: 14, marginLeft: 8, color: transferFromAccountId ? colors.text : colors.textSecondary }}>
                {transferFromLabel || "Select account"}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
            </Pressable>
            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.textSecondary, marginBottom: 4 }}>To Account</Text>
            <Pressable
              onPress={() => setShowToPicker(true)}
              style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 }}
            >
              <Ionicons name="wallet-outline" size={16} color={transferToAccountId ? TRANSFER_COLOR : colors.textSecondary} />
              <Text style={{ flex: 1, fontSize: 14, marginLeft: 8, color: transferToAccountId ? colors.text : colors.textSecondary }}>
                {transferToLabel || "Select account"}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
            </Pressable>
            <Input
              placeholder="Amount"
              formula
              value={transferAmount}
              onChangeText={setTransferAmount}
              containerClassName="mb-3"
            />
            <TextInput
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, fontSize: 14, color: colors.text }}
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
              containerClassName="mb-4"
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={handleCancelTransfer}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center", borderWidth: 1, borderColor: colors.border }}
              >
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.textSecondary }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSaveTransfer}
                disabled={!transferFromAccountId || !transferToAccountId}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center", backgroundColor: (transferFromAccountId && transferToAccountId) ? TRANSFER_COLOR : colors.textSecondary + "40" }}
              >
                <Text style={{ fontSize: 14, fontWeight: "600", color: "#fff" }}>Add Transfer</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Account pickers */}
      <AccountPickerSheet
        visible={showCreditAccountPicker}
        onSelect={(id) => {
          setCreditAccountId(id);
          const acct = accounts.find((a) => a.id === id);
          setCreditAccountLabel(acct ? (acct.account_label || `${acct.bank_name} ****${acct.account_identifier}`) : "Selected");
          setShowCreditAccountPicker(false);
        }}
        onClose={() => setShowCreditAccountPicker(false)}
        title="Credit Account"
        filterTypes={["savings", "wallet", "credit_card"]}
      />
      <AccountPickerSheet
        visible={showFromPicker}
        onSelect={(id) => {
          setTransferFromAccountId(id);
          const acct = accounts.find((a) => a.id === id);
          setTransferFromLabel(acct ? (acct.account_label || `${acct.bank_name} ****${acct.account_identifier}`) : "Selected");
          setShowFromPicker(false);
        }}
        onClose={() => setShowFromPicker(false)}
        title="Transfer From"
        filterTypes={["savings", "wallet", "demat"]}
        excludeAccountId={transferToAccountId ?? undefined}
      />
      <AccountPickerSheet
        visible={showToPicker}
        onSelect={(id) => {
          setTransferToAccountId(id);
          const acct = accounts.find((a) => a.id === id);
          setTransferToLabel(acct ? (acct.account_label || `${acct.bank_name} ****${acct.account_identifier}`) : "Selected");
          setShowToPicker(false);
        }}
        onClose={() => setShowToPicker(false)}
        title="Transfer To"
        filterTypes={["savings", "wallet", "credit_card", "demat"]}
        excludeAccountId={transferFromAccountId ?? undefined}
      />

      {/* Demat follow-up sheet */}
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

      {/* Sort sheet */}
      <Modal transparent animationType="slide" visible={showSortSheet} onRequestClose={() => setShowSortSheet(false)}>
        <Pressable className="flex-1 bg-black/40" onPress={() => setShowSortSheet(false)} />
        <View
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0,
            backgroundColor: colors.surface,
            borderTopLeftRadius: 20, borderTopRightRadius: 20,
            paddingBottom: 28,
          }}
        >
          <View className="items-center pt-3 pb-1">
            <View className="w-10 h-1 rounded-full bg-border" />
          </View>
          <View className="flex-row items-center justify-between px-5 pb-3 pt-1">
            <Text className="text-base font-bold text-foreground">Sort by</Text>
            <Pressable onPress={() => setShowSortSheet(false)} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          {SORT_OPTIONS.map((opt) => {
            const active = sortBy === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => {
                  setSortBy(opt.value);
                  settingsStorage.set(SORT_KEY, opt.value);
                  setShowSortSheet(false);
                }}
                className="flex-row items-center px-5 py-3.5"
                accessibilityRole="button"
                accessibilityLabel={opt.label}
                accessibilityState={{ selected: active }}
              >
                <Ionicons
                  name={opt.icon as never}
                  size={18}
                  color={active ? theme.primary : colors.textSecondary}
                />
                <Text
                  className="flex-1 text-sm ml-3"
                  style={{ color: active ? theme.primary : colors.text, fontWeight: active ? "600" : "400" }}
                >
                  {opt.label}
                </Text>
                {active && <Ionicons name="checkmark" size={18} color={theme.primary} />}
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </ScreenContainer>
  );
}
