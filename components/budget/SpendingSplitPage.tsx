import { useState, useCallback, useRef } from "react";

import { View, ScrollView, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, ProgressBar, Text } from "@/components/ui";
import { AnimatedNumber, Appear, Chevron, Collapse, PressableScale } from "@/components/motion";
import { DonutChart } from "@/components/charts/DonutChart";
import { getCategories } from "@/services/category";
import { getBudgetsForMonth } from "@/services/budget";
import { getExpenseTotalsByCategoryAndClassification } from "@/services/expense";
import { getYearlyPlanByFY } from "@/services/yearly-plan";
import { formatAmount } from "@/utils/expense-validation";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { calculateSplit } from "@/utils/unavoidable-split";
import type { SplitBucket, SplitBucketDetail, SplitSnapshot } from "@/utils/unavoidable-split";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { getCurrentFY } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { BRAND_COLOR, STATUS_COLORS } from "@/constants/semantic-colors";

const UNAVOIDABLE_COLOR = BRAND_COLOR;
const DISCRETIONARY_COLOR = STATUS_COLORS.warning;

interface BucketMeta {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** The /budget/transactions filter for this bucket. */
  avoidability: "unavoidable" | "avoidable" | "unclassified";
}

const BUCKETS: Record<SplitBucket, BucketMeta> = {
  unavoidable: {
    title: "Unavoidable",
    subtitle: "Bills and needs you have to pay",
    icon: "lock-closed-outline",
    avoidability: "unavoidable",
  },
  discretionary: {
    title: "Discretionary",
    subtitle: "Choices you could cut back on",
    icon: "pricetag-outline",
    avoidability: "avoidable",
  },
  unclassified: {
    title: "Not classified yet",
    subtitle: "Open one and mark it unavoidable or discretionary",
    icon: "help-circle-outline",
    avoidability: "unclassified",
  },
};

const ORDER: SplitBucket[] = ["unavoidable", "discretionary", "unclassified"];

interface SpendingSplitPageProps {
  month: string;
}

/**
 * The unavoidable / discretionary spending breakdown for one month.
 *
 * The single implementation, rendered by the Budget tab's swipe-pager and by
 * app/budget/spending-split.tsx. The month arrives as a prop because the two callers source it
 * differently: the pager takes the Budget tab's current month, the route owns a PeriodNavigator.
 *
 * Three groups by each expense's own flag (unavoidable / discretionary / not classified yet), so
 * every amount here adds up to the month's spending and each group's list matches the number on
 * it. Tap a group to see its categories; tap a category for its transactions in that group.
 */
