import { useState, useEffect, useCallback, useMemo } from "react";

import { Sheet, Text } from "@/components/ui";
import { View, Pressable, TextInput, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CalendarModal } from "@/components/ui/CalendarModal";
import type { RecurringFrequency } from "@/services/expense";
import { addCycle } from "@/utils/recurrence";
import { useTheme } from "@/hooks/use-theme";

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
    repeatOrdinal?: number | null;
    repeatWeekday?: number | null;
    endDate: string | null;
    notes: string | null;
  };
  onConfirm: (input: {
    frequency: RecurringFrequency;
    repeatOrdinal: number | null;
    repeatWeekday: number | null;
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
  { key: "last_day_of_month", label: "Last day of month", sub: "e.g. 30th, 31st, or 28/29 Feb", icon: "calendar-clear-outline" },
  { key: "nth_weekday", label: "Custom weekday", sub: "e.g. 4th Monday of the month", icon: "options-outline" },
];

const ORDINAL_OPTS: { value: number; label: string }[] = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
  { value: -1, label: "Last" },
];
const WEEKDAY_OPTS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

/**
 * Given the source expense date + a frequency, suggest a start date for the
 * NEXT cycle. Delegates to the shared cycle math (utils/recurrence) so this
 * sheet doesn't carry its own copy — Custom weekday needs the real
 * nth-weekday-of-month logic, not a fixed day-count skip.
 * Falls back to the source date if parsing fails.
 */
