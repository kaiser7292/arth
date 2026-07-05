import * as Notifications from "expo-notifications";
import { Directory, File, Paths } from "expo-file-system";
import { SchedulableTriggerInputTypes } from "expo-notifications";
import { settingsStorage as storage } from "@/services/storage";
import { BACKUP_TABLES, restoreFromData } from "@/services/backup";
import type { RestoreResult } from "@/services/backup";
import { getDatabase } from "@/database";
import { logger } from "@/utils/logger";

// ---------------------------------------------------------------------------
// MMKV keys
// ---------------------------------------------------------------------------

const KEY_ENABLED = "scheduled_backup_enabled";
const KEY_HOUR = "scheduled_backup_hour";
const KEY_MINUTE = "scheduled_backup_minute";
const KEY_FREQ_DAYS = "scheduled_backup_frequency_days";
const KEY_LAST_RUN = "scheduled_backup_last_run_at";
const NOTIF_ID = "artha_scheduled_backup";
const BACKUP_SUBDIR = "scheduled-backups";
const MAX_BACKUPS = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupScheduleSettings {
  enabled: boolean;
  hour: number;
  minute: number;
  frequencyDays: number;
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
    hour: storage.getNumber(KEY_HOUR) ?? 2,
    minute: storage.getNumber(KEY_MINUTE) ?? 0,
    frequencyDays: storage.getNumber(KEY_FREQ_DAYS) ?? 1,
  };
}

export function setBackupScheduleSettings(s: BackupScheduleSettings): void {
  storage.set(KEY_ENABLED, s.enabled);
  storage.set(KEY_HOUR, s.hour);
  storage.set(KEY_MINUTE, s.minute);
  storage.set(KEY_FREQ_DAYS, s.frequencyDays);
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

  const now = new Date();
  if (now.getHours() < s.hour || (now.getHours() === s.hour && now.getMinutes() < s.minute)) return false;

  const lastRunStr = getLastScheduledBackupAt();
  if (!lastRunStr) return true;

  const diffDays = (now.getTime() - new Date(lastRunStr).getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= s.frequencyDays;
}

export async function runScheduledBackupIfDue(): Promise<void> {
  if (!shouldRunScheduledBackup()) return;
  try {
    await createScheduledBackup();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Backup saved",
        body: "Your scheduled Arth backup has been saved to your phone.",
        sound: false,
        data: { screen: "settings/backup-restore" },
      },
      trigger: null,
    });
  } catch (e) {
    logger.warn("runScheduledBackupIfDue failed", e);
  }
}

// ---------------------------------------------------------------------------
// List
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

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export function deleteScheduledBackup(filePath: string): void {
  try {
    const file = new File(filePath);
    if (file.exists) file.delete();
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Notification scheduling
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
        title: "Arth backup reminder",
        body: "Open Arth to save your scheduled backup.",
        sound: false,
        data: { screen: "settings/backup-restore" },
      },
      trigger: {
        type: SchedulableTriggerInputTypes.DAILY,
        hour: s.hour,
        minute: s.minute,
      },
    });
  } catch (e) {
    logger.warn("syncScheduledBackupNotification failed", e);
  }
}

// ---------------------------------------------------------------------------
// UI format helpers
// ---------------------------------------------------------------------------

export function formatScheduleTime(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const m = minute.toString().padStart(2, "0");
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h}:${m} ${ampm}`;
}

export function formatFrequency(days: number): string {
  if (days === 1) return "Daily";
  if (days === 7) return "Weekly";
  return `Every ${days} days`;
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
