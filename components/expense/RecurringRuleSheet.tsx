import { useState, useEffect, useCallback, useMemo } from "react";
import { Text } from "@/components/ui";
import { View, Pressable, Modal, TextInput, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ac } from "@/utils/accent";
import { CalendarModal } from "@/components/ui/CalendarModal";
import type { RecurringFrequency } from "@/services/expense";

/**
 * Reminder sheet (formerly "Make recurring"). Shown from the expense detail
 * screen when the user wants to be reminded of a repeating expense.
 *
 * v15.12.0 rewrite — bundles four fixes:
 *  - KeyboardAvoidingView + ScrollView so Notes/Until don't get covered
 *  - Native calendar picker for Starts and Until (replaces raw YYYY-MM-DD inputs)
 *  - Frequency-aware start-date suggestions (next Monday / 1st / quarter / year)
 *  - Terminology aligned to "Reminder" everywhere user-facing
 */

interface RecurringRuleSheetProps {
  visible: boolean;
  /** YYYY-MM-DD. Pre-fills the "Starts" field (usually the source expense's date). */
  defaultStartDate: string;
  /** Pre-existing rule state — when non-null, the sheet opens in Edit mode. */
  initial?: {
    frequency: RecurringFrequency;
    endDate: string | null;
    notes: string | null;
  };
  onConfirm: (input: {
    frequency: RecurringFrequency;
    startDate: string;
    endDate: string | null;
    notes: string | null;
  }) => void;
  onClose: () => void;
}

const FREQUENCY_OPTIONS: {
  key: RecurringFrequency;
  label: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "monthly", label: "Monthly", sub: "Same day each month", icon: "calendar-outline" },
  { key: "weekly", label: "Weekly", sub: "Every 7 days", icon: "repeat-outline" },
  { key: "quarterly", label: "Quarterly", sub: "Every 3 months", icon: "calendar-number-outline" },
  { key: "yearly", label: "Yearly", sub: "Once a year", icon: "gift-outline" },
];

/** Format a Date to YYYY-MM-DD. */
function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Given the source expense date + a frequency, suggest a start date for the
 * NEXT cycle. The suggestion is what a user would reasonably mean by "starts":
 *  - monthly   → same day next month
 *  - weekly    → 7 days later
 *  - quarterly → same day 3 months later
 *  - yearly    → same day next year
 * Falls back to the source date if parsing fails.
 */
function suggestStartDate(sourceYMD: string, freq: RecurringFrequency): string {
  const parts = sourceYMD.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return sourceYMD;
  const [y, m, d] = parts;
  const base = new Date(y, m - 1, d);
  if (isNaN(base.getTime())) return sourceYMD;

  const next = new Date(base);
  switch (freq) {
    case "weekly":
      next.setDate(next.getDate() + 7);
      break;
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      break;
    case "quarterly":
      next.setMonth(next.getMonth() + 3);
      break;
    case "yearly":
      next.setFullYear(next.getFullYear() + 1);
      break;
  }
  return toYMD(next);
}

