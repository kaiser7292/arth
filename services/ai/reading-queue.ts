/**
 * The "needs AI" queue (docs/GEMINI_NANO_PROPOSAL.md §5.3, Phase 1): messages no pattern or
 * template could read are saved with pending_sms.ai_status = 'queued' by the scan
 * (sms-parser.ts). This works through them with Gemini Nano while Arth is open, because Android
 * only runs the model for the app on screen.
 *
 * Each reading is checked against the message (tasks/read-sms.ts) and then goes through exactly
 * the path a bank pattern's reading takes (add-ai-read.ts → processParseResults): ignored
 * accounts, start date, duplicates, account linking, Smart Rules, own transfers. Everything it
 * adds is pending_review, so it waits in Catch Up marked "Read by AI" until the person approves.
 *
 * One run at a time. A second caller gets the run already going (B6: the in-flight promise is
 * cleared with .finally on the returned promise). Screens follow it with subscribeAiQueue.
 * Going to the background pauses on the message it was on; coming back carries on.
 *
 * Every finished run is saved to Scan history as an "ai" run, next to the SMS scans.
 */

import { AppState } from "react-native";
import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { bumpDataVersion, getOnboardingCompletedVersion } from "@/services/settings";
import { saveScanRun, type ScanDetail } from "@/services/sms/sms-scan-logging";
import { markSmsIgnored } from "@/services/sms/sms-parser";
import { formatLocalDate } from "@/utils/fiscal-year";
import { logger } from "@/utils/logger";
import { isAiReadingOn } from "./ai-reading";
import { runAiJobs } from "./job-runner";
import { addAiReadToCatchUp } from "./add-ai-read";
import { readRowToDetail, type RunRow } from "./ai-read-row";
import { loadMoneyMap, type MoneyMap } from "./money-map";
import { getNanoStatus, NanoUnavailableError, type NanoStatus } from "./nano";
import { readSmsWithNano, type AiReadSms, type ReadSmsOutcome } from "./tasks/read-sms";

/**
 * "retry": failed once (no answer, timeout); read again after the fresh ones, and marked "error"
 * if it fails again. So a message that always fails can't hold up the rest of the queue.
 */
export type AiQueueStatus = "added" | "not_txn" | "ignored" | "rejected" | "duplicate" | "retry" | "error";

export interface QueuedMessage {
  id: string;
  ai_status: "queued" | "retry";
  address: string;
  body: string;
  sms_date: number;
}

export interface AiQueueState {
  running: boolean;
  /** Waiting for Arth to be on screen again. */
  paused: boolean;
  /** How many this run set out to read. */
  total: number;
  done: number;
  /** Added to Catch Up. */
  added: number;
  notMoney: number;
  /** Read, but the checks didn't trust it, or Arth already had it: left for the person. */
  leftOut: number;
  errors: number;
  moneyIn: number;
  moneyOut: number;
  /** The transaction just added, for a live list. */
  latest?: { id: number; merchant: string | null; amount: number; credit: boolean };
  /** Why the last run ended without reading (no model on this phone, still downloading...). */
  unavailable?: NanoStatus;
  /** The run ended because the model kept failing. */
  gaveUp?: boolean;
  /** Past the messages, answering the other questions (categories, names, ...). */
  tidying?: boolean;
  /** Suggestions the other questions produced this run. */
  suggested?: number;
}

export interface AiQueueRunOptions {
  /** Read at most this many (newest first). */
  limit?: number;
  /** Shown in Scan history, e.g. "During setup · 40 messages". */
  label?: string;
  /** false: messages only (onboarding reads messages, not the other questions). Default true. */
  jobs?: boolean;
}

const EMPTY: AiQueueState = { running: false, paused: false, total: 0, done: 0, added: 0, notMoney: 0, leftOut: 0, errors: 0, moneyIn: 0, moneyOut: 0 };

/** After this many failures in a row the model is likely not working: stop, keep the rest queued. */
const GIVE_UP_AFTER = 3;
/** Background top-up runs (after a scan, on app open) read this many at most. */
export const BACKGROUND_LIMIT = 40;

