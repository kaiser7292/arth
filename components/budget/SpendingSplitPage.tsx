import { useState, useCallback, useRef } from "react";
import { View, Text, ScrollView, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ProgressBar } from "@/components/ui";
import { DonutChart } from "@/components/charts/DonutChart";
import { getCategories } from "@/services/category";
import { getBudgetsForMonth } from "@/services/budget";
import { getExpenseTotalsByCategoryAndClassification } from "@/services/expense";
import { getSpendClassificationTotals } from "@/services/spend-classification";
import { getYearlyPlanByFY } from "@/services/yearly-plan";
import { formatAmount } from "@/utils/expense-validation";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { calculateSplit } from "@/utils/unavoidable-split";
import type { SplitSnapshot } from "@/utils/unavoidable-split";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { getCurrentFY } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";

const UNAVOIDABLE_COLOR = "#3B82F6";
const DISCRETIONARY_COLOR = "#D97706";

interface SpendingSplitPageProps {
  month: string;
}

export function SpendingSplitPage({ month }: SpendingSplitPageProps) {
  const router = useRouter();
  const { colorScheme, colors } = useColorScheme();
  const [split, setSplit] = useState<SplitSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef({ unavoidable: 0, discretionary: 0 });

  const { startDate, endDate } = getMonthDateRange(month);

  const loadData = useCallback(async () => {
    try {
      const [categories, budgets, actuals, classification] = await Promise.all([
        getCategories(DEFAULT_USER_ID),
        getBudgetsForMonth(DEFAULT_USER_ID, month),
        getExpenseTotalsByCategoryAndClassification(DEFAULT_USER_ID, startDate, endDate),
        getSpendClassificationTotals(DEFAULT_USER_ID, startDate, endDate),
      ]);

      const budgetMap = new Map(budgets.map((b) => [b.category_id, b.amount]));
      const catNameMap = new Map(categories.map((c) => [c.id, c.name]));

      const items = actuals.map((a) => ({
        categoryId: a.category_id,
        name: catNameMap.get(a.category_id) ?? "Unknown",
        spent: a.total,
        isUnavoidable: a.is_unavoidable === 1,
      }));

      let monthlyIncome: number | null = null;
      try {
        const startMonth = getFYStartMonth();
        const fy = getCurrentFY(startMonth);
        const plan = await getYearlyPlanByFY(DEFAULT_USER_ID, String(fy));
        if (plan) {
          monthlyIncome = (plan.annual_salary_in_hand + plan.expected_bonus) / 12;
        }
      } catch {
        // No plan
      }

      const totalBudget = budgets.reduce((sum, b) => sum + b.amount, 0);
      const result = calculateSplit({ items, categoryBudgets: budgetMap, totalBudget, monthlyIncome });

      const authoritative: SplitSnapshot = {
        ...result,
        unavoidableSpent: classification.unavoidable,
        discretionarySpent: classification.discretionary + classification.uncategorized,
        totalSpent: classification.total,
        unavoidablePct: classification.unavoidablePct,
        discretionaryPct: classification.discretionaryPct + classification.uncategorizedPct,
      };

      setSplit(authoritative);
    } catch {
      // DB not ready
    }
  }, [month, startDate, endDate]);

  useDataRefresh(loadData);

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await loadData();
            setRefreshing(false);
          }}
        />
      }
    >
      {split && split.totalSpent > 0 ? (
        <>
          {/* Donut chart */}
          <View className="mx-4 mt-3 mb-2 p-4 rounded-lg bg-card border border-border items-center">
            <DonutChart
              segments={[
                { label: "Unavoidable", value: split.unavoidableSpent, color: UNAVOIDABLE_COLOR },
                { label: "Discretionary", value: split.discretionarySpent, color: DISCRETIONARY_COLOR },
              ]}
              centerValue={`${split.unavoidablePct}%`}
              centerLabel="Unavoidable"
              onSegmentPress={(index) => {
                const y = index === 0 ? sectionY.current.unavoidable : sectionY.current.discretionary;
                scrollRef.current?.scrollTo({ y, animated: true });
              }}
            />
          </View>

          {/* Summary metrics */}
          <View className="mx-4 mb-2 p-4 rounded-lg bg-card border border-border">
            <Pressable
              onPress={() => router.push({ pathname: "/budget/transactions" as never, params: { filterMonth: month, filterAvoidability: "unavoidable", title: "Unavoidable Expenses" } })}
              className="flex-row items-center justify-between mb-3"
            >
              <View className="flex-row items-center">
                <View className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: UNAVOIDABLE_COLOR }} />
                <Text className="text-sm text-foreground">Unavoidable</Text>
              </View>
              <View className="flex-row items-center">
                <View className="items-end">
                  <Text className="text-sm font-semibold text-foreground">
                    {formatAmount(split.unavoidableSpent)}
                  </Text>
                  <Text className="text-xs text-faint-foreground">of {formatAmount(split.unavoidableBudget)} budget</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} style={{ marginLeft: 6 }} />
              </View>
            </Pressable>

            <Pressable
              onPress={() => router.push({ pathname: "/budget/transactions" as never, params: { filterMonth: month, filterAvoidability: "avoidable", title: "Discretionary Expenses" } })}
              className="flex-row items-center justify-between mb-3"
            >
              <View className="flex-row items-center">
                <View className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: DISCRETIONARY_COLOR }} />
                <Text className="text-sm text-foreground">Discretionary</Text>
              </View>
              <View className="flex-row items-center">
                <View className="items-end">
                  <Text className="text-sm font-semibold text-foreground">
                    {formatAmount(split.discretionarySpent)}
                  </Text>
                  <Text className="text-xs text-faint-foreground">of {formatAmount(split.discretionaryBudget)} budget</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} style={{ marginLeft: 6 }} />
              </View>
            </Pressable>

            <View className="h-[1px] bg-border mb-3" />

            <View className="flex-row justify-between">
              <View>
                <Text className="text-xs text-faint-foreground">Unavoidable baseline</Text>
                <Text className="text-sm font-semibold text-foreground">
                  {formatAmount(split.unavoidableBudget)}/mo
                </Text>
              </View>
              <View className="items-center">
                <Text className="text-xs text-faint-foreground">Discretionary left</Text>
                <Text
                  className="text-sm font-semibold"
                  style={{
                    color:
                      split.discretionaryBudget - split.discretionarySpent >= 0
                        ? StatusColors[colorScheme].success
                        : StatusColors[colorScheme].danger,
                  }}
                >
                  {formatAmount(Math.max(split.discretionaryBudget - split.discretionarySpent, 0))}
                </Text>
              </View>
              {split.maxPossibleSavings !== null && (
                <View className="items-end">
                  <Text className="text-xs text-faint-foreground">Max savings</Text>
                  <Text className="text-sm font-semibold text-success">
                    {formatAmount(Math.max(Math.round(split.maxPossibleSavings), 0))}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Unavoidable categories */}
          <View
            className="mx-4 mb-2 p-4 rounded-lg bg-card border border-border"
            onLayout={(e) => { sectionY.current.unavoidable = e.nativeEvent.layout.y; }}
          >
            <View className="flex-row items-center mb-3">
              <Ionicons name="lock-closed-outline" size={16} color={UNAVOIDABLE_COLOR} />
              <Text className="text-sm font-semibold text-foreground ml-2">
                Unavoidable ({split.unavoidableCategories.length})
              </Text>
            </View>
            {split.unavoidableCategories.map((cat) => (
              <CategoryRow key={cat.categoryId} name={cat.name} spent={cat.spent} budget={cat.budget} color={UNAVOIDABLE_COLOR} />
            ))}
            {split.unavoidableCategories.length === 0 && (
              <Text className="text-xs text-faint-foreground">No unavoidable categories with spending</Text>
            )}
          </View>

          {/* Discretionary categories */}
          <View
            className="mx-4 mb-4 p-4 rounded-lg bg-card border border-border"
            onLayout={(e) => { sectionY.current.discretionary = e.nativeEvent.layout.y; }}
          >
            <View className="flex-row items-center mb-3">
              <Ionicons name="pricetag-outline" size={16} color={DISCRETIONARY_COLOR} />
              <Text className="text-sm font-semibold text-foreground ml-2">
                Discretionary ({split.discretionaryCategories.length})
              </Text>
            </View>
            {split.discretionaryCategories.map((cat) => (
              <CategoryRow key={cat.categoryId} name={cat.name} spent={cat.spent} budget={cat.budget} color={DISCRETIONARY_COLOR} />
            ))}
            {split.discretionaryCategories.length === 0 && (
              <Text className="text-xs text-faint-foreground">No discretionary categories with spending</Text>
            )}
          </View>
        </>
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 80 }}>
          <Ionicons name="pie-chart-outline" size={48} color={colors.textSecondary} />
          <Text className="text-lg font-medium text-foreground mt-4">
            No spending data
          </Text>
          <Text className="text-sm text-muted-foreground mt-1 text-center px-8">
            Start adding expenses to see your unavoidable vs discretionary classification
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function CategoryRow({ name, spent, budget, color }: { name: string; spent: number; budget: number; color: string }) {
  const pct = budget > 0 ? spent / budget : 0;
  return (
    <View className="mb-3 last:mb-0">
      <View className="flex-row justify-between mb-1">
        <Text className="text-sm text-foreground flex-1" numberOfLines={1}>
          {name}
        </Text>
        <Text className="text-sm font-medium text-foreground ml-2">
          {formatAmount(spent)}
        </Text>
        {budget > 0 && <Text className="text-xs text-faint-foreground ml-1">/ {formatAmount(budget)}</Text>}
      </View>
      {budget > 0 && <ProgressBar value={pct} color={color} height={6} animated={false} />}
    </View>
  );
}
