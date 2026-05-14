# Artha (अर्थ) — Version 2 Technical Design Document

**Version:** 2.0
**Date:** 2026-04-13
**Status:** Draft
**Predecessor:** V1 TDD at `docs/V1/TDD_V1.md`

---

## 1. Overview

V2 addresses 6 bugs and delivers 12 features. Technical changes include 4 new migrations (018-021), 2 new tables (merchant_aliases, tags + expense_tags junction), income tax computation services, merchant normalization pipeline, budget widget system, and an insights analytics layer.

**Schema version after V2:** 21 migrations (14 MVP + 3 V1 + 4 V2)
**Tables after V2:** 22 (18 MVP + 0 V1 new + 2 V2 new + expense_tags junction)

---

## 2. Schema Changes

### 2.1 Migration 018: salary_profile_nullable_plan

**Purpose:** Fix B2/B3 — salary profiles can't be created without a yearly plan.

**Approach:** SQLite doesn't support `ALTER TABLE ... ALTER COLUMN`. Must recreate table.

```sql
-- Step 1: Create new table with nullable yearly_plan_id
CREATE TABLE salary_profiles_new (
  id TEXT PRIMARY KEY,
  yearly_plan_id TEXT REFERENCES yearly_plans(id),  -- NOW NULLABLE
  financial_year TEXT,
  user_id TEXT REFERENCES users(id),
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
  expected_capital_gains REAL NOT NULL DEFAULT 0,
  expected_bonus REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Step 2: Copy data
INSERT INTO salary_profiles_new SELECT * FROM salary_profiles;

-- Step 3: Drop old
DROP TABLE salary_profiles;

-- Step 4: Rename
ALTER TABLE salary_profiles_new RENAME TO salary_profiles;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_salary_profiles_fy ON salary_profiles(user_id, financial_year);
```

---

### 2.2 Migration 019: income_calculator_v2

**Purpose:** Support draft saving and per-type capital gains.

```sql
ALTER TABLE salary_profiles ADD COLUMN status TEXT NOT NULL DEFAULT 'complete'
  CHECK(status IN ('draft','complete'));
ALTER TABLE salary_profiles ADD COLUMN capital_gains_equity_ltcg REAL NOT NULL DEFAULT 0;
ALTER TABLE salary_profiles ADD COLUMN capital_gains_equity_stcg REAL NOT NULL DEFAULT 0;
ALTER TABLE salary_profiles ADD COLUMN capital_gains_debt REAL NOT NULL DEFAULT 0;
ALTER TABLE salary_profiles ADD COLUMN capital_gains_fd REAL NOT NULL DEFAULT 0;
ALTER TABLE salary_profiles ADD COLUMN capital_gains_gold REAL NOT NULL DEFAULT 0;
ALTER TABLE salary_profiles ADD COLUMN capital_gains_real_estate REAL NOT NULL DEFAULT 0;
```

---

### 2.3 Migration 020: merchant_aliases

**Purpose:** Map raw SMS merchant names to clean canonical names.

```sql
CREATE TABLE merchant_aliases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  sms_name TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_merchant_aliases_lookup ON merchant_aliases(user_id, sms_name);
```

**Seed data** (inserted during migration for default user):
| sms_name | canonical_name |
|----------|---------------|
| ZOMATO LTD | Zomato |
| ZOMATO LIMITED | Zomato |
| AMAZON PAY WALL | Amazon Pay |
| AMAZON PAY IN R | Amazon Pay |
| AMAZON PAY IN E | Amazon Pay |
| PYU*Swiggy Food | Swiggy |
| CAS*Swiggy | Swiggy |
| PYU*Jubilant Fo | Domino's |
| BLINK COMMERCE | Blinkit |
| TATA PAYMENTS LIMITED | Tata Neu |
| NETFLIX | Netflix |
| STEAMGAMES | Steam |
| BOOKMYSHOW | BookMyShow |
| ZEPTO MARKETPLA | Zepto |
| UBER INDIA SYST | Uber |

---

### 2.4 Migration 021: tags

**Purpose:** Tags system for expenses.