const WHERE_QUEUED = `user_id = ? AND ai_status IN ('queued', 'retry') AND expense_id IS NULL AND status = 'failed'`;

let state: AiQueueState = EMPTY;
let inFlight: Promise<AiQueueState> | null = null;
let stopRequested = false;
let latestId = 0;
const listeners = new Set<() => void>();

function set(next: Partial<AiQueueState>): void {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function getAiQueueState(): AiQueueState {
  return state;
}

/** For useSyncExternalStore. */
export function subscribeAiQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function countQueued(userId: string = DEFAULT_USER_ID): Promise<number> {
  const row = await getDatabase().getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM pending_sms WHERE ${WHERE_QUEUED};`, userId);
  return row?.n ?? 0;
}

/**
 * Messages that were Unrecognised before the AI was on (or before this version), since `sinceMs`:
 * queue them so the AI reads them too. Returns how many were queued.
 */
export async function queueOlderUnread(sinceMs: number, userId: string = DEFAULT_USER_ID): Promise<number> {
  const res = await getDatabase().runAsync(
    `UPDATE pending_sms SET ai_status = 'queued'
      WHERE user_id = ? AND ai_status IS NULL AND status = 'failed' AND expense_id IS NULL
        AND error_message = 'unrecognised' AND sms_date >= ?;`,
    userId,
    sinceMs,
  );
  return res.changes;
}

/** Unread, older messages the AI hasn't been given yet (for "Read older messages too"). */
export async function countOlderUnread(sinceMs: number, userId: string = DEFAULT_USER_ID): Promise<number> {
  const row = await getDatabase().getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM pending_sms
      WHERE user_id = ? AND ai_status IS NULL AND status = 'failed' AND expense_id IS NULL
        AND error_message = 'unrecognised' AND sms_date >= ?;`,
    userId,
    sinceMs,
  );
  return row?.n ?? 0;
}

async function setStatus(id: string, status: AiQueueStatus | "queued"): Promise<void> {
  await getDatabase().runAsync(`UPDATE pending_sms SET ai_status = ? WHERE id = ?;`, status, id);
}

/** What the AI filled in, for the "Read by AI" mark. Pure; exported for tests. */
export function aiFieldsOf(r: AiReadSms): string[] {
  const out = ["amount"];
  if (r.merchant) out.push("merchant");
  if (r.last4 || r.from?.account || r.to?.account) out.push("account");
  if (r.balance != null) out.push("balance");
  if (r.event) out.push("event");
  if (r.channel) out.push("channel");
  if (r.auto) out.push("autopay");
  if (r.ref) out.push("ref");
  if (r.time) out.push("time");
  return out;
}

/** Resolves once Arth is on screen (or a stop is asked for). */
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

type Read = { outcome: ReadSmsOutcome; raw: string; ms: number } | { error: string };

