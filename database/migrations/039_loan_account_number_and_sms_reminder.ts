import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 039 (v17.6.0): loan account number dedup + SMS reminder columns
 * + manual CSV schedule flag.
 *
 * Four nullable columns added to `loan_accounts`:
 *   - `schedule_source`           — 'generated' (default) | 'manual_csv'.
 *                                   When 'manual_csv', rebuildLoanSchedule is a no-op
 *                                   (user-provided schedule is the source of truth).
 *   - `last_sms_reminder_at`      — ISO date when the last EMI reminder SMS landed.
 *   - `last_sms_reminder_due_date` — ISO date the reminder said the EMI is due.
 *   - `last_sms_reminder_amount`  — amount the reminder mentioned (native currency).
 *
 * These are populated by the EMI reminder SMS handler in sms-to-expense.ts
 * when it can match the reminder's account identifier to a known loan (Change 3).
 * The loan detail screen reads them to surface a "Axis just reminded you…" banner.
 *
 * Additive / idempotent: ALTER TABLE ADD COLUMN guarded by PRAGMA check so this
 * migration can re-run safely (matches pattern used in migrations 011, 024, etc.).
 */
export default {
  version: 39,
  name: "loan_account_number_and_sms_reminder",
  up: async (db: SQLiteDatabase) => {
    const cols = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(loan_accounts);",
    );
    const names = new Set(cols.map((c) => c.name));

    if (!names.has("schedule_source")) {
      await db.execAsync(
        `ALTER TABLE loan_accounts ADD COLUMN schedule_source TEXT NOT NULL DEFAULT 'generated';`,
      );
    }
    if (!names.has("last_sms_reminder_at")) {
      await db.execAsync(
        `ALTER TABLE loan_accounts ADD COLUMN last_sms_reminder_at TEXT;`,
      );
    }
    if (!names.has("last_sms_reminder_due_date")) {
      await db.execAsync(
        `ALTER TABLE loan_accounts ADD COLUMN last_sms_reminder_due_date TEXT;`,
      );
    }
    if (!names.has("last_sms_reminder_amount")) {
      await db.execAsync(
        `ALTER TABLE loan_accounts ADD COLUMN last_sms_reminder_amount REAL;`,
      );
    }
  },
};
