import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
} from "react-native";
import { useLocalSearchParams, useFocusEffect, useRouter } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card, Input, Button, DateInput, FAB, MetricRow, LoadingState } from "@/components/ui";
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
} from "@/services/life-milestone";
import type {
  LifeMilestone,
  MilestoneContribution,
} from "@/services/life-milestone";
import {
  getLinkedBucketsForMilestone,
  getLinkedBucketContributionsTotal,
} from "@/services/yearly-plan";
import type { InvestmentBucket } from "@/services/yearly-plan";
import { formatAmount } from "@/utils/expense-validation";
import { getCurrentFY, getFYRange, getFYLabel, formatLocalDate } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";
import { ac, acAlpha } from "@/utils/accent";
import { StatusColors } from "@/constants/theme";

export default function MilestoneDetailScreen() {
  const router = useRouter();
  const { milestoneId } = useLocalSearchParams<{ milestoneId: string }>();
  const alert = useAlert();
  const { colors, accent, colorScheme } = useColorScheme();

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
  interface FYBreakdownRow { fy: number; label: string; planned: number; actual: number; isCurrent: boolean }
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
      const [m, c, cc, lb, lbt] = await Promise.all([
        getLifeMilestoneById(milestoneId),
        getMilestoneContributions(milestoneId),
        getCombinedMilestoneContributions(milestoneId),
        getLinkedBucketsForMilestone(milestoneId),
        getLinkedBucketContributionsTotal(milestoneId),
      ]);
      setMilestone(m);
      setContributions(c);
      setCombinedContributions(cc);
      setLinkedBuckets(lb);
      setLinkedBucketTotal(lbt);

      if (m) {
        const sfy = m.start_financial_year ? parseInt(m.start_financial_year, 10) : currentFY;
        const totalMo = getMilestoneTotalMonths(m);
        const numFYs = Math.ceil(totalMo / 12) || 1;
        const rows: FYBreakdownRow[] = [];
        for (let i = 0; i < numFYs; i++) {
          const fy = sfy + i;
          const planned = getMilestoneContributionForFY(m, String(fy));
          const { start, end } = getFYRange(fy, startMonth);
          const actual = await getCombinedMilestoneActualForFY(
            m.id,
            formatLocalDate(start),
            formatLocalDate(end),
          );
          rows.push({
            fy,
            label: getFYLabel(fy, startMonth),
            planned,
            actual,
            isCurrent: fy === currentFY,
          });
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

    // Months to target date
    let monthsToTarget: number | null = null;
    let monthlyNeeded = 0;
    if (milestone.target_date) {
      const now = new Date();
      const target = new Date(milestone.target_date);
      monthsToTarget =
        (target.getFullYear() - now.getFullYear()) * 12 +
        (target.getMonth() - now.getMonth());
      if (monthsToTarget > 0) {
        monthlyNeeded = remaining / monthsToTarget;
      }
    }

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
        <Text className="text-base font-medium text-text-primary dark:text-text-dark-primary mt-4">
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
                      ? StatusColors[colorScheme].successBg
                      : acAlpha(accent, 500, 0.08),
                  }}
                >
                  <Ionicons
                    name={isComplete ? "checkmark-circle" : "flag-outline"}
                    size={28}
                    color={isComplete ? StatusColors[colorScheme].success : colors.blue}
                  />
                </View>
                <Text className="text-lg font-bold text-text-primary dark:text-text-dark-primary">
                  {milestone.name}
                </Text>
                {milestone.target_date && (
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-1">
                    Target date: {milestone.target_date}
                  </Text>
                )}
                {isComplete && (
                  <View className="mt-2 px-3 py-1 rounded-full" style={{ backgroundColor: StatusColors[colorScheme].successBg }}>
                    <Text className="text-xs font-medium text-success">
                      Completed!
                    </Text>
                  </View>
                )}
              </View>

              {/* Saved / Target / Left */}
              <View className="flex-row mt-3">
                <View className="flex-1">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary text-center">
                    Saved
                  </Text>
                  <Text className="text-base font-bold text-success text-center">
                    {formatAmount(milestone.current_saved)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary text-center">
                    Target
                  </Text>
                  <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary text-center">
                    {formatAmount(milestone.target_amount)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary text-center">
                    Left
                  </Text>
                  <Text className="text-base font-bold text-danger text-center">
                    {formatAmount(remaining)}
                  </Text>
                </View>
              </View>

              {/* Progress bar */}
              <View className="mt-3 h-3 rounded-full bg-border-light dark:bg-border-dark overflow-hidden">
                <View
                  className="h-3 rounded-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: isComplete ? StatusColors[colorScheme].success : colors.blue,
                  }}
                />
              </View>
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-1 text-right">
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
                      <View className="h-px bg-border-light dark:bg-border-dark my-1.5" />
                      <MetricRow
                        label="Months to Target Date"
                        value={String(projection.monthsToTarget)}
                      />
                      <MetricRow
                        label="Need per Month"
                        value={formatAmount(projection.monthlyNeeded)}
                        color={
                          projection.avgMonthly >= projection.monthlyNeeded
                            ? StatusColors[colorScheme].success
                            : StatusColors[colorScheme].danger
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
                            ? StatusColors[colorScheme].successBg
                            : StatusColors[colorScheme].dangerBg,
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
                            ? StatusColors[colorScheme].success
                            : StatusColors[colorScheme].danger
                        }
                      />
                      <Text
                        className="text-xs font-medium ml-1"
                        style={{
                          color:
                            projection.avgMonthly >= projection.monthlyNeeded
                              ? StatusColors[colorScheme].success
                              : StatusColors[colorScheme].danger,
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
                  const pctFY = row.planned > 0 ? Math.min(row.actual / row.planned, 1) : 0;
                  return (
                    <View
                      key={row.fy}
                      className={`py-2.5 ${
                        i < fyBreakdown.length - 1
                          ? "border-b border-border-light dark:border-border-dark"
                          : ""
                      }`}
                    >
                      <View className="flex-row items-center justify-between mb-1">
                        <View className="flex-row items-center">
                          <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
                            {row.label}
                          </Text>
                          {row.isCurrent && (
                            <View className="ml-2 px-1.5 py-0.5 rounded" style={{ backgroundColor: acAlpha(accent, 500, 0.1) }}>
                              <Text className="text-[10px] font-semibold" style={{ color: accent[500] }}>NOW</Text>
                            </View>
                          )}
                        </View>
                        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                          {formatAmount(row.actual)} / {formatAmount(row.planned)}
                        </Text>
                      </View>
                      <View className="h-2 rounded-full bg-border-light dark:bg-border-dark overflow-hidden">
                        <View
                          className="h-2 rounded-full"
                          style={{
                            width: `${pctFY * 100}%`,
                            backgroundColor: row.isCurrent ? accent[500] : colors.textSecondary,
                          }}
                        />
                      </View>
                      <Text className="text-[10px] text-text-tertiary mt-0.5 text-right">
                        {(pctFY * 100).toFixed(0)}%
                      </Text>
                    </View>
                  );
                })}
              </Card>
            )}

            {/* Linked Investment Buckets */}
            {linkedBuckets.length > 0 && (
              <Card title="Linked Investment Buckets" className="mb-4">
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
                          pathname: "/goals/investment-detail" as never,
                          params: { bucketId: lb.id },
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Open investment bucket ${lb.name}`}
                      className={`py-2.5 ${
                        i < linkedBuckets.length - 1
                          ? "border-b border-border-light dark:border-border-dark"
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
                          <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary ml-1.5" numberOfLines={1}>
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
                      <View className="h-1.5 rounded-full bg-border-light dark:bg-border-dark overflow-hidden">
                        <View
                          className="h-1.5 rounded-full"
                          style={{ width: `${bucketPct}%`, backgroundColor: accent[500] }}
                        />
                      </View>
                    </Pressable>
                  );
                })}
                <View className="mt-2 pt-2 border-t border-border-light dark:border-border-dark">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                      Total from linked buckets
                    </Text>
                    <Text className="text-sm font-bold" style={{ color: ac(accent, colorScheme, 500, 200) }}>
                      {formatAmount(linkedBucketTotal)}
                    </Text>
                  </View>
                </View>
              </Card>
            )}

            {/* Monthly History grouped by FY */}
            {monthlyHistoryByFY.length > 0 && (
              <Card title="Monthly History" className="mb-4">
                {monthlyHistoryByFY.map((fyGroup, gi) => (
                  <View key={fyGroup.fy}>
                    {/* FY header */}
                    <View
                      className={`flex-row items-center justify-between py-2 ${
                        gi > 0 ? "mt-1 border-t border-border-light dark:border-border-dark" : ""
                      }`}
                    >
                      <View className="flex-row items-center">
                        <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary uppercase tracking-wider">
                          {fyGroup.label}
                        </Text>
                        {fyGroup.isCurrent && (
                          <View className="ml-1.5 px-1.5 py-0.5 rounded" style={{ backgroundColor: acAlpha(accent, 500, 0.1) }}>
                            <Text className="text-[9px] font-semibold" style={{ color: accent[500] }}>NOW</Text>
                          </View>
                        )}
                      </View>
                      <Text className="text-xs font-semibold" style={{ color: accent[500] }}>
                        {formatAmount(fyGroup.total)}
                      </Text>
                    </View>
                    {/* Month rows */}
                    {fyGroup.months.map((m, mi) => (
                      <View
                        key={m.month}
                        className={`flex-row items-center justify-between py-2 pl-3 ${
                          mi < fyGroup.months.length - 1
                            ? "border-b border-border-light/50 dark:border-border-dark/50"
                            : ""
                        }`}
                      >
                        <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
                          {m.label}
                        </Text>
                        <View className="items-end">
                          <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                            {formatAmount(m.total)}
                          </Text>
                          {m.count > 1 && (
                            <Text className="text-xs text-text-tertiary">
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
                style={{ borderColor: ac(accent, colorScheme, 600, 300) }}
              >
                <Ionicons
                  name="add-circle-outline"
                  size={18}
                  color={colors.blue}
                />
                <Text className="text-sm font-medium ml-1" style={{ color: ac(accent, colorScheme, 500, 200) }}>
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
                        ? "border-b border-border-light dark:border-border-dark"
                        : ""
                    }`}
                  >
                    <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
                      {formatAmount(c.amount)}
                    </Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                      {c.date}
                    </Text>
                  </Pressable>
                ))}
                <Text className="text-xs text-text-tertiary mt-2 text-center">
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
