import { AccountPickerSheet } from "@/components/expense/AccountPickerSheet";
import { DuplicateGroupCard } from "@/components/expense/DuplicateGroupCard";
import { ExpenseListItem } from "@/components/expense/ExpenseListItem";
import { ForecastMatchCard } from "@/components/expense/ForecastMatchCard";
import { LearnMoreChip, LoadingState, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";

import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useSmsScan } from "@/hooks/use-sms-scan";
import type { Category } from "@/services/category";
import { getCategories } from "@/services/category";
import type { DuplicateGroup } from "@/services/duplicate-detection";
import { dismissDuplicateGroup, scanAllDuplicatesCached } from "@/services/duplicate-detection";
import type { Expense, ForecastMatchPair } from "@/services/expense";
import {
    approveCcRepaymentCredit,
    approveExpense,
    approveExpenses,
    bulkAssignCategory,
    dismissOverdueForecasts,
    getMatchedForecastPairs,
    getPendingExpensesForReview,
    getUncategorizedExpenses,
    rejectExpense,
    rejectExpenses,
    resolveMatchAlreadyCaptured,
    resolveMatchBothDifferent,
    resolveMatchRealize,
} from "@/services/expense";
import type { FinancialAccount } from "@/services/financial-account";
import { getActiveAccounts } from "@/services/financial-account";
import type { PaymentMode } from "@/services/payment-mode";
import { getPaymentModes } from "@/services/payment-mode";

import { formatError } from "@/utils/error-message";
import { formatAmount } from "@/utils/expense-validation";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";

type SectionFilter = "all" | "auto" | "matched" | "overdue" | "upcoming" | "duplicates" | "uncategorized";

const FILTER_OPTIONS: { key: SectionFilter; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "all", label: "All", icon: "layers-outline" },
  { key: "auto", label: "Auto-Detected", icon: "swap-horizontal-outline" },
  { key: "matched", label: "Matches", icon: "git-compare-outline" },
  { key: "overdue", label: "Overdue", icon: "alert-circle-outline" },
  { key: "upcoming", label: "Upcoming", icon: "time-outline" },
  { key: "duplicates", label: "Duplicates", icon: "copy-outline" },
  { key: "uncategorized", label: "Uncategorized", icon: "help-circle-outline" },
];

/**
 * The unified review queue: pending SMS detections, duplicates, uncategorised and overdue dues.
 *
 * The single implementation, rendered by the Home swipe-pager and by app/expense/review-queue.tsx.
 *
 * This body came from the ROUTE, which had become the superset: it reads a `filter` URL param to
 * open straight into a section, offers "Scan now" through useSmsScan, and guards its first load.
 * The pager copy had none of that.
 *
 * Top padding is deliberately NOT applied here. The route sits in a headerless stack and supplies
 * a ScreenContainer that pads for the status bar; the pager sits under Home's own header and must
 * not pad again.
 *
 * `showHeader` is the same story for chrome. The route's stack is headerless, so the route
 * version drew its own bar with back / home / rescan; the pager version never had one because
 * Home already supplies a header. Unifying the two kept the route's bar, which then showed up
 * inside Home as a second header with a back button that had nowhere to go. It belongs to the
 * route only.
 */
