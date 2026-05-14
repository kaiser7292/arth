# Artha (अर्थ) — Version 1 Master Plan & Progress Tracker

**Purpose:** This is the single source of truth for V1 development. Claude MUST read this file at the start of every session and after every context compaction.

**Predecessor:** MVP docs are archived at `docs/MVP/`. V1 builds on the complete MVP (67 tasks, 802 tests, 18 tables).

---

## SESSION LOG (Most Recent First)

> **After every task completion or context compaction, add an entry here.**
> Format: `[Date] — Task — What was done — What's next`

| Date | Task | What Was Done | Next Up |
|------|------|---------------|---------|
| 2026-04-13 | V1-7.4 | V1 APK Build. Version bumped 0.1.0→1.0.0. Adaptive icon bg #1A1D46→#2563EB. Splash bg #0D0E12→#111111. Clean prebuild + assembleRelease. APK: 96MB at android/app/build/outputs/apk/release/app-release.apk. All 12 features (F1-F12) complete. 42/42 tasks done. | V1 COMPLETE |
| 2026-04-13 | V1-7.3 | Integration tests for V1 features. 3 new test files: split-expense.test.ts (13 tests: createSplitExpense amounts/rounding/100%, updateSplitPercentage, removeSplit, deleteSplitExpense), forecast-matching.test.ts (12 tests: findMatchingForecast confidence scoring, getMatchedForecastPairs, resolveMatchRealize/AlreadyCaptured/BothDifferent, overdue handling), fy-services.test.ts (17 tests: getMilestoneContributionForFY spreading/legacy/edge cases, getMilestonesForFY filtering, getBucketsByFY, getSalaryProfileByFY). Total: 844 tests across 42 suites (was 802/39). | Task V1-7.4: V1 APK Build |
| 2026-04-13 | V1-7.2 | Updated TDD_V1.md: added migration 017 (forecast_matching), forecast matching service (section 3.8 with confidence scoring, matched pairs, 3 actions, overdue handling), new components (ExpenseAccountRow, ExpenseMetadata), final implemented color palette with primary scale + dark mode + shadow changes, migration count 16→17, 6 new indexes, updated test coverage, status Draft→Complete. | Task V1-7.3: Integration Tests |
| 2026-04-13 | V1-7.1 | Updated PRD_V1.md: added matched_forecast_id to Expense data model (migration 017), updated F7 color scheme with final implemented palette (blue #2563EB, full primary scale, dark mode), added migrations summary section (015-017), status Draft→Complete. | Task V1-7.2: Write V1 TDD |
| 2026-04-13 | V1-6.3 | Icon & typography refinement. SectionHeader mb-2→mb-3 for breathing room. Card shadow softened (opacity 0.06→0.04, radius 3→4). Home screen card spacing mt-2/mt-3→mt-3/mt-4. App header padding increased (pt-4 pb-2→pt-5 pb-3). Budget summary card mb-2→mb-3. Phase 6 (F7 Color Refresh) COMPLETE. 802 tests pass. | Task V1-7.1: Write V1 PRD |
| 2026-04-13 | V1-6.2 | Screen-by-screen color QA complete. Grepped all hardcoded hex values across codebase. Fixed stale remnants: #111430→#1E1E1E (ExpenseMetadata dark bg), #7B8CDE→#93C5FD (import/backup dark accent), #F8F9FB→#F7F7F5 (import surface), #1A1D2B→#1E1E1E (import dark surface). AlertBanner semantic tints verified as correct. Only #F59E0B remains — intentionally kept as category data color. 802 tests pass. | Task V1-6.3: Icon & typography refinement |
| 2026-04-13 | V1-6.1 | Notion-inspired color refresh. Primary: blue #2563EB (was #2A2E73). Light: white bg, warm #F7F7F5 surface, #E5E5E3 borders, #1A1A1A text. Dark: #111111 bg, #1E1E1E surface, #2E2E2E borders. Success #16A34A, danger #DC2626, warning #D97706. ~250 hardcoded hex refs replaced across 40+ files. rgba() values updated in goals STATUS_CONFIG. theme.ts + tailwind.config.js updated. 802 tests pass. | Task V1-6.2: Screen-by-screen color QA |
| 2026-04-13 | V1-5.1 to V1-5.6 | Phase 5 complete. Migration 017 (matched_forecast_id). Forecast matching: 5% amount tolerance, account_id matching, confidence scoring (0-100). No auto-realize — matched pairs shown in review queue with Realise/Already Captured/Both Different actions. Overdue badge on forecasts. Bulk dismiss overdue. Review queue on expenses tab (collapsible pending section with swipe). CollapsibleSection component (animated, MMKV-persisted state). Budget summary/projection/dues wrapped in collapsible. Upcoming Dues card on home screen (top 4 + overdue badges). 802 tests pass. | Task V1-6.1: Theme & color update |
| 2026-04-13 | V1-4.1 to V1-4.10 | Phase 4 complete. FY decoupling for salary profiles (getSalaryProfileByFY), investment buckets (getBucketsByFY), life milestones (getMilestonesForFY + multi-year spreading). deriveYearlyPlan auto-assembles plan from FY-tagged components. Goals dashboard guided setup flow. Yearly plan screen rewritten as read-only dashboard. Investment buckets FY selector. Milestones FY start + duration UI. SavingsGauge SVG ring rewrite (react-native-svg). Income calculator FY selector + bonus + capital gains. 802 tests pass. | Task V1-5.1: Forecast matching service |
| 2026-04-13 | V1-3.1 to V1-3.4 | Phase 3 complete. Split expense service (createSplitExpense, updateSplitPercentage, removeSplit, deleteSplitExpense — all atomic via withTransactionAsync). Split UI on Add Expense (toggle, person picker, 25/50/75% quick buttons, live preview). Split info on detail (active badge, view in hisaab link, remove split). Delete cascade (split expenses delete linked hisaab entry). getEntryByLinkedExpense added to hisaab.ts. 802 tests pass. | Task V1-4.1: Salary profile FY decoupling |
| 2026-04-13 | V1-2.4, V1-2.5 | Phase 2 complete. ExpenseAccountRow (bank+card+last4), ExpenseMetadata (collapsible Other Info with source/nature/created/raw SMS/refund/split). Full [id].tsx redesign: read-only Axio layout (hero→account→fields→actions→metadata) + edit mode. Expense list now merchant-first. 802 tests pass. | Task V1-3.1: Split expense service |
| 2026-04-13 | V1-2.3 | ExpenseHeroCard component built (components/expense/ExpenseHeroCard.tsx). Shows merchant as title, amount with debit arrow, category badge, date, source/nature badges. | Task V1-2.4: Account & Metadata section |
| 2026-04-12 | V1-1.1, V1-1.2, V1-1.3 | Phase 1 complete. Splash min 2.5s duration. Seed data UI removed from settings. EPF labels updated ("Minimum (15K)" / "12% of Basic Pay"). All 802 tests pass. | Task V1-2.1: Merchant service layer |
| 2026-04-12 | V1-0.1, V1-0.2 | Migrations 015 (expense_merchant_split) and 016 (goals_v1_restructure) created and registered. Database tests updated (15 pass). PRD_V1.md and TDD_V1.md written. Versioning guideline added to CLAUDE.md. | Task V1-1.1: Splash duration |
| 2026-04-12 | V1 Planning | V1 plan approved. 12 features (F1-F12). Docs restructured: MVP docs moved to `docs/MVP/`, V1 docs created in `docs/V1/`. CLAUDE.md updated with V1 references. | Task V1-0.1: Migration 015 |

---

## CURRENT STATE

> **Quick glance: Where are we right now?**

- **Current Version:** V1 — COMPLETE
- **Current Phase:** All 8 phases COMPLETE
- **Current Task:** None — V1 done
- **Last Completed:** V1-7.4 (V1 APK Build — version 1.0.0, 96MB)
- **MVP Status:** COMPLETE (67 tasks, 802 tests, 18 tables, 14 migrations)
- **V1 Status:** COMPLETE — 42 of 42 tasks, 12 features (F1-F12), 844 tests, 42 suites, 17 migrations
- **Test Status:** 844 tests pass across 42 suites
- **Blockers:** None

---

## MANDATORY BEHAVIORS

### Before Starting Any Work
```
1. Read CLAUDE.md (project context)
2. Read this file (MASTER_PLAN_V1.md) — check SESSION LOG and CURRENT STATE
3. Find the next task with [ ] status
4. Read that task's prerequisite files
5. Execute the task
```

### After Completing Any Task
```
1. Mark the task [x] in the task list below
2. Add an entry to the SESSION LOG above
3. Update CURRENT STATE above
4. If a feature is complete, update CLAUDE.md "V1 Feature Roadmap" status
```

### After Every Context Compaction
```
1. IMMEDIATELY read docs/V1/MASTER_PLAN_V1.md
2. Check SESSION LOG — understand what was done
3. Check CURRENT STATE — understand where you are
4. Resume the current task or start the next one
```

---

## V1 FEATURE SUMMARY

| # | Feature | Size | Tasks | Status |
|---|---------|------|-------|--------|
| F1 | Expense Split to Hisaab | L | V1-3.1 to V1-3.4 | [x] |
| F2 | Splash Screen Readable Duration | S | V1-1.1 | [x] |
| F3 | Goals Rework — Auto-Derived Plan | XL | V1-4.1 to V1-4.8 | [x] |
| F4 | Savings Gauge Chart Fix | M | V1-4.9 | [x] |
| F5 | Forecast-to-Realised Smart Workflow | L | V1-5.1 to V1-5.3 | [x] |
| F6 | Axio-Inspired Expense Detail & Metadata | L | V1-2.3 to V1-2.5 | [x] |
| F7 | Color Scheme Refresh (Lighter, Notion-inspired) | L | V1-6.1 to V1-6.3 | [x] |
| F8 | Merchant Bucketing + Payment Details | M | V1-2.1, V1-2.2 | [x] |
| F9 | Remove "Load My Financial Data" | S | V1-1.2 | [x] |
| F10 | Review Queue on Expenses Page | M | V1-5.4 | [x] |
| F11 | Budget Collapsible Sections + Upcoming Dues on Home | M | V1-5.5, V1-5.6 | [x] |
| F12 | Income Calculator Enhancements | M | V1-1.3, V1-4.10 | [x] |

---

## PHASE 0: Foundation — Schema Migrations

> **Goal:** Add new database columns for merchant, split, goals restructure, and income calculator enhancements. No UI changes yet.

### V1-0.1: Migration 015 — expense_merchant_split [x]
**Feature:** F1 + F8
**Prereqs:** Read `database/migrations/index.ts`, `database/migrations/014_hisaab_tables.ts`
**What to build:**
- New file `database/migrations/015_expense_merchant_split.ts`
- ALTER TABLE expenses: add `merchant_name TEXT`, `split_original_amount REAL`, `split_person_id TEXT REFERENCES hisaab_persons(id)`, `split_pct REAL`, `split_hisaab_entry_id TEXT REFERENCES hisaab_entries(id)`
- CREATE INDEX `idx_expenses_merchant` on merchant_name
- CREATE INDEX `idx_expenses_split_person` on split_person_id
- Register in `database/migrations/index.ts` as migration015

**Tests:**
- Update `database.test.ts`: table column count, index count (add 2), migration count (14→15), skip test, all-applied list
- Verify migration runs cleanly on existing data

**Acceptance:** Migration runs without error. Existing expenses unaffected. New columns default to NULL. Tests pass.

---

### V1-0.2: Migration 016 — goals_v1_restructure [x]
**Feature:** F3 + F12
**Prereqs:** Read `database/migrations/004_goal_engine_tables.ts`, `database/migrations/008_salary_profiles.ts`, `services/yearly-plan.ts`
**What to build:**
- New file `database/migrations/016_goals_v1_restructure.ts`
- ALTER TABLE investment_buckets: add `financial_year TEXT`, `user_id TEXT REFERENCES users(id)`
- ALTER TABLE life_milestones: add `start_financial_year TEXT`, `duration_years INTEGER DEFAULT 1`
- ALTER TABLE salary_profiles: add `financial_year TEXT`, `user_id TEXT REFERENCES users(id)`, `expected_capital_gains REAL NOT NULL DEFAULT 0`, `expected_bonus REAL NOT NULL DEFAULT 0`
- Backfill: UPDATE investment_buckets SET financial_year = (SELECT financial_year FROM yearly_plans WHERE id = yearly_plan_id), user_id = (SELECT user_id FROM yearly_plans WHERE id = yearly_plan_id)
- Same backfill for salary_profiles
- CREATE INDEX `idx_investment_buckets_fy`, `idx_salary_profiles_fy`, `idx_life_milestones_fy`
- Register in `database/migrations/index.ts` as migration016
- **CRITICAL:** Do NOT drop `yearly_plan_id` columns. Keep for backward compat.

**Tests:**
- Update `database.test.ts`: index count (add 3), migration count (15→16), skip test, all-applied list
- Test backfill logic with existing plan data

**Acceptance:** Migration runs without error. Existing plan/bucket/salary data preserved. Backfilled columns populated correctly. Tests pass.

---

## PHASE 1: Quick Wins (F2, F9, F12 labels)

> **Goal:** Small, standalone improvements that don't depend on schema changes. Can be done in parallel.

### V1-1.1: Splash Screen Readable Duration (F2) [x]
**Prereqs:** Read `app/_layout.tsx`
**What to build:**
- Add `minSplashDone` state (useState false)
- Add useEffect with setTimeout(2500ms) to set minSplashDone = true
- Change splash display condition: show when `!dbReady || !minSplashDone`
- User should be able to read "Artha (अर्थ)" and tagline before main app loads

**Tests:** Manual test on device — splash visible for ~2.5 seconds minimum.
**Acceptance:** App name and tagline readable on launch. No delay when returning to app (only on cold start).

---

### V1-1.2: Remove "Load My Financial Data" (F9) [x]
**Prereqs:** Read `app/(tabs)/settings.tsx` (find seed picker section around lines 336-389)
**What to build:**
- Remove the "Load My Financial Data" row from settings
- Remove `showSeedPicker` state variable
- Remove `executeSeed` handler function
- Remove the scope picker UI (1 Month / Quarter / Half Year / Full Year)
- Keep `services/seed-data.ts` file (don't delete, just remove UI reference)

**Tests:** Settings screen renders without seed option. No references to seedFinancialData in UI code.
**Acceptance:** Setting removed. No crash. All other settings work.

---

### V1-1.3: Income Calculator EPF Label Changes (F12 partial) [x]
**Prereqs:** Read `app/goals/salary-calculator.tsx` (EPF section)
**What to build:**
- Change label "Restricted" → "Minimum" (wherever the restricted/capped EPF option is labeled)
- Change label "Full Basic" → "12% of Basic Pay"
- No logic changes — purely display labels
- Also update `epf_mode` type labels in `services/salary-profile.ts` if they have display strings

**Tests:** Manual verification of label text on device.
**Acceptance:** Labels read "Minimum (15K)" and "12% of Basic Pay" instead of old labels.

---

## PHASE 2: Merchant Bucketing + Expense Metadata (F8, F6)

> **Goal:** Make merchant a first-class citizen. Redesign expense detail screen following Axio patterns.
> **Depends on:** Phase 0 (Migration 015 for merchant_name column)

### V1-2.1: Merchant Service Layer (F8) [x]
**Prereqs:** Read `services/expense.ts` (Expense interface, CreateExpenseInput, createExpense), `services/sms/sms-to-expense.ts` (all 3 expense creation paths), `services/sms/bank-patterns.ts` (ParsedSMS.merchant)
**What to build:**
- Add `merchant_name` to `Expense` interface in expense.ts
- Add `merchant_name?: string` to `CreateExpenseInput`
- Update `createExpense()` INSERT to include merchant_name
- Update `updateExpense()` to support merchant_name
- Update all SELECT queries that build Expense objects to include merchant_name

**Tests:**
- New tests: createExpense with merchant_name, updateExpense merchant_name, query returns merchant_name
- Existing tests should still pass (merchant_name is optional/NULL)

**Acceptance:** Expense objects include merchant_name field. CRUD works with and without merchant.

---

### V1-2.2: Wire SMS Parser to Merchant Field (F8) [x]
**Prereqs:** Read `services/sms/sms-to-expense.ts` (buildDescription, all createExpense calls)
**What to build:**
- In `createExpenseFromSms()`: pass `parsed.merchant` as `merchant_name` in all CreateExpenseInput calls (realized, refund, forecast paths)
- Merchant was previously only embedded in description via `buildDescription()` — now it's also a separate field
- Keep `buildDescription()` as-is (description still contains merchant for readability)

**Tests:**
- Test that SMS-created expenses have merchant_name populated from parsed.merchant
- Test that expenses without merchant (manual) have merchant_name = null

**Acceptance:** SMS-parsed expenses have merchant_name populated. Manual expenses have null.

---

### V1-2.3: Expense Detail Hero Card Component (F6) [x]
**Prereqs:** Read `app/expense/[id].tsx`, study Axio expense detail screenshots (merchant title, amount, category badge, datetime)
**What to build:**
- New component `components/expense/ExpenseHeroCard.tsx`
- Props: merchant_name, amount, category (name + color + icon), date, source (manual/sms_auto/email_auto), nature (realized/forecast)
- Layout (inspired by Axio):
  - Merchant name as large title (or description fallback, or "Expense")
  - Large amount with debit arrow icon
  - Category pill/badge below amount
  - Formatted date+time
  - Subtle gradient or tinted background based on category color

**Tests:** Component renders correctly with all prop combinations (with/without merchant, with/without category).
**Acceptance:** Hero card visually matches Axio style. Works in light and dark mode.

---

### V1-2.4: Expense Detail — Account & Metadata Section (F6) [x]
**Prereqs:** Read `app/expense/[id].tsx`, `services/financial-account.ts` (getAccountSummary)
**What to build:**
- Add Account Row below hero: Bank name + card type + last 4 digits (from `financial_accounts` via `expense.account_id`)
  - If no account linked: don't show row
  - Format: bank icon + "ICICI CREDIT 3001" or "AXIS 2836"
- Add "Other Info" collapsible section at bottom:
  - Source badge: Manual / SMS Auto / Email Auto (from expense.source)
  - Nature: Realized / Forecast (with due_date if forecast)
  - Created: formatted timestamp
  - Raw SMS: expandable text showing raw_source_text if exists
  - Refund link: if refund_of_expense_id exists, show "Refund of [original]" with link
  - Split info: if split_person_id exists, show person name + split % + their share

**Tests:** Metadata section renders with SMS-sourced expense. Renders clean for manual expense (no account, no raw SMS).
**Acceptance:** Expense detail shows rich metadata like Axio. Manual expenses show minimal metadata gracefully.

---

### V1-2.5: Expense Detail — Full Redesign Integration (F6) [x]
**Prereqs:** Complete V1-2.3 and V1-2.4
**What to build:**
- Integrate ExpenseHeroCard into `app/expense/[id].tsx` replacing current simple amount display
- Restructure the screen layout:
  1. Hero card (merchant, amount, category, date)
  2. Account row (bank + card)
  3. Editable fields section (category picker, payment mode, right spend, description/notes)
  4. Actions row: "Split with Hisaab" card (placeholder, functional in Phase 3) + "Attach receipt" card (placeholder for future)
  5. Other info collapsible section
- Add merchant_name display on expenses list (`app/(tabs)/expenses.tsx`): show merchant as primary label, description as subtitle

**Tests:** Full screen renders with both SMS and manual expenses. Edit flows still work. Delete still works.
**Acceptance:** Expense detail matches Axio-level richness. Expense list shows merchant-first.

---

## PHASE 3: Expense Split to Hisaab (F1)

> **Goal:** When adding an expense, optionally split it with a hisaab person.
> **Depends on:** Phase 0 (Migration 015 for split columns), Phase 2 (expense detail redesign)

### V1-3.1: Split Expense Service Layer (F1) [x]
**Prereqs:** Read `services/expense.ts` (createExpense, transaction patterns), `services/hisaab.ts` (createEntry, getPersonsWithBalances)
**What to build:**
- New interface `CreateSplitExpenseInput` extending CreateExpenseInput: `split_with_person_id: string`, `split_pct: number` (default 50), `original_amount: number`
- New function `createSplitExpense(input)`:
  1. Calculate `my_portion = original_amount * (split_pct / 100)`, `their_portion = original_amount - my_portion`
  2. In a database transaction:
     a. Create expense with `amount = my_portion`, set `split_original_amount`, `split_person_id`, `split_pct`
     b. Create hisaab entry (type='debit', amount=their_portion, linked_expense_id=new expense id)
     c. Update expense with `split_hisaab_entry_id = new hisaab entry id`
  3. Return expense id
- New function `getEntryByLinkedExpense(expenseId)` in hisaab.ts

**Tests:**
- createSplitExpense: correct amounts, hisaab entry created, linked IDs set
- Split 50-50, 70-30, 100-0, 0-100 edge cases
- Rounding: odd amounts split correctly (e.g., 101 → 50.5 / 50.5)

**Acceptance:** Split expense creates both expense record and hisaab entry atomically. All amounts correct.

---

### V1-3.2: Split UI on Add Expense (F1) [x]
**Prereqs:** Read `app/expense/add.tsx`, complete V1-3.1
**What to build:**
- Below the Amount section: "Split with someone?" toggle (off by default)
- When toggled ON, show:
  - Person picker (dropdown from hisaab_persons, load via getPersonsWithBalances)
  - Split percentage input (default 50, range 0-100, or a slider)
  - Live display: "Your share: ₹X / Their share: ₹Y"
- The Amount input remains the TOTAL amount
- On save: if split is on, call `createSplitExpense()` instead of `createExpense()`
- Validation: person must be selected, % must be 0-100

**Tests:** Manual test: add split expense, verify amounts in expense list and hisaab ledger.
**Acceptance:** Split expense flow works end-to-end. User's budget reflects only their share.

---

### V1-3.3: Split Info on Expense Detail (F1) [x]
**Prereqs:** Complete V1-2.5 (expense detail redesign) and V1-3.1
**What to build:**
- In expense detail `app/expense/[id].tsx`: if expense has `split_person_id`:
  - Show split info card: person name, original amount, split %, their share amount
  - Link to hisaab ledger for that person
- In the "Other Info" section: show split metadata

**Tests:** Split expense detail shows correct split info. Non-split expenses show nothing.
**Acceptance:** Split metadata visible on expense detail.

---

### V1-3.4: Split Edit & Delete Cascade (F1) [x]
**Prereqs:** Complete V1-3.1 to V1-3.3
**What to build:**
- Edit split: allow changing split % on existing split expense (update both expense amount and hisaab entry)
- Remove split: remove split metadata from expense, delete linked hisaab entry
- Delete expense: if split, also delete the linked hisaab entry (with confirmation)
- Delete hisaab entry: if it was created via split, warn user that expense will lose split info

**Tests:**
- Edit split %: both expense and hisaab entry update correctly
- Delete split expense: hisaab entry also deleted
- Remove split from expense: hisaab entry deleted, expense amount restored to original

**Acceptance:** All split lifecycle operations are consistent. No orphaned records.

---

## PHASE 4: Goals Rework + Savings Gauge + Income Calculator (F3, F4, F12)

> **Goal:** Transform goals from manual plan creation to auto-derived from components. Fix savings gauge. Enhance income calculator.
> **Depends on:** Phase 0 (Migration 016 for FY columns)

### V1-4.1: Salary Profile Service — FY Decoupling (F3, F12) [x]
**Prereqs:** Read `services/salary-profile.ts`, `database/migrations/008_salary_profiles.ts`
**What to build:**
- Add `financial_year` and `user_id` to SalaryProfile interface
- Add `expected_capital_gains` and `expected_bonus` to SalaryProfile interface
- New function `getSalaryProfileByFY(userId, financialYear)`
- Update `createSalaryProfile()` to accept `financial_year` + `user_id` (in addition to yearly_plan_id for backward compat)
- Update `updateSalaryProfile()` similarly

**Tests:**
- Create salary profile with financial_year + user_id
- Get salary profile by FY
- Update with new capital gains/bonus fields
- Backward compat: existing profiles with yearly_plan_id still work

**Acceptance:** Salary profiles can be created and queried by FY without requiring a yearly plan.

---

### V1-4.2: Investment Bucket Service — FY Decoupling (F3) [x]
**Prereqs:** Read `services/yearly-plan.ts` (investment bucket functions)
**What to build:**
- Add `financial_year` and `user_id` to InvestmentBucket interface
- New function `getBucketsByFY(userId, financialYear)` — returns all active buckets for an FY
- Update `createInvestmentBucket()` to accept `financial_year` + `user_id`
- Update `getInvestmentBuckets()` to optionally filter by FY
- Keep `yearly_plan_id` parameter as optional for backward compat

**Tests:**
- Create bucket with financial_year + user_id
- Get buckets by FY
- Existing buckets (with yearly_plan_id only) still returned

**Acceptance:** Investment buckets can be created and queried by FY independently.

---

### V1-4.3: Life Milestone Service — Multi-Year Spreading (F3) [x]
**Prereqs:** Read `services/life-milestone.ts`
**What to build:**
- Add `start_financial_year` and `duration_years` to LifeMilestone interface
- Update `createLifeMilestone()` and `updateLifeMilestone()` to accept new fields
- New function `getMilestoneContributionForFY(milestoneId, financialYear)`:
  - If milestone's FY range (start_financial_year to start_financial_year + duration_years - 1) includes the target FY: return `target_amount / duration_years`
  - Otherwise: return 0
- New function `getMilestonesForFY(userId, financialYear)` — returns milestones active in that FY

**Tests:**
- Milestone with duration 1 year: full amount in start FY, 0 elsewhere
- Milestone with duration 3 years: 1/3 per year for 3 FYs
- Edge case: milestone with no start_financial_year (legacy) — treated as current FY only

**Acceptance:** Milestones can be spread across multiple financial years.

---

### V1-4.4: Derive Yearly Plan Service (F3) [x]
**Prereqs:** Complete V1-4.1, V1-4.2, V1-4.3. Read `services/yearly-plan.ts` (existing plan functions)
**What to build:**
- New function `deriveYearlyPlan(userId, financialYear)`:
  - Income: getSalaryProfileByFY → computed_monthly_in_hand * 12 + expected_bonus + expected_capital_gains
  - Investments: SUM(annual_target) from getBucketsByFY
  - Milestones: SUM of getMilestoneContributionForFY for all milestones
  - Expenses: annualized from budgets (SUM of monthly budgets * 12 / months with data)
  - Compute: total_income, total_outflow (expenses + investments + milestones), surplus, savings_rate
  - Return: DerivedPlanSummary object
- Keep `savings_rate_target_pct` as the only user-editable field on yearly_plans
- Auto-create/update yearly_plans record with derived values when called

**Tests:**
- Derive with all components (salary, buckets, milestones, budgets)
- Derive with missing components (no salary → income = 0, no buckets → investments = 0)
- Savings rate calculation accuracy
- Multiple FYs derive independently

**Acceptance:** Plan auto-derives from components. No manual plan creation needed.

---

### V1-4.5: Goals Dashboard — Guided Setup (F3) [x]
**Prereqs:** Complete V1-4.4. Read `app/(tabs)/goals.tsx`
**What to build:**
- Replace "Create Plan" CTA with guided setup flow:
  - If no salary profile for current FY: "Set your income" → salary-calculator
  - If no investment buckets for current FY: "Add investment goals" → investment-buckets
  - If no milestones: "Add life goals" → milestones
  - Show checklist with green checkmarks for completed items
- Once all 3 exist: show derived plan summary (from deriveYearlyPlan)
- Show the same hero status banner (winning/on_track/behind) using derived values
- Keep savings rate card, investment buckets section, milestones section

**Tests:** Manual test: fresh state shows guided setup, adding each component checks it off, all three → shows plan.
**Acceptance:** Goals screen guides user through setup. Plan auto-derives once components exist.

---

### V1-4.6: Yearly Plan Screen — Read-Only Dashboard (F3) [x]
**Prereqs:** Complete V1-4.4 and V1-4.5. Read `app/goals/yearly-plan.tsx`
**What to build:**
- Transform from editable form to READ-ONLY dashboard:
  - **Income Card:** salary + bonus + capital gains. "Edit" links to salary-calculator with FY param
  - **Investments Card:** SUM of buckets. "Manage" links to investment-buckets
  - **Milestones Card:** Milestone contributions for this FY. "Manage" links to milestones
  - **Expenses Card:** Annualized budget total. "Edit" links to budget-config
  - **Summary:** Total Income, Total Outflow, Surplus/Deficit, Savings Rate (actual vs target)
  - **Only editable field:** Savings Rate Target % (inline edit with save)
- Keep FY navigator (view different years)

**Tests:** Dashboard shows correct derived values. Edit links navigate correctly. Savings target editable.
**Acceptance:** Yearly plan screen is informational. User cannot manually set income/expenses/investments.

---

### V1-4.7: Investment Buckets — FY Selector (F3) [x]
**Prereqs:** Complete V1-4.2. Read `app/goals/investment-buckets.tsx`
**What to build:**
- Add FY picker at top of screen (which FY is this bucket for?)
- Default to current FY
- When creating a bucket: tag with selected FY via `financial_year` field
- Filter bucket list by selected FY
- Keep all existing bucket functionality (add, edit, contribute, delete)

**Tests:** Create buckets for different FYs. Filter works. Contributions tracked per bucket.
**Acceptance:** Buckets are FY-tagged. User can manage buckets per FY.

---

### V1-4.8: Milestones — FY Start + Duration (F3) [x]
**Prereqs:** Complete V1-4.3. Read `app/goals/milestones.tsx`
**What to build:**
- Add "Start Financial Year" picker when creating/editing milestone
- Add "Duration (years)" input (default 1)
- Show on milestone card: "FY 2026-27, 3 years" or similar
- Show annual contribution: target_amount / duration_years
- Keep all existing milestone functionality (contribute, complete, delete)

**Tests:** Create milestone with 3-year duration. Shows correct annual contribution. Appears in multiple FY derive calls.
**Acceptance:** Milestones can be spread across multiple FYs.

---

### V1-4.9: Savings Gauge Chart Fix (F4) [x]
**Prereqs:** Read `components/charts/SavingsGauge.tsx`
**What to build:**
- Replace the 20-segment arc design with a clean single animated ring:
  - Track arc (light gray)
  - Filled arc (colored: green if actual >= target, red if below)
  - Center: large percentage number + "of X% target" subtitle
  - Below gauge: "Saved ₹X" left, "Target ₹Y" right
- Use `react-native-svg` Circle or reanimated for smooth animation
- Remove the segmented indicator approach entirely

**Tests:** Gauge renders with various values (0%, 50%, 100%, 150%). Correct color coding.
**Acceptance:** Clean, single gauge replaces cluttered 2-chart display. Animates on mount.

---

### V1-4.10: Income Calculator — Full Enhancements (F12) [x]
**Prereqs:** Complete V1-4.1 (salary profile FY decoupling). Read `app/goals/salary-calculator.tsx`
**What to build:**
- **FY selector** at top of screen: which financial year is this income for?
- **"Additional Income" section** after CTC/Direct input:
  - Expected Annual Bonus (₹ input)
  - Expected Capital Gains (₹ input, with note: "See Capital Gains Reference for tax rates")
- **Total Income display:** Monthly In-Hand x 12 + Bonus + Capital Gains
- Save to salary_profiles with: financial_year, user_id, expected_bonus, expected_capital_gains
- **"Use in Plan" button:** saves profile and navigates back, triggering plan re-derive

**Tests:**
- Enter capital gains + bonus, verify saved to profile
- FY selector works, creates profile for selected FY
- Total income calculation correct

**Acceptance:** Income calculator captures full income picture (salary + bonus + capital gains) per FY.

---

## PHASE 5: Forecast Workflow + Budget UX (F5, F10, F11)

> **Goal:** Smart forecast-to-realised matching. Review queue on expenses tab. Collapsible budget sections.

### V1-5.1: Forecast Matching Service (F5) [x]
**Prereqs:** Read `services/expense.ts` (findMatchingForecast, realizeForecast, getForecastExpenses), `services/sms/sms-to-expense.ts` (forecast creation path)
**What to build:**
- Enhance `findMatchingForecast()`:
  - Match criteria: same `account_id` + amount within 5% tolerance + `due_date` within 7 days of actual date
  - Return match with confidence score
- When creating realized expense from SMS:
  - Check for matching forecast
  - If found: tag the realized expense with reference to forecast (store forecast_id in description or new column)
  - Don't auto-realize — keep both as pending_review for user decision

**Tests:**
- Exact match: same amount, same account, within date window → match found
- Close match: 5% amount difference → match found
- No match: different account → no match
- No match: date too far apart → no match

**Acceptance:** Matching logic finds forecast-realized pairs. No auto-merging.

---

### V1-5.2: Forecast Matching UI in Review Queue (F5) [x]
**Prereqs:** Complete V1-5.1. Read `app/expense/review-queue.tsx`
**What to build:**
- New section in review queue: "Matched Forecasts"
- Show forecast-realized pairs with:
  - Forecast card (amount, due date, source)
  - Realized card (amount, actual date, source)
  - Match indicator between them
- 3 action buttons per pair:
  - "Realise" → convert forecast to realized (use realizeForecast), dismiss duplicate
  - "Already Captured" → reject the forecast, keep the realized expense
  - "Both Different" → approve both as separate expenses

**Tests:** Manual test: create forecast via SMS reminder, then actual debit SMS → appears as matched pair in queue.
**Acceptance:** Matched pairs visible. All 3 actions work correctly.

---

### V1-5.3: Overdue Forecast Handling (F5) [x]
**Prereqs:** Complete V1-5.1
**What to build:**
- In review queue: show "Overdue" badge on forecasts past due_date that haven't been realized
- Add bulk action: "Dismiss overdue" — reject all overdue forecasts that likely already happened
- On home screen: show overdue forecast count if > 0

**Tests:** Forecast with past due_date shows overdue badge. Dismiss works.
**Acceptance:** Overdue forecasts are highlighted and can be batch-dismissed.

---

### V1-5.4: Review Queue on Expenses Tab (F10) [x]
**Prereqs:** Read `app/(tabs)/expenses.tsx`, `components/expense/ReviewQueueItem.tsx`
**What to build:**
- Add collapsible "Pending Review ({count})" section at top of expenses FlatList
- Use existing `ReviewQueueItem` component with swipe-to-approve/reject
- Auto-expand if pending items exist, collapsed if 0
- Tapping an item navigates to expense detail for editing
- After approving/rejecting, item disappears with animation

**Tests:** Review section shows when pending items exist. Approve/reject works inline. Section hides when empty.
**Acceptance:** Users can review expenses directly from the expenses tab without going to a separate screen.

---

### V1-5.5: Budget Collapsible Sections (F11) [x]
**Prereqs:** Read `app/(tabs)/budget.tsx`
**What to build:**
- New reusable component: `CollapsibleSection` (animated expand/collapse with react-native-reanimated)
- Wrap these in CollapsibleSection:
  - Summary card (default: expanded)
  - Month-End Projection card (default: collapsed)
  - Upcoming Dues card (default: collapsed)
- Each section has a header with title + chevron + tap to toggle
- Persist collapse states in MMKV (so they survive app restart)

**Tests:** Sections expand/collapse with animation. State persists across app restart. Content renders correctly in both states.
**Acceptance:** Budget screen less overwhelming. Users expand sections they want.

---

### V1-5.6: Upcoming Dues on Home Screen (F11) [x]
**Prereqs:** Read `app/(tabs)/index.tsx` (home screen), `services/expense.ts` (getForecastExpenses)
**What to build:**
- New "Upcoming Dues" card on home screen (after Budget Health Card, before Hisaab)
- Pull from `getForecastExpenses()` filtered to approved + pending_review forecasts with due dates
- Show: count, total amount, next due date
- Per item: description, bank card details (from account), due date, amount
- "Overdue" badge for past-due items
- Tap to navigate to review queue or expense detail

**Tests:** Dues card shows when forecast expenses exist. Hidden when none. Overdue badge works.
**Acceptance:** Home screen shows upcoming financial obligations like Axio's "Dues & Reminders".

---

## PHASE 6: Color Scheme Refresh (F7)

> **Goal:** Lighter, Notion-inspired color palette. Modern, clean aesthetic.

### V1-6.1: Theme & Tailwind Color Update (F7) [x]
**Prereqs:** Read `constants/theme.ts`, `tailwind.config.js`
**What to build:**
- Update light mode palette:
  - background: #FFFFFF, surface: #F7F7F5, surface-alt: #EFEFED
  - text-primary: #1A1A1A, text-secondary: #6B7280, text-tertiary: #9CA3AF
  - border: #E5E5E3
  - primary: #2563EB (blue) or #0F766E (teal) — decide based on overall feel
  - primary-50 through primary-900 scale
  - success: #16A34A, danger: #DC2626, warning: #D97706
- Refine dark mode to complement lighter palette
- Update `Shadows` export if needed

**Tests:** App renders in both light and dark mode without missing colors.
**Acceptance:** Light mode feels like Notion — clean, warm, spacious. Dark mode still functional.

---

### V1-6.2: Screen-by-Screen Color QA (F7) [x]
**Prereqs:** Complete V1-6.1
**What to build:**
- Since D2 migrated to semantic tokens, most screens should auto-update
- Grep for remaining hardcoded hex values (from D2 audit: ~121 remaining)
- Fix any hardcoded colors that don't match new palette
- Check all screens in both light and dark mode:
  - Tab screens: home, expenses, budget, goals, settings
  - Sub-screens: add expense, expense detail, budget detail, all goals screens, all settings screens, hisaab screens

**Tests:** Visual inspection of every screen in both modes.
**Acceptance:** No jarring color mismatches. Consistent palette everywhere.

---

### V1-6.3: Icon & Typography Refinement (F7) [x]
**Prereqs:** Complete V1-6.2
**What to build:**
- Review icon usage across screens — ensure consistent icon sizes and styles
- Check Ionicons for more modern alternatives where appropriate
- Ensure font weights and sizes follow the type scale (display/title/headline/body/caption/label/micro)
- More whitespace between sections (Notion-like breathing room)

**Tests:** Visual inspection — overall feel should be lighter and more modern.
**Acceptance:** App feels premium and modern. Notion/Axio-inspired but distinctly Artha.

---

## PHASE 7: V1 Documentation + Testing + APK

### V1-7.1: Write V1 PRD [x]
**What to build:**
- `docs/V1/PRD_V1.md` — Feature descriptions for F1-F12
- Updated data model with new columns
- Updated entity descriptions (Expense with merchant/split, InvestmentBucket with FY, etc.)

---

### V1-7.2: Write V1 TDD [x]
**What to build:**
- `docs/V1/TDD_V1.md` — Schema changes (migrations 015-016)
- New services and functions
- Updated architecture diagrams

---

### V1-7.3: Integration Tests [x]
**What to build:**
- Tests for: split expense service, derive plan service, forecast matching, merchant field, FY-decoupled buckets/profiles
- Update existing tests that reference changed schemas or interfaces

**Acceptance:** All tests pass. Coverage for critical new paths.

---

### V1-7.4: V1 APK Build [x]
**What to build:**
- `npx expo prebuild --platform android --clean`
- Set `sdk.dir` in `android/local.properties`
- `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"` ./gradlew assembleRelease
- Install and test all F1-F12 features on device

**Acceptance:** APK installs. All features work. No regressions from MVP.

---

## TASK DEPENDENCY GRAPH

```
Phase 0: V1-0.1 (Mig 015) ──┬── Phase 2 (F8, F6) ── Phase 3 (F1)
                              │
         V1-0.2 (Mig 016) ──┴── Phase 4 (F3, F4, F12)

Phase 1: V1-1.1, V1-1.2, V1-1.3 (parallel, no deps)

Phase 5: V1-5.1 to V1-5.6 (after Phase 2 complete)

Phase 6: V1-6.1 to V1-6.3 (last — touches all screens)

Phase 7: V1-7.1 to V1-7.4 (final)
```

Total: **42 tasks** across 8 phases.
