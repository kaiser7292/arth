import { isPartOn } from "@/services/customise";
import { useCustomisation } from "@/hooks/use-customisation";
import { CREDIT_KIND_LABELS, CREDIT_KIND_LOOKS, CREDIT_KINDS, PICKABLE_CREDIT_KINDS, creditLook, type CreditKind } from "@/services/expense-types";
import { useExpenseGrouping } from "@/hooks/use-expense-grouping";
import { useGroupBy } from "@/hooks/use-group-by";
import { setGroupByPreference } from "@/services/group-by-preference";
import { formatMonthLabel } from "@/utils/date";
import { labelOf, signedAmount, signedNet, type ExpenseGroupBy } from "@/utils/expense-grouping";
import { groupRows, NO_GROUP } from "@/utils/group-rows";
import { LIST_ROW_LIMIT } from "@/utils/list-tools";
import { restoreExpense } from "@/services/expense-crud";
import { SelectSheet } from "@/components/ui";
import { EXPENSE_SORT_OPTIONS, type ExpenseSortBy } from "@/constants/sort-options";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { parseNLQuery } from "@/utils/nl-search";
import { matchesSearch } from "@/utils/amount-search";
import { transactionDayLabel } from "@/utils/day-label";
import { isSpeechRecognitionAvailable, SpeechRecognition, useSpeechRecognitionEvent } from "@/services/speech-recognition";
import { View, FlatList, Pressable, TextInput, Platform } from "react-native";
import Animated from "react-native-reanimated";
import { listLayout } from "@/components/motion/motion";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ContextualHeader, DateInput, DrawerCell, EmptyState, FABMenu, GroupHeading, ListCapNote, ListToolbar, LoadFailed, Money, ScreenContainer, SkeletonList, SwipePager, Text, moneyTone, useToast } from "@/components/ui";
import type { FABMenuItem, SwipePagerPage, ToolbarChip } from "@/components/ui";
import { useAlert } from "@/hooks/use-alert";
import { useDebouncedValue } from "@/hooks/use-debounced-value";


import { DEFAULT_USER_ID } from "@/constants/app";
import { getDataVersion } from "@/services/settings";
import {
  getExpensesPaginated,
  countFilteredExpenses,
  getFilteredExpenseSummary,
  getFilteredMonthTotals,
  getFilteredGroupTotals,
  getPendingExpenseCount,
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
import type { DrawerGroupBy, FilteredSummary } from "@/services/expense";
import { FilterSummaryCard } from "@/components/expense/FilterSummaryCard";
import { getAllCategories, getCategories } from "@/services/category";
import { getPaymentModes } from "@/services/payment-mode";
import { getActiveAccounts } from "@/services/financial-account";
import { getTags, getTagsForExpenses } from "@/services/tags";
import { getDistinctMerchantNames } from "@/services/merchant-alias";
import { listRules, type SmartRule } from "@/services/smart-rules";
import type { Expense } from "@/services/expense";
import { NOT_SET, NOT_SET_LABELS } from "@/services/expense-types";
import type { Category } from "@/services/category";
import type { PaymentMode } from "@/services/payment-mode";
import type { FinancialAccount } from "@/services/financial-account";
import type { Tag } from "@/services/tags";
import { formatAmount } from "@/utils/expense-validation";
import { ExpenseListRow } from "@/components/expense/ExpenseListRow";
import { FilterDropdown } from "@/components/expense/FilterDropdown";
import { useGroupDrawers } from "@/hooks/use-group-drawers";
import { CategoryPickerSheet } from "@/components/expense/catch-up/CategoryPickerSheet";
import { TransactionFilterSheet, defaultGroupFor, draftTotal, type TxFilterDraft } from "@/components/expense/TransactionFilterSheet";
import { autoGroupFor } from "@/utils/auto-group";
import { DrawerBody, DrawerEmpty, DrawerEnd, DrawerLoading, GroupDrawerHeader, MonthDrawerHeader, type DrawerMode } from "@/components/expense/MonthDrawer";
import { buildDrawerRows, monthBounds, orderMonths, summarizeByMonth, type DrawerRow, type MonthSummary } from "@/utils/month-drawers";
import { formatDateForDisplay } from "@/utils/expense-validation";
import { BulkActionBar } from "@/components/expense/BulkActionBar";
import { bulkSetCategory, bulkSetCreditKind, bulkUpdateExpenses } from "@/services/expense-bulk";
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
  type SavedFilterView,
  type FilterViewState,
  type DatePreset,
} from "@/services/saved-filter-views";
import { TRANSFER_COLOR } from "@/constants/semantic-colors";

import { settingsStorage } from "@/services/storage";
import { Modal } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { consumeTransactionsPreload } from "@/services/home-preload";

const SORT_KEY = "expenses.sortBy";

const PAGE_SIZE = 50;
/** What the list opens on, and what "Clear all" goes back to: a year of month drawers. */
const DEFAULT_PRESET: DatePreset = "last_12_months";
// Groups only add up with every row in them, so a list grouped by anything but date isn't paged.
const ALL_ROWS = LIST_ROW_LIMIT;
const SPEND_GROUPS: readonly ExpenseGroupBy[] = ["date", "month", "year", "category", "merchant", "account", "payment_mode", "person"];
const CREDIT_GROUPS: readonly ExpenseGroupBy[] = ["date", "month", "year", "category", "merchant", "account", "person"];
type TransferGroupBy = "date" | "month" | "from" | "to";
const TRANSFER_GROUPS: readonly TransferGroupBy[] = ["date", "month", "from", "to"];
const TRANSFER_GROUP_OPTIONS: { value: TransferGroupBy; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "month", label: "Month" },
  { value: "from", label: "From account" },
  { value: "to", label: "To account" },
];

const preloaded = consumeTransactionsPreload();

// Credits, debits and transfers (owner, Nov 2026): Debits holds every debit, spending and committed
// money alike, and each row's tag says what it is: SIP, FD, EMI, investment, transfer.
const NATURE_TABS: SwipePagerPage[] = [
  { key: "all", label: "All" },
  { key: "realized", label: "Debits" },
  { key: "credit", label: "Credits" },
  { key: "transfers", label: "Transfers" },
];

/** Groupings that show as drawers: every one but None and Person (people come from another table). */
const DRAWER_GROUPS: ReadonlySet<ExpenseGroupBy> = new Set(["date", "month", "year", "category", "merchant", "account", "payment_mode"]);
const isDateDrawer = (by: ExpenseGroupBy) => by === "date" || by === "month" || by === "year";

/**
 * A row's drawer, matching the SQL in getFilteredGroupTotals: a credit's "category" is its type, a
 * sub-category sits in its parent's drawer, and no value is NOT_SET.
 */
function drawerKeyOf(e: Expense, by: ExpenseGroupBy, categoryMap: ReadonlyMap<string, Category>): string {
  switch (by) {
    case "date":
      return e.date?.slice(0, 10) ?? NOT_SET;
    case "month":
      return e.date?.slice(0, 7) ?? NOT_SET;
    case "year":
      return e.date?.slice(0, 4) ?? NOT_SET;
    case "category": {
      if (e.nature === "credit") return `type:${e.credit_kind ?? "other"}`;
      if (!e.category_id) return NOT_SET;
      const parent = categoryMap.get(e.category_id)?.parent_id;
      return parent && categoryMap.get(parent)?.is_active === 1 ? parent : e.category_id;
    }
    case "merchant":
      return e.merchant_name?.trim() || NOT_SET;
    case "account":
      return e.account_id ?? NOT_SET;
    case "payment_mode":
      return e.payment_mode_id ?? NOT_SET;
    default:
      return NOT_SET;
  }
}

/** The list's filters narrowed to one drawer, to load just its rows. */
function filtersForDrawer<F extends { startDate?: string; endDate?: string; categoryIds?: string[]; creditKinds?: string[]; merchantNames?: string[]; accountIds?: string[]; paymentModeIds?: string[] }>(
  filters: F,
  by: ExpenseGroupBy,
  key: string,
): F {
  const clamp = (start: string, end: string) => ({
    startDate: filters.startDate && filters.startDate > start ? filters.startDate : start,
    endDate: filters.endDate && filters.endDate < end ? filters.endDate : end,
  });
  switch (by) {
    case "date":
      return { ...filters, startDate: key, endDate: key };
    case "month": {
      const b = monthBounds(key, filters.startDate, filters.endDate);
      return { ...filters, startDate: b.start, endDate: b.end };
    }
    case "year":
      return { ...filters, ...clamp(`${key}-01-01`, `${key}-12-31`) };
    case "category":
      return key.startsWith("type:")
        ? { ...filters, creditKinds: [key.slice(5)], categoryIds: undefined }
        : { ...filters, categoryIds: [key], creditKinds: undefined };
    case "merchant":
      return { ...filters, merchantNames: [key] };
    case "account":
      return { ...filters, accountIds: [key] };
    case "payment_mode":
      return { ...filters, paymentModeIds: [key] };
    default:
      return filters;
  }
}