export function SpendingSplitPage({ month }: SpendingSplitPageProps) {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [split, setSplit] = useState<SplitSnapshot | null>(null);
  const [open, setOpen] = useState<SplitBucket | null>("discretionary");
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Record<SplitBucket, number>>({ unavoidable: 0, discretionary: 0, unclassified: 0 });

  const colorOf = (bucket: SplitBucket) =>
    bucket === "unavoidable" ? UNAVOIDABLE_COLOR : bucket === "discretionary" ? DISCRETIONARY_COLOR : theme.mutedForeground;

  const loadData = useCallback(async () => {
    const { startDate, endDate } = getMonthDateRange(month);
    try {
      const [categories, budgets, actuals] = await Promise.all([
        getCategories(DEFAULT_USER_ID),
        getBudgetsForMonth(DEFAULT_USER_ID, month),
        getExpenseTotalsByCategoryAndClassification(DEFAULT_USER_ID, startDate, endDate),
      ]);

      // Income from the plan of the financial year this month belongs to (not today's).
      let monthlyIncome: number | null = null;
      try {
        const [y, m] = month.split("-").map(Number);
        const fy = getCurrentFY(getFYStartMonth(), new Date(y, m - 1, 1));
        const plan = await getYearlyPlanByFY(DEFAULT_USER_ID, String(fy));
        if (plan) monthlyIncome = (plan.annual_salary_in_hand + plan.expected_bonus) / 12;
      } catch {
        // No plan
      }

      setSplit(
        calculateSplit({
          items: actuals.map((a) => ({
            categoryId: a.category_id,
            spent: a.total,
            bucket: a.is_unavoidable === 1 ? "unavoidable" : a.is_unavoidable === 0 ? "discretionary" : "unclassified",
          })),
          categories: categories.map((c) => ({ id: c.id, name: c.name, isUnavoidable: c.is_unavoidable === 1 })),
          categoryBudgets: new Map(budgets.map((b) => [b.category_id, b.amount])),
          monthlyIncome,
        }),
      );
    } catch {
      // DB not ready
    }
  }, [month]);

  useDataRefresh(loadData);

  const openTransactions = (bucket: SplitBucket, categoryId?: string | null, name?: string) => {
    const meta = BUCKETS[bucket];
    router.push({
      pathname: "/budget/transactions",
      params: {
        filterMonth: month,
        filterAvoidability: meta.avoidability,
        ...(categoryId !== undefined ? { categoryId: categoryId ?? "none" } : {}),
        title: name ? `${name} · ${meta.title}` : meta.title,
      },
    });
  };

  const focusBucket = (bucket: SplitBucket) => {
    setOpen(bucket);
    scrollRef.current?.scrollTo({ y: sectionY.current[bucket], animated: true });
  };

  const visible = split ? ORDER.filter((b) => b !== "unclassified" || split.unclassified.spent > 0) : [];
  const discretionaryLeft = split ? split.discretionary.budget - split.discretionary.spent : 0;

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
          {/* Donut + legend */}
          <Appear index={0}>
            <Card className="mx-4 mt-3 mb-2">
              <View className="flex-row items-center">
                <DonutChart
                  size={136}
                  segments={visible.map((b) => ({ label: BUCKETS[b].title, value: split[b].spent, color: colorOf(b) }))}
                  centerValue={`${split.unavoidable.pct}%`}
                  centerLabel="Unavoidable"
                  // The legend is the column beside the ring; the chart's own label row under it
                  // made the chart full-width and pushed that column off the card.
                  showLegend={false}
                  separatorColor={theme.card}
                />
                <View className="flex-1 ml-4">
                  <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Spent this month</Text>
                  <AnimatedNumber value={split.totalSpent} className="text-xl font-bold text-foreground mt-0.5 mb-2" />
                  {visible.map((b) => (
                    <Pressable
                      key={b}
                      onPress={() => focusBucket(b)}
                      className="flex-row items-center py-1"
                      accessibilityRole="button"
                      accessibilityLabel={`${BUCKETS[b].title}: ${formatAmount(split[b].spent)}, ${split[b].pct} percent`}
                    >
                      <View className="w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: colorOf(b) }} />
                      <Text className="text-xs text-foreground flex-1" numberOfLines={1}>{BUCKETS[b].title}</Text>
                      <Text className="text-xs font-semibold text-foreground">{split[b].pct}%</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </Card>
          </Appear>

          {/* What it means */}
          {(split.discretionary.budget > 0 || split.maxPossibleSavings !== null) && (
            <Appear index={1}>
              <Card className="mx-4 mb-2">
                <View className="flex-row">
                  {split.discretionary.budget > 0 && (
                    <View className="flex-1">
                      <Text className="text-xs text-faint-foreground">
                        {discretionaryLeft >= 0 ? "Discretionary left" : "Discretionary over"}
                      </Text>
                      <Text
                        className="text-base font-semibold"
                        style={{ color: discretionaryLeft >= 0 ? theme.success : theme.danger }}
                      >
                        {formatAmount(Math.abs(discretionaryLeft))}
                      </Text>
                      <Text className="text-xs text-faint-foreground">of {formatAmount(split.discretionary.budget)} budget</Text>
                    </View>
                  )}
                  {split.maxPossibleSavings !== null && (
                    <View className={split.discretionary.budget > 0 ? "flex-1 items-end" : "flex-1"}>
                      <Text className="text-xs text-faint-foreground">Could save up to</Text>
                      <Text
                        className="text-base font-semibold"
                        style={{ color: split.maxPossibleSavings >= 0 ? theme.success : theme.danger }}
                      >
                        {formatAmount(split.maxPossibleSavings)}
                      </Text>
                      <Text className="text-xs text-faint-foreground">income minus unavoidable</Text>
                    </View>
                  )}
                </View>
              </Card>
            </Appear>
          )}

          {visible.map((b, i) => (
            <View
              key={b}
              onLayout={(e) => {
                sectionY.current[b] = e.nativeEvent.layout.y;
              }}
            >
              <Appear index={i + 2}>
                <BucketCard
                  meta={BUCKETS[b]}
                  detail={split[b]}
                  color={colorOf(b)}
                  open={open === b}
                  onToggle={() => setOpen((cur) => (cur === b ? null : b))}
                  onCategory={(categoryId, name) => openTransactions(b, categoryId, name)}
                  onAll={() => openTransactions(b)}
                  chevronColor={colors.textSecondary}
                />
              </Appear>
            </View>
          ))}
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

function BucketCard({
  meta,
  detail,
  color,
  open,
  onToggle,
  onCategory,
  onAll,
  chevronColor,
}: {
  meta: BucketMeta;
  detail: SplitBucketDetail;
  color: string;
  open: boolean;
  onToggle: () => void;
  onCategory: (categoryId: string | null, name: string) => void;
  onAll: () => void;
  chevronColor: string;
}) {
  const overBudget = detail.budget > 0 && detail.spent > detail.budget;
  return (
    <Card className="mx-4 mb-2">
      <PressableScale onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View className="flex-row items-center">
          <View className="w-9 h-9 rounded-full items-center justify-center mr-3 overflow-hidden">
            <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: color, opacity: 0.12 }} />
            <Ionicons name={meta.icon} size={17} color={color} />
          </View>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-foreground">{meta.title}</Text>
            <Text className="text-xs text-faint-foreground" numberOfLines={1}>{meta.subtitle}</Text>
          </View>
          <View className="items-end ml-2">
            <AnimatedNumber value={detail.spent} className="text-base font-bold text-foreground" />
            <Text className="text-xs text-faint-foreground">
              {detail.pct}% of spend
            </Text>
          </View>
          <View className="ml-2">
            <Chevron open={open} color={chevronColor} />
          </View>
        </View>
        {detail.budget > 0 && (
          <View className="mt-3">
            <ProgressBar value={detail.spent / detail.budget} color={overBudget ? STATUS_COLORS.error : color} height={6} />
            <Text className="text-xs text-faint-foreground mt-1">
              {formatAmount(detail.spent)} of {formatAmount(detail.budget)} budget
              {overBudget ? ` · ${formatAmount(detail.spent - detail.budget)} over` : ""}
            </Text>
          </View>
        )}
      </PressableScale>

      <Collapse open={open}>
        <View className="mt-3 pt-3 border-t border-border">
          {detail.categories.map((cat, i) => {
            const catOver = cat.budget > 0 && cat.spent > cat.budget;
            return (
              <Pressable
                key={cat.categoryId ?? "none"}
                onPress={() => cat.spent > 0 && onCategory(cat.categoryId, cat.name)}
                disabled={cat.spent <= 0}
                className="py-2"
                accessibilityRole="button"
              >
                <View className="flex-row items-center">
                  <Text className="text-sm text-foreground flex-1" numberOfLines={1}>{cat.name}</Text>
                  <Text className="text-sm font-medium text-foreground ml-2">
                    {cat.spent > 0 ? formatAmount(cat.spent) : "Nothing yet"}
                  </Text>
                  {cat.budget > 0 && (
                    <Text className="text-xs text-faint-foreground ml-1">/ {formatAmount(cat.budget)}</Text>
                  )}
                  {cat.spent > 0 && (
                    <Ionicons name="chevron-forward" size={13} color={chevronColor} style={{ marginLeft: 4 }} />
                  )}
                </View>
                {cat.budget > 0 && open && (
                  <ProgressBar
                    value={cat.spent / cat.budget}
                    color={catOver ? STATUS_COLORS.error : color}
                    height={5}
                    delay={i * 40}
                    className="mt-1.5"
                  />
                )}
              </Pressable>
            );
          })}
          <Pressable onPress={onAll} className="flex-row items-center justify-center pt-2 mt-1" accessibilityRole="button">
            <Text className="text-sm font-semibold" style={{ color }}>
              {meta.avoidability === "unclassified" ? "Classify these" : "See all transactions"}
            </Text>
            <Ionicons name="arrow-forward" size={14} color={color} style={{ marginLeft: 4 }} />
          </Pressable>
        </View>
      </Collapse>
    </Card>
  );
}
