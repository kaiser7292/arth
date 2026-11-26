/**
 * Answers queued ai_jobs with on-device AI. Runs inside the reading queue's run
 * (reading-queue.ts), after the waiting messages, so it shares its one-at-a-time lane, its pause
 * while Arth is in the background, and its Stop. Each kind has a handler; every answer is checked
 * before it's stored, and stored answers are only suggestions until the person taps.
 */

import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getCategories } from "@/services/category";
import { logger } from "@/utils/logger";
import { isAiJobOn } from "./ai-reading";
import { failAiJob, finishAiJob, queuedAiJobs, type AiJob } from "./jobs";
import { fileMerchantsWithNano, MERCHANTS_PER_PROMPT } from "./tasks/merchant-category";
import { runMergeJobs } from "./tasks/merchant-merge";
import { runContextJobs } from "./tasks/payment-context";

/** Per run, so a long backlog doesn't hold the lane for minutes. */
const CATEGORY_JOBS_PER_RUN = 40;

export interface JobRunHooks {
  /** Stop asked for, or Arth must wait to be in front: the runner checks between questions. */
  shouldStop: () => boolean;
  /** Resolves once Arth is in front again. */
  untilActive: () => Promise<void>;
}

/** Category: the uncategorised spend's merchant, filed into one of your categories. */
async function runCategoryJobs(h: JobRunHooks): Promise<number> {
  if (!isAiJobOn("category")) return 0;
  const jobs = await queuedAiJobs("category", CATEGORY_JOBS_PER_RUN);
  if (jobs.length === 0) return 0;
  const db = getDatabase();
  const cats = (await getCategories(DEFAULT_USER_ID)).filter((c) => !/^uncategori[sz]ed$/i.test(c.name.trim()));
  const byName = new Map(cats.map((c) => [c.name.trim(), c.id]));
  const names = [...byName.keys()];

  // Still uncategorised and still there? Otherwise there's nothing to ask.
  const live: { job: AiJob; merchant: string }[] = [];
  for (const job of jobs) {
    const e = await db.getFirstAsync<{ merchant_name: string | null; category_id: string | null }>(
      `SELECT merchant_name, category_id FROM expenses WHERE id = ? AND deleted_at IS NULL AND status != 'rejected';`,
      job.ref_id,
    );
    const merchant = e?.merchant_name?.trim();
    if (!e || e.category_id || !merchant) await finishAiJob(job.id, null);
    else live.push({ job, merchant });
  }

  // One question per few merchants; the same merchant asked once.
  const merchants = [...new Set(live.map((l) => l.merchant))];
  let answered = 0;
  for (let i = 0; i < merchants.length; i += MERCHANTS_PER_PROMPT) {
    if (h.shouldStop()) break;
    await h.untilActive();
    const batch = merchants.slice(i, i + MERCHANTS_PER_PROMPT);
    const jobsFor = live.filter((l) => batch.includes(l.merchant));
    try {
      const answers = await fileMerchantsWithNano(batch, names);
      for (const l of jobsFor) {
        const name = answers.get(l.merchant);
        await finishAiJob(l.job.id, name ? { categoryId: byName.get(name), categoryName: name } : null);
        if (name) answered++;
      }
    } catch (e) {
      logger.warn("AI jobs: category batch failed", e);
      for (const l of jobsFor) await failAiJob(l.job);
      break;
    }
  }
  return answered;
}

/**
 * Run every kind's waiting jobs. Returns how many suggestions were made. Handlers for further
 * kinds register here as they're built.
 */
export async function runAiJobs(h: JobRunHooks): Promise<number> {
  let made = 0;
  for (const run of HANDLERS) {
    if (h.shouldStop()) break;
    try {
      made += await run(h);
    } catch (e) {
      logger.warn("AI jobs: a handler failed (non-fatal)", e);
    }
  }
  return made;
}

/** Merchant variants: only when that job is on. */
async function runMergeJobsIfOn(h: JobRunHooks): Promise<number> {
  return isAiJobOn("merchant_merge") ? runMergeJobs(h) : 0;
}

/** What a payment was: only when that job is on. */
async function runContextJobsIfOn(h: JobRunHooks): Promise<number> {
  return isAiJobOn("context") ? runContextJobs(h) : 0;
}

const HANDLERS: ((h: JobRunHooks) => Promise<number>)[] = [runCategoryJobs, runMergeJobsIfOn, runContextJobsIfOn];
