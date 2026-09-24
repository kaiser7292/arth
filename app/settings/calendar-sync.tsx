/**
 * Calendar sync settings — see docs/CALENDAR_SYNC_PROPOSAL.md.
 */

import { Ionicons } from "@expo/vector-icons";
import type * as CalendarTypes from "expo-calendar";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { Button, Card, ScreenContainer, Text, useToast } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useAlert } from "@/hooks/use-alert";
import { useTheme } from "@/hooks/use-theme";
import type { CalendarItemKind, CalendarPrefs, SyncResult } from "@/services/calendar-sync";
import {
  ensureArthCalendar,
  getCalendarPrefs,
  getLastSync,
  getWritableCalendars,
  hasCalendarPermission,
  isArthCalendar,
  removeArthEvents,
  requestCalendarPermission,
  setCalendarPrefs,
  syncCalendar,
} from "@/services/calendar-sync";

const ARTH_OPTION = "__arth_local__";

const KIND_ROWS: { kind: CalendarItemKind; title: string; subtitle: string }[] = [
  { kind: "due", title: "Dues & card bills", subtitle: "Forecasted payments and credit card bills" },
  { kind: "emi", title: "Loan EMIs", subtitle: "Scheduled instalments on active loans" },
  { kind: "reminder", title: "Reminders", subtitle: "Your recurring payment reminders" },
  { kind: "fd", title: "FD maturities", subtitle: "When a fixed deposit matures" },
];

function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function describeResult(r: SyncResult | null): string {
  if (!r) return "Not synced yet";
  if (r.ok) return `Last synced ${ago(r.at)} · ${r.total} event${r.total !== 1 ? "s" : ""}`;
  if (r.error === "no_permission") return "Calendar permission is off. Turn it on in Android settings.";
  if (r.error === "no_calendar") return "The chosen calendar is gone. Pick another below.";
  return `Last sync failed ${ago(r.at)}`;
}

function Row({
  title,
  subtitle,
  value,
  onChange,
  disabled,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View className="flex-row items-center justify-between py-3 border-b border-border">
      <View className="flex-1 mr-3">
        <Text className="text-sm font-medium text-foreground">{title}</Text>
        {subtitle ? <Text className="text-xs text-muted-foreground mt-0.5">{subtitle}</Text> : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: theme.border, true: theme.primary }}
        thumbColor={value ? "#FFFFFF" : theme.faintForeground}
      />
    </View>
  );
}

