import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import { getReminderDetail, stopRecurringRule } from "@/services/expense";
import type { ReminderDetail } from "@/services/expense";
import { StatusColors } from "@/constants/theme";
import { formatDate, todayIso } from "@/utils/date";
import { formatAmount } from "@/utils/format";
import { getErrorMessage } from "@/utils/error-message";

export default function RecurringRuleDetailScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors, accent, colorScheme } = useColorScheme();
  const { ruleId } = useLocalSearchParams<{ ruleId: string }>();

  const [detail, setDetail] = useState<ReminderDetail | null>(null);
  const [loading, setLoading] = useState(true);

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
          <Text className="text-base text-text-secondary dark:text-text-dark-secondary">
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
                className="text-base font-bold text-text-primary dark:text-text-dark-primary"
                numberOfLines={2}
              >
                {name}
              </Text>
              {merchant && merchant !== name && (
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                  {merchant}
                </Text>
              )}
              <View className="flex-row items-center mt-1.5 flex-wrap gap-2">
                <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: accent[500] + "22" }}>
                  <Text className="text-xs font-semibold" style={{ color: accent[500] }}>
                    {rule.frequency}
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
            <View className="flex-row items-center py-2 border-b border-border-light dark:border-border-dark">
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary ml-3 w-28">
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
          <View className="flex-row items-center py-2 border-b border-border-light dark:border-border-dark">
            <Ionicons name="play-outline" size={16} color={colors.textSecondary} />
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary ml-3 w-28">
              Started
            </Text>
            <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary flex-1 text-right">
              {formatDate(rule.start_date)}
            </Text>
          </View>
          {rule.end_date && (
            <View className="flex-row items-center py-2 border-b border-border-light dark:border-border-dark">
              <Ionicons name="stop-outline" size={16} color={colors.textSecondary} />
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary ml-3 w-28">
                Ends
              </Text>
              <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary flex-1 text-right">
                {formatDate(rule.end_date)}
              </Text>
            </View>
          )}
          {rule.notes && (
            <View className="flex-row items-start py-2">
              <Ionicons name="document-text-outline" size={16} color={colors.textSecondary} />
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary ml-3 w-28">
                Notes
              </Text>
              <Text className="text-sm text-text-primary dark:text-text-dark-primary flex-1 text-right">
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
            <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary mb-2 px-1">
              Source expense
            </Text>
            <Pressable
              onPress={() => router.push(`/expense/${source.id}`)}
              className="flex-row items-center px-4 py-3 rounded-xl bg-surface-light-alt dark:bg-surface-dark-alt"
              accessibilityRole="button"
              accessibilityLabel="Open source expense"
            >
              <Ionicons name="receipt-outline" size={18} color={colors.textSecondary} />
              <View className="flex-1 ml-3">
                <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary" numberOfLines={1}>
                  {source.description ?? source.merchant_name ?? "Expense"}
                </Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                  {formatDate(source.date)} · {formatAmount(source.amount)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Pressable>
          </View>
        )}

        {/* Fulfillment history */}
        <View className="mx-4 mt-4">
          <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary mb-2 px-1">
            History · {history.length} cycle{history.length !== 1 ? "s" : ""} fulfilled
          </Text>
          {history.length === 0 ? (
            <View className="items-center py-8 rounded-xl bg-surface-light-alt dark:bg-surface-dark-alt">
              <Ionicons name="time-outline" size={32} color={colors.textSecondary} />
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-2">
                No cycles fulfilled yet
              </Text>
            </View>
          ) : (
            <View className="rounded-xl bg-surface-light-alt dark:bg-surface-dark-alt overflow-hidden">
              {history.map((entry, i) => (
                <Pressable
                  key={entry.fulfillmentId}
                  onPress={() => router.push(`/expense/${entry.expense.id}`)}
                  className={`flex-row items-center px-4 py-3 ${i < history.length - 1 ? "border-b border-border-light dark:border-border-dark" : ""}`}
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
                    <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary" numberOfLines={1}>
                      {entry.expense.merchant_name ?? entry.expense.description ?? "Expense"}
                    </Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                      Cycle due {formatDate(entry.cycleDueDate)} · Paid {formatDate(entry.expense.date)}
                    </Text>
                  </View>
                  <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary mr-2">
                    {formatAmount(entry.expense.amount)}
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Stop button — only shown for active rules */}
        {rule.is_active === 1 && (
          <Pressable
            onPress={handleStop}
            className="mx-4 mt-6 flex-row items-center justify-center py-3.5 rounded-xl"
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

      </ScrollView>
    </ScreenContainer>
  );
}
