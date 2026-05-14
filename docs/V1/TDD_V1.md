# Artha (अर्थ) — Version 1 Technical Design Document

**Version:** 1.1
**Date:** 2026-04-13
**Status:** Complete (all 12 features implemented)
**Predecessor:** MVP TDD at `docs/MVP/TDD.md`

---

## 1. Overview

V1 adds 3 database migrations (015-017), updates 10+ service files, redesigns 5 screens, adds 4 new components, and refreshes the color palette. All changes are backward-compatible — no data loss, no breaking schema changes.

**Architecture remains unchanged:** 100% local, SQLite + MMKV, no cloud. Same React Native + Expo stack.

---

## 2. Schema Changes

### 2.1 Migration 015: expense_merchant_split

**File:** `database/migrations/015_expense_merchant_split.ts`
**Features:** F1 (Split), F8 (Merchant)

```sql
-- Merchant as first-class field
ALTER TABLE expenses ADD COLUMN merchant_name TEXT;
CREATE INDEX idx_expenses_merchant ON expenses(merchant_name);

-- Split tracking
ALTER TABLE expenses ADD COLUMN split_original_amount REAL;
ALTER TABLE expenses ADD COLUMN split_person_id TEXT REFERENCES hisaab_persons(id);
ALTER TABLE expenses ADD COLUMN split_pct REAL;
ALTER TABLE expenses ADD COLUMN split_hisaab_entry_id TEXT REFERENCES hisaab_entries(id);
CREATE INDEX idx_expenses_split_person ON expenses(split_person_id);
```

**Notes:**
- All new columns are nullable — existing expenses unaffected
- `merchant_name` stores the extracted merchant from SMS or manual input
- `split_original_amount` is the total before split; `amount` becomes user's share
- `split_hisaab_entry_id` creates bidirectional link between expense and hisaab entry

### 2.2 Migration 016: goals_v1_restructure

**File:** `database/migrations/016_goals_v1_restructure.ts`
**Features:** F3 (Goals Rework), F12 (Income Calculator)

```sql
-- Investment buckets: decouple from yearly_plan_id
ALTER TABLE investment_buckets ADD COLUMN financial_year TEXT;
ALTER TABLE investment_buckets ADD COLUMN user_id TEXT REFERENCES users(id);

-- Backfill from yearly_plans FK
UPDATE investment_buckets
SET financial_year = (SELECT financial_year FROM yearly_plans WHERE id = investment_buckets.yearly_plan_id),
    user_id = (SELECT user_id FROM yearly_plans WHERE id = investment_buckets.yearly_plan_id)
WHERE yearly_plan_id IS NOT NULL;

-- Life milestones: multi-year spreading
ALTER TABLE life_milestones ADD COLUMN start_financial_year TEXT;
ALTER TABLE life_milestones ADD COLUMN duration_years INTEGER DEFAULT 1;

-- Salary profiles: decouple from yearly_plan_id + new income fields
ALTER TABLE salary_profiles ADD COLUMN financial_year TEXT;
ALTER TABLE salary_profiles ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE salary_profiles ADD COLUMN expected_capital_gains REAL NOT NULL DEFAULT 0;
ALTER TABLE salary_profiles ADD COLUMN expected_bonus REAL NOT NULL DEFAULT 0;

-- Backfill salary profiles
UPDATE salary_profiles
SET financial_year = (SELECT financial_year FROM yearly_plans WHERE id = salary_profiles.yearly_plan_id),
    user_id = (SELECT user_id FROM yearly_plans WHERE id = salary_profiles.yearly_plan_id)
WHERE yearly_plan_id IS NOT NULL;

-- Indexes
CREATE INDEX idx_investment_buckets_fy ON investment_buckets(user_id, financial_year);
CREATE INDEX idx_salary_profiles_fy ON salary_profiles(user_id, financial_year);
CREATE INDEX idx_life_milestones_fy ON life_milestones(start_financial_year);
```

**Critical decisions:**
- `yearly_plan_id` columns are NOT dropped — backward compatibility
- Backfill runs in the migration to populate `financial_year` and `user_id` from existing FK relationships
- New code uses `financial_year` + `user_id` exclusively; old code paths remain functional
- `expected_capital_gains` and `expected_bonus` default to 0 (not null) since they're additive income components

### 2.3 Migration 017: forecast_matching

