import { useState, useCallback } from "react";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useBackOverride } from "@/hooks/use-back-override";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
} from "react-native";
import { useAlert } from "@/hooks/use-alert";
import {
  useLocalSearchParams,
  useFocusEffect,
  useRouter,
} from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card, Input, Button, FAB, PeriodNavigator, LoadingState } from "@/components/ui";
import {
  getYearlyPlanByFY,
  getInvestmentBuckets,
  getBucketsByFY,
  createInvestmentBucket,
  updateInvestmentBucket,
  deleteInvestmentBucket,
  resetInvestmentBucket,
} from "@/services/yearly-plan";
import type { YearlyPlan, InvestmentBucket } from "@/services/yearly-plan";
import { getLifeMilestones } from "@/services/life-milestone";
import type { LifeMilestone } from "@/services/life-milestone";
import { getCurrentFY, getFYLabel } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";
import { formatAmount } from "@/utils/expense-validation";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { acAlpha } from "@/utils/accent";
import { StatusColors } from "@/constants/theme";
import { getFinancialCockpit, type FinancialCockpitData } from "@/services/financial-cockpit";
import { consumeGoalsPreload } from "@/services/home-preload";

type ViewMode = "buckets" | "add_bucket";

export default function InvestmentBucketsScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors, accent, colorScheme } = useColorScheme();
  const { fy } = useLocalSearchParams<{ fy?: string }>();
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

  const loadData = useCallback(async () => {
    try {
      // Use preloaded data on first open (current FY only), then fall back to live fetch.
      const preload = consumeGoalsPreload();
      const usePreload = preload && preload.fy === fyStr;

      const [p, ms, cd] = await Promise.all([
        getYearlyPlanByFY(DEFAULT_USER_ID, fyStr),
        usePreload ? Promise.resolve(preload.milestones) : getLifeMilestones(DEFAULT_USER_ID),
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
    } catch {
      // DB not ready
    }
    setLoaded(true);
  }, [fyStr, selectedFY]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  // ─── Bucket Actions ──────────────────────────────────────

  const handleAddBucket = async () => {
    const name = newBucketName.trim();
    const target = parseFloat(newBucketTarget);
    if (!name) {
      alert("Missing Name", "Enter a bucket name.");
      return;
    }
    if (isNaN(target) || target <= 0) {
      alert("Invalid Target", "Enter a valid annual target amount.");
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
        text: "Reset Contributions",
        onPress: () => {
          alert(
            "Reset Contributions",
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
        onPress: () => {
          alert(
            "Delete Bucket",
            `Delete "${bucket.name}" and all its contributions? This cannot be undone.`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: async () => {
                  await deleteInvestmentBucket(bucket.id);
                  await loadData();
                },
              },
            ],
          );
        },
      },
    ]);
  };

  const handleEditBucket = (bucket: InvestmentBucket) => {
    setEditingBucketId(bucket.id);
    setNewBucketName(bucket.name);
    setNewBucketTarget(String(bucket.annual_target));
    setSelectedMilestoneId(bucket.linked_milestone_id);
    setViewMode("add_bucket");
  };

  const resetBucketForm = () => {
    setNewBucketName("");
    setNewBucketTarget("");
    setSelectedMilestoneId(null);
    setEditingBucketId(null);
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
      alert("Invalid Hike", "Enter a valid percentage.");
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
        alert("Invalid Hike", `"${bucket.name}" has an invalid hike percentage.`);
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

  // ─── Loading / No Plan ───────────────────────────────────

  if (!loaded) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Loading investments..." icon="pie-chart-outline" />
      </ScreenContainer>
    );
  }

  // Buckets can now exist independently of a yearly plan (FY-tagged)

  // ─── Add/Edit Bucket Form ────────────────────────────────

  if (viewMode === "add_bucket") {
    return (
      <ScreenContainer padTop={false}>
        <KeyboardAvoidingView
          behavior="padding"
          className="flex-1"
        >
          <ScrollView
            className="flex-1"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
          >
            <View className="px-4 py-4">
              <Card
                title={
                  editingBucketId ? "Edit Bucket" : "Add Investment Bucket"
                }
                className="mb-4"
              >
                <Input
                  label="Bucket Name"
                  value={newBucketName}
                  onChangeText={setNewBucketName}
                  placeholder="e.g. Emergency Fund + FD"
                  maxLength={50}
                  containerClassName="mb-3"
                />
                <Input
                  label="Annual Target (Rs)"
                  value={newBucketTarget}
                  onChangeText={setNewBucketTarget}
                  keyboardType="numeric"
                  formula
                  placeholder="e.g. 420000"
                  containerClassName="mb-3"
                />

                {/* Milestone Picker */}
                <View className="mb-4">
                  <Text className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary mb-1.5">
                    Link to Life Milestone (optional)
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    <Pressable
                      onPress={() => setSelectedMilestoneId(null)}
                      className="mr-2 px-3 py-2 rounded-lg border"
                      style={{
                        borderColor: selectedMilestoneId === null ? colors.blue : "#E5E5E3",
                        backgroundColor: selectedMilestoneId === null ? acAlpha(accent, 500, 0.08) : "transparent",
                      }}
                    >
                      <Text
                        className="text-xs font-medium"
                        style={{
                          color: selectedMilestoneId === null ? colors.blue : "#6B7280",
                        }}
                      >
                        None
                      </Text>
                    </Pressable>
                    {milestones.map((ms) => (
                      <Pressable
                        key={ms.id}
                        onPress={() => setSelectedMilestoneId(ms.id)}
                        className="mr-2 px-3 py-2 rounded-lg border"
                        style={{
                          borderColor: selectedMilestoneId === ms.id ? colors.blue : "#E5E5E3",
                          backgroundColor: selectedMilestoneId === ms.id ? acAlpha(accent, 500, 0.08) : "transparent",
                        }}
                      >
                        <Text
                          className="text-xs font-medium"
                          style={{
                            color: selectedMilestoneId === ms.id ? colors.blue : "#6B7280",
                          }}
                          numberOfLines={1}
                        >
                          {ms.name}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>

                <View className="flex-row">
                  <View className="flex-1 mr-2">
                    <Button
                      title="Cancel"
                      variant="outline"
                      onPress={resetBucketForm}
                    />
                  </View>
                  <View className="flex-1">
                    <Button
                      title={editingBucketId ? "Update" : "Add Bucket"}
                      onPress={handleAddBucket}
                    />
                  </View>
                </View>
              </Card>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </ScreenContainer>
    );
  }

  // ─── Main Bucket List ────────────────────────────────────

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        <View className="px-4 pb-4">
          {/* FY Picker */}
          <PeriodNavigator
            mode="fy"
            value={selectedFY}
            onChange={setSelectedFY}
            variant="inline"
          />

          {/* Copy-Forward Prompt */}
          {buckets.length === 0 && prevYearBuckets.length > 0 && (
            <Card className="mb-4">
              <View className="items-center py-2">
                <Ionicons name="copy-outline" size={28} color={colors.blue} />
                <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary mt-2">
                  No buckets for {fyLabel}
                </Text>
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-1 text-center">
                  You have {prevYearBuckets.length} bucket{prevYearBuckets.length > 1 ? "s" : ""} from FY {getFYLabel(selectedFY - 1, startMonth)}.
                </Text>

                {!showHikeInput ? (
                  <>
                    {/* Previous year buckets preview */}
                    <View className="w-full mt-3 mb-3">
                      {prevYearBuckets.map((b) => (
                        <View key={b.id} className="flex-row items-center justify-between py-1.5 border-b border-border-light dark:border-border-dark">
                          <Text className="text-sm text-text-primary dark:text-text-dark-primary flex-1 mr-2" numberOfLines={1}>
                            {b.name}
                          </Text>
                          <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                            {formatAmount(b.annual_target)}
                          </Text>
                        </View>
                      ))}
                    </View>

                    <View className="flex-row w-full gap-2">
                      <View className="flex-1">
                        <Button
                          title="Copy As-Is"
                          variant="outline"
                          onPress={handleCopyAsIs}
                          loading={copying}
                          disabled={copying}
                        />
                      </View>
                      <View className="flex-1">
                        <Button
                          title="Copy with Hike"
                          onPress={() => setShowHikeInput(true)}
                          disabled={copying}
                        />
                      </View>
                    </View>
                  </>
                ) : (
                  <View className="w-full mt-3">
                    {/* Uniform hike shortcut */}
                    <View className="flex-row items-end gap-2 mb-3">
                      <View className="flex-1">
                        <Input
                          label="Set All Hike %"
                          value={uniformHike}
                          onChangeText={setUniformHike}
                          keyboardType="numeric"
                          placeholder="e.g. 10"
                        />
                      </View>
                      <View className="mb-0.5">
                        <Button title="Set All" variant="outline" onPress={handleApplyUniformHike} />
                      </View>
                    </View>

                    {/* Per-bucket hike inputs */}
                    {prevYearBuckets.map((b) => {
                      const hikeStr = bucketHikes[b.id] ?? "";
                      const hike = hikeStr ? parseFloat(hikeStr) : 0;
                      const newTarget = isNaN(hike) ? b.annual_target : Math.round(b.annual_target * (1 + hike / 100));
                      return (
                        <View key={b.id} className="flex-row items-center py-2 border-b border-border-light dark:border-border-dark">
                          <View className="flex-1 mr-2">
                            <Text className="text-sm text-text-primary dark:text-text-dark-primary" numberOfLines={1}>
                              {b.name}
                            </Text>
                            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                              {formatAmount(b.annual_target)} → <Text className="font-semibold" style={{ color: accent[500] }}>{formatAmount(newTarget)}</Text>
                            </Text>
                          </View>
                          <View className="w-20">
                            <Input
                              value={hikeStr}
                              onChangeText={(v: string) => setBucketHikes((prev) => ({ ...prev, [b.id]: v }))}
                              keyboardType="numeric"
                              placeholder="%"
                            />
                          </View>
                        </View>
                      );
                    })}

                    {/* Totals preview */}
                    <View className="mt-2 mb-3">
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                        Previous total: {formatAmount(prevYearBuckets.reduce((s, b) => s + b.annual_target, 0))}
                      </Text>
                      <Text className="text-xs font-semibold" style={{ color: accent[500] }}>
                        New total: {formatAmount(prevYearBuckets.reduce((s, b) => {
                          const h = bucketHikes[b.id] ? parseFloat(bucketHikes[b.id]) : 0;
                          return s + Math.round(b.annual_target * (1 + (isNaN(h) ? 0 : h) / 100));
                        }, 0))}
                      </Text>
                    </View>

                    <View className="flex-row gap-2">
                      <View className="flex-1">
                        <Button title="Cancel" variant="outline" onPress={() => { setShowHikeInput(false); setUniformHike(""); setBucketHikes({}); }} disabled={copying} />
                      </View>
                      <View className="flex-1">
                        <Button title="Apply & Save" onPress={handleCopyWithHike} loading={copying} disabled={copying} />
                      </View>
                    </View>
                  </View>
                )}
              </View>
            </Card>
          )}

          {/* Overall Summary */}
          <Card className="mb-4">
            <View className="flex-row mb-3">
              <View className="flex-1">
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  Total Goal
                </Text>
                <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
                  {formatAmount(totalTarget)}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  Invested
                </Text>
                <Text className="text-base font-bold text-success">
                  {formatAmount(totalContributed)}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  Remaining
                </Text>
                <Text className="text-base font-bold text-danger">
                  {formatAmount(totalRemaining)}
                </Text>
              </View>
            </View>

            {/* Overall progress */}
            <View className="h-3 rounded-full bg-border-light dark:bg-border-dark overflow-hidden">
              <View
                className="h-3 rounded-full"
                style={{ width: `${overallPct}%`, backgroundColor: accent[500] }}
              />
            </View>
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-1 text-right">
              {overallPct.toFixed(1)}% of annual investment goal
            </Text>

            {/* Surplus summary */}
            {cockpit && cockpit.waterfall.breathingRoomMonthly !== 0 && (
              <View
                className="mt-3 py-2 px-3 rounded-lg"
                style={{
                  backgroundColor: (cockpit.waterfall.breathingRoomMonthly > 0 ? "#14B8A6" : StatusColors[colorScheme].danger) + "0A",
                }}
              >
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary text-center">
                  {cockpit.waterfall.breathingRoomMonthly > 0
                    ? `Surplus supports ${Math.min(999, Math.round((cockpit.waterfall.breathingRoomMonthly / (totalRemaining > 0 && cockpit.monthsRemaining > 0 ? totalRemaining / cockpit.monthsRemaining : 1)) * 100))}% of remaining investment commitments`
                    : "Warning: No surplus available for investments"
                  }
                </Text>
              </View>
            )}
          </Card>

          {/* Bucket List */}
          {buckets.length === 0 ? (
            <Card className="mb-4">
              <View className="items-center py-4">
                <Ionicons name="pie-chart-outline" size={48} color={colors.textSecondary} />
                <Text className="text-base font-medium text-text-primary dark:text-text-dark-primary mt-2">
                  No investment buckets
                </Text>
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-1 text-center px-4">
                  Add your first bucket to start tracking investments
                </Text>
              </View>
            </Card>
          ) : (
            buckets.map((bucket) => {
              const left = Math.max(
                bucket.annual_target - bucket.current_contributed,
                0,
              );
              const pct =
                bucket.annual_target > 0
                  ? Math.min(
                      (bucket.current_contributed / bucket.annual_target) * 100,
                      100,
                    )
                  : 0;
              const isComplete =
                bucket.current_contributed >= bucket.annual_target;

              return (
                <Pressable
                  key={bucket.id}
                  onPress={() =>
                    router.push({
                      pathname: "/goals/investment-detail",
                      params: { bucketId: bucket.id },
                    })
                  }
                  onLongPress={() => handleBucketActions(bucket)}
                >
                  <Card className="mb-3">
                    <View className="flex-row items-center justify-between mb-2">
                      <View className="flex-row items-center flex-1">
                        <View
                          className="w-7 h-7 rounded-full items-center justify-center mr-2"
                          style={{
                            backgroundColor: isComplete
                              ? StatusColors[colorScheme].successBg
                              : acAlpha(accent, 500, 0.08),
                          }}
                        >
                          <Ionicons
                            name={
                              isComplete
                                ? "checkmark-circle"
                                : "wallet-outline"
                            }
                            size={16}
                            color={isComplete ? StatusColors[colorScheme].success : colors.blue}
                          />
                        </View>
                        <View className="flex-1">
                          <Text
                            className="text-sm font-medium text-text-primary dark:text-text-dark-primary"
                            numberOfLines={1}
                          >
                            {bucket.name}
                          </Text>
                          {bucket.linked_milestone_id && (
                            <View className="flex-row items-center mt-0.5">
                              <Ionicons
                                name="link-outline"
                                size={10}
                                color={colors.textSecondary}
                              />
                              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary ml-1" numberOfLines={1}>
                                {milestones.find((m) => m.id === bucket.linked_milestone_id)?.name ?? "Linked milestone"}
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>
                      <Pressable
                        onPress={() => handleEditBucket(bucket)}
                        hitSlop={8}
                      >
                        <Ionicons
                          name="create-outline"
                          size={16}
                          color={colors.blue}
                        />
                      </Pressable>
                    </View>

                    {/* Goal / Done / Left */}
                    <View className="flex-row mb-2">
                      <View className="flex-1">
                        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                          Goal
                        </Text>
                        <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                          {formatAmount(bucket.annual_target)}
                        </Text>
                      </View>
                      <View className="flex-1">
                        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                          Done
                        </Text>
                        <Text className="text-sm font-semibold text-success">
                          {formatAmount(bucket.current_contributed)}
                        </Text>
                      </View>
                      <View className="flex-1">
                        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                          Left
                        </Text>
                        <Text className="text-sm font-semibold text-danger">
                          {formatAmount(left)}
                        </Text>
                      </View>
                    </View>

                    {/* Progress bar */}
                    <View className="h-2 rounded-full bg-border-light dark:bg-border-dark overflow-hidden">
                      <View
                        className="h-2 rounded-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: isComplete ? StatusColors[colorScheme].success : colors.blue,
                        }}
                      />
                    </View>
                    <Text className="text-xs text-text-tertiary mt-1 text-right">
                      {pct.toFixed(0)}%
                    </Text>

                    {/* Monthly needed (from cockpit) */}
                    {cockpit && (() => {
                      const bs = cockpit.buckets.find((b) => b.id === bucket.id);
                      if (!bs || isComplete) return null;
                      return (
                        <View className="mt-2 pt-2 border-t border-border-light dark:border-border-dark">
                          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                            {formatAmount(Math.round(bs.monthlyRequired))}/mo needed
                          </Text>
                        </View>
                      );
                    })()}
                  </Card>
                </Pressable>
              );
            })
          )}

          {buckets.length > 0 && (
            <Text className="text-xs text-text-tertiary text-center mb-4">
              Tap to view details. Long-press for reset/delete options.
            </Text>
          )}
        </View>
      </ScrollView>

      {/* FAB: Add Bucket */}
      <FAB icon="add" onPress={() => setViewMode("add_bucket")} />
    </ScreenContainer>
  );
}
