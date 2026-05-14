import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 032 (v17.4.0): expense → loan payment linking.
 *
 * One row per expense marked as an EMI or prepayment. Mirrors the shape of
 * expense_investment_links (migration 028) so the budget/insights exclusion
 * plumbing can reuse the same pattern.
 *
 *   link_kind = 'emi'         → schedule_entry_id points at loan_schedule_entries.id
 *                               (installment gets marked 'paid')
 *   link_kind = 'prepayment'  → prepayment_id points at loan_prepayments.id
 *
 * Uniqueness: one expense → one loan link (UNIQUE on expense_id).
 *
 * Idempotent via IF NOT EXISTS guards.
 */
export default {
  version: 32,
  name: "expense_loan_links",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS expense_loan_links (
        id TEXT PRIMARY KEY,
        expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
        loan_account_id TEXT NOT NULL REFERENCES loan_accounts(id) ON DELETE CASCADE,
        link_kind TEXT NOT NULL CHECK(link_kind IN ('emi','prepayment')),
        schedule_entry_id TEXT REFERENCES loan_schedule_entries(id) ON DELETE SET NULL,
        prepayment_id TEXT REFERENCES loan_prepayments(id) ON DELETE SET NULL,
        amount REAL NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_exp_loan_link_exp ON expense_loan_links(expense_id);
      CREATE INDEX IF NOT EXISTS idx_exp_loan_link_loan ON expense_loan_links(loan_account_id);
      CREATE INDEX IF NOT EXISTS idx_exp_loan_link_schedule ON expense_loan_links(schedule_entry_id);
      CREATE INDEX IF NOT EXISTS idx_exp_loan_link_prepay ON expense_loan_links(prepayment_id);
    `);
  },
};