export default function CalendarSyncScreen() {
  const theme = useTheme();
  const toast = useToast();
  const alert = useAlert();
  const [prefs, setPrefs] = useState<CalendarPrefs>(() => getCalendarPrefs());
  const [calendars, setCalendars] = useState<CalendarTypes.Calendar[]>([]);
  const [last, setLast] = useState<SyncResult | null>(() => getLastSync());
  const [syncing, setSyncing] = useState(false);

  const loadCalendars = useCallback(async () => {
    if (!(await hasCalendarPermission())) return;
    try {
      setCalendars(await getWritableCalendars());
    } catch {
      setCalendars([]);
    }
  }, []);

  useEffect(() => {
    void loadCalendars();
  }, [loadCalendars]);

  const runSync = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await syncCalendar(DEFAULT_USER_ID);
      setLast(getLastSync() ?? r);
      if (r.ok) toast(`Calendar updated · ${r.total} event${r.total !== 1 ? "s" : ""}`, { tone: "success" });
    } finally {
      setSyncing(false);
    }
  }, [toast]);

  const update = useCallback(
    async (patch: Partial<CalendarPrefs>, resync = true) => {
      const next = setCalendarPrefs(patch);
      setPrefs(next);
      if (resync && next.enabled && next.calendarId) await runSync();
    },
    [runSync],
  );

  const toggleEnabled = useCallback(
    async (on: boolean) => {
      if (on) {
        const granted = (await hasCalendarPermission()) || (await requestCalendarPermission());
        if (!granted) {
          alert("Permission needed", "Arth needs calendar access to add events. You can allow it in Android settings.");
          return;
        }
        await loadCalendars();
        await update({ enabled: true });
        return;
      }
      const removed = await removeArthEvents();
      await update({ enabled: false }, false);
      setLast(null);
      toast(removed > 0 ? `Removed ${removed} upcoming event${removed !== 1 ? "s" : ""}` : "Calendar sync off");
    },
    [alert, loadCalendars, update, toast],
  );

  const pickCalendar = useCallback(
    async (choice: string) => {
      const id = choice === ARTH_OPTION ? await ensureArthCalendar() : choice;
      if (id === prefs.calendarId) return;
      // Moving calendars: take Arth's events out of the old one first, so nothing is left behind.
      if (prefs.calendarId) await removeArthEvents();
      await update({ calendarId: id });
      await loadCalendars();
    },
    [prefs.calendarId, update, loadCalendars],
  );

  // Group writable calendars by account; the phone-only Arth calendar is offered separately.
  const others = calendars.filter((c) => !isArthCalendar(c));
  const groups = new Map<string, CalendarTypes.Calendar[]>();
  for (const c of others) {
    const acct = c.source?.name ?? "Other";
    groups.set(acct, [...(groups.get(acct) ?? []), c]);
  }
  const arthCal = calendars.find(isArthCalendar);
  const selectedIsArth = arthCal != null && prefs.calendarId === arthCal.id;
  const selected = calendars.find((c) => c.id === prefs.calendarId);
  const syncsToCloud = selected != null && !selected.source?.isLocalAccount;

  const option = (key: string, title: string, subtitle: string | null, isSelected: boolean, color?: string) => (
    <Pressable
      key={key}
      onPress={() => void pickCalendar(key)}
      className="flex-row items-center py-3 border-b border-border"
      accessibilityRole="radio"
      accessibilityState={{ selected: isSelected }}
    >
      <View className="w-3 h-3 rounded-full mr-3" style={{ backgroundColor: color ?? theme.primary }} />
      <View className="flex-1">
        <Text className="text-sm font-medium text-foreground">{title}</Text>
        {subtitle ? <Text className="text-xs text-muted-foreground mt-0.5">{subtitle}</Text> : null}
      </View>
      <Ionicons
        name={isSelected ? "radio-button-on" : "radio-button-off"}
        size={20}
        color={isSelected ? theme.primary : theme.mutedForeground}
      />
    </Pressable>
  );

  return (
    <ScreenContainer padTop={false}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-4 pt-5 pb-3">
          <Text className="text-lg font-bold text-foreground">Calendar sync</Text>
          <Text className="text-xs text-muted-foreground mt-1">
            Adds upcoming bills, EMIs, reminders and FD maturities to your calendar, with an alert the day before.
          </Text>
        </View>

        <Card className="mx-4 mb-3">
          <Row title="Sync to calendar" value={prefs.enabled} onChange={(v) => void toggleEnabled(v)} />
          {prefs.enabled && (
            <Text className="text-xs text-muted-foreground pt-3">{describeResult(last)}</Text>
          )}
        </Card>

        {prefs.enabled && (
          <>
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 mt-2 mb-2">
              Calendar
            </Text>
            <Card className="mx-4 mb-3">
              {option(
                ARTH_OPTION,
                "Arth (this phone only)",
                "Never leaves the phone. Shows in any calendar app here.",
                selectedIsArth,
              )}
              {[...groups.entries()].map(([acct, cals]) => (
                <View key={acct}>
                  <Text className="text-xs text-muted-foreground pt-3">{acct}</Text>
                  {cals.map((c) => option(c.id, c.title, null, c.id === prefs.calendarId, c.color))}
                </View>
              ))}
              {!prefs.calendarId && (
                <Text className="text-xs pt-3" style={{ color: theme.warning }}>
                  Pick a calendar to start syncing.
                </Text>
              )}
            </Card>
            {syncsToCloud && (
              <View className="mx-4 mb-3 px-3 py-2.5 rounded-xl" style={{ backgroundColor: theme.alpha("primary", 0.08) }}>
                <Text className="text-xs text-muted-foreground">
                  This calendar syncs to {selected?.source?.name ?? "your account"} through Android, so events will also
                  appear on your other devices{prefs.showAmounts ? ", amounts included" : ""}. Arth itself never
                  connects to Google.
                </Text>
              </View>
            )}

            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 mt-2 mb-2">
              What to add
            </Text>
            <Card className="mx-4 mb-3">
              {KIND_ROWS.map((r) => (
                <Row
                  key={r.kind}
                  title={r.title}
                  subtitle={r.subtitle}
                  value={prefs.kinds[r.kind]}
                  onChange={(v) => void update({ kinds: { ...prefs.kinds, [r.kind]: v } })}
                />
              ))}
              <Row
                title="Show amounts"
                subtitle="Off shows only the name, e.g. “HDFC card bill”"
                value={prefs.showAmounts}
                onChange={(v) => void update({ showAmounts: v })}
              />
            </Card>

            <View className="mx-4 mt-2">
              <Button title="Sync now" onPress={() => void runSync()} loading={syncing} disabled={!prefs.calendarId} />
            </View>
            <Text className="text-xs text-muted-foreground mx-4 mt-3">
              Covers the next 90 days. Arth updates the calendar when you open or leave the app. Mark things paid in
              Arth; edits made in the calendar get overwritten. Past events stay in your calendar as history.
            </Text>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
