import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Consolidated schema — fresh install creates all tables in their final state.
 * Replaces migrations 001–045 (which contained incremental ALTER TABLEs and dropped tables).
 */
export default {
  version: 1,
  name: "001_consolidated_schema",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      -- ═══════════════════════════════════════════════════════════════
      -- 1. CORE TABLES
      -- ═══════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        settings TEXT DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT 'dots',
        color TEXT NOT NULL DEFAULT '#6B7280',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_unavoidable INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);

      CREATE TABLE IF NOT EXISTS payment_modes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('credit_card','debit_card','upi','cash','wallet','bank_transfer')),
        is_active INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_payment_modes_user ON payment_modes(user_id);

      -- ═══════════════════════════════════════════════════════════════
      -- 2. FINANCIAL ACCOUNTS
      -- ═══════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS financial_accounts (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id),
        account_identifier TEXT NOT NULL,
        bank_name TEXT NOT NULL,
        account_type TEXT NOT NULL,
        account_label TEXT,
        credit_limit REAL,
        last_known_balance REAL,
        last_balance_date TEXT,
        total_due REAL,
        min_due REAL,
        due_date TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        discovered_from_sms INTEGER NOT NULL DEFAULT 1,
        fund_balance REAL NOT NULL DEFAULT 0,
        account_number TEXT,
        has_nach_mandate INTEGER NOT NULL DEFAULT 0,
        nach_merchant TEXT,
        nach_amount REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_accounts_unique ON financial_accounts(user_id, account_identifier, bank_name, account_type);
      CREATE INDEX IF NOT EXISTS idx_financial_accounts_user ON financial_accounts(user_id, is_active);

      -- ═══════════════════════════════════════════════════════════════
      -- 3. EXPENSES
      -- ═══════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        fx_rate REAL,
        description TEXT,
        category_id TEXT REFERENCES categories(id),
        payment_mode_id TEXT REFERENCES payment_modes(id),
        date TEXT NOT NULL,
        is_right_spend INTEGER,
        source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','sms_auto','email_auto')),
        status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','pending_review','rejected')),
        raw_source_text TEXT,
        nature TEXT NOT NULL DEFAULT 'realized',
        due_date TEXT,
        account_id TEXT REFERENCES financial_accounts(id),
        refund_of_expense_id TEXT REFERENCES expenses(id),
        merchant_name TEXT,
        raw_merchant_name TEXT,
        split_original_amount REAL,
        split_person_id TEXT,
        split_pct REAL,
        split_hisaab_entry_id TEXT,
        matched_forecast_id TEXT REFERENCES expenses(id),
        transaction_time TEXT NOT NULL DEFAULT '00:00:00',
        deleted_at TEXT,
        forecast_type TEXT DEFAULT 'expense',
        paid_from_account_id TEXT,
        convenience_fee REAL NOT NULL DEFAULT 0,
        fee_absorbed INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
      CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id);
      CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
      CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, date);
      CREATE INDEX IF NOT EXISTS idx_expenses_account ON expenses(account_id);
      CREATE INDEX IF NOT EXISTS idx_expenses_refund_link ON expenses(refund_of_expense_id);
      CREATE INDEX IF NOT EXISTS idx_expenses_nature ON expenses(nature);
      CREATE INDEX IF NOT EXISTS idx_expenses_due_date ON expenses(due_date);
      CREATE INDEX IF NOT EXISTS idx_expenses_merchant ON expenses(merchant_name);
      CREATE INDEX IF NOT EXISTS idx_expenses_split_person ON expenses(split_person_id);
      CREATE INDEX IF NOT EXISTS idx_expenses_matched_forecast ON expenses(matched_forecast_id);
      CREATE INDEX IF NOT EXISTS idx_expenses_deleted_at ON expenses(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_expenses_payment_mode ON expenses(payment_mode_id);
      CREATE INDEX IF NOT EXISTS idx_expenses_acct_ledger ON expenses(account_id, deleted_at, nature, status, date);
      CREATE INDEX IF NOT EXISTS idx_expenses_acct_refunds ON expenses(account_id, deleted_at, refund_of_expense_id, date);
      CREATE INDEX IF NOT EXISTS idx_expenses_forecast_type ON expenses(forecast_type);
      CREATE INDEX IF NOT EXISTS idx_expenses_split_entry ON expenses(split_hisaab_entry_id);

      -- ═══════════════════════════════════════════════════════════════
      -- 4. BUDGETS
      -- ═══════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS budgets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        category_id TEXT NOT NULL REFERENCES categories(id),
        month TEXT NOT NULL,
        amount REAL NOT NULL,
        notes TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_unique ON budgets(user_id, category_id, month);
      CREATE INDEX IF NOT EXISTS idx_budgets_category ON budgets(category_id);

      CREATE TABLE IF NOT EXISTS budget_breakdowns (
        id TEXT PRIMARY KEY,
        budget_id TEXT NOT NULL REFERENCES budgets(id),
        line_item TEXT NOT NULL,
        formula TEXT,
        amount REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_budget_breakdowns_budget ON budget_breakdowns(budget_id);


      -- ═══════════════════════════════════════════════════════════════
      -- 6. YEARLY PLANS & INVESTMENTS
      -- ═══════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS yearly_plans (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        financial_year TEXT NOT NULL,
        annual_salary_in_hand REAL NOT NULL,
        expected_bonus REAL DEFAULT 0,
        salary_hike_pct REAL DEFAULT 0,
        total_planned_expenses REAL NOT NULL,
        total_planned_investments REAL NOT NULL,
        total_planned_milestones REAL DEFAULT 0,
        savings_rate_target_pct REAL NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_yearly_plans_unique ON yearly_plans(user_id, financial_year);
      CREATE INDEX IF NOT EXISTS idx_yearly_plans_user ON yearly_plans(user_id);

      CREATE TABLE IF NOT EXISTS life_milestones (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        target_amount REAL NOT NULL,
        current_saved REAL NOT NULL DEFAULT 0,
        target_date TEXT,
        monthly_contribution_planned REAL DEFAULT 0,
        is_completed INTEGER NOT NULL DEFAULT 0,
        completed_date TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        start_financial_year TEXT,
        duration_years INTEGER DEFAULT 1,
        duration_months INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_life_milestones_fy ON life_milestones(start_financial_year);
      CREATE INDEX IF NOT EXISTS idx_life_milestones_user ON life_milestones(user_id);

      CREATE TABLE IF NOT EXISTS milestone_contributions (
        id TEXT PRIMARY KEY,
        life_milestone_id TEXT NOT NULL REFERENCES life_milestones(id),
        month TEXT NOT NULL,
        amount REAL NOT NULL,
        date TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_milestone_contributions_milestone ON milestone_contributions(life_milestone_id);

      CREATE TABLE IF NOT EXISTS investment_buckets (
        id TEXT PRIMARY KEY,
        yearly_plan_id TEXT REFERENCES yearly_plans(id),
        name TEXT NOT NULL,
        annual_target REAL NOT NULL,
        current_contributed REAL NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        linked_milestone_id TEXT REFERENCES life_milestones(id),
        financial_year TEXT,
        user_id TEXT REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_investment_buckets_fy ON investment_buckets(user_id, financial_year);
      CREATE INDEX IF NOT EXISTS idx_investment_buckets_yearly_plan ON investment_buckets(yearly_plan_id);
      CREATE INDEX IF NOT EXISTS idx_investment_buckets_milestone ON investment_buckets(linked_milestone_id);

      CREATE TABLE IF NOT EXISTS investment_contributions (
        id TEXT PRIMARY KEY,
        investment_bucket_id TEXT NOT NULL REFERENCES investment_buckets(id),
        month TEXT NOT NULL,
        amount REAL NOT NULL,
        notes TEXT,
        date TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','email_auto')),
        status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','pending_review','rejected')),
        raw_source_text TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_inv_contrib_bucket ON investment_contributions(investment_bucket_id);

      CREATE TABLE IF NOT EXISTS unavoidable_baselines (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        category_id TEXT NOT NULL REFERENCES categories(id),
        monthly_amount REAL NOT NULL,
        is_unavoidable INTEGER NOT NULL DEFAULT 1,
        notes TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unavoidable_baselines_unique ON unavoidable_baselines(user_id, category_id);
      CREATE INDEX IF NOT EXISTS idx_unavoidable_baselines_user ON unavoidable_baselines(user_id);
      CREATE INDEX IF NOT EXISTS idx_unavoidable_baselines_category ON unavoidable_baselines(category_id);

      -- ═══════════════════════════════════════════════════════════════
      -- 7. SMS & AUTO-DETECTION
      -- ═══════════════════════════════════════════════════════════════

      -- sms_rules table intentionally omitted: was created in earlier
      -- versions of this consolidated schema and immediately dropped by
      -- migration 006. Fresh installs skip it entirely; older installs
      -- already ran the drop.

      CREATE TABLE IF NOT EXISTS pending_sms (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        sms_id TEXT NOT NULL,
        address TEXT NOT NULL,
        body TEXT NOT NULL,
        sms_date INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processed','ignored','failed')),
        error_message TEXT,
        expense_id TEXT REFERENCES expenses(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        processed_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_sms_sms_id ON pending_sms(sms_id);
      CREATE INDEX IF NOT EXISTS idx_pending_sms_status ON pending_sms(status);
      CREATE INDEX IF NOT EXISTS idx_pending_sms_user ON pending_sms(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_pending_sms_expense ON pending_sms(expense_id);

      -- ═══════════════════════════════════════════════════════════════
      -- 8. SALARY PROFILES
      -- ═══════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS salary_profiles (
        id TEXT PRIMARY KEY,
        yearly_plan_id TEXT REFERENCES yearly_plans(id),
        input_mode TEXT NOT NULL DEFAULT 'direct' CHECK(input_mode IN ('ctc','direct')),
        annual_ctc REAL,
        basic_pct REAL NOT NULL DEFAULT 40,
        hra_pct REAL NOT NULL DEFAULT 50,
        is_metro INTEGER NOT NULL DEFAULT 1,
        epf_mode TEXT NOT NULL DEFAULT 'restricted' CHECK(epf_mode IN ('full_basic','restricted')),
        epf_in_ctc INTEGER NOT NULL DEFAULT 1,
        vpf_monthly REAL NOT NULL DEFAULT 0,
        tax_regime TEXT NOT NULL DEFAULT 'new' CHECK(tax_regime IN ('new','old')),
        professional_tax_annual REAL NOT NULL DEFAULT 2400,
        state TEXT,
        deductions_80c REAL NOT NULL DEFAULT 0,
        deductions_80d REAL NOT NULL DEFAULT 0,
        hra_exemption_annual REAL NOT NULL DEFAULT 0,
        home_loan_interest REAL NOT NULL DEFAULT 0,
        other_deductions REAL NOT NULL DEFAULT 0,
        computed_monthly_in_hand REAL NOT NULL DEFAULT 0,
        computed_annual_tax REAL NOT NULL DEFAULT 0,
        financial_year TEXT,
        user_id TEXT REFERENCES users(id),
        expected_capital_gains REAL NOT NULL DEFAULT 0,
        expected_bonus REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'complete' CHECK(status IN ('draft','complete')),
        capital_gains_equity_ltcg REAL NOT NULL DEFAULT 0,
        capital_gains_equity_stcg REAL NOT NULL DEFAULT 0,
        capital_gains_debt REAL NOT NULL DEFAULT 0,
        capital_gains_fd REAL NOT NULL DEFAULT 0,
        capital_gains_gold REAL NOT NULL DEFAULT 0,
        capital_gains_real_estate REAL NOT NULL DEFAULT 0,
        manual_monthly_in_hand REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_salary_profiles_fy ON salary_profiles(user_id, financial_year);
      CREATE INDEX IF NOT EXISTS idx_salary_profiles_user ON salary_profiles(user_id);

      -- ═══════════════════════════════════════════════════════════════
      -- 9. MERCHANTS
      -- ═══════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS merchant_mappings (
        id TEXT PRIMARY KEY,
        keyword TEXT NOT NULL UNIQUE,
        category_name TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.9,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_merchant_mappings_keyword ON merchant_mappings(keyword);

      CREATE TABLE IF NOT EXISTS merchant_corrections (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        merchant_keyword TEXT NOT NULL,
        category_id TEXT NOT NULL REFERENCES categories(id),
        correction_count INTEGER NOT NULL DEFAULT 1,
        last_corrected_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, merchant_keyword)
      );
      CREATE INDEX IF NOT EXISTS idx_merchant_corrections_lookup ON merchant_corrections(user_id, merchant_keyword);
      CREATE INDEX IF NOT EXISTS idx_merchant_corrections_category ON merchant_corrections(category_id);

      CREATE TABLE IF NOT EXISTS merchant_aliases (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        sms_name TEXT NOT NULL,
        canonical_name TEXT NOT NULL,
        category_id TEXT REFERENCES categories(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_aliases_unique ON merchant_aliases(user_id, sms_name);
      CREATE INDEX IF NOT EXISTS idx_merchant_aliases_user ON merchant_aliases(user_id);
      CREATE INDEX IF NOT EXISTS idx_merchant_aliases_category ON merchant_aliases(category_id);

      -- ═══════════════════════════════════════════════════════════════
      -- 10. RECURRING TRANSACTIONS
      -- ═══════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS recurring_transactions (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id),
        merchant_normalized TEXT NOT NULL,
        amount REAL NOT NULL,
        frequency TEXT NOT NULL CHECK(frequency IN ('weekly','monthly','quarterly','yearly')),
        category_id TEXT REFERENCES categories(id),
        account_id TEXT REFERENCES financial_accounts(id),
        last_seen_date TEXT NOT NULL,
        next_expected_date TEXT,
        occurrence_count INTEGER NOT NULL DEFAULT 2,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_confirmed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_recurring_user ON recurring_transactions(user_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_recurring_merchant ON recurring_transactions(user_id, merchant_normalized);
      CREATE INDEX IF NOT EXISTS idx_recurring_txns_category ON recurring_transactions(category_id);
      CREATE INDEX IF NOT EXISTS idx_recurring_txns_account ON recurring_transactions(account_id);

      -- ═══════════════════════════════════════════════════════════════
      -- 11. HISAAB (FAMILY LEDGER)
      -- ═══════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS hisaab_persons (
        id TEXT PRIMARY KEY NOT NULL,
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        initial_balance REAL NOT NULL DEFAULT 0,
        notes TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_hisaab_persons_user ON hisaab_persons(owner_user_id, is_active);

      CREATE TABLE IF NOT EXISTS hisaab_entries (
        id TEXT PRIMARY KEY NOT NULL,
        hisaab_person_id TEXT NOT NULL REFERENCES hisaab_persons(id),
        amount REAL NOT NULL,
        description TEXT,
        date TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('debit','credit','settlement')),
        status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','pending','disputed')),
        linked_expense_id TEXT REFERENCES expenses(id),
        category_id TEXT REFERENCES categories(id),
        merchant_name TEXT,
        linked_account_credit_id TEXT REFERENCES account_credits(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_hisaab_entries_person ON hisaab_entries(hisaab_person_id);
      CREATE INDEX IF NOT EXISTS idx_hisaab_entries_date ON hisaab_entries(date);
      CREATE INDEX IF NOT EXISTS idx_hisaab_entries_expense ON hisaab_entries(linked_expense_id);
      CREATE INDEX IF NOT EXISTS idx_hisaab_entries_credit ON hisaab_entries(linked_account_credit_id);
      CREATE INDEX IF NOT EXISTS idx_hisaab_entries_category ON hisaab_entries(category_id);

      -- ═══════════════════════════════════════════════════════════════
      -- 12. EXPENSE SPLITS (Multi-person split system)
      -- ═══════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS expense_splits (
        id TEXT PRIMARY KEY,
        expense_id TEXT NOT NULL REFERENCES expenses(id),
        hisaab_person_id TEXT NOT NULL REFERENCES hisaab_persons(id),
        description TEXT,
        amount REAL NOT NULL,
        hisaab_entry_id TEXT REFERENCES hisaab_entries(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_expense_splits_expense_id ON expense_splits(expense_id);
      CREATE INDEX IF NOT EXISTS idx_expense_splits_person_id ON expense_splits(hisaab_person_id);

      -- ═══════════════════════════════════════════════════════════════
      -- 13. TAGS
      -- ═══════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#6B7280',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_unique ON tags(user_id, name);
      CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);

      CREATE TABLE IF NOT EXISTS expense_tags (
        expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (expense_id, tag_id)
      );
      CREATE INDEX IF NOT EXISTS idx_expense_tags_tag ON expense_tags(tag_id);

      -- ═══════════════════════════════════════════════════════════════
      -- 14. ACCOUNT EXTENSIONS
      -- ═══════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS account_payment_modes (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES financial_accounts(id),
        payment_mode_id TEXT NOT NULL REFERENCES payment_modes(id),
        first_seen_date TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_apm_unique ON account_payment_modes(account_id, payment_mode_id);
      CREATE INDEX IF NOT EXISTS idx_apm_account ON account_payment_modes(account_id);
      CREATE INDEX IF NOT EXISTS idx_account_payment_modes_pm ON account_payment_modes(payment_mode_id);

      CREATE TABLE IF NOT EXISTS account_month_balances (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES financial_accounts(id),
        month TEXT NOT NULL,
        opening_balance REAL NOT NULL,
        is_manual_override INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(account_id, month)
      );
      CREATE INDEX IF NOT EXISTS idx_amb_account_month ON account_month_balances(account_id, month);

      CREATE TABLE IF NOT EXISTS account_credits (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES financial_accounts(id),
        user_id TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        date TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ac_account_date ON account_credits(account_id, date);
      CREATE INDEX IF NOT EXISTS idx_ac_account_deleted_date ON account_credits(account_id, deleted_at, date);
      CREATE INDEX IF NOT EXISTS idx_account_credits_account ON account_credits(account_id);
      CREATE INDEX IF NOT EXISTS idx_account_credits_user ON account_credits(user_id);

      CREATE TABLE IF NOT EXISTS account_transfers (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        from_account_id TEXT NOT NULL REFERENCES financial_accounts(id),
        to_account_id TEXT NOT NULL REFERENCES financial_accounts(id),
        amount REAL NOT NULL,
        description TEXT,
        date TEXT NOT NULL,
        linked_forecast_id TEXT REFERENCES expenses(id),
        linked_expense_id TEXT REFERENCES expenses(id),
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_transfers_from_account_date ON account_transfers(from_account_id, date);
      CREATE INDEX IF NOT EXISTS idx_transfers_to_account_date ON account_transfers(to_account_id, date);
      CREATE INDEX IF NOT EXISTS idx_transfers_user_date ON account_transfers(user_id, date);
      CREATE INDEX IF NOT EXISTS idx_account_transfers_forecast ON account_transfers(linked_forecast_id);
      CREATE INDEX IF NOT EXISTS idx_account_transfers_expense ON account_transfers(linked_expense_id);
      CREATE INDEX IF NOT EXISTS idx_account_transfers_user ON account_transfers(user_id);

      CREATE TABLE IF NOT EXISTS demat_portfolio_snapshots (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES financial_accounts(id),
        snapshot_date TEXT NOT NULL,
        portfolio_value REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(account_id, snapshot_date)
      );
      CREATE INDEX IF NOT EXISTS idx_dps_account_date ON demat_portfolio_snapshots(account_id, snapshot_date);
    `);
  },
};
