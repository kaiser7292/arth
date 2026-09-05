import { useCallback, useEffect, useRef, useState } from "react";
import { View, Pressable, ScrollView, ActivityIndicator, TextInput, Modal, KeyboardAvoidingView } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, ScreenContainer, Text } from "@/components/ui";
import { CalendarModal } from "@/components/ui/CalendarModal";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import { getReminderDetail, stopRecurringRule, updateRecurringRule } from "@/services/expense";
import type { ReminderDetail } from "@/services/expense";
import type { RecurringFrequency } from "@/services/recurring-rules";
import { StatusColors } from "@/constants/theme";
import { formatDate, todayIso } from "@/utils/date";
import { formatAmount } from "@/utils/format";
import { getErrorMessage } from "@/utils/error-message";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const FREQUENCIES: RecurringFrequency[] = ["weekly", "monthly", "quarterly", "yearly", "last_day_of_month", "nth_weekday"];
const FREQ_LABEL: Record<RecurringFrequency, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
  last_day_of_month: "Last day of month",
  nth_weekday: "Nth weekday",
};

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

function ruleFrequencyLabel(frequency: RecurringFrequency, repeatOrdinal?: number | null, repeatWeekday?: number | null): string {
  if (frequency === "nth_weekday" && repeatOrdinal != null && repeatWeekday != null) {
    const ord = ORDINAL_OPTS.find((o) => o.value === repeatOrdinal)?.label ?? `${repeatOrdinal}th`;
    const day = WEEKDAY_OPTS.find((w) => w.value === repeatWeekday)?.label ?? "";
    return `${ord} ${day} monthly`;
  }
  return FREQ_LABEL[frequency];
}