**File:** `database/migrations/017_forecast_matching.ts`
**Feature:** F5 (Forecast-to-Realised Workflow)

```sql
-- Link realized expenses to matched forecasts
ALTER TABLE expenses ADD COLUMN matched_forecast_id TEXT REFERENCES expenses(id);
CREATE INDEX idx_expenses_matched_forecast ON expenses(matched_forecast_id);
```

**Notes:**
- Self-referencing FK: `matched_forecast_id` points to another row in the same `expenses` table (the forecast)
- Used during SMS processing: when a realized expense matches a forecast, the realized expense's `matched_forecast_id` is set to the forecast's `id`
- Cleared (set to NULL) when the user takes action (Realise, Already Captured, or Both Different)
- Index enables efficient lookup of matched pairs in the review queue

### 2.4 Updated Schema Summary

After V1 migrations, the database has **18 tables** (unchanged) with **17 migrations** (was 14):

| # | Migration | Tables/Changes |
|---|-----------|---------------|
| 001 | initial_schema | users, categories, payment_modes |
| 002 | expenses | expenses |
| 003 | budget_tables | budgets, budget_breakdowns |
| 004 | goal_engine_tables | yearly_plans, investment_buckets, investment_contributions, life_milestones, milestone_contributions |
| 005 | sms_tables | pending_sms |
| 006 | financial_accounts | financial_accounts |
| 007 | settings_sync | settings |
| 008 | salary_profiles | salary_profiles |
| 009 | expense_nature_forecast | expenses nature/due_date columns |
| 010 | expense_account_link | expenses account_id column |
| 011 | expense_refund_tracking | expenses refund columns |
| 012 | sms_raw_source | expenses raw_source_text |
| 013 | expense_fx_fields | expenses currency/fx_rate |
| 014 | hisaab_tables | hisaab_persons, hisaab_entries, household_expenses, household_splits |
| **015** | **expense_merchant_split** | **expenses: merchant_name, split columns + 2 indexes** |
| **016** | **goals_v1_restructure** | **investment_buckets, life_milestones, salary_profiles: FY columns + backfill + 3 indexes** |
| **017** | **forecast_matching** | **expenses: matched_forecast_id + 1 index** |

### 2.5 New Indexes

| Index | Table | Columns | Purpose |
|-------|-------|---------|---------|
| idx_expenses_merchant | expenses | merchant_name | Merchant filtering/grouping |
| idx_expenses_split_person | expenses | split_person_id | Find splits by person |
| idx_expenses_matched_forecast | expenses | matched_forecast_id | Matched forecast-realized pair lookups |
| idx_investment_buckets_fy | investment_buckets | user_id, financial_year | Query buckets by FY |
| idx_salary_profiles_fy | salary_profiles | user_id, financial_year | Query profiles by FY |
| idx_life_milestones_fy | life_milestones | start_financial_year | Query milestones by FY |

---

## 3. Service Layer Changes

### 3.1 Expense Service (`services/expense.ts`)

**Interface updates:**
```typescript
// Added to Expense interface
merchant_name: string | null;
split_original_amount: number | null;
split_person_id: string | null;
split_pct: number | null;
split_hisaab_entry_id: string | null;
matched_forecast_id: string | null;

// Added to CreateExpenseInput
merchant_name?: string;
```

**New functions:**
```typescript
// Split expense creation (atomic: expense + hisaab entry)
interface CreateSplitExpenseInput extends CreateExpenseInput {
  split_with_person_id: string;
  split_pct: number;        // 0-100, user's share
  original_amount: number;  // total before split
}

function createSplitExpense(input: CreateSplitExpenseInput): Promise<string>
// 1. my_portion = original_amount * (split_pct / 100)
// 2. their_portion = original_amount - my_portion
// 3. In transaction:
//    a. Create expense (amount = my_portion, split_* fields set)
//    b. Create hisaab entry (type='debit', amount=their_portion)
//    c. Update expense with split_hisaab_entry_id
// 4. Return expense id
```

**Updated functions:**
- `createExpense()` — INSERT includes merchant_name
- `updateExpense()` — supports merchant_name updates
- All SELECT queries — include merchant_name and split_* columns

### 3.2 SMS-to-Expense (`services/sms/sms-to-expense.ts`)

**Change:** In all 3 expense creation paths (realized, refund, forecast), pass `parsed.merchant` as `merchant_name` in the CreateExpenseInput.