```sql
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6B7280',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_tags_user_name ON tags(user_id, name);

CREATE TABLE expense_tags (
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (expense_id, tag_id)
);
CREATE INDEX idx_expense_tags_tag ON expense_tags(tag_id);
```

---

## 3. Service Layer Changes

### 3.1 Bug Fix Services

**CollapsibleSection.tsx — Animation Fix:**
- Replace `maxHeight: undefined` with measured height via `onLayout`
- Store measured height in ref, use for animation target
- Reset `heightProgress` on `expanded` state change

**Payment Mode Seeding:**
- New `seedDefaultPaymentModes(userId)` in `services/expense.ts`
- Default modes: Cash, UPI, Credit Card, Debit Card, Bank Transfer, Wallet, NACH
- Called in `app/_layout.tsx` after `seedDefaultCategories()`

**Split UX Overhaul (B4 — universal, intuitive, hisaab-linked):**

**New component: `components/expense/SplitSheet.tsx`**
Reusable bottom sheet used by ALL transaction entry points. Props:
```typescript
interface SplitSheetProps {
  visible: boolean;
  onClose: () => void;
  totalAmount: number;
  onConfirm: (splitConfig: SplitConfig) => void;
  existingExpenseId?: string;  // if splitting an existing expense
}

interface SplitConfig {
  paidBy: 'me' | string;         // 'me' or hisaab_person_id
  splitMode: 'equal' | 'they_owe_full' | 'i_owe_full' | 'exact' | 'percentage';
  participants: SplitParticipant[];
}

interface SplitParticipant {
  person_id: string;
  person_name: string;
  amount: number;     // computed share
  percentage?: number; // for percentage mode
}
```

**Where SplitSheet is wired:**
1. `app/expense/add.tsx` — "Split this expense?" toggle below amount, opens SplitSheet
2. `app/expense/[id].tsx` — "Split" action card (replace disabled placeholder), opens SplitSheet
3. `app/expense/review-queue.tsx` — "Split" option in approve action menu, opens SplitSheet
4. `app/hisaab/household.tsx` — replace old equal/pct/fixed UI with SplitSheet

**Updated service: `services/expense.ts`**

Replace old `createSplitExpense(input)` + `splitExistingExpense()` with unified:
```typescript
interface SplitExpenseInput {
  expense_id?: string;           // null for new expense, set for existing
  expense_data?: CreateExpenseInput; // for new expense creation
  paid_by: 'me' | string;       // 'me' or hisaab_person_id
  split_mode: 'equal' | 'they_owe_full' | 'i_owe_full' | 'exact' | 'percentage';
  participants: { person_id: string; amount: number }[];
  total_amount: number;
}

function splitExpense(input: SplitExpenseInput): Promise<{ expense_id: string; hisaab_entry_ids: string[] }>
```

**Split logic inside `splitExpense()`:**
1. Compute user's share based on `split_mode` + `paid_by`:
   - `equal`: `total / (participants.length + 1)` (include self)
   - `they_owe_full` + `paid_by='me'`: user keeps 0, full amount goes to hisaab debit
   - `i_owe_full` + `paid_by=person`: full amount goes to hisaab credit
   - `exact`: use provided amounts directly
   - `percentage`: compute from percentages
2. Create or update expense with user's share as amount
3. For each participant:
   - If `paid_by='me'`: create hisaab **debit** entry (they owe me)
   - If `paid_by=person_id`: create hisaab **credit** entry (I owe them)
4. Store bidirectional links: `expense.split_hisaab_entry_id` ↔ `hisaab_entries.linked_expense_id`
5. If participant person_id doesn't exist in hisaab yet → auto-create hisaab person record
6. All in a single database transaction

**Updated service: `services/hisaab.ts`**
- New `getEntryByLinkedExpense(expenseId)` — lookup hisaab entry from expense link
- New `getExpenseByLinkedEntry(entryId)` — lookup expense from hisaab link
- These enable bidirectional navigation in the UI

**"Paid for Family" — Review queue action:**
- In `app/expense/review-queue.tsx`: add "Paid for Family" button alongside Approve/Reject for SMS expenses
- On press: open simplified person picker (no split mode selection — always 100% to hisaab)
- Calls `splitExpense()` with `split_mode: 'they_owe_full'`, `paid_by: 'me'`
- Result: expense `amount=0`, hisaab debit entry for full amount

