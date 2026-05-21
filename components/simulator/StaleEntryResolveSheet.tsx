import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import { formatAmount } from "@/utils/format";
import { todayIso, addDays } from "@/utils/date";
import { CalendarModal } from "@/components/ui/CalendarModal";
import type { SimulationEntry } from "@/services/simulator";
import { getDatabase } from "@/database";

interface Candidate {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  merchant: string | null;
}

interface Props {
  visible: boolean;
  entry: SimulationEntry | null;
  userId: string;
  onReschedule: (entryId: string, newDate: string) => void | Promise<void>;
  onLinkFulfillment: (entryId: string, expenseIds: string[]) => void | Promise<void>;
  onRemove: (entryId: string) => void | Promise<void>;
  onClose: () => void;
}

function prettyDate(ymd: string): string {
  if (!ymd) return "";
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return ymd;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function StaleEntryResolveSheet({
  visible,
  entry,
  userId,
  onLinkFulfillment,
  onReschedule,
  onRemove,
  onClose,
}: Props) {
  const { colors, accent, colorScheme } = useColorScheme();
  const slideAnim = useSharedValue(400);

  const [mode, setMode] = useState<"root" | "reschedule" | "link">("root");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [reschedulePickerVisible, setReschedulePickerVisible] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) return;
    setMode("root");
    setSelectedIds(new Set());
    slideAnim.value = withTiming(0, { duration: 240 });
  }, [visible, slideAnim]);

  const handleClose = useCallback(() => {
    slideAnim.value = withTiming(400, { duration: 180 }, () => {
      runOnJS(onClose)();
    });
  }, [slideAnim, onClose]);

  const loadCandidates = useCallback(async () => {
    if (!entry) return;
    setLoadingCandidates(true);
    try {
      const windowStart = addDays(entry.date, -7);
      const windowEnd = addDays(todayIso(), 1);
      const db = getDatabase();
      const rows = await db.getAllAsync<Candidate>(
        `SELECT id, date, amount, description, merchant_name as merchant
         FROM expenses
         WHERE user_id = ?
           AND nature IN ('realized','credit')
           AND deleted_at IS NULL
           AND date >= ?
           AND date <= ?
         ORDER BY ABS(amount - ?) ASC, ABS(julianday(date) - julianday(?)) ASC
         LIMIT 30;`,
        userId,
        windowStart,
        windowEnd,
        entry.amount,
        entry.date,
      );
      setCandidates(rows);
    } finally {
      setLoadingCandidates(false);
    }
  }, [entry, userId]);

  useEffect(() => {
    if (mode === "link") void loadCandidates();
  }, [mode, loadCandidates]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: slideAnim.value }],
  }));

  if (!visible || !entry) return null;

  const headerLabel =
    entry.description || entry.merchant_name || (entry.direction === "out" ? "Outgoing" : "Incoming");

  const selectedTotal = candidates
    .filter((c) => selectedIds.has(c.id))
    .reduce((s, c) => s + c.amount, 0);
  const variance = selectedTotal - entry.amount;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={handleClose}>
      <Pressable
        className="flex-1 bg-black/40"
        onPress={handleClose}
        accessibilityLabel="Close"
        accessibilityRole="button"
      />
      <Animated.View
        style={[
          animStyle,
          {
            backgroundColor: colors.surface,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: "85%",
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
          },
        ]}
        className="pb-8"
      >
        <View className="items-center pt-3 pb-1">
          <View className="w-10 h-1 rounded-full bg-border-light dark:bg-border-dark" />
        </View>

        <View className="px-5 pb-3">
          <Text className="text-base font-bold" style={{ color: colors.text }}>
            {headerLabel}
          </Text>
          <Text className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>
            {formatAmount(entry.amount)} planned for {prettyDate(entry.date)}
            {entry.date < todayIso() ? " · that date has passed" : ""}
          </Text>
        </View>

        {mode === "root" && (
          <View className="px-5 pb-4">
            <Pressable
              onPress={() => setMode("link")}
              className="flex-row items-center py-3 px-4 rounded-xl mb-2"
              style={{ backgroundColor: ac(accent, colorScheme, 50, 900), borderWidth: 1, borderColor: accent[500] + "55" }}
              accessibilityRole="button"
            >
              <Ionicons name="checkmark-circle-outline" size={20} color={accent[500]} />
              <View className="flex-1 ml-3">
                <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                  It happened — link to transactions
                </Text>
                <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                  Select one or more matching transactions from your ledger.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => setReschedulePickerVisible(true)}
              className="flex-row items-center py-3 px-4 rounded-xl mb-2"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
              accessibilityRole="button"
            >
              <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
              <View className="flex-1 ml-3">
                <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                  Reschedule
                </Text>
                <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                  It'll happen later than planned. Pick a new date.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Pressable>

            <Pressable
              onPress={async () => {
                await onRemove(entry.id);
                handleClose();
              }}
              className="flex-row items-center py-3 px-4 rounded-xl"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
              accessibilityRole="button"
            >
              <Ionicons name="trash-outline" size={20} color={"#DC2626"} />
              <View className="flex-1 ml-3">
                <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                  Remove
                </Text>
                <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                  It didn't happen and it won't.
                </Text>
              </View>
            </Pressable>
          </View>
        )}

        {mode === "link" && (
          <View className="px-5 pb-4">
            <Text className="text-xs mb-2" style={{ color: colors.textSecondary }}>
              Select transactions to link (closest matches shown):
            </Text>
            {loadingCandidates ? (
              <View className="items-center py-6">
                <ActivityIndicator color={colors.textSecondary} />
              </View>
            ) : candidates.length === 0 ? (
              <Text className="text-sm py-4" style={{ color: colors.textSecondary }}>
                No recent transactions to pick from. Try Reschedule or Remove.
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled>
                {candidates.map((c) => {
                  const isSelected = selectedIds.has(c.id);
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => toggleSelect(c.id)}
                      className="flex-row items-center py-3 px-3 rounded-lg mb-1.5"
                      style={{
                        backgroundColor: isSelected ? ac(accent, colorScheme, 50, 900) : colors.surface,
                        borderWidth: 1,
                        borderColor: isSelected ? accent[500] + "55" : colors.border,
                      }}
                    >
                      <Ionicons
                        name={isSelected ? "checkbox" : "square-outline"}
                        size={20}
                        color={isSelected ? accent[500] : colors.textSecondary}
                      />
                      <View className="flex-1 ml-2">
                        <Text className="text-sm font-semibold" style={{ color: colors.text }} numberOfLines={1}>
                          {c.merchant || c.description || "Transaction"}
                        </Text>
                        <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                          {prettyDate(c.date)}
                        </Text>
                      </View>
                      <Text className="text-sm font-bold ml-2" style={{ color: colors.text }}>
                        {formatAmount(c.amount)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            {/* Running total + variance */}
            {selectedIds.size > 0 && (
              <View
                className="mt-3 px-3 py-2.5 rounded-xl"
                style={{ backgroundColor: ac(accent, colorScheme, 50, 900), borderWidth: 1, borderColor: accent[500] + "33" }}
              >
                <View className="flex-row justify-between items-center">
                  <Text className="text-xs" style={{ color: colors.textSecondary }}>
                    Selected: {formatAmount(selectedTotal)} ({selectedIds.size})
                  </Text>
                  <Text className="text-xs" style={{ color: colors.textSecondary }}>
                    Planned: {formatAmount(entry.amount)}
                  </Text>
                </View>
                <View className="flex-row items-center mt-1">
                  <Ionicons
                    name={variance > 0 ? "trending-up" : variance < 0 ? "trending-down" : "checkmark-circle"}
                    size={12}
                    color={variance > 0 ? "#EF4444" : variance < 0 ? "#22C55E" : colors.textSecondary}
                  />
                  <Text
                    className="text-xs font-semibold ml-1"
                    style={{ color: variance > 0 ? "#EF4444" : variance < 0 ? "#22C55E" : colors.textSecondary }}
                  >
                    {variance === 0 ? "Exact match" : variance > 0 ? `${formatAmount(variance)} over` : `${formatAmount(Math.abs(variance))} under`}
                  </Text>
                </View>
              </View>
            )}

            {/* Link Selected button */}
            {selectedIds.size > 0 && (
              <Pressable
                onPress={async () => {
                  await onLinkFulfillment(entry.id, Array.from(selectedIds));
                  handleClose();
                }}
                className="mt-3 py-3 rounded-xl items-center"
                style={{ backgroundColor: accent[500] }}
                accessibilityRole="button"
              >
                <Text className="text-sm font-bold text-white">
                  Link Selected ({selectedIds.size})
                </Text>
              </Pressable>
            )}

            <Pressable
              onPress={() => { setMode("root"); setSelectedIds(new Set()); }}
              className="mt-2 py-2.5 rounded-lg items-center"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
              accessibilityRole="button"
            >
              <Text className="text-sm" style={{ color: colors.textSecondary }}>
                Back
              </Text>
            </Pressable>
          </View>
        )}
      </Animated.View>

      <CalendarModal
        visible={reschedulePickerVisible}
        onClose={() => setReschedulePickerVisible(false)}
        value={entry.date >= todayIso() ? entry.date : todayIso()}
        onChange={async (d) => {
          setReschedulePickerVisible(false);
          await onReschedule(entry.id, d);
          handleClose();
        }}
        maximumDate={null}
        minimumDate={new Date()}
      />
    </Modal>
  );
}