async function readOne(msg: QueuedMessage, map: MoneyMap): Promise<Read | null> {
  for (;;) {
    await untilActive();
    if (stopRequested) return null;
    try {
      return await readSmsWithNano(msg.body, msg.address, map);
    } catch (e) {
      // Arth went to the background mid-call: wait, then ask again.
      if (e instanceof NanoUnavailableError && AppState.currentState !== "active") continue;
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
}

async function loadQueued(limit: number): Promise<QueuedMessage[]> {
  return getDatabase().getAllAsync<QueuedMessage>(
    // Fresh ones first, newest first; second tries after them.
    `SELECT id, ai_status, address, body, sms_date FROM pending_sms WHERE ${WHERE_QUEUED}
      ORDER BY CASE ai_status WHEN 'retry' THEN 1 ELSE 0 END, sms_date DESC LIMIT ?;`,
    DEFAULT_USER_ID,
    limit,
  );
}

async function work(opts: AiQueueRunOptions): Promise<AiQueueState> {
  const startedAt = Date.now();
  stopRequested = false;
  set({ ...EMPTY, running: true });

  const status = await getNanoStatus();
  if (status !== "available") {
    set({ running: false, unavailable: status });
    return state;
  }
  // Messages first; with none waiting, the run still answers the other questions (ai_jobs).
  const queued = await loadQueued(opts.limit ?? 500);
  set({ total: queued.length });

  let map = await loadMoneyMap();
  const rows: RunRow[] = [];
  /** Failures in a row, not written yet. */
  let failing: QueuedMessage[] = [];
  /** A failed message gets one more try in a later run; the second failure is final. */
  const recordFailures = async () => {
    for (const f of failing) await setStatus(f.id, f.ai_status === "retry" ? "error" : "retry");
    failing = [];
  };
  let oldestAdded = Number.POSITIVE_INFINITY;

  for (const msg of queued) {
    if (stopRequested) break;
    const r = await readOne(msg, map);
    if (r == null) break;
    const row: RunRow = { id: msg.id, sender: msg.address, body: msg.body, date: msg.sms_date };

    if ("error" in r) {
      failing.push(msg);
      rows.push({ ...row, error: r.error });
      set({ done: state.done + 1, errors: state.errors + 1 });
      if (failing.length >= GIVE_UP_AFTER) {
        await recordFailures();
        set({ gaveUp: true });
        break;
      }
      continue;
    }
    // A reading came back: earlier failures were about those messages, not the model.
    await recordFailures();

    const o = r.outcome;
    let added: RunRow["added"];
    // A template may have read it while the model was thinking: then it's done already.
    const still = await getDatabase().getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM pending_sms WHERE id = ? AND status = 'failed' AND expense_id IS NULL;`,
      msg.id,
    );
    if (!still?.n) {
      rows.push({ ...row, outcome: o, raw: r.raw, ms: r.ms, added: { expenseId: null, note: "Read by a template meanwhile" } });
      set({ done: state.done + 1, leftOut: state.leftOut + 1 });
      continue;
    }
    if (o.kind === "transaction") {
      try {
        const res = await addAiReadToCatchUp(msg.id, o.result, msg.body, msg.address, msg.sms_date);
        const db = getDatabase();
        // The transaction the message became (an expense or credit; null for a transfer or a
        // duplicate Arth already had).
        const link = await db.getFirstAsync<{ expense_id: string | null }>(`SELECT expense_id FROM pending_sms WHERE id = ?;`, msg.id);
        const expenseId = link?.expense_id ?? res.expenseId;
        if (expenseId) {
          await db.runAsync(
            `UPDATE expenses SET parse_source = 'ai', ai_fields = ? WHERE id = ? AND source = 'sms_auto' AND parse_source IS NULL;`,
            JSON.stringify(aiFieldsOf(o.result)),
            expenseId,
          );
        }
        await setStatus(msg.id, expenseId ? "added" : "duplicate");
        added = { expenseId, note: res.error ?? (expenseId ? null : "Arth already had it, or it's on an account you ignored") };
        if (expenseId) {
          const credit = o.result.type === "credit";
          oldestAdded = Math.min(oldestAdded, msg.sms_date);
          set({
            added: state.added + 1,
            moneyIn: state.moneyIn + (credit ? o.result.amount : 0),
            moneyOut: state.moneyOut + (credit ? 0 : o.result.amount),
            latest: { id: ++latestId, merchant: o.result.merchant, amount: o.result.amount, credit },
          });
          // New accounts can come from what was just added.
          map = await loadMoneyMap();
          // No change marked mid-run: every mark reloads open screens and clears remembered reports.
          // The run marks one change at the end (below); its own screen follows the queue state.
        } else {
          set({ leftOut: state.leftOut + 1 });
        }
      } catch (e) {
        logger.warn("AI queue: adding a reading failed", e);
        await setStatus(msg.id, "error");
        added = { expenseId: null, note: e instanceof Error ? e.message : String(e) };
        set({ errors: state.errors + 1 });
      }
    } else {
      await setStatus(msg.id, o.kind === "not_transaction" ? "not_txn" : o.kind);
      // An account the person ignored: its messages are skipped, as the scan skips them, so it
      // leaves the "couldn't read" list too.
      if (o.kind === "ignored") await markSmsIgnored(msg.id).catch(() => {});
      if (o.kind === "not_transaction") set({ notMoney: state.notMoney + 1 });
      else set({ leftOut: state.leftOut + 1 });
    }
    rows.push({ ...row, outcome: o, raw: r.raw, ms: r.ms, added });
    set({ done: state.done + 1 });
  }

  // Failures at the very end of the queue (no later answer to compare with): one more try next time.
  if (!state.gaveUp && !stopRequested) await recordFailures();

  // Then the other questions waiting for the AI (categories, merchant names, ...), unless the
  // model stopped answering.
  if (opts.jobs !== false && !state.gaveUp && !stopRequested) {
    set({ tidying: true });
    const suggested = await runAiJobs({ shouldStop: () => stopRequested, untilActive }).catch((e) => {
      logger.warn("AI jobs failed (non-fatal)", e);
      return 0;
    });
    set({ tidying: false, suggested });
  }

  // Own transfers read by the AI pair up with their other half, as after an SMS scan.
  if (Number.isFinite(oldestAdded)) {
    try {
      const { settleTransfersAfterScan } = await import("@/services/transfer-detect");
      await settleTransfersAfterScan(DEFAULT_USER_ID, formatLocalDate(new Date(oldestAdded - 4 * 86400000)));
    } catch (e) {
      logger.warn("AI queue: settling transfers failed (non-fatal)", e);
    }
  }

  const details = rows.map(readRowToDetail).filter((d): d is ScanDetail => d != null);
  if (details.length > 0) {
    await saveScanRun({
      userId: DEFAULT_USER_ID,
      source: "ai",
      label: opts.label ?? `Messages Arth couldn't read · ${details.length}`,
      isManual: false,
      smsReadCount: details.length,
      hardcodedMatchCount: 0,
      templateMatchCount: 0,
      filteredCount: 0,
      unrecognizedCount: 0,
      skippedCount: 0,
      expenseCreatedCount: rows.filter((x) => x.added?.expenseId && x.outcome?.kind === "transaction" && x.outcome.result.type === "debit").length,
      creditCreatedCount: rows.filter((x) => x.added?.expenseId && x.outcome?.kind === "transaction" && x.outcome.result.type === "credit").length,
      durationMs: Date.now() - startedAt,
      error: state.gaveUp ? "On-device AI stopped answering; the rest wait for next time" : stopRequested ? "Stopped before the end" : null,
      details,
    }).catch((e) => logger.warn("AI queue: saving to Scan history failed (non-fatal)", e));
  }
  set({ running: false, paused: false, tidying: false });
  // Screens reload only when something changed: most runs on app open find nothing to do.
  if (state.added > 0 || state.done > 0 || (state.suggested ?? 0) > 0) bumpDataVersion();
  return state;
}