```typescript
// Before: merchant only in description via buildDescription()
// After: merchant in both description AND merchant_name field
const input: CreateExpenseInput = {
  ...existingFields,
  merchant_name: parsed.merchant || undefined,  // NEW
};
```

### 3.3 Salary Profile Service (`services/salary-profile.ts`)

**Interface updates:**
```typescript
// Added to SalaryProfile
financial_year: string | null;
user_id: string | null;
expected_capital_gains: number;
expected_bonus: number;
```

**New functions:**
```typescript
function getSalaryProfileByFY(userId: string, financialYear: string): Promise<SalaryProfile | null>
```

**Updated functions:**
- `createSalaryProfile()` — accepts `financial_year`, `user_id`, `expected_capital_gains`, `expected_bonus`
- `updateSalaryProfile()` — same new fields

### 3.4 Investment Bucket Service (in `services/yearly-plan.ts`)

**Interface updates:**
```typescript
// Added to InvestmentBucket
financial_year: string | null;
user_id: string | null;
```

**New functions:**
```typescript
function getBucketsByFY(userId: string, financialYear: string): Promise<InvestmentBucket[]>
```

**Updated functions:**
- `createInvestmentBucket()` — accepts `financial_year`, `user_id` (in addition to `yearly_plan_id`)

### 3.5 Life Milestone Service (`services/life-milestone.ts`)

**Interface updates:**
```typescript
// Added to LifeMilestone
start_financial_year: string | null;
duration_years: number;  // default 1
```

**New functions:**
```typescript
function getMilestoneContributionForFY(milestoneId: string, financialYear: string): Promise<number>
// Returns target_amount / duration_years if FY is in range, else 0

function getMilestonesForFY(userId: string, financialYear: string): Promise<LifeMilestone[]>
// Returns milestones whose FY range includes the target FY
```

### 3.6 Derived Plan Service (new logic in `services/yearly-plan.ts`)

**New types:**
```typescript
interface DerivedPlanSummary {
  financial_year: string;
  income: {
    salary_annual: number;     // computed_monthly_in_hand * 12
    bonus: number;             // expected_bonus
    capital_gains: number;     // expected_capital_gains
    total: number;
  };
  investments: {
    bucket_total: number;      // SUM(annual_target) for active buckets in this FY
    bucket_count: number;
  };
  milestones: {
    contribution_total: number; // SUM of milestone contributions for this FY
    active_count: number;
  };
  expenses: {
    annualized_total: number;  // From monthly budgets
    monthly_average: number;
  };
  summary: {
    total_income: number;
    total_outflow: number;     // expenses + investments + milestones
    surplus: number;           // income - outflow
    savings_rate: number;      // surplus / income * 100
    savings_rate_target: number; // from yearly_plans
    is_achievable: boolean;    // surplus >= 0
  };
}
```

**New function:**
```typescript
function deriveYearlyPlan(userId: string, financialYear: string): Promise<DerivedPlanSummary>
// 1. Get salary profile by FY → compute income
// 2. Get investment buckets by FY → sum annual_target
// 3. Get milestones for FY → sum contributions
// 4. Get budgets → annualize
// 5. Compute summary
// 6. Auto-create/update yearly_plans record with derived values
```

### 3.7 Hisaab Service (`services/hisaab.ts`)

**New function:**
```typescript
function getEntryByLinkedExpense(expenseId: string): Promise<HisaabEntry | null>
// Find hisaab entry linked to an expense (for split display)
```

### 3.8 Forecast Matching (`services/expense.ts`)

**New functions:**
```typescript
// Enhanced matching with confidence scoring
function findMatchingForecast(userId: string, amount: number, accountId: string | null, date: string): Promise<{forecast: Expense, confidence: number} | null>
// Match criteria:
//   - Same account_id (if both present)
//   - Amount within 5% tolerance
//   - due_date within 7 days of actual date
// Confidence: 0-100 (exact amount + closer date = higher score)

// Get all matched forecast-realized pairs pending review
function getMatchedForecastPairs(userId: string): Promise<Array<{realized: Expense, forecast: Expense}>>
// Finds realized expenses with matched_forecast_id IS NOT NULL and status = pending_review

// Realise a forecast (convert forecast to realized)
function realizeForecastFromMatch(forecastId: string, realizedId: string, actualDate: string): Promise<void>
// 1. Update forecast: nature→realized, date→actualDate, due_date→NULL, status→approved
// 2. Reject the duplicate realized expense
// 3. Clear matched_forecast_id on both

// Already captured (dismiss forecast, keep realized)
function dismissMatchedForecast(forecastId: string, realizedId: string): Promise<void>
// 1. Reject the forecast
// 2. Approve the realized expense
// 3. Clear matched_forecast_id

// Both different (keep both as separate)
function keepBothExpenses(forecastId: string, realizedId: string): Promise<void>
// 1. Approve the realized expense
// 2. Keep forecast as-is (still forecast/pending)
// 3. Clear matched_forecast_id on both

// Overdue forecast helpers
function getOverdueForecasts(userId: string, today: string): Promise<Expense[]>
function bulkDismissOverdue(userId: string, today: string): Promise<number>
```

