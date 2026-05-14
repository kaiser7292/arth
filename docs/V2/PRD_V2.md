# Artha (अर्थ) — Version 2 Product Requirements Document

**Version:** 2.0
**Author:** Sourav Baid
**Date:** 2026-04-13
**Status:** Draft
**Predecessor:** V1 PRD at `docs/V1/PRD_V1.md`

---

## 1. Executive Summary

Version 2 transforms Artha from a feature-complete tracker into a polished, insight-driven personal finance app. The focus is on four pillars:

1. **Fix what's broken** — Collapsible sections, SMS scan errors, salary save failures, split button, icon sizing
2. **Smarter income calculator** — Bonus taxed at slab rate, comprehensive capital gains tax, layout rework, draft saving
3. **Better data quality** — Card vs account detection from SMS, merchant identification, UPI P2M/P2A distinction, tags
4. **Actionable insights** — Merchant analytics, account filtering, payment method views, right-spend trends

**V1 delivered:** 42 tasks, 844 tests, 17 migrations, 12 features (F1-F12).

**V2 delivers:** ~52 tasks across 7 phases, 4 new migrations (018-021), bug fixes + 14 features.

---

## 2. Bug Fixes

### B1: Collapsible Sections Don't Reopen

**Problem:** On the budget page, once a CollapsibleSection (budget summary, month-end projection, upcoming dues) is collapsed, it cannot be reopened. The section appears frozen.

**Root Cause:** `heightProgress` shared value in `CollapsibleSection.tsx` doesn't reset properly on component remount. `maxHeight` is set to `undefined` during expand animation, which collapses to 0.

**Fix:**
- Reinitialize animation shared value on mount
- Use explicit measured content height (not `undefined`) during expand
- Ensure `shouldRender` state stays true during collapse animation
- Test: collapse → reopen → collapse → reopen cycle works consistently

---

### B2: SMS Scan Foreign Key Error on First Run

**Problem:** First SMS scan throws "Call to function NativeStatement.finalizeAsync rejected → caused by → foreign key constraint failed". Second run works.

**Root Cause:** `yearly_plan_id TEXT NOT NULL REFERENCES yearly_plans(id)` on salary_profiles table. On first run, referenced records may not exist yet. Payment modes aren't seeded at startup.

**Fix:**
- Migration 018: Make `yearly_plan_id` nullable on salary_profiles (already has `financial_year` + `user_id` from V1)
- Seed default payment modes during app initialization (like categories are already seeded)
- Add defensive null checks in sms-to-expense.ts for all FK references

---

### B3: "Failed to Save Salary Data" Error

**Problem:** Income calculator shows "Failed to save salary data" when saving without an existing yearly plan.

**Root Cause:** Same FK constraint as B2 — `yearly_plan_id NOT NULL` prevents salary profile creation when no yearly plan exists.

**Fix:** Same migration as B2 (make nullable). Also:
- Show specific error reason in alert (not generic "Failed to save")
- Validate inputs before attempting save

---

### B4: Split UX Overhaul — Universal, Intuitive, Hisaab-Linked

**Problem (original):** "Split with Hisaab" button on expense detail is a non-functional placeholder (`opacity-50`, no `onPress`). But the deeper problem is the split UX itself — the current percentage-based approach (25/50/75/custom %) requires mental math and doesn't match how people think about shared expenses.

**Current split is only available on:** `app/expense/add.tsx` (manual add). Missing from: expense detail (B4 placeholder), SMS review queue approval, household expenses in hisaab.

**Root Causes:**
1. Button in `[id].tsx` has no `onPress` handler — placeholder
2. Split UX is percentage-only — unintuitive for common scenarios
3. Split only available during manual expense creation, not on SMS-detected expenses or existing expenses
4. No automatic hisaab linkage when splitting outside the family ledger screen

**Fix — Complete Split Rework:**

**New Split UX (Splitwise-inspired, simpler):**