/** Date drawers in date order; the others biggest first. */
function orderDrawers(totals: ReadonlyMap<string, MonthSummary>, by: ExpenseGroupBy, oldestFirst: boolean): MonthSummary[] {
  if (isDateDrawer(by)) return orderMonths(totals, oldestFirst);
  return [...totals.values()].filter((m) => m.count > 0).sort((a, b) => b.spent + b.received - (a.spent + a.received));
}

/** The query a set of filters runs. One place, so the list and the sheet's count can't disagree. */
function filtersFromDraft(
  d: Omit<TxFilterDraft, "groupBy">,
  filterNature: "realized" | "committed" | "credit" | "transfers" | "all",
  search: string,
) {
  const { start, end } = resolveDatePreset(d.datePreset, d.customStart, d.customEnd);
  const minN = parseFloat(d.minAmount);
  const maxN = parseFloat(d.maxAmount);
  const nature: "realized" | "credit" | "all" = filterNature === "credit" ? "credit" : filterNature === "all" ? "all" : "realized";
  // Debits is every debit now; the old Committed tab's rows carry their tag instead.
  const segment = filterNature === "committed" ? ("committed" as const) : undefined;
  return {
    startDate: start,
    endDate: end,
    search: search.trim() || undefined,
    categoryIds: d.categoryIds.length > 0 ? d.categoryIds : undefined,
    creditKinds: d.creditKinds.length > 0 ? d.creditKinds : undefined,
    paymentModeIds: d.paymentModeIds.length > 0 ? d.paymentModeIds : undefined,
    accountIds: d.accountIds.length > 0 ? d.accountIds : undefined,
    tagIds: d.tagIds.length > 0 ? d.tagIds : undefined,
    merchantNames: d.merchantNames.length > 0 ? d.merchantNames : undefined,
    refundedStatus: d.refundedStatus || undefined,
    avoidability: d.avoidability || undefined,
    ruleIds: d.ruleIds.length > 0 ? d.ruleIds : undefined,
    status: d.status || undefined,
    minAmount: Number.isFinite(minN) ? minN : undefined,
    maxAmount: Number.isFinite(maxN) ? maxN : undefined,
    sortBy: d.sortBy as ExpenseSortBy,
    nature,
    segment,
    // Money moved into a demat account is listed as money out, tagged Investment.
    withInvestmentTransfers: nature !== "credit",
  };
}

