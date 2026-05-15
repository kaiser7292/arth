import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getRecurringReminders,
  stopRecurringRule,
} from "@/services/expense";
import type { ReminderWithSource } from "@/services/expense";
import { StatusColors } from "@/constants/theme";
import { formatDate } from "@/utils/date";
import { getErrorMessage } from "@/utils/error-message";

/**
 * Settings → Reminders.
 *
 * v14.7.0 model: rules are reminders, not forecast templates. The list
 * shows description-first (what the reminder is for), with the next due
 * date and last fulfillment amount/date. Tap a row → opens the source
 * expense detail for editing. Pause button stops the rule.
 */

export default function RecurringRulesScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors, accent, colorScheme } = useColorScheme();
  const [reminders, setReminders] = useState<ReminderWithSource[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await getRecurringReminders(DEFAULT_USER_ID);
      setReminders(data);
    } catch (e) {
      alert("Couldn't load", getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [alert]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

  const handleStop = useCallback(
    (reminder: ReminderWithSource) => {
      alert(
        "Stop reminder?",
        "Future cycles won't be created. Already-materialized upcoming reminders stay — you can delete them individually if needed.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Stop",
            style: "destructive",
            onPress: async () => {
              try {
                await stopRecurringRule(reminder.rule.id);
                setReminders((prev) => prev.filter((r) => r.rule.id !== reminder.rule.id));
              } catch (e) {
                alert("Couldn't stop", getErrorMessage(e));
              }
            },
          },
        ],
      );
    },
    [alert],
  );

  if (loading) {
    return (
      <ScreenContainer padTop={false} centered>
        <ActivityIndicator size="large" color={colors.blue} />
      </ScreenContainer>
    );
  }

  if (reminders.length === 0) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="repeat-outline" size={48} color={colors.textSecondary} />
          <Text className="text-lg font-medium text-text-primary dark:text-text-dark-primary mt-4">
            No reminders yet
          </Text>
          <Text className="text-sm text-text-secondary dark:text-text-dark-secondary text-center mt-2">
            Open an expense and tap "Set reminder" to get notified 24h before each cycle.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <View className="px-4 py-2 border-b border-border-light dark:border-border-dark">
        <Text className="text-xs text-text-tertiary">
          {reminders.length} active reminder{reminders.length !== 1 ? "s" : ""}
        </Text>
      </View>
      <FlatList
        data={reminders}
        keyExtractor={(item) => item.rule.id}
        renderItem={({ item }) => {
          const description =
            item.source?.description ??
            item.source?.merchant_name ??
            "Recurring expense";
          const secondary = item.source?.merchant_name ?? null;
          const stateStyle =
            item.state === "overdue"
              ? { color: StatusColors[colorScheme].danger, label: "Overdue" }
              : item.state === "due_soon"
                ? { color: StatusColors[colorScheme].warning, label: "Due soon" }
                : { color: colors.textSecondary, label: "Upcoming" };

          return (
            <View className="flex-row items-center px-4 py-3 border-b border-border-light dark:border-border-dark">
              <View
                className="w-9 h-9 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: accent[500] + "1A" }}
              >
                <Ionicons name="repeat-outline" size={18} color={accent[500]} />
              </View>
              <Pressable
                className="flex-1"
                onPress={() => {
                  if (item.source) router.push(`/expense/${item.source.id}`);
                }}
                accessibilityRole="button"
                accessibilityLabel={`View ${description}`}
              >
                <Text
                  className="text-sm font-semibold text-text-primary dark:text-text-dark-primary"
                  numberOfLines={1}
                >
                  {description}
                </Text>
                {secondary && secondary !== description && (
                  <Text
                    className="text-xs text-text-secondary dark:text-text-dark-secondary"
                    numberOfLines={1}
                  >
                    {secondary} · {item.rule.frequency}
                  </Text>
                )}
                {!secondary && (
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                    {item.rule.frequency}
                  </Text>
                )}
                {item.lastFulfillment ? (
                  <Text className="text-[11px] text-text-tertiary dark:text-text-dark-secondary mt-0.5">
                    Last paid on {formatDate(item.lastFulfillment.cycle_due_date)}
                  </Text>
                ) : (
                  <Text className="text-[11px] text-text-tertiary dark:text-text-dark-secondary mt-0.5">
                    Not linked to any expense yet
                  </Text>
                )}
                <Text
                  className="text-[11px] font-semibold mt-0.5"
                  style={{ color: stateStyle.color }}
                >
                  {stateStyle.label}
                  {item.rule.next_due_date ? ` · Next: ${formatDate(item.rule.next_due_date)}` : ""}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => handleStop(item)}
                className="w-9 h-9 rounded-full items-center justify-center ml-2"
                style={{ backgroundColor: colors.textSecondary + "14" }}
                accessibilityRole="button"
                accessibilityLabel="Stop reminder"
              >
                <Ionicons name="pause-outline" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
          );
        }}
        showsVerticalScrollIndicator={false}
      />
    </ScreenContainer>
  );
}