**Upcoming Dues Lifecycle (F13):**

**Updated service: `services/expense.ts`**

New function:
```typescript
async function markForecastAsPaid(forecastId: string): Promise<{ matchedExpenseId: string | null }> {
  // 1. Load forecast expense
  // 2. Search for matching realized expense:
  //    - Same account_id (if available)
  //    - Amount within ±5%
  //    - Date within ±7 days of forecast.due_date
  //    Uses existing findMatchingForecast() scoring logic (inverted — searching realized from forecast)
  // 3. If match found:
  //    - Set realized.matched_forecast_id = forecastId
  //    - Set forecast.status = 'rejected'
  //    - Return { matchedExpenseId: realized.id }
  // 4. If no match:
  //    - Set forecast.status = 'rejected'
  //    - Return { matchedExpenseId: null }
}
```

Existing functions already handle the other two actions:
- **Realise Now:** `realizeForecast(id, today)` — already exists at line 612-624, just needs UI wiring
- **Delete:** `UPDATE expenses SET status='rejected' WHERE id=?` — standard status update

**New component: `components/expense/ForecastActionBar.tsx`**
Reusable action bar for forecast expenses, used across 4 screens:
```typescript
interface ForecastActionBarProps {
  forecastId: string;
  onMarkAsPaid: () => void;
  onRealiseNow: () => void;
  onDelete: () => void;
  compact?: boolean;  // true for home/budget inline, false for detail screen
}
```

**Where ForecastActionBar is wired:**
1. `app/(tabs)/index.tsx` — Upcoming Dues card: swipe-left or long-press reveals actions
2. `app/(tabs)/budget.tsx` — Forecast list rows: compact inline buttons
3. `app/expense/review-queue.tsx` — "Upcoming" section: full action buttons per row
4. `app/expense/[id].tsx` — When viewing a forecast expense: action bar at bottom

### 3.2 Income Tax Services

**New file: `services/income-tax.ts`**

```typescript
interface BonusTaxResult {
  grossBonus: number;
  taxOnBonus: number;
  netBonus: number;
  effectiveRate: number;   // %
  slabRate: number;        // marginal slab %
}

function computeBonusTax(
  annualSalaryIncome: number,
  bonusAmount: number,
  taxRegime: 'new' | 'old'
): BonusTaxResult

interface CapitalGainsInput {
  equity_ltcg: number;
  equity_stcg: number;
  debt: number;
  fd: number;
  gold: number;
  real_estate: number;
}

interface CapitalGainsTaxResult {
  perType: Record<string, { gross: number; tax: number; net: number; rate: string }>;
  totalGross: number;
  totalTax: number;
  totalNet: number;
}

function computeCapitalGainsTax(
  gains: CapitalGainsInput,
  totalIncome: number,     // needed for slab-rate types (debt, FD)
  taxRegime: 'new' | 'old'
): CapitalGainsTaxResult
```

**Tax slab rates** (FY 2025-26):

New Regime:
| Income Slab | Rate |
|------------|------|
| 0 - 4L | 0% |
| 4L - 8L | 5% |
| 8L - 12L | 10% |
| 12L - 16L | 15% |
| 16L - 20L | 20% |
| 20L - 24L | 25% |
| Above 24L | 30% |

Old Regime:
| Income Slab | Rate |
|------------|------|
| 0 - 2.5L | 0% |
| 2.5L - 5L | 5% |
| 5L - 10L | 20% |
| Above 10L | 30% |

Plus 4% Health & Education Cess on total tax.

### 3.3 Salary Profile Service Updates

**Updated `services/salary-profile.ts`:**
- Add `status` field to interface + CRUD
- Add 6 capital gains columns to interface + CRUD
- New `getSalaryProfileDrafts(userId)` — returns profiles with status='draft'
- Update `createSalaryProfile()` to handle nullable yearly_plan_id

### 3.4 Merchant Normalization Service

**New file: `services/merchant-alias.ts`**

