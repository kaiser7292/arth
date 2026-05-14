# Technical Design Document (TDD)

**Version:** 0.1 (Draft)
**Author:** Sourav Baid + Claude
**Date:** 2026-04-12
**Related:** [PRD](PRD.md) | [DevOps & SDLC](DEVOPS.md) | [Test Strategy](TEST_STRATEGY.md) | [Security](SECURITY.md)

---

## 1. Architecture Overview

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        MOBILE APP                           │
│                   (React Native + Expo)                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   UI Layer   │  │  Navigation  │  │  Notification     │  │
│  │  (Screens +  │  │  (Expo       │  │  Manager          │  │
│  │  Components) │  │   Router)    │  │  (Local only)     │  │
│  └──────┬───────┘  └──────────────┘  └──────────────────┘  │
│         │                                                   │
│  ┌──────v───────────────────────────────────────────────┐   │
│  │              STATE MANAGEMENT (Zustand)               │   │
│  │  Stores: expense, budget, goal, hisaab, settings     │   │
│  └──────┬───────────────────────────────────────────────┘   │
│         │                                                   │
│  ┌──────v───────────────────────────────────────────────┐   │
│  │              SERVICE LAYER                            │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │   │
│  │  │ SMS      │ │ Email    │ │ Categori-│ │ Backup │  │   │
│  │  │ Parser   │ │ Parser   │ │ zation   │ │ Manager│  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────┘  │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │   │
│  │  │ Budget   │ │ Goal     │ │ Hisaab   │ │Template│  │   │
│  │  │ Engine   │ │ Engine   │ │ Engine   │ │Manager │  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────┘  │   │
│  └──────┬───────────────────────────────────────────────┘   │
│         │                                                   │
│  ┌──────v───────────────────────────────────────────────┐   │
│  │              DATA LAYER                               │   │
│  │  ┌──────────────┐  ┌─────────────┐  ┌────────────┐  │   │
│  │  │ SQLite DB    │  │ MMKV        │  │ File System│  │   │
│  │  │ (expo-sqlite)│  │ (settings,  │  │ (backups,  │  │   │
│  │  │              │  │  caches)    │  │  templates) │  │   │
│  │  └──────────────┘  └─────────────┘  └────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  DEVICE APIs                                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ SMS Read │ │ Gmail    │ │ Biometric│ │ Notifications│  │
│  │ (Android)│ │ OAuth    │ │ Auth     │ │ (Local)      │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Key Architecture Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| **Framework** | React Native + Expo | Cross-platform, largest skill ecosystem, JS/TS |
| **Storage** | 100% local (SQLite + MMKV) | User requirement: no cloud, full data ownership |
| **State management** | Zustand | Lightweight, no boilerplate, works well with SQLite |
| **Navigation** | Expo Router (file-based) | Convention over configuration, deep linking support |
| **Styling** | NativeWind (Tailwind CSS) | Rapid UI development, consistent design system |
| **Charts** | react-native-chart-kit | Lightweight, covers all chart types we need |
| **Background tasks** | expo-task-manager | SMS/email polling, auto-backup |
| **Encryption** | expo-crypto + expo-secure-store | Backup encryption, token storage |

### 1.3 No Cloud — Design Implications

Since there's no server:
- **No user authentication** — app is protected by device lock + optional biometric lock
- **No push notifications from server** — all notifications are local (triggered by background tasks)
- **No real-time sync** — hisaab is single-user managed, shared via exports
- **Data portability** — backup/restore is the only way to move data between devices
- **No API server** — Gmail OAuth tokens are stored locally, API calls go directly from device to Gmail

---

## 2. Component Design

### 2.1 UI Layer — Screen Structure

