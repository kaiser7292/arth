import * as BackgroundFetch from "expo-background-fetch";
import * as Notifications from "expo-notifications";
import { Directory, File, Paths } from "expo-file-system";
import { SchedulableTriggerInputTypes } from "expo-notifications";
import * as Sharing from "expo-sharing";
import * as TaskManager from "expo-task-manager";
import { settingsStorage as storage } from "@/services/storage";
import { isNotificationEnabled } from "@/services/notifications";
import { BACKUP_TABLES, restoreFromData } from "@/services/backup";
import type { RestoreResult } from "@/services/backup";
import { getDatabase } from "@/database";
import { logger } from "@/utils/logger";

const BACKUP_TASK = "ARTHA_SCHEDULED_BACKUP";
const BACKUP_NOTIF_TASK = "ARTHA_BACKUP_NOTIFICATION";

// ---------------------------------------------------------------------------
// MMKV keys
// ---------------------------------------------------------------------------

const KEY_ENABLED = "scheduled_backup_enabled";
const KEY_FREQ_HOURS = "scheduled_backup_frequency_hours";
const KEY_LAST_RUN = "scheduled_backup_last_run_at";
export const NOTIF_ID = "artha_scheduled_backup";
const BACKUP_SUBDIR = "scheduled-backups";
const MAX_BACKUPS = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupScheduleSettings {
  enabled: boolean;
  frequencyHours: number;
}

export interface ScheduledBackupInfo {
  fileName: string;
  filePath: string;
  timestamp: Date;
  fileSizeBytes: number;
}

// ---------------------------------------------------------------------------
// Settings read / write
// ---------------------------------------------------------------------------

export function getBackupScheduleSettings(): BackupScheduleSettings {
  return {
    enabled: storage.getBoolean(KEY_ENABLED) ?? false,
    frequencyHours: storage.getNumber(KEY_FREQ_HOURS) ?? 24,
  };
}

export function setBackupScheduleSettings(s: BackupScheduleSettings): void {
  storage.set(KEY_ENABLED, s.enabled);
  storage.set(KEY_FREQ_HOURS, s.frequencyHours);
}

export function getLastScheduledBackupAt(): string | null {
  return storage.getString(KEY_LAST_RUN) ?? null;
}

// ---------------------------------------------------------------------------
// Directory / file helpers
// ---------------------------------------------------------------------------

function getBackupDir(): Directory {
  return new Directory(Paths.document, BACKUP_SUBDIR);
}

