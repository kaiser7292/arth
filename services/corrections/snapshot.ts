import { File, Paths } from "expo-file-system";
import { getDatabase } from "@/database";
import { exportSettings, type SettingValue } from "@/services/backup-settings";
import { BACKUP_TABLES, restoreFromData } from "@/services/backup";
import { settingsStorage } from "@/services/storage";

/**
 * Undo for Fix my data: every backed-up table and setting, written to the app's own folder right
 * before corrections are applied, and put back through the same path a backup restore uses. Only
 * the latest correction can be undone; a new one replaces the snapshot.
 */

const FILE_NAME = "fix-my-data-undo.json";
const LAST_KEY = "fix_my_data_last";

export interface LastCorrection {
  appliedAt: string;
  changes: number;
}

function snapshotFile(): File {
  return new File(Paths.document, FILE_NAME);
}

export async function takeSnapshot(): Promise<void> {
  const db = getDatabase();
  const data: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) {
    try {
      data[table] = await db.getAllAsync(`SELECT * FROM ${table};`);
    } catch {
      data[table] = []; // a table this install doesn't have yet
    }
  }
  const file = snapshotFile();
  try {
    if (file.exists) file.delete();
  } catch {
    // overwritten below
  }
  file.write(JSON.stringify({ data, settings: exportSettings() }));
}

export function recordApplied(changes: number): void {
  settingsStorage.set(LAST_KEY, JSON.stringify({ appliedAt: new Date().toISOString(), changes } satisfies LastCorrection));
}

/** The correction that can still be undone, if any. */
export function getLastCorrection(): LastCorrection | null {
  try {
    const raw = settingsStorage.getString(LAST_KEY);
    if (!raw || !snapshotFile().exists) return null;
    return JSON.parse(raw) as LastCorrection;
  } catch {
    return null;
  }
}

/** Puts everything back as it was before the last correction, then forgets it. */
export async function undoLastCorrection(): Promise<void> {
  const file = snapshotFile();
  if (!file.exists) throw new Error("There's nothing to undo");
  const { data, settings } = JSON.parse(await file.text()) as { data: Record<string, unknown[]>; settings: SettingValue[] };
  const result = await restoreFromData(data, null, settings, null);
  if (!result.success) throw new Error(result.error ?? "Couldn't put your data back");
  forgetLastCorrection();
}

export function forgetLastCorrection(): void {
  settingsStorage.delete(LAST_KEY);
  try {
    const file = snapshotFile();
    if (file.exists) file.delete();
  } catch {
    // stale file; harmless
  }
}