---

## 4. Screen Changes

### 4.1 New Components

| Component | File | Purpose |
|-----------|------|---------|
| ExpenseHeroCard | `components/expense/ExpenseHeroCard.tsx` | Hero card with merchant, amount, category, date, source/nature badges |
| ExpenseAccountRow | `components/expense/ExpenseAccountRow.tsx` | Bank name + card type + last 4 digits row |
| ExpenseMetadata | `components/expense/ExpenseMetadata.tsx` | Collapsible "Other Info" (source, nature, created, raw SMS, refund, split) |
| CollapsibleSection | `components/ui/CollapsibleSection.tsx` | Animated expand/collapse with MMKV-persisted state |

### 4.2 Screen Modifications

| Screen | File | Change Type | Features |
|--------|------|-------------|----------|
| App Layout | `app/_layout.tsx` | Minor | F2: min splash duration |
| Add Expense | `app/expense/add.tsx` | Medium | F1: split toggle + person picker; F8: merchant input |
| Expense Detail | `app/expense/[id].tsx` | Major redesign | F6: hero card, account row, metadata, actions |
| Expenses Tab | `app/(tabs)/expenses.tsx` | Medium | F8: merchant-first rows; F10: inline review queue |
| Budget Tab | `app/(tabs)/budget.tsx` | Medium | F11: collapsible sections |
| Home Tab | `app/(tabs)/index.tsx` | Medium | F11: upcoming dues card |
| Goals Tab | `app/(tabs)/goals.tsx` | Major | F3: guided setup, derived plan summary |
| Yearly Plan | `app/goals/yearly-plan.tsx` | Major | F3: read-only dashboard |
| Investment Buckets | `app/goals/investment-buckets.tsx` | Medium | F3: FY selector |
| Milestones | `app/goals/milestones.tsx` | Medium | F3: FY start + duration |
| Salary Calculator | `app/goals/salary-calculator.tsx` | Medium | F12: FY selector, bonus, capital gains |
| Settings | `app/(tabs)/settings.tsx` | Minor | F9: remove seed picker |
| Review Queue | `app/expense/review-queue.tsx` | Medium | F5: matched forecast section |
| Savings Gauge | `components/charts/SavingsGauge.tsx` | Major | F4: single ring replacement |
| Theme | `constants/theme.ts` | Major | F7: new color palette |
| Tailwind | `tailwind.config.js` | Major | F7: new palette in config |

### 4.3 Expense Detail Redesign (F6) — Screen Layout

```
┌─────────────────────────────────┐
│  ← Back              Edit       │  Header
├─────────────────────────────────┤
│                                 │
│     Amazon Pay                  │  Hero: Merchant name
│     ₹ 500.00  ↓                │  Hero: Amount + debit icon
│     [🛒 Shopping]               │  Hero: Category badge
│     12 Apr 2026, 3:45 PM       │  Hero: Date + time
│                                 │
├─────────────────────────────────┤
│  🏦 ICICI CREDIT 3001          │  Account row
├─────────────────────────────────┤
│                                 │
│  Category    [🛒 Shopping    ▼] │  Editable fields
│  Payment     [Credit Card    ▼] │
│  Right Spend [✓ Necessary     ] │
│  Description [Bought headphones]│
│                                 │
├─────────────────────────────────┤
│  ┌──────────┐  ┌──────────────┐ │  Action cards
│  │ Split w/  │  │ Attach       │ │
│  │ Hisaab    │  │ receipt      │ │
│  └──────────┘  └──────────────┘ │
├─────────────────────────────────┤
│  ▼ Other Info                   │  Collapsible
│    Source: SMS Auto             │
│    Nature: Realized             │
│    Created: 12 Apr 2026 15:45  │
│    Raw SMS: "ICICI: Rs 500..." │
│    Refund of: —                │
│    Split: —                    │
└─────────────────────────────────┘
```

