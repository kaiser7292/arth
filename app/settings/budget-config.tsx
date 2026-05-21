import { useState, useCallback } from "react";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  View,
  Text,
  FlatList,
  TextInput,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Button, PeriodNavigator } from "@/components/ui";
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

interface BudgetRow {
  category: Category;
  budget: Budget | null;
  editAmount: string;
}

export default function BudgetConfigScreen() {
  const alert = useAlert();
  const { colors } = useColorScheme();
  const [month, setMonth] = useState(getCurrentMonth());
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

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

  const monthLabel = (() => {
    const [, m] = month.split("-").map(Number);
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    return `${months[m - 1]}`;
  })();

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
        } else {
          alert("Saved", `Budget applied to ${months.length} months.`);
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
    <View className="flex-row items-center px-4 py-3 border-b border-border-light dark:border-border-dark">
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
          className="text-sm font-medium text-text-primary dark:text-text-dark-primary"
          numberOfLines={1}
        >
          {item.category.name}
        </Text>
        {item.category.is_unavoidable === 1 && (
          <Text className="text-xs text-text-tertiary">Unavoidable</Text>
        )}
      </View>
      <View className="flex-row items-center">
        <Text className="text-sm text-text-tertiary mr-1">
          {"\u20B9"}
        </Text>
        <TextInput
          value={item.editAmount}
          onChangeText={(text) => handleAmountChange(item.category.id, text)}
          keyboardType="numeric"
          className="w-20 text-right text-base font-medium text-text-primary dark:text-text-dark-primary border-b border-border-light dark:border-border-dark py-1"
          placeholderTextColor={colors.tabIconDefault}
          selectTextOnFocus
        />
      </View>
    </View>
  );

  return (
    <ScreenContainer padTop={false} keyboardAware>
      {/* Month selector */}
      <PeriodNavigator mode="month" value={month} onChange={setMonth} />

      {/* Total */}
      <View className="px-4 py-3 bg-surface-light-alt dark:bg-surface-dark-alt">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
            Total Monthly Budget
          </Text>
          <Text className="text-lg font-bold text-text-primary dark:text-text-dark-primary">
            {formatAmount(totalBudget)}
          </Text>
        </View>
      </View>

      {/* Category budgets */}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.category.id}
        renderItem={renderItem}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center py-20">
            <Text className="text-text-secondary dark:text-text-dark-secondary">
              No categories found. Add categories first.
            </Text>
          </View>
        }
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 120 }}
      />

      {/* Save button */}
      <View className="p-4 border-t border-border-light dark:border-border-dark">
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
