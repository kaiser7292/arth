import { useState, useCallback, useMemo } from "react";
import { View, ScrollView, Pressable, KeyboardAvoidingView } from "react-native";
import { useLocalSearchParams, useFocusEffect, useRouter } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, DateInput, FAB, Input, LoadingState, MetricRow, ProgressBar, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  getLifeMilestoneById,
  getMilestoneContributions,
  getMilestoneContributionForFY,
  getMilestoneTotalMonths,
  createMilestoneContribution,
  updateMilestoneContribution,
  deleteMilestoneContribution,
  getCombinedMilestoneContributions,
  getCombinedMilestoneActualForFY,
  getMilestoneMonthsRemaining,
} from "@/services/life-milestone";
import type {
  LifeMilestone,
  MilestoneContribution,
} from "@/services/life-milestone";
import {
  getLinkedBucketsForMilestone,
  getLinkedBucketContributionsTotal,
  getAllActiveBuckets,
  setBucketMilestoneLink,
} from "@/services/yearly-plan";
import type { InvestmentBucket } from "@/services/yearly-plan";
import { getLifeMilestones } from "@/services/life-milestone";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/expense-validation";
import { getCurrentFY, getFYRange, getFYLabel, formatLocalDate } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";


import { useTheme } from "@/hooks/use-theme";