```
app/
├── (tabs)/                      # Tab navigator (main app)
│   ├── index.tsx                # Home Dashboard (Screen 7)
│   ├── expenses.tsx             # Expense List (Screen 8)
│   ├── budget.tsx               # Budget View (Screen 11)
│   ├── goals.tsx                # Goal Dashboard (Screen 13)
│   └── settings.tsx             # Settings hub (Screen 19)
├── (onboarding)/                # Onboarding flow
│   ├── welcome.tsx              # Screen 1
│   ├── template.tsx             # Screen 2
│   ├── permissions.tsx          # Screen 3
│   ├── categories.tsx           # Screen 4
│   ├── budget-setup.tsx         # Screen 5
│   └── payment-modes.tsx        # Screen 6
├── expense/
│   ├── add.tsx                  # Add Expense (Screen 9)
│   ├── review-queue.tsx         # Review Queue (Screen 10)
│   └── [id].tsx                 # Expense detail/edit
├── budget/
│   └── [categoryId].tsx         # Category Detail (Screen 12)
├── goals/
│   ├── yearly-plan.tsx          # Yearly Plan Setup (Screen 14)
│   ├── investment/[id].tsx      # Investment Goal Detail (Screen 15)
│   ├── milestone/[id].tsx       # Milestone Detail (Screen 16)
│   ├── savings-rate.tsx         # Savings Rate Tracker (Screen 17)
│   ├── unavoidable.tsx          # Unavoidable vs Discretionary (Screen 18)
│   └── salary-calculator.tsx    # CTC → In-Hand Calculator (Screen 30)
├── hisaab/                      # Phase 2
│   ├── index.tsx                # Hisaab List (Screen 26)
│   ├── [personId].tsx           # Hisaab Detail (Screen 27)
│   ├── add.tsx                  # Add Entry (Screen 28)
│   └── export.tsx               # Export (Screen 29)
├── settings/
│   ├── categories.tsx           # Screen 20
│   ├── payment-modes.tsx        # Screen 21
│   ├── budget-config.tsx        # Screen 22
│   ├── sms-email.tsx            # Screen 23
│   ├── templates.tsx            # Screen 24
│   └── backup.tsx               # Screen 25
└── _layout.tsx                  # Root layout
```

### 2.2 Reusable Components

```
components/
├── ui/                          # Design system primitives
│   ├── Button.tsx
│   ├── Card.tsx
│   ├── Input.tsx
│   ├── Badge.tsx
│   ├── ProgressBar.tsx
│   ├── SwipeableRow.tsx         # For approve/reject gestures
│   └── GaugeChart.tsx           # For savings rate
├── expense/
│   ├── ExpenseCard.tsx          # Single expense row
│   ├── CategoryBadge.tsx        # Category with icon + color
│   ├── PaymentModeBadge.tsx
│   ├── QuickAddButton.tsx       # FAB for quick expense entry
│   └── ReviewQueueItem.tsx      # Swipeable approve/reject item
├── budget/
│   ├── BudgetProgressBar.tsx    # Category budget bar (green/yellow/red)
│   ├── BudgetSummaryCard.tsx
│   └── CategoryBreakdown.tsx
├── goals/
│   ├── SavingsRateGauge.tsx     # Circular gauge chart
│   ├── InvestmentBucketCard.tsx  # Goal / Done / Left progress
│   ├── MilestoneCard.tsx        # Timeline progress
│   ├── CourseCorrectionBanner.tsx
│   └── YearlyPlanSummary.tsx
├── hisaab/
│   ├── HisaabPersonCard.tsx
│   ├── HisaabEntryRow.tsx
│   └── BalanceSummary.tsx
└── charts/
    ├── DonutChart.tsx           # Category spending breakdown
    ├── BarChart.tsx             # Monthly comparison
    ├── LineChart.tsx            # Trends over time
    └── TimelineChart.tsx        # Milestone progress
```

---

## 3. Data Layer — SQLite Schema

### 3.1 Database Design Principles

- **SQLite via expo-sqlite** — single file, no server, encrypts with SQLCipher
- **Migrations** — versioned schema changes, applied on app startup
- **Indexes** — on frequently queried columns (date, category_id, status)
- **No ORMs** — direct SQL for performance and simplicity
- **WAL mode** — for better concurrent read/write performance

### 3.2 Core Tables