```typescript
function normalizeMerchantName(userId: string, rawName: string): Promise<string>
function getAliases(userId: string): Promise<MerchantAlias[]>
function createAlias(userId: string, smsName: string, canonicalName: string, categoryId?: string): Promise<string>
function updateAlias(id: string, canonicalName: string, categoryId?: string): Promise<void>
function deleteAlias(id: string): Promise<void>
function learnFromUserEdit(userId: string, originalName: string, editedName: string): Promise<void>
```

**Normalization pipeline (in `normalizeMerchantName`):**
1. Strip known prefixes: `PYU*`, `CAS*`, `InfoEBA*`, `BILL*`
2. Trim whitespace
3. Case-insensitive lookup in merchant_aliases
4. If found: return canonical_name
5. If not: return cleaned raw name

**Wire into sms-to-expense.ts:**
- After parsing SMS, before creating expense: `merchant_name = await normalizeMerchantName(userId, parsed.merchant)`

### 3.5 Tags Service

**New file: `services/tags.ts`**

```typescript
interface Tag {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
}

function getTags(userId: string): Promise<Tag[]>
function getTagsForExpense(expenseId: string): Promise<Tag[]>
function createTag(userId: string, name: string, color?: string): Promise<string>
function findOrCreateTag(userId: string, name: string): Promise<Tag>
function addTagToExpense(expenseId: string, tagId: string): Promise<void>
function removeTagFromExpense(expenseId: string, tagId: string): Promise<void>
function updateTag(id: string, updates: { name?: string; color?: string }): Promise<void>
function deleteTag(id: string): Promise<void>
function getTagUsageCount(tagId: string): Promise<number>
```

### 3.6 Account Type Detection Updates

**Updated `services/sms/bank-patterns.ts`:**
- Every pattern explicitly sets `accountType` based on keywords:
  - `Card` / `Card no.` → `credit_card`
  - `A/c no.` / `Acc` → `savings`
  - `Loan A/c` → `loan`
  - `Wallet` → `wallet`
- New helper: `detectAccountTypeFromKeywords(smsBody: string): AccountType | null`

**Updated `services/financial-account.ts`:**
- `inferAccountType()` prefers explicit parsed value over heuristic
- Fallback to null (not "savings") if unknown

**UPI P2M/P2A detection in bank-patterns.ts:**
- Parse UPI ref string: split by `/`
- Index 1: `P2M` or `P2A`
- Index 3: merchant/person name
- Set `type` accordingly on ParsedSMS

### 3.7 Insights Analytics Services

**New file: `services/insights.ts`**

```typescript
// Merchant detail
function getMerchantDetail(userId: string, merchantName: string, dateRange: DateRange): Promise<MerchantDetail>
// { transactions: Expense[], monthlyTrend: MonthAmount[], totalSpend: number, avgAmount: number, categories: CategorySplit[] }

// Account analytics
function getAccountAnalytics(userId: string, dateRange: DateRange): Promise<AccountAnalytics>
// { accounts: AccountSpend[], monthlyByAccount: Record<string, MonthAmount[]> }

// Payment mode trend
function getPaymentModeTrend(userId: string, dateRange: DateRange): Promise<PaymentModeTrend>
// { modes: ModeSpend[], monthlyByMode: Record<string, MonthAmount[]> }

// Right-spend trend
function getRightSpendTrend(userId: string, months: number): Promise<RightSpendTrend>
// { monthly: { month: string, rightPct: number }[], categories: { name: string, avoidableAmount: number }[] }

// Monthly comparison
function getMonthlyComparison(userId: string, month1: string, month2: string): Promise<MonthComparison>
// { month1: MonthSummary, month2: MonthSummary, changes: ChangeItem[] }
```

---

