import { useState, useCallback, useEffect, useRef } from "react";

import { DEFAULT_USER_ID } from "@/constants/app";
import { useBackOverride } from "@/hooks/use-back-override";
import { View, ScrollView, Pressable, KeyboardAvoidingView } from "react-native";
import { useAlert } from "@/hooks/use-alert";
import {
  Stack,
  useLocalSearchParams,
  useFocusEffect,
  useRouter,
} from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, Chip, DateInput, FAB, Input, LoadingState, PeriodNavigator, ProgressBar, ScreenContainer, SectionTitle, Text } from "@/components/ui";
import { Statement } from "@/components/ui/LinkRow";
import { FormFooter, FormGroup } from "@/components/ui/FormParts";
import { tint } from "@/constants/brand";
import { todayIso } from "@/utils/local-date";
import { describeBucketDelete } from "@/utils/bucket-delete-text";
import {
  getYearlyPlanByFY,
  getInvestmentBuckets,
  getBucketsByFY,
  createInvestmentBucket,
  updateInvestmentBucket,
  deleteInvestmentBucket,
  getInvestmentBucketUsage,
  resetInvestmentBucket,
} from "@/services/yearly-plan";
import type { InvestmentBucketUsage } from "@/services/yearly-plan";
import { formatError } from "@/utils/error-message";
import { logger } from "@/utils/logger";
import type { YearlyPlan, InvestmentBucket } from "@/services/yearly-plan";
import { getLifeMilestones, getMilestoneMonthlyNeeded } from "@/services/life-milestone";
import { goalMonthlyNeeded, saveDatedGoal } from "@/services/dated-goal";
import type { LifeMilestone } from "@/services/life-milestone";
import { getCurrentFY, getFYLabel } from "@/utils/fiscal-year";
import { getFYStartMonth, getDataVersion } from "@/services/settings";
import { formatAmount } from "@/utils/expense-validation";


import { getFinancialCockpit, type FinancialCockpitData } from "@/services/financial-cockpit";
import { consumeGoalsPreload } from "@/services/home-preload";
import { useTheme } from "@/hooks/use-theme";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";

type ViewMode = "buckets" | "add_bucket";