```sql
-- Users (single user for MVP, multi-user via backup/restore)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  settings TEXT DEFAULT '{}'  -- JSON: currency, theme, notification prefs
);

-- Categories
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'dots',
  color TEXT NOT NULL DEFAULT '#6B7280',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_unavoidable INTEGER NOT NULL DEFAULT 0  -- For unavoidable vs discretionary
);
CREATE INDEX idx_categories_user ON categories(user_id);

-- Payment Modes
CREATE TABLE payment_modes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('credit_card','debit_card','upi','cash','wallet','bank_transfer')),
  is_active INTEGER NOT NULL DEFAULT 1
);

-- Expenses
CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  fx_rate REAL,
  description TEXT,
  category_id TEXT REFERENCES categories(id),
  payment_mode_id TEXT REFERENCES payment_modes(id),
  date TEXT NOT NULL,
  is_right_spend INTEGER,  -- NULL = not tagged, 0 = no, 1 = yes
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','sms_auto','email_auto')),
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','pending_review','rejected')),
  nature TEXT NOT NULL DEFAULT 'realized' CHECK(nature IN ('realized','forecast')),
  due_date TEXT,  -- Only set for forecast entries: the date the payment is expected
  account_id TEXT REFERENCES financial_accounts(id),  -- Auto-linked from SMS card/account info
  refund_of_expense_id TEXT REFERENCES expenses(id),  -- Links refund to original expense
  raw_source_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_expenses_date ON expenses(date);
CREATE INDEX idx_expenses_category ON expenses(category_id);
CREATE INDEX idx_expenses_status ON expenses(status);
CREATE INDEX idx_expenses_user_date ON expenses(user_id, date);
CREATE INDEX idx_expenses_nature ON expenses(nature);
CREATE INDEX idx_expenses_due_date ON expenses(due_date);
CREATE INDEX idx_expenses_account ON expenses(account_id);
CREATE INDEX idx_expenses_refund_link ON expenses(refund_of_expense_id);

-- Budgets
CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  month TEXT NOT NULL,  -- YYYY-MM
  amount REAL NOT NULL,
  notes TEXT
);
CREATE UNIQUE INDEX idx_budgets_unique ON budgets(user_id, category_id, month);

-- Budget Breakdowns
CREATE TABLE budget_breakdowns (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  line_item TEXT NOT NULL,
  formula TEXT,
  amount REAL NOT NULL
);
```

### 3.3 Goal Engine Tables

```sql
-- Yearly Plans
CREATE TABLE yearly_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  financial_year TEXT NOT NULL,  -- e.g., '2026-27'
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
CREATE UNIQUE INDEX idx_yearly_plans_unique ON yearly_plans(user_id, financial_year);

-- Investment Buckets
CREATE TABLE investment_buckets (
  id TEXT PRIMARY KEY,
  yearly_plan_id TEXT NOT NULL REFERENCES yearly_plans(id),
  name TEXT NOT NULL,
  annual_target REAL NOT NULL,
  current_contributed REAL NOT NULL DEFAULT 0,
  linked_milestone_id TEXT REFERENCES life_milestones(id),  -- nullable FK: links bucket to a life milestone
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- Investment Contributions
CREATE TABLE investment_contributions (
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
CREATE INDEX idx_inv_contrib_bucket ON investment_contributions(investment_bucket_id);

-- Life Milestones
CREATE TABLE life_milestones (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  target_amount REAL NOT NULL,
  current_saved REAL NOT NULL DEFAULT 0,
  target_date TEXT,
  monthly_contribution_planned REAL DEFAULT 0,
  is_completed INTEGER NOT NULL DEFAULT 0,
  completed_date TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Milestone Contributions
CREATE TABLE milestone_contributions (
  id TEXT PRIMARY KEY,
  life_milestone_id TEXT NOT NULL REFERENCES life_milestones(id),
  month TEXT NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL
);

-- Salary Profiles (Phase 1D — Income & Tax Planning)
CREATE TABLE salary_profiles (
  id TEXT PRIMARY KEY,
  yearly_plan_id TEXT NOT NULL REFERENCES yearly_plans(id),
  input_mode TEXT NOT NULL DEFAULT 'direct' CHECK(input_mode IN ('ctc','direct')),
  annual_ctc REAL,                     -- only for ctc mode
  basic_pct REAL NOT NULL DEFAULT 40,  -- % of CTC allocated to Basic
  hra_pct REAL NOT NULL DEFAULT 50,    -- % of Basic for HRA (50 metro, 40 non-metro)
  is_metro INTEGER NOT NULL DEFAULT 1,
  epf_mode TEXT NOT NULL DEFAULT 'restricted' CHECK(epf_mode IN ('full_basic','restricted')),
  epf_in_ctc INTEGER NOT NULL DEFAULT 1,  -- employer EPF is part of CTC?
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_salary_profiles_plan ON salary_profiles(yearly_plan_id);
```

