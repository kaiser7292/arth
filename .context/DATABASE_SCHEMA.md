# Database Schema

## Overview

- **Engine:** SQLite via expo-sqlite
- **Migrations:** 40 files (001–043, with 041 removed), run sequentially on first app start + subsequent updates
- **Foreign keys:** Enforced (`PRAGMA foreign_keys = ON`)
- **Soft deletes:** `deleted_at` column on expenses (recycle bin pattern)
- **Timestamps:** ISO 8601 strings (`datetime('now')`)

## Tables (grouped by domain)

### Core Financial
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | Single user record | id, name, email, phone, settings |
| `expenses` | All transactions (expenses + credits + forecasts) | id, user_id, amount, date, category_id, payment_mode_id, account_id, nature, status, source, merchant_name, deleted_at |
| `categories` | Expense categories | id, name, icon, color, is_unavoidable |
| `payment_modes` | Payment methods | id, name, type, is_active |
| `tags` | User-defined tags | id, name |
| `expense_tags` | M:N junction | expense_id, tag_id |
| `budgets` | Monthly category budgets | id, category_id, month, amount |
| `budget_breakdowns` | Per-budget line items | id, budget_id, line_item, amount |

### Accounts & Reconciliation
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `financial_accounts` | Bank/CC/wallet/demat/loan accounts | id, account_type, bank_name, account_label, account_identifier, is_active |
| `account_balance_sms` | SMS-reported balances | id, account_id, balance, date, raw_sms |
| `account_transfers` | Inter-account transfers | id, from_account_id, to_account_id, amount, date, demat_target, investment_bucket_id |
| `demat_fund_snapshots` | Demat idle cash snapshots | id, account_id, value, snapshot_date |
| `demat_portfolio_snapshots` | Demat portfolio value snapshots | id, account_id, value, snapshot_date |

### Hisaab (Family Ledger)
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `hisaab_persons` | People in hisaab | id, name, phone, initial_balance |
| `hisaab_entries` | Ledger entries per person | id, person_id, type (debit/credit/settlement), amount, date, linked_expense_id, settlement_source |

### Goals & Investments
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `yearly_plans` | Annual financial plan | id, financial_year, annual_salary_in_hand |
| `investment_buckets` | Named investment buckets within a plan | id, plan_id, name, target_amount, current_contributed |
| `investment_contributions` | Individual contributions to buckets | id, bucket_id, amount, date |
| `life_milestones` | Long-term financial goals | id, name, target_amount, target_date, current_saved |

### Loans
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `loan_accounts` | Loan records | id, financial_account_id, principal, interest_rate, tenure_months, emi_amount, round_mode |
| `loan_schedule` | Amortization schedule entries | id, loan_account_id, installment_num, emi_amount, principal_component, interest_component, status |
| `loan_prepayments` | Prepayment records | id, loan_account_id, amount, prepayment_date, kind, strategy |
| `loan_corrections` | Manual override corrections | id, loan_account_id, effective_date, outstanding_principal, emi_amount |
| `expense_loan_links` | Links expenses to loan installments | expense_id, loan_account_id, installment_num |

### Automation
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `recurring_expense_rules` | Reminder rules | id, source_expense_id, frequency, next_due_date, is_active |
| `reminder_fulfillments` | Fulfillment history | id, rule_id, expense_id, cycle_date |
| `smart_rules` | Auto-categorization rules | id, name, conditions (JSON), actions (JSON), priority |
| `merchant_aliases` | Merchant name normalization | id, raw_name, canonical_name |

### SMS & Detection
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `pending_sms` | Unprocessed SMS messages | id, address, body, date_received |
| `sms_template_patterns` | SMS parsing templates (system + user) | id, bank_name, pattern, source, sender_pattern, sender_match_mode |
| `sms_sender_registry` | Sender code → bank mapping | sender_code, bank_name |

### Simulator
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `simulation_scenarios` | Named what-if scenarios | id, name, horizon_date, is_default, archived_at |
| `simulation_entries` | Planned entries in scenarios | id, scenario_id, amount, direction, date, status, hisaab_person_id |
| `simulation_hisaab_inclusions` | Hisaab balance inclusions per scenario | scenario_id, person_id, amount, amount_sign |

### Public Data (Bundled)
| Table | Purpose |
|-------|---------|
| `ifsc_bank_registry` | IFSC code → bank name lookup |
| `mcc_codes` | Merchant Category Codes |
| `merchant_brand_registry` | Known merchant brands |
| `data_bundle_versions` | Version tracking for seeded bundles |

### Other
| Table | Purpose |
|-------|---------|
| `salary_profiles` | Salary CTC breakdown |
| `expense_edit_history` | Edit audit trail |

## Migration History (key milestones)

| # | Name | What It Does |
|---|------|-------------|
| 001 | consolidated_schema | Initial schema (all core tables) |
| 010 | purchase_group | Split-tender purchases |
| 013 | recurring_expense_rules | Recurring reminders |
| 015 | public_data_tables | IFSC/MCC/merchant brand bundles |
| 017 | smart_rules | Auto-categorization engine |
| 018 | user_sms_templates | User-authored SMS parsers |
| 021 | sms_template_sender_pattern | Sender-based template routing |
| 025 | simulation_tables | Cash-flow simulator |
| 029 | loan_management | Full loan/amortization schema |
| 033 | loan_corrections | Manual loan overrides |
| 034 | loan_round_mode | INR rupee-level rounding |
| 040 | expense_edit_history | Edit audit trail |
| 042 | simulator_transfers | Simulator account transfer support |
| 043 | settings_table | Centralized user settings |

## Backup & Restore

- All tables listed in `BACKUP_TABLES` array in `services/backup.ts` are exported
- Tables must also be in `TABLE_SCHEMAS` (column whitelist) for restore to accept them
- Export format: AES-256-GCM encrypted JSON (`.accmgr` extension)
- Restore validates columns against whitelist — unknown columns are silently dropped
- Order matters: parent tables before children (FK dependency)