## 4. New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `SplitSheet` | `components/expense/SplitSheet.tsx` | Universal split bottom sheet — who paid, how to split, person picker, live preview |
| `ForecastActionBar` | `components/expense/ForecastActionBar.tsx` | Lifecycle actions for forecasts: Mark as Paid, Realise Now, Delete |
| `WidgetCard` | `components/ui/WidgetCard.tsx` | Collapsible + removable widget wrapper |
| `ErrorBanner` | `components/ui/ErrorBanner.tsx` | Inline error display with specific message |
| `TagChip` | `components/ui/TagChip.tsx` | Colored tag pill for expense detail/list |
| `TagPicker` | `components/expense/TagPicker.tsx` | Autocomplete tag selector with create option |
| `DateRangePicker` | `components/ui/DateRangePicker.tsx` | From/To date selector for SMS scan + insights |
| `InsightCard` | `components/insights/InsightCard.tsx` | Preview card for insights hub |

---

## 5. New Screens

| Screen | Route | Purpose |
|--------|-------|---------|
| `app/insights/_layout.tsx` | /insights | Insights section layout |
| `app/insights/index.tsx` | /insights | Insights hub with preview cards |
| `app/insights/merchants.tsx` | /insights/merchants | Merchant analytics + detail |
| `app/insights/accounts.tsx` | /insights/accounts | Account analytics |
| `app/insights/payment-methods.tsx` | /insights/payment-methods | Payment method analytics |
| `app/insights/right-spend.tsx` | /insights/right-spend | Right-spend trends |
| `app/insights/monthly-comparison.tsx` | /insights/monthly-comparison | Month-over-month comparison |
| `app/settings/merchant-aliases.tsx` | /settings/merchant-aliases | Merchant alias management |
| `app/settings/tags.tsx` | /settings/tags | Tag management |

---

## 6. Updated Files Summary

### Phase 0 (Bug Fixes)
| File | Change |
|------|--------|
| `components/ui/CollapsibleSection.tsx` | Fix animation state, use measured height |
| `database/migrations/018_salary_profile_nullable_plan.ts` | NEW — recreate table with nullable FK |
| `database/migrations/index.ts` | Register 018-021 |
| `app/_layout.tsx` | Seed default payment modes |
| `components/expense/SplitSheet.tsx` | NEW — universal split bottom sheet (who paid, split mode, person picker, preview) |
| `services/expense.ts` | Replace old split functions with unified `splitExpense()` |
| `services/hisaab.ts` | Add `getEntryByLinkedExpense()`, `getExpenseByLinkedEntry()` for bidirectional nav |
| `app/expense/[id].tsx` | Wire SplitSheet to "Split" action card (replace placeholder) |
| `app/expense/add.tsx` | Replace old percentage-only split UI with SplitSheet |
| `app/expense/review-queue.tsx` | Add "Split" option in approve action menu, opens SplitSheet |
| `app/hisaab/household.tsx` | Replace old equal/pct/fixed split UI with SplitSheet |
| `app/(tabs)/index.tsx` | Remove FadeInDown animations |
| `app/(tabs)/budget.tsx` | Remove FadeInDown animations |
| `assets/images/android-icon-foreground.png` | Resize icon with proper padding |
| `app.json` | Update splash config |

### Phase 1 (Income Calculator)
| File | Change |
|------|--------|
| `database/migrations/019_income_calculator_v2.ts` | NEW — status + CG columns |
| `services/income-tax.ts` | NEW — bonus tax + CG tax computation |
| `services/salary-profile.ts` | Add status, CG fields, nullable yearly_plan_id |
| `app/goals/salary-calculator.tsx` | Complete layout rework, draft saving (see layout spec below) |

**Salary Calculator Layout Rework (`app/goals/salary-calculator.tsx`):**

Current order: CTC Input → EPF → Deductions → In-Hand Hero → CTC Breakdown → EPF → **Tax Comparison** → Regime Summary → Annual Deductions → Additional Income → Total

New order (Income → Deductions → Calculations → Tax last):
1. **Income section:** FY picker → Mode toggle → CTC/Direct input → Additional Income (bonus + per-type capital gains) — all inputs grouped together
2. **Settings & Deductions:** EPF & Settings (collapsible) → Old Regime Deductions (collapsible)
3. **Calculations:** Monthly In-Hand Hero → CTC Breakdown → EPF Contributions → Annual Deductions Summary
4. **Tax Comparison (moved to end):** New/Old regime tabs → Regime side-by-side summary
5. **Grand Total & Actions:** Post-tax salary + bonus + CG total → Save / Save as Draft buttons