```
Step 1: WHO PAID?
  ● "I paid" (default — most common)
  ○ "{Person name} paid" (they covered it, I owe them)

Step 2: HOW TO SPLIT?
  ● "Split equally" (default — 50-50 or 1/n)
  ○ "They owe full amount" (I paid for them entirely)
  ○ "I owe full amount" (they paid for me entirely)
  ○ "By exact amounts" (enter ₹ per person — e.g., I: ₹700, They: ₹300)
  ○ "By percentage" (advanced — keep for power users)

Step 3: WITH WHOM?
  Person picker from hisaab contacts (supports multi-person)
  + "Add new person" inline option

Step 4: LIVE PREVIEW
  "You: ₹500 / Priya: ₹500"
  Amounts editable inline for "exact amounts" mode
```

**Universal availability — split must be available at ALL transaction entry points:**

| Entry Point | File | How Split Appears |
|-------------|------|-------------------|
| Manual expense add | `app/expense/add.tsx` | "Split this expense?" toggle below amount → opens split sheet |
| Expense detail (existing expense) | `app/expense/[id].tsx` | "Split" action card → opens split sheet |
| SMS review queue (approve action) | `app/expense/review-queue.tsx` | "Split" option in approve action menu |
| Household expense | `app/hisaab/household.tsx` | Unify with same split component (replace old equal/pct/fixed) |

**Automatic hisaab linkage (critical requirement):**

When a user splits ANY expense (manual, SMS-detected, or existing) with a person who exists in their hisaab family ledger:
1. The split **automatically creates a hisaab debit/credit entry** for the other person's share
2. The expense record stores `split_hisaab_entry_id` linking back to the hisaab entry
3. The hisaab entry stores `linked_expense_id` linking back to the expense
4. **Bidirectional**: viewing the expense shows "Split with Priya (₹500)" → tap navigates to hisaab entry. Viewing the hisaab entry shows "From: Dinner at Zomato" → tap navigates to expense.
5. If the person doesn't exist in hisaab yet, prompt "Add {name} to family ledger?" before creating the split

**Direction logic (who paid → debit or credit):**
- "I paid" + split → hisaab **debit** entry (they owe me their share)
- "{Person} paid" + split → hisaab **credit** entry (I owe them my share)

**Shared component:** Extract split UI into `components/expense/SplitSheet.tsx` — a reusable bottom sheet used by all 4 entry points. Same component, same UX everywhere.

**"Paid for Family" — First-class hisaab routing for auto-detected expenses:**

When an SMS-detected expense is actually a payment made on behalf of a family member, the user shouldn't have to approve it and then split — there should be a direct "Paid for Family" action.

This is a **preset of the SplitSheet** where `splitMode = 'they_owe_full'` and `paidBy = 'me'`. The difference is UX prominence:

| Entry Point | How "Paid for Family" Appears |
|-------------|-------------------------------|
| Review queue (SMS approve) | **Dedicated button** alongside Approve / Reject: "Paid for Family" → opens person picker only (no split mode selection needed — it's always 100%) → confirm → expense amount=0, hisaab debit=full amount |
| Expense detail (existing) | Option in split menu: "I paid for someone else (full amount)" |
| Manual expense add | Split mode: "They owe full amount" (already in SplitSheet) |

**Result:** Expense has `amount=0`, `split_pct=0`, `split_original_amount=original`, `split_hisaab_entry_id=linked`. Budget query returns 0 for this expense. Hisaab shows full amount owed.

**No schema changes needed** — reuses existing split fields. Budget query (`SUM(amount) WHERE approved AND realized`) already handles `amount=0` correctly.

---

### B5: Remove Entry Animations

**Problem:** Cards on home and budget pages slide in from top/bottom with `FadeInDown` animation on first render. Feels jarring.

**Fix:**
- Remove `entering={FadeInDown.delay(X).duration(400)}` from all cards in `index.tsx` and `budget.tsx`
- Cards should render immediately without entrance animation

---

### B6: App Icon Too Big in Drawer

**Problem:** The Sanskrit character in the adaptive icon foreground fills too much of the safe zone, causing it to appear oversized and cut off in the app drawer.

**Fix:**
- Redesign `android-icon-foreground.png` with proper padding
- Android adaptive icon safe zone: inner 72dp of 108dp total (66% of area)
- Character should fit within ~60% of the safe zone with breathing room
- Test in both circular and squircle mask shapes
- Update splash icon to match (same logo + tagline)

---

## 3. Features

### F1: Income Calculator Rework

**Problem:** Multiple issues:
1. Annual bonus isn't taxed (should be taxed at applicable income tax slab)
2. Capital gains section is basic — doesn't compute post-tax amounts per asset class
3. Annual bonus appears twice (in Direct mode card AND in Additional Income section)
4. Layout is disorganized — income inputs scattered, results mixed with inputs
5. No save-as-draft (many inputs, user may not finish in one sitting)
6. Old regime deductions and additional income sections aren't collapsible

**Solution — Complete Layout Rework:**

**New layout (top to bottom) — natural flow: Income → Deductions → Calculations → Tax:**

```
SECTION 1: INCOME (all inputs together)
─────────────────────────────────────────
1. FY Selector
2. Mode Toggle (CTC / Direct)
3. [CTC Mode] CTC Input
   - Annual CTC, Basic %, HRA %
   [Direct Mode] Direct Salary Input
   - Monthly In-Hand only (NO bonus here) ← F1-IC3
4. Additional Income (collapsible) ← F1-IC6
   - Expected Annual Bonus
     - Show: "Taxed at your income tax slab rate"
     - Compute: post-tax bonus based on total income slab ← F1-IC1
   - Expected Capital Gains (per type) ← F1-IC2
     - Listed Equity: amount → LTCG 12.5% / STCG 20%
     - Debt MF: amount → slab rate
     - FD Interest: amount → slab rate
     - Gold: amount → LTCG 12.5% / STCG slab
     - Real Estate: amount → LTCG 12.5% / STCG slab
     - Show post-tax amount for each

SECTION 2: SETTINGS & DEDUCTIONS
─────────────────────────────────────────
5. [CTC Mode] EPF & Settings (collapsible)
   - EPF mode, employer EPF in CTC, metro city, VPF, state
6. [CTC Mode] Old Regime Deductions (collapsible) ← F1-IC6
   - 80C, 80D, HRA exemption, home loan, other

SECTION 3: CALCULATIONS (results)
─────────────────────────────────────────
7. Monthly In-Hand Hero
   - Large monthly amount, annual below, best regime badge
8. CTC Breakdown (CTC mode only)
   - Basic, HRA, Special Allowance, Employer EPF, Gratuity → Gross
9. EPF Contributions
   - Employee EPF, Employer EPF/EPS, VPF → Total deducted
10. Annual Deductions Summary
    - Income Tax + EPF + Professional Tax → Total deductions

SECTION 4: TAX COMPARISON (at the very end)
─────────────────────────────────────────
11. Tax Comparison (tabs: New / Old)
    - Taxable income, base tax, rebate, surcharge, cess → total tax + effective rate
    - "Better regime" badge on the cheaper option
12. Regime Summary (side-by-side)
    - New vs Old: total tax, effective rate, BETTER badge

SECTION 5: GRAND TOTAL & ACTIONS
─────────────────────────────────────────
13. Grand Total
    - Salary Annual (post-tax)
    - + Bonus (post-tax at slab)
    - + Capital Gains (post-tax per type)
    - = Total Annual Income (post-tax)
14. Save / Save as Draft buttons ← F1-IC5
```

**Design rationale:** The flow follows the user's mental model — "what do I earn?" → "what gets deducted?" → "what's left?" → "which tax regime is better?" → "what's my total?". Tax comparison is informational/comparative and belongs at the end, not interrupting the calculation flow.

**Capital gains tax computation (F1-IC2):**
- Use existing `services/capital-gains.ts` rates (7 asset classes)
- User enters gross amount per asset class they have
- App computes tax per type and shows net amount
- LTCG exemption (Rs 1.25L for listed equity) applied automatically
- Total post-tax capital gains flows into Grand Total

**Bonus taxation (F1-IC1):**
- Bonus is part of total income → taxed at marginal slab rate
- Calculate: total taxable income = salary + bonus
- Apply slab rates to get tax on (salary + bonus)
- Subtract tax on salary alone → difference = tax on bonus
- Show: "Bonus: Rs X (Tax: Rs Y at Z% slab) → Net: Rs X-Y"

**Save as draft (F1-IC5):**
- New `status` field on salary_profiles: `'draft'` or `'complete'`
- "Save as Draft" button saves all current inputs without validation
- "Save" button validates and marks complete
- Draft profiles shown with badge on goals screen
- On load, restore draft state if exists

**Data changes (Migration 019):**
- Add `status TEXT NOT NULL DEFAULT 'complete' CHECK(status IN ('draft','complete'))` to salary_profiles
- Add capital gains breakdown columns (or store as JSON):
  - `capital_gains_equity_ltcg REAL DEFAULT 0`
  - `capital_gains_equity_stcg REAL DEFAULT 0`
  - `capital_gains_debt REAL DEFAULT 0`
  - `capital_gains_fd REAL DEFAULT 0`
  - `capital_gains_gold REAL DEFAULT 0`
  - `capital_gains_real_estate REAL DEFAULT 0`

---

### F2: Budget Widgets

**Problem:** Budget summary, month-end projection, and upcoming dues sections are frozen to the top of the budget page, don't scroll, can't be reopened once collapsed, and can't be removed if the user doesn't want them.

**Solution:** Transform budget page top sections into configurable widgets:

1. **Scrollable:** All content in a single ScrollView — widgets scroll with the rest
2. **Collapsible:** Each widget can expand/collapse (fix B1 animation bug)
3. **Removable:** User can hide widgets they don't want to see
4. **Configurable:** Settings page or inline config to manage visible widgets
5. **Persistent:** Widget visibility + collapse state saved in MMKV

**Widget list:**
| Widget | Default | Can Remove? |
|--------|---------|-------------|
| Budget Summary | Visible, expanded | Yes |
| Month-End Projection | Visible, collapsed | Yes |
| Upcoming Dues | Visible, collapsed | Yes |

**Implementation:**
- New `WidgetCard` component wrapping `CollapsibleSection` + close/remove button
- MMKV key: `budget_widgets_visible` → `["summary", "projection", "dues"]`
- "Manage Widgets" button at top or in settings to re-enable removed widgets
- Smooth removal animation (slide out)

---

### F3: Better Error Messages

**Problem:** Errors show generic messages ("Failed to save salary data") without explaining why.

**Solution:**
- Every `catch` block should surface the actual error reason
- Format: "Failed to [action]: [specific reason]"
- Examples:
  - "Failed to save: No yearly plan exists for this financial year"
  - "Failed to scan SMS: Permission denied — enable SMS access in settings"
  - "Failed to split: No hisaab persons found — add someone first"
- Add `ErrorBanner` component for inline errors (not just alerts)
- Log errors to console for debugging

---

### F4: Review Queue UX Redesign

**Problem:** Pending review section on expenses page has unclear segregation. Review queue page needs more intuitive UI.

**Solution — Expenses Page:**
- Replace simple collapsible with a distinct visual card at top
- Count badge prominently displayed
- Clear "Review All" button to navigate to full review queue
- Show max 3 preview items with "See all X items" link
- Visual distinction: different background color, border, or elevation

**Solution — Review Queue Page:**
- Group by type: "Auto-Detected Expenses" / "Matched Forecasts" / "Overdue Forecasts"
- Each group has its own count badge and batch action
- Swipe actions with clearer icons and labels
- Empty state when all items reviewed: celebration/checkmark illustration
- Filter by: bank, date range, amount range

---

### F5: SMS Custom Date Range

**Problem:** SMS scan only offers fixed options (last 6 months, 1 year). User wants custom date range.

**Solution:**
- Remove fixed "Last 6 months" and "1 year" buttons
- Add date range picker: "From" date and "To" date
- Default "From" = 30 days ago, "To" = today
- Quick presets: "Last 30 days", "Last 90 days", "Custom"
- Date picker uses native date selector

---

### F6: Splash Screen Update

**Problem:** User wants the loading page to show the Artha logo with the full tagline starting with Sanskrit, then "your finances, your way."

**Solution:**
- Update splash screen to show:
  - Artha logo (same icon used in app)
  - "अर्थ" in large Sanskrit/Devanagari text
  - Below: "your finances, your way" in English subtitle
- Maintain the 2.5s minimum duration from V1
- Match the app's color scheme (white bg in light mode, #111111 in dark)

---

### F7: SMS Account Type Detection

**Problem:** All SMS-detected accounts default to "savings." Real SMS clearly distinguishes:
- "ICICI Bank **Card** XX3001" → Credit Card
- "**A/c no.** XX2836" → Savings Account
- "Axis Bank **Loan A/c** XX7249" → Loan
- Paytm **Wallet** → Wallet

**Solution — Keyword-based detection in bank-patterns.ts:**

| SMS Keyword | Account Type |
|-------------|-------------|
| `Card`, `Card no.`, `Credit Card` | `credit_card` |
| `A/c no.`, `Acc`, `Account`, `Avl Bal` | `savings` |
| `Loan A/c`, `Loan` | `loan` |
| `Wallet` | `wallet` |
| `Avl Limit` (without "Card") | `credit_card` |

- Update all 60+ bank patterns to explicitly set `accountType` based on these keywords
- Remove fallback "default to savings" — if no keyword matched, set `accountType: null` and let the user classify in review
- Update `inferAccountType()` in financial-account.ts to use keyword-first approach

---

### F8: Account Filter on Expenses

**Problem:** Expenses can be filtered by category and payment mode, but not by bank account. Users want to see "all ICICI Credit Card 3001 expenses."

**Solution:**
- Add account filter dropdown to expenses page (alongside category + payment mode filters)
- Filter options: list of user's financial accounts (e.g., "ICICI CREDIT 3001", "AXIS SAVINGS 2836")
- Query: `WHERE account_id = ?`
- Show account badge on expense rows when filtered

---

### F9: Merchant Identification Improvements

**Problem:** Merchant names from SMS are often truncated ("AMAZON PAY IN R", "PYU*Swiggy Food") or missing. UPI P2A (person-to-person) transfers are treated as merchant transactions.

**Solution:**

**A. UPI P2M vs P2A distinction:**
- Parse UPI reference string: `UPI/P2M/...` = merchant, `UPI/P2A/...` = person transfer
- P2M: extract merchant name from UPI description (4th segment)
- P2A: extract person name, flag as `type: 'upi_p2a'` (not a merchant expense)
- Consider: P2A transfers could auto-suggest hisaab entry

**B. Merchant name normalization:**
- Post-parse cleanup: strip prefixes like `PYU*`, `CAS*`, `InfoEBA*`
- Truncation handling: "AMAZON PAY IN R" → match against known merchants list
- New `merchant_aliases` table or config: maps SMS merchant strings to canonical names
  - `"ZOMATO LTD"` → `"Zomato"`
  - `"ZOMATO LIMITED"` → `"Zomato"`
  - `"AMAZON PAY WALL"` → `"Amazon Pay"`
  - `"AMAZON PAY IN R"` → `"Amazon Pay"`
  - `"AMAZON PAY IN E"` → `"Amazon Pay"`
  - `"PYU*Swiggy Food"` → `"Swiggy"`
  - `"CAS*Swiggy"` → `"Swiggy"`
  - `"PYU*Jubilant Fo"` → `"Jubilant FoodWorks (Domino's)"`
  - `"BLINK COMMERCE"` → `"Blinkit"`
  - `"TATA PAYMENTS LIMITED"` → `"Tata Neu / BigBasket"`
- User can add/edit aliases in settings (merchant mapping config)

**C. Standing instruction merchant extraction:**
- Already works for "towards Merchant NETFLIX" format
- Ensure: "to Merchant Youtube" also captured

**Data changes (Migration 020):**
- New table `merchant_aliases`:
  ```
  id TEXT PK
  user_id TEXT FK
  sms_name TEXT NOT NULL  -- raw name from SMS
  canonical_name TEXT NOT NULL  -- cleaned display name
  category_id TEXT FK  -- optional auto-categorization
  created_at TEXT
  ```
- Seed with common Indian merchant aliases (Zomato, Swiggy, Amazon, Netflix, etc.)

---

### F10: Tags System

**Problem:** "Attach Receipt" placeholder is not useful. Users want taggable labels for additional context on expenses (e.g., "business trip", "gift", "reimbursable", "tax-deductible").

**Solution:**

**Tag behavior:**
- Expense can have multiple tags
- When adding a tag, autocomplete shows existing tags
- If typed tag doesn't exist, auto-create it
- Tags are colored chips displayed on expense detail and optionally in list view
- Filter expenses by tag

**Settings:**
- Tags management page in settings
- Create, rename, delete tags
- Set tag color
- View tag usage count

**Data changes (Migration 021):**
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

**UI locations:**
- Expense detail: tag chips below actions, "+" button to add
- Expense add: optional tag selector
- Expenses list: filter by tag
- Settings: tag management page

---

### F11: Insights Dashboard

**Problem:** User wants analytics views by merchant, category, account, payment method, and right-spend split. Category analytics exist but others are missing or have no UI.

**Solution — New Insights Tab or Screen:**

**A. Merchant Analytics (new screen):**
- Top merchants by spend (bar chart)
- Merchant transaction frequency
- Tap merchant → see all transactions for that merchant
- Merchant spend trend over months
- Uses existing `analyzeMerchants()` + new merchant detail query

**B. Account Analytics (new):**
- Per-account spending breakdown (pie chart)
- Per-account monthly trend
- Credit card utilization (spend vs limit)
- Uses `financial_accounts` data

**C. Payment Method Analytics (new):**
- Payment mode split (UPI vs Card vs Cash vs Wallet vs Bank Transfer)
- Trend: payment method usage over time
- Uses existing `analyzePaymentModes()` + new queries

**D. Right-Spend Trends (enhance existing):**
- Monthly trend of right-spend % over last 6 months
- Which categories drive avoidable spending
- Recommendations to improve right-spend ratio

**E. Cross-dimension views:**
- Category x Payment Method matrix
- Category x Account breakdown
- Monthly comparison (this month vs last month vs 3-month avg)

**Implementation approach:**
- New `app/(tabs)/insights.tsx` tab OR `app/insights/` sub-screens accessible from home
- Reuse existing service functions where possible
- New queries for: merchant detail, account breakdown, payment mode trend

---

### F12: Remove Capital Gains from Investment Details

**Problem:** Capital gains tax rate information is shown on the investment detail page, which is confusing since investments track contributions, not capital gains tax.

**Solution:**
- Remove capital gains tax rate display from `app/goals/investment-detail.tsx`
- Keep it only in `app/goals/capital-gains-reference.tsx` (dedicated reference page)
- Link to reference page from income calculator remains

---

### F13: Upcoming Dues Lifecycle Actions

**Problem:** Forecasts (EMI reminders, CC due dates, standing instructions from SMS) appear in "Upcoming Dues" on the home and budget screens, but have NO action buttons. When a due date arrives or the user pays early, there's no way to resolve the forecast from those screens — user must navigate to the review queue. Even in the review queue, individual forecast actions are limited.

**Current gaps:**
- `realizeForecast(id, actualDate)` exists in service layer but **no UI button calls it**
- `dismissOverdueForecasts()` only does bulk dismiss, no individual delete
- Home/budget upcoming dues cards are display-only — no actions
- No "mark as paid" when payment was already recorded via SMS or manual entry

**Solution — 3 lifecycle actions on every forecast card:**

```
┌─────────────────────────────────────────────┐
│ EMI - HDFC Home Loan            Due: Apr 15 │
│ ₹45,000 · HDFC Savings ****2836             │
│                                             │
│  [Mark as Paid]  [Realise Now]  [Delete]    │
└─────────────────────────────────────────────┘
```

**Action 1: Mark as Paid**
- **When:** Payment was already recorded elsewhere (SMS auto-detected it, or user added it manually)
- **Flow:** Tap → system searches for matching realized expense (same account, ±5% amount, ±7 days of due_date)
  - **Match found:** Show "Found matching payment: ₹45,000 on Apr 14 (HDFC)" → Confirm → link via `matched_forecast_id`, reject forecast
  - **No match found:** Show "No matching payment found. Dismiss anyway?" → Confirm → reject forecast
- **Result:** Forecast disappears from upcoming dues. No duplicate expense created.

**Action 2: Realise Now**
- **When:** User wants to record the payment as a real expense right now (paying early or on due date)
- **Flow:** Tap → Confirm "Add ₹45,000 as expense for today?" → Convert forecast: `nature='forecast'→'realized'`, `date=today`, `due_date=null`, `status='approved'`
- **Result:** Expense now counts in budget. Disappears from upcoming dues. Appears in expense list.
- **Optionally:** User can split this realized expense via SplitSheet before confirming (e.g., EMI paid jointly)

**Action 3: Delete**
- **When:** Forecast is stale, irrelevant, or a duplicate
- **Flow:** Tap → Confirm "Remove this upcoming due?" → Set `status='rejected'`
- **Result:** Disappears from upcoming dues. Not counted anywhere.

**Where actions appear:**

| Screen | How Actions Appear |
|--------|-------------------|
| Home "Upcoming Dues" card | Swipe left on due card reveals action buttons |
| Budget "Upcoming Dues" section | Inline action buttons per row (compact) |
| Review queue "Upcoming" section | Full action buttons (already has some, add missing) |
| Expense detail (forecast) | Full action bar at bottom when viewing a forecast expense |

**No schema changes needed.** Uses existing `realizeForecast()`, existing status='rejected' for delete, and new `markForecastAsPaid()` that wraps `findMatchingForecast()` + reject logic.

---

## 4. Updated Data Model

### 4.1 Salary Profile (Updated)

New columns from Migration 019:
| Field | Type | Notes |
|-------|------|-------|
| status | TEXT | 'draft' or 'complete' |
| capital_gains_equity_ltcg | REAL | Gross LTCG from listed equity |
| capital_gains_equity_stcg | REAL | Gross STCG from listed equity |
| capital_gains_debt | REAL | Gross gains from debt MFs |
| capital_gains_fd | REAL | Gross FD interest |
| capital_gains_gold | REAL | Gross gains from gold |
| capital_gains_real_estate | REAL | Gross gains from real estate |

### 4.2 Merchant Aliases (New — Migration 020)

| Field | Type | Notes |
|-------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT FK | References users |
| sms_name | TEXT | Raw merchant name from SMS |
| canonical_name | TEXT | Cleaned display name |
| category_id | TEXT FK | Optional auto-categorization |
| created_at | TEXT | ISO timestamp |

### 4.3 Tags (New — Migration 021)

| Field | Type | Notes |
|-------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT FK | References users |
| name | TEXT | Tag display name |
| color | TEXT | Hex color for chip |
| created_at | TEXT | ISO timestamp |

### 4.4 Expense Tags (New — Migration 021)

| Field | Type | Notes |
|-------|------|-------|
| expense_id | TEXT FK | References expenses, CASCADE delete |
| tag_id | TEXT FK | References tags, CASCADE delete |
| | PK | Composite (expense_id, tag_id) |

---

## 5. Migrations Summary

| Migration | Name | What It Does |
|-----------|------|-------------|
| 018 | `salary_profile_nullable_plan` | Makes `yearly_plan_id` nullable on salary_profiles. Drops NOT NULL constraint. |
| 019 | `income_calculator_v2` | Adds `status`, capital gains breakdown columns to salary_profiles. |
| 020 | `merchant_aliases` | Creates `merchant_aliases` table with sms_name → canonical_name mapping. Seeds common Indian merchants. |
| 021 | `tags` | Creates `tags` and `expense_tags` tables with indexes. |

---

## 6. SMS Pattern Reference (from Bank SMS Example.txt)

### Account Type Detection Keywords

| Pattern | Account Type | Bank Examples |
|---------|-------------|---------------|
| "Bank Card XX" / "Card no. XX" | credit_card | ICICI, Axis, HDFC |
| "A/c no. XX" / "Acc XX" / "Avl Bal" | savings | Axis, ICICI |
| "Loan A/c XX" | loan | Axis |
| "Wallet" | wallet | Paytm |
| "Credit Card XXXX" (in SI) | credit_card | ICICI |
| "Avl Limit" (without "Card" in same SMS) | credit_card | Inferred |

### UPI Transaction Types

| UPI Pattern | Meaning | Treatment |
|-------------|---------|-----------|
| UPI/P2M/ref/MERCHANT | Merchant payment | Create expense with merchant name |
| UPI/P2A/ref/PERSON | Person transfer | Flag as P2A, suggest hisaab entry |

### Merchant Name Normalization (Seed Data)

| SMS Raw Name | Canonical Name |
|-------------|---------------|
| ZOMATO LTD, ZOMATO LIMITED | Zomato |
| AMAZON PAY WALL, AMAZON PAY IN R, AMAZON PAY IN E | Amazon Pay |
| PYU*Swiggy Food, CAS*Swiggy | Swiggy |
| PYU*Jubilant Fo | Domino's |
| BLINK COMMERCE | Blinkit |
| TATA PAYMENTS LIMITED | Tata Neu |
| NETFLIX | Netflix |
| STEAMGAMES | Steam |
| BOOKMYSHOW | BookMyShow |
| ZEPTO MARKETPLA | Zepto |
| UBER INDIA SYST | Uber |

---

## 7. Design Decisions

1. **Tags replace receipts** — Receipt attachment deferred indefinitely. Tags provide immediate value without camera/storage complexity.
2. **Insights as screens, not tab** — Keep 5-tab layout (home, expenses, budget, goals, settings). Insights accessible from home or via new navigation.
3. **Budget widgets configurable via MMKV** — No migration needed. Simple key-value visibility + order.
4. **Merchant aliases editable** — Users can correct merchant names. System learns over time.
5. **Capital gains per-type** — Each asset class gets its own input field and tax calculation. Comprehensive but optional (default 0).
6. **P2A → Hisaab suggestion** — Person-to-person UPI transfers auto-suggest creating a hisaab debit entry.

---

## 8. Version History

| Version | Date | Change |
|---------|------|--------|
| 2.0 | 2026-04-13 | Initial V2 PRD with 6 bug fixes + 12 features |
