import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 098 - ai_jobs: work waiting for on-device AI that isn't a message, and its answers
 * (docs/ON_DEVICE_AI_PHASE2_PROPOSAL.md §0.1).
 *
 *   kind    - category (a merchant's category), merchant_merge (are two names one place?),
 *             context (what a payment was), template (an AI-read format ready to graduate),
 *             month_note (Insights' month in words)
 *   ref_id  - what it's about: an expense id, a merchant pair, a format key, a month
 *   status  - queued / retry / done (an answer to show) / rejected (no usable answer) / error /
 *             accepted / dismissed (the person's answer: kept, so it's never asked again)
 *   result  - the checked answer as JSON
 *
 * One row per (user, kind, ref). Backed up: the person's answers ("not the same place") must
 * survive a restore.
 */
export const migration: Migration = {
  version: 98,
  name: "ai_jobs",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS ai_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        ref_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        result TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        done_at TEXT
      );
    `);
    await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_jobs_ref ON ai_jobs(user_id, kind, ref_id);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_jobs(user_id, status, kind);`);
  },
};

export default migration;
