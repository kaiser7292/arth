import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 035 (v17.5.2): loan + reminder hot-path indexes.
 *
 * - `loan_prepayments(loan_account_id, prepayment_date)` — matches the
 *   `ORDER BY prepayment_date` in getPrepayments + rebuildLoanSchedule replay.
 * - `expenses(fulfills_rule_id) WHERE deleted_at IS NULL` — partial index for
 *   the v14.7.0 reminder-fulfillment suggestion banner's hot predicate.
 *
 * Idempotent via IF NOT EXISTS.
 */
export default {
  version: 35,
  name: "loan_perf_indexes",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_loan_prepay_loan_date
        ON loan_prepayments(loan_account_id, prepayment_date);
      CREATE INDEX IF NOT EXISTS idx_expenses_fulfills_rule_live
        ON expenses(fulfills_rule_id) WHERE deleted_at IS NULL AND fulfills_rule_id IS NOT NULL;
    `);
  },
};
