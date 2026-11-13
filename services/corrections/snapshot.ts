import { File, Paths } from "expo-file-system";
import { getDatabase } from "@/database";
import { exportSettings, type SettingValue } from "@/services/backup-settings";
import { BACKUP_TABLES, restoreFromData } from "@/services/backup";
import { settingsStorage } from "@/services/storage";

/**
 * Fix my data's record of fixes, and Undo.
 *
 * History: every AI correction and every bank match, newest first, with what it changed and what
 * moved. Kept on this phone (the last 50).
 *
 * Undo: one full copy of all data (every backed-up table and setting), written right before an AI
 * correction is applied and put back through the same path a backup restore uses. So:
 *   - only the most recent AI correction can be undone; applying another replaces the copy,
 *   - there is no time limit, but undo puts back EVERYTHING as it was before that correction, so
 *     transactions and edits made since are lost too - undoChangesSince() counts them first,
 *   - a bank match isn't in the copy: it's a visible adjustment, deleted from the account's ledger.
 */

const FILE_NAME = "fix-my-data-undo.json";
const HISTORY_KEY = "fix_my_data_history";
/** Before the history existed: one entry for the undoable correction. Read once, then dropped. */
const LEGACY_LAST_KEY = "fix_my_data_last";
const MAX_HISTORY = 50;

export interface FixHistoryEntry {
  id: string;
  kind: "ai" | "match";
  /** When it finished (ISO). */
  at: string;
  /** "143 corrections from your AI" / "HDFC ··4521 matched to ₹52,140". */
  title: string;
  changes: number;
  groups: { label: string; count: number }[];
  moved: { label: string; before: number; value: number; unit: "money" | "percent" | "count" }[];
  failed: number;
  /** Set once undone (ISO). */
  undoneAt?: string;
}

function snapshotFile(): File {
  return new File(Paths.document, FILE_NAME);
}

function save(history: FixHistoryEntry[]): void {
  settingsStorage.set(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

export function getFixHistory(): FixHistoryEntry[] {
  let history: FixHistoryEntry[] = [];
  try {
    history = JSON.parse(settingsStorage.getString(HISTORY_KEY) ?? "[]") as FixHistoryEntry[];
    if (!Array.isArray(history)) history = [];
  } catch {
    history = [];
  }
  // One-time: a correction applied before the history existed.
  const legacy = settingsStorage.getString(LEGACY_LAST_KEY);
  if (legacy) {
    try {
      const old = JSON.parse(legacy) as { appliedAt: string; changes: number };
      history = [
        { id: `ai-${old.appliedAt}`, kind: "ai", at: old.appliedAt, title: `${old.changes} corrections from your AI`, changes: old.changes, groups: [], moved: [], failed: 0 },
        ...history,
      ];
      save(history);
    } catch {
      // unreadable: nothing to carry over
    }
    settingsStorage.delete(LEGACY_LAST_KEY);
  }
  return history;
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

export function addFixHistory(entry: Omit<FixHistoryEntry, "id">): FixHistoryEntry {
  const full = { ...entry, id: `${entry.kind}-${entry.at}` };
  save([full, ...getFixHistory()]);
  return full;
}

/** The AI correction Undo would put back, if any: the newest one, not undone, with its copy still on the phone. */
export function getUndoable(): FixHistoryEntry | null {
  const latest = getFixHistory().find((e) => e.kind === "ai");
  if (!latest || latest.undoneAt) return null;
  return snapshotFile().exists ? latest : null;
}

/** SQLite's datetime('now') form, for comparing with created_at / updated_at. */
function sqliteTime(iso: string): string {
  return new Date(iso).toISOString().replace("T", " ").slice(0, 19);
}

/** Transactions and transfers added or changed after a correction: what Undo would lose. */
export async function undoChangesSince(at: string): Promise<{ added: number; changed: number }> {
  const db = getDatabase();
  const since = sqliteTime(at);
  const n = async (sql: string) => (await db.getFirstAsync<{ n: number }>(sql, since))?.n ?? 0;
  const [addedTx, addedTr, changedTx] = await Promise.all([
    n(`SELECT COUNT(*) AS n FROM expenses WHERE created_at > ?;`),
    n(`SELECT COUNT(*) AS n FROM account_transfers WHERE created_at > ?;`),
    n(`SELECT COUNT(*) AS n FROM expenses WHERE updated_at > ? AND created_at <= updated_at AND created_at <= '${since}';`),
  ]);
  return { added: addedTx + addedTr, changed: changedTx };
}

/** Puts everything back as it was before the latest AI correction, and marks it undone. */
export async function undoLastCorrection(): Promise<void> {
  const target = getUndoable();
  const file = snapshotFile();
  if (!target || !file.exists) throw new Error("There's nothing to undo");
  const { data, settings } = JSON.parse(await file.text()) as { data: Record<string, unknown[]>; settings: SettingValue[] };
  const result = await restoreFromData(data, null, settings, null);
  if (!result.success) throw new Error(result.error ?? "Couldn't put your data back");
  // The restore may have put back older settings; the history is this phone's own record, so
  // write it again with this correction marked undone.
  save(getFixHistory().map((e) => (e.id === target.id ? { ...e, undoneAt: new Date().toISOString() } : e)));
  try {
    file.delete();
  } catch {
    // stale copy; getUndoable ignores it once the entry is undone
  }
}
