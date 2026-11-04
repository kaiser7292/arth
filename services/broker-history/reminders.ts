import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { hasNotificationPermission } from "@/services/notifications";
import { settingsStorage } from "@/services/storage";
import { logger } from "@/utils/logger";
import { connectedApiBrokers, isCapturedToday, linkedAccountFor } from "./capture";
import type { ApiBroker } from "./types";

/**
 * "Save today's trades" at 8 pm on weekdays, for each connected broker. Each has its own off switch.
 *
 * A reminder can't check anything when it fires, so several days are scheduled ahead and today's is
 * withdrawn once today is saved. Every app start, capture and background run tops the schedule up.
 */

const OFF_KEY = "broker_reminder_off__";
const REMINDER_HOUR = 20;
const DAYS_AHEAD = 7;

const SCREEN: Record<ApiBroker, string> = {
  kite: "settings/kite-connect",
  angel: "settings/angel-connect",
  zebpay: "settings/zebpay-connect",
};

const TEXT: Record<ApiBroker, { title: string; body: string }> = {
  kite: { title: "Save today's Zerodha trades", body: "Log in once so today's trades are kept." },
  angel: { title: "Save today's Angel One trades", body: "Open Arth so today's trades are kept." },
  zebpay: { title: "Save today's Zebpay trades", body: "Open Arth so today's trades are kept." },
};

export function isBrokerReminderOn(broker: ApiBroker): boolean {
  return !settingsStorage.getBoolean(OFF_KEY + broker);
}

export function setBrokerReminderOn(broker: ApiBroker, on: boolean): void {
  settingsStorage.set(OFF_KEY + broker, !on);
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const reminderId = (broker: ApiBroker, date: string) => `broker_reminder_${broker}_${date}`;

/** The weekdays to remind on, from now: today only if it's not yet 8 pm and today isn't saved. */
export function reminderDates(now: Date, savedToday: boolean, days: number = DAYS_AHEAD): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, REMINDER_HOUR, 0, 0, 0);
    const day = d.getDay();
    if (day === 0 || day === 6) continue;
    if (d <= now) continue;
    if (i === 0 && savedToday) continue;
    out.push(d);
  }
  return out;
}

export async function syncBrokerReminders(now: Date = new Date()): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const mine = scheduled.map((n) => n.identifier).filter((id) => id.startsWith("broker_reminder_"));
    await Promise.all(mine.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
    if (!(await hasNotificationPermission())) return;

    for (const broker of await connectedApiBrokers()) {
      // Nothing can be saved until the broker is linked to an account, so there's nothing to remind about.
      if (!isBrokerReminderOn(broker) || !linkedAccountFor(broker)) continue;
      const saved = await isCapturedToday(broker, isoOf(now));
      for (const date of reminderDates(now, saved)) {
        await Notifications.scheduleNotificationAsync({
          identifier: reminderId(broker, isoOf(date)),
          content: {
            ...TEXT[broker],
            data: { screen: SCREEN[broker] },
            sound: true,
            ...(Platform.OS === "android" ? { channelId: "artha-default" } : {}),
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
        });
      }
    }
  } catch (e) {
    logger.warn("[broker-history] reminder sync failed", e);
  }
}
