import { useCallback, useEffect, useState } from "react";
import { formatAmount } from "@/utils/format";
import { View, Pressable, FlatList } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getRecurringReminders,
  stopRecurringRule,
} from "@/services/expense";
import type { ReminderWithSource } from "@/services/expense";

import { formatDate } from "@/utils/date";
import { getErrorMessage } from "@/utils/error-message";
import { useTheme } from "@/hooks/use-theme";
import { LoadingState } from "@/components/ui";
import { DrawerCell, GroupHeading, ListToolbar } from "@/components/ui";
import { useListTools } from "@/hooks/use-list-tools";
import type { ListField, ListSort } from "@/utils/list-tools";
import { tint } from "@/constants/brand";

/**
 * Settings → Reminders.
 *
 * v14.7.0 model: rules are reminders, not forecast templates. The list
 * shows description-first (what the reminder is for), with the next due
 * date and last fulfillment amount/date. Tap a row → opens the source
 * expense detail for editing. Pause button stops the rule.
 */

const STATE_LABELS: Record<string, string> = { overdue: "Overdue", due_soon: "Due soon", upcoming: "Upcoming" };
const reminderName = (r: ReminderWithSource) => r.source?.description ?? r.source?.merchant_name ?? "Recurring expense";
const REMINDER_FIELDS: ListField<ReminderWithSource>[] = [
  { id: "state", label: "Status", keyOf: (r) => r.state, labelOf: (k) => STATE_LABELS[k] ?? k, filter: true, group: true },
];
const REMINDER_SORTS: ListSort<ReminderWithSource>[] = [
  { id: "due", label: "Due soonest" , compare: (a, b) => (a.rule.next_due_date ?? "").localeCompare(b.rule.next_due_date ?? "") },
  { id: "amount", label: "Amount (highest first)", compare: (a, b) => (b.source?.amount ?? 0) - (a.source?.amount ?? 0) },
  { id: "name", label: "Name (A–Z)", compare: (a, b) => reminderName(a).localeCompare(reminderName(b)) },
];
const reminderSearch = (r: ReminderWithSource) => ({
  texts: [r.source?.description, r.source?.merchant_name],
  amounts: r.source ? [r.source.amount] : [],
});

export default function RecurringRulesScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();
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
        "Future cycles won't be created. Already-materialized upcoming reminders stay - you can delete them individually if needed.",
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

  const tools = useListTools<ReminderWithSource>({
    screen: "reminders",
    noun: { one: "reminder", many: "reminders" },
    rows: reminders,
    fields: REMINDER_FIELDS,
    sorts: REMINDER_SORTS,
    search: reminderSearch,
    searchPlaceholder: "Search name or >5000",
    amountOf: (r) => -(r.source?.amount ?? 0),
    // Overdue, Due soon, Upcoming (board "Reminders").
    defaultGroup: "state",
  });

  if (loading) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (reminders.length === 0) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="repeat-outline" size={48} color={theme.mutedForeground} />
          <Text className="text-heading font-medium text-foreground mt-4">
            No reminders yet
          </Text>
          <Text className="text-meta text-muted-foreground text-center mt-2">
            Open an expense and tap "Set reminder" to get notified 24h before each cycle.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <View className="px-4 py-2 border-b border-border">
        <Text className="text-label text-faint-foreground">
          {reminders.length} active reminder{reminders.length !== 1 ? "s" : ""}
        </Text>
      </View>
      <ListToolbar {...tools.toolbar} />
      {tools.filterSheet}
      <FlatList
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        data={tools.grouped}
        keyExtractor={(row) => (row.type === "heading" ? `heading-${row.key}` : row.item.rule.id)}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text className="text-meta text-muted-foreground text-center px-8 py-8">Nothing matches.</Text>}
        renderItem={({ item: row }) => {
          if (row.type === "heading") return <GroupHeading label={row.label} count={row.count} total={row.total} open={row.open} onToggle={row.onToggle} noun={row.noun} />;
          const item = row.item;
          const description =
            item.source?.description ??
            item.source?.merchant_name ??
            "Recurring expense";
          const secondary = item.source?.merchant_name ?? null;
          const stateStyle =
            item.state === "overdue"
              ? { color: theme.danger, label: "Overdue" }
              : item.state === "due_soon"
                ? { color: theme.warning, label: "Due soon" }
                : { color: theme.mutedForeground, label: "Upcoming" };

          return (
    <DrawerCell row={row}>
            <View className="flex-row items-center px-4 py-3 border-b border-border">
              {/* The next due date as a little calendar leaf, in the status colour */}
              {(() => {
                const d = item.rule.next_due_date ? new Date(item.rule.next_due_date + "T00:00:00") : null;
                const ok = d && !isNaN(d.getTime());
                return (
                  <View
                    className="rounded-control items-center justify-center mr-3"
                    style={{ width: 44, height: 46, backgroundColor: tint(stateStyle.color, 0.1) }}
                    accessibilityLabel={ok ? `Due ${formatDate(item.rule.next_due_date!)}` : "No due date"}
                  >
                    {ok ? (
                      <>
                        <Text className="text-heading font-bold" style={{ color: stateStyle.color, lineHeight: 22 }}>
                          {d!.getDate()}
                        </Text>
                        <Text className="text-label font-semibold uppercase" style={{ color: stateStyle.color }}>
                          {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d!.getMonth()]}
                        </Text>
                      </>
                    ) : (
                      <Ionicons name="repeat-outline" size={18} color={stateStyle.color} />
                    )}
                  </View>
                );
              })()}
              <Pressable
                className="flex-1"
                onPress={() => router.push(`/settings/recurring-rule-detail?ruleId=${item.rule.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`View ${description}`}
              >
                <Text
                  className="text-body font-semibold text-foreground"
                  numberOfLines={1}
                >
                  {description}
                </Text>
                {secondary && secondary !== description && (
                  <Text
                    className="text-label text-muted-foreground"
                    numberOfLines={1}
                  >
                    {secondary} · {item.rule.frequency}
                  </Text>
                )}
                {!secondary && (
                  <Text className="text-label text-muted-foreground">
                    {item.rule.frequency}
                  </Text>
                )}
                {item.lastFulfillment ? (
                  <Text className="text-label text-faint-foreground mt-0.5">
                    Last paid on {formatDate(item.lastFulfillment.cycle_due_date)}
                  </Text>
                ) : (
                  <Text className="text-label text-faint-foreground mt-0.5">
                    Not linked to any expense yet
                  </Text>
                )}
                {tools.groupBy !== "state" && (
                  <Text className="text-label font-semibold mt-0.5" style={{ color: stateStyle.color }}>
                    {stateStyle.label}
                  </Text>
                )}
              </Pressable>
              {item.source?.amount ? (
                <Text className="text-body font-bold text-foreground ml-2" style={{ fontVariant: ["tabular-nums"] }}>
                  {formatAmount(item.source.amount)}
                </Text>
              ) : null}
              <Pressable
                onPress={() => handleStop(item)}
                className="w-9 h-9 rounded-full items-center justify-center ml-2"
                style={{ backgroundColor: tint(theme.mutedForeground, 0.08) }}
                accessibilityRole="button"
                accessibilityLabel="Stop reminder"
              >
                <Ionicons name="pause-outline" size={18} color={theme.mutedForeground} />
              </Pressable>
            </View>
          </DrawerCell>
);
        }}
        showsVerticalScrollIndicator={false}
      />
    </ScreenContainer>
  );
}
