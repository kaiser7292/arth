import { getDatabase } from "@/database";
import { Directory, File, Paths } from "expo-file-system";
import { BACKUP_TABLES, restoreFromData } from "./backup";
import type { RestoreResult } from "./backup";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTO_BACKUP_SUBDIR = "auto-backups";
const MAX_AUTO_BACKUPS = 10;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const APP_VERSION: string = require("../app.json").expo.version;

export const REASON_LABELS: Record<string, string> = {
  "delete-expense": "Before deleting expense",
  "purge-expenses": "Before emptying recycle bin",
  "delete-account": "Before deleting account",
  "purge-accounts": "Before purging all accounts",
  "delete-transfer": "Before deleting transfer",
  "purge-recycle-bin": "Before bulk purge",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoBackupInfo {
  fileName: string;
  filePath: string;
  timestamp: Date;
  reason: string;
}

interface AutoBackupPayload {
  version: number;
  appVersion: string;
  createdAt: string;
  reason: string;
  tables: string[];
  data: Record<string, unknown[]>;
}

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

function getAutoBackupDir(): Directory {
  return new Directory(Paths.document, AUTO_BACKUP_SUBDIR);
}

function ensureDir(): Directory {
  const dir = getAutoBackupDir();
  if (!dir.exists) dir.create({ idempotent: true });
  return dir;
}

// ---------------------------------------------------------------------------
// File name encoding / parsing
// ---------------------------------------------------------------------------

function buildFileName(timestamp: Date, reason: string): string {
  const ts = timestamp
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19); // "2026-07-05T14-30-00"
  const safeReason = reason.replace(/[^a-z0-9-]/gi, "-");
  return `checkpoint_${ts}_${safeReason}.json`;
}

function parseFileName(fileName: string): { timestamp: Date; reason: string } | null {
  const m = fileName.match(/^checkpoint_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})_(.+)\.json$/);
  if (!m) return null;
  const isoTs = m[1].replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3");
  return {
    timestamp: new Date(isoTs),
    reason: m[2],
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/** Fire-and-forget: call without await in delete handlers. */
export async function createAutoBackup(reason: string): Promise<void> {
  try {
    const db = getDatabase();
    const tableData: Record<string, unknown[]> = {};

    for (const table of BACKUP_TABLES) {
      try {
        tableData[table] = await db.getAllAsync(`SELECT * FROM ${table};`);
      } catch {
        tableData[table] = [];
      }
    }

    const payload: AutoBackupPayload = {
      version: 1,
      appVersion: APP_VERSION,
      createdAt: new Date().toISOString(),
      reason,
      tables: BACKUP_TABLES,
      data: tableData,
    };

    const dir = ensureDir();
    const fileName = buildFileName(new Date(), reason);
    const file = new File(dir, fileName);
    file.write(JSON.stringify(payload));

    // Prune: keep only the newest MAX_AUTO_BACKUPS
    pruneOldBackups(dir);
  } catch {
    // Silent — auto-backup failure must never block the user's delete action
  }
}

function pruneOldBackups(dir: Directory): void {
  try {
    const files = dir
      .list()
      .filter((f): f is File => f instanceof File && f.name.startsWith("checkpoint_"))
      .sort((a, b) => a.name.localeCompare(b.name)); // ascending = oldest first

    while (files.length > MAX_AUTO_BACKUPS) {
      const oldest = files.shift()!;
      try { oldest.delete(); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export function listAutoBackups(): AutoBackupInfo[] {
  try {
    const dir = getAutoBackupDir();
    if (!dir.exists) return [];

    return dir
      .list()
      .filter((f): f is File => f instanceof File && f.name.startsWith("checkpoint_"))
      .map((f) => {
        const parsed = parseFileName(f.name);
        if (!parsed) return null;
        return {
          fileName: f.name,
          filePath: f.uri,
          timestamp: parsed.timestamp,
          reason: parsed.reason,
        } satisfies AutoBackupInfo;
      })
      .filter((x): x is AutoBackupInfo => x !== null)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()); // newest first
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export async function restoreAutoBackup(filePath: string): Promise<RestoreResult> {
  try {
    const file = new File(filePath);
    if (!file.exists) {
      return { success: false, tablesRestored: [], totalRows: 0, error: "Checkpoint file not found." };
    }

    const raw = await file.text();
    let payload: AutoBackupPayload;
    try {
      payload = JSON.parse(raw) as AutoBackupPayload;
    } catch {
      return { success: false, tablesRestored: [], totalRows: 0, error: "Checkpoint file is corrupted." };
    }

    if (!payload.data || !payload.tables) {
      return { success: false, tablesRestored: [], totalRows: 0, error: "Invalid checkpoint format." };
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

export function deleteAutoBackup(filePath: string): void {
  try {
    const file = new File(filePath);
    if (file.exists) file.delete();
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Helpers for UI
// ---------------------------------------------------------------------------

export function formatCheckpointTime(timestamp: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - timestamp.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return timestamp.toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