export function ReviewQueuePage({ showHeader = false }: { showHeader?: boolean } = {}) {
  const alert = useAlert();
  const router = useRouter();
  const { colors, colorScheme } = useColorScheme();
  const theme = useTheme();
  const { filter: initialFilter } = useLocalSearchParams<{ filter?: string }>();

  const [activeFilter, setActiveFilter] = useState<SectionFilter>(
    (initialFilter as SectionFilter) || "all",
  );
  const { scanning, scanNow } = useSmsScan();

  // Core review data
  const [items, setItems] = useState<Expense[]>([]);
  const [matchedPairs, setMatchedPairs] = useState<ForecastMatchPair[]>([]);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [uncategorizedItems, setUncategorizedItems] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Uncategorized selection + category picker
  const [selectedUncat, setSelectedUncat] = useState<Set<string>>(new Set());
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  // Collapsible sections (for "all" view)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const toggleSection = useCallback((key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // CC repayment credit — when user taps Approve on a credit linked to a
  // repayment forecast, show an account picker to select the source.
  const [ccRepaymentPickerFor, setCcRepaymentPickerFor] = useState<string | null>(null);

  // Load reference data once
  useEffect(() => {
    (async () => {
      try {
        const [cats, pms, accts] = await Promise.all([
          getCategories(DEFAULT_USER_ID),
          getPaymentModes(DEFAULT_USER_ID),
          getActiveAccounts(DEFAULT_USER_ID),
        ]);
        setCategories(cats);
        setPaymentModes(pms);
        setAccounts(accts);
      } catch {
        // DB not ready
      }
    })();
  }, []);

  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const paymentModeMap = new Map(paymentModes.map((p) => [p.id, p]));
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const [pending, pairs, dupScan, uncat] = await Promise.all([
        getPendingExpensesForReview(DEFAULT_USER_ID),
        getMatchedForecastPairs(DEFAULT_USER_ID),
        scanAllDuplicatesCached(DEFAULT_USER_ID),
        getUncategorizedExpenses(DEFAULT_USER_ID),
      ]);
      // Exclude matched realized expenses from the regular list
      const matchedRealizedIds = new Set(pairs.map((p) => p.realized.id));
      setItems(pending.filter((i) => !matchedRealizedIds.has(i.id)));
      setMatchedPairs(pairs);
      setDuplicateGroups(dupScan.groups);
      setUncategorizedItems(uncat);
    } catch {
      // DB not ready
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadItems();
      setSelectedUncat(new Set());
      setShowCategoryPicker(false);
    }, [loadItems]),
  );

  // Derived lists
  const today = new Date().toISOString().split("T")[0];
  const overdueForecasts = items.filter(
    (i) => i.nature === "forecast" && i.due_date != null && i.due_date < today,
  );
  // Matches Home's Upcoming Dues: forecasts with a due_date today or later.
  // Forecasts with no due_date are treated as "auto-detected" items rather
  // than upcoming, so counts stay consistent across screens.
  const activeForecasts = items.filter(
    (i) => i.nature === "forecast" && i.due_date != null && i.due_date >= today,
  );
  // "realized" section now includes credits (nature='credit') — both are
  // auto-detected transactions awaiting review. The ReviewQueueItem renders
  // credits with a green amount + "Credit received" badge.
  const realized = items.filter((i) => i.nature === "realized" || i.nature === "credit");

  // Counts per section (for filter chips)
  const counts: Record<SectionFilter, number> = {
    all: realized.length + matchedPairs.length + overdueForecasts.length + activeForecasts.length + duplicateGroups.length + uncategorizedItems.length,
    auto: realized.length,
    matched: matchedPairs.length,
    overdue: overdueForecasts.length,
    upcoming: activeForecasts.length,
    duplicates: duplicateGroups.length,
    uncategorized: uncategorizedItems.length,
  };

  // ── Handlers ──

  const handleApprove = useCallback(async (id: string) => {
    // Intercept CC-repayment credits: route through source-account picker so
    // the Pay flow (savings → CC transfer) runs instead of a plain approval.
    const item = items.find((i) => i.id === id);
    if (item && item.nature === "credit" && item.matched_forecast_id) {
      setCcRepaymentPickerFor(id);
      return;
    }
    try {
      await approveExpense(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (e) {
      logger.error("Approve expense failed:", e);
      alert("Error", formatError("Approve", e));
    }
  }, [items]);

  const handleCcRepaymentSourceSelected = useCallback(
    async (fromAccountId: string) => {
      const creditId = ccRepaymentPickerFor;
      setCcRepaymentPickerFor(null);
      if (!creditId) return;
      try {
        await approveCcRepaymentCredit(creditId, fromAccountId);
        setItems((prev) => prev.filter((i) => i.id !== creditId));
      } catch (e) {
        logger.error("Approve CC repayment failed:", e);
        alert("Error", formatError("Approve repayment", e));
      }
    },
    [ccRepaymentPickerFor],
  );

  const handleReject = useCallback(async (id: string) => {
    alert(
      "Reject Expense",
      "This expense will be rejected and won't count in your budget. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reject",
          style: "destructive",
          onPress: async () => {
            try {
              await rejectExpense(id);
              setItems((prev) => prev.filter((item) => item.id !== id));
            } catch (e) {
              logger.error("Reject expense failed:", e);
              alert("Error", formatError("Reject", e));
            }
          },
        },
      ],
    );
  }, []);

  const handleTap = useCallback((id: string) => {
    router.push(`/expense/${id}`);
  }, [router]);

  // Matched pair handlers
  const handleMatchRealize = useCallback(async (forecastId: string, realizedId: string) => {
    try {
      const pair = matchedPairs.find(
        (p) => p.forecast.id === forecastId && p.realized.id === realizedId,
      );
      await resolveMatchRealize(forecastId, realizedId, pair?.realized.date ?? new Date().toISOString().split("T")[0]);
      setMatchedPairs((prev) =>
        prev.filter((p) => !(p.forecast.id === forecastId && p.realized.id === realizedId)),
      );
    } catch (e) {
      logger.error("Resolve matched pair (realize) failed:", e);
      alert("Error", formatError("Resolve match", e));
    }
  }, [matchedPairs]);

  const handleMatchAlreadyCaptured = useCallback(async (forecastId: string, realizedId: string) => {
    try {
      await resolveMatchAlreadyCaptured(forecastId, realizedId);
      setMatchedPairs((prev) =>
        prev.filter((p) => !(p.forecast.id === forecastId && p.realized.id === realizedId)),
      );
    } catch (e) {
      logger.error("Resolve matched pair (already captured) failed:", e);
      alert("Error", formatError("Resolve match", e));
    }
  }, []);

  const handleMatchBothDifferent = useCallback(async (forecastId: string, realizedId: string) => {
    try {
      await resolveMatchBothDifferent(forecastId, realizedId);
      setMatchedPairs((prev) =>
        prev.filter((p) => !(p.forecast.id === forecastId && p.realized.id === realizedId)),
      );
    } catch (e) {
      logger.error("Resolve matched pair (both different) failed:", e);
      alert("Error", formatError("Resolve match", e));
    }
  }, []);

  const handleApproveAutoDetected = useCallback(async () => {
    if (realized.length === 0) return;
    alert(
      "Approve Auto-Detected",
      `Approve all ${realized.length} auto-detected expense${realized.length > 1 ? "s" : ""}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Approve All",
          onPress: async () => {
            try {
              await approveExpenses(realized.map((item) => item.id));
              loadItems();
            } catch (e) {
              logger.error("Approve auto-detected failed:", e);
              alert("Error", "Some items may have been approved. " + (e instanceof Error ? e.message : ""));
              loadItems();
            }
          },
        },
      ],
    );
  }, [realized, loadItems]);

  const handleRejectAutoDetected = useCallback(async () => {
    if (realized.length === 0) return;
    alert(
      "Reject Auto-Detected",
      `Reject all ${realized.length} auto-detected expense${realized.length > 1 ? "s" : ""}? They won't count in your budget.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reject All",
          style: "destructive",
          onPress: async () => {
            try {
              await rejectExpenses(realized.map((item) => item.id));
              loadItems();
            } catch (e) {
              logger.error("Reject auto-detected failed:", e);
              alert("Error", "Some items may have been rejected. " + (e instanceof Error ? e.message : ""));
              loadItems();
            }
          },
        },
      ],
    );
  }, [realized, loadItems]);

  const handleDismissOverdue = useCallback(async () => {
    const overdueCount = overdueForecasts.length;
    if (overdueCount === 0) return;
    alert(
      "Dismiss Overdue",
      `Reject ${overdueCount} overdue forecast${overdueCount > 1 ? "s" : ""}? These likely already happened or are no longer relevant.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Dismiss",
          style: "destructive",
          onPress: async () => {
            try {
              await dismissOverdueForecasts(DEFAULT_USER_ID, today);
              loadItems();
            } catch (e) {
              logger.error("Dismiss overdue forecasts failed:", e);
              alert("Error", formatError("Dismiss overdue", e));
            }
          },
        },
      ],
    );
  }, [overdueForecasts, loadItems, today]);

  // Duplicate handlers
  const handleRejectDuplicate = useCallback(async (expenseId: string) => {
    alert(
      "Reject Duplicate",
      "This expense will be rejected and won't count in your budget. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reject",
          style: "destructive",
          onPress: async () => {
            try {
              await rejectExpense(expenseId);
              loadItems();
            } catch (e) {
              alert("Error", e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  }, [loadItems]);

  const handleAutoResolveGroup = useCallback((group: DuplicateGroup) => {
    const sorted = [...group.expenses].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const toReject = sorted.slice(1);
    if (toReject.length === 0) return;

    alert(
      "Keep Latest, Reject Others",
      `Keep "${sorted[0].merchant_name ?? "Unknown"}" (most recent) and reject ${toReject.length} duplicate${toReject.length > 1 ? "s" : ""}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reject Duplicates",
          style: "destructive",
          onPress: async () => {
            try {
              for (const exp of toReject) {
                await rejectExpense(exp.id);
              }
              loadItems();
            } catch (e) {
              alert("Error", e instanceof Error ? e.message : String(e));
              loadItems();
            }
          },
        },
      ],
    );
  }, [loadItems]);

  const handleKeepBothGroup = useCallback((group: DuplicateGroup) => {
    const merchant = group.expenses[0]?.merchant_name ?? "these transactions";
    alert(
      "Keep Both",
      `Mark ${group.expenses.length} transactions at ${merchant} as not duplicates? They'll stay as-is and won't be flagged again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Keep Both",
          onPress: () => {
            dismissDuplicateGroup(group.expenses);
            loadItems();
          },
        },
      ],
    );
  }, [loadItems]);

  const handleKeepBothAllDuplicates = useCallback(() => {
    if (duplicateGroups.length === 0) return;
    alert(
      "Keep Both - All Groups",
      `Mark all ${duplicateGroups.length} duplicate group${duplicateGroups.length !== 1 ? "s" : ""} as not duplicates? They'll stay as-is and won't be flagged again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Keep All",
          onPress: () => {
            for (const group of duplicateGroups) {
              dismissDuplicateGroup(group.expenses);
            }
            loadItems();
          },
        },
      ],
    );
  }, [duplicateGroups, loadItems]);

  const handleResolveAllDuplicates = useCallback(() => {
    if (duplicateGroups.length === 0) return;
    const totalToReject = duplicateGroups.reduce((sum, g) => {
      const sorted = [...g.expenses].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      return sum + sorted.slice(1).length;
    }, 0);

    alert(
      "Resolve All Duplicates",
      `Keep the oldest in each group and reject ${totalToReject} duplicate${totalToReject !== 1 ? "s" : ""} across ${duplicateGroups.length} group${duplicateGroups.length !== 1 ? "s" : ""}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Resolve All",
          style: "destructive",
          onPress: async () => {
            try {
              for (const group of duplicateGroups) {
                const sorted = [...group.expenses].sort(
                  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
                );
                for (const exp of sorted.slice(1)) {
                  await rejectExpense(exp.id);
                }
              }
              loadItems();
            } catch (e) {
              alert("Error", e instanceof Error ? e.message : String(e));
              loadItems();
            }
          },
        },
      ],
    );
  }, [duplicateGroups, loadItems]);

  // Uncategorized handlers
  const toggleUncatSelect = useCallback((id: string) => {
    setSelectedUncat((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleUncatSelectAll = useCallback(() => {
    if (selectedUncat.size === uncategorizedItems.length) {
      setSelectedUncat(new Set());
    } else {
      setSelectedUncat(new Set(uncategorizedItems.map((e) => e.id)));
    }
  }, [uncategorizedItems, selectedUncat.size]);

  const handleAssignCategory = useCallback(async (categoryId: string) => {
    const ids = Array.from(selectedUncat);
    if (ids.length === 0) return;
    const cat = categories.find((c) => c.id === categoryId);
    try {
      const count = await bulkAssignCategory(ids, categoryId);
      setShowCategoryPicker(false);
      setSelectedUncat(new Set());
      alert(
        "Categorized",
        `${count} expense${count !== 1 ? "s" : ""} assigned to "${cat?.name ?? "category"}".`,
      );
      loadItems();
    } catch (e) {
      alert("Error", e instanceof Error ? e.message : "Assignment failed.");
    }
  }, [selectedUncat, categories, loadItems]);

  // ── Build list data ──

  type ListItem =
    | { type: "header"; key: string; title: string; count: number; icon: keyof typeof Ionicons.glyphMap; color: string }
    | { type: "expense"; expense: Expense; sectionKey: string }
    | { type: "match_pair"; pair: ForecastMatchPair; sectionKey: string }
    | { type: "dismiss_overdue"; count: number; sectionKey: string }
    | { type: "approve_auto_detected"; count: number; sectionKey: string }
    | { type: "duplicate_group"; group: DuplicateGroup; index: number; sectionKey: string }
    | { type: "duplicate_bulk_actions"; count: number; sectionKey: string }
    | { type: "uncat_expense"; expense: Expense; sectionKey: string }
    | { type: "uncat_actions"; sectionKey: string }
    | { type: "uncat_select_all"; sectionKey: string };

  const listData: ListItem[] = [];
  const isAll = activeFilter === "all";

  // Helper to check if section is visible
  const showSection = (key: SectionFilter) => isAll || activeFilter === key;

  if (showSection("matched") && matchedPairs.length > 0) {
    const key = "matched";
    if (isAll) {
      listData.push({ type: "header", key, title: "Matched Forecasts", count: matchedPairs.length, icon: "git-compare-outline", color: theme.warning });
    }
    if (!isAll || openSections[key]) {
      matchedPairs.forEach((p) => listData.push({ type: "match_pair", pair: p, sectionKey: key }));
    }
  }

  if (showSection("overdue") && overdueForecasts.length > 0) {
    const key = "overdue";
    if (isAll) {
      listData.push({ type: "header", key, title: "Overdue", count: overdueForecasts.length, icon: "alert-circle-outline", color: theme.danger });
    }
    listData.push({ type: "dismiss_overdue", count: overdueForecasts.length, sectionKey: key });
    if (!isAll || openSections[key]) {
      overdueForecasts.forEach((e) => listData.push({ type: "expense", expense: e, sectionKey: key }));
    }
  }

  if (showSection("upcoming") && activeForecasts.length > 0) {
    const key = "upcoming";
    if (isAll) {
      listData.push({ type: "header", key, title: "Upcoming (Forecast)", count: activeForecasts.length, icon: "time-outline", color: theme.warning });
    }
    if (!isAll || openSections[key]) {
      activeForecasts.forEach((e) => listData.push({ type: "expense", expense: e, sectionKey: key }));
    }
  }

  if (showSection("auto") && realized.length > 0) {
    const key = "auto";
    if (isAll) {
      listData.push({ type: "header", key, title: "Auto-Detected", count: realized.length, icon: "swap-horizontal-outline", color: colors.blue });
    }
    listData.push({ type: "approve_auto_detected", count: realized.length, sectionKey: key });
    if (!isAll || openSections[key]) {
      realized.forEach((e) => listData.push({ type: "expense", expense: e, sectionKey: key }));
    }
  }

  if (showSection("duplicates") && duplicateGroups.length > 0) {
    const key = "duplicates";
    if (isAll) {
      listData.push({ type: "header", key, title: "Possible Duplicates", count: duplicateGroups.length, icon: "copy-outline", color: theme.warning });
    }
    listData.push({ type: "duplicate_bulk_actions", count: duplicateGroups.length, sectionKey: key });
    if (!isAll || openSections[key]) {
      duplicateGroups.forEach((g, i) => listData.push({ type: "duplicate_group", group: g, index: i, sectionKey: key }));
    }
  }

  if (showSection("uncategorized") && uncategorizedItems.length > 0) {
    const key = "uncategorized";
    if (isAll) {
      listData.push({ type: "header", key, title: "Uncategorized", count: uncategorizedItems.length, icon: "help-circle-outline", color: theme.faintForeground });
    }
    listData.push({ type: "uncat_select_all", sectionKey: key });
    if (!isAll || openSections[key]) {
      uncategorizedItems.forEach((e) => listData.push({ type: "uncat_expense", expense: e, sectionKey: key }));
    }
  }

  const renderExpenseActions = useCallback(
    (expense: Expense) => {
      const isForecast = expense.nature === "forecast";
      const isOverdue = isForecast && expense.due_date != null && expense.due_date < today;

      return (
        <View className="flex-row items-center ml-2">
          {isForecast && (
            <View className="px-1.5 py-0.5 rounded mr-2" style={{ backgroundColor: isOverdue ? theme.alpha("danger", 0.08) : theme.alpha("warning", 0.08) }}>
              <Text
                className="text-label font-semibold"
                style={{ color: isOverdue ? theme.danger : theme.warning }}
              >
                {isOverdue ? "OVERDUE" : "FORECAST"}
              </Text>
            </View>
          )}
          <Pressable
            onPress={() => handleApprove(expense.id)}
            className="w-9 h-9 rounded-full items-center justify-center mr-2"
            style={{ backgroundColor: theme.alpha("success", 0.08) }}
          >
            <Ionicons name="checkmark" size={18} color={theme.success} />
          </Pressable>
          <Pressable
            onPress={() => handleReject(expense.id)}
            className="w-9 h-9 rounded-full items-center justify-center"
            style={{ backgroundColor: theme.alpha("danger", 0.08) }}
          >
            <Ionicons name="close" size={18} color={theme.danger} />
          </Pressable>
        </View>
      );
    },
    [handleApprove, handleReject, colorScheme, today],
  );

  const totalItems = counts.all;
  const hasBottomBar = selectedUncat.size > 0;

  if (loading && items.length === 0) {
    return (
      <View style={{ flex: 1 }}>
        <LoadingState message="Loading review queue…" icon="clipboard-outline" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Header - route only; inside the Home pager this would be a second header. */}
      {showHeader && (
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
        <View className="flex-row items-center -ml-2">
          <Pressable onPress={() => router.back()} className="p-2">
            <Ionicons name="arrow-back" size={24} color={colors.textSecondary} />
          </Pressable>
          <Pressable onPress={() => router.replace("/(tabs)")} className="p-2" hitSlop={8} accessibilityLabel="Go to Home">
            <Ionicons name="home-outline" size={20} color={colors.tint} />
          </Pressable>
        </View>
        <Text className="text-lg font-semibold text-foreground">
          Review Queue
        </Text>
        <Pressable
          onPress={async () => {
            const outcome = await scanNow();
            await loadItems();
            if (outcome.reason === "sms_disabled") {
              alert("SMS Disabled", "Turn on SMS detection in Settings to scan for new transactions.");
            } else if (outcome.reason === "no_permission") {
              alert("Permission Needed", "Grant SMS permission in device settings to scan.");
            } else if (outcome.ran && outcome.created === 0 && outcome.credits === 0 && outcome.totalScanned === 0) {
              alert("Scan Complete", "No new bank SMS found.");
            }
          }}
          disabled={scanning}
          className="p-2 -mr-2"
          accessibilityLabel="Scan SMS now"
        >
          <Ionicons
            name={scanning ? "sync" : "refresh-outline"}
            size={22}
            color={scanning ? colors.textSecondary : colors.blue}
          />
        </Pressable>
      </View>
      )}

      {/* Context help chip */}
      <View className="px-4 py-3">
        <LearnMoreChip contextKey="review-queue" label="How reviews work" />
      </View>

      {/* Scan loader banner */}
      {scanning && (
        <View className="flex-row items-center px-4 py-2" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
          <Ionicons name="sync" size={14} color={colors.blue} />
          <Text className="text-xs ml-2" style={{ color: colors.blue }}>
            Scanning SMS for new transactions...
          </Text>
        </View>
      )}

      {/* Summary banner */}
      {totalItems > 0 && (
        <View className="px-4 py-2.5" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
          <View className="flex-row items-center">
            <Ionicons name="layers-outline" size={16} color={colors.blue} />
            <Text className="text-sm font-semibold ml-1.5" style={{ color: theme.primary }}>
              {totalItems} item{totalItems !== 1 ? "s" : ""} to review
            </Text>
          </View>
        </View>
      )}

      {/* Filter chips — horizontal scroll */}
      <View className="border-b border-border">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}
        >
          {FILTER_OPTIONS.map((opt) => {
            const isActive = activeFilter === opt.key;
            const count = counts[opt.key];
            if (opt.key !== "all" && count === 0) return null;
            return (
              <Pressable
                key={opt.key}
                onPress={() => {
                  setActiveFilter(opt.key);
                  setSelectedUncat(new Set());
                  setShowCategoryPicker(false);
                }}
                className={`flex-row items-center px-3 py-1.5 rounded-full ${
                  isActive ? "border" : "bg-card"
                }`}
                style={isActive ? { backgroundColor: theme.alpha("primary", 0.1), borderColor: theme.primary } : undefined}
              >
                <Ionicons
                  name={opt.icon}
                  size={14}
                  color={isActive ? theme.primary : colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text
                  className={`text-xs ${isActive ? "font-semibold" : "text-muted-foreground"}`}
                  style={isActive ? { color: theme.primary } : undefined}
                >
                  {opt.label}
                </Text>
                {count > 0 && (
                  <View
                    className="ml-1.5 px-1.5 py-0.5 rounded-full"
                    style={{
                      backgroundColor: isActive ? theme.alpha("primary", 0.13) : theme.faintForeground + "14",
                    }}
                  >
                    <Text
                      className="text-label font-bold"
                      style={{ color: isActive ? theme.primary : theme.faintForeground }}
                    >
                      {count}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* List */}
      <FlatList
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        data={listData}
        keyExtractor={(item, index) => {
          if (item.type === "expense") return item.expense.id;
          if (item.type === "uncat_expense") return `uncat-${item.expense.id}`;
          if (item.type === "match_pair") return `match-${item.pair.realized.id}`;
          if (item.type === "duplicate_group") return `dup-${item.index}`;
          if (item.type === "header") return `header-${item.key}`;
          return `${item.type}-${index}`;
        }}
        renderItem={({ item }) => {
          // Section header (all view only)
          if (item.type === "header") {
            const isOpen = openSections[item.key] ?? false;
            return (
              <Pressable
                onPress={() => toggleSection(item.key)}
                className="flex-row items-center justify-between px-4 py-2.5 bg-background"
              >
                <View className="flex-row items-center">
                  <Ionicons name={item.icon} size={14} color={item.color} />
                  <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground ml-1.5">
                    {item.title}
                  </Text>
                  <View className="ml-1.5 px-1.5 py-0.5 rounded-full" style={{ backgroundColor: theme.faintForeground + "14" }}>
                    <Text className="text-label font-bold" style={{ color: theme.faintForeground }}>{item.count}</Text>
                  </View>
                </View>
                <Ionicons
                  name={isOpen ? "chevron-up" : "chevron-down"}
                  size={14}
                  color={colors.textSecondary}
                />
              </Pressable>
            );
          }

          // Forecast match card
          if (item.type === "match_pair") {
            return (
              <ForecastMatchCard
                pair={item.pair}
                onRealize={handleMatchRealize}
                onAlreadyCaptured={handleMatchAlreadyCaptured}
                onBothDifferent={handleMatchBothDifferent}
              />
            );
          }

          // Dismiss overdue button
          if (item.type === "dismiss_overdue") {
            return (
              <Pressable
                onPress={handleDismissOverdue}
                className="flex-row items-center justify-center mx-4 my-2 py-2.5 rounded-lg"
                style={{ backgroundColor: theme.alpha("danger", 0.08) }}
              >
                <Ionicons name="trash-outline" size={16} color={theme.danger} />
                <Text className="text-sm font-semibold ml-1.5" style={{ color: theme.danger }}>
                  Dismiss {item.count} Overdue
                </Text>
              </Pressable>
            );
          }

          // Approve/Reject auto-detected buttons
          if (item.type === "approve_auto_detected") {
            return (
              <View className="flex-row mx-4 my-2 gap-2">
                <Pressable
                  onPress={handleApproveAutoDetected}
                  className="flex-1 flex-row items-center justify-center py-2.5 rounded-lg"
                  style={{ backgroundColor: theme.alpha("success", 0.08) }}
                >
                  <Ionicons name="checkmark-done-outline" size={16} color={theme.success} />
                  <Text className="text-sm font-semibold ml-1.5" style={{ color: theme.success }}>
                    Approve All
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleRejectAutoDetected}
                  className="flex-1 flex-row items-center justify-center py-2.5 rounded-lg"
                  style={{ backgroundColor: theme.alpha("danger", 0.08) }}
                >
                  <Ionicons name="close-circle-outline" size={16} color={theme.danger} />
                  <Text className="text-sm font-semibold ml-1.5" style={{ color: theme.danger }}>
                    Reject All
                  </Text>
                </Pressable>
              </View>
            );
          }

          // Duplicate bulk actions — Keep All + Resolve All side by side
          if (item.type === "duplicate_bulk_actions") {
            return (
              <View className="flex-row mx-4 my-2 gap-2">
                <Pressable
                  onPress={handleKeepBothAllDuplicates}
                  className="flex-1 flex-row items-center justify-center py-2.5 rounded-lg"
                  style={{ backgroundColor: theme.alpha("success", 0.08) }}
                >
                  <Ionicons name="checkmark-done-circle-outline" size={15} color={theme.success} />
                  <Text className="text-xs font-semibold ml-1.5" style={{ color: theme.success }}>
                    Keep All
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleResolveAllDuplicates}
                  className="flex-1 flex-row items-center justify-center py-2.5 rounded-lg"
                  style={{ backgroundColor: theme.alpha("danger", 0.08) }}
                >
                  <Ionicons name="checkmark-done-outline" size={15} color={theme.danger} />
                  <Text className="text-xs font-semibold ml-1.5" style={{ color: theme.danger }}>
                    Resolve All
                  </Text>
                </Pressable>
              </View>
            );
          }

          // Duplicate group card
          if (item.type === "duplicate_group") {
            return (
              <DuplicateGroupCard
                group={item.group}
                index={item.index}
                onRejectDuplicate={handleRejectDuplicate}
                onAutoResolve={handleAutoResolveGroup}
                onKeepBoth={handleKeepBothGroup}
                onTapExpense={handleTap}
              />
            );
          }

          // Uncategorized select-all bar
          if (item.type === "uncat_select_all") {
            return (
              <View className="flex-row items-center justify-between px-4 py-2">
                <Text className="text-xs text-muted-foreground">
                  {selectedUncat.size > 0
                    ? `${selectedUncat.size} selected (${formatAmount(
                        uncategorizedItems
                          .filter((e) => selectedUncat.has(e.id))
                          .reduce((s, e) => s + e.amount, 0),
                      )})`
                    : "Long-press or tap checkbox to select"}
                </Text>
                <Pressable onPress={toggleUncatSelectAll}>
                  <Text className="text-xs font-semibold" style={{ color: theme.primary }}>
                    {selectedUncat.size === uncategorizedItems.length ? "Deselect All" : "Select All"}
                  </Text>
                </Pressable>
              </View>
            );
          }

          // Uncategorized expense row (with checkbox)
          if (item.type === "uncat_expense") {
            const exp = item.expense;
            const isSelected = selectedUncat.has(exp.id);
            const pm = exp.payment_mode_id ? paymentModeMap.get(exp.payment_mode_id) : null;

            return (
              <Pressable
                onPress={() => {
                  if (selectedUncat.size > 0) {
                    toggleUncatSelect(exp.id);
                  } else {
                    router.push(`/expense/${exp.id}`);
                  }
                }}
                onLongPress={() => toggleUncatSelect(exp.id)}
                className="flex-row items-center px-4 py-3 border-b border-border"
              >
                <Pressable onPress={() => toggleUncatSelect(exp.id)} hitSlop={8} className="mr-3">
                  <View
                    className="w-5 h-5 rounded border items-center justify-center"
                    style={{
                      borderColor: isSelected ? theme.primary : colors.border,
                      backgroundColor: isSelected ? theme.primary : "transparent",
                    }}
                  >
                    {isSelected && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                  </View>
                </Pressable>

                <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.faintForeground + "14" }}>
                  <Ionicons name="help-circle-outline" size={20} color={theme.faintForeground} />
                </View>

                <View className="flex-1 mr-3">
                  <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                    {exp.description || exp.merchant_name || "No description"}
                  </Text>
                  {pm && (
                    <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
                      {pm.name}
                    </Text>
                  )}
                </View>

                <View className="items-end shrink-0">
                  <Text className="text-sm font-bold text-foreground">
                    {formatAmount(exp.amount)}
                  </Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">
                    {new Date(exp.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </Text>
                </View>
              </Pressable>
            );
          }

          // Regular expense item (pending review)
          if (item.type !== "expense") return null;
          const exp = item.expense;
          const category = exp.category_id ? categoryMap.get(exp.category_id) : null;
          const paymentMode = exp.payment_mode_id ? paymentModeMap.get(exp.payment_mode_id) : null;
          const account = exp.account_id ? accountMap.get(exp.account_id) : null;

          return (
            <ExpenseListItem
              expense={exp}
              category={category}
              paymentMode={paymentMode}
              account={account}
              onPress={() => handleTap(exp.id)}
              rightElement={renderExpenseActions(exp)}
            />
          );
        }}
        ListEmptyComponent={
          !loading ? (
            <View className="flex-1 items-center justify-center py-20">
              <View className="w-16 h-16 rounded-full items-center justify-center mb-4" style={{ backgroundColor: theme.alpha("success", 0.08) }}>
                <Ionicons name="checkmark-done" size={32} color={theme.success} />
              </View>
              <Text className="text-lg font-semibold text-foreground">
                All caught up!
              </Text>
              <Text className="text-sm text-muted-foreground mt-1 text-center px-8">
                {activeFilter === "all"
                  ? "No pending items to review."
                  : `No ${FILTER_OPTIONS.find((f) => f.key === activeFilter)?.label.toLowerCase() ?? ""} items.`}
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={
          listData.length === 0
            ? { flex: 1 }
            : { paddingBottom: hasBottomBar ? 120 : 40 }
        }
        refreshing={loading}
        onRefresh={loadItems}
      />

      {/* Source account picker for CC repayment credits */}
      <AccountPickerSheet
        visible={ccRepaymentPickerFor !== null}
        onSelect={handleCcRepaymentSourceSelected}
        onClose={() => setCcRepaymentPickerFor(null)}
        title="Paid from which account?"
        filterTypes={["savings", "wallet"]}
      />

      {/* Bottom action bar for uncategorized — assign category */}
      {selectedUncat.size > 0 && !showCategoryPicker && (
        <View
          className="absolute bottom-0 left-0 right-0 px-4 py-3 border-t border-border"
          style={{ backgroundColor: colors.background }}
        >
          <Pressable
            onPress={() => setShowCategoryPicker(true)}
            className="flex-row items-center justify-center py-3 rounded-xl"
            style={{ backgroundColor: theme.primary }}
          >
            <Ionicons name="pricetag-outline" size={18} color="#FFFFFF" />
            <Text className="text-sm font-semibold text-primary-foreground ml-2">
              Assign Category to {selectedUncat.size} Expense{selectedUncat.size !== 1 ? "s" : ""}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Category picker overlay */}
      {showCategoryPicker && (
        <View
          className="absolute bottom-0 left-0 right-0 border-t border-border"
          style={{ backgroundColor: colors.background, maxHeight: "50%" }}
        >
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
            <Text className="text-sm font-semibold text-foreground">
              Choose Category
            </Text>
            <Pressable onPress={() => setShowCategoryPicker(false)}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          <FlatList
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={7}
            data={categories}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 20 }}
            renderItem={({ item: cat }) => (
              <Pressable
                onPress={() => handleAssignCategory(cat.id)}
                className="flex-row items-center px-4 py-3 border-b border-border"
              >
                <View
                  className="w-8 h-8 rounded-full items-center justify-center mr-3"
                  style={{ backgroundColor: cat.color + "14" }}
                >
                  <Ionicons
                    name={cat.icon as keyof typeof Ionicons.glyphMap}
                    size={16}
                    color={cat.color}
                  />
                </View>
                <Text className="text-sm font-medium text-foreground flex-1">
                  {cat.name}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </Pressable>
            )}
          />
        </View>
      )}
    </View>
  );
}
