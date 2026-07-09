/**
 * Notification Scheduler
 *
 * Single daily digest at 9:10 AM local time (DATE trigger via AlarmManager).
 * Content is pre-baked from current DB state when the app is last open.
 * If nothing is due, the slot is cancelled — no empty nudges.
 * Monthly summary fires on the 1st via MONTHLY trigger.
 */

import { DEFAULT_USER_ID } from "@/constants/app";
import { getForecastExpenses, getOverdueForecasts, getRecurringReminders as getReminders } from "@/services/expense";
import {
  hasNotificationPermission,
  isNotificationEnabled,
} from "@/services/notifications";
import { settingsStorage as storage } from "@/services/storage";
import { logger } from "@/utils/logger";
import * as BackgroundFetch from "expo-background-fetch";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

const LAST_SCHEDULE_SYNC_KEY = "notif_last_schedule_sync_ts";

const NOTIF_CHECK_TASK = "ARTHA_NOTIF_CHECK";
const DAILY_DIGEST_ID = "artha_daily_digest";

// ─── Background task — re-syncs the digest schedule without an app open ───

TaskManager.defineTask(NOTIF_CHECK_TASK, async () => {
  try {
    if (!(await hasNotificationPermission())) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }
    await scheduleSmartDailyDigest(DEFAULT_USER_ID);
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    logger.warn("notification background task failed", e);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ─── Daily digest ───

/**
 * Schedule a single daily digest at 9:10 AM local time.
 * Queries current overdue/upcoming/reminder/EMI state and pre-bakes content.
 * Cancels the slot if nothing is actionable — no notification fires.
 */
export async function scheduleSmartDailyDigest(userId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(DAILY_DIGEST_ID).catch(() => {});

  const overdueEnabled = isNotificationEnabled("overdue_forecast");
  const upcomingEnabled = isNotificationEnabled("upcoming_due");
  if (!overdueEnabled && !upcomingEnabled) return;
  if (!(await hasNotificationPermission())) return;

  const today = todayString();
  const parts: string[] = [];

  try {
    const { getDatabase } = await import("@/database");
    const db = getDatabase();

    if (overdueEnabled) {
      const overdue = await getOverdueForecasts(userId, today);
      if (overdue.length > 0) {
        parts.push(`${overdue.length} overdue payment${overdue.length > 1 ? "s" : ""}`);
      }
    }

    if (upcomingEnabled) {
      const forecasts = await getForecastExpenses(userId, "approved");
      const upcoming = forecasts.filter((e) => {
        if (!e.due_date) return false;
        const d = daysFromNow(e.due_date);
        return d >= 0 && d <= 2;
      });
      if (upcoming.length > 0) {
        parts.push(`${upcoming.length} payment${upcoming.length > 1 ? "s" : ""} due soon`);
      }

      const reminders = await getReminders(userId);
      const dueReminders = reminders.filter(
        (r) => r.state === "due_soon" || r.state === "overdue",
      );
      if (dueReminders.length > 0) {
        parts.push(`${dueReminders.length} reminder${dueReminders.length > 1 ? "s" : ""} due`);
      }

      const twoDaysOut = new Date(Date.now() + 2 * 86400000).toISOString().split("T")[0];
      const upcomingEMIs = await db.getAllAsync<{ id: string }>(
        `SELECT se.id FROM loan_schedule_entries se
         JOIN loan_accounts la ON la.id = se.loan_account_id
         JOIN financial_accounts fa ON fa.id = la.financial_account_id
         WHERE fa.user_id = ? AND la.status = 'active' AND se.status = 'scheduled'
           AND se.due_date >= ? AND se.due_date <= ?
         LIMIT 1;`,
        userId, today, twoDaysOut,
      );
      if (upcomingEMIs.length > 0) {
        parts.push("EMI due soon");
      }
    }

    const pendingRows = await db.getAllAsync<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM expenses
       WHERE user_id = ? AND status = 'pending_review' AND deleted_at IS NULL;`,
      userId,
    );
    const pendingCount = pendingRows[0]?.cnt ?? 0;
    if (pendingCount > 0) {
      parts.push(`${pendingCount} pending review`);
    }
  } catch (e) {
    logger.warn("scheduleSmartDailyDigest: data query failed", e);
    return;
  }

  if (parts.length === 0) return;

  const target = new Date();
  target.setHours(9, 10, 0, 0);
  if (target <= new Date()) target.setDate(target.getDate() + 1);

  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_DIGEST_ID,
    content: {
      title: "",
      body: parts.join(" · "),
      data: { screen: "/(tabs)" },
      sound: true,
      ...(Platform.OS === "android" ? { channelId: "artha-default" } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: target,
    },
  });
}

// ─── Master sync ───

export async function syncAllScheduledNotifications(userId: string): Promise<void> {
  const lastSync = storage.getNumber(LAST_SCHEDULE_SYNC_KEY) ?? 0;
  if (Date.now() - lastSync < 60 * 60 * 1000) return;
  storage.set(LAST_SCHEDULE_SYNC_KEY, Date.now());

  if (!(await hasNotificationPermission())) return;

  await scheduleSmartDailyDigest(userId);
}

export async function forceSyncScheduledNotifications(userId: string): Promise<void> {
  storage.set(LAST_SCHEDULE_SYNC_KEY, 0);
  await syncAllScheduledNotifications(userId);
}

// ─── Background task registration ───

export async function registerNotifBackgroundTask(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(NOTIF_CHECK_TASK);
  if (isRegistered) return;
  await BackgroundFetch.registerTaskAsync(NOTIF_CHECK_TASK, {
    minimumInterval: 12 * 60 * 60,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

export async function unregisterNotifBackgroundTask(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(NOTIF_CHECK_TASK);
  if (!isRegistered) return;
  await BackgroundFetch.unregisterTaskAsync(NOTIF_CHECK_TASK);
}

export async function syncNotifBackgroundTask(): Promise<void> {
  const overdueEnabled = isNotificationEnabled("overdue_forecast");
  const upcomingEnabled = isNotificationEnabled("upcoming_due");
  if (overdueEnabled || upcomingEnabled) {
    await registerNotifBackgroundTask();
  } else {
    await unregisterNotifBackgroundTask();
  }
}

export async function runDailyNotificationCheck(userId: string): Promise<void> {
  syncAllScheduledNotifications(userId).catch((e) => logger.warn("Schedule sync failed", e));
}

// ─── Helpers ───

function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

function daysFromNow(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}