export default function ExpensesScreen() {
  const alert = useAlert();
  useCustomisation();
  const natureTabs = NATURE_TABS.filter(
    (t) => (t.key !== "committed" || isPartOn("tx_committed")) && (t.key !== "transfers" || isPartOn("tx_transfers")),
  );
  const router = useRouter();
  const theme = useTheme();
  const toast = useToast();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [transfers, setTransfers] = useState<AccountTransfer[]>([]);
  const [pendingCount, setPendingCount] = useState(preloaded?.pendingCount ?? 0);
  const [refundedMap, setRefundedMap] = useState<Map<string, number>>(new Map());
  const [categories, setCategories] = useState<Category[]>(preloaded?.categories ?? []);
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>(preloaded?.paymentModes ?? []);
  const [accounts, setAccounts] = useState<FinancialAccount[]>(preloaded?.accounts ?? []);
  const [allTags, setAllTags] = useState<Tag[]>(preloaded?.tags ?? []);
  const [allMerchantNames, setAllMerchantNames] = useState<string[]>(preloaded?.merchantNames ?? []);
  const [allRules, setAllRules] = useState<SmartRule[]>(preloaded?.rules ?? []);
  const [filterRuleIds, setFilterRuleIds] = useState<string[]>([]);
  const [expenseTagMap, setExpenseTagMap] = useState<Record<string, Tag[]>>({});
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [summary, setSummary] = useState<FilteredSummary | null>(null);
  const [previousTotal, setPreviousTotal] = useState<number | null>(null);
  const [summaryGroupBy, setSummaryGroupBy] = useState<"category" | "account" | "payment_mode" | "merchant" | "type">("category");
  // Track last user-picked group-by per nature so switching Expenses↔Credits
  // doesn't force the user to re-pick. Credits group by their type: they don't have a category.
  const groupByForRealizedRef = useRef<"category" | "account" | "payment_mode" | "merchant" | "type">("category");
  const groupByForCreditRef = useRef<"category" | "account" | "payment_mode" | "merchant" | "type">("type");

  // Date filter — dynamic presets
  const [datePreset, setDatePreset] = useState<DatePreset>(DEFAULT_PRESET);
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  /** The filter sheet, and the section it opens on. */
  const [filterSheet, setFilterSheet] = useState<{ open: boolean; field?: "date" }>({ open: false });

  // Month drawers. Totals come from the database for every month in the range; a month's rows
  // load when it's opened, and stay in `expenses` (keyed by their date) until the filters change.
  const [monthTotals, setMonthTotals] = useState<Map<string, MonthSummary>>(new Map());
  // Which grouping monthTotals were counted for. Right after the grouping changes (Clear all, a new
  // date range) the old totals are still here: drawn under the new grouping, a year read as a month
  // showed "NaN undefined NaN". Drawers only draw once these match.
  const [totalsBy, setTotalsBy] = useState<string>("");
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [loadedMonths, setLoadedMonths] = useState<Set<string>>(new Set());
  const openMonthsRef = useRef(openMonths);
  openMonthsRef.current = openMonths;
  /** Bumped on every full reload, so a month that finishes loading after the filters changed is dropped. */
  const loadGen = useRef(0);

  const { start: filterStartDate, end: filterEndDate } = useMemo(
    () => resolveDatePreset(datePreset, customStartDate, customEndDate),
    [datePreset, customStartDate, customEndDate],
  );


  // Filters (all multi-select)
  const [search, setSearch] = useState("");
  // Debounce search so every keystroke doesn't refire the 5-query load.
  const debouncedSearch = useDebouncedValue(search, 300);
  const [filterCategoryIds, setFilterCategoryIds] = useState<string[]>([]);
  const [filterCreditKinds, setFilterCreditKinds] = useState<string[]>([]);
  const [filterPaymentModeIds, setFilterPaymentModeIds] = useState<string[]>([]);
  const [filterAccountIds, setFilterAccountIds] = useState<string[]>([]);
  const [filterTagIds, setFilterTagIds] = useState<string[]>([]);
  const [filterMerchantNames, setFilterMerchantNames] = useState<string[]>([]);
  const [filterRefundedStatus, setFilterRefundedStatus] = useState<"" | "refunded" | "not_refunded">("");
  const [filterStatus, setFilterStatus] = useState<"" | "pending_review" | "approved">("");
  const [filterAvoidability, setFilterAvoidability] = useState<"" | "avoidable" | "unavoidable" | "unclassified">("");
  const [filterNature, setFilterNature] = useState<"realized" | "committed" | "credit" | "transfers" | "all">("all");
  const [savedViews, setSavedViews] = useState<SavedFilterView[]>(() => getSavedFilterViews());
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<string>>(new Set());

  const [sortBy, setSortBy] = useState<ExpenseSortBy>(
    () => (settingsStorage.getString(SORT_KEY) as ExpenseSortBy | undefined) ?? "date_desc",
  );

  // Preset: navigate to a specific tab after save (refund → credits, etc.)
  const params = useLocalSearchParams<{ preset?: string; filterMonth?: string; filterAvoidability?: string; search?: string; select?: string; show?: string; hint?: string; request?: string }>();
  const presetParam = params.preset;
  const presetAppliedRef = useRef(false);
  // "See all" from Search or do. Keyed on the text, so each new search applies even with the tab open.
  useEffect(() => {
    if (params.search) setSearch(params.search);
  }, [params.search, params.request]);
  // An action from Search or do: which list to show, whether to start selecting, and what to do next.
  useEffect(() => {
    if (!params.request) return;
    if (params.show === "transfers" || params.show === "credit") setFilterNature(params.show);
    if (params.select === "1") {
      setSelectedExpenseIds(new Set());
      setBulkMode(true);
    }
    if (params.hint) toast(params.hint);
    // Only a new request should re-run this, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.request]);
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
      else if (params.filterAvoidability === "unclassified") setFilterAvoidability("unclassified");
      presetAppliedRef.current = true;
    }
  }, [presetParam]);

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  /** Hidden categories too, so the summary names them ("Pets (hidden)") instead of "Unknown". */
  const [hiddenCategoryNames, setHiddenCategoryNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    getAllCategories(DEFAULT_USER_ID)
      .then((all) => setHiddenCategoryNames(new Map(all.filter((c) => !c.is_active).map((c) => [c.id, c.name]))))
      .catch(() => {});
  }, [categories]);
  const paymentModeMap = useMemo(() => new Map(paymentModes.map((p) => [p.id, p])), [paymentModes]);
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  // All has refunds as their own credit rows, so taking them off the spend too would count them twice.
  const rowAmount = useCallback(
    (e: Expense) => (filterNature === "all" ? signedAmount(e) : signedNet(e, refundedMap.get(e.id) ?? 0)),
    [filterNature, refundedMap],
  );

  const grouping = useExpenseGrouping({
    screen: `transactions_${filterNature}`,
    kind: filterNature === "credit" ? "credit" : filterNature === "all" ? "all" : "spend",
    available: filterNature === "credit" ? CREDIT_GROUPS : SPEND_GROUPS,
    fallback: "date",
    expenses,
    names: { categoryMap, accountMap, paymentModeMap },
    amountOf: rowAmount,
  });
  // Date (and month) order shows month drawers, each loading its own rows; any other grouping
  // needs every row at once to add its groups up.
  // The grouping follows the date range (day, month or year: utils/auto-group.ts) until the owner
  // picks one; Clear all hands it back to the dates. Not remembered across app restarts.
  const [groupPinned, setGroupPinned] = useState(false);
  const autoGroup = autoGroupFor(datePreset, customStartDate, customEndDate);
  useEffect(() => {
    if (groupPinned || filterNature === "transfers") return;
    if (grouping.groupBy !== autoGroup) grouping.setGroupBy(autoGroup);
    // grouping.setGroupBy is stable enough; re-run on what decides the grouping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupPinned, autoGroup, filterNature, grouping.groupBy]);

  // Drawers follow the grouping: a day, month or year each, or one per category, merchant, account
  // or payment mode. Each drawer loads its own rows; only Person still needs every row at once.
  const drawerMode = filterNature !== "transfers" && DRAWER_GROUPS.has(grouping.groupBy);
  const drawerBy = grouping.groupBy;
  const loadEverything = !drawerMode && grouping.groupBy !== "date";
  const [transferGroupBy, setTransferGroupBy] = useGroupBy<TransferGroupBy>("transactions_transfers", TRANSFER_GROUPS, "date");

  // v17.5.3 — offset read via ref to avoid re-creating callback on every
  // append (was ripping through useCallback deps via `expenses.length`).
  const expensesLenRef = useRef(0);
  useEffect(() => {
    expensesLenRef.current = expenses.length;
  }, [expenses.length]);

  const lastVersionRef = useRef<string | null>(null);

  /**
   * Signature of everything that changes WHICH rows should be shown.
   *
   * loadExpenses skips a reload when the data version has not moved, which is right for a refocus
   * but wrong for a filter change: switching the nature tab to Debits, Credits or Transfers
   * alters the query without touching the data version, so the guard swallowed the reload and the
   * list kept showing the previous tab's rows.
   */
  const filterSignature = [
    debouncedSearch,
    filterStartDate,
    filterEndDate,
    filterCategoryIds.join(","),
    filterCreditKinds.join(","),
    filterPaymentModeIds.join(","),
    filterAccountIds.join(","),
    filterTagIds.join(","),
    filterMerchantNames.join(","),
    filterRefundedStatus,
    filterAvoidability,
    filterRuleIds.join(","),
    filterStatus,
    minAmount,
    maxAmount,
    drawerMode,
    drawerMode ? drawerBy : "",
    filterNature,
    summaryGroupBy,
    sortBy,
    loadEverything,
  ].join("|");

  // The loader is stable (useCallback with no grouping deps), so it reads these from refs.
  const drawerByRef = useRef(drawerBy);
  drawerByRef.current = drawerBy;
  const categoryMapRef = useRef(categoryMap);
  categoryMapRef.current = categoryMap;

  /** The filters the drawers were last loaded with: a change clears them, a data change doesn't. */
  const drawerSigRef = useRef<string | null>(null);
  /** The filters of the last full load; opening a month later loads it with the same ones. */
  const lastFiltersRef = useRef<Parameters<typeof getExpensesPaginated>[1] | null>(null);

  /** One drawer's rows, into `expenses` in place of whatever that drawer had. */
  const loadMonth = useCallback(async (month: string, filters: Parameters<typeof getExpensesPaginated>[1], gen: number) => {
    try {
      const rows = await getExpensesPaginated(DEFAULT_USER_ID, filtersForDrawer(filters ?? {}, drawerByRef.current, month), ALL_ROWS, 0);
      const ids = rows.map((e) => e.id);
      const [tagMap, refundMap] = await Promise.all([getTagsForExpenses(ids), sumRefundsByExpenseIds(ids)]);
      if (gen !== loadGen.current) return;
      setExpenses((prev) => [...prev.filter((e) => drawerKeyOf(e, drawerByRef.current, categoryMapRef.current) !== month), ...rows]);
      setExpenseTagMap((prev) => ({ ...prev, ...tagMap }));
      setRefundedMap((prev) => {
        const next = new Map(prev);
        refundMap.forEach((v, k) => next.set(k, v));
        return next;
      });
      setLoadedMonths((prev) => new Set(prev).add(month));
    } catch {
      if (gen !== loadGen.current) return;
      // Shows as empty rather than spinning for ever; closing and opening it tries again.
      setLoadedMonths((prev) => new Set(prev).add(month));
      toast("Couldn't load that group. Close and open it to try again.", { tone: "danger" });
    }
  }, [toast]);

  const loadedMonthsRef = useRef(loadedMonths);
  loadedMonthsRef.current = loadedMonths;
  const toggleMonth = useCallback((month: string) => {
    const next = new Set(openMonthsRef.current);
    if (next.has(month)) {
      next.delete(month);
    } else {
      next.add(month);
      // Rows already loaded stay until the next reload; a data change reloads everything anyway.
      if (filterNature !== "transfers" && !loadedMonthsRef.current.has(month) && lastFiltersRef.current) {
        void loadMonth(month, lastFiltersRef.current, loadGen.current);
      }
    }
    setOpenMonths(next);
  }, [filterNature, loadMonth]);

  const loadExpenses = useCallback(
    async (reset = true) => {
      if (reset) {
        // Stamp includes the query, not just the data version. Version alone asks "has
        // anything been written?" - changing a filter writes nothing, so a bare version
        // guard swallows the reload. This used to be patched by resetting the ref from a
        // second signature ref in the focus effect; one stamp cannot fall out of step.
        const stamp = `${getDataVersion()}|${filterSignature}`;
        if (lastVersionRef.current === stamp) return;
        lastVersionRef.current = stamp;
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
          if (reset) {
            const months = summarizeByMonth(transferData, (t) => t.date, (t) => t.amount);
            const ordered = orderMonths(months);
            const kept = ordered.filter((m) => openMonthsRef.current.has(m.month)).map((m) => m.month);
            setOpenMonths(new Set(kept.length > 0 ? kept : ordered.slice(0, 1).map((m) => m.month)));
          }
          setLoading(false);
          return;
        }

        const offset = reset ? 0 : expensesLenRef.current;
        const filters = filtersFromDraft(
          {
            sortBy,
            datePreset,
            customStart: customStartDate,
            customEnd: customEndDate,
            categoryIds: filterCategoryIds,
            creditKinds: filterCreditKinds,
            minAmount,
            maxAmount,
            accountIds: filterAccountIds,
            paymentModeIds: filterPaymentModeIds,
            status: filterStatus,
            tagIds: filterTagIds,
            merchantNames: filterMerchantNames,
            refundedStatus: filterRefundedStatus,
            avoidability: filterAvoidability,
            ruleIds: filterRuleIds,
          },
          filterNature,
          debouncedSearch,
        );
        lastFiltersRef.current = filters;

        if (drawerMode) {
          // Only a full reload gets here: drawers don't page.
          const gen = ++loadGen.current;
          const [summaryResult, prevTotal, months] = await Promise.all([
            getFilteredExpenseSummary(DEFAULT_USER_ID, filters, summaryGroupBy),
            getPreviousPeriodTotal(DEFAULT_USER_ID, filters),
            getFilteredGroupTotals(DEFAULT_USER_ID, filters, drawerBy as DrawerGroupBy),
          ]);
          if (gen !== loadGen.current) return;
          setSummary(summaryResult);
          setPreviousTotal(prevTotal);
          setMonthTotals(months);
          setTotalsBy(drawerBy);
          setTransfers([]);
          setHasMore(false);
          // Drawers that were open stay open; with none of them left, the first one opens.
          const ordered = orderDrawers(months, drawerBy, sortBy === "date_asc");
          const kept = ordered.filter((m) => openMonthsRef.current.has(m.month)).map((m) => m.month);
          const open = new Set(kept.length > 0 ? kept : ordered.slice(0, 1).map((m) => m.month));
          setOpenMonths(open);
          if (drawerSigRef.current === filterSignature) {
            // Same filters, newer data: open months keep showing their rows until the fresh ones
            // replace them, so coming back to the tab doesn't flash a spinner. Closed months reload
            // when they're opened.
            setLoadedMonths((prev) => new Set([...prev].filter((m) => open.has(m))));
          } else {
            setExpenses([]);
            setLoadedMonths(new Set());
          }
          drawerSigRef.current = filterSignature;
          setLoadFailed(false);
          await Promise.all([...open].map((m) => loadMonth(m, filters, gen)));
          return;
        }

        const [data, summaryResult, prevTotal] = await Promise.all([
          getExpensesPaginated(DEFAULT_USER_ID, filters, loadEverything ? ALL_ROWS : PAGE_SIZE, offset),
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
        setHasMore(!loadEverything && data.length === PAGE_SIZE);

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
        setLoadFailed(false);
      } catch {
        // Not "No expenses yet": the list is empty because it failed. Forget the stamp so a retry runs.
        lastVersionRef.current = null;
        setLoadFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [filterSignature, debouncedSearch, filterStartDate, filterEndDate, datePreset, customStartDate, customEndDate, filterCreditKinds, filterCategoryIds, filterPaymentModeIds, filterAccountIds, filterTagIds, filterMerchantNames, filterRefundedStatus, filterAvoidability, filterRuleIds, filterStatus, sortBy, filterNature, summaryGroupBy, loading, loadEverything, drawerMode, drawerBy, minAmount, maxAmount, loadMonth],
  );

  // Load reference data once (skipped if already seeded from preload)
  useEffect(() => {
    if (preloaded) return;
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
    }, [debouncedSearch, filterStartDate, filterEndDate, filterCategoryIds, filterPaymentModeIds, filterAccountIds, filterTagIds, filterMerchantNames, filterRefundedStatus, filterAvoidability, filterRuleIds, filterStatus, filterNature, summaryGroupBy, sortBy, loadEverything, drawerMode, drawerBy, minAmount, maxAmount]),
  );

  const handleDelete = useCallback(
    (expense: Expense) => {
      const desc = expense.description || expense.merchant_name || formatAmount(expense.amount);
      const isSplit = expense.split_hisaab_entry_id != null;
      alert(
        "Delete expense",
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
              const deletedMonth = expense.date?.slice(0, 7) ?? "";
              setMonthTotals((prev) => {
                const m = prev.get(deletedMonth);
                if (!m) return prev;
                const next = new Map(prev);
                next.set(deletedMonth, {
                  ...m,
                  count: Math.max(0, m.count - 1),
                  spent: expense.nature === "credit" ? m.spent : Math.max(0, m.spent - expense.amount),
                  received: expense.nature === "credit" ? Math.max(0, m.received - expense.amount) : m.received,
                });
                return next;
              });

              // The delete is soft, so it is recoverable - but until now the only way back was to
              // find the Recycle Bin in Settings. A split expense is excluded: restoring one has to
              // put the hisaab entry back too, which restoreExpense does not do.
              if (!isSplit) {
                toast(`Deleted "${desc}"`, {
                  actionLabel: "Undo",
                  onAction: async () => {
                    await restoreExpense(expense.id);
                    lastVersionRef.current = null;
                    await loadExpenses(true);
                  },
                });
              } else {
                toast(`Deleted "${desc}"`);
              }
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
    const tab = natureTabs[index];
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
      setFilterCreditKinds([]);
      setFilterPaymentModeIds([]);
      setFilterTagIds([]);
      setFilterMerchantNames([]);
    }
  }, [filterNature, summaryGroupBy, natureTabs]);

  const clearFilters = useCallback(() => {
    // Back to the defaults: the last 12 months, newest first, grouped as the dates group (by month).
    setGroupPinned(false);
    setSortBy("date_desc");
    settingsStorage.set(SORT_KEY, "date_desc");
    setTransferGroupBy("date");
    setDatePreset(DEFAULT_PRESET);
    setMinAmount("");
    setMaxAmount("");
    setCustomStartDate("");
    setCustomEndDate("");
    setSearch("");
    setFilterCategoryIds([]);
    setFilterCreditKinds([]);
    setFilterPaymentModeIds([]);
    setFilterAccountIds([]);
    setFilterTagIds([]);
    setFilterMerchantNames([]);
    setFilterRefundedStatus("");
    setFilterAvoidability("");
    setFilterRuleIds([]);
    setFilterStatus("");
    setFilterNature("all");
  }, []);

  const applyFilterView = useCallback((view: SavedFilterView) => {
    try {
      const f = view.filters;
      // Handle legacy views saved with old format (dateFilterMode instead of datePreset)
      const legacyMode = (f as any).dateFilterMode;
      const preset: DatePreset = f.datePreset ?? (legacyMode === "all" ? "all" : legacyMode === "custom" ? "custom" : "this_fy");
      setDatePreset(preset);
      if (f.customStartDate) setCustomStartDate(f.customStartDate);
      else setCustomStartDate("");
      if (f.customEndDate) setCustomEndDate(f.customEndDate);
      else setCustomEndDate("");
      setFilterNature(f.nature ?? "realized");
      setFilterCategoryIds(f.categoryIds ?? []);
      setFilterCreditKinds(f.creditKinds ?? []);
      setFilterPaymentModeIds(f.paymentModeIds ?? []);
      setFilterAccountIds(f.accountIds ?? []);
      setFilterTagIds(f.tagIds ?? []);
      setFilterMerchantNames(f.merchantNames ?? []);
      setFilterRefundedStatus(f.refundedStatus ?? "");
      setFilterAvoidability(f.avoidability ?? "");
      setFilterRuleIds(f.ruleIds ?? []);
      setFilterStatus(f.status ?? "");
      setMinAmount(f.minAmount != null ? String(f.minAmount) : "");
      setMaxAmount(f.maxAmount != null ? String(f.maxAmount) : "");
      if (f.sortBy) {
        setSortBy(f.sortBy as ExpenseSortBy);
        settingsStorage.set(SORT_KEY, f.sortBy);
      }
      if (f.groupBy) setGroupByPreference(`transactions_${f.nature ?? "realized"}`, f.groupBy);
      // A saved view's grouping is a choice, unless it's just what its dates give.
      setGroupPinned(!!f.groupBy && f.groupBy !== autoGroupFor(preset, f.customStartDate ?? "", f.customEndDate ?? ""));
      setSearch(f.search ?? "");
      setActiveViewId(view.id);
      setFilterSheet({ open: false });
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
    creditKinds: filterCreditKinds,
    paymentModeIds: filterPaymentModeIds,
    accountIds: filterAccountIds,
    tagIds: filterTagIds,
    merchantNames: filterMerchantNames,
    refundedStatus: filterRefundedStatus,
    avoidability: filterAvoidability,
    search,
    ruleIds: filterRuleIds,
    status: filterStatus,
    minAmount: minAmount.trim() && Number.isFinite(parseFloat(minAmount)) ? parseFloat(minAmount) : undefined,
    maxAmount: maxAmount.trim() && Number.isFinite(parseFloat(maxAmount)) ? parseFloat(maxAmount) : undefined,
    sortBy,
    groupBy: grouping.groupBy,
  }), [minAmount, maxAmount, filterRuleIds, filterStatus, sortBy, grouping.groupBy, datePreset, customStartDate, customEndDate, filterNature, filterCategoryIds, filterPaymentModeIds, filterAccountIds, filterTagIds, filterMerchantNames, filterRefundedStatus, filterAvoidability, search]);

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
    if (!text.trim()) { setSearch(text); return; }
    const { textSearch, datePreset: parsedPreset } = parseNLQuery(text);
    setSearch(textSearch);
    if (parsedPreset) setDatePreset(parsedPreset);
  }, [setDatePreset]);

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
    const { granted } = await SpeechRecognition.requestPermissionsAsync();
    if (!granted) {
      toast("Voice search needs the microphone. You can allow it in the phone's settings.");
      return;
    }
    setIsVoiceSearching(true);
    SpeechRecognition.start({ lang: "en-IN", interimResults: false, maxAlternatives: 1 });
  }, [toast]);

  const cancelVoiceSearch = useCallback(() => {
    SpeechRecognition.abort();
    setIsVoiceSearching(false);
  }, []);

  const hasNonDateFilters = !!search || filterCategoryIds.length > 0 || filterCreditKinds.length > 0 || filterPaymentModeIds.length > 0 || filterAccountIds.length > 0 || filterTagIds.length > 0 || filterMerchantNames.length > 0 || !!filterRefundedStatus || !!filterAvoidability || filterRuleIds.length > 0 || !!filterStatus || !!minAmount.trim() || !!maxAmount.trim();
  const activeNatureIndex = Math.max(0, natureTabs.findIndex((t) => t.key === filterNature));
  // The tab showing was just switched off, or a saved view points at one that is.
  useEffect(() => {
    if (!natureTabs.some((t) => t.key === filterNature)) setFilterNature("all");
  }, [natureTabs, filterNature]);
  const hasActiveFilters = hasNonDateFilters || datePreset !== DEFAULT_PRESET;

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

  const [bulkPickerType, setBulkPickerType] = useState<"category" | "creditType" | "paymentMode" | "account" | "merchant" | "date" | null>(null);

  // Opened already selecting, nothing may be chosen yet.
  const pickBulkField = (field: NonNullable<typeof bulkPickerType>) => {
    if (selectedExpenseIds.size === 0) {
      toast("Tap the transactions you want to change first");
      return;
    }
    setBulkPickerType(field);
  };

  const handleBulkApply = useCallback(async (field: string, value: string) => {
    const ids = [...selectedExpenseIds];
    if (field === "creditType") {
      const { skipped } = await bulkSetCreditKind(ids, value);
      if (skipped > 0) toast(`${skipped} kept as they are: only credits have a type, and settlements and linked refunds get theirs from the link`);
      exitBulkMode();
      setBulkPickerType(null);
      loadExpenses(true);
      return;
    }
    if (field === "category") {
      const { skipped } = await bulkSetCategory(ids, value);
      if (skipped > 0) toast(`${skipped} credit${skipped === 1 ? "" : "s"} kept their type instead`);
      exitBulkMode();
      setBulkPickerType(null);
      loadExpenses(true);
      return;
    }
    const fields: Record<string, string> = {};
    if (field === "paymentMode") fields.payment_mode_id = value;
    else if (field === "account") fields.account_id = value;
    else if (field === "merchant") fields.merchant_name = value;
    else if (field === "date") fields.date = value;
    await bulkUpdateExpenses(ids, fields);
    exitBulkMode();
    setBulkPickerType(null);
    loadExpenses(true);
  }, [selectedExpenseIds, exitBulkMode, loadExpenses, toast]);

  const shownTransfers = useMemo(
    () => transfers.filter((t) => matchesSearch(debouncedSearch, [t.description], [t.amount])),
    [transfers, debouncedSearch],
  );

  const transferRows = useMemo(() => {
    const nameOf = (id: string) => {
      const account = accountMap.get(id);
      return account ? account.account_label || `${account.bank_name} ****${account.account_identifier}` : "Unknown";
    };
    return groupRows(shownTransfers, {
      keyOf: (t) =>
        transferGroupBy === "date" ? t.date.slice(0, 10) : transferGroupBy === "month" ? t.date.slice(0, 7) : transferGroupBy === "from" ? t.from_account_id : t.to_account_id,
      labelOf: (key) => {
        if (key === NO_GROUP) return "Unknown";
        return transferGroupBy === "date" ? transactionDayLabel(key) : transferGroupBy === "month" ? formatMonthLabel(key, "long") : nameOf(key);
      },
      amountOf: (t) => t.amount,
      order: transferGroupBy === "date" || transferGroupBy === "month" ? "first" : "size",
    });
  }, [shownTransfers, transferGroupBy, accountMap]);
  // Other groupings of transfers are drawers too, as everywhere else.
  const transferDrawerList = useGroupDrawers(transferRows, {
    isHeading: (r) => r.type === "heading",
    keyOf: (r) => (r.type === "heading" ? r.key : ""),
    resetKey: transferGroupBy,
  });

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
          className="flex-row items-start px-4 py-3 border-b border-border"
        >
          <View className="w-10 h-10 rounded-control items-center justify-center mr-3" style={{ backgroundColor: moneyTone(theme, "moved").bg }}>
            <Ionicons name="swap-horizontal" size={20} color={moneyTone(theme, "moved").fg} />
          </View>
          <View className="flex-1 mr-3">
            <Text className="text-body font-semibold text-foreground" numberOfLines={1}>
              {item.description || "Transfer"}
            </Text>
            <Text className="text-meta text-muted-foreground mt-1" numberOfLines={1}>
              {accountName} → {toAccountName}
            </Text>
          </View>
          <View className="items-end">
            <Text className="text-body font-bold" style={{ color: moneyTone(theme, "moved").fg }}>
              {formatAmount(item.amount)}
            </Text>
            <Pressable
              onPress={() => {
                alert("Delete transfer", "Are you sure you want to delete this transfer?", [
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
              accessibilityRole="button"
              accessibilityLabel="Delete transfer"
            >
              <Ionicons name="trash-outline" size={16} color={theme.mutedForeground} />
            </Pressable>
          </View>
        </Pressable>
      );
    },
    [accountMap, theme, alert, loadExpenses, router],
  );

  // Group expenses by date for display. Each entry is either a date header
  // sentinel or an expense item. useMemo keeps it O(n) and only reruns when
  // the expenses array reference changes.
  type DateGroupRow =
    | { _type: "header"; date: string; label: string; total: number }
    | { _type: "item"; expense: Expense };

  const groupedExpenses = useMemo<DateGroupRow[]>(() => {
    if (expenses.length === 0) return [];
    if (grouping.groupBy !== "date") {
      return grouping.rows.map((row) =>
        row.type === "heading"
          ? { _type: "header", date: row.key, label: `${row.label} · ${row.count}`, total: row.total }
          : { _type: "item", expense: row.item },
      );
    }
    const rows: DateGroupRow[] = [];
    let lastDate = "";
    let currentHeader: Extract<DateGroupRow, { _type: "header" }> | null = null;
    for (const expense of expenses) {
      const expDate = expense.date?.slice(0, 10) ?? "";
      if (expDate !== lastDate) {
        currentHeader = { _type: "header", date: expDate, label: transactionDayLabel(expDate), total: 0 };
        rows.push(currentHeader);
        lastDate = expDate;
      }
      rows.push({ _type: "item", expense });

      // Signed by each row's OWN nature, not by the active tab, so the day total stays correct on
      // All where credits and debits are interleaved.
      if (currentHeader) {
        currentHeader.total += rowAmount(expense);
      }
    }
    return rows;
  }, [expenses, grouping.groupBy, grouping.rows, rowAmount]);

  // "+ Add category" on an untagged row: pick one in place, no trip to the detail page.
  const [categoryFor, setCategoryFor] = useState<Expense | null>(null);
  const pickCategoryInPlace = useCallback(
    async (categoryId: string) => {
      const target = categoryFor;
      setCategoryFor(null);
      if (!target) return;
      await bulkSetCategory([target.id], categoryId);
      const name = categoryMap.get(categoryId)?.name;
      toast(name ? `Added to ${name}` : "Category added");
      // A sub-category made in the picker isn't in the list yet.
      if (!name) getCategories(DEFAULT_USER_ID).then(setCategories).catch(() => {});
      loadExpenses(true);
    },
    [categoryFor, categoryMap, toast, loadExpenses],
  );
  // Under a day heading the row doesn't repeat the date.
  const hideRowDates =
    drawerMode &&
    (grouping.groupBy === "date" || ((grouping.groupBy === "month" || grouping.groupBy === "year") && (sortBy === "date_desc" || sortBy === "date_asc")));

  const renderExpenseItem = useCallback(
    ({ item }: { item: DateGroupRow }) => {
      if (item._type === "header") {
        return (
          // The day's net sits beside its date, so scanning down the list answers "what did that
          // day cost me" without adding the rows up by eye.
          <View className="px-4 pt-4 pb-1.5 flex-row items-baseline justify-between">
            <Text
              className="text-label font-semibold uppercase tracking-wider text-muted-foreground"
              style={{ letterSpacing: 0.6 }}
            >
              {item.label}
            </Text>
            {item.total !== 0 && (
              <Money
                value={item.total}
                signed
                showPlus
                className="text-label font-semibold"
              />
            )}
          </View>
        );
      }
      const expense = item.expense;
      return (
        <ExpenseListRow
          item={expense}
          categoryMap={categoryMap}
          paymentModeMap={paymentModeMap}
          accountMap={accountMap}
          refundedMap={refundedMap}
          onPress={handleItemPress}
          onLongPress={handleLongPress}
          selected={bulkMode && selectedExpenseIds.has(expense.id)}
          hideDate={hideRowDates}
          onAddCategory={bulkMode ? undefined : setCategoryFor}
        />
      );
    },
    [categoryMap, paymentModeMap, accountMap, refundedMap, handleItemPress, handleLongPress, bulkMode, selectedExpenseIds, hideRowDates],
  );

  // ── Month drawers ──
  const expensesByMonth = useMemo(() => {
    const map = new Map<string, Expense[]>();
    for (const e of expenses) {
      const m = drawerKeyOf(e, drawerBy, categoryMap);
      const list = map.get(m);
      if (list) list.push(e);
      else map.set(m, [e]);
    }
    return map;
  }, [expenses, drawerBy, categoryMap]);
  const dateSorted = sortBy === "date_desc" || sortBy === "date_asc";
  const drawerRows = useMemo<DrawerRow<Expense>[]>(
    () =>
      drawerMode && totalsBy === drawerBy
        ? buildDrawerRows<Expense>({
            months: orderDrawers(monthTotals, drawerBy, sortBy === "date_asc"),
            open: openMonths,
            rowsOf: (m) => (loadedMonths.has(m) ? expensesByMonth.get(m) ?? [] : undefined),
            dateOf: (e) => e.date ?? "",
            amountOf: rowAmount,
            // Month and year drawers get a heading per day when the list is in date order.
            dayHeadings: dateSorted && (drawerBy === "month" || drawerBy === "year"),
          })
        : [],
    [drawerMode, totalsBy, monthTotals, sortBy, openMonths, loadedMonths, expensesByMonth, rowAmount, dateSorted, drawerBy],
  );
  const transferDrawerMode = filterNature === "transfers" && (transferGroupBy === "date" || transferGroupBy === "month");
  const transferDrawerRows = useMemo<DrawerRow<AccountTransfer>[]>(() => {
    if (!transferDrawerMode) return [];
    const byMonth = new Map<string, AccountTransfer[]>();
    for (const t of shownTransfers) {
      const m = t.date.slice(0, 7);
      byMonth.set(m, [...(byMonth.get(m) ?? []), t]);
    }
    return buildDrawerRows<AccountTransfer>({
      months: orderMonths(summarizeByMonth(shownTransfers, (t) => t.date, (t) => t.amount)),
      open: openMonths,
      rowsOf: (m) => byMonth.get(m) ?? [],
      dateOf: (t) => t.date,
      amountOf: (t) => t.amount,
      dayHeadings: false,
    });
  }, [transferDrawerMode, shownTransfers, openMonths]);
  const drawerKind: DrawerMode = filterNature === "all" ? "all" : filterNature === "credit" ? "credit" : filterNature === "transfers" ? "transfer" : "spend";

  const renderDrawerRow = useCallback(
    <T,>(row: DrawerRow<T>, renderItem: (item: T) => React.ReactElement | null) => {
      switch (row.kind) {
        case "month":
          return filterNature === "transfers" || drawerBy === "month" ? (
            <MonthDrawerHeader summary={row.summary} open={row.open} mode={drawerKind} onToggle={() => toggleMonth(row.month)} />
          ) : (
            <GroupDrawerHeader
              summary={row.summary}
              title={labelOf(row.month, drawerBy, { categoryMap, accountMap, paymentModeMap })}
              open={row.open}
              mode={drawerKind}
              onToggle={() => toggleMonth(row.month)}
            />
          );
        case "day":
          return (
            <DrawerBody>
              <View className="px-4 pt-3 pb-1.5 flex-row items-baseline justify-between border-t border-border">
                <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground" style={{ letterSpacing: 0.6 }}>
                  {transactionDayLabel(row.date)}
                </Text>
                {row.total !== 0 && <Money value={row.total} signed showPlus className="text-label font-semibold" />}
              </View>
            </DrawerBody>
          );
        case "item":
          return <DrawerBody>{renderItem(row.item)}</DrawerBody>;
        case "loading":
          return <DrawerLoading />;
        case "empty":
          return <DrawerEmpty />;
        case "end":
          return <DrawerEnd />;
      }
    },
    [drawerKind, toggleMonth, filterNature, drawerBy, categoryMap, accountMap, paymentModeMap],
  );

  const chooseSort = (v: ExpenseSortBy) => {
    setSortBy(v);
    settingsStorage.set(SORT_KEY, v);
  };

  // What's on, each with its own ×. A name that's gone (a deleted category) just isn't listed.
  const toolbarChips: ToolbarChip[] = [
    ...filterCreditKinds.map((k) => ({ key: `kind-${k}`, label: creditLook(k).name, onRemove: () => setFilterCreditKinds((p) => p.filter((x) => x !== k)) })),
    ...filterCategoryIds.flatMap((id) => {
      const label = id === NOT_SET ? NOT_SET_LABELS.category : categoryMap.get(id)?.name;
      return label ? [{ key: `cat-${id}`, label, onRemove: () => setFilterCategoryIds((p) => p.filter((x) => x !== id)) }] : [];
    }),
    ...filterPaymentModeIds.flatMap((id) => {
      const label = id === NOT_SET ? NOT_SET_LABELS.paymentMode : paymentModeMap.get(id)?.name;
      return label ? [{ key: `pm-${id}`, label, onRemove: () => setFilterPaymentModeIds((p) => p.filter((x) => x !== id)) }] : [];
    }),
    ...filterAccountIds.flatMap((id) => {
      const label = id === NOT_SET ? NOT_SET_LABELS.account : accountMap.get(id)?.bank_name;
      return label ? [{ key: `acct-${id}`, label, onRemove: () => setFilterAccountIds((p) => p.filter((x) => x !== id)) }] : [];
    }),
    ...filterTagIds.flatMap((id) => {
      const label = id === NOT_SET ? NOT_SET_LABELS.tags : allTags.find((t) => t.id === id)?.name;
      return label ? [{ key: `tag-${id}`, label, onRemove: () => setFilterTagIds((p) => p.filter((x) => x !== id)) }] : [];
    }),
    ...filterMerchantNames.map((name) => ({
      key: `merchant-${name}`,
      label: name === NOT_SET ? NOT_SET_LABELS.merchant : name,
      onRemove: () => setFilterMerchantNames((p) => p.filter((x) => x !== name)),
    })),
    ...filterRuleIds.flatMap((id) => {
      const rule = allRules.find((r) => r.id === id);
      return rule ? [{ key: `rule-${id}`, label: `Rule: ${rule.name}`, onRemove: () => setFilterRuleIds((p) => p.filter((x) => x !== id)) }] : [];
    }),
    ...(filterRefundedStatus ? [{ key: "refund", label: filterRefundedStatus === "refunded" ? "Refunded" : "Not refunded", onRemove: () => setFilterRefundedStatus("") }] : []),
    ...(filterStatus ? [{ key: "status", label: filterStatus === "pending_review" ? "Pending Review" : "Approved", onRemove: () => setFilterStatus("") }] : []),
    ...(minAmount.trim() || maxAmount.trim()
      ? [{
          key: "amount",
          label: minAmount.trim() && maxAmount.trim()
            ? `₹${minAmount}–${maxAmount}`
            : minAmount.trim() ? `Over ₹${minAmount}` : `Under ₹${maxAmount}`,
          onRemove: () => { setMinAmount(""); setMaxAmount(""); },
        }]
      : []),
    // Only a grouping the owner picked is a chip: the one the dates give isn't "on", so Clear all
    // (and this chip's ✕) hand the grouping back to the dates.
    ...((filterNature === "transfers" ? transferGroupBy !== "date" : groupPinned)
      ? [{
          key: "group",
          label: `Grouped: ${(filterNature === "transfers" ? TRANSFER_GROUP_OPTIONS : grouping.options).find((o) => o.value === (filterNature === "transfers" ? transferGroupBy : grouping.groupBy))?.label ?? ""}`,
          onRemove: () => (filterNature === "transfers" ? setTransferGroupBy("date") : setGroupPinned(false)),
        }]
      : []),
    ...(filterAvoidability
      ? [{ key: "avoid", label: filterAvoidability === "avoidable" ? "Discretionary" : filterAvoidability === "unavoidable" ? "Unavoidable" : "Not classified", onRemove: () => setFilterAvoidability("") }]
      : []),
  ];

  const currentDraft: TxFilterDraft = {
    sortBy,
    groupBy: filterNature === "transfers" ? transferGroupBy : grouping.groupBy,
    datePreset,
    customStart: customStartDate,
    customEnd: customEndDate,
    categoryIds: filterCategoryIds,
    creditKinds: filterCreditKinds,
    minAmount,
    maxAmount,
    accountIds: filterAccountIds,
    paymentModeIds: filterPaymentModeIds,
    status: filterStatus,
    tagIds: filterTagIds,
    merchantNames: filterMerchantNames,
    refundedStatus: filterRefundedStatus,
    avoidability: filterAvoidability,
    ruleIds: filterRuleIds,
  };
  const appliedCount = draftTotal(currentDraft, DEFAULT_PRESET, filterNature === "transfers");

  // The filter sheet's "Show 24 transactions": same query as the list, counted.
  const countForDraft = useCallback(
    async (d: TxFilterDraft): Promise<number | null> => {
      if (filterNature === "transfers") {
        const { start, end } = resolveDatePreset(d.datePreset, d.customStart, d.customEnd);
        return (await getTransfersForUser(DEFAULT_USER_ID, start || "", end || "")).length;
      }
      return countFilteredExpenses(DEFAULT_USER_ID, filtersFromDraft(d, filterNature, debouncedSearch));
    },
    [filterNature, debouncedSearch],
  );

  const applyDraft = (d: TxFilterDraft) => {
    if (d.sortBy !== sortBy) chooseSort(d.sortBy as ExpenseSortBy);
    if (filterNature === "transfers") setTransferGroupBy(d.groupBy as TransferGroupBy);
    else {
      // A grouping other than the one these dates give is the owner's choice: keep it.
      setGroupPinned(d.groupBy !== defaultGroupFor(d));
      if (d.groupBy !== grouping.groupBy) grouping.setGroupBy(d.groupBy as ExpenseGroupBy);
    }
    setDatePreset(d.datePreset);
    setCustomStartDate(d.customStart);
    setCustomEndDate(d.customEnd);
    setFilterCategoryIds(d.categoryIds);
    setFilterCreditKinds(d.creditKinds);
    setMinAmount(d.minAmount);
    setMaxAmount(d.maxAmount);
    setFilterAccountIds(d.accountIds);
    setFilterPaymentModeIds(d.paymentModeIds);
    setFilterStatus(d.status);
    setFilterTagIds(d.tagIds);
    setFilterMerchantNames(d.merchantNames);
    setFilterRefundedStatus(d.refundedStatus);
    setFilterAvoidability(d.avoidability);
    setFilterRuleIds(d.ruleIds);
    setActiveViewId(null);
  };

  // "Dec 2025 – Nov 2026" for whole months, the days otherwise.
  const rangeLabel = (() => {
    if (!filterStartDate && !filterEndDate) return "Everything";
    if (!filterStartDate || !filterEndDate) return filterStartDate ? `From ${formatDateForDisplay(filterStartDate)}` : `Until ${formatDateForDisplay(filterEndDate!)}`;
    const sm = filterStartDate.slice(0, 7);
    const em = filterEndDate.slice(0, 7);
    if (filterStartDate.endsWith("-01") && sm !== em) return `${formatMonthLabel(sm)} – ${formatMonthLabel(em)}`;
    if (filterStartDate === filterEndDate) return formatDateForDisplay(filterStartDate);
    return `${formatDateForDisplay(filterStartDate)} – ${formatDateForDisplay(filterEndDate)}`;
  })();

  const summaryHeader = (
<>
                    {summary && summary.count > 0 ? (
                      <FilterSummaryCard
                        summary={summary}
                        groupLabelHeader={
                          summaryGroupBy === "category"
                            ? "Category"
                            : summaryGroupBy === "type"
                              ? "Type"
                            : summaryGroupBy === "account"
                              ? "Account"
                              : summaryGroupBy === "merchant"
                                ? "Merchant"
                                : "Payment Mode"
                        }
                        resolveGroupLabel={(key) => {
                          if (summaryGroupBy === "type") return creditLook(key).name;
                          if (!key) return summaryGroupBy === "merchant" ? "No merchant" : "Uncategorized";
                          if (summaryGroupBy === "category") {
                            const hidden = hiddenCategoryNames.get(key);
                            return categoryMap.get(key)?.name ?? (hidden ? `${hidden} (hidden)` : "Unknown");
                          }
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
                        natureKind={filterNature === "credit" ? "credit" : filterNature === "all" ? "all" : ("realized" as const)}
                        availableGroupBys={
                          filterNature === "credit"
                            ? (["type", "account", "merchant"] as const)
                            : (["category", "account", "payment_mode", "merchant"] as const)
                        }
                        groupByLabels={{ type: "Type" }}
                      />
                    ) : null}
                    </>
  );
  const expenseEmpty = loadFailed ? <LoadFailed onRetry={() => loadExpenses(true)} /> : loading ? <SkeletonList rows={7} /> : (() => {
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
                    })();

  const drawerKey = <T,>(row: DrawerRow<T>, idOf: (t: T) => string) =>
    row.kind === "item" ? idOf(row.item) : row.kind === "day" ? `day-${row.date}` : `${row.kind}-${row.month}`;

  const rangeRow = (
    <View className="flex-row items-center justify-between px-4 pt-3 pb-1" style={{ gap: 8 }}>
      <Pressable
        onPress={() => setFilterSheet({ open: true, field: "date" })}
        className="flex-row items-center rounded-full border border-border bg-card px-3"
        style={{ height: 34, gap: 6 }}
        accessibilityRole="button"
        accessibilityLabel={`Dates: ${DATE_PRESET_LABELS[datePreset]}. Change`}
      >
        <Ionicons name="calendar-outline" size={15} color={theme.foreground} />
        <Text className="text-meta font-semibold text-foreground">{DATE_PRESET_LABELS[datePreset]}</Text>
        <Ionicons name="chevron-down" size={14} color={theme.foreground} />
      </Pressable>
      <Text className="text-meta text-muted-foreground flex-shrink" numberOfLines={1}>{rangeLabel}</Text>
    </View>
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
      />
      <ListToolbar<ExpenseSortBy, string>
        search={{
          value: search,
          onChangeText: handleSearchChange,
          onClear: () => setSearch(""),
          placeholder: "Search or try >5000",
          input: {
            onSubmitEditing: applyNLSearch,
            returnKeyType: "go",
            blurOnSubmit: false,
            accessibilityLabel: "Search expenses",
          },
          accessory: isVoiceSearching ? (
            <Pressable onPress={cancelVoiceSearch} accessibilityLabel="Cancel voice search" accessibilityRole="button" className="ml-2 p-1">
              <Ionicons name="radio-button-on" size={18} color={theme.danger} />
            </Pressable>
          ) : search.trim() !== "" ? (
            // Reads plain English ('food last month') once it's typed; voice applies by itself.
            <Pressable
              onPress={applyNLSearch}
              accessibilityLabel="Apply smart search"
              accessibilityRole="button"
              className="ml-2 px-2.5 py-1 rounded-pill"
              style={{ backgroundColor: theme.primary }}
            >
              <Text className="text-label font-semibold text-primary-foreground">Apply</Text>
            </Pressable>
          ) : isSpeechRecognitionAvailable ? (
            <Pressable onPress={startVoiceSearch} accessibilityLabel="Voice search" accessibilityRole="button" className="ml-2 p-1">
              <Ionicons name="mic-outline" size={18} color={theme.mutedForeground} />
            </Pressable>
          ) : null,
        }}
        filter={{ onPress: () => setFilterSheet({ open: true }), activeCount: appliedCount - (filterNature !== "transfers" && sortBy !== "date_desc" ? 1 : 0), showCount: true }}
        sort={filterNature === "transfers" ? undefined : {
          value: sortBy,
          defaultValue: "date_desc",
          options: EXPENSE_SORT_OPTIONS,
          onChange: chooseSort,
          // Sort and group are the first sections of the filter sheet.
          inSheet: true,
        }}
        chips={toolbarChips}
        onClearAll={() => {
          // Stays on the tab it's on: clearing what's narrowing the list isn't leaving it.
          const tab = filterNature;
          clearFilters();
          setFilterNature(tab);
          setActiveViewId(null);
        }}
        action={hasActiveFilters ? { label: "Save view", onPress: handleSaveView } : undefined}
      />

      {/* Save view inline input */}
      {showSaveViewInput && (
        <View className="px-4 pb-2 flex-row items-center">
          <TextInput
            value={saveViewName}
            onChangeText={setSaveViewName}
            placeholder="View name..."
            placeholderTextColor={theme.mutedForeground}
            autoFocus
            maxLength={30}
            onSubmitEditing={confirmSaveView}
            returnKeyType="done"
            className="flex-1 text-body text-foreground bg-card border border-border rounded-control px-3 py-2.5 mr-2"
          />
          <Pressable onPress={confirmSaveView} className="px-4 py-2.5 rounded-pill" style={{ backgroundColor: theme.primary }} accessibilityRole="button">
            <Text className="text-meta font-semibold text-primary-foreground">Save</Text>
          </Pressable>
          <Pressable onPress={() => setShowSaveViewInput(false)} className="ml-2" hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel saving view">
            <Ionicons name="close" size={18} color={theme.mutedForeground} />
          </Pressable>
        </View>
      )}

      <CategoryPickerSheet
        visible={categoryFor != null}
        categories={categories}
        selectedId={null}
        onSelect={pickCategoryInPlace}
        onClose={() => setCategoryFor(null)}
        merchantName={categoryFor?.merchant_name}
        allowCreate
      />

      <TransactionFilterSheet
        visible={filterSheet.open}
        initialField={filterSheet.field}
        onClose={() => setFilterSheet({ open: false })}
        onApply={applyDraft}
        value={currentDraft}
        nature={filterNature}
        defaultPreset={DEFAULT_PRESET}
        sortOptions={EXPENSE_SORT_OPTIONS}
        groupOptions={filterNature === "transfers" ? TRANSFER_GROUP_OPTIONS : grouping.options}
        categories={[{ id: NOT_SET, label: NOT_SET_LABELS.category }, ...categories.map((c) => ({ id: c.id, label: c.name, color: c.color }))]}
        creditKinds={CREDIT_KINDS.map((k) => ({ id: k as string, label: CREDIT_KIND_LABELS[k] }))}
        accounts={[
          ...accounts.map((a) => ({
            id: a.id,
            label: a.account_label || a.bank_name,
            sub: a.account_identifier ? `•• ${a.account_identifier.slice(-4)}` : undefined,
          })),
          { id: NOT_SET, label: NOT_SET_LABELS.account },
        ]}
        paymentModes={[...paymentModes.map((p) => ({ id: p.id, label: p.name })), { id: NOT_SET, label: NOT_SET_LABELS.paymentMode }]}
        tags={[...allTags.map((t) => ({ id: t.id, label: t.name, color: t.color })), { id: NOT_SET, label: NOT_SET_LABELS.tags }]}
        merchants={[{ id: NOT_SET, label: NOT_SET_LABELS.merchant }, ...allMerchantNames.map((m) => ({ id: m, label: m }))]}
        rules={allRules.map((r) => ({ id: r.id, label: r.name }))}
        savedViews={savedViews}
        activeViewId={activeViewId}
        defaultViewId={getDefaultFilterViewId()}
        onApplyView={applyFilterView}
        onDeleteView={(v) => handleDeleteView(v.id, v.name)}
        onToggleDefaultView={(v) => handleSetDefault(v.id)}
        countFor={countForDraft}
      />

      {/* Nature tabs + transaction list */}
      <SwipePager
        pages={natureTabs}
        activeIndex={activeNatureIndex}
        onIndexChange={handleNatureChange}
      >
        {natureTabs.map((page, pageIdx) => (
          <View key={page.key} style={{ flex: 1 }}>
            {activeNatureIndex === pageIdx ? (
              <View style={{ flex: 1 }}>
              {rangeRow}
              {filterNature === "transfers" ? (
                transferDrawerMode ? (
                  <FlatList
                    style={{ flex: 1 }}
                    data={transferDrawerRows}
                    keyExtractor={(row) => drawerKey(row, (t) => t.id)}
                    renderItem={({ item: row }) => renderDrawerRow(row, (t) => renderTransferItem({ item: t }))}
                    contentContainerStyle={{ paddingBottom: 96 }}
                    refreshing={loading && transfers.length === 0}
                    onRefresh={() => loadExpenses(true)}
                    ListEmptyComponent={
                      loading ? (
                        <SkeletonList rows={5} />
                      ) : (
                        <EmptyState icon="swap-horizontal-outline" title="No transfers yet" subtitle="Transfers between accounts will appear here" />
                      )
                    }
                  />
                ) : (
                <FlatList
                  style={{ flex: 1 }}
                  initialNumToRender={12}
                  maxToRenderPerBatch={10}
                  windowSize={7}
                  data={transferDrawerList}
                  keyExtractor={(row) => (row.type === "heading" ? `heading-${row.key}` : row.item.id)}
                  renderItem={({ item: row }) =>
                    row.type === "heading" ? (
                      <GroupHeading label={row.label} count={row.count} total={row.total} signed={false} open={row.open} onToggle={row.onToggle} noun={{ one: "transfer", many: "transfers" }} />
                    ) : (
                      <DrawerCell row={row}>{renderTransferItem({ item: row.item })}</DrawerCell>
                    )
                  }
                  contentContainerStyle={{ paddingBottom: 80 }}
                  refreshing={loading && transfers.length === 0}
                  onRefresh={() => loadExpenses(true)}
                  ListHeaderComponent={
                    transfers.length > 0 ? (
                      <>
                      <View className="mx-4 my-2 p-4 rounded-card bg-card">
                        <View className="flex-row items-center justify-between">
                          <Text className="text-meta font-medium text-muted-foreground">
                            Total transfers
                          </Text>
                          <Text className="text-heading font-bold" style={{ color: TRANSFER_COLOR }}>
                            {formatAmount(transfers.reduce((sum, t) => sum + t.amount, 0))}
                          </Text>
                        </View>
                        <Text className="text-meta text-muted-foreground mt-0.5">
                          {transfers.length} {transfers.length === 1 ? "transfer" : "transfers"}
                        </Text>
                      </View>
                      </>
                    ) : null
                  }
                  ListEmptyComponent={
                    loading ? (
                      <SkeletonList rows={5} />
                    ) : (
                      <EmptyState
                        icon="swap-horizontal-outline"
                        title="No transfers yet"
                        subtitle="Transfers between accounts will appear here"
                      />
                    )
                  }
                />
                )
              ) : drawerMode ? (
                <Animated.FlatList
                  style={{ flex: 1 }}
                  itemLayoutAnimation={listLayout()}
                  initialNumToRender={16}
                  maxToRenderPerBatch={12}
                  windowSize={9}
                  data={drawerRows}
                  keyExtractor={(row) => drawerKey(row, (e) => e.id)}
                  renderItem={({ item: row }) =>
                    renderDrawerRow(row, (e) => renderExpenseItem({ item: { _type: "item", expense: e } }))
                  }
                  contentContainerStyle={{ paddingBottom: 96 }}
                  refreshing={loading && drawerRows.length === 0}
                  onRefresh={() => loadExpenses(true)}
                  ListHeaderComponent={summaryHeader}
                  ListEmptyComponent={expenseEmpty}
                />
              ) : (
                <Animated.FlatList
                  style={{ flex: 1 }}
                  // Rows slide up to close the gap when one is approved, deleted or moved.
                  itemLayoutAnimation={listLayout()}
                  initialNumToRender={12}
                  maxToRenderPerBatch={10}
                  windowSize={7}
                  data={groupedExpenses}
                  keyExtractor={(item, index) => item._type === "header" ? `header-${item.date}-${index}` : item.expense.id}
                  renderItem={renderExpenseItem}
                  onEndReached={handleLoadMore}
                  onEndReachedThreshold={0.3}
                  contentContainerStyle={{ paddingBottom: 80 }}
                  refreshing={loading && expenses.length === 0}
                  onRefresh={() => loadExpenses(true)}
                  ListHeaderComponent={summaryHeader}
                  ListEmptyComponent={expenseEmpty}
                  ListFooterComponent={
                    loadEverything && expenses.length >= ALL_ROWS ? <ListCapNote limit={ALL_ROWS} /> :
                    // Only while paginating: the empty state already covers the first load.
                    loading && expenses.length > 0 ? (
                      <View className="px-4 py-2">
                        <SkeletonList rows={2} />
                      </View>
                    ) : null
                  }
                />
              )}
              </View>
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
            label: "Add credit",
            color: theme.success,
            onPress: () => router.push({ pathname: "/expense/add", params: { type: "credit" } }),
          },
          {
            icon: "image-outline",
            label: "From a Picture",
            color: theme.primary,
            onPress: () => router.push("/expense/from-screenshot"),
          },
          // iPhone can't read SMS: a copied bank message is read here instead.
          ...(Platform.OS === "ios"
            ? [
                {
                  icon: "clipboard-outline" as const,
                  label: "Paste Bank Message",
                  color: theme.primary,
                  onPress: () => router.push("/expense/paste-message"),
                },
              ]
            : []),
          {
            icon: "swap-horizontal",
            label: "Add transfer",
            color: TRANSFER_COLOR,
            // The same form as Add Expense and Add credit, on Transfer.
            onPress: () => router.push({ pathname: "/expense/add", params: { type: "transfer" } }),
          },
        ] satisfies FABMenuItem[]}
      />
      {/* Bulk action bar */}
      {bulkMode && (
        <BulkActionBar
          selectedCount={selectedExpenseIds.size}
          onChangeCategory={filterNature === "credit" ? undefined : () => pickBulkField("category")}
          onChangeType={filterNature === "credit" || filterNature === "all" ? () => pickBulkField("creditType") : undefined}
          onChangePaymentMode={() => pickBulkField("paymentMode")}
          onChangeAccount={() => pickBulkField("account")}
          onChangeMerchant={() => pickBulkField("merchant")}
          onChangeDate={() => pickBulkField("date")}
          onCancel={exitBulkMode}
        />
      )}

      {/* Bulk picker modals */}
      <SelectSheet<CreditKind>
        visible={bulkPickerType === "creditType"}
        title="Set type"
        value={null}
        options={PICKABLE_CREDIT_KINDS.map((k) => ({
          value: k,
          label: CREDIT_KIND_LABELS[k],
          icon: CREDIT_KIND_LOOKS[k].icon as keyof typeof Ionicons.glyphMap,
        }))}
        onChange={(k) => { void handleBulkApply("creditType", k); }}
        onClose={() => setBulkPickerType(null)}
      />
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
          <View className="rounded-t-sheet px-4 pt-4 pb-8" style={{ backgroundColor: theme.card }}>
            <Text className="text-heading font-bold text-foreground mb-3">Set date</Text>
            <DateInput
              label=""
              value=""
              onChange={(date) => { if (date) handleBulkApply("date", date); }}
              maximumDate={null}
            />
            <Pressable onPress={() => setBulkPickerType(null)} className="mt-3 py-2" accessibilityRole="button">
              <Text className="text-body font-semibold text-center" style={{ color: theme.primary }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}

    </ScreenContainer>
  );
}
