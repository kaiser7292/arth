import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 033 (v17.5.1): manual loan corrections.
 *
 * Users can override Artha's computed outstanding / EMI / tenure at a given
 * date — for example when the bank's actual EMI differs slightly from the
 * formula-derived one (slab resets, rounding, rate changes mid-cycle). Each
 * correction is a timestamped baseline override; the schedule is regenerated
 * from the correction forward.
 *
 * Preserving installments paid on or before the correction is handled in
 * application code (see rebuildLoanScheduleWithCorrections).
 *
 * Idempotent via IF NOT EXISTS.
 */
export default {
  version: 33,
  name: "loan_corrections",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS loan_corrections (
        id TEXT PRIMARY KEY,
        loan_account_id TEXT NOT NULL REFERENCES loan_accounts(id) ON DELETE CASCADE,
        effective_date TEXT NOT NULL,
        outstanding_principal REAL NOT NULL,
        emi_amount REAL NOT NULL,
        tenure_remaining_months INTEGER,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_loan_corrections_loan ON loan_corrections(loan_account_id, effective_date);
    `);
  },
};
