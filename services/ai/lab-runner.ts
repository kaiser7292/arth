/**
 * The AI lab's batch test, run outside the screen so the user can leave the lab while Gemini
 * Nano works through the messages. One run at a time; the lab screen and the finish toast
 * (components/ai/LabRunToaster.tsx) both read it through subscribeLabRun.
 *
 * Android only runs on-device AI while Arth is on screen. When Arth goes to the background the
 * run pauses on the message it was on and carries on when Arth comes back, instead of marking
 * the rest as errors. Closing Arth ends the run.
 *
 * When a run finishes or is stopped, the messages it read are saved to Scan history
 * (sms_scan_runs with source "ai"), next to the SMS scans, so a run can be looked at again later.
 */

import { AppState } from "react-native";
import { DEFAULT_USER_ID } from "@/constants/app";
import { markScanDetailAdded, saveScanRun, type ScanDetail, type ScanDetailCategory } from "@/services/sms/sms-scan-logging";
import { logger } from "@/utils/logger";
import type { MoneyMap } from "./money-map";
import { NanoUnavailableError } from "./nano";
import { readSmsWithNano, type ReadSmsOutcome } from "./tasks/read-sms";

export interface RunRow {
  id: string;
  sender: string;
  body: string;
  date?: number;
  outcome?: ReadSmsOutcome;
  raw?: string;
  ms?: number;
  error?: string;
  /** "Add to Catch Up" was tapped: the transaction made, or null when Arth didn't add one. */
  added?: { expenseId: string | null; note: string | null };
}

export interface LabRun {
  rows: RunRow[];
  running: boolean;
  /** Waiting for Arth to be on screen again. */
  paused: boolean;
  /** The user pressed Stop. */
  stopped: boolean;
  /** What was asked for, e.g. "Last 90 days · 50 messages". */
  label: string;
  /** The Scan history run it was saved as, once it ended. */
  historyId?: string;
}

const EMPTY: LabRun = { rows: [], running: false, paused: false, stopped: false, label: "" };

function categoryOf(row: RunRow): ScanDetailCategory | null {
  if (row.error) return "ai_error";
  switch (row.outcome?.kind) {
    case "transaction":
      return "ai_transaction";
    case "not_transaction":
      return "ai_not_money";
    case "ignored":
      return "ai_ignored";
    case "rejected":
      return "ai_rejected";
    default:
      return null; // not read yet: the run was stopped first
  }
}

/** A read row as a Scan history detail. Exported for tests. */
export function labRowToDetail(row: RunRow): ScanDetail | null {
  const category = categoryOf(row);
  if (!category) return null;
  const o = row.outcome;
  return {
    smsAddress: row.sender,
    smsBodyPreview: row.body,
    smsDate: row.date ?? null,
    category,
    filterReason: row.error ?? (o?.kind === "rejected" ? o.problems.join("; ") : null),
    parsedAmount: o?.kind === "transaction" ? o.result.amount : null,
    parsedMerchant: o?.kind === "transaction" ? o.result.merchant : null,
    parsedType: o?.kind === "transaction" ? o.result.type : null,
    messageRef: row.id,
    aiResult: o ?? null,
    aiMs: row.ms ?? null,
    addedExpenseId: row.added?.expenseId ?? null,
    addedNote: row.added?.note ?? null,
  };
}

async function saveToHistory(run: LabRun, durationMs: number): Promise<string | undefined> {
  const details = run.rows.map(labRowToDetail).filter((d): d is ScanDetail => d != null);
  if (details.length === 0) return undefined;
  try {
    return await saveScanRun({
      userId: DEFAULT_USER_ID,
      source: "ai",
      label: run.label,
      isManual: true,
      smsReadCount: details.length,
      hardcodedMatchCount: 0,
      templateMatchCount: 0,
      filteredCount: 0,
      unrecognizedCount: 0,
      skippedCount: 0,
      expenseCreatedCount: 0,
      creditCreatedCount: 0,
      durationMs,
      error: run.stopped ? "Stopped before the end" : null,
      details,
    });
  } catch (e) {
    logger.warn("Failed to save AI scan to history (non-fatal):", e);
    return undefined;
  }
}