### 4.4 Goals Tab — Guided Setup Flow

```
Current state:                    V1 state:
┌────────────────┐               ┌────────────────┐
│ Create Plan    │     →         │ Set up your     │
│ [Big CTA]      │               │ financial plan  │
│                │               │                 │
│                │               │ ✓ Set income    │  → salary-calculator
│                │               │ ○ Add goals     │  → investment-buckets
│                │               │ ○ Add milestones│  → milestones
│                │               │                 │
│                │               │ [View Plan →]   │  → yearly-plan (read-only)
└────────────────┘               └────────────────┘
```

### 4.5 Yearly Plan — Read-Only Dashboard

```
Current state:                    V1 state:
┌────────────────┐               ┌────────────────────┐
│ Salary [input] │     →         │ Income    ₹24L  [→]│  Links to salary-calc
│ Bonus  [input] │               │ Invest    ₹6L   [→]│  Links to buckets
│ Expenses[input]│               │ Milestones ₹3L  [→]│  Links to milestones
│ Invest [input] │               │ Expenses  ₹12L  [→]│  Links to budget
│ Miles  [input] │               ├────────────────────┤
│ Target% [input]│               │ Surplus: ₹3L       │
│ [Save]         │               │ Savings: 12.5%     │
│                │               │ Target:  [15%] ✎   │  Only editable field
└────────────────┘               └────────────────────┘
```

---

## 5. Color Palette Changes (F7)

### 5.1 Light Mode

| Token | MVP Value | V1 Value | Source |
|-------|-----------|----------|--------|
| background | #FFFFFF | #FFFFFF (unchanged) | — |
| surface | #F6F7FB | #F7F7F5 (warm gray, Notion-like) | Tailwind stone-50 inspired |
| text-primary | #131A26 | #1A1A1A (near-black) | Notion-style |
| text-secondary | #8E92A6 | #6B7280 (cool gray) | Tailwind gray-500 |
| text-tertiary | (implied) | #9CA3AF | Tailwind gray-400 |
| border | #E5E9F0 | #E5E5E3 (warm border) | Notion-style |
| tint/primary | #2A2E73 (deep blue) | #2563EB (blue) | Tailwind blue-600 |
| icon | #8E92A6 | #6B7280 | Matches text-secondary |
| tab-icon-default | — | #9CA3AF | Matches text-tertiary |
| tab-icon-selected | #2A2E73 | #2563EB | Matches primary |
| success | #0CBF16 | #16A34A | Tailwind green-600 |
| danger | #FF3333 | #DC2626 | Tailwind red-600 |
| warning | #EAB308 | #D97706 | Tailwind amber-600 |

### 5.2 Primary Scale (Tailwind Blue)

| Shade | Hex | Usage |
|-------|-----|-------|
| 50 | #EFF6FF | Tinted backgrounds, hover states |
| 100 | #DBEAFE | Light badges |
| 200 | #BFDBFE | Progress tracks |
| 300 | #93C5FD | Dark mode accents |
| 400 | #60A5FA | Dark mode tint, interactive elements |
| 500 | #3B82F6 | Links, active states |
| 600 | #2563EB | **Primary anchor** — buttons, tabs, tint |
| 700 | #1D4ED8 | Dark mode pressed states |
| 800 | #1E40AF | Deep emphasis |
| 900 | #1E3A8A | Highest emphasis |

### 5.3 Dark Mode

| Token | MVP Value | V1 Value | Notes |
|-------|-----------|----------|-------|
| background | #0D0E12 | #111111 (near-black) | Cleaner neutral, no blue tint |
| surface | #1C1F2B | #1E1E1E | Neutral dark |
| text-primary | #FFFFFF | #FFFFFF (unchanged) | — |
| text-secondary | #A0A5B3 | #A0A0A0 | Neutral gray |
| border | #2C3142 | #2E2E2E | Neutral dark border |
| tint | #AAADDB | #60A5FA (primary-400) | Brighter, better contrast |
| icon | #A0A5B3 | #A0A0A0 | Neutral gray |
| tab-icon-default | — | #6B7280 | — |
| tab-icon-selected | #AAADDB | #60A5FA | Matches tint |