function buildFileName(ts: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())}T${pad(ts.getHours())}-${pad(ts.getMinutes())}-${pad(ts.getSeconds())}`;
  return `backup_${local}.json`;
}

function parseFileName(name: string): Date | null {
  const m = name.match(/^backup_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.json$/);
  if (!m) return null;
  const iso = m[1].replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3");
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function pruneOldBackups(dir: Directory): void {
  try {
    const files = dir
      .list()
      .filter((f): f is File => f instanceof File && f.name.startsWith("backup_"))
      .sort((a, b) => a.name.localeCompare(b.name)); // ascending = oldest first
    while (files.length > MAX_BACKUPS) {
      try { files.shift()!.delete(); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createScheduledBackup(): Promise<void> {
  const db = getDatabase();
  const dir = getBackupDir();
  if (!dir.exists) dir.create({ idempotent: true });

  const now = new Date();
  const tableData: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) {
    try {
      tableData[table] = await db.getAllAsync(`SELECT * FROM ${table};`);
    } catch {
      tableData[table] = [];
    }
  }

  const file = new File(dir, buildFileName(now));
  file.write(JSON.stringify({ version: 1, createdAt: now.toISOString(), tables: BACKUP_TABLES, data: tableData }));
  pruneOldBackups(dir);
  storage.set(KEY_LAST_RUN, now.toISOString());
}

// ---------------------------------------------------------------------------
// Should-run check + run-if-due
// ---------------------------------------------------------------------------

export function shouldRunScheduledBackup(): boolean {
  const s = getBackupScheduleSettings();
  if (!s.enabled) return false;

  const lastRunStr = getLastScheduledBackupAt();
  if (!lastRunStr) return true;

  const elapsedMs = Date.now() - new Date(lastRunStr).getTime();
  return elapsedMs >= s.frequencyHours * 60 * 60 * 1000;
}

export async function runScheduledBackupIfDue(): Promise<void> {
  if (!shouldRunScheduledBackup()) return;
  try {
    await createScheduledBackup();
    if (isNotificationEnabled("scheduled_backup")) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Backup saved",
          body: "Your scheduled Arth backup has been saved to your phone.",
          sound: false,
          data: { screen: "settings/backup-restore" },
        },
        trigger: null,
      });
    }
  } catch (e) {
    logger.warn("runScheduledBackupIfDue failed", e);
  }
}

// ---------------------------------------------------------------------------
// List / restore / delete / share
// ---------------------------------------------------------------------------

export function listScheduledBackups(): ScheduledBackupInfo[] {
  try {
    const dir = getBackupDir();
    if (!dir.exists) return [];
    return dir
      .list()
      .filter((f): f is File => f instanceof File && f.name.startsWith("backup_"))
      .map((f) => {
        const ts = parseFileName(f.name);
        if (!ts) return null;
        return {
          fileName: f.name,
          filePath: f.uri,
          timestamp: ts,
          fileSizeBytes: f.size ?? 0,
        } satisfies ScheduledBackupInfo;
      })
      .filter((x): x is ScheduledBackupInfo => x !== null)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  } catch {
    return [];
  }
}

export async function restoreScheduledBackup(filePath: string): Promise<RestoreResult> {
  try {
    const file = new File(filePath);
    if (!file.exists) {
      return { success: false, tablesRestored: [], totalRows: 0, error: "Backup file not found." };
    }
    const raw = await file.text();
    let payload: { data: Record<string, unknown[]> };
    try {
      payload = JSON.parse(raw) as { data: Record<string, unknown[]> };
    } catch {
      return { success: false, tablesRestored: [], totalRows: 0, error: "Backup file is corrupted." };
    }
    if (!payload?.data) {
      return { success: false, tablesRestored: [], totalRows: 0, error: "Invalid backup format." };
    }
    return await restoreFromData(payload.data);
  } catch (e) {
    return {
      success: false,
      tablesRestored: [],
      totalRows: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function deleteScheduledBackup(filePath: string): void {
  try {
    const file = new File(filePath);
    if (file.exists) file.delete();
  } catch { /* ignore */ }
}

export async function shareScheduledBackup(filePath: string): Promise<void> {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(filePath, {
      mimeType: "application/json",
      dialogTitle: "Save Arth Auto-Backup",
    });
  }
}

// ---------------------------------------------------------------------------
// Notification scheduling — interval-based, fires every N hours
// ---------------------------------------------------------------------------

export async function syncScheduledBackupNotification(s: BackupScheduleSettings): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(NOTIF_ID);
  } catch { /* ignore — may not exist yet */ }

  if (!s.enabled) return;

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIF_ID,
      content: {
        title: "Arth backup",
        body: "Running your scheduled backup…",
        sound: false,
        data: { type: "scheduled_backup", screen: "settings/backup-restore" },
      },
      trigger: {
        type: SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: s.frequencyHours * 60 * 60,
        repeats: true,
      },
    });
  } catch (e) {
    logger.warn("syncScheduledBackupNotification failed", e);
  }
}

// ---------------------------------------------------------------------------
// Notification background task — runs backup when the notification fires,
// even when the app is closed. Registered via registerBackupNotificationTask.
// ---------------------------------------------------------------------------

TaskManager.defineTask(BACKUP_NOTIF_TASK, async ({ data }: TaskManager.TaskManagerTaskBody) => {
  try {
    const notification = (data as { notification?: Notifications.Notification })?.notification;
    if (notification?.request?.identifier !== NOTIF_ID) return;
    if (!shouldRunScheduledBackup()) return;
    await createScheduledBackup();
    if (isNotificationEnabled("scheduled_backup")) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Backup saved",
          body: "Your scheduled Arth backup has been saved.",
          sound: false,
          data: { screen: "settings/backup-restore" },
        },
        trigger: null,
      });
    }
  } catch (e) {
    logger.warn("Backup notification task failed:", e);
  }
});

export async function registerBackupNotificationTask(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKUP_NOTIF_TASK);
    if (!isRegistered) {
      await Notifications.registerTaskAsync(BACKUP_NOTIF_TASK);
    }
  } catch (e) {
    logger.warn("Failed to register backup notification task:", e);
  }
}

// ---------------------------------------------------------------------------
// BackgroundFetch task — best-effort fallback when notification task can't run
// ---------------------------------------------------------------------------

TaskManager.defineTask(BACKUP_TASK, async () => {
  try {
    if (!shouldRunScheduledBackup()) return BackgroundFetch.BackgroundFetchResult.NoData;
    await createScheduledBackup();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    logger.warn("Background backup task failed:", e);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function syncBackupBackgroundTask(): Promise<void> {
  const s = getBackupScheduleSettings();
  const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKUP_TASK);

  if (!s.enabled) {
    if (isRegistered) await BackgroundFetch.unregisterTaskAsync(BACKUP_TASK);
    return;
  }

  if (isRegistered) return;

  await BackgroundFetch.registerTaskAsync(BACKUP_TASK, {
    minimumInterval: s.frequencyHours * 60 * 60,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

// ---------------------------------------------------------------------------
// UI format helpers
// ---------------------------------------------------------------------------

export function formatFrequency(hours: number): string {
  if (hours < 24) return `Every ${hours}h`;
  if (hours === 24) return "Daily";
  if (hours === 48) return "Every 2 days";
  return `Every ${hours / 24} days`;
}

export function formatNextBackup(frequencyHours: number): string {
  const lastRunStr = getLastScheduledBackupAt();
  const nextMs = lastRunStr
    ? new Date(lastRunStr).getTime() + frequencyHours * 60 * 60 * 1000
    : Date.now();
  const next = new Date(Math.max(nextMs, Date.now()));
  const now = new Date();
  const diffMs = next.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMs / 3_600_000);
  if (diffMins <= 1) return "any moment";
  if (diffMins < 60) return `in ~${diffMins}m`;
  if (diffHours < 24) return `in ~${diffHours}h`;
  return next.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function formatLastBackupTime(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
