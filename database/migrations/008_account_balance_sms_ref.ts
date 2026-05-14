import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 008: Track which SMS supplied the current auto-detected balance.
 *
 * Enables:
 *  - Transparency: UI can surface "this balance came from this SMS on this date"
 *  - Self-correction: parser can scan pending_sms for a newer balance-bearing SMS
 *    and apply it silently
 *  - Staleness detection: compare last_balance_date against payment activity
 *
 * The column is a loose reference to pending_sms(id) — not a hard FK because
 * pending_sms rows can be purged independently; readers must handle NULL/missing.
 */
export default {
  version: 8,
  name: "account_balance_sms_ref",
  up: async (db: SQLiteDatabase) => {
    // Idempotent — see 002 comment for rationale.
    const cols = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(financial_accounts);",
    );
    if (cols.some((c) => c.name === "last_balance_sms_id")) return;
    await db.execAsync(
      `ALTER TABLE financial_accounts ADD COLUMN last_balance_sms_id TEXT;`,
    );
  },
};
