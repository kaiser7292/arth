/**
 * The AI lab's batch test, run outside the screen so the user can leave the lab while Gemini
 * Nano works through the messages. One run at a time; the lab screen and the finish toast
 * (components/ai/LabRunToaster.tsx) both read it through subscribeLabRun.
 *
 * Android only runs on-device AI while Arth is on screen. When Arth goes to the background the
 * run pauses on the message it was on and carries on when Arth comes back, instead of marking
 * the rest as errors. Nothing is saved: closing Arth ends the run.
 */

import { AppState } from "react-native";
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
}

const EMPTY: LabRun = { rows: [], running: false, paused: false, stopped: false, label: "" };

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
  set({ rows, running: true, paused: false, stopped: false, label });
  for (const row of rows) {
    if (stopRequested) break;
    const done = await readOne(row, map);
    if (stopRequested) break;
    set({ rows: state.rows.map((r) => (r.id === done.id ? done : r)) });
  }
  const stopped = stopRequested;
  set({ running: false, paused: false, stopped });
  if (!stopped) finishListeners.forEach((l) => l(state));
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
