import { useState, useCallback, useMemo } from "react";
import { DEFAULT_USER_ID } from "@/constants/app";
import { View, FlatList, TextInput, Pressable } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Ionicons } from "@expo/vector-icons";
import { Button, PeriodNavigator, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { formatError } from "@/utils/error-message";
import { logger } from "@/utils/logger";
import { getCategories } from "@/services/category";
import {
  getBudgetsForMonth,
  upsertBudget,
  getCurrentMonth,
} from "@/services/budget";
import type { Category } from "@/services/category";
import type { Budget } from "@/services/budget";
import { formatAmount } from "@/utils/expense-validation";

import { useTheme } from "@/hooks/use-theme";

interface BudgetRow {
  category: Category;
  budget: Budget | null;
  editAmount: string;
}

export default function BudgetConfigScreen() {
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [month, setMonth] = useState(getCurrentMonth());
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [hasNoBudget, setHasNoBudget] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [categories, budgets] = await Promise.all([
        getCategories(DEFAULT_USER_ID),
        getBudgetsForMonth(DEFAULT_USER_ID, month),
      ]);

      const budgetMap = new Map(budgets.map((b) => [b.category_id, b]));
      const merged: BudgetRow[] = categories.map((cat) => {
        const budget = budgetMap.get(cat.id) ?? null;
        return {
          category: cat,
          budget,
          editAmount: budget ? String(budget.amount) : "0",
        };
      });
      setRows(merged);
      setHasChanges(false);
      setHasNoBudget(budgets.length === 0 || budgets.every((b) => b.amount === 0));
    } catch {
      // Database not ready
    }
  }, [month]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const handleAmountChange = useCallback((categoryId: string, value: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.category.id === categoryId ? { ...r, editAmount: value } : r,
      ),
    );
    setHasChanges(true);
  }, []);

  // Generate FY months (Apr-Mar) for the current viewing month's FY
  const getFYMonths = useCallback((): string[] => {
    const [y, m] = month.split("-").map(Number);
    const fyStartYear = m >= 4 ? y : y - 1;
    const months: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(fyStartYear, 3 + i, 1);
      months.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      );
    }
    return months;
  }, [month]);

  // Generate months from current viewing month to FY end
  const getMonthsOnwards = useCallback((): string[] => {
    const fyMonths = getFYMonths();
    const idx = fyMonths.indexOf(month);
    return idx >= 0 ? fyMonths.slice(idx) : [month];
  }, [month, getFYMonths]);

  // Get FY label for display (e.g., "FY 2026-27")
  const getFYLabel = useCallback((): string => {
    const [y, m] = month.split("-").map(Number);
    const fyStartYear = m >= 4 ? y : y - 1;
    return `FY ${fyStartYear}-${String(fyStartYear + 1).slice(2)}`;
  }, [month]);

  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const monthLabel = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return `${MONTH_NAMES[m - 1]} ${y}`;
  }, [month]);

  const previousMonth = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, [month]);

  const previousMonthLabel = useMemo(() => {
    const [y, m] = previousMonth.split("-").map(Number);
    return `${MONTH_NAMES[m - 1]} ${y}`;
  }, [previousMonth]);

  // Silently persist current edits (no alert). Used before switching months.
  const saveSilent = useCallback(async (): Promise<void> => {
    for (const row of rows) {
      const amount = parseFloat(row.editAmount) || 0;
      if (amount > 0 || row.budget) {
        await upsertBudget({ user_id: DEFAULT_USER_ID, category_id: row.category.id, month, amount });
      }
    }
  }, [rows, month]);

  // Intercept period navigation — prompt to save if there are unsaved edits.
  const handleMonthChange = useCallback((newMonth: string) => {
    if (!hasChanges) { setMonth(newMonth); return; }
    alert("Unsaved Changes", `Save changes for ${monthLabel} before switching?`, [
      {
        text: "Save & Switch",
        onPress: async () => {
          setSaving(true);
          try { await saveSilent(); } catch (e) { logger.error("Save before switch failed:", e); } finally { setSaving(false); }
          setMonth(newMonth);
        },
      },
      { text: "Discard", style: "destructive" as const, onPress: () => setMonth(newMonth) },
      { text: "Cancel", style: "cancel" as const },
    ]);
  }, [hasChanges, monthLabel, saveSilent, alert]);

  // Copy budgets from the previous month into the current editing state.
  const copyFromPreviousMonth = useCallback(async () => {
    try {
      const prevBudgets = await getBudgetsForMonth(DEFAULT_USER_ID, previousMonth);
      if (prevBudgets.length === 0 || prevBudgets.every((b) => b.amount === 0)) {
        alert("No Data", `No budget configured for ${previousMonthLabel} either.`);
        return;
      }
      const prevMap = new Map(prevBudgets.map((b) => [b.category_id, b.amount]));
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          editAmount: String(prevMap.get(r.category.id) ?? 0),
        })),
      );
      setHasChanges(true);
      setHasNoBudget(false);
    } catch (e) {
      logger.error("Copy from previous month failed:", e);
    }
  }, [previousMonth, previousMonthLabel, alert]);

  // Save budgets to specified months
  const saveBudgetsToMonths = useCallback(
    async (months: string[]) => {
      setSaving(true);
      try {
        for (const m of months) {
          for (const row of rows) {
            const amount = parseFloat(row.editAmount) || 0;
            if (amount > 0 || row.budget) {
              await upsertBudget({
                user_id: DEFAULT_USER_ID,
                category_id: row.category.id,
                month: m,
                amount,
              });
            }
          }
        }
        await loadData();
        if (months.length === 1) {
          alert("Saved", `Budget updated for ${monthLabel}.`);
          setHasNoBudget(false);
        } else {
          alert("Saved", `Budget applied to ${months.length} months.`);
          setHasNoBudget(false);
        }
      } catch (e) {
        logger.error("Save budgets failed:", e);
        alert("Error", formatError("Save budgets", e));
      } finally {
        setSaving(false);
      }
    },
    [rows, loadData, monthLabel],
  );

  // Show scope picker when saving
  const handleSave = useCallback(() => {
    const onwardsMonths = getMonthsOnwards();
    const fyLabel = getFYLabel();

    alert("Apply To", "Which months should this budget apply to?", [
      {
        text: "This Month Only",
        onPress: () => saveBudgetsToMonths([month]),
      },
      {
        text: `This Month Onwards (${onwardsMonths.length} months)`,
        onPress: () => saveBudgetsToMonths(onwardsMonths),
      },
      {
        text: `All Months in ${fyLabel}`,
        onPress: () => saveBudgetsToMonths(getFYMonths()),
      },
      { text: "Cancel", style: "cancel" as const },
    ]);
  }, [month, getMonthsOnwards, getFYMonths, getFYLabel, saveBudgetsToMonths]);

  const totalBudget = rows.reduce(
    (sum, r) => sum + (parseFloat(r.editAmount) || 0),
    0,
  );

  const renderItem = ({ item }: { item: BudgetRow }) => (
    <View className="flex-row items-center px-4 py-3 border-b border-border">
      <View
        className="w-9 h-9 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: item.category.color + "14" }}
      >
        <Ionicons
          name={item.category.icon as keyof typeof Ionicons.glyphMap}
          size={18}
          color={item.category.color}
        />
      </View>
      <View className="flex-1 mr-3">
        <Text
          className="text-sm font-medium text-foreground"
          numberOfLines={1}
        >
          {item.category.name}
        </Text>
        {item.category.is_unavoidable === 1 && (
          <Text className="text-xs text-faint-foreground">Unavoidable</Text>
        )}
      </View>
      <View className="flex-row items-center">
        <Text className="text-sm text-faint-foreground mr-1">
          {"\u20B9"}
        </Text>
        <TextInput
          value={item.editAmount}
          onChangeText={(text) => handleAmountChange(item.category.id, text)}
          keyboardType="numeric"
          className="w-20 text-right text-base font-medium text-foreground border-b border-border py-1"
          placeholderTextColor={colors.tabIconDefault}
          selectTextOnFocus
        />
      </View>
    </View>
  );

  return (
    <ScreenContainer padTop={false} keyboardAware>
      {/* Month selector */}
      <PeriodNavigator mode="month" value={month} onChange={handleMonthChange} />

      {/* No-budget banner — offer to copy from previous month */}
      {hasNoBudget && (
        <View
          className="mx-4 mt-2 mb-1 px-3 py-2.5 rounded-lg flex-row items-center"
          style={{ backgroundColor: theme.alpha("warning", 0.08) }}
        >
          <Ionicons name="information-circle-outline" size={16} color={theme.warning} />
          <Text className="text-xs text-muted-foreground flex-1 ml-2">
            No budget set for {monthLabel}.
          </Text>
          <Pressable onPress={copyFromPreviousMonth} className="ml-2">
            <Text className="text-xs font-semibold" style={{ color: theme.primary }}>
              Copy from {previousMonthLabel}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Total */}
      <View className="px-4 py-3 bg-card">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-muted-foreground">
            Total Monthly Budget
          </Text>
          <Text className="text-lg font-bold text-foreground">
            {formatAmount(totalBudget)}
          </Text>
        </View>
      </View>

      {/* Category budgets */}
      <FlatList
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        data={rows}
        keyExtractor={(item) => item.category.id}
        renderItem={renderItem}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center py-20">
            <Text className="text-muted-foreground">
              No categories found. Add categories first.
            </Text>
          </View>
        }
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 120 }}
      />

      {/* Save button */}
      <View className="p-4 border-t border-border">
        <Button
          title="Save"
          onPress={handleSave}
          loading={saving}
          disabled={!hasChanges}
        />
      </View>
    </ScreenContainer>
  );
}
