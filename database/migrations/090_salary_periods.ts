import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 090 — which month a salary belongs to.
 *
 * salary_profiles.salary_month_offset: where a salary credit counts relative to the month it arrived.
 * 0 same month, 1 next month, -1 previous month.
 * expenses.salary_for_month: 'YYYY-MM' on one credit that doesn't follow that setting. NULL follows it.
 *
 * Idempotent: PRAGMA table_info guards.
 */
export const migration: Migration = {
  version: 90,
  name: "salary_periods",
  up: async (db: SQLiteDatabase) => {
    const profile = await db.getAllAsync<{ name: string }>("PRAGMA table_info(salary_profiles);");
    if (!profile.some((c) => c.name === "salary_month_offset")) {
      await db.execAsync("ALTER TABLE salary_profiles ADD COLUMN salary_month_offset INTEGER NOT NULL DEFAULT 0;");
    }
    const expenses = await db.getAllAsync<{ name: string }>("PRAGMA table_info(expenses);");
    if (!expenses.some((c) => c.name === "salary_for_month")) {
      await db.execAsync("ALTER TABLE expenses ADD COLUMN salary_for_month TEXT;");
    }
  },
};

export default migration;