export default function RecurringRuleDetailScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const alert = useAlert();
  const { colors, accent, colorScheme } = useColorScheme();
  const insets = useSafeAreaInsets();
  const { ruleId } = useLocalSearchParams<{ ruleId: string }>();

  const [detail, setDetail] = useState<ReminderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editVisible, setEditVisible] = useState(false);

  // Edit sheet state
  const [editFrequency, setEditFrequency] = useState<RecurringFrequency>("monthly");
  const [editRepeatOrdinal, setEditRepeatOrdinal] = useState<number>(1);
  const [editRepeatWeekday, setEditRepeatWeekday] = useState<number>(1);
  const [editNextDue, setEditNextDue] = useState("");
  const [editEndDate, setEditEndDate] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [nextDuePicker, setNextDuePicker] = useState(false);
  const [endDatePicker, setEndDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!ruleId) return;
    try {
      const d = await getReminderDetail(ruleId);
      setDetail(d);
    } catch (e) {
      alert("Couldn't load", getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [ruleId, alert]);

  useEffect(() => {
    load();
  }, [load]);

  // Wire up the header edit button
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => setEditVisible(true)}
          hitSlop={8}
          style={{ padding: 8 }}
          accessibilityLabel="Edit reminder"
        >
          <Ionicons name="create-outline" size={20} color={colors.tint} />
        </Pressable>
      ),
    });
  }, [navigation, colors.tint]);

  const openEdit = useCallback(() => {
    if (!detail) return;
    const { rule } = detail;
    setEditFrequency(rule.frequency);
    setEditRepeatOrdinal(rule.repeat_ordinal ?? 1);
    setEditRepeatWeekday(rule.repeat_weekday ?? 1);
    setEditNextDue(rule.next_due_date ?? todayIso());
    setEditEndDate(rule.end_date ?? null);
    setEditAmount(rule.amount != null ? String(rule.amount) : "");
    setEditNotes(rule.notes ?? "");
    setEditVisible(true);
  }, [detail]);

  // Re-open with fresh values when detail loads
  const editOpenedRef = useRef(false);
  useEffect(() => {
    if (detail && editVisible && !editOpenedRef.current) {
      openEdit();
      editOpenedRef.current = true;
    }
    if (!editVisible) editOpenedRef.current = false;
  }, [detail, editVisible, openEdit]);

  const handleSave = useCallback(async () => {
    if (!detail) return;
    setSaving(true);
    try {
      const amountNum = editAmount.trim() ? parseFloat(editAmount.trim()) : null;
      await updateRecurringRule(detail.rule.id, {
        frequency: editFrequency,
        repeat_ordinal: editFrequency === "nth_weekday" ? editRepeatOrdinal : null,
        repeat_weekday: editFrequency === "nth_weekday" ? editRepeatWeekday : null,
        next_due_date: editNextDue || null,
        end_date: editEndDate,
        amount: Number.isFinite(amountNum!) ? amountNum : null,
        notes: editNotes.trim() || null,
      });
      setEditVisible(false);
      await load();
    } catch (e) {
      alert("Couldn't save", getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [detail, editFrequency, editNextDue, editEndDate, editAmount, editNotes, load, alert]);

  const handleStop = useCallback(() => {
    if (!detail) return;
    alert(
      "Stop reminder?",
      "Future cycles won't be created. Already-materialized upcoming reminders stay.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Stop",
          style: "destructive",
          onPress: async () => {
            try {
              await stopRecurringRule(detail.rule.id);
              router.back();
            } catch (e) {
              alert("Couldn't stop", getErrorMessage(e));
            }
          },
        },
      ],
    );
  }, [detail, alert, router]);

  if (loading) {
    return (
      <ScreenContainer padTop={false} centered>
        <ActivityIndicator size="large" color={colors.blue} />
      </ScreenContainer>
    );
  }

  if (!detail) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-base text-muted-foreground">
            Reminder not found.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  const { rule, source, history } = detail;
  const name = source?.description ?? source?.merchant_name ?? "Recurring expense";
  const merchant = source?.merchant_name ?? null;

  const today = todayIso();
  const isOverdue = rule.next_due_date ? rule.next_due_date < today : false;
  const isDueSoon = rule.next_due_date ? rule.next_due_date <= today || rule.next_due_date === (() => {
    const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10);
  })() : false;

  const stateColor = !rule.is_active
    ? colors.textSecondary
    : isOverdue
      ? StatusColors[colorScheme].danger
      : isDueSoon
        ? StatusColors[colorScheme].warning
        : StatusColors[colorScheme].success;

  const stateLabel = !rule.is_active
    ? "Stopped"
    : isOverdue
      ? "Overdue"
      : isDueSoon
        ? "Due soon"
        : "Upcoming";

  return (
    <ScreenContainer padTop={false}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* Hero */}
        <View
          className="mx-4 mt-4 p-4 rounded-2xl"
          style={{ backgroundColor: accent[500] + "14" }}
        >
          <View className="flex-row items-start">
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: accent[500] + "28" }}
            >
              <Ionicons name="repeat-outline" size={20} color={accent[500]} />
            </View>
            <View className="flex-1">
              <Text
                className="text-base font-bold text-foreground"
                numberOfLines={2}
              >
                {name}
              </Text>
              {merchant && merchant !== name && (
                <Text className="text-xs text-muted-foreground mt-0.5">
                  {merchant}
                </Text>
              )}
              <View className="flex-row items-center mt-1.5 flex-wrap gap-2">
                <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: accent[500] + "22" }}>
                  <Text className="text-xs font-semibold" style={{ color: accent[500] }}>
                    {ruleFrequencyLabel(rule.frequency, rule.repeat_ordinal, rule.repeat_weekday)}
                  </Text>
                </View>
                <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: stateColor + "22" }}>
                  <Text className="text-xs font-semibold" style={{ color: stateColor }}>
                    {stateLabel}
                  </Text>
                </View>
                {source && (
                  <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: colors.textSecondary + "18" }}>
                    <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
                      {formatAmount(source.amount)}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>

        {/* Dates */}
        <Card className="mx-4 mt-3">
          {rule.next_due_date && (
            <View className="flex-row items-center py-2 border-b border-border">
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              <Text className="text-xs text-muted-foreground ml-3 w-28">
                Next due
              </Text>
              <Text
                className="text-sm font-medium flex-1 text-right"
                style={{ color: stateColor }}
              >
                {formatDate(rule.next_due_date)}
              </Text>
            </View>
          )}
          <View className="flex-row items-center py-2 border-b border-border">
            <Ionicons name="play-outline" size={16} color={colors.textSecondary} />
            <Text className="text-xs text-muted-foreground ml-3 w-28">
              Started
            </Text>
            <Text className="text-sm font-medium text-foreground flex-1 text-right">
              {formatDate(rule.start_date)}
            </Text>
          </View>
          {rule.end_date && (
            <View className="flex-row items-center py-2 border-b border-border">
              <Ionicons name="stop-outline" size={16} color={colors.textSecondary} />
              <Text className="text-xs text-muted-foreground ml-3 w-28">
                Ends
              </Text>
              <Text className="text-sm font-medium text-foreground flex-1 text-right">
                {formatDate(rule.end_date)}
              </Text>
            </View>
          )}
          {rule.notes && (
            <View className="flex-row items-start py-2">
              <Ionicons name="document-text-outline" size={16} color={colors.textSecondary} />
              <Text className="text-xs text-muted-foreground ml-3 w-28">
                Notes
              </Text>
              <Text className="text-sm text-foreground flex-1 text-right">
                {rule.notes}
              </Text>
            </View>
          )}
          {!rule.notes && !rule.end_date && !rule.next_due_date && (
            <View className="py-2" />
          )}
        </Card>

        {/* Source expense link */}
        {source && (
          <View className="mx-4 mt-3">
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
              Source expense
            </Text>
            <Pressable
              onPress={() => router.push(`/expense/${source.id}`)}
              className="flex-row items-center px-4 py-3 rounded-xl bg-card"
              accessibilityRole="button"
              accessibilityLabel="Open source expense"
            >
              <Ionicons name="receipt-outline" size={18} color={colors.textSecondary} />
              <View className="flex-1 ml-3">
                <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                  {source.description ?? source.merchant_name ?? "Expense"}
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  {formatDate(source.date)} · {formatAmount(source.amount)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Pressable>
          </View>
        )}

        {/* Fulfillment history */}
        <View className="mx-4 mt-4">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
            History · {history.length} cycle{history.length !== 1 ? "s" : ""} fulfilled
          </Text>
          {history.length === 0 ? (
            <View className="items-center py-8 rounded-xl bg-card">
              <Ionicons name="time-outline" size={32} color={colors.textSecondary} />
              <Text className="text-sm text-muted-foreground mt-2">
                No cycles fulfilled yet
              </Text>
            </View>
          ) : (
            <View className="rounded-xl bg-card overflow-hidden">
              {history.map((entry, i) => (
                <Pressable
                  key={entry.fulfillmentId}
                  onPress={() => router.push(`/expense/${entry.expense.id}`)}
                  className={`flex-row items-center px-4 py-3 ${i < history.length - 1 ? "border-b border-border" : ""}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Open expense for ${entry.cycleDueDate}`}
                >
                  <View
                    className="w-8 h-8 rounded-full items-center justify-center mr-3"
                    style={{ backgroundColor: StatusColors[colorScheme].success + "18" }}
                  >
                    <Ionicons name="checkmark" size={16} color={StatusColors[colorScheme].success} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                      {entry.expense.merchant_name ?? entry.expense.description ?? "Expense"}
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      Cycle due {formatDate(entry.cycleDueDate)} · Paid {formatDate(entry.expense.date)}
                    </Text>
                  </View>
                  <Text className="text-sm font-semibold text-foreground mr-2">
                    {formatAmount(entry.expense.amount)}
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Actions */}
        <View className="mx-4 mt-6 gap-3">
          {rule.is_active === 1 && (
            <Pressable
              onPress={openEdit}
              className="flex-row items-center justify-center py-3.5 rounded-xl border border-border"
              style={{ backgroundColor: colors.surface }}
              accessibilityRole="button"
              accessibilityLabel="Edit this reminder"
            >
              <Ionicons name="create-outline" size={18} color={colors.tint} />
              <Text className="text-sm font-semibold ml-2" style={{ color: colors.tint }}>
                Edit reminder
              </Text>
            </Pressable>
          )}
          {rule.is_active === 1 && (
            <Pressable
              onPress={handleStop}
              className="flex-row items-center justify-center py-3.5 rounded-xl"
              style={{ backgroundColor: StatusColors[colorScheme].danger + "14" }}
              accessibilityRole="button"
              accessibilityLabel="Stop this reminder"
            >
              <Ionicons name="pause-outline" size={18} color={StatusColors[colorScheme].danger} />
              <Text className="text-sm font-semibold ml-2" style={{ color: StatusColors[colorScheme].danger }}>
                Stop reminder
              </Text>
            </Pressable>
          )}
        </View>

      </ScrollView>

      {/* Edit sheet */}
      <Modal transparent animationType="slide" visible={editVisible} onRequestClose={() => setEditVisible(false)}>
        <Pressable className="flex-1 bg-black/40" onPress={() => setEditVisible(false)} />
        <KeyboardAvoidingView behavior="padding" style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingBottom: Math.max(insets.bottom, 12),
            }}
          >
            {/* Handle */}
            <View className="items-center pt-3 pb-1">
              <View className="w-10 h-1 rounded-full bg-border" />
            </View>
            <View className="flex-row items-center justify-between px-5 pb-3">
              <Text className="text-base font-bold text-foreground">Edit Reminder</Text>
              <Pressable onPress={() => setEditVisible(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8, gap: 16 }}>

              {/* Next due date */}
              <View>
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Next due date
                </Text>
                <Pressable
                  onPress={() => setNextDuePicker(true)}
                  className="flex-row items-center justify-between border border-border rounded-xl px-4 py-3"
                >
                  <Text className="text-sm text-foreground">
                    {editNextDue ? formatDate(editNextDue) : "Not set"}
                  </Text>
                  <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                </Pressable>
              </View>

              {/* Frequency */}
              <View>
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Frequency
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {FREQUENCIES.map((f) => {
                    const active = editFrequency === f;
                    return (
                      <Pressable
                        key={f}
                        onPress={() => setEditFrequency(f)}
                        className="px-4 py-2 rounded-full border"
                        style={{
                          backgroundColor: active ? accent[500] + "18" : colors.surface,
                          borderColor: active ? accent[500] : colors.border,
                        }}
                      >
                        <Text className="text-sm font-medium" style={{ color: active ? accent[500] : colors.textSecondary }}>
                          {FREQ_LABEL[f]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* nth weekday pickers — shown only when nth_weekday is selected */}
              {editFrequency === "nth_weekday" && (
                <>
                  <View>
                    <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Which occurrence
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      {ORDINAL_OPTS.map((o) => {
                        const active = editRepeatOrdinal === o.value;
                        return (
                          <Pressable
                            key={o.value}
                            onPress={() => setEditRepeatOrdinal(o.value)}
                            className="px-4 py-2 rounded-full border"
                            style={{
                              backgroundColor: active ? accent[500] + "18" : colors.surface,
                              borderColor: active ? accent[500] : colors.border,
                            }}
                          >
                            <Text className="text-sm font-medium" style={{ color: active ? accent[500] : colors.textSecondary }}>
                              {o.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                  <View>
                    <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Day of week
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      {WEEKDAY_OPTS.map((w) => {
                        const active = editRepeatWeekday === w.value;
                        return (
                          <Pressable
                            key={w.value}
                            onPress={() => setEditRepeatWeekday(w.value)}
                            className="px-4 py-2 rounded-full border"
                            style={{
                              backgroundColor: active ? accent[500] + "18" : colors.surface,
                              borderColor: active ? accent[500] : colors.border,
                            }}
                          >
                            <Text className="text-sm font-medium" style={{ color: active ? accent[500] : colors.textSecondary }}>
                              {w.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </>
              )}

              {/* End date */}
              <View>
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  End date (optional)
                </Text>
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => setEndDatePicker(true)}
                    className="flex-1 flex-row items-center justify-between border border-border rounded-xl px-4 py-3"
                  >
                    <Text className="text-sm text-foreground">
                      {editEndDate ? formatDate(editEndDate) : "No end date"}
                    </Text>
                    <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                  </Pressable>
                  {editEndDate && (
                    <Pressable
                      onPress={() => setEditEndDate(null)}
                      className="w-11 items-center justify-center border border-border rounded-xl"
                    >
                      <Ionicons name="close" size={18} color={colors.textSecondary} />
                    </Pressable>
                  )}
                </View>
              </View>

              {/* Amount */}
              <View>
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Expected amount (optional)
                </Text>
                <TextInput
                  value={editAmount}
                  onChangeText={setEditAmount}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 15000"
                  placeholderTextColor={colors.textSecondary}
                  className="border border-border rounded-xl px-4 py-3 text-sm text-foreground"
                />
              </View>

              {/* Notes */}
              <View>
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Notes (optional)
                </Text>
                <TextInput
                  value={editNotes}
                  onChangeText={setEditNotes}
                  placeholder="Add a note…"
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  numberOfLines={2}
                  className="border border-border rounded-xl px-4 py-3 text-sm text-foreground"
                  style={{ minHeight: 64, textAlignVertical: "top" }}
                />
              </View>

            </ScrollView>

            {/* Save / Cancel */}
            <View className="flex-row px-5 pt-3 gap-3">
              <Pressable
                onPress={() => setEditVisible(false)}
                className="flex-1 py-3 rounded-xl items-center border border-border"
                style={{ backgroundColor: colors.surface }}
              >
                <Text className="text-sm font-semibold text-muted-foreground">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
                disabled={saving}
                className="flex-1 py-3 rounded-xl items-center"
                style={{ backgroundColor: accent[500], opacity: saving ? 0.6 : 1 }}
              >
                <Text className="text-sm font-semibold text-white">{saving ? "Saving…" : "Save"}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Calendar pickers */}
      <CalendarModal
        visible={nextDuePicker}
        onClose={() => setNextDuePicker(false)}
        value={editNextDue || todayIso()}
        onChange={(d) => { setEditNextDue(d); setNextDuePicker(false); }}
        maximumDate={null}
      />
      <CalendarModal
        visible={endDatePicker}
        onClose={() => setEndDatePicker(false)}
        value={editEndDate ?? todayIso()}
        onChange={(d) => { setEditEndDate(d); setEndDatePicker(false); }}
        maximumDate={null}
      />
    </ScreenContainer>
  );
}
