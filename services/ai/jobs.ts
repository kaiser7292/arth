/**
 * ai_jobs (migration 098): questions waiting for on-device AI that aren't messages, and the
 * answers. The runner (job-runner.ts) asks the model while Arth is open; screens read the answers
 * as suggestions; the person's reply (accepted / dismissed) is kept so it's never asked again.
 */

import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { generateUUID } from "@/utils/uuid";

export type AiJobKind = "category" | "merchant_merge" | "context" | "template" | "month_note";
export type AiJobStatus = "queued" | "retry" | "done" | "rejected" | "error" | "accepted" | "dismissed";

export interface AiJob {
  id: string;
  kind: AiJobKind;
  ref_id: string;
  status: AiJobStatus;
  result: string | null;
}

/**
 * Queue a question. Does nothing when one already exists for this ref (answered, dismissed or
 * waiting), so a dismissed suggestion is never asked again. Returns true when it was queued.
 */
export async function queueAiJob(kind: AiJobKind, refId: string, userId: string = DEFAULT_USER_ID): Promise<boolean> {
  const res = await getDatabase().runAsync(
    `INSERT OR IGNORE INTO ai_jobs (id, user_id, kind, ref_id, status) VALUES (?, ?, ?, ?, 'queued');`,
    generateUUID(),
    userId,
    kind,
    refId,
  );
  return res.changes > 0;
}

/** Save a code-made answer straight away (no model needed), unless the person already answered. */
export async function putAiJobResult(kind: AiJobKind, refId: string, result: unknown, userId: string = DEFAULT_USER_ID): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `INSERT OR IGNORE INTO ai_jobs (id, user_id, kind, ref_id, status) VALUES (?, ?, ?, ?, 'queued');`,
    generateUUID(),
    userId,
    kind,
    refId,
  );
  await db.runAsync(
    `UPDATE ai_jobs SET status = 'done', result = ?, done_at = datetime('now')
      WHERE user_id = ? AND kind = ? AND ref_id = ? AND status NOT IN ('accepted', 'dismissed');`,
    JSON.stringify(result),
    userId,
    kind,
    refId,
  );
}

export async function queuedAiJobs(kind: AiJobKind, limit: number, userId: string = DEFAULT_USER_ID): Promise<AiJob[]> {
  return getDatabase().getAllAsync<AiJob>(
    `SELECT id, kind, ref_id, status, result FROM ai_jobs
      WHERE user_id = ? AND kind = ? AND status IN ('queued', 'retry')
      ORDER BY CASE status WHEN 'retry' THEN 1 ELSE 0 END, created_at DESC LIMIT ?;`,
    userId,
    kind,
    limit,
  );
}

export async function countQueuedAiJobs(userId: string = DEFAULT_USER_ID): Promise<number> {
  const row = await getDatabase().getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ai_jobs WHERE user_id = ? AND status IN ('queued', 'retry');`,
    userId,
  );
  return row?.n ?? 0;
}

/** Record the model's checked answer (null = no usable answer). */
export async function finishAiJob(id: string, result: unknown | null): Promise<void> {
  await getDatabase().runAsync(
    `UPDATE ai_jobs SET status = ?, result = ?, done_at = datetime('now') WHERE id = ? AND status IN ('queued', 'retry');`,
    result == null ? "rejected" : "done",
    result == null ? null : JSON.stringify(result),
    id,
  );
}

/** The model didn't answer: one more try in a later run, then given up on. */
export async function failAiJob(job: Pick<AiJob, "id" | "status">): Promise<void> {
  await getDatabase().runAsync(
    `UPDATE ai_jobs SET status = ? WHERE id = ? AND status IN ('queued', 'retry');`,
    job.status === "retry" ? "error" : "retry",
    job.id,
  );
}

/** Answers to show: done jobs of a kind, optionally only for these refs. Parsed. */
export async function aiSuggestions<T>(kind: AiJobKind, refIds?: string[], userId: string = DEFAULT_USER_ID): Promise<Map<string, T>> {
  const db = getDatabase();
  const out = new Map<string, T>();
  if (refIds && refIds.length === 0) return out;
  const rows: { ref_id: string; result: string | null }[] = [];
  if (refIds) {
    // In batches: SQLite caps how many values one statement takes.
    for (let i = 0; i < refIds.length; i += 400) {
      const part = refIds.slice(i, i + 400);
      rows.push(
        ...(await db.getAllAsync<{ ref_id: string; result: string | null }>(
          `SELECT ref_id, result FROM ai_jobs WHERE user_id = ? AND kind = ? AND status = 'done' AND ref_id IN (${part.map(() => "?").join(",")});`,
          userId,
          kind,
          ...part,
        )),
      );
    }
  } else {
    rows.push(
      ...(await db.getAllAsync<{ ref_id: string; result: string | null }>(
        `SELECT ref_id, result FROM ai_jobs WHERE user_id = ? AND kind = ? AND status = 'done' ORDER BY done_at DESC;`,
        userId,
        kind,
      )),
    );
  }
  for (const r of rows) {
    if (!r.result) continue;
    try {
      out.set(r.ref_id, JSON.parse(r.result) as T);
    } catch {
      // A broken row is just not shown.
    }
  }
  return out;
}

/** The person answered a suggestion: kept, so it's not shown or asked again. */
export async function answerAiJob(kind: AiJobKind, refId: string, answer: "accepted" | "dismissed", userId: string = DEFAULT_USER_ID): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `INSERT OR IGNORE INTO ai_jobs (id, user_id, kind, ref_id, status) VALUES (?, ?, ?, ?, ?);`,
    generateUUID(),
    userId,
    kind,
    refId,
    answer,
  );
  await db.runAsync(`UPDATE ai_jobs SET status = ?, done_at = datetime('now') WHERE user_id = ? AND kind = ? AND ref_id = ?;`, answer, userId, kind, refId);
}

/** Ask again (a month note when the month's data changed). Not for answered jobs. */
export async function requeueAiJob(kind: AiJobKind, refId: string, userId: string = DEFAULT_USER_ID): Promise<void> {
  await getDatabase().runAsync(
    `UPDATE ai_jobs SET status = 'queued' WHERE user_id = ? AND kind = ? AND ref_id = ? AND status NOT IN ('accepted', 'dismissed');`,
    userId,
    kind,
    refId,
  );
}