let state: LabRun = EMPTY;
let stopRequested = false;
const listeners = new Set<() => void>();
const finishListeners = new Set<(run: LabRun) => void>();

function set(next: Partial<LabRun>): void {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function getLabRun(): LabRun {
  return state;
}

/** For useSyncExternalStore: called on every change. */
export function subscribeLabRun(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called once when a run finishes on its own (not when stopped). */
export function onLabRunFinished(listener: (run: LabRun) => void): () => void {
  finishListeners.add(listener);
  return () => finishListeners.delete(listener);
}

/** Resolves once Arth is on screen. */
function untilActive(): Promise<void> {
  if (AppState.currentState === "active") return Promise.resolve();
  set({ paused: true });
  return new Promise((resolve) => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" || stopRequested) {
        sub.remove();
        set({ paused: false });
        resolve();
      }
    });
  });
}

async function readOne(row: RunRow, map: MoneyMap | undefined): Promise<RunRow> {
  for (;;) {
    await untilActive();
    if (stopRequested) return row;
    try {
      const r = await readSmsWithNano(row.body, row.sender, map);
      return { ...row, outcome: r.outcome, raw: r.raw, ms: r.ms };
    } catch (e) {
      // Arth went to the background mid-call: wait, then ask again rather than record an error.
      if (e instanceof NanoUnavailableError && AppState.currentState !== "active") continue;
      return { ...row, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

/** Start a run. Ignored while one is already running. */
export async function startLabRun(rows: RunRow[], label: string, map?: MoneyMap): Promise<void> {
  if (state.running) return;
  stopRequested = false;
  const startedAt = Date.now();
  set({ rows, running: true, paused: false, stopped: false, label, historyId: undefined });
  for (const row of rows) {
    if (stopRequested) break;
    const done = await readOne(row, map);
    if (stopRequested) break;
    set({ rows: state.rows.map((r) => (r.id === done.id ? done : r)) });
  }
  const stopped = stopRequested;
  set({ running: false, paused: false, stopped });
  const historyId = await saveToHistory(state, Date.now() - startedAt);
  if (historyId) set({ historyId });
  if (!stopped) finishListeners.forEach((l) => l(state));
}

/** Remember that a row was added to Catch Up (kept with the run, so it shows when you come back). */
export function markLabRowAdded(id: string, added: NonNullable<RunRow["added"]>): void {
  set({ rows: state.rows.map((r) => (r.id === id ? { ...r, added } : r)) });
  if (state.historyId) {
    markScanDetailAdded(state.historyId, id, added).catch((e) => logger.warn("Failed to note Catch Up add in history:", e));
  }
}

export function stopLabRun(): void {
  if (!state.running) return;
  stopRequested = true;
  set({ stopped: true });
}

/** Counts for a finished or running set of rows. */
export function summariseLabRun(rows: RunRow[]): { done: number; transactions: number; notTransactions: number; ignored: number; rejected: number; errors: number } {
  let transactions = 0;
  let notTransactions = 0;
  let ignored = 0;
  let rejected = 0;
  let errors = 0;
  for (const r of rows) {
    if (r.error) errors++;
    else if (r.outcome?.kind === "transaction") transactions++;
    else if (r.outcome?.kind === "not_transaction") notTransactions++;
    else if (r.outcome?.kind === "ignored") ignored++;
    else if (r.outcome?.kind === "rejected") rejected++;
  }
  return { done: transactions + notTransactions + ignored + rejected + errors, transactions, notTransactions, ignored, rejected, errors };
}

/** Tests only. */
export function __resetLabRun(): void {
  stopRequested = false;
  state = EMPTY;
  listeners.clear();
  finishListeners.clear();
}
