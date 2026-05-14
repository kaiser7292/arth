import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 029 (v17.0.0): proper loan management.
 *
 * Three tables extending the existing `financial_accounts` (account_type='loan'):
 *   - loan_accounts — 1:1 sibling carrying amortization params
 *   - loan_schedule_entries — generated EMI schedule (cached, regenerable)
 *   - loan_prepayments — part-payments + foreclosure events (v17.1.0 uses writes;
 *     v17.0.0 only creates the table)
 *
 * All 7 loan types: personal / home / auto / education / business / gold /
 * against_fd / other. Multi-currency via `currency` (default INR). Non-INR
 * Balance Sheet rendering in v17.0.0 shows native currency with a warning pill;
 * full FX conversion lands in v17.3.0.
 *
 * No data migration for existing `account_type='loan'` rows — they continue to
 * work with `last_known_balance` as a scalar until the user opens the Add Loan
 * wizard to fill in the key-fact-sheet fields.
 */
export default {
  version: 29,
  name: "loan_management",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS loan_accounts (
        id TEXT PRIMARY KEY,
        financial_account_id TEXT NOT NULL UNIQUE REFERENCES financial_accounts(id) ON DELETE CASCADE,
        agreement_id TEXT,
        loan_type TEXT NOT NULL CHECK(loan_type IN ('personal','home','auto','education','business','gold','against_fd','other')),
        currency TEXT NOT NULL DEFAULT 'INR',
        principal_sanctioned REAL NOT NULL,
        principal_disbursed REAL NOT NULL,
        disbursement_date TEXT NOT NULL,
        emi_start_date TEXT NOT NULL,
        emi_day_of_month INTEGER NOT NULL CHECK(emi_day_of_month BETWEEN 1 AND 31),
        interest_rate_pa REAL NOT NULL,
        interest_type TEXT NOT NULL CHECK(interest_type IN ('fixed','floating')),
        interest_method TEXT NOT NULL DEFAULT 'reducing' CHECK(interest_method IN ('reducing','flat','simple')),
        tenure_months INTEGER NOT NULL,
        emi_amount REAL NOT NULL,
        repayment_mode TEXT,
        processing_fee REAL DEFAULT 0,
        stamp_duty REAL DEFAULT 0,
        insurance_premium REAL DEFAULT 0,
        prepayment_charge_pct_early REAL DEFAULT 0,
        prepayment_charge_pct_late REAL DEFAULT 0,
        prepayment_charge_threshold_emis INTEGER,
        foreclosure_waiver_months INTEGER,
        foreclosure_waiver_min_amount REAL,
        penal_rate_pa REAL DEFAULT 0,
        penal_rate_cap_pa REAL DEFAULT 0,
        gst_pct REAL DEFAULT 18,
        fx_rate REAL,
        fx_rate_date TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed','foreclosed','written_off')),
        closed_date TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_loan_accounts_status ON loan_accounts(status);
      CREATE INDEX IF NOT EXISTS idx_loan_accounts_fa ON loan_accounts(financial_account_id);

      CREATE TABLE IF NOT EXISTS loan_schedule_entries (
        id TEXT PRIMARY KEY,
        loan_account_id TEXT NOT NULL REFERENCES loan_accounts(id) ON DELETE CASCADE,
        installment_num INTEGER NOT NULL,
        due_date TEXT NOT NULL,
        opening_principal REAL NOT NULL,
        emi_amount REAL NOT NULL,
        principal_component REAL NOT NULL,
        interest_component REAL NOT NULL,
        closing_principal REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','paid','overdue','prepaid','skipped')),
        linked_expense_id TEXT REFERENCES expenses(id) ON DELETE SET NULL,
        paid_date TEXT,
        paid_amount REAL,
        UNIQUE(loan_account_id, installment_num)
      );
      CREATE INDEX IF NOT EXISTS idx_loan_sched_due ON loan_schedule_entries(loan_account_id, due_date);
      CREATE INDEX IF NOT EXISTS idx_loan_sched_status ON loan_schedule_entries(loan_account_id, status);

      CREATE TABLE IF NOT EXISTS loan_prepayments (
        id TEXT PRIMARY KEY,
        loan_account_id TEXT NOT NULL REFERENCES loan_accounts(id) ON DELETE CASCADE,
        prepayment_date TEXT NOT NULL,
        amount REAL NOT NULL,
        prepayment_charge REAL DEFAULT 0,
        gst_on_charge REAL DEFAULT 0,
        kind TEXT NOT NULL CHECK(kind IN ('part_payment','foreclosure')),
        strategy TEXT CHECK(strategy IN ('reduce_tenure','reduce_emi')),
        linked_expense_id TEXT REFERENCES expenses(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_loan_prepay_loan ON loan_prepayments(loan_account_id);
    `);
  },
};
