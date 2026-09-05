import { useState, useCallback, useRef } from "react";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useBackOverride } from "@/hooks/use-back-override";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card, Input, Button, DateInput, FAB, LoadingState } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac, acAlpha } from "@/utils/accent";
import { StatusColors } from "@/constants/theme";
import {
  getLifeMilestones,
  createLifeMilestone,
  updateLifeMilestone,
  deleteLifeMilestone,
  resetLifeMilestone,
  getMilestoneContributionForFY,
  getCombinedMilestoneActualsByIdForFY,
  getMilestoneTotalMonths,
} from "@/services/life-milestone";
import type { LifeMilestone } from "@/services/life-milestone";
import { getCurrentFY, getFYRange, getFYLabel, formatLocalDate } from "@/utils/fiscal-year";
import { getFYStartMonth, getDataVersion } from "@/services/settings";
import { formatCompact } from "@/utils/format";
import { formatAmount } from "@/utils/expense-validation";
import { getFinancialCockpit } from "@/services/financial-cockpit";
import type { MilestoneStatus } from "@/utils/financial-cockpit";
import { consumeGoalsPreload } from "@/services/home-preload";

type ViewMode = "list" | "add_milestone";
type DurationUnit = "years" | "months";

export default function MilestonesScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors, accent, colorScheme } = useColorScheme();
  const [milestones, setMilestones] = useState<LifeMilestone[]>([]);
  const [milestoneStatuses, setMilestoneStatuses] = useState<MilestoneStatus[]>([]);
  const [fyActuals, setFyActuals] = useState<Map<string, number>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const backToList = useCallback(() => setViewMode("list"), []);
  useBackOverride(viewMode !== "list", backToList);

  const startMonth = getFYStartMonth();
  const currentFY = getCurrentFY(startMonth);

  // Form state
  const [formName, setFormName] = useState("");
  const [formTarget, setFormTarget] = useState("");
  const [formTargetDate, setFormTargetDate] = useState("");
  const [formMonthlyPlan, setFormMonthlyPlan] = useState("");
  const [formStartFY, setFormStartFY] = useState(String(currentFY));
  const [formDurationUnit, setFormDurationUnit] = useState<DurationUnit>("years");
  const [formDurationYears, setFormDurationYears] = useState("1");
  const [formDurationMonths, setFormDurationMonths] = useState("0");
  const [editingId, setEditingId] = useState<string | null>(null);
  const lastVersionRef = useRef<number | null>(null);

  const loadData = useCallback(async () => {
    const currentVersion = getDataVersion();
    if (lastVersionRef.current === currentVersion) return;
    lastVersionRef.current = currentVersion;
    try {
      const preload = consumeGoalsPreload();
      const usePreload = preload && preload.fy === String(currentFY);

      const [data, cd] = await Promise.all([
        usePreload ? Promise.resolve(preload.fyMilestones) : getLifeMilestones(DEFAULT_USER_ID),
        usePreload ? Promise.resolve(preload.cockpit) : getFinancialCockpit(DEFAULT_USER_ID, String(currentFY)),
      ]);
      setMilestones(data);
      setMilestoneStatuses(cd?.milestones ?? []);

      const activeIds = data.filter((m) => !m.is_completed).map((m) => m.id);
      if (activeIds.length > 0) {
        const { start, end } = getFYRange(currentFY, startMonth);
        const actMap = await getCombinedMilestoneActualsByIdForFY(
          activeIds,
          formatLocalDate(start),
          formatLocalDate(end),
        );
        setFyActuals(actMap);
      }
    } catch {
      // DB not ready
    }
    setLoaded(true);
  }, [currentFY, startMonth]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  // ─── Actions ─────────────────────────────────────────────

  const handleSave = async () => {
    const name = formName.trim();
    const target = parseFloat(formTarget);
    if (!name) {
      alert("Missing Name", "Enter a milestone name.");
      return;
    }
    if (isNaN(target) || target <= 0) {
      alert("Invalid Target", "Enter a valid target amount.");
      return;
    }

    const monthlyPlan = parseFloat(formMonthlyPlan) || 0;
    const targetDate = formTargetDate.trim() || undefined;
    const startFY = formStartFY.trim() || undefined;
    const durationYears = parseInt(formDurationYears, 10) || 0;
    const durationMonths = parseInt(formDurationMonths, 10) || 0;

    if (durationYears === 0 && durationMonths === 0) {
      alert("Invalid Duration", "Duration must be at least 1 month.");
      return;
    }

    if (editingId) {
      await updateLifeMilestone(editingId, {
        name,
        target_amount: target,
        target_date: targetDate ?? null,
        monthly_contribution_planned: monthlyPlan,
        start_financial_year: startFY ?? null,
        duration_years: durationYears,
        duration_months: durationMonths,
      });
    } else {
      await createLifeMilestone({
        user_id: DEFAULT_USER_ID,
        name,
        target_amount: target,
        target_date: targetDate,
        monthly_contribution_planned: monthlyPlan,
        start_financial_year: startFY,
        duration_years: durationYears,
        duration_months: durationMonths,
      });
    }

    resetForm();
    await loadData();
  };

  const handleMilestoneActions = (m: LifeMilestone) => {
    alert(m.name, "Choose an action:", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset Progress",
        onPress: () => {
          alert(
            "Reset Progress",
            `This will clear all contributions for "${m.name}" and set saved amount to zero. The milestone structure is kept.\n\nContinue?`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Reset",
                style: "destructive",
                onPress: async () => {
                  await resetLifeMilestone(m.id);
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
          alert(
            "Delete Milestone",
            `Delete "${m.name}" and all its contributions? This cannot be undone.`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: async () => {
                  await deleteLifeMilestone(m.id);
                  await loadData();
                },
              },
            ],
          );
        },
      },
    ]);
  };

  const handleEdit = (m: LifeMilestone) => {
    setEditingId(m.id);
    setFormName(m.name);
    setFormTarget(String(m.target_amount));
    setFormTargetDate(m.target_date ?? "");
    setFormMonthlyPlan(
      m.monthly_contribution_planned > 0
        ? String(m.monthly_contribution_planned)
        : "",
    );
    setFormStartFY(m.start_financial_year ?? String(currentFY));
    const hasMonths = (m.duration_months || 0) > 0;
    const hasYears = (m.duration_years || 0) > 0;
    if (hasMonths && !hasYears) {
      setFormDurationUnit("months");
    } else {
      setFormDurationUnit("years");
    }
    setFormDurationYears(String(m.duration_years || 0));
    setFormDurationMonths(String(m.duration_months || 0));
    setViewMode("add_milestone");
  };

  const handleToggleComplete = async (m: LifeMilestone) => {
    const nowComplete = m.is_completed ? 0 : 1;
    await updateLifeMilestone(m.id, {
      is_completed: nowComplete,
      completed_date: nowComplete
        ? new Date().toISOString().split("T")[0]
        : null,
    });
    await loadData();
  };

  const resetForm = () => {
    setFormName("");
    setFormTarget("");
    setFormTargetDate("");
    setFormMonthlyPlan("");
    setFormStartFY(String(currentFY));
    setFormDurationUnit("years");
    setFormDurationYears("1");
    setFormDurationMonths("0");
    setEditingId(null);
    setViewMode("list");
  };

  // ─── Summary ─────────────────────────────────────────────

  const activeMilestones = milestones.filter((m) => !m.is_completed);
  const completedMilestones = milestones.filter((m) => m.is_completed);
  const totalTarget = activeMilestones.reduce(
    (s, m) => s + m.target_amount,
    0,
  );
  const totalSaved = activeMilestones.reduce((s, m) => s + m.current_saved, 0);
  const overallPct =
    totalTarget > 0 ? Math.min((totalSaved / totalTarget) * 100, 100) : 0;

  // ─── Loading ─────────────────────────────────────────────

  if (!loaded) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Loading milestones..." icon="flag-outline" />
      </ScreenContainer>
    );
  }

  // ─── Add/Edit Form ───────────────────────────────────────

  if (viewMode === "add_milestone") {
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
                title={editingId ? "Edit Milestone" : "Add Life Milestone"}
                className="mb-4"
              >
                <Input
                  label="Milestone Name"
                  value={formName}
                  onChangeText={setFormName}
                  placeholder="e.g. Car Down Payment"
                  maxLength={50}
                  containerClassName="mb-3"
                />
                <Input
                  label="Target Amount (Rs)"
                  value={formTarget}
                  onChangeText={setFormTarget}
                  keyboardType="numeric"
                  formula
                  placeholder="e.g. 700000"
                  containerClassName="mb-3"
                />
                <DateInput
                  label="Target Date (optional)"
                  value={formTargetDate}
                  onChange={setFormTargetDate}
                  placeholder="e.g. 2028-03-31"
                  maximumDate={null}
                  containerClassName="mb-3"
                />
                <Input
                  label="Monthly Contribution Plan (optional)"
                  value={formMonthlyPlan}
                  onChangeText={setFormMonthlyPlan}
                  keyboardType="numeric"
                  formula
                  placeholder="e.g. 15000"
                  containerClassName="mb-3"
                />

                {/* Start FY Picker */}
                <View className="mb-3">
                  <Text className="text-xs font-medium text-muted-foreground mb-1.5">
                    Start Financial Year
                  </Text>
                  <View className="flex-row items-center">
                    <Pressable
                      onPress={() => setFormStartFY(String(parseInt(formStartFY, 10) - 1))}
                      className="p-2 rounded-lg bg-card"
                    >
                      <Ionicons name="chevron-back" size={16} color={colors.textSecondary} />
                    </Pressable>
                    <View className="flex-1 items-center mx-2 py-2 rounded-lg" style={{ backgroundColor: ac(accent, colorScheme, 50, 700) }}>
                      <Text className="text-sm font-semibold" style={{ color: ac(accent, colorScheme, 500, 200) }}>
                        {getFYLabel(parseInt(formStartFY, 10), startMonth)}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => setFormStartFY(String(parseInt(formStartFY, 10) + 1))}
                      className="p-2 rounded-lg bg-card"
                    >
                      <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                    </Pressable>
                  </View>
                </View>

                {/* Duration */}
                <View className="mb-3">
                  <Text className="text-xs font-medium text-muted-foreground mb-1.5">
                    Duration
                  </Text>

                  {/* Unit toggle */}
                  <View className="flex-row mb-2 rounded-lg overflow-hidden border border-border">
                    {(["years", "months"] as DurationUnit[]).map((unit) => (
                      <Pressable
                        key={unit}
                        onPress={() => {
                          setFormDurationUnit(unit);
                          if (unit === "years") {
                            setFormDurationMonths("0");
                            if (formDurationYears === "0") setFormDurationYears("1");
                          } else {
                            setFormDurationYears("0");
                            if (formDurationMonths === "0") setFormDurationMonths("6");
                          }
                        }}
                        className="flex-1 py-2 items-center"
                        style={{
                          backgroundColor: formDurationUnit === unit ? acAlpha(accent, 500, 0.12) : "transparent",
                        }}
                      >
                        <Text
                          className="text-sm font-medium capitalize"
                          style={{ color: formDurationUnit === unit ? colors.blue : "#6B7280" }}
                        >
                          {unit}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {/* Presets + custom */}
                  {formDurationUnit === "years" ? (
                    <View className="flex-row items-center">
                      {["1", "2", "3", "5", "10"].map((d) => (
                        <Pressable
                          key={d}
                          onPress={() => { setFormDurationYears(d); setFormDurationMonths("0"); }}
                          className="mr-2 px-4 py-2 rounded-lg border"
                          style={{
                            borderColor: formDurationYears === d && formDurationMonths === "0" ? colors.blue : "#E5E5E3",
                            backgroundColor: formDurationYears === d && formDurationMonths === "0" ? acAlpha(accent, 500, 0.08) : "transparent",
                          }}
                        >
                          <Text
                            className="text-sm font-medium"
                            style={{ color: formDurationYears === d && formDurationMonths === "0" ? colors.blue : "#6B7280" }}
                          >
                            {d}yr
                          </Text>
                        </Pressable>
                      ))}
                      <Input
                        value={formDurationYears}
                        onChangeText={(v) => { setFormDurationYears(v); setFormDurationMonths("0"); }}
                        keyboardType="numeric"
                        placeholder="Yrs"
                        containerClassName="flex-1 ml-1"
                      />
                    </View>
                  ) : (
                    <View className="flex-row items-center">
                      {["3", "6", "9", "18"].map((d) => (
                        <Pressable
                          key={d}
                          onPress={() => { setFormDurationMonths(d); setFormDurationYears("0"); }}
                          className="mr-2 px-4 py-2 rounded-lg border"
                          style={{
                            borderColor: formDurationMonths === d && formDurationYears === "0" ? colors.blue : "#E5E5E3",
                            backgroundColor: formDurationMonths === d && formDurationYears === "0" ? acAlpha(accent, 500, 0.08) : "transparent",
                          }}
                        >
                          <Text
                            className="text-sm font-medium"
                            style={{ color: formDurationMonths === d && formDurationYears === "0" ? colors.blue : "#6B7280" }}
                          >
                            {d}mo
                          </Text>
                        </Pressable>
                      ))}
                      <Input
                        value={formDurationMonths}
                        onChangeText={(v) => { setFormDurationMonths(v); setFormDurationYears("0"); }}
                        keyboardType="numeric"
                        placeholder="Mo"
                        containerClassName="flex-1 ml-1"
                      />
                    </View>
                  )}

                  {/* Contribution summary */}
                  {parseFloat(formTarget) > 0 && (() => {
                    const yrs = parseInt(formDurationYears, 10) || 0;
                    const mos = parseInt(formDurationMonths, 10) || 0;
                    const totalMo = yrs * 12 + mos;
                    if (totalMo <= 0) return null;
                    const monthly = parseFloat(formTarget) / totalMo;
                    const label = yrs > 0 && mos > 0
                      ? `${yrs}yr ${mos}mo`
                      : yrs > 0 ? `${yrs}yr` : `${mos}mo`;
                    return (
                      <Text className="text-xs text-muted-foreground mt-1">
                        {label} → {formatAmount(monthly)}/month
                      </Text>
                    );
                  })()}
                </View>

                <View className="flex-row">
                  <View className="flex-1 mr-2">
                    <Button
                      title="Cancel"
                      variant="outline"
                      onPress={resetForm}
                    />
                  </View>
                  <View className="flex-1">
                    <Button
                      title={editingId ? "Update" : "Add Milestone"}
                      onPress={handleSave}
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

  // ─── Main List ───────────────────────────────────────────

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        <View className="px-4 py-4">
          {/* Overall Summary */}
          {activeMilestones.length > 0 && (
            <Card className="mb-4">
              <View className="flex-row mb-3">
                <View className="flex-1">
                  <Text className="text-xs text-muted-foreground">
                    Total Goal
                  </Text>
                  <Text className="text-base font-bold text-foreground">
                    {formatAmount(totalTarget)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-muted-foreground">
                    Saved
                  </Text>
                  <Text className="text-base font-bold text-success">
                    {formatAmount(totalSaved)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-muted-foreground">
                    Remaining
                  </Text>
                  <Text className="text-base font-bold text-danger">
                    {formatAmount(Math.max(totalTarget - totalSaved, 0))}
                  </Text>
                </View>
              </View>
              <View className="h-3 rounded-full bg-border overflow-hidden">
                <View
                  className="h-3 rounded-full"
                  style={{ width: `${overallPct}%`, backgroundColor: accent[500] }}
                />
              </View>
              <Text className="text-xs text-muted-foreground mt-1 text-right">
                {overallPct.toFixed(1)}% overall progress
              </Text>
            </Card>
          )}

          {/* Empty State */}
          {milestones.length === 0 && (
            <Card className="mb-4">
              <View className="items-center py-4">
                <Ionicons name="flag-outline" size={48} color={colors.textSecondary} />
                <Text className="text-base font-medium text-foreground mt-2">
                  No milestones yet
                </Text>
                <Text className="text-sm text-muted-foreground mt-1 text-center px-4">
                  Add your first life goal to start tracking
                </Text>
              </View>
            </Card>
          )}

          {/* Active Milestones */}
          {activeMilestones.map((m) => {
            const fyPlanned = getMilestoneContributionForFY(m, String(currentFY));
            const fyActual = fyActuals.get(m.id) ?? 0;
            return (
              <MilestoneCard
                key={m.id}
                milestone={m}
                realityStatus={milestoneStatuses.find((ms) => ms.id === m.id) ?? null}
                fyLabel={getFYLabel(currentFY, startMonth)}
                fyPlanned={fyPlanned}
                fyActual={fyActual}
                onPress={() =>
                  router.push({
                    pathname: "/goals/milestone-detail",
                    params: { milestoneId: m.id },
                  })
                }
                onLongPress={() => handleMilestoneActions(m)}
                onEdit={() => handleEdit(m)}
                onToggleComplete={() => handleToggleComplete(m)}
              />
            );
          })}

          {/* Completed Milestones */}
          {completedMilestones.length > 0 && (
            <>
              <Text className="text-sm font-semibold text-muted-foreground mt-4 mb-2">
                Completed ({completedMilestones.length})
              </Text>
              {completedMilestones.map((m) => (
                <MilestoneCard
                  key={m.id}
                  milestone={m}
                  realityStatus={null}
                  onPress={() =>
                    router.push({
                      pathname: "/goals/milestone-detail",
                      params: { milestoneId: m.id },
                    })
                  }
                  onLongPress={() => handleMilestoneActions(m)}
                  onEdit={() => handleEdit(m)}
                  onToggleComplete={() => handleToggleComplete(m)}
                />
              ))}
            </>
          )}

          {milestones.length > 0 && (
            <Text className="text-xs text-faint-foreground text-center mt-2 mb-4">
              Tap to view details. Long-press for reset/delete options.
            </Text>
          )}
        </View>
      </ScrollView>

      {/* FAB */}
      <FAB icon="add" onPress={() => setViewMode("add_milestone")} />
    </ScreenContainer>
  );
}

// ─── Milestone Card Component ────────────────────────────

function MilestoneCard({
  milestone,
  realityStatus,
  fyLabel,
  fyPlanned,
  fyActual,
  onPress,
  onLongPress,
  onEdit,
  onToggleComplete,
}: {
  milestone: LifeMilestone;
  realityStatus: MilestoneStatus | null;
  fyLabel?: string;
  fyPlanned?: number;
  fyActual?: number;
  onPress: () => void;
  onLongPress: () => void;
  onEdit: () => void;
  onToggleComplete: () => void;
}) {
  const { colors, accent, colorScheme } = useColorScheme();
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

  // Calculate monthly needed if target date exists
  let monthlyNeeded: number | null = null;
  if (milestone.target_date && remaining > 0) {
    const now = new Date();
    const target = new Date(milestone.target_date);
    const monthsLeft =
      (target.getFullYear() - now.getFullYear()) * 12 +
      (target.getMonth() - now.getMonth());
    if (monthsLeft > 0) {
      monthlyNeeded = remaining / monthsLeft;
    }
  }

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress}>
      <Card className="mb-3">
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-row items-center flex-1">
            <Pressable onPress={onToggleComplete} hitSlop={8}>
              <View
                className="w-7 h-7 rounded-full items-center justify-center mr-2"
                style={{
                  backgroundColor: isComplete
                    ? StatusColors[colorScheme].successBg
                    : acAlpha(accent, 500, 0.08),
                }}
              >
                <Ionicons
                  name={isComplete ? "checkmark-circle" : "flag-outline"}
                  size={16}
                  color={isComplete ? StatusColors[colorScheme].success : colors.blue}
                />
              </View>
            </Pressable>
            <View className="flex-1">
              <Text
                className="text-sm font-medium text-foreground"
                numberOfLines={1}
                style={isComplete ? { textDecorationLine: "line-through" } : {}}
              >
                {milestone.name}
              </Text>
              <View className="flex-row items-center flex-wrap">
                {milestone.start_financial_year && (
                  <Text className="text-xs text-muted-foreground mr-2">
                    FY {milestone.start_financial_year}
                    {(() => {
                      const yrs = milestone.duration_years || 0;
                      const mos = milestone.duration_months || 0;
                      if (yrs > 0 && mos > 0) return `, ${yrs}yr ${mos}mo`;
                      if (yrs > 1) return `, ${yrs}yr`;
                      if (mos > 0) return `, ${mos}mo`;
                      return "";
                    })()}
                  </Text>
                )}
                {milestone.target_date && (
                  <Text className="text-xs text-muted-foreground">
                    Due: {milestone.target_date}
                  </Text>
                )}
              </View>
              {(() => {
                const totalMo = getMilestoneTotalMonths(milestone);
                if (totalMo <= 1) return null;
                const monthly = milestone.target_amount / totalMo;
                return (
                  <Text className="text-xs" style={{ color: accent[500] }}>
                    {formatAmount(monthly)}/month
                  </Text>
                );
              })()}
            </View>
          </View>
          <Pressable onPress={onEdit} hitSlop={8}>
            <Ionicons name="create-outline" size={16} color={colors.textSecondary} />
          </Pressable>
        </View>

        {/* Saved / Target / Left */}
        <View className="flex-row mb-2">
          <View className="flex-1">
            <Text className="text-xs text-muted-foreground">
              Saved
            </Text>
            <Text className="text-sm font-semibold text-success">
              {formatAmount(milestone.current_saved)}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-xs text-muted-foreground">
              Target
            </Text>
            <Text className="text-sm font-semibold text-foreground">
              {formatAmount(milestone.target_amount)}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-xs text-muted-foreground">
              Left
            </Text>
            <Text className="text-sm font-semibold text-danger">
              {formatAmount(remaining)}
            </Text>
          </View>
        </View>

        {/* Progress bar */}
        <View className="h-2 rounded-full bg-border overflow-hidden">
          <View
            className="h-2 rounded-full"
            style={{
              width: `${pct}%`,
              backgroundColor: isComplete ? StatusColors[colorScheme].success : colors.blue,
            }}
          />
        </View>

        {/* Footer: % + monthly needed */}
        <View className="flex-row items-center justify-between mt-1">
          <Text className="text-xs text-faint-foreground">{pct.toFixed(0)}%</Text>
          {monthlyNeeded != null && !isComplete && (
            <Text className="text-xs text-muted-foreground">
              Need {formatAmount(monthlyNeeded)}/mo
            </Text>
          )}
        </View>

        {/* Current FY progress */}
        {fyLabel && fyPlanned != null && fyPlanned > 0 && !isComplete && (
          <View
            className="mt-2 pt-2 border-t border-border flex-row items-center justify-between"
          >
            <Text className="text-xs text-muted-foreground">
              {fyLabel}
            </Text>
            <Text className="text-xs font-medium" style={{ color: accent[500] }}>
              {formatCompact(fyActual ?? 0)} of {formatCompact(fyPlanned)}
            </Text>
          </View>
        )}

        {/* Realistic projection (from cockpit) */}
        {realityStatus && !isComplete && realityStatus.monthlyRealistic > 0 && (
          <View className="mt-2 pt-2 border-t border-border">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center">
                <Ionicons name="calendar-outline" size={12} color={colors.textSecondary} style={{ marginRight: 4 }} />
                <Text className="text-xs text-muted-foreground">
                  Plan: {formatAmount(realityStatus.monthlyPlanned)}/mo
                </Text>
              </View>
              {realityStatus.plannedCompletionDate && (
                <Text className="text-xs text-muted-foreground">
                  → {realityStatus.plannedCompletionDate}
                </Text>
              )}
            </View>
            <View className="flex-row items-center justify-between mt-1">
              <View className="flex-row items-center">
                <Ionicons
                  name="pulse-outline"
                  size={12}
                  color={realityStatus.slippageMonths > 2 ? StatusColors[colorScheme].warning : StatusColors[colorScheme].success}
                  style={{ marginRight: 4 }}
                />
                <Text
                  className="text-xs font-medium"
                  style={{
                    color: realityStatus.slippageMonths > 2
                      ? StatusColors[colorScheme].warning
                      : StatusColors[colorScheme].success,
                  }}
                >
                  Reality: {formatAmount(realityStatus.monthlyRealistic)}/mo
                </Text>
              </View>
              {realityStatus.realisticCompletionDate && (
                <Text
                  className="text-xs font-medium"
                  style={{
                    color: realityStatus.slippageMonths > 2
                      ? StatusColors[colorScheme].warning
                      : StatusColors[colorScheme].success,
                  }}
                >
                  → {realityStatus.realisticCompletionDate}
                  {realityStatus.slippageMonths > 0
                    ? ` (${realityStatus.slippageMonths}mo late)`
                    : ""
                  }
                </Text>
              )}
            </View>
            {/* Linked buckets */}
            {realityStatus.linkedBucketNames.length > 0 && (
              <View className="flex-row items-center mt-1.5">
                <Ionicons name="link-outline" size={10} color={colors.textSecondary} style={{ marginRight: 4 }} />
                <Text className="text-xs text-faint-foreground" numberOfLines={1}>
                  Fed by: {realityStatus.linkedBucketNames.join(", ")}
                </Text>
              </View>
            )}
          </View>
        )}
      </Card>
    </Pressable>
  );
}