### 5.4 Shadow Changes

Card shadow softened for lighter aesthetic:
- **iOS:** shadowOpacity 0.06 → 0.04, shadowRadius 3 → 4
- **Android:** elevation 1 (unchanged)

### 5.5 Implementation Notes

- ~250 hardcoded hex references replaced across 40+ files via sed
- rgba() values in goals STATUS_CONFIG manually updated to match new hex equivalents
- Category data colors (e.g., #F59E0B for Rent & Utilities) intentionally NOT changed — these are user data, not theme
- Alpha-suffixed hex values (e.g., `#2A2E7318`) were handled by replacing the 6-char hex prefix
- SectionHeader bottom margin increased (mb-2 → mb-3) for more breathing room
- Home screen card spacing increased (mt-2/mt-3 → mt-3/mt-4) for Notion-like spaciousness

---

## 6. Testing Strategy

### 6.1 New Test Coverage

| Area | Tests | Type |
|------|-------|------|
| Migration 015 | Column existence, index creation, NULL defaults | Unit |
| Migration 016 | Column existence, backfill correctness, index creation | Unit |
| Migration 017 | Column existence, index creation | Unit |
| Split expense service | Atomic creation, amount calculation, edge cases | Unit |
| Derive plan service | Full derivation, missing components, multi-FY | Unit |
| Salary profile FY | Create/get by FY, capital gains, bonus | Unit |
| Investment bucket FY | Create/get by FY, backward compat | Unit |
| Milestone spreading | Duration 1/3/5 years, contribution per FY | Unit |
| Forecast matching | Exact/close/no match, date window, amount tolerance, confidence scoring | Unit |
| Matched pair actions | Realise, Already Captured, Both Different | Unit |
| Overdue forecasts | Overdue detection, bulk dismiss | Unit |
| Merchant field | CRUD with merchant, SMS wiring | Unit |
| Budget helpers | Updated status color returns (#16A34A, #D97706, #DC2626) | Unit |

### 6.2 Existing Test Updates

- `database.test.ts`: Update migration count (14→17), index count (+6), column counts for altered tables
- `budget-helpers.test.ts`: Updated color assertions to match new palette
- `expense.test.ts`: Update Expense interface references if needed
- `yearly-plan.test.ts`: Update for new fields, new functions

### 6.3 Manual Testing

| Screen | Light Mode | Dark Mode | Key Checks |
|--------|-----------|-----------|------------|
| Add Expense | Y | Y | Split flow, merchant input, date picker |
| Expense Detail | Y | Y | Hero card, account row, metadata, split info |
| Expenses Tab | Y | Y | Merchant-first rows, inline review queue |
| Budget Tab | Y | Y | Collapsible sections, state persistence |
| Home Tab | Y | Y | Upcoming dues card |
| Goals Tab | Y | Y | Guided setup, derived plan |
| Yearly Plan | Y | Y | Read-only, savings target editable |
| Salary Calculator | Y | Y | FY selector, bonus, capital gains, EPF labels |
| Investment Buckets | Y | Y | FY selector, bucket creation |
| Milestones | Y | Y | FY start, duration, spreading |
| Review Queue | Y | Y | Matched forecasts, 3 actions |
| Settings | Y | Y | Seed picker removed |
| Splash | — | — | Readable for ~2.5 seconds |
| Savings Gauge | Y | Y | Single ring, animation, color coding |
| All other screens | Y | Y | Color palette consistency |

---

## 7. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Migration 016 backfill fails on corrupt data | Data loss | Wrap in transaction, validate before commit |
| Split expense creates orphaned hisaab entry | Inconsistent data | Database transaction for atomic creation |
| Derived plan shows wrong values | User confusion | Extensive unit tests for each component |
| Color refresh breaks screens with hardcoded hex | Visual regression | Grep for hardcoded values, screen-by-screen QA |
| Forecast matching false positives | User merges wrong expenses | Never auto-merge, always require user confirmation |

---

## 8. Version History

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-04-12 | Initial V1 TDD |
| 1.1 | 2026-04-13 | Updated: migration 017 (forecast_matching), forecast matching service (3.8), new components (ExpenseAccountRow, ExpenseMetadata), final implemented color palette, migration count 16→17, status to Complete |