Key changes:
- Move `Additional Income` card UP from after results to right after CTC/Direct input (keep inside respective mode block)
- Move `Tax Comparison` card + `Regime Summary` card DOWN to after `Annual Deductions`
- Add collapsible wrappers (using `CollapsibleSection`) around EPF Settings, Old Regime Deductions, and Additional Income sections
- Wire draft save: new "Save as Draft" button alongside existing "Use in Plan" button

### Phase 2 (UX)
| File | Change |
|------|--------|
| `components/ui/WidgetCard.tsx` | NEW — collapsible + removable widget |
| `components/ui/ErrorBanner.tsx` | NEW — inline error display |
| `app/(tabs)/budget.tsx` | Widget system, scrollable |
| `app/(tabs)/expenses.tsx` | Pending review redesign |
| `app/expense/review-queue.tsx` | Grouped, batch actions, filters |
| `app/(tabs)/settings.tsx` | SMS custom date range |
| `app/goals/investment-detail.tsx` | Remove CG tax rates |
| `components/expense/ForecastActionBar.tsx` | NEW — forecast lifecycle actions (Mark as Paid / Realise Now / Delete) |
| `services/expense.ts` | Add `markForecastAsPaid()` — search matching realized, link or reject |
| `app/(tabs)/index.tsx` | Wire ForecastActionBar to Upcoming Dues card (swipe/long-press) |
| `app/(tabs)/budget.tsx` | Wire ForecastActionBar to forecast list rows (compact inline) |
| `app/expense/[id].tsx` | Wire ForecastActionBar when viewing a forecast expense |

### Phase 3 (SMS/Data)
| File | Change |
|------|--------|
| `services/sms/bank-patterns.ts` | Account type keywords, UPI P2M/P2A |
| `services/financial-account.ts` | Remove savings fallback |
| `database/migrations/020_merchant_aliases.ts` | NEW — merchant_aliases table |
| `services/merchant-alias.ts` | NEW — normalization pipeline |
| `services/sms/sms-to-expense.ts` | Wire merchant normalization |
| `app/(tabs)/expenses.tsx` | Account filter |
| `app/settings/merchant-aliases.tsx` | NEW — alias management |

### Phase 4 (Tags)
| File | Change |
|------|--------|
| `database/migrations/021_tags.ts` | NEW — tags + expense_tags |
| `services/tags.ts` | NEW — tag CRUD |
| `components/ui/TagChip.tsx` | NEW — tag display |
| `components/expense/TagPicker.tsx` | NEW — tag autocomplete |
| `app/expense/[id].tsx` | Replace receipt with tags |
| `app/expense/add.tsx` | Add tag selector |
| `app/settings/tags.tsx` | NEW — tag management |
| `app/(tabs)/expenses.tsx` | Tag filter |

### Phase 5 (Insights)
| File | Change |
|------|--------|
| `services/insights.ts` | NEW — analytics queries |
| `app/insights/_layout.tsx` | NEW |
| `app/insights/index.tsx` | NEW — hub |
| `app/insights/merchants.tsx` | NEW |
| `app/insights/accounts.tsx` | NEW |
| `app/insights/payment-methods.tsx` | NEW |
| `app/insights/right-spend.tsx` | NEW |
| `app/insights/monthly-comparison.tsx` | NEW |

---

## 7. Testing Strategy

| Area | Test Type | Count (est) |
|------|----------|-------------|
| Migration 018-021 | Integration | 8 |
| Bonus tax computation | Unit | 6 |
| Capital gains tax | Unit | 10 |
| Merchant normalization | Unit | 8 |
| Tags CRUD | Integration | 10 |
| Account type detection | Unit | 12 |
| UPI P2M/P2A | Unit | 4 |
| Insights queries | Integration | 10 |
| Budget widgets | Unit | 4 |

**Estimated new tests:** ~72
**Total after V2:** ~916 tests

---

## 8. Version History

| Version | Date | Change |
|---------|------|--------|
| 2.0 | 2026-04-13 | Initial V2 TDD — 4 migrations, 2 new tables, 9 new screens, 6 new components |
