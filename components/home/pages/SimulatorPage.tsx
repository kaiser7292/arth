import { useCallback, useEffect, useState } from "react";
import { View, Pressable, ScrollView, ActivityIndicator, TextInput } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, LoadingState, Sheet, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";


import { logger } from "@/utils/logger";
import { CalendarModal } from "@/components/ui/CalendarModal";
import {
  listActiveScenarios,
  listArchivedScenarios,
  createScenario,
  seedScenarioFromReminders,
  purgeRetention,
  getScenarioOverviewsBatch,
  deleteScenario,
  archiveScenario,
  restoreScenario,
  duplicateScenario,
  duplicateScenarioFullSetup,
  updateScenario,
} from "@/services/simulator";
import type { SimulationScenario, ScenarioOverview } from "@/services/simulator";
import { useTheme } from "@/hooks/use-theme";

/**
 * Scenario list — entry point from the Home card.
 * Lazy-initialises the default scenario on first mount.
 */

function endOfMonthIso(): string {
  const d = new Date();
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return last.toISOString().slice(0, 10);
}

function prettyDate(ymd: string): string {
  if (!ymd) return "";
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return ymd;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

interface ScenarioCardData {
  scenario: SimulationScenario;
  overview: ScenarioOverview | null;
}

/**
 * The cash-flow scenario list.
 *
 * The single implementation, rendered by the Home swipe-pager and by app/simulator/index.tsx.
 *
 * This body came from the ROUTE, which had become the superset: it grew a duplicate-scenario
 * modal offering "upcoming only" vs "full setup", while the pager copy still called
 * duplicateScenario directly and silently lacked the choice. That is precisely the drift this
 * consolidation exists to stop.
 */
export function SimulatorPage() {
  const router = useRouter();
  const alert = useAlert();
  const { colors, colorScheme } = useColorScheme();
  const theme = useTheme();

  const [active, setActive] = useState<ScenarioCardData[]>([]);
  const [archived, setArchived] = useState<SimulationScenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [createSheetVisible, setCreateSheetVisible] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const [duplicatePending, setDuplicatePending] = useState<{ id: string; name: string } | null>(null);
  const [duplicateMode, setDuplicateMode] = useState<"upcoming" | "full">("upcoming");
  const [duplicating, setDuplicating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await purgeRetention(DEFAULT_USER_ID);
      // v16.0.4 — no longer auto-create a default scenario on open. Scenarios
      // are strictly user-initiated. The simulator home shows an empty state
      // until the user taps "+ New scenario".
      const [activeList, archivedList] = await Promise.all([
        listActiveScenarios(DEFAULT_USER_ID),
        listArchivedScenarios(DEFAULT_USER_ID, 90),
      ]);

      // v17.5.3 — batch overview fetch. Computes baseline once across all
      // scenarios instead of once per scenario (was 4 queries × N).
      const overviews = await getScenarioOverviewsBatch(
        activeList.map((s) => s.id),
        DEFAULT_USER_ID,
        { skipReconcile: true },
      );
      const cards: ScenarioCardData[] = activeList.map((s) => ({
        scenario: s,
        overview: overviews.get(s.id) ?? null,
      }));
      setActive(cards);
      setArchived(archivedList);
    } catch (e) {
      logger.warn("Simulator list load failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleOpenScenario = useCallback(
    (scenarioId: string) => {
      router.push(`/simulator/${scenarioId}` as never);
    },
    [router],
  );

  const handleCreate = useCallback(
    async (name: string, horizon: string, copyFromScenarioId: string | null) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        if (copyFromScenarioId) {
          // v16.0.1 — use duplicateScenario (copies upcoming entries only),
          // then rename + re-horizon the copy to what the user picked.
          const id = await duplicateScenario(copyFromScenarioId);
          await updateScenario(id, { name: trimmed, horizon_date: horizon });
          setCreateSheetVisible(false);
          router.push(`/simulator/${id}` as never);
        } else {
          const id = await createScenario(DEFAULT_USER_ID, { name: trimmed, horizon_date: horizon });
          await seedScenarioFromReminders(id, DEFAULT_USER_ID);
          setCreateSheetVisible(false);
          router.push(`/simulator/${id}` as never);
        }
      } catch (e) {
        alert("Couldn't create scenario", e instanceof Error ? e.message : String(e));
      }
    },
    [alert, router],
  );

  const handleDuplicate = useCallback(
    (scenarioId: string) => {
      const scenario = active.find((a) => a.scenario.id === scenarioId);
      setDuplicateMode("upcoming");
      setDuplicatePending({ id: scenarioId, name: scenario?.scenario.name ?? "Scenario" });
    },
    [active],
  );

  const executeDuplicate = useCallback(async () => {
    if (!duplicatePending) return;
    setDuplicating(true);
    try {
      const id = duplicateMode === "full"
        ? await duplicateScenarioFullSetup(duplicatePending.id)
        : await duplicateScenario(duplicatePending.id);
      setDuplicatePending(null);
      await load();
      router.push(`/simulator/${id}` as never);
    } catch (e) {
      alert("Couldn't duplicate", e instanceof Error ? e.message : String(e));
    } finally {
      setDuplicating(false);
    }
  }, [duplicatePending, duplicateMode, load, alert, router]);

  const handleArchive = useCallback(
    (s: SimulationScenario) => {
      alert(
        "Mark as done?",
        `"${s.name}" will move to the Completed list. You can restore it at any time.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Mark done",
            onPress: async () => {
              await archiveScenario(s.id);
              await load();
            },
          },
        ],
      );
    },
    [alert, load],
  );

  const handleDelete = useCallback(
    (s: SimulationScenario) => {
      alert(
        "Delete scenario?",
        `"${s.name}" and all its planned entries will be permanently removed.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              await deleteScenario(s.id);
              await load();
            },
          },
        ],
      );
    },
    [alert, load],
  );

  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        <LoadingState message="Loading simulator…" icon="pulse-outline" />
      </View>
    );
  }

  const showEmptyState = active.length === 0;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 64 }}
      >
        {/* v16.0.5 — empty state for a fresh simulator home. */}
        {showEmptyState ? (
          <View className="items-center justify-center px-6 pt-20 pb-8">
            <View
              className="w-16 h-16 rounded-full items-center justify-center mb-4"
              style={{ backgroundColor: theme.alpha("primary", 0.1) }}
            >
              <Ionicons name="pulse-outline" size={32} color={theme.primary} />
            </View>
            <Text className="text-lg font-bold text-center" style={{ color: colors.text }}>
              Plan your next month
            </Text>
            <Text className="text-sm text-center mt-2 leading-5" style={{ color: colors.textSecondary }}>
              Add outgoings and incomings you expect; Arth projects where your
              balances will land. Your real ledger is never touched.
            </Text>
            <Pressable
              onPress={() => setCreateSheetVisible(true)}
              className="mt-6 py-3 px-6 rounded-xl flex-row items-center"
              style={{ backgroundColor: theme.primary }}
              accessibilityRole="button"
              accessibilityLabel="Create your first scenario"
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text className="text-sm font-semibold text-primary-foreground ml-1.5">
                New scenario
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View className="px-4 pt-3 pb-1">
              <Text className="text-sm" style={{ color: colors.textSecondary }}>
                Plan what you expect to happen. See where your accounts will
                land. Your real ledger is never touched.
              </Text>
            </View>

            <View className="mx-4 mt-5 mb-2">
              <Text
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: colors.textSecondary }}
              >
                Active scenarios · {active.length}
              </Text>
            </View>

            {active.map(({ scenario, overview }) => {
              // v16.0.5 — fold hisaab inclusions into the preview numbers
              // so list cards agree with the detail screen. Inclusion net
              // is constant across the window (not a cash-flow event), so
              // it lifts start and end by the same amount.
              const hisaabNet = (overview?.hisaabIncluded ?? []).reduce(
                (s, h) => s + (h.amount_sign === "positive" ? h.amount : -h.amount),
                0,
              );
              const netWorthEnd = (overview?.simulation.netWorthEnd ?? 0) + hisaabNet;
              const netWorthStart = (overview?.simulation.netWorthStart ?? 0) + hisaabNet;
              const delta = netWorthEnd - netWorthStart;
              const deltaColor = delta >= 0 ? theme.success : theme.danger;
              const warnings = overview?.simulation.warnings ?? [];

              return (
                <Card key={scenario.id} className="mx-4 mt-2">
                  <Pressable onPress={() => handleOpenScenario(scenario.id)} accessibilityRole="button">
                    {/* Header — name, default chip, horizon, warning chip */}
                    <View className="flex-row items-center">
                      <Text
                        className="text-base font-bold flex-1"
                        style={{ color: colors.text }}
                        numberOfLines={1}
                      >
                        {scenario.name}
                      </Text>
                      {scenario.is_default === 1 && (
                        <View
                          className="ml-2 px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: theme.alpha("primary", 0.1) }}
                        >
                          <Text className="text-label font-semibold" style={{ color: theme.primary }}>
                            DEFAULT
                          </Text>
                        </View>
                      )}
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={colors.textSecondary}
                        style={{ marginLeft: 6 }}
                      />
                    </View>

                    <View className="flex-row items-center mt-1">
                      <Text className="text-xs" style={{ color: colors.textSecondary }}>
                        Until {prettyDate(scenario.horizon_date)}
                      </Text>
                      {warnings.length > 0 && (
                        <View
                          className="ml-2 flex-row items-center px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: theme.danger + "14" }}
                        >
                          <Ionicons name="warning-outline" size={10} color={theme.danger} />
                          <Text className="text-label font-semibold ml-1" style={{ color: theme.danger }}>
                            {warnings.length} {warnings.length === 1 ? "issue" : "issues"}
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Hero — today → horizon */}
                    <View className="mt-4 flex-row items-end justify-between">
                      <View className="flex-1">
                        <Text
                          className="text-label font-semibold uppercase"
                          style={{ color: colors.textSecondary, letterSpacing: 0.5 }}
                          numberOfLines={1}
                        >
                          Today
                        </Text>
                        <Text className="text-sm font-semibold mt-0.5" style={{ color: colors.text }} numberOfLines={1}>
                          {formatAmount(netWorthStart)}
                        </Text>
                      </View>
                      <Ionicons name="arrow-forward" size={14} color={colors.textSecondary} style={{ marginBottom: 2, marginHorizontal: 6 }} />
                      <View className="flex-1 items-end">
                        <Text
                          className="text-label font-semibold uppercase"
                          style={{ color: colors.textSecondary, letterSpacing: 0.5 }}
                          numberOfLines={1}
                        >
                          {prettyDate(scenario.horizon_date)}
                        </Text>
                        <Text className="text-xl font-bold mt-0.5" style={{ color: colors.text }} numberOfLines={1}>
                          {formatAmount(netWorthEnd)}
                        </Text>
                      </View>
                    </View>
                    <View className="mt-2 flex-row items-center">
                      <View
                        className="px-2 py-0.5 rounded-full flex-row items-center"
                        style={{ backgroundColor: deltaColor + "14" }}
                      >
                        <Ionicons
                          name={delta >= 0 ? "arrow-up" : "arrow-down"}
                          size={10}
                          color={deltaColor}
                        />
                        <Text className="text-label font-semibold ml-1" style={{ color: deltaColor }}>
                          {delta >= 0 ? "+" : ""}
                          {formatAmount(Math.round(delta))}
                        </Text>
                      </View>
                    </View>
                  </Pressable>

                  {/* Secondary actions — always visible. v16.0.5:
                      no more default-scenario exemption; any active scenario
                      can be duplicated / archived / deleted from the list. */}
                  <View className="flex-row mt-4 gap-2 pt-3 border-t border-border">
                    <Pressable
                      onPress={() => handleDuplicate(scenario.id)}
                      className="flex-1 py-2 items-center rounded-lg"
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                      accessibilityLabel="Duplicate scenario"
                    >
                      <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
                        Duplicate
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleArchive(scenario)}
                      className="flex-1 py-2 items-center rounded-lg flex-row justify-center gap-1"
                      style={{ backgroundColor: theme.success + "14", borderWidth: 1, borderColor: theme.success + "40" }}
                      accessibilityLabel="Mark scenario as done"
                    >
                      <Ionicons name="checkmark" size={13} color={theme.success} />
                      <Text className="text-xs font-semibold" style={{ color: theme.success }}>
                        Mark done
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleDelete(scenario)}
                      className="flex-1 py-2 items-center rounded-lg"
                      style={{ backgroundColor: theme.danger + "14" }}
                      accessibilityLabel="Delete scenario"
                    >
                      <Text className="text-xs font-semibold" style={{ color: theme.danger }}>
                        Delete
                      </Text>
                    </Pressable>
                  </View>
                </Card>
              );
            })}

            <Pressable
              onPress={() => setCreateSheetVisible(true)}
              className="mx-4 mt-4 py-3 rounded-xl items-center flex-row justify-center"
              style={{ backgroundColor: theme.primary }}
              accessibilityRole="button"
              accessibilityLabel="Create new scenario"
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text className="text-sm font-semibold text-primary-foreground ml-1.5">
                New scenario
              </Text>
            </Pressable>
          </>
        )}

        {archived.length > 0 && (
          <View className="mt-6">
            <Pressable
              onPress={() => setShowArchived((v) => !v)}
              className="mx-4 flex-row items-center"
              accessibilityRole="button"
              accessibilityLabel={showArchived ? "Hide completed" : "Show completed"}
            >
              <Ionicons
                name={showArchived ? "chevron-down" : "chevron-forward"}
                size={14}
                color={colors.textSecondary}
              />
              <Text
                className="ml-1 text-xs font-semibold uppercase tracking-wider"
                style={{ color: colors.textSecondary }}
              >
                Completed · {archived.length}
              </Text>
            </Pressable>
            {showArchived && archived.map((s) => (
              <View key={s.id} style={{ opacity: 0.8 }}>
                <Card className="mx-4 mt-2">
                  <View className="flex-row items-center">
                    <View
                      className="w-6 h-6 rounded-full items-center justify-center mr-3"
                      style={{ backgroundColor: theme.success + "22" }}
                    >
                      <Ionicons name="checkmark" size={13} color={theme.success} />
                    </View>
                    <Pressable className="flex-1" onPress={() => handleOpenScenario(s.id)}>
                      <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                        {s.name}
                      </Text>
                      <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                        Horizon · {prettyDate(s.horizon_date)}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={async () => { await restoreScenario(s.id); await load(); }}
                      className="px-3 py-1.5 rounded-lg ml-2"
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                      accessibilityLabel="Restore scenario"
                    >
                      <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
                        Restore
                      </Text>
                    </Pressable>
                  </View>
                </Card>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <NewScenarioSheet
        visible={createSheetVisible}
        existingScenarios={active.map((c) => c.scenario)}
        onCreate={handleCreate}
        onClose={() => setCreateSheetVisible(false)}
      />

      {/* Duplicate mode picker */}
      <Sheet visible={duplicatePending !== null} onClose={() => setDuplicatePending(null)}>
        <View className="px-5">
          <Text className="text-base font-bold text-foreground pt-2 pb-4">
            Duplicate "{duplicatePending?.name}"
          </Text>

          {(["upcoming", "full"] as const).map((mode) => {
            const isActive = duplicateMode === mode;
            return (
              <Pressable
                key={mode}
                onPress={() => setDuplicateMode(mode)}
                className="flex-row items-start p-4 rounded-xl mb-3"
                style={{
                  backgroundColor: isActive ? theme.alpha("primary", 0.07) : colors.surface,
                  borderWidth: 1.5,
                  borderColor: isActive ? theme.primary : colors.border,
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: isActive }}
              >
                <View
                  className="w-5 h-5 rounded-full border-2 items-center justify-center mt-0.5 mr-3"
                  style={{ borderColor: isActive ? theme.primary : colors.border, backgroundColor: isActive ? theme.primary : "transparent" }}
                >
                  {isActive && <View className="w-2 h-2 rounded-full bg-white" />}
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold" style={{ color: isActive ? theme.primary : colors.text }}>
                    {mode === "upcoming" ? "Upcoming only" : "Full setup"}
                  </Text>
                  <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                    {mode === "upcoming"
                      ? "Copy only future entries. Dates keep as-is."
                      : "Copy all entries and reset them to upcoming."}
                  </Text>
                </View>
              </Pressable>
            );
          })}

          <View className="flex-row gap-3 pt-1">
            <Pressable
              onPress={() => setDuplicatePending(null)}
              className="flex-1 py-3 rounded-xl items-center border border-border"
              style={{ backgroundColor: colors.surface }}
            >
              <Text className="text-sm font-semibold text-muted-foreground">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={executeDuplicate}
              disabled={duplicating}
              className="flex-1 py-3 rounded-xl items-center"
              style={{ backgroundColor: theme.primary, opacity: duplicating ? 0.6 : 1 }}
            >
              <Text className="text-sm font-semibold text-primary-foreground">{duplicating ? "Copying…" : "Duplicate"}</Text>
            </Pressable>
          </View>
        </View>
      </Sheet>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// NewScenarioSheet (inline)
// ═══════════════════════════════════════════════════════════════════════

function NewScenarioSheet({
  visible,
  existingScenarios,
  onCreate,
  onClose,
}: {
  visible: boolean;
  existingScenarios: SimulationScenario[];
  onCreate: (name: string, horizon: string, copyFromScenarioId: string | null) => void;
  onClose: () => void;
}) {
  const { colors, colorScheme } = useColorScheme();
  const theme = useTheme();
  const [name, setName] = useState("");
  const [horizon, setHorizon] = useState(endOfMonthIso());
  const [picker, setPicker] = useState(false);
  const [copyFrom, setCopyFrom] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName("");
      setHorizon(endOfMonthIso());
      setCopyFrom(null);
    }
  }, [visible]);

  if (!visible) return null;

  const canSave = name.trim().length > 0;
  const copyFromScenario = copyFrom
    ? existingScenarios.find((s) => s.id === copyFrom) ?? null
    : null;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="px-5 pb-3">
        <Text className="text-base font-bold" style={{ color: colors.text }}>
          New scenario
        </Text>
        <Text className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>
          {copyFromScenario
            ? `Will be a copy of "${copyFromScenario.name}"`
            : "Starts fresh, seeded with your active reminders + open CC bills."}
        </Text>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 8 }}
      >
      <View className="px-5 pb-3">
        <Text
          className="text-xs font-semibold uppercase tracking-wider mb-2"
          style={{ color: colors.textSecondary }}
        >
          Name
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. With Goa trip"
          placeholderTextColor={colors.textSecondary}
          className="border border-border rounded-lg px-3 py-3 text-sm"
          style={{ color: colors.text }}
        />
      </View>
      <View className="px-5 pb-3">
        <Text
          className="text-xs font-semibold uppercase tracking-wider mb-2"
          style={{ color: colors.textSecondary }}
        >
          Horizon
        </Text>
        <Pressable
          onPress={() => setPicker(true)}
          className="flex-row items-center justify-between border border-border rounded-lg px-3 py-3"
        >
          <Text className="text-sm" style={{ color: colors.text }}>
            {prettyDate(horizon)}
          </Text>
          <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* v16.0.1 — copy entries from an existing scenario */}
      {existingScenarios.length > 0 && (
        <View className="px-5 pb-3">
          <Text
            className="text-xs font-semibold uppercase tracking-wider mb-2"
            style={{ color: colors.textSecondary }}
          >
            Copy entries from (optional)
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Pressable
              onPress={() => setCopyFrom(null)}
              className="px-3 py-2 rounded-full"
              style={{
                backgroundColor: copyFrom === null ? theme.primary + "26" : colors.surface,
                borderWidth: 1,
                borderColor: copyFrom === null ? theme.primary : colors.border,
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: copyFrom === null }}
            >
              <Text className="text-xs font-semibold" style={{ color: copyFrom === null ? colors.text : colors.textSecondary }}>
                Start fresh
              </Text>
            </Pressable>
            {existingScenarios.map((s) => {
              const active = copyFrom === s.id;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setCopyFrom(s.id)}
                  className="px-3 py-2 rounded-full"
                  style={{
                    backgroundColor: active ? theme.primary + "26" : colors.surface,
                    borderWidth: 1,
                    borderColor: active ? theme.primary : colors.border,
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text className="text-xs font-semibold" style={{ color: active ? colors.text : colors.textSecondary }} numberOfLines={1}>
                    {s.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
      </ScrollView>

      <View className="flex-row px-5 pt-3 gap-3">
        <Pressable
          onPress={onClose}
          className="flex-1 py-3 rounded-xl items-center"
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
        >
          <Text className="text-sm font-semibold" style={{ color: colors.textSecondary }}>
            Cancel
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onCreate(name, horizon, copyFrom)}
          disabled={!canSave}
          className="flex-1 py-3 rounded-xl items-center"
          style={{ backgroundColor: theme.primary, opacity: canSave ? 1 : 0.5 }}
        >
          <Text className="text-sm font-semibold text-primary-foreground">Create</Text>
        </Pressable>
      </View>

      <CalendarModal
        visible={picker}
        onClose={() => setPicker(false)}
        value={horizon}
        onChange={(d) => {
          setHorizon(d);
          setPicker(false);
        }}
        minimumDate={new Date()}
        maximumDate={null}
      />
    </Sheet>
  );
}