### 3.4 Hisaab Tables (Phase 2)

```sql
-- Hisaab Persons
CREATE TABLE hisaab_persons (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  initial_balance REAL NOT NULL DEFAULT 0
);

-- Hisaab Entries
CREATE TABLE hisaab_entries (
  id TEXT PRIMARY KEY,
  hisaab_person_id TEXT NOT NULL REFERENCES hisaab_persons(id),
  amount REAL NOT NULL,  -- positive = they owe you, negative = credit/repayment
  description TEXT,
  date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','sms_auto','email_auto')),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','pending','disputed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_hisaab_entries_person ON hisaab_entries(hisaab_person_id);

-- Household Expenses
CREATE TABLE household_expenses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  month TEXT NOT NULL,
  category TEXT NOT NULL
);
```

### 3.5 Financial Tracking Tables (Phase 3)

```sql
-- Assets
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('brokerage','mutual_fund','bank_account','cash','wallet','deposit','lent_cash','other')),
  current_value REAL NOT NULL DEFAULT 0,
  linked_investment_bucket_id TEXT REFERENCES investment_buckets(id),
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','email_auto')),
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','pending_review','rejected')),
  last_updated TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Liabilities
CREATE TABLE liabilities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('credit_card','personal_loan','home_loan','car_loan','other')),
  outstanding_amount REAL NOT NULL DEFAULT 0,
  credit_limit REAL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','email_auto')),
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','pending_review','rejected')),
  last_updated TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 3.6 System Tables

```sql
-- Merchant-Category Mapping (for smart categorization learning)
CREATE TABLE merchant_mappings (
  id TEXT PRIMARY KEY,
  merchant_keyword TEXT NOT NULL,  -- e.g., 'SWIGGY', 'SHELL', 'APOLLO'
  category_id TEXT NOT NULL REFERENCES categories(id),
  confidence REAL NOT NULL DEFAULT 1.0,  -- 0.0 to 1.0
  correction_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'system' CHECK(source IN ('system','user_correction','manual'))
);
CREATE UNIQUE INDEX idx_merchant_map ON merchant_mappings(merchant_keyword);

-- SMS Parsing Rules
CREATE TABLE sms_rules (
  id TEXT PRIMARY KEY,
  bank_name TEXT NOT NULL,
  sender_pattern TEXT NOT NULL,  -- regex for SMS sender ID
  message_pattern TEXT NOT NULL, -- regex to extract amount, merchant, etc.
  is_active INTEGER NOT NULL DEFAULT 1
);

-- Email Parsing Rules
CREATE TABLE email_rules (
  id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,      -- e.g., 'ICICI Bank', 'CAMS', 'Zerodha'
  sender_email TEXT NOT NULL,
  subject_pattern TEXT,
  body_pattern TEXT NOT NULL,     -- regex to extract data
  data_type TEXT NOT NULL CHECK(data_type IN ('expense','investment','liability')),
  is_active INTEGER NOT NULL DEFAULT 1
);