/** Read the queue now. Joins the run already going, if there is one. */
export function runAiQueue(opts: AiQueueRunOptions = {}): Promise<AiQueueState> {
  if (inFlight) return inFlight;
  if (!isAiReadingOn()) return Promise.resolve(state);
  const p = work(opts).catch((e) => {
    logger.warn("AI queue run failed:", e);
    set({ running: false, paused: false });
    return state;
  });
  inFlight = p;
  void p.finally(() => {
    if (inFlight === p) inFlight = null;
  });
  return p;
}

export function stopAiQueue(): void {
  if (!state.running) return;
  stopRequested = true;
}

let scheduled: ReturnType<typeof setTimeout> | null = null;

/**
 * A quiet top-up run a few seconds from now (after a scan, when Arth comes to the front). Not
 * while Arth is in the background, and not during onboarding: setup runs the queue itself, after
 * it has approved the history, so the AI's readings stay for review.
 */
export function scheduleAiQueue(delayMs = 4000): void {
  if (!isAiReadingOn() || scheduled || inFlight) return;
  if (AppState.currentState !== "active" || getOnboardingCompletedVersion() == null) return;
  scheduled = setTimeout(() => {
    scheduled = null;
    if (AppState.currentState !== "active") return;
    void runAiQueue({ limit: BACKGROUND_LIMIT });
  }, delayMs);
}

/** Tests only. */
export function __resetAiQueue(): void {
  state = EMPTY;
  inFlight = null;
  stopRequested = false;
  if (scheduled) clearTimeout(scheduled);
  scheduled = null;
  listeners.clear();
}
