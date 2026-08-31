/**
 * Complete table schemas — the single source of truth for what columns
 * currently exist on each table after all migrations have run.
 *
 * Used by `backup.ts` to validate restore payloads (only allowlisted
 * columns are written back). Keep in sync with `database/migrations/`.
 */

export const TABLE_SCHEMAS: Record<string, readonly string[]> = {
  users: [
    "id",
    "name",
    "email",
    "phone",
    "created_at",
    "settings",
  ] as const,

  categories: [
    "id",
    "user_id",
    "name",
    "icon",
    "color",
    "sort_order",
    "is_active",
    "is_unavoidable",
  ] as const,

  payment_modes: [
    "id",
    "user_id",
    "name",
    "type",
    "is_active",
  ] as const,

  expenses: [
    "id",
    "user_id",
    "amount",
    "currency",
    "fx_rate",
    "description",
    "category_id",
    "payment_mode_id",
    "date",
    "is_right_spend",
    "source",
    "status",
    "raw_source_text",
    "created_at",
    "updated_at",
    "nature", // 006
    "due_date",
    "account_id",
    "refund_of_expense_id",
    "merchant_name",
    "raw_merchant_name", // migration 002
    "split_original_amount",
    "split_person_id",
    "split_pct",
    "split_hisaab_entry_id",
    "split_mode", // migration 024
    "split_exact_amount", // migration 024
    "matched_forecast_id",
    "transaction_time",
    "deleted_at",
    "forecast_type",
    "paid_from_account_id",
    "convenience_fee",
    "fee_absorbed",
    "purchase_group_id", // migration 010
    "recurring_rule_id", // migration 013 (legacy, cleared by 014; kept for backup compat)
    "fulfills_rule_id", // migration 014
    "applied_rule_id", // migration 017 — smart-rule that auto-categorized this expense
    "reclassified_as_transfer", // migration 046
    "linked_transfer_id", // migration 046
    "source_sms_address", // migration 048
    "applied_rule_ids", // migration 061 — JSON array of all rule IDs that fired
    "applied_rule_manually", // migration 066 — 1 when rule was applied via ⚡ button (not auto-fired)
  ] as const,

  budgets: [
    "id",
    "user_id",
    "category_id",
    "month",
    "amount",
    "notes",
  ] as const,

  budget_breakdowns: [
    "id",
    "budget_id",
    "line_item",
    "formula",
    "amount",
  ] as const,

  yearly_plans: [
    "id",
    "user_id",
    "financial_year",
    "annual_salary_in_hand",
    "expected_bonus",
    "salary_hike_pct",
    "total_planned_expenses",
    "total_planned_investments",
    "total_planned_milestones",
    "savings_rate_target_pct",
    "notes",
    "created_at",
    "updated_at",
  ] as const,

  investment_buckets: [
    "id",
    "yearly_plan_id", // nullable after 027
    "name",
    "annual_target",
    "current_contributed",
    "sort_order",
    "is_active",
    "linked_milestone_id", // 007
    "financial_year",
    "user_id",
    "bucket_type", // v17.3.0 ('investment' | 'debt_payoff')
    "linked_loan_account_id", // v17.3.0
  ] as const,

  investment_contributions: [
    "id",
    "investment_bucket_id",
    "month",
    "amount",
    "notes",
    "date",
    "source",
    "status",
    "raw_source_text",
  ] as const,

  life_milestones: [
    "id",
    "user_id",
    "name",
    "target_amount",
    "current_saved",
    "target_date",
    "monthly_contribution_planned",
    "is_completed",
    "completed_date",
    "sort_order",
    "start_financial_year",
    "duration_years",
    "duration_months",
  ] as const,

  milestone_contributions: [
    "id",
    "life_milestone_id",
    "month",
    "amount",
    "date",
  ] as const,

  unavoidable_baselines: [
    "id",
    "user_id",
    "category_id",
    "monthly_amount",
    "is_unavoidable",
    "notes",
  ] as const,

  financial_accounts: [
    "id",
    "user_id",
    "account_identifier",
    "bank_name",
    "account_type",
    "account_label",
    "credit_limit",
    "last_known_balance",
    "last_balance_date",
    "total_due",
    "min_due",
    "due_date",
    "is_active",
    "discovered_from_sms",
    "created_at",
    "updated_at",
    "has_nach_mandate", // 012
    "nach_merchant", // 012
    "nach_amount", // 012
    "fund_balance", // 011 (demat idle cash)
    "account_number", // 011 (demat DP ID)
    "last_balance_sms_id", // 008
    "min_balance", // 019 (savings min-balance alert threshold)
    "closed_at", // 064 (account closure — IS NOT NULL means closed, still active for history)
    "closed_note", // 064 (optional closure note)
  ] as const,

  salary_profiles: [
    "id",
    "yearly_plan_id", // nullable after 018
    "input_mode",
    "annual_ctc",
    "basic_pct",
    "hra_pct",
    "is_metro",
    "epf_mode",
    "epf_in_ctc",
    "vpf_monthly",
    "tax_regime",
    "professional_tax_annual",
    "state",
    "deductions_80c",
    "deductions_80d",
    "hra_exemption_annual",
    "home_loan_interest",
    "other_deductions",
    "computed_monthly_in_hand",
    "computed_annual_tax",
    "created_at",
    "updated_at",
    "financial_year",
    "user_id",
    "expected_capital_gains",
    "expected_bonus",
    "status",
    "capital_gains_equity_ltcg",
    "capital_gains_equity_stcg",
    "capital_gains_debt",
    "capital_gains_fd",
    "capital_gains_gold",
    "capital_gains_real_estate",
    "manual_monthly_in_hand", // 001 consolidated
    "monthly_overrides", // 003
    "salary_credit_day", // 007
    "gratuity_in_ctc", // 027
    "ctc_mode", // 027
    "manual_basic", // 027
    "manual_hra", // 027
    "manual_special", // 027
    "manual_employer_epf", // 027
    "manual_gratuity", // 027
  ] as const,

  pending_sms: [
    "id",
    "user_id",
    "sms_id",
    "address",
    "body",
    "sms_date",
    "status",
    "error_message",
    "expense_id",
    "created_at",
    "processed_at",
  ] as const,

  merchant_mappings: [
    "id",
    "keyword",
    "category_name",
    "confidence",
    "is_active",
    "created_at",
  ] as const,

  merchant_corrections: [
    "id",
    "user_id",
    "merchant_keyword",
    "category_id",
    "correction_count",
    "created_at",
    "updated_at",
    "last_corrected_at", // 010
  ] as const,

  recurring_transactions: [
    "id",
    "user_id",
    "merchant_normalized",
    "amount",
    "frequency",
    "category_id",
    "account_id",
    "last_seen_date",
    "next_expected_date",
    "occurrence_count",
    "is_active",
    "is_confirmed",
    "created_at",
    "updated_at",
  ] as const,

  hisaab_persons: [
    "id",
    "owner_user_id",
    "name",
    "phone",
    "email",
    "initial_balance",
    "notes",
    "is_active",
    "created_at",
    "updated_at",
  ] as const,

  hisaab_entries: [
    "id",
    "hisaab_person_id",
    "amount",
    "description",
    "date",
    "type",
    "status",
    "linked_expense_id",
    "category_id",
    "merchant_name",
    "linked_account_credit_id",
    "settlement_source",
    "created_at",
    "updated_at",
  ] as const,


  merchant_aliases: [
    "id",
    "user_id",
    "sms_name",
    "canonical_name",
    "category_id",
    "created_at",
  ] as const,

  tags: [
    "id",
    "user_id",
    "name",
    "color",
    "created_at",
  ] as const,

  expense_tags: [
    "expense_id",
    "tag_id",
  ] as const,

  account_payment_modes: [
    "id",
    "account_id",
    "payment_mode_id",
    "first_seen_date",
    "created_at",
  ] as const,

  account_month_balances: [
    "id",
    "account_id",
    "month",
    "opening_balance",
    "is_manual_override",
    "created_at",
    "updated_at",
  ] as const,

  account_credits: [
    "id",
    "account_id",
    "user_id",
    "amount",
    "description",
    "date",
    "source",
    "created_at",
    "updated_at",
    "deleted_at",
  ] as const,

  account_transfers: [
    "id",
    "user_id",
    "from_account_id",
    "to_account_id",
    "amount",
    "description",
    "date",
    "linked_forecast_id",
    "linked_expense_id",
    "source",
    "created_at",
    "updated_at",
    "deleted_at",
    "demat_target", // 011
    "investment_bucket_id", // 011
    "linked_contribution_id", // 011
    "raw_source_text", // 023
    "source_sms_address", // 023
  ] as const,

  expense_splits: [
    "id",
    "expense_id",
    "hisaab_person_id",
    "description",
    "amount",
    "hisaab_entry_id",
    "created_at",
  ] as const,

  demat_portfolio_snapshots: [
    "id",
    "account_id",
    "snapshot_date",
    "portfolio_value",
    "created_at",
    "updated_at",
  ] as const,

  demat_fund_snapshots: [
    "id",
    "account_id",
    "snapshot_date",
    "fund_value",
    "created_at",
    "updated_at",
  ] as const,

  expense_classifications: [
    "id",
    "user_id",
    "merchant_normalized",
    "category_id",
    "amount_range_low",
    "amount_range_high",
    "classification",
    "frequency",
    "expected_day_of_month",
    "confidence",
    "source",
    "occurrence_count",
    "last_seen_date",
    "last_confirmed_date",
    "is_active",
    "deactivated_reason",
    "created_at",
    "updated_at",
  ] as const,

  recurring_expense_rules: [
    "id",
    "user_id",
    "source_expense_id",
    "frequency",
    "start_date",
    "end_date",
    "last_materialized_date", // legacy, write-never from 014
    "is_active",
    "notes",
    "created_at",
    "updated_at",
    "next_due_date", // 014
    "amount", // 056
    "repeat_ordinal", // 065
    "repeat_weekday", // 065
  ] as const,

  reminder_fulfillments: [
    "id",
    "rule_id",
    "expense_id",
    "cycle_due_date",
    "fulfilled_at",
  ] as const,

  smart_rules: [
    "id",
    "user_id",
    "name",
    "priority",
    "is_active",
    // Legacy fixed-column model — unused since migration 053, kept in the
    // table (and this whitelist) so a backup taken before the upgrade can
    // still restore cleanly.
    "match_merchant_contains",
    "match_merchant_regex",
    "match_min_amount",
    "match_max_amount",
    "match_account_id",
    "match_payment_mode",
    "match_sms_keyword",
    "action_category_id",
    "action_payment_mode",
    "action_tag_ids",
    "action_is_right_spend",
    "action_mark_auto",
    // migration 053: dynamic conditions/actions model
    "match_mode",
    "conditions",
    "actions",
    "deleted_at",
    "action_link_to_investment_bucket_id", // v17.2.0
    "apply_count",
    "last_applied_at",
    "pending_retroactive",
    "applies_to", // 067
    "created_at",
    "updated_at",
  ] as const,

  // v15.11.2: add the 6 remaining v15-Phase-1 + sender-registry tables to
  // the restore whitelist. These are in BACKUP_TABLES but were missing
  // here → restore was silently dropping them. Of the 6:
  //   - sms_sender_registry + reminder_suggestions carry USER data
  //     (user-authored sender→bank mappings, harvested reminder hints)
  //     and must survive restore.
  //   - ifsc_bank_registry, mcc_codes, merchant_brand_registry,
  //     data_bundle_versions are bundled reference data that gets
  //     re-seeded on boot. Restoring them is harmless (seed overwrites
  //     on-conflict) and avoids a brief window where they're absent
  //     between restore and first bundle-load.
  ifsc_bank_registry: [
    "ifsc_prefix",
    "bank_name",
    "bank_short_code",
    "source_version",
  ] as const,

  sms_sender_registry: [
    "sender_code",
    "bank_name",
    "bank_type",
    "confidence",
    "source_version",
  ] as const,

  mcc_codes: [
    "code",
    "description",
    "category_name",
    "source_version",
  ] as const,

  merchant_brand_registry: [
    "id",
    "brand_canonical",
    "alias",
    "category_name",
    "mcc_code",
    "source_version",
  ] as const,

  data_bundle_versions: [
    "bundle_name",
    "seeded_version",
    "seeded_at",
  ] as const,

  reminder_suggestions: [
    "id",
    "matched_pattern_id",
    "sms_body",
    "extracted_fields_json",
    "seen_at",
    "resolved",
  ] as const,

  // sms_template_patterns — v15 Phase 1 (migration 015), extended in
  // v15.5.0 user templates (migration 018) and v15.11.0 sender-based
  // routing (migration 021). Added to TABLE_SCHEMAS in v15.11.0 so the
  // restore path stops silently dropping user templates — pre-v15.11.0
  // backups included this table but restores skipped it because the
  // schema whitelist was missing.
  sms_template_patterns: [
    "id",
    "bank_name",
    "template_id",
    "pattern_regex",
    "tx_type",
    "priority",
    // source_version is NOT NULL in the schema (migration 015) — must be in the
    // whitelist or restore silently drops every row with a NOT NULL violation.
    "source_version",
    "example_match",
    "created_at",
    "updated_at",
    // v15.5.0 (migration 018)
    "source",
    "user_id",
    "sample_sms",
    "created_from_sms_id",
    // v15.11.0 (migration 021)
    "sender_match_mode",
    "sender_pattern",
    // migration 052
    "deleted_at",
    // migration 055
    "default_payment_mode_id",
  ] as const,

  // v16.0.0 — cash-flow simulator (migration 025)
  simulation_scenarios: [
    "id",
    "user_id",
    "name",
    "horizon_date",
    "is_default",
    "created_at",
    "updated_at",
    "archived_at",
  ] as const,

  simulation_entries: [
    "id",
    "scenario_id",
    "direction",
    "amount",
    "date",
    "originally_planned_for",
    "account_id",
    "category_id",
    "merchant_name",
    "description",
    "source",
    "seed_source_id",
    "fulfilled_expense_id",
    "status",
    "created_at",
    "updated_at",
    // v16.0.5 — hisaab integration (migration 026)
    "hisaab_person_id",
    "hisaab_kind",
    // v16.0.9 — simulator transfer accounts (migration 042)
    "from_account_id",
    "to_account_id",
  ] as const,

  // v16.0.5 — per-scenario hisaab inclusions (migration 026)
  simulation_hisaab_inclusions: [
    "scenario_id",
    "person_id",
    "included",
    "amount",
    "amount_sign",
    "created_at",
    "updated_at",
  ] as const,

  simulation_entry_fulfillments: [
    "id",
    "entry_id",
    "expense_id",
    "created_at",
  ] as const,

  // v17.0.0 — expense → investment bucket link (migration 028)
  expense_investment_links: [
    "id",
    "expense_id",
    "investment_bucket_id",
    "contribution_amount",
    "notes",
    "created_at",
    "updated_at",
  ] as const,

  // v17.0.0 — loan_accounts (migration 029)
  loan_accounts: [
    "id",
    "financial_account_id",
    "agreement_id",
    "loan_type",
    "currency",
    "principal_sanctioned",
    "principal_disbursed",
    "disbursement_date",
    "emi_start_date",
    "emi_day_of_month",
    "interest_rate_pa",
    "interest_type",
    "interest_method",
    "tenure_months",
    "emi_amount",
    "repayment_mode",
    "processing_fee",
    "stamp_duty",
    "insurance_premium",
    "prepayment_charge_pct_early",
    "prepayment_charge_pct_late",
    "prepayment_charge_threshold_emis",
    "foreclosure_waiver_months",
    "foreclosure_waiver_min_amount",
    "penal_rate_pa",
    "penal_rate_cap_pa",
    "gst_pct",
    "fx_rate",
    "fx_rate_date",
    "status",
    "closed_date",
    "notes",
    "round_mode",
    "schedule_source",
    "last_sms_reminder_at",
    "last_sms_reminder_due_date",
    "last_sms_reminder_amount",
    "created_at",
    "updated_at",
  ] as const,

  // v17.0.0 — loan_schedule_entries (migration 029)
  loan_schedule_entries: [
    "id",
    "loan_account_id",
    "installment_num",
    "due_date",
    "opening_principal",
    "emi_amount",
    "principal_component",
    "interest_component",
    "closing_principal",
    "status",
    "linked_expense_id",
    "paid_date",
    "paid_amount",
  ] as const,

  // v17.0.0 — loan_prepayments (migration 029)
  loan_prepayments: [
    "id",
    "loan_account_id",
    "prepayment_date",
    "amount",
    "prepayment_charge",
    "gst_on_charge",
    "kind",
    "strategy",
    "linked_expense_id",
    "notes",
    "created_at",
  ] as const,

  // v17.4.0 — expense → loan payment link (EMI or prepayment). Migration 032.
  expense_loan_links: [
    "id",
    "expense_id",
    "loan_account_id",
    "link_kind",
    "schedule_entry_id",
    "prepayment_id",
    "amount",
    "notes",
    "created_at",
    "updated_at",
  ] as const,

  // v17.5.1 — manual loan corrections (migration 033). User-entered overrides
  // for outstanding principal / EMI / remaining tenure at a point in time.
  loan_corrections: [
    "id",
    "loan_account_id",
    "effective_date",
    "outstanding_principal",
    "emi_amount",
    "tenure_remaining_months",
    "interest_rate_pa", // migration 050 — optional rate change
    "reason",
    "created_at",
    "updated_at",
    "deleted_at",
  ] as const,
  expense_edit_history: [
    "id",
    "expense_id",
    "field_name",
    "old_value",
    "new_value",
    "edited_at",
    "undone",
  ] as const,

  sms_scan_runs: [
    "id",
    "user_id",
    "is_manual",
    "start_date",
    "end_date",
    "account_ids",
    "sms_read_count",
    "hardcoded_match_count",
    "template_match_count",
    "filtered_count",
    "unrecognized_count",
    "skipped_count",
    "expense_created_count",
    "credit_created_count",
    "duration_ms",
    "error",
    "created_at",
  ] as const,

  sms_scan_details: [
    "id",
    "scan_run_id",
    "pending_sms_id",
    "sms_address",
    "sms_body_preview",
    "sms_date",
    "category",
    "matched_template_id",
    "filter_reason",
    "parsed_amount",
    "parsed_merchant",
    "parsed_type",
    "applied_rule_ids", // migration 061
    "created_at",
  ] as const,

  vault_entries: [
    "id",
    "title",
    "category",
    "login_method",
    "username",
    "email",
    "phone",
    "password_enc",
    "pin_enc",
    "url",
    "notes",
    "custom_fields",
    "renewal_date",
    "linked_account_id",
    "created_at",
    "updated_at",
    "deleted_at",
  ] as const,

  // v18.x — bank statement reconciliation (migrations 058, 059)
  reconciliation_sessions: [
    "id",
    "account_id",
    "stmt_start_date",
    "stmt_end_date",
    "stmt_closing_bal",
    "arth_closing_bal",
    "total_stmt_count",
    "matched_count",
    "status",
    "import_format",
    "import_filename",
    "pre_arth_cutoff",
    "created_at",
    "completed_at",
    "deleted_at",
  ] as const,

  reconciliation_items: [
    "id",
    "session_id",
    "stmt_date",
    "stmt_amount",
    "stmt_direction",
    "stmt_narration",
    "matched_expense_id",
    "matched_transfer_id",
    "match_confidence",
    "status",
    "exclude_reason",
    "sort_order",
    "created_at",
    "deleted_at",
  ] as const,
  // v19.x — insurance / risk coverage (migration 063)
  insurance_policies: [
    "id",
    "user_id",
    "policy_type",
    "provider_name",
    "policy_number",
    "sum_insured",
    "annual_premium",
    "premium_frequency",
    "start_date",
    "expiry_date",
    "is_active",
    "notes",
    "covers_family",
    "family_members_covered",
    "created_at",
    "updated_at",
    "deleted_at",
  ] as const,
} as const;

// Type helper to get column names for a specific table
export type TableName = keyof typeof TABLE_SCHEMAS;
export type ColumnsOf<T extends TableName> = (typeof TABLE_SCHEMAS)[T][number];
