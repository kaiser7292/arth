import { useState, useCallback, useRef } from "react";

import { DEFAULT_USER_ID } from "@/constants/app";
import { useBackOverride } from "@/hooks/use-back-override";
import { View, ScrollView, Pressable, KeyboardAvoidingView } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, Chip, DateInput, FAB, Input, LoadingState, ProgressBar, ScreenContainer, Segmented, Text } from "@/components/ui";
import { StatTile } from "@/components/ui/LinkRow";
import { FoldGroup, FormFooter, FormGroup } from "@/components/ui/FormParts";
import { tint } from "@/constants/brand";


import {
  getLifeMilestones,
  createLifeMilestone,
  updateLifeMilestone,
  deleteLifeMilestone,
  resetLifeMilestone,
  getMilestoneContributionForFY,
  getCombinedMilestoneActualsByIdForFY,
  getMilestoneTotalMonths,
  getMilestoneMonthlyNeeded,
  compareMilestonesByDueDate,
} from "@/services/life-milestone";
import type { LifeMilestone } from "@/services/life-milestone";
import { getCurrentFY, getFYRange, getFYLabel, formatLocalDate } from "@/utils/fiscal-year";
import { getFYStartMonth, getDataVersion } from "@/services/settings";
import { formatCompact } from "@/utils/format";
import { formatAmount } from "@/utils/expense-validation";
import { getFinancialCockpit } from "@/services/financial-cockpit";
import type { MilestoneStatus } from "@/utils/financial-cockpit";
import { consumeGoalsPreload } from "@/services/home-preload";
import { useTheme } from "@/hooks/use-theme";
import { todayIso } from "@/utils/local-date";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";

type ViewMode = "list" | "add_milestone";
type DurationUnit = "years" | "months";