function suggestStartDate(
  sourceYMD: string,
  freq: RecurringFrequency,
  repeatOrdinal?: number | null,
  repeatWeekday?: number | null,
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceYMD)) return sourceYMD;
  return addCycle(sourceYMD, freq, repeatOrdinal, repeatWeekday);
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
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [frequency, setFrequency] = useState<RecurringFrequency>(
    initial?.frequency ?? "monthly",
  );
  const [repeatOrdinal, setRepeatOrdinal] = useState<number>(initial?.repeatOrdinal ?? 1);
  const [repeatWeekday, setRepeatWeekday] = useState<number>(initial?.repeatWeekday ?? 1);
  const [startDate, setStartDate] = useState(defaultStartDate);
  // Track whether the user has manually overridden the suggested start date.
  // Until they do, changing frequency re-seeds the start date.
  const [startTouched, setStartTouched] = useState(false);
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [startPickerVisible, setStartPickerVisible] = useState(false);
  const [endPickerVisible, setEndPickerVisible] = useState(false);

  useEffect(() => {
    if (visible) {
      const initialFreq = initial?.frequency ?? "monthly";
      const initialOrdinal = initial?.repeatOrdinal ?? 1;
      const initialWeekday = initial?.repeatWeekday ?? 1;
      setFrequency(initialFreq);
      setRepeatOrdinal(initialOrdinal);
      setRepeatWeekday(initialWeekday);
      // For a new reminder, seed the start date from the source date + frequency.
      // For edit mode, the source-side start is locked (not editable), so just
      // mirror defaultStartDate.
      setStartDate(
        initial ? defaultStartDate : suggestStartDate(defaultStartDate, initialFreq, initialOrdinal, initialWeekday),
      );
      setStartTouched(false);
      setEndDate(initial?.endDate ?? "");
      setNotes(initial?.notes ?? "");

    }
  }, [visible, defaultStartDate, initial]);

  const handleFrequencyChange = useCallback(
    (f: RecurringFrequency) => {
      setFrequency(f);
      // Only re-seed start if the user hasn't manually picked one yet AND we're
      // in create mode (edit mode doesn't show the Starts field).
      if (!startTouched && !initial) {
        setStartDate(suggestStartDate(defaultStartDate, f, repeatOrdinal, repeatWeekday));
      }
    },
    [startTouched, defaultStartDate, initial, repeatOrdinal, repeatWeekday],
  );

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleConfirm = useCallback(() => {
    const trimmedEnd = endDate.trim();
    const trimmedNotes = notes.trim();
    const payload = {
      frequency,
      repeatOrdinal: frequency === "nth_weekday" ? repeatOrdinal : null,
      repeatWeekday: frequency === "nth_weekday" ? repeatWeekday : null,
      startDate,
      endDate: trimmedEnd || null,
      notes: trimmedNotes || null,
    };
    onConfirm(payload);
  }, [onConfirm, frequency, repeatOrdinal, repeatWeekday, startDate, endDate, notes]);



  // End date must be strictly after start (if set).
  const endDateValid = useMemo(() => {
    if (!endDate.trim()) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate.trim())) return false;
    return endDate.trim() > startDate;
  }, [endDate, startDate]);

  if (!visible) return null;

  return (
    <Sheet visible={visible} onClose={handleClose}>

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
                    ? theme.primary + "26"
                    : colors.surface,
                  borderWidth: active ? 2 : 1,
                  borderColor: active
                    ? theme.primary
                    : colors.border,
                }}
              >
                <Ionicons
                  name={opt.icon}
                  size={20}
                  color={active ? theme.primary : colors.textSecondary}
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
                    color={theme.primary}
                  />
                )}
              </Pressable>
            );
          })}
        </View>

        {/* Custom weekday pickers — shown only when nth_weekday is selected */}
        {frequency === "nth_weekday" && (
          <>
            <View className="px-5 pt-1 pb-3">
              <Text
                className="text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: colors.textSecondary }}
              >
                Which occurrence
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {ORDINAL_OPTS.map((o) => {
                  const active = repeatOrdinal === o.value;
                  return (
                    <Pressable
                      key={o.value}
                      onPress={() => {
                        setRepeatOrdinal(o.value);
                        if (!startTouched && !initial) {
                          setStartDate(suggestStartDate(defaultStartDate, frequency, o.value, repeatWeekday));
                        }
                      }}
                      className="px-4 py-2 rounded-full border"
                      style={{
                        backgroundColor: active ? theme.primary + "26" : colors.surface,
                        borderColor: active ? theme.primary : colors.border,
                      }}
                    >
                      <Text className="text-sm font-medium" style={{ color: active ? theme.primary : colors.textSecondary }}>
                        {o.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View className="px-5 pt-1 pb-3">
              <Text
                className="text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: colors.textSecondary }}
              >
                Day of week
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {WEEKDAY_OPTS.map((w) => {
                  const active = repeatWeekday === w.value;
                  return (
                    <Pressable
                      key={w.value}
                      onPress={() => {
                        setRepeatWeekday(w.value);
                        if (!startTouched && !initial) {
                          setStartDate(suggestStartDate(defaultStartDate, frequency, repeatOrdinal, w.value));
                        }
                      }}
                      className="px-4 py-2 rounded-full border"
                      style={{
                        backgroundColor: active ? theme.primary + "26" : colors.surface,
                        borderColor: active ? theme.primary : colors.border,
                      }}
                    >
                      <Text className="text-sm font-medium" style={{ color: active ? theme.primary : colors.textSecondary }}>
                        {w.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </>
        )}

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
                Suggested based on {FREQUENCY_OPTIONS.find((o) => o.key === frequency)?.label.toLowerCase() ?? frequency} cadence - tap to change.
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
            <Text className="text-xs mt-1.5" style={{ color: theme.danger }}>
              End date must be after the start date.
            </Text>
          ) : null}
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
            backgroundColor: theme.primary,
            opacity: endDateValid ? 1 : 0.5,
          }}
        >
          <Text className="text-sm font-semibold text-primary-foreground">
            {initial ? "Save changes" : "Save reminder"}
          </Text>
        </Pressable>
      </View>
      {/*
        Restored: the sheet migration replaced everything between <Modal> and </Modal> and
        dropped both of these, which sat after the panel. startPickerVisible /
        endPickerVisible were still being set to true by the Starts and Until rows, so both
        rows did nothing at all.
      */}
      {/* Start date picker - no maximum (a reminder can start in the future) */}
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

      {/* End date picker - minimum is the start date */}
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
    </Sheet>
  );
}
