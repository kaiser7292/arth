# Services Map

## Overview

All business logic lives in `services/`. UI components call services; services call the database. No component ever writes SQL directly.

## Core Services

### Expense Management
| File | Purpose |
|------|---------|
| `expense-crud.ts` | Create, update, soft-delete, permanent-delete expenses. Handles all FK cascades on delete. |
| `expense-queries.ts` | Paginated reads, filtered summaries, period comparisons |
| `expense-types.ts` | TypeScript interfaces (Expense, ExpenseFilters, etc.) |
| `expense-splits.ts` | Single-person split logic (create/remove/edit split + hisaab entry) |
| `expense-multi-split.ts` | Multi-person split with per-leg amounts |
| `expense-effective-amount.ts` | Net amount after refunds |
| `expense-bulk.ts` | Bulk operations (approve, reject multiple) |
| `expense-forecasts.ts` | CC repayment forecasts, forecast matching |
| `expense-investment-link.ts` | Link expenses to investment buckets |
| `expense-loan-link.ts` | Link expenses to loan installments |
| `expense-edit-history.ts` | Edit audit trail |
| `expense.ts` | Barrel re-exports |

### Financial Accounts
| File | Purpose |
|------|---------|
| `financial-account.ts` | CRUD for bank/CC/wallet/demat/loan accounts, account linking from SMS |
| `account-balance.ts` | Computed balances, month summaries |
| `account-credit.ts` | Credit entries (refunds, incoming SMS), settlement sync |
| `account-transfer.ts` | Inter-account transfers, mark-as-transfer, CC bill payment |
| `account-master.ts` | Account list/management |
| `balance-source.ts` | SMS-reported vs calculated balance tracking, staleness detection |
| `balance-sheet.ts` | Net worth computation (assets − liabilities) |

### Loans
| File | Purpose |
|------|---------|
| `loan-accounts.ts` | Loan CRUD, schedule generation, prepayments, corrections, batch helpers |
| `loan-engine.ts` | Pure math: amortization, prepayment strategies, INR rounding |
| `loan-sms-matcher.ts` | Match SMS-detected expenses to loan installments |
| `loan-emi-reminder.ts` | EMI reminder notifications |
| `loan-schedule-import.ts` | Import amortization from external sources |
| `loan-account-merge.ts` | Merge duplicate loan records |

### Budget & Planning
| File | Purpose |
|------|---------|
| `budget.ts` | Monthly budget CRUD, rolling surplus calculation |
| `yearly-plan.ts` | Annual plan, investment buckets, contributions, debt servicing |
| `savings-tracker.ts` | Savings rate tracking |
| `life-milestone.ts` | Long-term financial goals |

### Analytics & Insights
| File | Purpose |
|------|---------|
| `insight-engine.ts` | Insight generation (breach, win, leaks, lifestyle creep) |
| `comparison-insights.ts` | Period-over-period comparison |
| `spending-insights.ts` | Spending pattern analysis |
| `analytics-forecast.ts` | Month-end projection |
| `analytics/classifier.ts` | Spending classification engine |
| `analytics/pattern-learner.ts` | Recurring pattern detection |
| `analytics/forecast-engine-v2.ts` | Advanced forecasting |
| `financial-cockpit.ts` | Financial health dashboard data |

### Hisaab (Family Ledger)
| File | Purpose |
|------|---------|
| `hisaab.ts` | Person CRUD, entries, settlements, balance calculations |
| `hisaab-export-pdf.ts` | PDF export via expo-print |
| `hisaab-export-excel.ts` | Excel export via xlsx |
| `hisaab-import.ts` | Import hisaab data |

### SMS & Auto-Detection
| File | Purpose |
|------|---------|
| `sms/sms-reader.ts` | Read SMS from device (Android only) |
| `sms/sms-parser.ts` | Main parser orchestrator (hardcoded + template fallback) |
| `sms/sms-to-expense.ts` | Convert parsed SMS to expense records |
| `sms/sms-normalize.ts` | 9-step SMS normalization pipeline |
| `sms/bank-patterns.ts` | Hardcoded bank SMS regex patterns |
| `sms/bank-senders.ts` | Sender address → bank lookup |
| `sms/template-compiler.ts` | Compile user-tagged SMS spans into regex |
| `sms/user-sms-templates.ts` | User template CRUD, diagnose, test |
| `sms/template-draft-store.ts` | Draft persistence across template screens |
| `sms/sms-permissions.ts` | SMS permission handling |
| `sms/sms-orchestrator.ts` | Background SMS scan orchestration |

### Simulator
| File | Purpose |
|------|---------|
| `simulator.ts` | Scenario CRUD, entry management, fulfillment reconciliation, retention |
| `simulator-engine.ts` | Pure functions: run simulation, find fulfillment candidates, warnings |

### Automation
| File | Purpose |
|------|---------|
| `smart-rules.ts` | Rule evaluation, CRUD, retroactive apply |
| `recurring-rules.ts` | Reminder rules, fulfillment, cycle advancement |
| `recurring-detector.ts` | Pattern detection for recurring expenses |
| `merchant-alias.ts` | Merchant name normalization |
| `duplicate-detection.ts` | Duplicate expense detection + grouping |

### Infrastructure
| File | Purpose |
|------|---------|
| `backup.ts` | Encrypted backup/restore (AES-256-GCM) |
| `storage.ts` | Centralized MMKV instances |
| `biometric-lock.ts` | App lock logic |
| `data-cleanup.ts` | Bulk data wipe |
| `settings.ts` | User settings management |
| `locale-preferences.ts` | Currency/number/date format preferences |
| `feature-flags.ts` | Feature flag management |
| `onboarding.ts` | First-run flow logic |
| `home-preload.ts` | Cold-start data preloading |
| `loan-emi-reminder.ts` | EMI reminder notifications |
| `notifications.ts` | Notification channel setup |
| `notification-scheduler.ts` | Background notification scheduling |
| `save-to-phone.ts` | Android SAF file save helper |
| `saved-filter-views.ts` | Named filter view persistence |

### Data & Reference
| File | Purpose |
|------|---------|
| `public-data/bundle-loader.ts` | Load bundled JSON data into DB |
| `public-data/lookup.ts` | IFSC/MCC/merchant lookups |
| `public-data/sms-template-matcher.ts` | Template-based SMS matching |
| `public-data/reminder-hints.ts` | SMS-based reminder hint extraction |
| `category.ts` | Category CRUD |
| `payment-mode.ts` | Payment mode CRUD |
| `tags.ts` | Tag CRUD + batch helpers |
| `purchase-group.ts` | Split-tender purchase groups |
| `salary-profile.ts` | Salary CTC breakdown |
| `tax-engine.ts` | Income tax computation |
| `capital-gains.ts` | Capital gains tracking |
| `excel-import.ts` | Excel file import |
| `estimations-import.ts` | Estimation data import |
| `docs/index.ts` | Help article search + grouping |
| `docs/articles.ts` | Article content loading |
| `audit-log.ts` | Cross-entity audit trail |
| `kite-connect.ts` | Zerodha Kite Connect integration |
