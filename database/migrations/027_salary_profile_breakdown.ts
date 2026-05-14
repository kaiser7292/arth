import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 027: Salary profile — gratuity-in-CTC toggle + manual rupee breakdown.
 *
 * Real-world CTC structures vary:
 *   - Some employers include gratuity inside the quoted CTC; others treat it as
 *     an extra employer cost on top of the quoted figure.
 *   - Some employers publish explicit rupee amounts per component (Basic, HRA,
 *     Special, Employer EPF, Gratuity) — percentages don't always fit cleanly.
 *
 * This migration adds:
 *   - gratuity_in_ctc: INTEGER — 1/0 flag, default 1 (current behaviour).
 *   - ctc_mode: TEXT — 'percentage' (default) | 'manual'. When 'manual', the
 *     manual_* columns override basic_pct / hra_pct.
 *   - manual_basic / manual_hra / manual_special / manual_employer_epf /
 *     manual_gratuity: REAL — rupee amounts used when ctc_mode='manual'.
 *
 * All additive. Existing rows get defaults; nothing breaks.
 * Idempotent via PRAGMA table_info guards.
 */
export default {
  version: 27,
  name: "salary_profile_breakdown",
  up: async (db: SQLiteDatabase) => {
    const cols = (await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(salary_profiles);",
    )) as Array<{ name: string }>;
    const has = (name: string) => cols.some((c) => c.name === name);

    if (!has("gratuity_in_ctc")) {
      await db.execAsync(
        "ALTER TABLE salary_profiles ADD COLUMN gratuity_in_ctc INTEGER DEFAULT 1;",
      );
    }
    if (!has("ctc_mode")) {
      await db.execAsync(
        "ALTER TABLE salary_profiles ADD COLUMN ctc_mode TEXT DEFAULT 'percentage';",
      );
    }
    if (!has("manual_basic")) {
      await db.execAsync(
        "ALTER TABLE salary_profiles ADD COLUMN manual_basic REAL DEFAULT 0;",
      );
    }
    if (!has("manual_hra")) {
      await db.execAsync(
        "ALTER TABLE salary_profiles ADD COLUMN manual_hra REAL DEFAULT 0;",
      );
    }
    if (!has("manual_special")) {
      await db.execAsync(
        "ALTER TABLE salary_profiles ADD COLUMN manual_special REAL DEFAULT 0;",
      );
    }
    if (!has("manual_employer_epf")) {
      await db.execAsync(
        "ALTER TABLE salary_profiles ADD COLUMN manual_employer_epf REAL DEFAULT 0;",
      );
    }
    if (!has("manual_gratuity")) {
      await db.execAsync(
        "ALTER TABLE salary_profiles ADD COLUMN manual_gratuity REAL DEFAULT 0;",
      );
    }
  },
};