export default function InvestmentBucketsScreen() {
  const router = useRouter();
  const alert = useAlert();
  const theme = useTheme();
  const { fy, edit } = useLocalSearchParams<{ fy?: string; edit?: string }>();
  const startMonth = getFYStartMonth();
  const initialFY = fy ? parseInt(fy, 10) : getCurrentFY(startMonth);
  const [selectedFY, setSelectedFY] = useState(initialFY);
  const fyLabel = getFYLabel(selectedFY, startMonth);
  const fyStr = String(selectedFY);

  const [plan, setPlan] = useState<YearlyPlan | null>(null);
  const [buckets, setBuckets] = useState<InvestmentBucket[]>([]);
  const [milestones, setMilestones] = useState<LifeMilestone[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("buckets");

  const backToList = useCallback(() => setViewMode("buckets"), []);
  useBackOverride(viewMode !== "buckets", backToList);

  const [cockpit, setCockpit] = useState<FinancialCockpitData | null>(null);
  const lastVersionRef = useRef<string | null>(null);
  // The goals preload cache is NON-destructive and is filled once at app start, so
  // `consumeGoalsPreload()` keeps handing back the same app-start snapshot forever.
  // Honour it for the very first paint only; every later load must hit the DB.
  const preloadUsedRef = useRef(false);

  // Copy-forward state
  const [prevYearBuckets, setPrevYearBuckets] = useState<InvestmentBucket[]>([]);
  const [showHikeInput, setShowHikeInput] = useState(false);
  const [uniformHike, setUniformHike] = useState("");
  const [bucketHikes, setBucketHikes] = useState<Record<string, string>>({});
  const [copying, setCopying] = useState(false);

  // Add bucket form
  const [newBucketName, setNewBucketName] = useState("");
  const [newBucketTarget, setNewBucketTarget] = useState("");
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null);
  const [editingBucketId, setEditingBucketId] = useState<string | null>(null);
  // With a date, the amount above is the goal's total rather than this year's target.
  const [newBucketDate, setNewBucketDate] = useState("");
  const [goalMilestone, setGoalMilestone] = useState<LifeMilestone | null>(null);

  const [loadFailed, setLoadFailed] = useState(false);
  const loadData = useCallback(async () => {
    // Stamp includes what is being VIEWED, not just the data version. Version alone asks
    // "has anything been written?" - and changing the period writes nothing, so the guard
    // swallowed the reload and left the previous period's figures on screen.
    const stamp = `${getDataVersion()}|${fyStr}|${selectedFY}`;
    if (lastVersionRef.current === stamp) return;
    lastVersionRef.current = stamp;
    try {
      // Use preloaded data on first open (current FY only), then fall back to live fetch.
      const preload = preloadUsedRef.current ? null : consumeGoalsPreload();
      const usePreload = preload != null && preload.fy === fyStr;
      if (usePreload) preloadUsedRef.current = true;

      // Bucket linking needs the FULL milestone list, so always use getLifeMilestones.
      // preload.fyMilestones is getMilestonesForFY -- filtered to is_completed = 0 AND
      // the current FY's plan window -- which hid milestones outside the current FY.
      const [p, ms, cd] = await Promise.all([
        getYearlyPlanByFY(DEFAULT_USER_ID, fyStr),
        getLifeMilestones(DEFAULT_USER_ID),
        usePreload ? Promise.resolve(preload.cockpit) : getFinancialCockpit(DEFAULT_USER_ID, fyStr),
      ]);
      setPlan(p);
      setMilestones(ms.filter((m) => !m.is_completed && m.current_saved < m.target_amount));
      setCockpit(cd);

      // Reuse buckets from cockpit plan (already fetched inside cockpit)
      const fyBuckets = await getBucketsByFY(DEFAULT_USER_ID, fyStr);
      let currentBuckets: InvestmentBucket[] = [];

      if (fyBuckets.length > 0) {
        currentBuckets = fyBuckets;
      } else if (p) {
        currentBuckets = await getInvestmentBuckets(p.id);
      }

      setBuckets(currentBuckets);

      if (currentBuckets.length === 0) {
        const prevFY = String(selectedFY - 1);
        const prevBuckets = await getBucketsByFY(DEFAULT_USER_ID, prevFY);
        setPrevYearBuckets(prevBuckets);
      } else {
        setPrevYearBuckets([]);
      }
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      // DB not ready
    }
    setLoaded(true);
  }, [fyStr, selectedFY]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const dateLabel = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  /** A dated goal's line in the list: its total, date and what it needs each month. */
  const goalLine = (bucket: InvestmentBucket): string | null => {
    const goal = goalBehind(bucket);
    if (!goal?.target_date) return null;
    const monthly = getMilestoneMonthlyNeeded(goal);
    const need = monthly ? ` · ${formatAmount(Math.ceil(monthly))} a month` : "";
    return `${formatAmount(goal.target_amount)} by ${dateLabel(goal.target_date)}${need}`;
  };

  // ─── Bucket Actions ──────────────────────────────────────

  const handleAddBucket = async () => {
    const name = newBucketName.trim();
    const target = parseFloat(newBucketTarget);
    if (!name) {
      alert("Missing name", "Enter a bucket name.");
      return;
    }
    if (isNaN(target) || target <= 0) {
      alert("Invalid target", newBucketDate ? "Enter a valid target amount." : "Enter a valid annual target amount.");
      return;
    }

    if (newBucketDate) {
      if (goalMonthlyNeeded(target, 0, newBucketDate) === null) {
        alert("Date has passed", "Choose a target date from this month onwards.");
        return;
      }
      try {
        await saveDatedGoal({
          userId: DEFAULT_USER_ID,
          name,
          total: target,
          targetDate: newBucketDate,
          financialYear: fyStr,
          fyStartMonth: startMonth,
          yearlyPlanId: plan?.id,
          bucketId: editingBucketId ?? undefined,
          milestoneId: goalMilestone?.id,
        });
      } catch (e) {
        logger.error("Save dated goal failed:", e);
        alert("Couldn't save the goal", formatError("Save goal", e));
        return;
      }
      await loadData();
      resetBucketForm();
      return;
    }

    if (editingBucketId) {
      await updateInvestmentBucket(editingBucketId, {
        name,
        annual_target: target,
        linked_milestone_id: selectedMilestoneId,
      });
    } else {
      await createInvestmentBucket({
        yearly_plan_id: plan?.id,
        financial_year: fyStr,
        user_id: DEFAULT_USER_ID,
        name,
        annual_target: target,
        linked_milestone_id: selectedMilestoneId,
      });
    }

    // Reload buckets
    await loadData();
    resetBucketForm();
  };

  const handleBucketActions = (bucket: InvestmentBucket) => {
    alert(bucket.name, "Choose an action:", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset contributions",
        onPress: () => {
          alert(
            "Reset contributions",
            `This will clear all contributions for "${bucket.name}" and set invested amount to zero. The bucket structure and target are kept.\n\nContinue?`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Reset",
                style: "destructive",
                onPress: async () => {
                  await resetInvestmentBucket(bucket.id);
                  await loadData();
                },
              },
            ],
          );
        },
      },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          let usage: InvestmentBucketUsage | null = null;
          try {
            usage = await getInvestmentBucketUsage(bucket.id);
          } catch (e) {
            logger.warn("Bucket usage lookup failed:", e);
          }
          alert(
            "Delete bucket",
            describeBucketDelete(bucket.name, usage),
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: async () => {
                  try {
                    await deleteInvestmentBucket(bucket.id);
                  } catch (e) {
                    logger.error("Delete bucket failed:", e);
                    alert(
                      "Couldn't delete the bucket",
                      `"${bucket.name}" is unchanged. ${formatError("Delete bucket", e)}`,
                    );
                  }
                  await loadData();
                },
              },
            ],
          );
        },
      },
    ]);
  };

  /**
   * The milestone holding this bucket's total and date. Same name, because that's how a dated goal
   * is saved; a bucket someone linked by hand to another dated milestone keeps its yearly target.
   */
  const goalBehind = (bucket: InvestmentBucket): LifeMilestone | null => {
    const linked = milestones.find((m) => m.id === bucket.linked_milestone_id);
    return linked?.target_date && linked.name === bucket.name ? linked : null;
  };

  const handleEditBucket = (bucket: InvestmentBucket) => {
    setEditingBucketId(bucket.id);
    setNewBucketName(bucket.name);
    setSelectedMilestoneId(bucket.linked_milestone_id);
    const goal = goalBehind(bucket);
    setGoalMilestone(goal);
    setNewBucketDate(goal?.target_date ?? "");
    setNewBucketTarget(String(goal ? goal.target_amount : bucket.annual_target));
    setViewMode("add_bucket");
  };

  const resetBucketForm = () => {
    setNewBucketName("");
    setNewBucketTarget("");
    setSelectedMilestoneId(null);
    setEditingBucketId(null);
    setNewBucketDate("");
    setGoalMilestone(null);
    setViewMode("buckets");
  };

  // ─── Copy-Forward ────────────────────────────────────────

  const resetCopyState = () => {
    setPrevYearBuckets([]);
    setShowHikeInput(false);
    setUniformHike("");
    setBucketHikes({});
  };

  const handleCopyAsIs = async () => {
    setCopying(true);
    try {
      for (const bucket of prevYearBuckets) {
        await createInvestmentBucket({
          yearly_plan_id: plan?.id,
          financial_year: fyStr,
          user_id: DEFAULT_USER_ID,
          name: bucket.name,
          annual_target: bucket.annual_target,
          linked_milestone_id: bucket.linked_milestone_id,
        });
      }
      resetCopyState();
      await loadData();
    } catch {
      alert("Error", "Failed to copy buckets. Please try again.");
    } finally {
      setCopying(false);
    }
  };

  const handleApplyUniformHike = () => {
    const hike = parseFloat(uniformHike);
    if (isNaN(hike) || hike <= 0) {
      alert("Invalid hike", "Enter a valid percentage.");
      return;
    }
    const newHikes: Record<string, string> = {};
    for (const b of prevYearBuckets) {
      newHikes[b.id] = uniformHike;
    }
    setBucketHikes(newHikes);
  };

  const handleCopyWithHike = async () => {
    // Validate that at least one bucket has a valid hike or zero
    for (const bucket of prevYearBuckets) {
      const hikeStr = bucketHikes[bucket.id] ?? "";
      const hike = hikeStr ? parseFloat(hikeStr) : 0;
      if (hikeStr && isNaN(hike)) {
        alert("Invalid hike", `"${bucket.name}" has an invalid hike percentage.`);
        return;
      }
    }

    setCopying(true);
    try {
      for (const bucket of prevYearBuckets) {
        const hikeStr = bucketHikes[bucket.id] ?? "";
        const hike = hikeStr ? parseFloat(hikeStr) : 0;
        const multiplier = 1 + hike / 100;
        await createInvestmentBucket({
          yearly_plan_id: plan?.id,
          financial_year: fyStr,
          user_id: DEFAULT_USER_ID,
          name: bucket.name,
          annual_target: Math.round(bucket.annual_target * multiplier),
          linked_milestone_id: bucket.linked_milestone_id,
        });
      }
      resetCopyState();
      await loadData();
    } catch {
      alert("Error", "Failed to copy buckets with hike. Please try again.");
    } finally {
      setCopying(false);
    }
  };

  // ─── Summary Stats ───────────────────────────────────────

  const totalTarget = buckets
    .filter((b) => b.is_active)
    .reduce((sum, b) => sum + b.annual_target, 0);
  const totalContributed = buckets
    .filter((b) => b.is_active)
    .reduce((sum, b) => sum + b.current_contributed, 0);
  const totalRemaining = Math.max(totalTarget - totalContributed, 0);
  const overallPct =
    totalTarget > 0
      ? Math.min((totalContributed / totalTarget) * 100, 100)
      : 0;

  // Arriving from a bucket's Edit pill: open its form once the list has loaded.
  const editOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded || !edit || editOpened.current === edit) return;
    const b = buckets.find((x) => x.id === edit);
    if (b) {
      editOpened.current = edit;
      handleEditBucket(b);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, edit, buckets]);

  // ─── Loading / No Plan ───────────────────────────────────

  if (!loaded) {
    return (
      <ScreenContainer padTop={false}>
        {loadFailed && <LoadFailedBanner onRetry={loadData} />}
        <LoadingState message="Loading investments..." icon="pie-chart-outline" />
      </ScreenContainer>
    );
  }

  // Buckets can now exist independently of a yearly plan (FY-tagged)

  // ─── Add/Edit Bucket Form ────────────────────────────────

  if (viewMode === "add_bucket") {
    const total = parseFloat(newBucketTarget);
    const monthly = newBucketDate && !isNaN(total) ? goalMonthlyNeeded(total, goalMilestone?.current_saved ?? 0, newBucketDate) : null;
    return (
      <ScreenContainer padTop={false}>
        <Stack.Screen options={{ title: editingBucketId ? "Edit bucket" : "Add bucket" }} />
        {loadFailed && <LoadFailedBanner onRetry={loadData} />}
        <KeyboardAvoidingView behavior="padding" className="flex-1">
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
            <View className="px-4 py-4" style={{ gap: 12 }}>
              <FormGroup icon="pie-chart-outline" title="The bucket" hint={`For ${fyLabel}`}>
                <Input label="Name" value={newBucketName} onChangeText={setNewBucketName} placeholder="e.g. Emergency fund + FD" maxLength={50} />
                <Input
                  label={newBucketDate ? "Total target" : "Target for the year"}
                  prefix="₹"
                  value={newBucketTarget}
                  onChangeText={setNewBucketTarget}
                  keyboardType="numeric"
                  formula
                  placeholder="420000"
                />
                <DateInput
                  label="Target date (optional)"
                  value={newBucketDate}
                  onChange={setNewBucketDate}
                  minimumDate={new Date()}
                  maximumDate={null}
                />
                {newBucketDate ? (
                  <View style={{ gap: 6 }}>
                    {monthly !== null && (
                      <Text className="text-meta" style={{ color: theme.primary }}>
                        {monthly > 0
                          ? `${formatAmount(Math.ceil(monthly))} a month gets you there by ${dateLabel(newBucketDate)}`
                          : "You've already saved this much"}
                      </Text>
                    )}
                    <Pressable
                      onPress={() => {
                        setNewBucketDate("");
                        setGoalMilestone(null);
                        setSelectedMilestoneId(null);
                      }}
                      hitSlop={8}
                      accessibilityRole="button"
                      className="self-start"
                    >
                      <Text className="text-meta font-semibold" style={{ color: theme.primary }}>
                        Remove date
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <View>
                    <Text className="text-label font-semibold text-muted-foreground mb-1.5">Link to a life milestone (optional)</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      <Chip label="None" on={selectedMilestoneId === null} onPress={() => setSelectedMilestoneId(null)} />
                      {milestones.map((ms) => (
                        <Chip key={ms.id} label={ms.name} on={selectedMilestoneId === ms.id} onPress={() => setSelectedMilestoneId(ms.id)} />
                      ))}
                    </ScrollView>
                  </View>
                )}
              </FormGroup>
            </View>
          </ScrollView>
          <FormFooter primary={editingBucketId ? "Save bucket" : "Add bucket"} onPrimary={handleAddBucket} onCancel={resetBucketForm} />
        </KeyboardAvoidingView>
      </ScreenContainer>
    );
  }

  // ─── Main Bucket List ────────────────────────────────────

  const monthsGone = cockpit ? 12 - cockpit.monthsRemaining : null;
  const breathing = cockpit?.waterfall.breathingRoomMonthly ?? 0;

  return (
    <ScreenContainer padTop={false}>
      {loadFailed && <LoadFailedBanner onRetry={loadData} />}
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 96 }}>
        <View className="px-4 pb-4" style={{ gap: 12 }}>
          <PeriodNavigator mode="fy" value={selectedFY} onChange={setSelectedFY} variant="inline" />

          {/* Copy last year's plan into this empty year */}
          {buckets.length === 0 && prevYearBuckets.length > 0 && (
            <Card>
              <SectionTitle
                icon="copy-outline"
                active
                title={`No buckets for ${fyLabel}`}
                hint={`${prevYearBuckets.length} ${prevYearBuckets.length > 1 ? "buckets" : "bucket"} in ${getFYLabel(selectedFY - 1, startMonth)}`}
              />
              {!showHikeInput ? (
                <>
                  <View className="mt-2">
                    {prevYearBuckets.map((b, i) => (
                      <View key={b.id} className={`flex-row items-center justify-between py-2 ${i > 0 ? "border-t border-border" : ""}`}>
                        <Text className="text-body text-foreground flex-1 mr-2" numberOfLines={1}>
                          {b.name}
                        </Text>
                        <Text className="text-body font-semibold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                          {formatAmount(b.annual_target)}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <View className="flex-row mt-3" style={{ gap: 8 }}>
                    <View className="flex-1">
                      <Button title="Copy as is" variant="outline" onPress={handleCopyAsIs} loading={copying} disabled={copying} />
                    </View>
                    <View className="flex-1">
                      <Button title="Copy with hike" onPress={() => setShowHikeInput(true)} disabled={copying} />
                    </View>
                  </View>
                </>
              ) : (
                <View className="mt-3" style={{ gap: 8 }}>
                  <View className="flex-row items-end" style={{ gap: 8 }}>
                    <Input
                      label="Set all hike"
                      suffix="%"
                      value={uniformHike}
                      onChangeText={setUniformHike}
                      keyboardType="numeric"
                      placeholder="10"
                      containerClassName="flex-1"
                    />
                    <Button title="Set all" variant="outline" onPress={handleApplyUniformHike} />
                  </View>
                  {prevYearBuckets.map((b) => {
                    const hikeStr = bucketHikes[b.id] ?? "";
                    const hike = hikeStr ? parseFloat(hikeStr) : 0;
                    const newTarget = isNaN(hike) ? b.annual_target : Math.round(b.annual_target * (1 + hike / 100));
                    return (
                      <View key={b.id} className="flex-row items-center py-2 border-t border-border">
                        <View className="flex-1 mr-2">
                          <Text className="text-body text-foreground" numberOfLines={1}>
                            {b.name}
                          </Text>
                          <Text className="text-meta text-muted-foreground">
                            {formatAmount(b.annual_target)} →{" "}
                            <Text className="text-meta font-semibold" style={{ color: theme.primary }}>
                              {formatAmount(newTarget)}
                            </Text>
                          </Text>
                        </View>
                        <View style={{ width: 92 }}>
                          <Input
                            value={hikeStr}
                            onChangeText={(v: string) => setBucketHikes((prev) => ({ ...prev, [b.id]: v }))}
                            keyboardType="numeric"
                            suffix="%"
                            accessibilityLabel={`Hike for ${b.name}`}
                          />
                        </View>
                      </View>
                    );
                  })}
                  <View className="border-t border-border pt-2">
                    <Statement
                      lines={[{ label: "Last year's total", amount: formatAmount(prevYearBuckets.reduce((s, b) => s + b.annual_target, 0)) }]}
                      total={{
                        label: "New total",
                        color: theme.primary,
                        amount: formatAmount(
                          prevYearBuckets.reduce((s, b) => {
                            const h = bucketHikes[b.id] ? parseFloat(bucketHikes[b.id]) : 0;
                            return s + Math.round(b.annual_target * (1 + (isNaN(h) ? 0 : h) / 100));
                          }, 0),
                        ),
                      }}
                    />
                  </View>
                  <View className="flex-row" style={{ gap: 8 }}>
                    <View className="flex-1">
                      <Button
                        title="Cancel"
                        variant="outline"
                        onPress={() => {
                          setShowHikeInput(false);
                          setUniformHike("");
                          setBucketHikes({});
                        }}
                        disabled={copying}
                      />
                    </View>
                    <View className="flex-1">
                      <Button title="Apply and save" onPress={handleCopyWithHike} loading={copying} disabled={copying} />
                    </View>
                  </View>
                </View>
              )}
            </Card>
          )}

          {/* Overall: put in this year, of the target */}
          <Card>
            <View className="flex-row items-end justify-between">
              <View>
                <Text className="text-meta text-muted-foreground">Put in this year</Text>
                <Text className="text-hero font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }} numberOfLines={1}>
                  {formatAmount(totalContributed)}
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-meta text-muted-foreground">of {formatAmount(totalTarget)}</Text>
                <Text className="text-meta text-muted-foreground">
                  {buckets.length} {buckets.length === 1 ? "bucket" : "buckets"}
                </Text>
              </View>
            </View>
            {totalTarget > 0 && (
              <View className="mt-3" style={{ gap: 6 }}>
                <ProgressBar value={overallPct / 100} color={theme.data.transfer} height={8} animated={false} />
                <Text className="text-meta text-muted-foreground">
                  {formatAmount(totalRemaining)} still to put in{monthsGone != null ? ` · ${monthsGone} of 12 months gone` : ""}
                </Text>
              </View>
            )}
            {cockpit && breathing !== 0 && (
              <View
                className="mt-3 py-2 px-3 rounded-control"
                style={{ backgroundColor: breathing > 0 ? theme.alpha("success", 0.08) : theme.alpha("danger", 0.08) }}
              >
                <Text className="text-meta text-foreground">
                  {breathing > 0
                    ? `Your monthly surplus covers ${Math.min(
                        999,
                        Math.round(
                          (breathing / (totalRemaining > 0 && cockpit.monthsRemaining > 0 ? totalRemaining / cockpit.monthsRemaining : 1)) * 100,
                        ),
                      )}% of what's still to put in`
                    : "No surplus left for investments this year"}
                </Text>
              </View>
            )}
          </Card>

          {buckets.length === 0 ? (
            <Card>
              <View className="items-center py-4">
                <Ionicons name="pie-chart-outline" size={48} color={theme.faintForeground} />
                <Text className="text-body font-semibold text-foreground mt-2">No investment buckets</Text>
                <Text className="text-meta text-muted-foreground mt-1 text-center px-4">Add your first bucket to start tracking investments</Text>
              </View>
            </Card>
          ) : (
            buckets.map((bucket, i) => {
              const left = Math.max(bucket.annual_target - bucket.current_contributed, 0);
              const pct = bucket.annual_target > 0 ? Math.min((bucket.current_contributed / bucket.annual_target) * 100, 100) : 0;
              const isComplete = bucket.current_contributed >= bucket.annual_target;
              const bs = cockpit?.buckets.find((b) => b.id === bucket.id);
              const goal = goalBehind(bucket);
              const passed = !!goal?.target_date && goal.target_date < todayIso() && !isComplete;
              const color = isComplete ? theme.success : theme.data.series[(i + 2) % theme.data.series.length];
              const tag: { label: string; tone: "success" | "warning" | "primary" } | null = isComplete
                ? { label: "Done", tone: "success" }
                : passed
                  ? { label: "Date passed", tone: "warning" }
                  : bs?.paceStatus === "behind"
                    ? { label: "Behind", tone: "warning" }
                    : bs
                      ? { label: bs.paceStatus === "ahead" ? "Ahead" : "On pace", tone: "success" }
                      : null;
              const sub = bucket.linked_milestone_id
                ? goalLine(bucket) ?? `Linked to ${milestones.find((m) => m.id === bucket.linked_milestone_id)?.name ?? "a milestone"}`
                : bucket.annual_target > 0
                  ? `${formatAmount(Math.round(bucket.annual_target / 12))} a month`
                  : "No target yet";
              return (
                <Pressable
                  key={bucket.id}
                  onPress={() => router.push({ pathname: "/goals/investment-detail", params: { bucketId: bucket.id } })}
                  onLongPress={() => handleBucketActions(bucket)}
                  className="rounded-card bg-card border border-border px-4 py-3.5"
                  style={{ gap: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={`${bucket.name}${tag ? `, ${tag.label}` : ""}`}
                  accessibilityHint="Long-press to reset or delete"
                >
                  <View className="flex-row items-center" style={{ gap: 12 }}>
                    <View className="w-10 h-10 rounded-control items-center justify-center" style={{ backgroundColor: tint(color, 0.1) }}>
                      <Ionicons name={isComplete ? "checkmark-circle" : "wallet-outline"} size={19} color={color} />
                    </View>
                    <View className="flex-1" style={{ minWidth: 0 }}>
                      <Text className="text-body font-bold text-foreground" numberOfLines={1}>
                        {bucket.name}
                      </Text>
                      <Text className="text-meta text-muted-foreground" numberOfLines={1}>
                        {sub}
                      </Text>
                    </View>
                    {tag && <Chip variant="status" tone={tag.tone} label={tag.label} />}
                    <Pressable onPress={() => handleEditBucket(bucket)} hitSlop={8} className="p-1" accessibilityRole="button" accessibilityLabel={`Edit ${bucket.name}`}>
                      <Ionicons name="create-outline" size={18} color={theme.mutedForeground} />
                    </Pressable>
                  </View>
                  {bucket.annual_target > 0 && <ProgressBar value={pct / 100} color={color} height={6} animated={false} />}
                  <View className="flex-row justify-between">
                    <Text className="text-meta font-semibold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                      {formatAmount(bucket.current_contributed)}
                      <Text className="text-meta text-muted-foreground"> of {formatAmount(bucket.annual_target)}</Text>
                    </Text>
                    <Text className="text-meta text-muted-foreground" numberOfLines={1}>
                      {isComplete
                        ? "Target reached"
                        : bs && bs.monthlyRequired > 0
                          ? `${formatAmount(Math.round(bs.monthlyRequired))} a month needed`
                          : `${formatAmount(left)} left`}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}

          {/* Plan the next year from this one: opens next FY, where the copy prompt waits. */}
          {buckets.length > 0 && (
            <Pressable
              onPress={() => setSelectedFY(selectedFY + 1)}
              className="flex-row items-center rounded-card border border-dashed px-4"
              style={{ minHeight: 60, gap: 12, borderColor: theme.primary, backgroundColor: theme.alpha("primary", 0.04) }}
              accessibilityRole="button"
              accessibilityLabel={`Plan ${getFYLabel(selectedFY + 1, startMonth)} from this one`}
            >
              <View className="flex-1">
                <Text className="text-body font-semibold text-foreground" numberOfLines={1}>
                  Plan {getFYLabel(selectedFY + 1, startMonth)} from this one
                </Text>
                <Text className="text-meta text-muted-foreground">Copy as is, or with a yearly hike</Text>
              </View>
              <Text className="text-body font-bold" style={{ color: theme.primary }}>
                Copy
              </Text>
            </Pressable>
          )}

          {buckets.length > 0 && (
            <Text className="text-label text-faint-foreground text-center">Tap to open. Long-press to reset or delete.</Text>
          )}
        </View>
      </ScrollView>

      <FAB icon="add" label="Bucket" onPress={() => setViewMode("add_bucket")} />
    </ScreenContainer>
  );
}