export default function MilestonesScreen() {
  const router = useRouter();
  const alert = useAlert();
  const theme = useTheme();
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
  const lastVersionRef = useRef<string | null>(null);
  // The goals preload cache is NON-destructive and is filled once at app start, so
  // `consumeGoalsPreload()` keeps handing back the same app-start snapshot forever.
  // Honour it for the very first paint only; every later load must hit the DB, or a
  // milestone created in this session never shows up until the app is restarted.
  const preloadUsedRef = useRef(false);

  const [loadFailed, setLoadFailed] = useState(false);
  const loadData = useCallback(async () => {
    // Stamp includes what is being VIEWED, not just the data version. Version alone asks
    // "has anything been written?" - and changing the period writes nothing, so the guard
    // swallowed the reload and left the previous period's figures on screen.
    const stamp = `${getDataVersion()}|${currentFY}|${startMonth}`;
    if (lastVersionRef.current === stamp) return;
    lastVersionRef.current = stamp;
    try {
      const preload = preloadUsedRef.current ? null : consumeGoalsPreload();
      const usePreload = preload != null && preload.fy === String(currentFY);
      if (usePreload) preloadUsedRef.current = true;

      // This screen lists EVERY milestone (active + completed, all FYs), so it must
      // always use getLifeMilestones. preload.fyMilestones is getMilestonesForFY --
      // filtered to is_completed = 0 AND the current FY's plan window -- and using it
      // here silently hid every milestone outside the current FY.
      const [data, cd] = await Promise.all([
        getLifeMilestones(DEFAULT_USER_ID),
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
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
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
      alert("Missing name", "Enter a milestone name.");
      return;
    }
    if (isNaN(target) || target <= 0) {
      alert("Invalid target", "Enter a valid target amount.");
      return;
    }

    const monthlyPlan = parseFloat(formMonthlyPlan) || 0;
    const targetDate = formTargetDate.trim() || undefined;
    const startFY = formStartFY.trim() || undefined;
    const durationYears = parseInt(formDurationYears, 10) || 0;
    const durationMonths = parseInt(formDurationMonths, 10) || 0;

    if (durationYears === 0 && durationMonths === 0) {
      alert("Invalid duration", "Duration must be at least 1 month.");
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
        text: "Reset progress",
        onPress: () => {
          alert(
            "Reset progress",
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
            "Delete milestone",
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
        ? todayIso()
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

  // Soonest-due first — an explicit target_date wins, falling back to the
  // FY+duration plan's end month when no date was set. Milestones with
  // neither keep their manual sort_order, ordered after every dated one.
  const activeMilestones = milestones
    .filter((m) => !m.is_completed)
    .sort((a, b) => compareMilestonesByDueDate(a, b));
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
        {loadFailed && <LoadFailedBanner onRetry={loadData} />}
        <LoadingState message="Loading milestones..." icon="flag-outline" />
      </ScreenContainer>
    );
  }

  // ─── Add/Edit Form ───────────────────────────────────────

  if (viewMode === "add_milestone") {
    const yrs = parseInt(formDurationYears, 10) || 0;
    const mos = parseInt(formDurationMonths, 10) || 0;
    const totalMo = yrs * 12 + mos;
    const durationLabel = yrs > 0 && mos > 0 ? `${yrs}yr ${mos}mo` : yrs > 0 ? `${yrs}yr` : `${mos}mo`;
    return (
      <ScreenContainer padTop={false}>
        <Stack.Screen options={{ title: editingId ? "Edit milestone" : "Add milestone" }} />
        {loadFailed && <LoadFailedBanner onRetry={loadData} />}
        <KeyboardAvoidingView behavior="padding" className="flex-1">
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
            <View className="px-4 py-4" style={{ gap: 12 }}>
              <FormGroup icon="flag-outline" title="The goal" hint="What it is and what it costs">
                <Input label="Name" value={formName} onChangeText={setFormName} placeholder="e.g. Car down payment" maxLength={50} />
                <Input
                  label="Target amount"
                  prefix="₹"
                  value={formTarget}
                  onChangeText={setFormTarget}
                  keyboardType="numeric"
                  formula
                  placeholder="700000"
                />
                <DateInput
                  label="Target date (optional)"
                  value={formTargetDate}
                  onChange={setFormTargetDate}
                  placeholder="e.g. 2028-03-31"
                  maximumDate={null}
                />
              </FormGroup>

              <FormGroup icon="calendar-outline" title="When you'll save for it" hint="The plan works out a monthly amount">
                <View>
                  <Text className="text-label font-semibold text-muted-foreground mb-1.5">Start financial year</Text>
                  <View className="flex-row items-center" style={{ gap: 8 }}>
                    <Pressable
                      onPress={() => setFormStartFY(String(parseInt(formStartFY, 10) - 1))}
                      className="w-11 h-11 rounded-control border border-border bg-card items-center justify-center"
                      accessibilityRole="button"
                      accessibilityLabel="Previous financial year"
                    >
                      <Ionicons name="chevron-back" size={18} color={theme.mutedForeground} />
                    </Pressable>
                    <View className="flex-1 h-11 rounded-control items-center justify-center" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                      <Text className="text-body font-semibold" style={{ color: theme.primary }}>
                        {getFYLabel(parseInt(formStartFY, 10), startMonth)}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => setFormStartFY(String(parseInt(formStartFY, 10) + 1))}
                      className="w-11 h-11 rounded-control border border-border bg-card items-center justify-center"
                      accessibilityRole="button"
                      accessibilityLabel="Next financial year"
                    >
                      <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                    </Pressable>
                  </View>
                </View>

                <View>
                  <Text className="text-label font-semibold text-muted-foreground mb-1.5">Duration</Text>
                  <Segmented<DurationUnit>
                    options={[
                      { value: "years", label: "Years" },
                      { value: "months", label: "Months" },
                    ]}
                    value={formDurationUnit}
                    onChange={(unit) => {
                      setFormDurationUnit(unit);
                      if (unit === "years") {
                        setFormDurationMonths("0");
                        if (formDurationYears === "0") setFormDurationYears("1");
                      } else {
                        setFormDurationYears("0");
                        if (formDurationMonths === "0") setFormDurationMonths("6");
                      }
                    }}
                  />
                  <View className="flex-row items-center mt-2.5" style={{ gap: 8 }}>
                    {(formDurationUnit === "years" ? ["1", "2", "3", "5", "10"] : ["3", "6", "9", "18"]).map((d) => {
                      const on =
                        formDurationUnit === "years"
                          ? formDurationYears === d && formDurationMonths === "0"
                          : formDurationMonths === d && formDurationYears === "0";
                      return (
                        <Chip
                          key={d}
                          label={`${d}${formDurationUnit === "years" ? "yr" : "mo"}`}
                          on={on}
                          onPress={() => {
                            if (formDurationUnit === "years") {
                              setFormDurationYears(d);
                              setFormDurationMonths("0");
                            } else {
                              setFormDurationMonths(d);
                              setFormDurationYears("0");
                            }
                          }}
                        />
                      );
                    })}
                    <Input
                      value={formDurationUnit === "years" ? formDurationYears : formDurationMonths}
                      onChangeText={(v) => {
                        if (formDurationUnit === "years") {
                          setFormDurationYears(v);
                          setFormDurationMonths("0");
                        } else {
                          setFormDurationMonths(v);
                          setFormDurationYears("0");
                        }
                      }}
                      keyboardType="numeric"
                      suffix={formDurationUnit === "years" ? "yr" : "mo"}
                      accessibilityLabel={formDurationUnit === "years" ? "Years" : "Months"}
                      containerClassName="flex-1"
                    />
                  </View>
                  {parseFloat(formTarget) > 0 && totalMo > 0 && (
                    <Text className="text-meta text-muted-foreground mt-2">
                      {durationLabel} → {formatAmount(parseFloat(formTarget) / totalMo)} a month
                    </Text>
                  )}
                </View>
              </FormGroup>

              <FoldGroup title="Your own monthly plan" sub="Optional · 1 field" icon="options-outline" defaultOpen={formMonthlyPlan !== ""}>
                <Input
                  label="Monthly contribution plan"
                  prefix="₹"
                  value={formMonthlyPlan}
                  onChangeText={setFormMonthlyPlan}
                  keyboardType="numeric"
                  formula
                  placeholder="15000"
                />
              </FoldGroup>
            </View>
          </ScrollView>
          <FormFooter primary={editingId ? "Save milestone" : "Add milestone"} onPrimary={handleSave} onCancel={resetForm} />
        </KeyboardAvoidingView>
      </ScreenContainer>
    );
  }

  // ─── Main List ───────────────────────────────────────────

  return (
    <ScreenContainer padTop={false}>
      {loadFailed && <LoadFailedBanner onRetry={loadData} />}
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 96 }}>
        <View className="px-4 py-3" style={{ gap: 12 }}>
          {/* Overall: saved and still to save */}
          {activeMilestones.length > 0 && (
            <View style={{ gap: 6 }}>
              <View className="flex-row" style={{ gap: 8 }}>
                <StatTile label="Saved" value={formatAmount(totalSaved)} />
                <StatTile label="Still to save" value={formatAmount(Math.max(totalTarget - totalSaved, 0))} />
              </View>
              {totalTarget > 0 && (
                <Text className="text-meta text-muted-foreground px-1">
                  {overallPct.toFixed(0)}% of {formatAmount(totalTarget)} across {activeMilestones.length}{" "}
                  {activeMilestones.length === 1 ? "milestone" : "milestones"}
                </Text>
              )}
            </View>
          )}

          {/* Empty State */}
          {milestones.length === 0 && (
            <Card>
              <View className="items-center py-4">
                <Ionicons name="flag-outline" size={48} color={theme.faintForeground} />
                <Text className="text-body font-semibold text-foreground mt-2">No milestones yet</Text>
                <Text className="text-meta text-muted-foreground mt-1 text-center px-4">Add your first life goal to start tracking</Text>
              </View>
            </Card>
          )}

          {activeMilestones.map((m, i) => (
            <MilestoneCard
              key={m.id}
              index={i}
              milestone={m}
              realityStatus={milestoneStatuses.find((ms) => ms.id === m.id) ?? null}
              fyLabel={getFYLabel(currentFY, startMonth)}
              fyPlanned={getMilestoneContributionForFY(m, String(currentFY))}
              fyActual={fyActuals.get(m.id) ?? 0}
              onPress={() => router.push({ pathname: "/goals/milestone-detail", params: { milestoneId: m.id } })}
              onLongPress={() => handleMilestoneActions(m)}
              onEdit={() => handleEdit(m)}
              onToggleComplete={() => handleToggleComplete(m)}
            />
          ))}

          {completedMilestones.length > 0 && (
            <>
              <Text className="text-label font-semibold tracking-wider uppercase text-muted-foreground mt-2">
                Completed · {completedMilestones.length}
              </Text>
              {completedMilestones.map((m, i) => (
                <MilestoneCard
                  key={m.id}
                  index={i}
                  milestone={m}
                  realityStatus={null}
                  onPress={() => router.push({ pathname: "/goals/milestone-detail", params: { milestoneId: m.id } })}
                  onLongPress={() => handleMilestoneActions(m)}
                  onEdit={() => handleEdit(m)}
                  onToggleComplete={() => handleToggleComplete(m)}
                />
              ))}
            </>
          )}

          {milestones.length > 0 && (
            <Text className="text-label text-faint-foreground text-center">Tap to open. Long-press to reset or delete.</Text>
          )}
        </View>
      </ScrollView>

      <FAB icon="add" label="Milestone" onPress={() => setViewMode("add_milestone")} />
    </ScreenContainer>
  );
}

// ─── Milestone Card Component ────────────────────────────

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2027-03-15" -> "Mar 2027 · 4 months left" (or "· date passed"). */
function whenLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [y, m] = iso.split("-").map(Number);
  if (!y || !m) return iso;
  const now = new Date();
  const left = (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth());
  const base = `${SHORT_MONTHS[m - 1]} ${y}`;
  if (left < 0) return `${base} · date passed`;
  if (left === 0) return `${base} · this month`;
  return `${base} · ${left} ${left === 1 ? "month" : "months"} left`;
}

function MilestoneCard({
  index,
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
  index: number;
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
  const theme = useTheme();
  const isComplete = milestone.is_completed === 1;
  const hasTarget = milestone.target_amount > 0;
  const pct = hasTarget ? Math.min((milestone.current_saved / milestone.target_amount) * 100, 100) : 0;
  const color = isComplete ? theme.success : theme.data.series[(index + 3) % theme.data.series.length];

  // Monthly saving still needed — via the milestone's effective due date
  // (target_date, or the FY+duration plan's end month as a fallback),
  // counting the current month as one you can still save in.
  const monthlyNeeded = getMilestoneMonthlyNeeded(milestone);

  const plan = (() => {
    const yrs = milestone.duration_years || 0;
    const mos = milestone.duration_months || 0;
    const dur = yrs > 0 && mos > 0 ? `${yrs}yr ${mos}mo` : yrs > 1 ? `${yrs}yr` : mos > 0 ? `${mos}mo` : "";
    return milestone.start_financial_year ? `FY ${milestone.start_financial_year}${dur ? `, ${dur}` : ""}` : null;
  })();
  const when = whenLabel(milestone.target_date) ?? plan ?? "No date set";

  const status: { label: string; tone: "success" | "warning" | "neutral" } = isComplete
    ? { label: "Done", tone: "success" }
    : !hasTarget
      ? { label: "No target yet", tone: "neutral" }
      : realityStatus && realityStatus.slippageMonths > 2
        ? { label: "Behind", tone: "warning" }
        : { label: "On track", tone: "success" };

  const totalMo = getMilestoneTotalMonths(milestone);
  const planMonthly = totalMo > 1 ? milestone.target_amount / totalMo : null;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className="rounded-card bg-card border border-border px-4 py-3.5"
      style={{ gap: 10 }}
      accessibilityRole="button"
      accessibilityLabel={`${milestone.name}, ${status.label}`}
      accessibilityHint="Long-press to reset or delete"
    >
      <View className="flex-row items-center" style={{ gap: 12 }}>
        <Pressable
          onPress={onToggleComplete}
          hitSlop={6}
          className="w-10 h-10 rounded-control items-center justify-center"
          style={{ backgroundColor: tint(color, 0.1) }}
          accessibilityRole="button"
          accessibilityLabel={isComplete ? "Mark as not done" : "Mark as done"}
        >
          <Ionicons name={isComplete ? "checkmark-circle" : "flag-outline"} size={19} color={color} />
        </Pressable>
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Text
            className="text-body font-bold text-foreground"
            numberOfLines={1}
            style={isComplete ? { textDecorationLine: "line-through" } : undefined}
          >
            {milestone.name}
          </Text>
          <Text className="text-meta text-muted-foreground" numberOfLines={1}>
            {when}
          </Text>
        </View>
        <Chip variant="status" className="self-center" tone={status.tone} label={status.label} />
        <Pressable onPress={onEdit} hitSlop={8} className="p-1" accessibilityRole="button" accessibilityLabel={`Edit ${milestone.name}`}>
          <Ionicons name="create-outline" size={18} color={theme.mutedForeground} />
        </Pressable>
      </View>

      {hasTarget && (
        <View style={{ gap: 6 }}>
          <ProgressBar value={pct / 100} color={color} height={6} animated={false} />
          <View className="flex-row justify-between">
            <Text className="text-meta font-semibold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
              {formatAmount(milestone.current_saved)}
              <Text className="text-meta text-muted-foreground"> of {formatAmount(milestone.target_amount)}</Text>
            </Text>
            <Text className="text-meta text-muted-foreground" numberOfLines={1}>
              {monthlyNeeded != null && !isComplete
                ? `${formatAmount(monthlyNeeded)} a month`
                : planMonthly != null
                  ? `${formatAmount(planMonthly)} a month plan`
                  : `${pct.toFixed(0)}%`}
            </Text>
          </View>
        </View>
      )}

      {/* This FY: put in so far against the plan */}
      {fyLabel && fyPlanned != null && fyPlanned > 0 && !isComplete && (
        <View className="flex-row items-center justify-between border-t border-border pt-2">
          <Text className="text-label text-muted-foreground">{fyLabel}</Text>
          <Text className="text-label font-semibold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
            {formatCompact(fyActual ?? 0)} of {formatCompact(fyPlanned)}
          </Text>
        </View>
      )}

      {/* Plan against how you're really saving (from the cockpit) */}
      {realityStatus && !isComplete && realityStatus.monthlyRealistic > 0 && (
        <View className="border-t border-border pt-2" style={{ gap: 2 }}>
          <View className="flex-row justify-between">
            <Text className="text-label text-muted-foreground">Plan {formatAmount(realityStatus.monthlyPlanned)} a month</Text>
            {realityStatus.plannedCompletionDate && (
              <Text className="text-label text-muted-foreground">→ {realityStatus.plannedCompletionDate}</Text>
            )}
          </View>
          <View className="flex-row justify-between">
            <Text className="text-label font-semibold" style={{ color: realityStatus.slippageMonths > 2 ? theme.warning : theme.success }}>
              Saving {formatAmount(realityStatus.monthlyRealistic)} a month
            </Text>
            {realityStatus.realisticCompletionDate && (
              <Text className="text-label font-semibold" style={{ color: realityStatus.slippageMonths > 2 ? theme.warning : theme.success }}>
                → {realityStatus.realisticCompletionDate}
                {realityStatus.slippageMonths > 0 ? ` (${realityStatus.slippageMonths}mo late)` : ""}
              </Text>
            )}
          </View>
          {realityStatus.linkedBucketNames.length > 0 && (
            <Text className="text-label text-faint-foreground" numberOfLines={1}>
              Fed by {realityStatus.linkedBucketNames.join(", ")}
            </Text>
          )}
        </View>
      )}
    </Pressable>
  );
}
