import { useState, useCallback, useRef } from "react";
import { View, ScrollView } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { getYearlyPlans, getBucketsByFY } from "@/services/yearly-plan";
import { getExpenseTotal } from "@/services/expense";
import { getSavingsSnapshot } from "@/services/savings-tracker";
import {
  getLifeMilestones,
  getCombinedMilestoneContributionsForFY,
  getTotalPlannedMilestonesForFY,
} from "@/services/life-milestone";
import { listAllLoans, getSchedule, getPrepayments } from "@/services/loan-accounts";
import { getCurrentFY, getFYRange, getFYLabel } from "@/utils/fiscal-year";
import { getDataVersion } from "@/services/settings";
import { toIsoDate as formatDate } from "@/utils/date";
import { getFYStartMonth } from "@/services/settings";
import { formatAmount, formatCompact } from "@/utils/format";
import { calculateYoYComparison } from "@/utils/yoy-comparison";
import type { YoYComparison, YoYCategory, FYData } from "@/utils/yoy-comparison";
import { DEFAULT_USER_ID } from "@/constants/app";
import { StatusColors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

export default function YoYComparisonScreen() {
  const { colorScheme, colors } = useColorScheme();
  const [comparison, setComparison] = useState<YoYComparison | null>(null);
  const [previousFYLabel, setPreviousFYLabel] = useState("");
  const [currentFYLabel, setCurrentFYLabel] = useState("");
  const [noData, setNoData] = useState(false);
  const [loading, setLoading] = useState(true);
  const lastVersionRef = useRef<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, []),
  );

  async function loadData() {
    const currentVersion = getDataVersion();
    if (lastVersionRef.current === currentVersion) return;
    lastVersionRef.current = currentVersion;
    setLoading(true);
    try {
      const startMonth = getFYStartMonth();
      const currentFY = getCurrentFY(startMonth);
      const previousFY = currentFY - 1;

      const plans = await getYearlyPlans(DEFAULT_USER_ID);
      const matchFY = (fy: string, year: number) =>
        fy === String(year) || fy.startsWith(`${year}-`);
      const currentPlan = plans.find((p) => matchFY(p.financial_year, currentFY));
      const previousPlan = plans.find((p) => matchFY(p.financial_year, previousFY));

      if (!currentPlan || !previousPlan) {
        setNoData(true);
        return;
      }

      setPreviousFYLabel(getFYLabel(previousFY, startMonth));
      setCurrentFYLabel(getFYLabel(currentFY, startMonth));

      const prevRange = getFYRange(previousFY, startMonth);
      const currRange = getFYRange(currentFY, startMonth);

      const [
        prevExpenses,
        currExpenses,
        prevSnap,
        currSnap,
        prevBuckets,
        currBuckets,
        prevMilestonePlanned,
        currMilestonePlanned,
        allMilestones,
      ] = await Promise.all([
        getExpenseTotal(DEFAULT_USER_ID, formatDate(prevRange.start), formatDate(prevRange.end)),
        getExpenseTotal(DEFAULT_USER_ID, formatDate(currRange.start), formatDate(currRange.end)),
        getSavingsSnapshot(DEFAULT_USER_ID, previousFY),
        getSavingsSnapshot(DEFAULT_USER_ID, currentFY),
        getBucketsByFY(DEFAULT_USER_ID, String(previousFY)),
        getBucketsByFY(DEFAULT_USER_ID, String(currentFY)),
        getTotalPlannedMilestonesForFY(DEFAULT_USER_ID, String(previousFY)),
        getTotalPlannedMilestonesForFY(DEFAULT_USER_ID, String(currentFY)),
        getLifeMilestones(DEFAULT_USER_ID),
      ]);

      // Actuals: sum of ALL contributions dated within each FY across every
      // milestone (completed milestones count — their historical contributions
      // still happened during that FY).
      const allMilestoneIds = allMilestones.map((m) => m.id);
      const [prevMilestoneActual, currMilestoneActual] = await Promise.all([
        getCombinedMilestoneContributionsForFY(
          allMilestoneIds,
          formatDate(prevRange.start),
          formatDate(prevRange.end),
        ),
        getCombinedMilestoneContributionsForFY(
          allMilestoneIds,
          formatDate(currRange.start),
          formatDate(currRange.end),
        ),
      ]);

      // v17.5.1 — Loans & Debts: per-FY planned (scheduled EMIs) vs actual
      // (paid EMIs + recorded prepayments). INR-only to keep one currency in the chart.
      const allLoans = await listAllLoans(DEFAULT_USER_ID);
      const inrLoans = allLoans.filter((l) => l.currency === "INR");
      const prevStartStr = formatDate(prevRange.start);
      const prevEndStr = formatDate(prevRange.end);
      const currStartStr = formatDate(currRange.start);
      const currEndStr = formatDate(currRange.end);

      // Fetch all schedules and prepayments in parallel instead of serially per loan.
      const loanData = await Promise.all(
        inrLoans.map((loan) =>
          Promise.all([getSchedule(loan.id), getPrepayments(loan.id)])
        )
      );

      let prevPlannedLoan = 0,
        prevActualLoan = 0,
        currPlannedLoan = 0,
        currActualLoan = 0;
      for (const [schedule, prepayments] of loanData) {
        for (const e of schedule) {
          if (e.due_date >= prevStartStr && e.due_date <= prevEndStr) {
            prevPlannedLoan += e.emi_amount;
            if (e.status === "paid" || e.status === "prepaid") prevActualLoan += e.emi_amount;
          }
          if (e.due_date >= currStartStr && e.due_date <= currEndStr) {
            currPlannedLoan += e.emi_amount;
            if (e.status === "paid" || e.status === "prepaid") currActualLoan += e.emi_amount;
          }
        }
        for (const p of prepayments) {
          if (p.prepayment_date >= prevStartStr && p.prepayment_date <= prevEndStr) {
            prevPlannedLoan += p.amount;
            prevActualLoan += p.amount;
          }
          if (p.prepayment_date >= currStartStr && p.prepayment_date <= currEndStr) {
            currPlannedLoan += p.amount;
            currActualLoan += p.amount;
          }
        }
      }

      const prevData: FYData = {
        financialYear: String(previousFY),
        annualIncome: previousPlan.annual_salary_in_hand + previousPlan.expected_bonus,
        totalPlannedExpenses: previousPlan.total_planned_expenses,
        totalActualExpenses: prevExpenses,
        actualSavingsRatePct: prevSnap?.actualSavingsRatePct ?? 0,
        totalPlannedInvestments: previousPlan.total_planned_investments,
        totalActualInvestments: prevBuckets.reduce((s, b) => s + b.current_contributed, 0),
        totalPlannedMilestones: prevMilestonePlanned,
        totalActualMilestones: prevMilestoneActual,
        totalPlannedLoanOutflow: prevPlannedLoan,
        totalActualLoanOutflow: prevActualLoan,
      };

      const currData: FYData = {
        financialYear: String(currentFY),
        annualIncome: currentPlan.annual_salary_in_hand + currentPlan.expected_bonus,
        totalPlannedExpenses: currentPlan.total_planned_expenses,
        totalActualExpenses: currExpenses,
        actualSavingsRatePct: currSnap?.actualSavingsRatePct ?? 0,
        totalPlannedInvestments: currentPlan.total_planned_investments,
        totalActualInvestments: currBuckets.reduce((s, b) => s + b.current_contributed, 0),
        totalPlannedMilestones: currMilestonePlanned,
        totalActualMilestones: currMilestoneActual,
        totalPlannedLoanOutflow: currPlannedLoan,
        totalActualLoanOutflow: currActualLoan,
      };

      setComparison(calculateYoYComparison(prevData, currData));
      setNoData(false);
    } catch {
      setNoData(true);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState icon="git-compare-outline" message="Loading comparison…" />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {noData ? (
          <View className="flex-1 items-center justify-center py-20">
            <Ionicons name="git-compare-outline" size={48} color={colors.textSecondary} />
            <Text className="text-lg font-medium text-foreground mt-4">
              Not enough data
            </Text>
            <Text className="text-sm text-muted-foreground mt-1 text-center px-8">
              Year-over-year comparison requires plans for at least 2 financial years.
            </Text>
          </View>
        ) : comparison ? (
          <View className="px-4 py-3">
            {/* Overall trend header */}
            <View
              className="mb-4 p-4 rounded-xl"
              style={{
                backgroundColor:
                  comparison.overallTrend === "improved"
                    ? StatusColors[colorScheme].successBg
                    : comparison.overallTrend === "declined"
                      ? StatusColors[colorScheme].dangerBg
                      : StatusColors[colorScheme].warningBg,
              }}
            >
              <View className="flex-row items-center">
                <Ionicons
                  name={
                    comparison.overallTrend === "improved"
                      ? "trending-up"
                      : comparison.overallTrend === "declined"
                        ? "trending-down"
                        : "swap-horizontal"
                  }
                  size={24}
                  color={
                    comparison.overallTrend === "improved"
                      ? StatusColors[colorScheme].success
                      : comparison.overallTrend === "declined"
                        ? StatusColors[colorScheme].danger
                        : StatusColors[colorScheme].warning
                  }
                />
                <View className="ml-3">
                  <Text className="text-lg font-bold text-foreground">
                    {comparison.overallTrend === "improved"
                      ? "Financial Progress"
                      : comparison.overallTrend === "declined"
                        ? "Areas Need Attention"
                        : "Mixed Results"}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {previousFYLabel} vs {currentFYLabel}
                  </Text>
                </View>
              </View>
            </View>

            {/* Category comparison cards */}
            {comparison.categories.map((cat) => (
              <CategoryCard
                key={cat.label}
                category={cat}
                prevLabel={previousFYLabel}
                currLabel={currentFYLabel}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

function CategoryCard({
  category,
  prevLabel,
  currLabel,
}: {
  category: YoYCategory;
  prevLabel: string;
  currLabel: string;
}) {
  const { colorScheme } = useColorScheme();
  const c = category;

  const fmt = (v: number) =>
    c.isAmount ? formatAmount(Math.round(v)) : `${v.toFixed(1)}%`;

  const plannedChange = c.currPlanned - c.prevPlanned;
  const actualChange = c.currActual - c.prevActual;

  const plannedChangePct = c.prevPlanned !== 0
    ? Math.round((plannedChange / c.prevPlanned) * 1000) / 10
    : 0;
  const actualChangePct = c.prevActual !== 0
    ? Math.round((actualChange / c.prevActual) * 1000) / 10
    : 0;

  const actualVsPlan = (actual: number, planned: number) => {
    if (planned === 0) return null;
    const diff = actual - planned;
    // v17.5.2 — gap direction can differ from row direction (Loans & Debts).
    const gapHigherIsBetter = c.gapActualHigherIsBetter ?? !c.lowerIsBetter;
    const isGood = gapHigherIsBetter ? diff >= 0 : diff <= 0;
    return { diff, isGood, pct: Math.round((diff / planned) * 1000) / 10 };
  };

  const prevGap = actualVsPlan(c.prevActual, c.prevPlanned);
  const currGap = actualVsPlan(c.currActual, c.currPlanned);

  const icon: keyof typeof Ionicons.glyphMap =
    c.label === "Income" ? "wallet-outline"
      : c.label === "Expenses" ? "cart-outline"
        : c.label === "Investments" ? "trending-up-outline"
          : c.label === "Milestones" ? "flag-outline"
            : c.label === "Loans & Debts" ? "card-outline"
              : "stats-chart-outline";

  return (
    <Card className="mb-3">
      {/* Category header */}
      <View className="flex-row items-center mb-3">
        <Ionicons name={icon} size={16} color={StatusColors[colorScheme].muted} style={{ marginRight: 6 }} />
        <Text className="text-sm font-bold text-foreground">
          {c.label}
        </Text>
      </View>

      {/* Column headers */}
      <View className="flex-row mb-1.5">
        <View className="flex-1" />
        <Text className="w-20 text-label font-semibold text-faint-foreground text-right">
          {prevLabel}
        </Text>
        <Text className="w-20 text-label font-semibold text-faint-foreground text-right">
          {currLabel}
        </Text>
        <Text className="w-16 text-label font-semibold text-faint-foreground text-right">
          Change
        </Text>
      </View>

      {/* Planned row */}
      <View className="flex-row items-center py-1.5 border-b border-border">
        <Text className="flex-1 text-xs text-muted-foreground">
          Planned
        </Text>
        <Text className="w-20 text-xs text-muted-foreground text-right">
          {fmt(c.prevPlanned)}
        </Text>
        <Text className="w-20 text-xs font-medium text-foreground text-right">
          {fmt(c.currPlanned)}
        </Text>
        <ChangeBadge value={plannedChangePct} lowerIsBetter={c.lowerIsBetter} />
      </View>

      {/* Actual row */}
      <View className="flex-row items-center py-1.5">
        <Text className="flex-1 text-xs font-medium text-foreground">
          Actual
        </Text>
        <Text className="w-20 text-xs text-muted-foreground text-right">
          {fmt(c.prevActual)}
        </Text>
        <Text className="w-20 text-xs font-bold text-foreground text-right">
          {fmt(c.currActual)}
        </Text>
        <ChangeBadge value={actualChangePct} lowerIsBetter={c.lowerIsBetter} />
      </View>

      {/* Plan vs Actual gap */}
      {currGap && c.label !== "Income" && (
        <View
          className="mt-2 px-3 py-1.5 rounded-lg flex-row items-center justify-between"
          style={{
            backgroundColor: currGap.isGood
              ? StatusColors[colorScheme].successBg
              : StatusColors[colorScheme].dangerBg,
          }}
        >
          <Text className="text-label text-muted-foreground">
            Plan vs Actual ({currLabel})
          </Text>
          <Text
            className="text-label font-bold"
            style={{
              color: currGap.isGood
                ? StatusColors[colorScheme].success
                : StatusColors[colorScheme].danger,
            }}
          >
            {currGap.diff > 0 ? "+" : ""}{c.isAmount ? formatCompact(currGap.diff) : `${currGap.diff.toFixed(1)}pp`}
            {" "}({currGap.pct > 0 ? "+" : ""}{currGap.pct}%)
          </Text>
        </View>
      )}
    </Card>
  );
}

function ChangeBadge({ value, lowerIsBetter }: { value: number; lowerIsBetter: boolean }) {
  const { colorScheme } = useColorScheme();
  if (value === 0) return <View className="w-16" />;

  const isGood = lowerIsBetter ? value < 0 : value > 0;
  const color = isGood ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger;

  return (
    <View className="w-16 flex-row items-center justify-end">
      <View
        className="flex-row items-center px-1.5 py-0.5 rounded-full"
        style={{ backgroundColor: color + "14" }}
      >
        <Ionicons name={value > 0 ? "arrow-up" : "arrow-down"} size={8} color={color} />
        <Text className="text-label font-medium ml-0.5" style={{ color }}>
          {Math.abs(value)}%
        </Text>
      </View>
    </View>
  );
}

