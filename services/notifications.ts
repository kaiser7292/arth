/**
 * Notification Service — V3-0.4
 *
 * Local push notifications for overdue forecasts, upcoming dues,
 * and scheduled backup. Uses expo-notifications (local only, no server).
 *
 * Notification preferences stored in MMKV for instant access.
 */

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { settingsStorage as storage } from "./storage";

// ─── Notification Categories ───

export type NotificationCategory = "overdue_forecast" | "upcoming_due" | "scheduled_backup";

const KEYS = {
  NOTIF_OVERDUE: "notif_overdue",
  NOTIF_UPCOMING: "notif_upcoming",
  NOTIF_SCHEDULED_BACKUP: "notif_scheduled_backup",
} as const;

const CATEGORY_KEY_MAP: Record<NotificationCategory, string> = {
  overdue_forecast: KEYS.NOTIF_OVERDUE,
  upcoming_due: KEYS.NOTIF_UPCOMING,
  scheduled_backup: KEYS.NOTIF_SCHEDULED_BACKUP,
};

// ─── Configuration ───

/**
 * Configure how notifications appear when app is in foreground.
 * Shows banner + sound even when app is open.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Set up Android notification channel. Required for Android 8+ (API 26+).
 * Without this, notifications won't show in App Info > Notifications on Pixel devices.
 * Safe to call multiple times — Android ignores duplicate channel creation.
 */
export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync("artha-default", {
    name: "Artha Notifications",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#2563EB",
  });
}

// ─── Permissions ───

/**
 * Request notification permissions from the OS.
 * Returns true if granted (or already granted).
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === "android") {
    // Android 13+ requires explicit notification permission
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === "granted") return true;

    const { status } = await Notifications.requestPermissionsAsync();
    return status === "granted";
  }

  // iOS
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;

  const { status } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return status === "granted";
}

/**
 * Check if notification permissions are currently granted.
 */
export async function hasNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === "granted";
}

// ─── Preference Getters/Setters ───

/**
 * Check if a notification category is enabled. Default: all enabled.
 */
export function isNotificationEnabled(category: NotificationCategory): boolean {
  const key = CATEGORY_KEY_MAP[category];
  return storage.getBoolean(key) ?? true;
}

/**
 * Enable or disable a notification category.
 */
export function setNotificationEnabled(category: NotificationCategory, enabled: boolean): void {
  const key = CATEGORY_KEY_MAP[category];
  storage.set(key, enabled);
}

/**
 * Get all notification preferences as a map.
 */
export function getNotificationPreferences(): Record<NotificationCategory, boolean> {
  return {
    overdue_forecast: isNotificationEnabled("overdue_forecast"),
    upcoming_due: isNotificationEnabled("upcoming_due"),
    scheduled_backup: isNotificationEnabled("scheduled_backup"),
  };
}

// ─── Send Notifications ───

export interface NotificationData {
  screen?: string;
  [key: string]: unknown;
}

/**
 * Schedule an immediate local notification.
 * Returns the notification identifier (for cancellation).
 */
export async function sendLocalNotification(
  title: string,
  body: string,
  data?: NotificationData,
): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data ?? {},
      sound: true,
      ...(Platform.OS === "android" ? { channelId: "artha-default" } : {}),
    },
    trigger: null, // immediate
  });
}

/**
 * Schedule a notification with a delay (in seconds).
 */
export async function scheduleDelayedNotification(
  title: string,
  body: string,
  delaySeconds: number,
  data?: NotificationData,
): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data ?? {},
      sound: true,
      ...(Platform.OS === "android" ? { channelId: "artha-default" } : {}),
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: delaySeconds },
  });
}

/**
 * Cancel a scheduled notification by ID.
 */
export async function cancelNotification(id: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(id);
}

/**
 * Cancel all scheduled notifications.
 */
export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Get count of all pending scheduled notifications.
 */
export async function getPendingNotificationCount(): Promise<number> {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  return pending.length;
}