-- Backup History
CREATE TABLE backup_history (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  location TEXT NOT NULL,  -- 'device', 'google_drive', 'icloud'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Schema Migrations
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 3.7 Financial Account & Recurring Tables

```sql
-- Financial Accounts (auto-discovered from SMS)
CREATE TABLE financial_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  account_identifier TEXT NOT NULL,     -- last 4 digits of card/account
  bank_name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK(account_type IN ('savings','credit_card','loan','wallet')),
  account_label TEXT,                   -- user-editable nickname
  credit_limit REAL,
  last_known_balance REAL,
  last_balance_date TEXT,
  total_due REAL,
  min_due REAL,
  due_date TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  discovered_from_sms INTEGER NOT NULL DEFAULT 1,
  has_nach_mandate INTEGER NOT NULL DEFAULT 0,
  nach_merchant TEXT,
  nach_amount REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE UNIQUE INDEX idx_financial_accounts_unique
  ON financial_accounts(user_id, account_identifier, bank_name, account_type);
CREATE INDEX idx_financial_accounts_user
  ON financial_accounts(user_id, is_active);

-- Recurring Transactions (auto-detected from expense patterns)
CREATE TABLE recurring_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  merchant_normalized TEXT NOT NULL,
  amount REAL NOT NULL,
  frequency TEXT NOT NULL CHECK(frequency IN ('weekly','monthly','quarterly','yearly')),
  category_id TEXT,
  account_id TEXT,
  last_seen_date TEXT NOT NULL,
  next_expected_date TEXT,
  occurrence_count INTEGER NOT NULL DEFAULT 2,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (account_id) REFERENCES financial_accounts(id)
);
CREATE INDEX idx_recurring_user ON recurring_transactions(user_id, is_active);
CREATE INDEX idx_recurring_merchant ON recurring_transactions(user_id, merchant_normalized);
```

---

## 4. Service Layer Design

### 4.1 SMS Parser Service

```
services/
  sms/
    SmsListener.ts        — Background service that monitors incoming SMS
    SmsParser.ts          — Extracts amount, merchant, date from SMS text
    BankPatterns.ts       — 50+ regex patterns for 20+ banks (ICICI, HDFC, SBI, Axis, Kotak, IDFC, Citi, Amex, etc.)
    BankSenders.ts        — Bank sender ID registry (25+ sender codes)
    SmsToExpense.ts       — Creates pending Expense from parsed SMS data + account discovery + refund linking
  financial-account.ts    — Account discovery, CC tracking, balance/dues, NACH mandates
  recurring-detector.ts   — Subscription & recurring payment auto-detection
```

**Transaction Types (14):**
```
debit | credit | emi | standing_instruction | payment_received
| standing_instruction_reminder | emi_reminder | amount_due_reminder
| refund | nach_debit | nach_bounce | upi_credit | upi_debit | balance_inquiry
```

**ParsedSMS Extended Fields:**
```
amount, merchant, cardLast4, date, bank, type, skip, confidence, dueDate, isForecast
+ upiRef, availableBalance, creditLimit, availableCreditLimit, accountType
```

**Flow:**
```
Incoming SMS → SmsListener detects bank SMS → SmsParser extracts fields
→ If OTP: skip (no entry created)
→ If reminder/due: create forecast expense (nature='forecast', due_date=parsed)
→ If transaction: check for matching forecast → realize or create new
→ SmartCategorizer assigns category (Unknown if no match)
→ discoverOrUpdateAccount() → upsert FinancialAccount
→ linkExpenseToAccount() → set account_id
→ If refund: findAndLinkRefund() → set refund_of_expense_id
→ If NACH: updateNachInfo() → update account mandate
→ checkNewExpenseForRecurring() → update recurring detection
→ NotificationManager sends local notification
```

### 4.1a Financial Account Service

```
services/
  financial-account.ts
    discoverOrUpdateAccount()  — Upsert account from parsed SMS fields (cardLast4 + bank + type)
    getActiveAccounts()        — List all active accounts for user
    getAccountSummary()        — Aggregate: total balance, credit available, total dues
    updateAccountFromSMS()     — Update balance/limit/due from relevant SMS
    linkExpenseToAccount()     — Set account_id on expense by cardLast4 + bank match
    getAccountExpenses()       — All expenses for a specific account
    updateAccountDues()        — Update CC due amounts from due SMS
    getUpcomingDues()          — All pending CC dues sorted by date
    updateNachInfo()           — Record NACH mandate info on account
    deactivateAccount()        — User hides an account
    renameAccount()            — User sets a nickname
```

### 4.1b Recurring Detector Service

```
services/
  recurring-detector.ts
    detectRecurringTransactions()   — Full scan of expense patterns
    getRecurringTransactions()      — List all detected recurring
    confirmRecurring()              — User confirms a detected recurring
    dismissRecurring()              — User says this is NOT recurring
    getUpcomingRecurring()          — Predicted charges in next N days
    checkNewExpenseForRecurring()   — On expense approval, update recurring info
```

**Detection algorithm:** Query approved expenses grouped by normalized merchant + approximate amount (within 5%). For groups with 2+ occurrences, classify by interval: ~7d=weekly, ~28-31d=monthly, ~85-95d=quarterly, ~355-375d=yearly. Runs after expense approval, throttled to max once per hour.

### 4.2 Email Parser Service

```
services/
  email/
    GmailAuth.ts          — OAuth 2.0 flow, token management
    GmailFetcher.ts       — Fetch new emails since last check
    EmailClassifier.ts    — Classify email type (expense/investment/liability)
    ExpenseEmailParser.ts — Parse bank alerts, booking confirmations
    InvestmentEmailParser.ts — Parse CAMS/KFintech, SIP, brokerage emails
    LiabilityEmailParser.ts  — Parse CC statements, EMI reminders
    EmailToRecord.ts      — Create pending record of appropriate type
```

### 4.3 Smart Categorization Service

```
services/
  categorization/
    SmartCategorizer.ts   — Main entry: takes merchant string, returns category
    RuleEngine.ts         — Keyword-to-category matching from merchant_mappings
    LearningEngine.ts     — Records corrections, updates confidence scores
    DefaultMappings.ts    — Pre-built 200+ Indian merchant mappings
```

### 4.4 Budget Engine Service

```
services/
  budget/
    BudgetCalculator.ts   — Actuals vs budget per category
    BudgetAlerts.ts       — Threshold checks, notification triggers
    ComplianceTracker.ts  — "If I continue at this rate..." projections
```

### 4.5 Goal Engine Service

```
services/
  goals/
    YearlyPlanCalculator.ts    — Master plan calculations
    SavingsRateTracker.ts      — Real-time savings rate vs target
    CourseCorrection.ts        — "Save Rs X extra/month" calculations
    InvestmentTracker.ts       — Goal/Done/Left per bucket
    MilestoneTracker.ts        — Progress + projected completion
    TrajectoryAnalysis.ts      — On track / off track determination
```

**Investment-Milestone Linking:**
When an investment bucket has `linked_milestone_id` set:
- Adding a contribution to the bucket also updates the milestone's `current_saved` (increment)
- Deleting a contribution reverses the update (decrement)
- Milestone detail screen shows contributions from linked buckets alongside direct contributions
- A bucket links to at most one milestone; a milestone can receive from multiple buckets

### 4.6 Salary & Tax Calculator Service

```
services/
  tax/
    SalaryCalculator.ts       — CTC breakdown (Basic, HRA, Special Allowance, EPF, Gratuity)
    TaxEngine.ts              — Tax computation for both New and Old regimes
    TaxSlabs.ts               — FY 2025-26 slab definitions (New: 7 slabs + 87A rebate; Old: 4 slabs + deductions)
    EpfCalculator.ts          — EPF logic (full_basic vs restricted, employee + employer split, EPS 8.33%)
    ProfessionalTax.ts        — State-wise professional tax rates
    SalaryProfileService.ts   — CRUD for salary_profiles table, ties to yearly_plan
```

**CTC → In-Hand Flow:**
```
Annual CTC
  → Split: Basic (40%), HRA (50% of Basic), Special Allowance (remainder)
  → Subtract: Employer EPF (12% of Basic or restricted), Gratuity (4.81% of Basic)
  = Gross Salary (what goes through tax calculation)
  → Calculate Taxable Income: Gross - Standard Deduction - (Old regime deductions if applicable)
  → Apply Tax Slabs (New or Old regime)
  → Apply Surcharge (if income > Rs 50L) + 4% Cess
  → Apply Section 87A rebate (if eligible, New regime: taxable ≤ Rs 12L → rebate up to Rs 60K)
  → Subtract: Employee EPF + VPF + Professional Tax
  = Monthly In-Hand Salary
```

### 4.7 Backup & Template Service

```
services/
  backup/
    BackupCreator.ts      — Export all SQLite data to encrypted file
    BackupRestorer.ts     — Import from encrypted file, replace local DB
    AutoBackupScheduler.ts — Background task for scheduled backups
  template/
    TemplateExporter.ts   — Export config (categories, budgets, modes) as template
    TemplateImporter.ts   — Apply template to current setup
    DefaultTemplates.ts   — Built-in "Indian Professional" template
```

---

## 5. Data Flow Diagrams

### 5.1 Expense Entry Flow (Manual + Auto)

```
Manual Entry                    SMS Auto-Detection              Email Auto-Detection
     │                              │                               │
     v                              v                               v
[User fills form]          [Background listener]           [Background fetcher]
     │                              │                               │
     v                              v                               v
[Validate input]           [Parse SMS text]                [Parse email body]
     │                              │                               │
     v                              v                               v
[Assign category]          [Smart categorize]              [Classify type]
     │                              │                               │
     │                              v                               v
     │                    [Create pending record]         [Create pending record]
     │                              │                               │
     v                              v                               v
[Save to SQLite]           [Local notification]            [Local notification]
(status: approved)         (status: pending_review)        (status: pending_review)
     │                              │                               │
     v                              v                               v
[Update budget             [User reviews in queue]         [User reviews in queue]
 calculations]                      │                               │
                           [Approve / Edit / Reject]       [Approve / Edit / Reject]
                                    │                               │
                                    v                               v
                           [Save to SQLite]                [Save to SQLite]
                           [Update budgets/goals]          [Update budgets/goals/assets]


SMS Forecast Detection (Realized vs Forecast)
     │
     v
[Background listener detects reminder SMS]
(Standing instruction reminder, Amount Due, EMI due)
     │
     v
[Parse: amount, due_date, merchant/card]
     │
     v
[Create forecast expense]
(nature: 'forecast', status: 'pending_review', due_date: parsed)
     │
     v
[User reviews forecast in queue]
     │
     v  (later, when actual debit SMS arrives)
[Match forecast by amount + card + date window (+/- 7 days)]
     │
     v
[If matched: convert to realized (nature='realized', date=actual debit date)]
[If no match: create new realized expense as normal]
```

### 5.2 Backup & Restore Flow

```
BACKUP (Create)                              RESTORE (Load)
─────────────                                ──────────────
1. User taps "Create Backup"                 1. User taps "Restore from Backup"
2. App reads entire SQLite DB                2. User selects .accmgr file
3. Exports as JSON structure                 3. App prompts: "This will replace all data"
4. Encrypts with user's password             4. User enters backup password
5. Saves as .accmgr file                     5. App decrypts file
6. User chooses: device / GDrive / iCloud    6. App validates data integrity
7. Logs backup in backup_history             7. App replaces local SQLite DB
                                             8. App restarts with restored data
```

---

## 6. Performance Considerations

Given the user's estimate of **100K-250K transactions per year**, performance is not a primary concern. However, some basic optimizations:

| Concern | Approach |
|---------|----------|
| **List rendering** | FlatList with pagination (50 items per page). No need for virtualization libraries. |
| **SQLite queries** | Indexes on date, category_id, status. Standard queries will return in <10ms. |
| **Background tasks** | SMS listener and email fetcher run on OS-managed background schedule. Minimal battery impact. |
| **Chart rendering** | Pre-aggregate monthly totals in queries. Don't iterate all records client-side. |
| **Backup file size** | 250K records ≈ 50-100 MB as compressed JSON. Acceptable for email/drive transfer. |
| **App startup** | Load current month data only. Lazy-load historical data on scroll. |

---

## 7. Offline-First Design

The entire app works offline by design:

| Feature | Online Requirement |
|---------|-------------------|
| Manual expense entry | None — fully offline |
| SMS auto-detection | None — reads SMS locally |
| Email auto-detection | **Requires internet** — needs to fetch from Gmail API |
| Budget tracking | None — local calculation |
| Goal tracking | None — local calculation |
| Hisaab | None — local data |
| Backup to device | None |
| Backup to Google Drive | **Requires internet** — only for upload |
| Template share | **Requires internet** — only for email/WhatsApp send |

**Key principle:** The app never blocks on network. Email sync happens in background — if offline, it simply skips and retries later. The user never sees a loading spinner for core features.