/** Human-friendly date label (e.g. "15 May 2026"). */
function prettyDate(ymd: string): string {
  if (!ymd) return "";
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return ymd;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  if (isNaN(dt.getTime())) return ymd;
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function RecurringRuleSheet({
  visible,
  defaultStartDate,
  initial,
  onConfirm,
  onClose,
}: RecurringRuleSheetProps) {
  const { colors, accent, colorScheme } = useColorScheme();
  const insets = useSafeAreaInsets();
  const [frequency, setFrequency] = useState<RecurringFrequency>(
    initial?.frequency ?? "monthly",
  );
  const [startDate, setStartDate] = useState(defaultStartDate);
  // Track whether the user has manually overridden the suggested start date.
  // Until they do, changing frequency re-seeds the start date.
  const [startTouched, setStartTouched] = useState(false);
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [startPickerVisible, setStartPickerVisible] = useState(false);
  const [endPickerVisible, setEndPickerVisible] = useState(false);
  const slideAnim = useSharedValue(400);

  useEffect(() => {
    if (visible) {
      const initialFreq = initial?.frequency ?? "monthly";
      setFrequency(initialFreq);
      // For a new reminder, seed the start date from the source date + frequency.
      // For edit mode, the source-side start is locked (not editable), so just
      // mirror defaultStartDate.
      setStartDate(
        initial ? defaultStartDate : suggestStartDate(defaultStartDate, initialFreq),
      );
      setStartTouched(false);
      setEndDate(initial?.endDate ?? "");
      setNotes(initial?.notes ?? "");
      slideAnim.value = withTiming(0, { duration: 250 });
    }
  }, [visible, defaultStartDate, initial, slideAnim]);

  const handleFrequencyChange = useCallback(
    (f: RecurringFrequency) => {
      setFrequency(f);
      // Only re-seed start if the user hasn't manually picked one yet AND we're
      // in create mode (edit mode doesn't show the Starts field).
      if (!startTouched && !initial) {
        setStartDate(suggestStartDate(defaultStartDate, f));
      }
    },
    [startTouched, defaultStartDate, initial],
  );

  const handleClose = useCallback(() => {
    slideAnim.value = withTiming(400, { duration: 200 }, () => {
      runOnJS(onClose)();
    });
  }, [slideAnim, onClose]);

  const handleConfirm = useCallback(() => {
    const trimmedEnd = endDate.trim();
    const trimmedNotes = notes.trim();
    const payload = {
      frequency,
      startDate,
      endDate: trimmedEnd || null,
      notes: trimmedNotes || null,
    };
    slideAnim.value = withTiming(400, { duration: 200 }, () => {
      runOnJS(onConfirm)(payload);
    });
  }, [slideAnim, onConfirm, frequency, startDate, endDate, notes]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: slideAnim.value }],
  }));

  // End date must be strictly after start (if set).
  const endDateValid = useMemo(() => {
    if (!endDate.trim()) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate.trim())) return false;
    return endDate.trim() > startDate;
  }, [endDate, startDate]);

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={handleClose}>
      <Pressable
        className="flex-1 bg-black/40"
        onPress={handleClose}
        accessibilityLabel="Close"
        accessibilityRole="button"
      />
      <KeyboardAvoidingView
        // v16.0.6 — `padding` on both platforms; see EntryEditSheet note
        // about Android `"height"` blurring focused TextInputs.
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
      >
        <Animated.View
          style={[
            animStyle,
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              maxHeight: "90%",
              paddingBottom: Math.max(insets.bottom, 8),
            },
          ]}
        >
          {/* Drag handle */}
          <View className="items-center pt-3 pb-1">
            <View className="w-10 h-1 rounded-full bg-border" />
          </View>

          {/* Header */}
          <View className="px-5 pb-3">
            <Text className="text-base font-bold" style={{ color: colors.text }}>
              {initial ? "Edit reminder" : "Set reminder"}
            </Text>
            <Text className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>
              {initial
                ? "Changes apply to future cycles. Existing upcoming reminders keep their values."
                : "We'll remind you before each cycle. When you log the expense, the next cycle advances automatically."}
            </Text>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 8 }}
          >
            {/* Frequency */}
            <View className="px-5 pt-1 pb-3">
              <Text
                className="text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: colors.textSecondary }}
              >
                Repeats
              </Text>
              {FREQUENCY_OPTIONS.map((opt) => {
                const active = frequency === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => handleFrequencyChange(opt.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    className="flex-row items-center py-3 px-4 rounded-xl mb-2"
                    style={{
                      backgroundColor: active
                        ? ac(accent, colorScheme, 500, 300) + "26"
                        : colors.surface,
                      borderWidth: active ? 2 : 1,
                      borderColor: active
                        ? ac(accent, colorScheme, 500, 300)
                        : colors.border,
                    }}
                  >
                    <Ionicons
                      name={opt.icon}
                      size={20}
                      color={active ? ac(accent, colorScheme, 600, 200) : colors.textSecondary}
                    />
                    <View className="flex-1 ml-3">
                      <Text
                        className="text-sm font-semibold"
                        style={{ color: colors.text }}
                      >
                        {opt.label}
                      </Text>
                      <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                        {opt.sub}
                      </Text>
                    </View>
                    {active && (
                      <Ionicons
                        name="checkmark-circle"
                        size={18}
                        color={ac(accent, colorScheme, 600, 200)}
                      />
                    )}
                  </Pressable>
                );
              })}
            </View>

            {/* Starts — calendar picker (create mode only; start is locked once rule exists) */}
            {!initial && (
              <View className="px-5 pt-1 pb-3">
                <Text
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: colors.textSecondary }}
                >
                  Starts
                </Text>
                <Pressable
                  onPress={() => setStartPickerVisible(true)}
                  className="flex-row items-center justify-between border border-border rounded-lg px-3 py-3"
                  accessibilityRole="button"
                  accessibilityLabel={`Starts on ${prettyDate(startDate)}. Tap to change.`}
                >
                  <Text className="text-sm" style={{ color: colors.text }}>
                    {prettyDate(startDate)}
                  </Text>
                  <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
                </Pressable>
                {!startTouched && (
                  <Text className="text-xs mt-1.5" style={{ color: colors.textSecondary }}>
                    Suggested based on {frequency} cadence - tap to change.
                  </Text>
                )}
              </View>
            )}

            {/* Until (optional) — calendar picker */}
            <View className="px-5 pt-1 pb-3">
              <Text
                className="text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: colors.textSecondary }}
              >
                Until (optional)
              </Text>
              <Pressable
                onPress={() => setEndPickerVisible(true)}
                className="flex-row items-center justify-between border border-border rounded-lg px-3 py-3"
                accessibilityRole="button"
                accessibilityLabel={
                  endDate ? `Ends on ${prettyDate(endDate)}. Tap to change.` : "No end date. Tap to pick one."
                }
              >
                <Text
                  className="text-sm"
                  style={{ color: endDate ? colors.text : colors.textSecondary }}
                >
                  {endDate ? prettyDate(endDate) : "Leave blank for open-ended"}
                </Text>
                <View className="flex-row items-center">
                  {endDate ? (
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        setEndDate("");
                      }}
                      className="mr-2 p-1"
                      hitSlop={8}
                      accessibilityLabel="Clear end date"
                    >
                      <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                    </Pressable>
                  ) : null}
                  <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
                </View>
              </Pressable>
              {!endDateValid && endDate.trim() ? (
                <Text className="text-xs mt-1.5" style={{ color: "#DC2626" }}>
                  End date must be after the start date.
                </Text>
              ) : null}
            </View>

            {/* Notes (optional) */}
            <View className="px-5 pt-1 pb-3">
              <Text
                className="text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: colors.textSecondary }}
              >
                Notes (optional)
              </Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="e.g., Flat rent, split 50/50 with flatmate"
                placeholderTextColor={colors.textSecondary}
                className="border border-border rounded-lg px-3 py-2.5 text-sm"
                style={{ color: colors.text, minHeight: 60 }}
                multiline
              />
            </View>
          </ScrollView>

          {/* Actions */}
          <View className="flex-row px-5 pt-3 gap-3">
            <Pressable
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              className="flex-1 py-3 rounded-xl items-center"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
            >
              <Text className="text-sm font-semibold" style={{ color: colors.textSecondary }}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              disabled={!endDateValid}
              accessibilityRole="button"
              accessibilityLabel="Save reminder"
              className="flex-1 py-3 rounded-xl items-center"
              style={{
                backgroundColor: accent[500],
                opacity: endDateValid ? 1 : 0.5,
              }}
            >
              <Text className="text-sm font-semibold text-white">
                {initial ? "Save changes" : "Save reminder"}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>

      {/* Start date picker — no maximum (reminder can start in future) */}
      <CalendarModal
        visible={startPickerVisible}
        onClose={() => setStartPickerVisible(false)}
        value={startDate}
        onChange={(d) => {
          setStartDate(d);
          setStartTouched(true);
          setStartPickerVisible(false);
        }}
        maximumDate={null}
      />

      {/* End date picker — minimum is the start date */}
      <CalendarModal
        visible={endPickerVisible}
        onClose={() => setEndPickerVisible(false)}
        value={endDate || startDate}
        onChange={(d) => {
          setEndDate(d);
          setEndPickerVisible(false);
        }}
        maximumDate={null}
        minimumDate={(() => {
          const parts = startDate.split("-").map(Number);
          if (parts.length === 3 && !parts.some(isNaN)) {
            return new Date(parts[0], parts[1] - 1, parts[2]);
          }
          return undefined;
        })()}
      />
    </Modal>
  );
}
