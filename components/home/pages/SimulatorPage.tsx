import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Modal,
  KeyboardAvoidingView,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAlert } from "@/hooks/use-alert";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";
import { StatusColors } from "@/constants/theme";
import { ac } from "@/utils/accent";
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
  duplicateScenario,
  updateScenario,
} from "@/services/simulator";
import type { SimulationScenario, ScenarioOverview } from "@/services/simulator";

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

export function SimulatorPage() {
  const router = useRouter();
  const alert = useAlert();
  const { colors, accent, colorScheme } = useColorScheme();
  const sc = StatusColors[colorScheme];

  const [active, setActive] = useState<ScenarioCardData[]>([]);
  const [archived, setArchived] = useState<SimulationScenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [createSheetVisible, setCreateSheetVisible] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    try {
      await purgeRetention(DEFAULT_USER_ID);
      const [activeList, archivedList] = await Promise.all([
        listActiveScenarios(DEFAULT_USER_ID),
        listArchivedScenarios(DEFAULT_USER_ID, 90),
      ]);
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

  useDataRefresh(load);

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
    async (scenarioId: string) => {
      try {
        const id = await duplicateScenario(scenarioId);
        await load();
        router.push(`/simulator/${id}` as never);
      } catch (e) {
        alert("Couldn't duplicate", e instanceof Error ? e.message : String(e));
      }
    },
    [load, alert, router],
  );

  const handleArchive = useCallback(
    (s: SimulationScenario) => {
      alert(
        "Archive scenario?",
        `"${s.name}" will move to the archived list. You can still view it for 90 days.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Archive",
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
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.textSecondary} />
        <Text className="text-sm mt-2" style={{ color: colors.textSecondary }}>
          Loading simulator…
        </Text>
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
        {showEmptyState ? (
          <View className="items-center justify-center px-6 pt-20 pb-8">
            <View
              className="w-16 h-16 rounded-full items-center justify-center mb-4"
              style={{ backgroundColor: ac(accent, colorScheme, 50, 900) }}
            >
              <Ionicons name="pulse-outline" size={32} color={accent[500]} />
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
              style={{ backgroundColor: accent[500] }}
              accessibilityRole="button"
              accessibilityLabel="Create your first scenario"
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text className="text-sm font-semibold text-white ml-1.5">
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
              const hisaabNet = (overview?.hisaabIncluded ?? []).reduce(
                (s, h) => s + (h.amount_sign === "positive" ? h.amount : -h.amount),
                0,
              );
              const netWorthEnd = (overview?.simulation.netWorthEnd ?? 0) + hisaabNet;
              const netWorthStart = (overview?.simulation.netWorthStart ?? 0) + hisaabNet;
              const delta = netWorthEnd - netWorthStart;
              const deltaColor = delta >= 0 ? sc.success : sc.danger;
              const warnings = overview?.simulation.warnings ?? [];

              return (
                <Card key={scenario.id} className="mx-4 mt-2">
                  <Pressable onPress={() => handleOpenScenario(scenario.id)} accessibilityRole="button">
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
                          style={{ backgroundColor: ac(accent, colorScheme, 100, 800) }}
                        >
                          <Text className="text-[9px] font-semibold" style={{ color: accent[500] }}>
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
                          style={{ backgroundColor: sc.danger + "14" }}
                        >
                          <Ionicons name="warning-outline" size={10} color={sc.danger} />
                          <Text className="text-[9px] font-semibold ml-1" style={{ color: sc.danger }}>
                            {warnings.length} {warnings.length === 1 ? "issue" : "issues"}
                          </Text>
                        </View>
                      )}
                    </View>

                    <View className="mt-4 flex-row items-end justify-between">
                      <View className="flex-1">
                        <Text
                          className="text-[10px] font-semibold uppercase"
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
                          className="text-[10px] font-semibold uppercase"
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
                        <Text className="text-[10px] font-semibold ml-1" style={{ color: deltaColor }}>
                          {delta >= 0 ? "+" : ""}
                          {formatAmount(Math.round(delta))}
                        </Text>
                      </View>
                    </View>
                  </Pressable>

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
                      className="flex-1 py-2 items-center rounded-lg"
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                      accessibilityLabel="Archive scenario"
                    >
                      <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
                        Archive
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleDelete(scenario)}
                      className="flex-1 py-2 items-center rounded-lg"
                      style={{ backgroundColor: sc.danger + "14" }}
                      accessibilityLabel="Delete scenario"
                    >
                      <Text className="text-xs font-semibold" style={{ color: sc.danger }}>
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
              style={{ backgroundColor: accent[500] }}
              accessibilityRole="button"
              accessibilityLabel="Create new scenario"
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text className="text-sm font-semibold text-white ml-1.5">
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
              accessibilityLabel={showArchived ? "Hide archived" : "Show archived"}
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
                Archived · {archived.length}
              </Text>
            </Pressable>
            {showArchived && archived.map((s) => (
              <View key={s.id} style={{ opacity: 0.7 }}>
                <Card className="mx-4 mt-2">
                  <Pressable onPress={() => handleOpenScenario(s.id)}>
                    <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                      {s.name}
                    </Text>
                    <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                      Horizon · {prettyDate(s.horizon_date)}
                    </Text>
                  </Pressable>
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
    </View>
  );
}

// ── NewScenarioSheet (inline) ──

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
  const { colors, accent, colorScheme } = useColorScheme();
  const insets = useSafeAreaInsets();
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
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable
        className="flex-1 bg-black/40"
        onPress={onClose}
        accessibilityLabel="Close"
      />
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={0}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
      >
        <View
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: "92%",
            paddingBottom: Math.max(insets.bottom, 8),
          }}
        >
          <View className="items-center pt-3 pb-1">
            <View className="w-10 h-1 rounded-full bg-border" />
          </View>
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
                      backgroundColor: copyFrom === null ? ac(accent, colorScheme, 500, 300) + "26" : colors.surface,
                      borderWidth: 1,
                      borderColor: copyFrom === null ? ac(accent, colorScheme, 500, 300) : colors.border,
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: copyFrom === null }}
                  >
                    <Text className="text-xs font-semibold" style={{ color: copyFrom === null ? colors.text : colors.textSecondary }}>
                      Start fresh
                    </Text>
                  </Pressable>
                  {existingScenarios.map((s) => {
                    const isActive = copyFrom === s.id;
                    return (
                      <Pressable
                        key={s.id}
                        onPress={() => setCopyFrom(s.id)}
                        className="px-3 py-2 rounded-full"
                        style={{
                          backgroundColor: isActive ? ac(accent, colorScheme, 500, 300) + "26" : colors.surface,
                          borderWidth: 1,
                          borderColor: isActive ? ac(accent, colorScheme, 500, 300) : colors.border,
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isActive }}
                      >
                        <Text className="text-xs font-semibold" style={{ color: isActive ? colors.text : colors.textSecondary }} numberOfLines={1}>
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
              style={{ backgroundColor: accent[500], opacity: canSave ? 1 : 0.5 }}
            >
              <Text className="text-sm font-semibold text-white">Create</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

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
    </Modal>
  );
}
