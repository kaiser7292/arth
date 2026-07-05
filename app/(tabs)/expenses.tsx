import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { View, Text, FlatList, Pressable, TextInput, ScrollView } from "react-native";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ScreenContainer, FAB, DateInput, EmptyState } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ac } from "@/utils/accent";

import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getExpensesPaginated,
  getFilteredExpenseSummary,
  getPreviousPeriodTotal,
  deleteExpense,
  deleteSplitExpense,
  sumRefundsByExpenseIds,
} from "@/services/expense";
import {
  getTransfersForUser,
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

const PAGE_SIZE = 50;



export default function ExpensesScreen() {
  const alert = useAlert();
  const router = useRouter();
  const { colors, accent, colorScheme } = useColorScheme();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [transfers, setTransfers] = useState<AccountTransfer[]>([]);
  const [refundedMap, setRefundedMap] = useState<Map<string, number>>(new Map());
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [allMerchantNames, setAllMerchantNames] = useState<string[]>([]);
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
  const [filterAvoidability, setFilterAvoidability] = useState<"" | "avoidable" | "unavoidable">("");
  const [filterNature, setFilterNature] = useState<"realized" | "committed" | "credit" | "transfers" | "all">("realized");
  const [showFilters, setShowFilters] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedFilterView[]>(() => getSavedFilterViews());
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [showViewsPicker, setShowViewsPicker] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<string>>(new Set());

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

  const loadExpenses = useCallback(
    async (reset = true) => {
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
    [debouncedSearch, filterStartDate, filterEndDate, filterCategoryIds, filterPaymentModeIds, filterAccountIds, filterTagIds, filterMerchantNames, filterRefundedStatus, filterAvoidability, filterNature, summaryGroupBy, loading],
  );

  // Load reference data once
  useEffect(() => {
    async function loadReferenceData() {
      try {
        const [cats, pms, accts, tags, merchants] = await Promise.all([
          getCategories(DEFAULT_USER_ID),
          getPaymentModes(DEFAULT_USER_ID),
          getActiveAccounts(DEFAULT_USER_ID),
          getTags(DEFAULT_USER_ID),
          getDistinctMerchantNames(DEFAULT_USER_ID),
        ]);
        setCategories(cats);
        setPaymentModes(pms);
        setAccounts(accts);
        setAllTags(tags);
        setAllMerchantNames(merchants);
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
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearch, filterStartDate, filterEndDate, filterCategoryIds, filterPaymentModeIds, filterAccountIds, filterTagIds, filterMerchantNames, filterRefundedStatus, filterAvoidability, filterNature, summaryGroupBy]),
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

  const hasNonDateFilters = !!search || filterCategoryIds.length > 0 || filterPaymentModeIds.length > 0 || filterAccountIds.length > 0 || filterTagIds.length > 0 || filterMerchantNames.length > 0 || !!filterRefundedStatus || !!filterAvoidability || filterNature !== "realized";
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
            }
          }}
          className="flex-row items-center px-4 py-3 border-b border-border-light dark:border-border-dark"
        >
          <View className="flex-1">
            <Text className="text-sm font-medium" style={{ color: colors.text }}>
              {item.description || "Transfer"}
            </Text>
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
              {accountName} → {toAccountName}
            </Text>
            <Text className="text-[10px] text-text-tertiary">{item.date}</Text>
          </View>
          <View className="items-end">
            <Text className="text-sm font-bold" style={{ color: accent[500] }}>
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

  const renderExpenseItem = useCallback(
    ({ item }: { item: Expense }) => (
      <View className="flex-row items-center">
        {bulkMode && (
          <Pressable
            onPress={() => handleItemPress(item.id)}
            className="pl-4 pr-1 py-3"
          >
            <View
              className="w-5 h-5 rounded items-center justify-center"
              style={{
                backgroundColor: selectedExpenseIds.has(item.id) ? accent[500] : "transparent",
                borderWidth: selectedExpenseIds.has(item.id) ? 0 : 1.5,
                borderColor: selectedExpenseIds.has(item.id) ? accent[500] : colors.border,
              }}
            >
              {selectedExpenseIds.has(item.id) && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
            </View>
          </Pressable>
        )}
        <View className="flex-1">
          <ExpenseListRow
            item={item}
            categoryMap={categoryMap}
            paymentModeMap={paymentModeMap}
            accountMap={accountMap}
            refundedMap={refundedMap}
            onPress={handleItemPress}
            onLongPress={handleLongPress}
          />
        </View>
      </View>
    ),
    [categoryMap, paymentModeMap, accountMap, refundedMap, handleItemPress, handleLongPress, bulkMode, selectedExpenseIds, accent, colors],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <ScreenContainer padTop={false}>
      {/* Search bar */}
      <View className="px-4 pt-3 pb-2">
        <View className="flex-row items-center rounded-lg bg-surface-light-alt dark:bg-surface-dark-alt px-3 py-2">
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search expenses..."
            placeholderTextColor={colors.tabIconDefault}
            maxLength={100}
            accessibilityLabel="Search expenses"
            className="flex-1 ml-2 text-base text-text-primary dark:text-text-dark-primary"
            returnKeyType="search"
          />
          {search !== "" && (
            <Pressable onPress={() => setSearch("")} accessibilityLabel="Clear search" accessibilityRole="button">
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </Pressable>
          )}
          <Pressable
            onPress={() => setShowFilters(!showFilters)}
            accessibilityLabel={showFilters ? "Hide filters" : "Show filters"}
            accessibilityRole="button"
            className="ml-2 p-1"
          >
            <Ionicons
              name="options-outline"
              size={20}
              color={hasActiveFilters ? colors.blue : "#9CA3AF"}
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
            className="flex-1 text-sm text-text-primary dark:text-text-dark-primary bg-surface-light-alt dark:bg-surface-dark-alt rounded-lg px-3 py-2 mr-2"
          />
          <Pressable onPress={confirmSaveView} className="px-3 py-2 rounded-lg" style={{ backgroundColor: accent[500] }}>
            <Text className="text-xs font-medium text-white">Save</Text>
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
            className="flex-row items-center justify-between py-3 px-3 rounded-lg bg-surface-light-alt dark:bg-surface-dark-alt"
          >
            <View className="flex-row items-center">
              <Ionicons name="bookmark-outline" size={14} color={accent[500]} style={{ marginRight: 6 }} />
              <Text className="text-sm font-medium" style={{ color: activeViewId ? accent[500] : colors.textSecondary }}>
                {activeViewId ? savedViews.find((v) => v.id === activeViewId)?.name ?? "Saved Views" : "Saved Views"}
              </Text>
            </View>
            <Ionicons name={showViewsPicker ? "chevron-up" : "chevron-down"} size={14} color={colors.textSecondary} />
          </Pressable>

          {showViewsPicker && (
            <View className="mt-1 rounded-lg bg-surface-light-alt dark:bg-surface-dark-alt overflow-hidden">
              {savedViews.map((view) => {
                const isActive = activeViewId === view.id;
                const isDefault = getDefaultFilterViewId() === view.id;
                return (
                  <View key={view.id} className="flex-row items-center border-b border-border-light dark:border-border-dark">
                    <Pressable
                      onPress={() => { applyFilterView(view); setShowViewsPicker(false); }}
                      className="flex-1 flex-row items-center px-3 py-2.5"
                    >
                      {isDefault && <Ionicons name="star" size={11} color="#F59E0B" style={{ marginRight: 5 }} />}
                      <Text className={`text-sm flex-1 ${isActive ? "font-semibold" : "text-text-primary dark:text-text-dark-primary"}`} style={isActive ? { color: accent[500] } : undefined}>
                        {view.name}
                      </Text>
                      {isActive && <Ionicons name="checkmark" size={14} color={accent[500]} />}
                    </Pressable>
                    <Pressable
                      onPress={() => handleSetDefault(view.id)}
                      className="px-2 py-2.5"
                    >
                      <Ionicons name={isDefault ? "star" : "star-outline"} size={14} color="#F59E0B" />
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

      {/* Expenses / Committed / Credits toggle + Save view actions */}
      <View className="px-4 pb-2 flex-row items-center justify-between">
        <View className="flex-row">
          {([
            { key: "all" as const, label: "All", icon: "layers-outline" as const },
            { key: "realized" as const, label: "Expenses", icon: "receipt-outline" as const },
            { key: "committed" as const, label: "Committed", icon: "lock-closed-outline" as const },
            { key: "credit" as const, label: "Credits", icon: "arrow-down-circle-outline" as const },
            { key: "transfers" as const, label: "Transfers", icon: "swap-horizontal-outline" as const },
          ]).map((opt) => {
            const isActive = filterNature === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => {
                  if (isActive) return;
                  if (filterNature === "realized") groupByForRealizedRef.current = summaryGroupBy;
                  else if (filterNature === "credit") groupByForCreditRef.current = summaryGroupBy;
                  setFilterNature(opt.key);
                  setSummaryGroupBy(
                    opt.key === "credit" ? groupByForCreditRef.current : groupByForRealizedRef.current,
                  );
                  if (opt.key !== "realized") {
                    setFilterRefundedStatus("");
                    setFilterAvoidability("");
                  }
                  if (opt.key === "transfers") {
                    setFilterCategoryIds([]);
                    setFilterPaymentModeIds([]);
                    setFilterTagIds([]);
                    setFilterMerchantNames([]);
                  }
                }}
                accessibilityRole="button"
                className={`flex-row items-center px-3 py-1.5 rounded-lg mr-1.5 ${
                  isActive ? "border" : "bg-surface-light-alt dark:bg-surface-dark-alt"
                }`}
                style={isActive ? { backgroundColor: ac(accent, colorScheme, 100, 700), borderColor: accent[500] } : undefined}
              >
                <Ionicons
                  name={opt.icon}
                  size={13}
                  color={isActive ? ac(accent, colorScheme, 500, 200) : colors.textSecondary}
                  style={{ marginRight: 3 }}
                />
                <Text
                  className={`text-[11px] ${isActive ? "font-medium" : "text-text-secondary dark:text-text-dark-secondary"}`}
                  style={isActive ? { color: ac(accent, colorScheme, 500, 200) } : undefined}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {/* Save / Default actions */}
        <View className="flex-row items-center">
          {hasActiveFilters && (
            <Pressable onPress={handleSaveView} className="mr-3">
              <Ionicons name="bookmark-outline" size={16} color={accent[500]} />
            </Pressable>
          )}
          {activeViewId && (
            <Pressable onPress={() => handleSetDefault(activeViewId)}>
              <Ionicons name={getDefaultFilterViewId() === activeViewId ? "star" : "star-outline"} size={16} color="#F59E0B" />
            </Pressable>
          )}
        </View>
      </View>

      {/* Date preset selector */}
      <View className="px-4 pb-2">
        <Pressable
          onPress={() => setShowDatePicker(!showDatePicker)}
          className="flex-row items-center justify-between py-3 px-3 rounded-lg bg-surface-light-alt dark:bg-surface-dark-alt"
        >
          <View className="flex-row items-center">
            <Ionicons name="calendar-outline" size={14} color={accent[500]} style={{ marginRight: 6 }} />
            <Text className="text-sm font-medium" style={{ color: accent[500] }}>
              {DATE_PRESET_LABELS[datePreset]}
            </Text>
          </View>
          <Ionicons name={showDatePicker ? "chevron-up" : "chevron-down"} size={14} color={colors.textSecondary} />
        </Pressable>

        {showDatePicker && (
          <ScrollView
            className="mt-1 rounded-lg bg-surface-light-alt dark:bg-surface-dark-alt overflow-hidden"
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
                  className="flex-row items-center justify-between px-3 py-3 border-b border-border-light dark:border-border-dark"
                >
                  <Text
                    className="text-sm text-text-primary dark:text-text-dark-primary"
                    style={isSelected ? { color: accent[500], fontWeight: "600" } : undefined}
                  >
                    {DATE_PRESET_LABELS[preset]}
                  </Text>
                  {isSelected && <Ionicons name="checkmark" size={16} color={accent[500]} />}
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
          setFilterRefundedStatus(((selections.refundStatus ?? [])[0] ?? "") as typeof filterRefundedStatus);
          setFilterAvoidability(((selections.avoidability ?? [])[0] ?? "") as typeof filterAvoidability);
        }}
        onReset={() => {
          setFilterCategoryIds([]);
          setFilterPaymentModeIds([]);
          setFilterAccountIds([]);
          setFilterTagIds([]);
          setFilterMerchantNames([]);
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
                <Text className="text-[10px] text-text-tertiary">{cat.name}</Text>
                <Ionicons name="close" size={10} color={colors.textSecondary} style={{ marginLeft: 2 }} />
              </Pressable>
            );
          })}
          {filterPaymentModeIds.map((id) => {
            const pm = paymentModeMap.get(id);
            if (!pm) return null;
            return (
              <Pressable key={`pm-${id}`} onPress={() => setFilterPaymentModeIds((prev) => prev.filter((x) => x !== id))} className="flex-row items-center mr-3 mb-1">
                <Text className="text-[10px] text-text-tertiary">{pm.name}</Text>
                <Ionicons name="close" size={10} color={colors.textSecondary} style={{ marginLeft: 2 }} />
              </Pressable>
            );
          })}
          {filterAccountIds.map((id) => {
            const acct = accountMap.get(id);
            if (!acct) return null;
            return (
              <Pressable key={`acct-${id}`} onPress={() => setFilterAccountIds((prev) => prev.filter((x) => x !== id))} className="flex-row items-center mr-3 mb-1">
                <Text className="text-[10px] text-text-tertiary">{acct.bank_name}</Text>
                <Ionicons name="close" size={10} color={colors.textSecondary} style={{ marginLeft: 2 }} />
              </Pressable>
            );
          })}
          {filterMerchantNames.map((name) => (
            <Pressable key={`merchant-${name}`} onPress={() => setFilterMerchantNames((prev) => prev.filter((x) => x !== name))} className="flex-row items-center mr-3 mb-1">
              <Text className="text-[10px] text-text-tertiary">{name}</Text>
              <Ionicons name="close" size={10} color={colors.textSecondary} style={{ marginLeft: 2 }} />
            </Pressable>
          ))}
          {filterRefundedStatus !== "" && (
            <Pressable onPress={() => setFilterRefundedStatus("")} className="flex-row items-center mr-3 mb-1">
              <Text className="text-[10px] text-text-tertiary">{filterRefundedStatus === "refunded" ? "Refunded" : "Not refunded"}</Text>
              <Ionicons name="close" size={10} color={colors.textSecondary} style={{ marginLeft: 2 }} />
            </Pressable>
          )}
          {filterAvoidability !== "" && (
            <Pressable onPress={() => setFilterAvoidability("")} className="flex-row items-center mr-3 mb-1">
              <Text className="text-[10px] text-text-tertiary">{filterAvoidability === "avoidable" ? "Avoidable" : "Unavoidable"}</Text>
              <Ionicons name="close" size={10} color={colors.textSecondary} style={{ marginLeft: 2 }} />
            </Pressable>
          )}
          {search !== "" && (
            <Pressable onPress={() => setSearch("")} className="flex-row items-center mr-3 mb-1">
              <Text className="text-[10px] text-text-tertiary">"{search}"</Text>
              <Ionicons name="close" size={10} color={colors.textSecondary} style={{ marginLeft: 2 }} />
            </Pressable>
          )}
          <Pressable onPress={() => { clearFilters(); setActiveViewId(null); }} className="flex-row items-center mb-1">
            <Text className="text-[10px] font-medium" style={{ color: accent[500] }}>Clear all</Text>
          </Pressable>
        </View>
      )}

      {/* Expense list */}
      {filterNature === "transfers" ? (
        <FlatList
          data={transfers}
          keyExtractor={(item) => item.id}
          renderItem={renderTransferItem}
          contentContainerStyle={{ paddingBottom: 80 }}
          refreshing={loading && transfers.length === 0}
          onRefresh={() => loadExpenses(true)}
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
          data={expenses}
          keyExtractor={(item) => item.id}
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
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
                Loading expenses...
              </Text>
            </View>
          ) : null
        }
      />
      )}

      <FAB
        icon="add"
        onPress={() =>
          alert("Add…", "What would you like to add?", [
            { text: "Cancel", style: "cancel" },
            { text: "Expense", onPress: () => router.push("/expense/add") },
            { text: "Refund", onPress: () => router.push("/expense/add?type=refund") },
          ])
        }
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
            <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary mb-3">Set Date</Text>
            <DateInput
              label=""
              value=""
              onChange={(date) => { if (date) handleBulkApply("date", date); }}
              maximumDate={null}
            />
            <Pressable onPress={() => setBulkPickerType(null)} className="mt-3">
              <Text className="text-xs text-center" style={{ color: accent[500] }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScreenContainer>
    </GestureHandlerRootView>
  );
}