export default function MilestoneDetailScreen() {
  const router = useRouter();
  const { milestoneId } = useLocalSearchParams<{ milestoneId: string }>();
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();

  const startMonth = getFYStartMonth();
  const currentFY = getCurrentFY(startMonth);

  const [milestone, setMilestone] = useState<LifeMilestone | null>(null);
  const [contributions, setContributions] = useState<
    MilestoneContribution[]
  >([]);
  const [combinedContributions, setCombinedContributions] = useState<
    { amount: number; date: string; source: string; label: string | null }[]
  >([]);
  const [linkedBuckets, setLinkedBuckets] = useState<InvestmentBucket[]>([]);
  const [linkedBucketTotal, setLinkedBucketTotal] = useState(0);
  // Every active bucket, for the "which buckets feed this milestone" picker,
  // plus milestone names so a bucket owned by another milestone can say so.
  const [allBuckets, setAllBuckets] = useState<InvestmentBucket[]>([]);
  const [milestoneNames, setMilestoneNames] = useState<Map<string, string>>(new Map());
  const [showBucketPicker, setShowBucketPicker] = useState(false);
  interface FYBreakdownRow {
    fy: number;
    label: string;
    originalPlanned: number;
    planned: number;        // adjusted for current/future FYs
    actual: number;
    isCurrent: boolean;
    isPast: boolean;
    surplusCarriedIn: number; // how much surplus from past FYs reduced this target
  }
  const [fyBreakdown, setFyBreakdown] = useState<FYBreakdownRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingContrib, setEditingContrib] = useState<string | null>(null);

  const [contribAmount, setContribAmount] = useState("");
  const [contribDate, setContribDate] = useState(
    new Date().toISOString().split("T")[0],
  );

  const loadData = useCallback(async () => {
    if (!milestoneId) return;
    try {
      const [m, c, cc, lb, lbt, ab, allMs] = await Promise.all([
        getLifeMilestoneById(milestoneId),
        getMilestoneContributions(milestoneId),
        getCombinedMilestoneContributions(milestoneId),
        getLinkedBucketsForMilestone(milestoneId),
        getLinkedBucketContributionsTotal(milestoneId),
        getAllActiveBuckets(DEFAULT_USER_ID),
        getLifeMilestones(DEFAULT_USER_ID),
      ]);
      setMilestone(m);
      setContributions(c);
      setCombinedContributions(cc);
      setLinkedBuckets(lb);
      setLinkedBucketTotal(lbt);
      setAllBuckets(ab);
      setMilestoneNames(new Map(allMs.map((x) => [x.id, x.name])));

      if (m) {
        const sfy = m.start_financial_year ? parseInt(m.start_financial_year, 10) : currentFY;
        const totalMo = getMilestoneTotalMonths(m);
        const numFYs = Math.ceil(totalMo / 12) || 1;

        // First pass: fetch actuals and original planned for all FYs
        const rows: FYBreakdownRow[] = [];
        let cumulativePastActual = 0;
        let cumulativePastOriginalPlan = 0;

        for (let i = 0; i < numFYs; i++) {
          const fy = sfy + i;
          const originalPlanned = getMilestoneContributionForFY(m, String(fy));
          const { start, end } = getFYRange(fy, startMonth);
          const actual = await getCombinedMilestoneActualForFY(
            m.id,
            formatLocalDate(start),
            formatLocalDate(end),
          );
          const isPast = fy < currentFY;
          if (isPast) {
            cumulativePastActual += actual;
            cumulativePastOriginalPlan += originalPlanned;
          }
          rows.push({
            fy,
            label: getFYLabel(fy, startMonth),
            originalPlanned,
            planned: originalPlanned,
            actual,
            isCurrent: fy === currentFY,
            isPast,
            surplusCarriedIn: 0,
          });
        }

        // Second pass: adjust planned for current + future FYs based on what's left
        const surplusFromPast = Math.max(0, cumulativePastActual - cumulativePastOriginalPlan);
        const totalRemainingNeed = Math.max(0, m.target_amount - cumulativePastActual);
        const remainingFYCount = rows.filter((r) => !r.isPast).length;
        const adjustedPerFY = remainingFYCount > 0 ? Math.round(totalRemainingNeed / remainingFYCount) : 0;

        for (const row of rows) {
          if (!row.isPast) {
            row.planned = adjustedPerFY;
            row.surplusCarriedIn = surplusFromPast;
          }
        }

        setFyBreakdown(rows);
      }
    } catch {
      // DB not ready
    }
    setLoaded(true);
  }, [milestoneId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  // ─── Monthly Grouping ────────────────────────────────────

  // Buckets grouped under an FY heading, newest FY first. getAllActiveBuckets
  // already returns financial_year DESC, sort_order ASC, so a running group
  // preserves that order without re-sorting.
  const bucketsByFY = useMemo(() => {
    const groups: { fy: string; label: string; buckets: InvestmentBucket[] }[] = [];
    for (const b of allBuckets) {
      const fy = b.financial_year ?? "";
      const last = groups[groups.length - 1];
      if (last && last.fy === fy) {
        last.buckets.push(b);
      } else {
        const parsed = parseInt(fy, 10);
        groups.push({
          fy,
          label: Number.isFinite(parsed) ? getFYLabel(parsed, startMonth) : "No financial year",
          buckets: [b],
        });
      }
    }
    return groups;
  }, [allBuckets, startMonth]);

  const applyBucketLink = async (bucketId: string, link: boolean) => {
    if (!milestone) return;
    await setBucketMilestoneLink(bucketId, link ? milestone.id : null);
    await loadData();
  };

  const handleToggleBucketLink = (bucket: InvestmentBucket) => {
    if (!milestone) return;
    const owner = bucket.linked_milestone_id;

    if (owner === milestone.id) {
      applyBucketLink(bucket.id, false);
      return;
    }

    // linked_milestone_id is single-valued, so claiming a bucket that already
    // belongs to another milestone takes it away from that one. Never do that
    // silently -- the other milestone's progress drops the moment we do.
    if (owner) {
      const ownerName = milestoneNames.get(owner) ?? "another milestone";
      alert(
        "Move this bucket?",
        `"${bucket.name}" currently feeds ${ownerName}. A bucket can only feed one milestone, so linking it here will remove it from ${ownerName}.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Move", onPress: () => applyBucketLink(bucket.id, true) },
        ],
      );
      return;
    }

    applyBucketLink(bucket.id, true);
  };

  const monthlyHistoryByFY = useMemo(() => {
    const groups = new Map<string, { total: number; count: number }>();
    for (const c of combinedContributions) {
      const month = c.date.slice(0, 7);
      const existing = groups.get(month) ?? { total: 0, count: 0 };
      groups.set(month, {
        total: existing.total + c.amount,
        count: existing.count + 1,
      });
    }
    const months = Array.from(groups.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, data]) => ({
        month,
        label: formatMonthLabel(month),
        ...data,
      }));

    const fyGroups = new Map<number, typeof months>();
    for (const m of months) {
      const [y, mo] = m.month.split("-").map(Number);
      const fy = mo >= startMonth ? y : y - (startMonth === 1 ? 0 : 1);
      const list = fyGroups.get(fy) ?? [];
      list.push(m);
      fyGroups.set(fy, list);
    }
    return Array.from(fyGroups.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([fy, items]) => ({
        fy,
        label: getFYLabel(fy, startMonth),
        isCurrent: fy === currentFY,
        months: items,
        total: items.reduce((s, i) => s + i.total, 0),
      }));
  }, [combinedContributions, startMonth, currentFY]);

  const monthlyHistory = useMemo(
    () => monthlyHistoryByFY.flatMap((g) => g.months),
    [monthlyHistoryByFY],
  );

  // ─── Projection ──────────────────────────────────────────

  const projection = useMemo(() => {
    if (!milestone) return null;

    const remaining = Math.max(
      milestone.target_amount - milestone.current_saved,
      0,
    );

    if (remaining === 0) {
      return {
        isComplete: true,
        monthsToComplete: 0,
        projectedDate: null,
        avgMonthly: 0,
        monthlyNeeded: 0,
        monthsToTarget: null,
      };
    }

    // Months to the milestone's effective due date (target_date, or the
    // FY+duration plan's end month as a fallback), inclusive of the current
    // month — see services/life-milestone.ts:getMilestoneMonthsRemaining.
    const monthsToTarget = getMilestoneMonthsRemaining(milestone);
    const monthlyNeeded = monthsToTarget ? remaining / monthsToTarget : 0;

    // Average from all contributions (direct + linked buckets)
    const totalContributed = combinedContributions.reduce(
      (s, c) => s + c.amount,
      0,
    );
    const monthSpan = monthlyHistory.length;
    const avgMonthly = monthSpan > 0 ? totalContributed / monthSpan : 0;

    let monthsToComplete: number | null = null;
    let projectedDate: string | null = null;
    if (avgMonthly > 0) {
      monthsToComplete = Math.ceil(remaining / avgMonthly);
      const d = new Date();
      d.setMonth(d.getMonth() + monthsToComplete);
      projectedDate = formatLocalDate(d);
    }

    return {
      isComplete: false,
      monthsToComplete,
      projectedDate,
      avgMonthly,
      monthlyNeeded,
      monthsToTarget,
    };
  }, [milestone, combinedContributions, monthlyHistory]);

  // ─── Actions ─────────────────────────────────────────────

  const handleSaveContribution = async () => {
    if (!milestone) return;
    const amount = parseFloat(contribAmount);
    if (isNaN(amount) || amount <= 0) {
      alert("Invalid Amount", "Enter a valid amount.");
      return;
    }

    if (editingContrib) {
      await updateMilestoneContribution(editingContrib, milestone.id, {
        amount,
        date: contribDate,
      });
    } else {
      await createMilestoneContribution({
        life_milestone_id: milestone.id,
        month: contribDate.slice(0, 7),
        amount,
        date: contribDate,
      });
    }

    setContribAmount("");
    setContribDate(new Date().toISOString().split("T")[0]);
    setEditingContrib(null);
    setShowAddForm(false);
    await loadData();
  };

  const handleEditContribution = (c: MilestoneContribution) => {
    setEditingContrib(c.id);
    setContribAmount(String(c.amount));
    setContribDate(c.date);
    setShowAddForm(true);
  };

  const handleContributionLongPress = (c: MilestoneContribution) => {
    alert("Contribution", `${formatAmount(c.amount)} on ${c.date}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Edit",
        onPress: () => handleEditContribution(c),
      },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (!milestone) return;
          await deleteMilestoneContribution(c.id, milestone.id);
          await loadData();
        },
      },
    ]);
  };

  // ─── Render ──────────────────────────────────────────────

  if (!loaded) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Loading milestone..." icon="flag-outline" />
      </ScreenContainer>
    );
  }

  if (!milestone) {
    return (
      <ScreenContainer centered padTop={false}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.textSecondary} />
        <Text className="text-base font-medium text-foreground mt-4">
          Milestone not found
        </Text>
      </ScreenContainer>
    );
  }

  const remaining = Math.max(
    milestone.target_amount - milestone.current_saved,
    0,
  );
  const pct =
    milestone.target_amount > 0
      ? Math.min(
          (milestone.current_saved / milestone.target_amount) * 100,
          100,
        )
      : 0;
  const isComplete = milestone.is_completed === 1;

  return (
    <ScreenContainer padTop={false}>
      <KeyboardAvoidingView
        behavior="padding"
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 80 }}
        >
          <View className="px-4 py-4">
            {/* Header */}
            <Card className="mb-4">
              <View className="items-center py-2">
                <View
                  className="w-14 h-14 rounded-full items-center justify-center mb-2"
                  style={{
                    backgroundColor: isComplete
                      ? theme.alpha("success", 0.08)
                      : theme.alpha("primary", 0.08),
                  }}
                >
                  <Ionicons
                    name={isComplete ? "checkmark-circle" : "flag-outline"}
                    size={28}
                    color={isComplete ? theme.success : colors.blue}
                  />
                </View>
                <Text className="text-lg font-bold text-foreground">
                  {milestone.name}
                </Text>
                {milestone.target_date && (
                  <Text className="text-xs text-muted-foreground mt-1">
                    Target date: {milestone.target_date}
                  </Text>
                )}
                {isComplete && (
                  <View className="mt-2 px-3 py-1 rounded-full" style={{ backgroundColor: theme.alpha("success", 0.08) }}>
                    <Text className="text-xs font-medium text-success">
                      Completed!
                    </Text>
                  </View>
                )}
              </View>

              {/* Saved / Target / Left */}
              <View className="flex-row mt-3">
                <View className="flex-1">
                  <Text className="text-xs text-muted-foreground text-center">
                    Saved
                  </Text>
                  <Text className="text-base font-bold text-success text-center">
                    {formatAmount(milestone.current_saved)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-muted-foreground text-center">
                    Target
                  </Text>
                  <Text className="text-base font-bold text-foreground text-center">
                    {formatAmount(milestone.target_amount)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-muted-foreground text-center">
                    Left
                  </Text>
                  <Text className="text-base font-bold text-danger text-center">
                    {formatAmount(remaining)}
                  </Text>
                </View>
              </View>

              {/* Progress bar */}
              <View className="mt-3 h-3 rounded-full bg-border overflow-hidden">
                <View
                  className="h-3 rounded-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: isComplete ? theme.success : colors.blue,
                  }}
                />
              </View>
              <Text className="text-xs text-muted-foreground mt-1 text-right">
                {pct.toFixed(1)}% complete
              </Text>
            </Card>

            {/* Projection */}
            {projection && !projection.isComplete && (
              <Card title="Projection" className="mb-4">
                {projection.avgMonthly > 0 && (
                  <MetricRow
                    label="Avg Monthly Contribution"
                    value={formatAmount(projection.avgMonthly)}
                  />
                )}
                {projection.monthsToComplete != null && (
                  <MetricRow
                    label="At Current Pace"
                    value={`${projection.monthsToComplete} months`}
                  />
                )}
                {projection.projectedDate && (
                  <MetricRow
                    label="Projected Completion"
                    value={formatMonthLabel(
                      projection.projectedDate.slice(0, 7),
                    )}
                  />
                )}
                {projection.monthsToTarget != null &&
                  projection.monthsToTarget > 0 && (
                    <>
                      <View className="h-px bg-border my-1.5" />
                      <MetricRow
                        label="Months to Target Date"
                        value={String(projection.monthsToTarget)}
                      />
                      <MetricRow
                        label="Need per Month"
                        value={formatAmount(projection.monthlyNeeded)}
                        color={
                          projection.avgMonthly >= projection.monthlyNeeded
                            ? theme.success
                            : theme.danger
                        }
                      />
                    </>
                  )}

                {/* Pace indicator */}
                {projection.monthsToTarget != null &&
                  projection.monthsToTarget > 0 &&
                  projection.avgMonthly > 0 && (
                    <View
                      className="mt-2 flex-row items-center justify-center py-2 rounded-lg"
                      style={{
                        backgroundColor:
                          projection.avgMonthly >= projection.monthlyNeeded
                            ? theme.alpha("success", 0.08)
                            : theme.alpha("danger", 0.08),
                      }}
                    >
                      <Ionicons
                        name={
                          projection.avgMonthly >= projection.monthlyNeeded
                            ? "trending-up"
                            : "trending-down"
                        }
                        size={14}
                        color={
                          projection.avgMonthly >= projection.monthlyNeeded
                            ? theme.success
                            : theme.danger
                        }
                      />
                      <Text
                        className="text-xs font-medium ml-1"
                        style={{
                          color:
                            projection.avgMonthly >= projection.monthlyNeeded
                              ? theme.success
                              : theme.danger,
                        }}
                      >
                        {projection.avgMonthly >= projection.monthlyNeeded
                          ? "On pace for target date"
                          : "Behind pace for target date"}
                      </Text>
                    </View>
                  )}
              </Card>
            )}

            {/* Year-by-Year Breakdown */}
            {fyBreakdown.length > 1 && (
              <Card title="Year-by-Year Breakdown" className="mb-4">
                {fyBreakdown.map((row, i) => {
                  const isOverachieved = row.isPast && row.actual > row.originalPlanned;
                  const surplus = isOverachieved ? row.actual - row.originalPlanned : 0;
                  const isFullyCovered = !row.isPast && row.planned === 0;
                  const pctFY = row.planned > 0
                    ? Math.min(row.actual / row.planned, 1)
                    : (isFullyCovered ? 1 : 0);
                  const isAdjusted = !row.isPast && row.surplusCarriedIn > 0;

                  return (
                    <View
                      key={row.fy}
                      className={`py-2.5 ${i < fyBreakdown.length - 1 ? "border-b border-border" : ""}`}
                    >
                      {/* Row header */}
                      <View className="flex-row items-center justify-between mb-1.5">
                        <View className="flex-row items-center gap-x-2">
                          <Text className="text-sm font-medium text-foreground">
                            {row.label}
                          </Text>
                          {row.isCurrent && (
                            <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                              <Text className="text-label font-semibold" style={{ color: theme.primary }}>NOW</Text>
                            </View>
                          )}
                          {isOverachieved && (
                            <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: theme.alpha("success", 0.08) }}>
                              <Text className="text-label font-semibold" style={{ color: theme.success }}>Overachieved</Text>
                            </View>
                          )}
                          {isFullyCovered && (
                            <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: theme.alpha("success", 0.08) }}>
                              <Text className="text-label font-semibold" style={{ color: theme.success }}>Covered</Text>
                            </View>
                          )}
                        </View>
                        <Text className="text-xs text-muted-foreground">
                          <Text className="font-medium text-foreground">
                            {formatAmount(row.actual)}
                          </Text>
                          {" / "}
                          {isAdjusted || isFullyCovered ? (
                            <Text style={{ color: theme.primary }}>
                              {formatAmount(row.planned)}
                            </Text>
                          ) : formatAmount(row.originalPlanned)}
                        </Text>
                      </View>

                      {/* Progress bar */}
                      <ProgressBar value={(pctFY * 100) / 100} color={isOverachieved || isFullyCovered
                              ? theme.success
                              : row.isCurrent
                              ? theme.primary
                              : colors.textSecondary} height={8} animated={false} />

                      {/* Bar footer */}
                      <View className="flex-row items-center justify-between mt-1">
                        {isOverachieved ? (
                          <Text className="text-label" style={{ color: theme.success }}>
                            +{formatAmount(surplus)} ahead of original plan
                          </Text>
                        ) : isFullyCovered ? (
                          <Text className="text-label" style={{ color: theme.success }}>
                            Fully covered by surplus from earlier FYs
                          </Text>
                        ) : (
                          <Text className="text-label text-faint-foreground">
                            {row.planned > row.actual ? `${formatAmount(row.planned - row.actual)} left` : ""}
                          </Text>
                        )}
                        <Text className="text-label text-faint-foreground">
                          {(pctFY * 100).toFixed(0)}%
                        </Text>
                      </View>

                      {/* Adjustment explanation for current/future FYs */}
                      {isAdjusted && !isFullyCovered && (
                        <View
                          className="mt-2 px-3 py-2 flex-row items-start"
                          style={{
                            backgroundColor: theme.alpha("primary", 0.06),
                            borderLeftWidth: 2,
                            borderLeftColor: theme.primary,
                          }}
                        >
                          <Ionicons name="information-circle-outline" size={13} color={theme.primary} style={{ marginTop: 1, marginRight: 6 }} />
                          <Text className="text-label flex-1" style={{ color: theme.primary, lineHeight: 16 }}>
                            Target adjusted to {formatAmount(row.planned)} — originally {formatAmount(row.originalPlanned)}, reduced by the {formatAmount(row.surplusCarriedIn)} surplus saved ahead of plan in earlier FYs.
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })}

                {/* Footer rule */}
                {fyBreakdown.some((r) => !r.isPast && r.surplusCarriedIn > 0) && (
                  <View className="mt-2 pt-2 border-t border-border flex-row items-start">
                    <Ionicons name="lock-closed-outline" size={11} color={colors.textSecondary} style={{ marginTop: 2, marginRight: 5 }} />
                    <Text className="text-label text-faint-foreground flex-1" style={{ lineHeight: 15 }}>
                      Past FY targets are fixed at the original plan. The current FY target reflects what's actually remaining.
                    </Text>
                  </View>
                )}
              </Card>
            )}

            {/* Linked Investment Buckets */}
            <Card className="mb-4">
              <View className="flex-row items-center justify-between mb-3">
                <Text
                  className="text-label font-semibold tracking-wider uppercase text-muted-foreground"
                  accessibilityRole="header"
                >
                  Linked Investment Buckets
                </Text>
                <Pressable
                  onPress={() => setShowBucketPicker((v) => !v)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={
                    showBucketPicker ? "Close bucket picker" : "Manage linked investment buckets"
                  }
                >
                  <Text className="text-xs font-semibold" style={{ color: colors.blue }}>
                    {showBucketPicker ? "Done" : "Manage"}
                  </Text>
                </Pressable>
              </View>

              {showBucketPicker && (
                <View className="mb-3">
                  {bucketsByFY.length === 0 ? (
                    <Text className="text-xs text-muted-foreground py-2">
                      No investment buckets yet. Create one from Goals to Investment Buckets,
                      then link it here.
                    </Text>
                  ) : (
                    bucketsByFY.map((group) => (
                      <View key={group.fy || "none"} className="mb-2">
                        <Text className="text-label text-faint-foreground uppercase tracking-wider mb-1">
                          {group.label}
                        </Text>
                        {group.buckets.map((b) => {
                          const isLinkedHere = b.linked_milestone_id === milestone.id;
                          const otherOwner =
                            b.linked_milestone_id && !isLinkedHere
                              ? milestoneNames.get(b.linked_milestone_id) ?? "another milestone"
                              : null;
                          return (
                            <Pressable
                              key={b.id}
                              onPress={() => handleToggleBucketLink(b)}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: isLinkedHere }}
                              accessibilityLabel={`${b.name}${
                                otherOwner ? `, currently feeding ${otherOwner}` : ""
                              }`}
                              className="flex-row items-center py-2"
                            >
                              <Ionicons
                                name={isLinkedHere ? "checkbox" : "square-outline"}
                                size={18}
                                color={isLinkedHere ? colors.blue : colors.textSecondary}
                              />
                              <View className="flex-1 ml-2">
                                <Text
                                  className="text-sm text-foreground"
                                  numberOfLines={1}
                                >
                                  {b.name}
                                </Text>
                                {otherOwner && (
                                  <Text className="text-label text-faint-foreground" numberOfLines={1}>
                                    Feeding {otherOwner}
                                  </Text>
                                )}
                              </View>
                              <Text className="text-xs text-muted-foreground ml-2">
                                {formatAmount(b.current_contributed)}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ))
                  )}
                </View>
              )}

              {linkedBuckets.length === 0 && !showBucketPicker && (
                <Text className="text-xs text-muted-foreground py-1">
                  No buckets feed this milestone yet. Tap Manage to link one, and its
                  contributions will count toward this goal.
                </Text>
              )}

              {linkedBuckets.length > 0 && (
                <>
                {linkedBuckets.map((lb, i) => {
                  const bucketPct =
                    lb.annual_target > 0
                      ? Math.min(
                          (lb.current_contributed / lb.annual_target) * 100,
                          100,
                        )
                      : 0;
                  return (
                    <Pressable
                      key={lb.id}
                      onPress={() =>
                        router.push({
                          pathname: "/goals/investment-detail",
                          params: { bucketId: lb.id },
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Open investment bucket ${lb.name}`}
                      className={`py-2.5 ${
                        i < linkedBuckets.length - 1
                          ? "border-b border-border"
                          : ""
                      }`}
                    >
                      <View className="flex-row items-center justify-between mb-1">
                        <View className="flex-row items-center flex-1">
                          <Ionicons
                            name="link-outline"
                            size={14}
                            color={colors.blue}
                          />
                          <Text className="text-sm font-medium text-foreground ml-1.5" numberOfLines={1}>
                            {lb.name}
                          </Text>
                        </View>
                        <View className="flex-row items-center">
                          <Text className="text-sm font-semibold text-success mr-1">
                            {formatAmount(lb.current_contributed)}
                          </Text>
                          <Ionicons
                            name="chevron-forward"
                            size={14}
                            color={colors.textSecondary}
                          />
                        </View>
                      </View>
                      <ProgressBar value={(bucketPct) / 100} color={theme.primary} height={6} animated={false} />
                    </Pressable>
                  );
                })}
                <View className="mt-2 pt-2 border-t border-border">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-xs text-muted-foreground">
                      Total from linked buckets
                    </Text>
                    <Text className="text-sm font-bold" style={{ color: theme.primary }}>
                      {formatAmount(linkedBucketTotal)}
                    </Text>
                  </View>
                </View>
                </>
              )}
            </Card>

            {/* Monthly History grouped by FY */}
            {monthlyHistoryByFY.length > 0 && (
              <Card title="Monthly History" className="mb-4">
                {monthlyHistoryByFY.map((fyGroup, gi) => (
                  <View key={fyGroup.fy}>
                    {/* FY header */}
                    <View
                      className={`flex-row items-center justify-between py-2 ${
                        gi > 0 ? "mt-1 border-t border-border" : ""
                      }`}
                    >
                      <View className="flex-row items-center">
                        <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {fyGroup.label}
                        </Text>
                        {fyGroup.isCurrent && (
                          <View className="ml-1.5 px-1.5 py-0.5 rounded" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                            <Text className="text-label font-semibold" style={{ color: theme.primary }}>NOW</Text>
                          </View>
                        )}
                      </View>
                      <Text className="text-xs font-semibold" style={{ color: theme.primary }}>
                        {formatAmount(fyGroup.total)}
                      </Text>
                    </View>
                    {/* Month rows */}
                    {fyGroup.months.map((m, mi) => (
                      <View
                        key={m.month}
                        className={`flex-row items-center justify-between py-2 pl-3 ${
                          mi < fyGroup.months.length - 1
                            ? "border-b border-border/50"
                            : ""
                        }`}
                      >
                        <Text className="text-sm font-medium text-foreground">
                          {m.label}
                        </Text>
                        <View className="items-end">
                          <Text className="text-sm font-semibold text-foreground">
                            {formatAmount(m.total)}
                          </Text>
                          {m.count > 1 && (
                            <Text className="text-xs text-faint-foreground">
                              {m.count} entries
                            </Text>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                ))}
              </Card>
            )}

            {/* Add Contribution */}
            {showAddForm ? (
              <Card title={editingContrib ? "Edit Contribution" : "Add Contribution"} className="mb-4">
                <Input
                  label="Amount"
                  value={contribAmount}
                  onChangeText={setContribAmount}
                  keyboardType="numeric"
                  placeholder="e.g. 15000"
                  containerClassName="mb-3"
                />
                <DateInput
                  label="Date"
                  value={contribDate}
                  onChange={setContribDate}
                  containerClassName="mb-3"
                />
                <View className="flex-row">
                  <View className="flex-1 mr-2">
                    <Button
                      title="Cancel"
                      variant="outline"
                      onPress={() => {
                        setShowAddForm(false);
                        setEditingContrib(null);
                        setContribAmount("");
                      }}
                    />
                  </View>
                  <View className="flex-1">
                    <Button title={editingContrib ? "Update" : "Save"} onPress={handleSaveContribution} />
                  </View>
                </View>
              </Card>
            ) : (
              <Pressable
                onPress={() => setShowAddForm(true)}
                className="flex-row items-center justify-center py-3 mb-4 rounded-lg border border-dashed"
                style={{ borderColor: theme.primary }}
              >
                <Ionicons
                  name="add-circle-outline"
                  size={18}
                  color={colors.blue}
                />
                <Text className="text-sm font-medium ml-1" style={{ color: theme.primary }}>
                  Add Contribution
                </Text>
              </Pressable>
            )}

            {/* All Contributions */}
            {contributions.length > 0 && (
              <Card
                title={`All Contributions (${contributions.length})`}
                className="mb-4"
              >
                {contributions.map((c, i) => (
                  <Pressable
                    key={c.id}
                    onLongPress={() => handleContributionLongPress(c)}
                    className={`flex-row items-center justify-between py-2.5 ${
                      i < contributions.length - 1
                        ? "border-b border-border"
                        : ""
                    }`}
                  >
                    <Text className="text-sm font-medium text-foreground">
                      {formatAmount(c.amount)}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {c.date}
                    </Text>
                  </Pressable>
                ))}
                <Text className="text-xs text-faint-foreground mt-2 text-center">
                  Long-press to edit or delete
                </Text>
              </Card>
            )}
          </View>
        </ScrollView>

        {!showAddForm && (
          <FAB icon="add" onPress={() => setShowAddForm(true)} />
        )}
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}


function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-");
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${names[parseInt(m, 10) - 1]} ${year}`;
}
