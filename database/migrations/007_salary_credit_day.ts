import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 007: Add salary_credit_day to salary_profiles.
 *
 * Purpose: let the cockpit's "on-track" math respect when the user actually
 * receives income. Without this, users paid late in the month (e.g. 25th) see
 * "behind on investments" warnings on day 2 of the month even though they
 * haven't received this month's salary yet.
 *
 * Default 25 matches typical Indian salary-credit timing.
 */
export default {
  version: 7,
  name: "salary_credit_day",
  up: async (db: SQLiteDatabase) => {
    // Idempotent — see 002 comment for rationale.
    const cols = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(salary_profiles);",
    );
    if (cols.some((c) => c.name === "salary_credit_day")) return;
    await db.execAsync(
      `ALTER TABLE salary_profiles ADD COLUMN salary_credit_day INTEGER NOT NULL DEFAULT 25;`,
    );
  },
};
