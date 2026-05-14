# Artha (अर्थ) — Version 1 Product Requirements Document

**Version:** 1.0
**Author:** Sourav Baid
**Date:** 2026-04-12
**Status:** Complete (all 12 features implemented)
**Predecessor:** MVP PRD at `docs/MVP/PRD.md`

---

## 1. Executive Summary

Version 1 transforms Artha from a functional expense tracker into a polished personal finance app. The focus is on three pillars:

1. **Richer expense data** — Merchant-first experience, Axio-level expense detail, expense splitting with hisaab
2. **Smarter financial planning** — Auto-derived yearly plans, multi-year milestone spreading, forecast-to-realized workflows
3. **Modern design** — Lighter Notion-inspired palette, collapsible sections, reduced visual clutter

**MVP delivered:** 67 tasks, 802 tests, 18 tables, 14 migrations, full expense/budget/goals/hisaab/SMS pipeline.

**V1 delivers:** 12 features (F1-F12), 42 tasks, 3 new migrations (015-017), updated services and screens.

---

## 2. Features

### F1: Expense Split to Hisaab

**Problem:** When splitting a dinner or grocery bill with family, users must manually create both an expense and a hisaab entry. The amounts are often inconsistent.

**Solution:** Add an optional "Split with someone?" toggle on the Add Expense screen. The user enters the total amount, picks a hisaab person, and sets the split percentage (default 50%). The system creates the expense (user's share) and the hisaab entry (their share) atomically.

**User flow:**
1. Open Add Expense
2. Enter total amount (e.g., Rs. 1,000)
3. Toggle "Split with someone?" → ON
4. Select person from hisaab contacts
5. Set split: 50% (slider or input, range 0-100%)
6. See live preview: "Your share: Rs. 500 / Their share: Rs. 500"
7. Save → expense created for Rs. 500, hisaab debit entry for Rs. 500

**Edge cases:**
- Split 100-0: full amount in hisaab, Rs. 0 expense (skip expense creation, create only hisaab entry)
- Split 0-100: full expense, no hisaab entry (same as normal expense)
- Odd amounts: Rs. 101 at 50% → Rs. 50.50 each (round to 2 decimal places)
- Edit split %: recalculates both expense and hisaab entry
- Delete expense: also deletes linked hisaab entry (with confirmation)
- Remove split: restores expense to original amount, deletes hisaab entry

**Data changes (Migration 015):**
- New columns on `expenses`: `merchant_name`, `split_original_amount`, `split_person_id`, `split_pct`, `split_hisaab_entry_id`

---

### F2: Splash Screen Readable Duration

**Problem:** The splash screen disappears too quickly — users can't read "Artha (अर्थ)" and the tagline before the main app loads.

**Solution:** Add a minimum 2.5-second splash duration. The splash screen stays visible until BOTH the database is ready AND the timer completes.

**Implementation:** Single `setTimeout(2500)` state flag ANDed with `dbReady`.

---

### F3: Goals Rework — Auto-Derived Plan

**Problem:** The yearly plan requires manual entry of income, expenses, investments, and milestones — but all of these already exist as separate entities in the app. The plan is a redundant copy.

**Solution:** Make the yearly plan auto-derived:
- **Income** = salary profile (monthly in-hand x 12) + expected bonus + expected capital gains
- **Investments** = SUM of investment bucket annual targets for that FY
- **Milestones** = SUM of milestone contributions spread across FYs
- **Expenses** = annualized from monthly budgets

The yearly plan screen becomes a read-only dashboard. The only editable field is the savings rate target %.

**Key changes:**
- Investment buckets tagged by financial year (not yearly plan)
- Salary profiles tagged by financial year (not yearly plan)
- Life milestones get a start FY and duration (years) for multi-year spreading
- Goals tab shows guided setup (set income → add investments → add milestones) instead of "Create Plan"
- Yearly plan screen is read-only summary with "Edit" links to component screens

**Multi-year milestone spreading example:**
- Milestone: "Buy car" — Rs. 10,00,000, start FY 2026-27, duration 3 years
- FY 2026-27 contribution: Rs. 3,33,333
- FY 2027-28 contribution: Rs. 3,33,333
- FY 2028-29 contribution: Rs. 3,33,334

---

### F4: Savings Gauge Chart Fix

**Problem:** The current savings gauge uses a 20-segment arc that looks cluttered and is hard to read.

**Solution:** Replace with a clean single animated ring:
- Track arc (light gray)
- Fill arc (green if actual >= target, red if below)
- Center: large percentage + "of X% target"
- Below: "Saved Rs. X" and "Target Rs. Y"
- Animated fill on mount using react-native-svg or reanimated

---

### F5: Forecast-to-Realised Smart Workflow

**Problem:** When an SMS creates a forecast expense (e.g., "EMI reminder: Rs. 15,000 due on April 5") and later the actual debit SMS arrives, both appear in the review queue as separate items. The user must manually figure out which forecast matches which transaction.

**Solution:** Auto-match forecasts to realized expenses:
- **Match criteria:** Same `account_id` + amount within 5% tolerance + `due_date` within 7 days of actual date
- **Confidence scoring:** 0-100 score based on match quality (exact amount = higher, closer date = higher)
- **Never auto-merge:** Always surface matched pairs in review queue for user confirmation
- **3 actions per pair:** Realise (convert forecast), Already Captured (dismiss forecast), Both Different (keep both)
- **Overdue handling:** Forecasts past due_date get "Overdue" badge, with bulk dismiss option

**Data changes:**
- New column on `expenses`: `matched_forecast_id TEXT REFERENCES expenses(id)` — links a realized expense to its matched forecast (Migration 017)

---

### F6: Axio-Inspired Expense Detail & Metadata

**Problem:** The expense detail screen is basic — just editable fields. It doesn't show the rich context that exists in the data (bank account, raw SMS, refund links, split info).

**Solution:** Redesign expense detail following Axio's pattern:

1. **Hero card:** Merchant name (or description fallback) as title, large amount with debit arrow, category badge, formatted date+time
2. **Account row:** Bank name + card type + last 4 digits (e.g., "ICICI CREDIT 3001")
3. **Editable fields:** Category picker, payment mode, right spend toggle, description/notes
4. **Actions row:** "Split with Hisaab" card + "Attach receipt" placeholder
5. **Other Info (collapsible):**
   - Source: Manual / SMS Auto / Email Auto
   - Nature: Realized / Forecast (with due_date)
   - Created timestamp
   - Raw SMS text (expandable)
   - Refund link (if refund_of_expense_id exists)
   - Split info (person name, split %, their share)

**Expense list change:** Merchant name as primary label, description as subtitle.

---

### F7: Color Scheme Refresh (Lighter, Notion-inspired)

**Problem:** The current deep blue palette feels heavy. Modern finance apps (Axio, Notion) use lighter, warmer palettes.

**Solution (Implemented):**

Light mode palette:
```
background: #FFFFFF (pure white)
surface: #F7F7F5 (warm gray, Notion-like)
text-primary: #1A1A1A (near-black)
text-secondary: #6B7280 (cool gray)
text-tertiary: #9CA3AF
border: #E5E5E3 (warm light border)
tint: #2563EB (blue — chosen over teal for trust/professionalism)
icon: #6B7280
tab-icon-default: #9CA3AF
tab-icon-selected: #2563EB
```

Primary blue scale (Tailwind blue anchored at #2563EB):
```
50: #EFF6FF, 100: #DBEAFE, 200: #BFDBFE, 300: #93C5FD, 400: #60A5FA
500: #3B82F6, 600: #2563EB, 700: #1D4ED8, 800: #1E40AF, 900: #1E3A8A
```

Dark mode palette:
```
background: #111111 (near-black)
surface: #1E1E1E
text: #FFFFFF
text-secondary: #A0A0A0
border: #2E2E2E
tint: #60A5FA (primary-400 for dark contrast)
icon: #A0A0A0
tab-icon-default: #6B7280
tab-icon-selected: #60A5FA
```

Semantic/budget colors:
```
success/under: #16A34A, danger/over: #DC2626, warning: #D97706
```

Card shadow softened (iOS): opacity 0.04, radius 4. Android: elevation 1.

**Approach:** Updated `constants/theme.ts` and `tailwind.config.js`. ~250 hardcoded hex refs replaced across 40+ files. rgba() values in goals STATUS_CONFIG updated. SectionHeader spacing increased (mb-3). Home screen card spacing increased for breathing room.

---

### F8: Merchant Bucketing + Payment Details

**Problem:** Merchant name is extracted from SMS but only embedded in the description text — it's not a queryable field. Users can't filter or group by merchant.

**Solution:**
- Add `merchant_name` as a first-class column on expenses
- SMS parser writes `parsed.merchant` to this column
- Manual expense form gets optional "Merchant" text input
- Expense list shows merchant name prominently (primary label)

**Future (not V1):** Merchant analytics tab, favorite merchants, visit count.

---

### F9: Remove "Load My Financial Data"

**Problem:** The "Load My Financial Data" option in Settings was for development seed data. It shouldn't be in the production app.

**Solution:** Remove the seed picker UI from settings. Keep `services/seed-data.ts` (useful for testing).

---

### F10: Review Queue on Expenses Page

**Problem:** Users must navigate to a separate Review Queue screen to approve auto-detected expenses. This adds friction.

**Solution:** Add a collapsible "Pending Review ({count})" section at the top of the Expenses tab. Uses existing ReviewQueueItem component with swipe-to-approve/reject. Auto-expands when items exist, collapses when empty.

---

### F11: Budget Collapsible Sections + Upcoming Dues on Home

**Problem:** The budget screen shows too much data at once — summary, projection, upcoming dues, category list. It's overwhelming.

**Solution:**
- Wrap summary, projection, and upcoming dues in collapsible sections (animated)
- Default: summary expanded, projection collapsed, upcoming dues collapsed
- Persist collapse states in MMKV

**Home screen addition:** "Upcoming Dues" card showing approved/pending forecast expenses with due dates. Shows count, total amount, next due date, per-item bank card details. "Overdue" badge for past-due items.

---

### F12: Income Calculator Enhancements

**Problem:**
1. EPF labels are confusing: "Restricted" and "Full Basic" aren't clear
2. Income calculator doesn't capture capital gains or bonus — these are significant income sources
3. Calculator isn't tied to a financial year

**Solution:**
- Label changes: "Restricted" → "Minimum (15K)", "Full Basic" → "12% of Basic Pay"
- New "Additional Income" section: Expected Annual Bonus (Rs. input), Expected Capital Gains (Rs. input)
- FY selector at top: which financial year is this income for?
- Total Income display: Monthly In-Hand x 12 + Bonus + Capital Gains
- Save to salary_profiles with `financial_year`, `user_id`, `expected_bonus`, `expected_capital_gains`

---

## 3. Updated Data Model

### 3.1 Expense (Updated)

| Field | Type | New in V1? | Notes |
|-------|------|-----------|-------|
| id | TEXT PK | | UUID |
| user_id | TEXT FK | | References users |
| amount | REAL | | In INR (user's share if split) |
| currency | TEXT | | Default "INR" |
| fx_rate | REAL | | Nullable |
| description | TEXT | | Nullable |
| **merchant_name** | **TEXT** | **Yes** | **Merchant from SMS or manual input** |
| category_id | TEXT FK | | References categories |
| payment_mode_id | TEXT FK | | References payment_modes |
| date | TEXT | | YYYY-MM-DD |
| is_right_spend | INTEGER | | 1 = necessary, 0 = avoidable |
| source | TEXT | | manual / sms_auto / email_auto |
| status | TEXT | | approved / pending_review / rejected |
| nature | TEXT | | realized / forecast |
| due_date | TEXT | | For forecast expenses |
| account_id | TEXT FK | | References financial_accounts |
| refund_of_expense_id | TEXT FK | | References expenses (self) |
| raw_source_text | TEXT | | Full SMS body |
| **split_original_amount** | **REAL** | **Yes** | **Total before split** |
| **split_person_id** | **TEXT FK** | **Yes** | **References hisaab_persons** |
| **split_pct** | **REAL** | **Yes** | **User's split % (0-100)** |
| **split_hisaab_entry_id** | **TEXT FK** | **Yes** | **References hisaab_entries** |
| **matched_forecast_id** | **TEXT FK** | **Yes** | **References expenses(id) — links realized expense to matched forecast** |
| created_at | TEXT | | ISO timestamp |
| updated_at | TEXT | | ISO timestamp |

### 3.2 Investment Bucket (Updated)

| Field | Type | New in V1? | Notes |
|-------|------|-----------|-------|
| id | TEXT PK | | UUID |
| yearly_plan_id | TEXT FK | | Keep for backward compat |
| **financial_year** | **TEXT** | **Yes** | **e.g., "2026-27"** |
| **user_id** | **TEXT FK** | **Yes** | **References users** |
| name | TEXT | | e.g., "ELSS", "PPF" |
| annual_target | REAL | | Target for this FY |
| current_contributed | REAL | | Running total |
| linked_milestone_id | TEXT FK | | Optional link to milestone |
| sort_order | INTEGER | | Display order |
| is_active | INTEGER | | 1 = active |

### 3.3 Salary Profile (Updated)

| Field | Type | New in V1? | Notes |
|-------|------|-----------|-------|
| id | TEXT PK | | UUID |
| yearly_plan_id | TEXT FK | | Keep for backward compat |
| **financial_year** | **TEXT** | **Yes** | **e.g., "2026-27"** |
| **user_id** | **TEXT FK** | **Yes** | **References users** |
| input_mode | TEXT | | "ctc" / "direct" |
| annual_ctc | REAL | | If CTC mode |
| basic_pct | REAL | | % of CTC |
| hra_pct | REAL | | % of basic |
| is_metro | INTEGER | | For HRA calc |
| epf_mode | TEXT | | "full_basic" / "restricted" |
| epf_in_ctc | INTEGER | | 1 = EPF included in CTC |
| vpf_monthly | REAL | | Voluntary PF |
| tax_regime | TEXT | | "new" / "old" |
| professional_tax_annual | REAL | | State PT |
| state | TEXT | | For state-specific PT |
| deductions_80c | REAL | | ELSS/PPF etc. |
| deductions_80d | REAL | | Health insurance |
| hra_exemption_annual | REAL | | HRA tax exemption |
| home_loan_interest | REAL | | Sec 24 |
| other_deductions | REAL | | Other |
| computed_monthly_in_hand | REAL | | Calculated |
| computed_annual_tax | REAL | | Calculated |
| **expected_capital_gains** | **REAL** | **Yes** | **Annual capital gains** |
| **expected_bonus** | **REAL** | **Yes** | **Annual bonus** |
| created_at | TEXT | | ISO timestamp |
| updated_at | TEXT | | ISO timestamp |

### 3.4 Life Milestone (Updated)

| Field | Type | New in V1? | Notes |
|-------|------|-----------|-------|
| id | TEXT PK | | UUID |
| user_id | TEXT FK | | References users |
| name | TEXT | | e.g., "Buy car" |
| target_amount | REAL | | Total goal |
| current_saved | REAL | | Running total |
| target_date | TEXT | | Aspirational date |
| priority | TEXT | | high / medium / low |
| notes | TEXT | | |
| is_completed | INTEGER | | |
| **start_financial_year** | **TEXT** | **Yes** | **FY when saving starts** |
| **duration_years** | **INTEGER** | **Yes** | **Default 1, spread target across FYs** |
| created_at | TEXT | | |
| updated_at | TEXT | | |

---

## 4. Design Reference

### Axio Patterns Adopted

| Pattern | Axio | Artha V1 |
|---------|------|----------|
| Transaction list | Merchant-first rows, category icon, amount right-aligned | Same: merchant as primary label, description as subtitle |
| Expense detail hero | Merchant title, large amount, category badge, datetime | ExpenseHeroCard component with same layout |
| Account row | Bank logo + "ICICI CREDIT 3001" + Expense toggle | Bank icon + account string from financial_accounts |
| Split + Attach | Two action cards side by side | Split with Hisaab + Attach receipt (placeholder) |
| Other info | Source, UPI ref, raw SMS | Source badge, nature, created, raw SMS, refund link, split info |
| Dues & Reminders | Bank card details with upcoming payments | Upcoming Dues card on home screen from forecast expenses |

### Not Adopted in V1 (Future)
- Merchant analytics tab (needs data accumulation)
- Favorite merchants with visit count
- Tags/labels on expenses
- Receipt photo attachment (needs camera/storage permissions)
- Monthly bar chart on transactions view

---

## 5. Migrations Summary

| Migration | Name | What It Does |
|-----------|------|-------------|
| 015 | `expense_merchant_split` | Adds `merchant_name`, `split_original_amount`, `split_person_id`, `split_pct`, `split_hisaab_entry_id` to expenses. Indexes on merchant_name and split_person_id. |
| 016 | `goals_v1_restructure` | Adds `financial_year`, `user_id` to investment_buckets and salary_profiles. Adds `start_financial_year`, `duration_years` to life_milestones. Adds `expected_capital_gains`, `expected_bonus` to salary_profiles. Backfills FY/user from yearly_plans. Indexes on FY columns. |
| 017 | `forecast_matching` | Adds `matched_forecast_id` to expenses (self-referencing FK). Index on matched_forecast_id. |

---

## 6. Version History

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-04-12 | Initial V1 PRD with 12 features |
| 1.1 | 2026-04-13 | Updated: matched_forecast_id in data model, migration 017, final F7 color palette, status to Complete |
