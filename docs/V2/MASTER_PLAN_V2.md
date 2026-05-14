# Artha (अर्थ) — Version 2 Master Plan & Progress Tracker

**Purpose:** Single source of truth for V2 development. Claude MUST read this file at the start of every session and after every context compaction.

**Predecessor:** V1 at `docs/V1/MASTER_PLAN_V1.md` (42 tasks, 844 tests, 12 features — COMPLETE).

---

## SESSION LOG (Most Recent First)

> **After every task completion or context compaction, add an entry here.**
> Format: `[Date] — Task — What was done — What's next`

| Date | Task | What Was Done | Next Up |
|------|------|---------------|---------|
| 2026-04-13 | V2-6.3 | APK Build: bumped version 1.0.0 → 2.0.0, expo prebuild --clean, gradle assembleRelease BUILD SUCCESSFUL (4m17s). APK: android/app/build/outputs/apk/release/app-release.apk (96MB). V2 COMPLETE. | — |
| 2026-04-13 | V2-6.2 | Updated CLAUDE.md: all V2 features marked Complete, version table updated (917 tests), app version 2.0.0. | V2-6.3: APK Build |
| 2026-04-13 | V2-6.1 | V2 integration tests: added account-type-keywords.test.ts (22 tests for inferAccountTypeFromKeywords), tags.test.ts (12 tests for tags CRUD), expense-filters.test.ts (5 tests for accountId+tagIds filters). 917 tests across 46 suites. | V2-6.2: Update Docs |
| 2026-04-13 | V2-5.6 | Monthly Comparison: monthly.tsx with compare mode selector (vs last month/2ago/3ago), total comparison card with change %, highlights (biggest increase/decrease), category-by-category table, payment mode table. Phase 5 complete. F11 done. | V2-6.1: Integration Tests |
| 2026-04-13 | V2-5.5 | Right-Spend Trends: right-spend.tsx with current right-spend % gauge, 6-month trend bars, avoidable spending breakdown by category, recommendation engine. 878 tests pass. | V2-5.6: Monthly Comparison |
| 2026-04-13 | V2-5.4 | Payment Method Analytics: payment-methods.tsx with stacked bar chart, legend, per-mode detail with monthly trends. 878 tests pass. | V2-5.5: Right-Spend Trends |
| 2026-04-13 | V2-5.3 | Account Analytics: accounts.tsx with per-account spending breakdown, credit card utilization gauge, monthly trend. 878 tests pass. | V2-5.4: Payment Methods |
| 2026-04-13 | V2-5.2 | Merchant Analytics: merchants.tsx with ranked list (progress bars), time range selector (1/3/6 months), tap-to-expand detail (monthly trend, categories used, recent transactions). Added getMerchantDetail + getAccountAnalytics + getPaymentModeTrend + getRightSpendTrend + getMonthlyComparison services. 878 tests pass. | V2-5.3: Account Analytics |
| 2026-04-13 | V2-5.1 | Insights Navigation + Shell: created app/insights/ with _layout.tsx (Stack navigator with 6 screens). Hub screen (index.tsx) with Key Insights card + 5 analytics cards (Merchants, Accounts, Payment Methods, Right-Spend, Monthly Comparison) each showing preview stats from getSpendingInsights. Added Insights card to home screen between Hisaab and Recent Transactions. 878 tests pass. | V2-5.2: Merchant Analytics |
| 2026-04-13 | V2-4.4 | Tags settings screen (CRUD with color picker, usage counts). Tags filter on expenses (multi-select chips). Tag chips shown in expense list rows. Settings nav link added. Phase 4 complete. | V2-5.1: Insights Shell |
| 2026-04-13 | V2-4.3 | TagPicker component: autocomplete dropdown, create-new, colored chips with remove. Wired to expense detail (replaced Attach Receipt placeholder) + expense add (controlled mode with tag saving after create). | V2-4.4: Tags Settings + Filter |
| 2026-04-13 | V2-4.2 | Tag service: created services/tags.ts with full CRUD (getTags, getTagsForExpense, createTag, findOrCreateTag, addTagToExpense, removeTagFromExpense, deleteTag, updateTag, getTagUsageCount). Auto-color from 10-color palette. | V2-4.3: Tag UI |
| 2026-04-13 | V2-4.1 | Migration 021: tags table + expense_tags join table with cascade deletes. 3 indexes. Updated database.test.ts (24 tables, 41 indexes, 21 migrations). | V2-4.2: Tag Service |
| 2026-04-13 | V2-3.6 | Merchant alias settings screen: list all aliases, add manually, delete. Settings nav link added. Phase 3 complete. | V2-4.1: Tags Migration |
| 2026-04-13 | V2-3.5 | Merchant alias service: created merchant-alias.ts with cleanMerchantName() (strips PYU*/CAS*/RAZORPAY* prefixes + corporate suffixes), normalizeMerchantName() (alias lookup), learnMerchantAlias() (auto-learn from edits). Wired into sms-to-expense.ts pipeline. Added auto-learn to updateExpense. 13 tests added (878 total). | V2-3.6: Alias Settings |
| 2026-04-13 | V2-3.4 | Migration 020: merchant_aliases table (id, user_id, sms_name, canonical_name, category_id, created_at) with unique index on (user_id, sms_name). Registered in index.ts, updated database.test.ts (22 tables, 38 indexes, 20 migrations). | V2-3.5: Merchant Alias Service |
| 2026-04-13 | V2-3.3 | Account filter on expenses page: added accountId to ExpenseFilters + WHERE clause in getExpensesPaginated. Loaded accounts in expenses.tsx, added account filter chip row (BANK TYPE ****LAST4 format). Wired to query, clearFilters, hasActiveFilters. | V2-3.4: Merchant Aliases Migration |
| 2026-04-13 | V2-3.2 | UPI P2M vs P2A: added upiSubtype field to ParsedSMS, detectUpiSubtype() helper in bank-patterns.ts, post-parse UPI enrichment in sms-parser.ts. Updated sms-to-expense.ts: upi_debit in REALIZED_TYPES, "(UPI Transfer)" for P2A, "(UPI Payment)" for P2M in descriptions. | V2-3.3: Account Filter |
| 2026-04-13 | V2-3.1 | Account type keyword detection: added inferAccountTypeFromKeywords() in financial-account.ts — regex keywords for credit_card/loan/savings/wallet. Integrated into sms-parser.ts as post-parse enrichment. Overrides pattern default when keywords give specific answer. | V2-3.2: UPI P2M/P2A |
| 2026-04-13 | V2-2.10 | Upcoming Dues Lifecycle: created ForecastActionBar component (3 buttons: Mark Paid/Realise/Delete, compact mode). Added markForecastAsPaid() service (searches ±5% amount ±7 days for matching realized expense). Wired to home screen, budget widget, and expense detail. Phase 2 complete. | V2-3.1: Account Type Detection |
| 2026-04-13 | V2-2.9 | Removed Capital Gains Tax Rates reference link card from investment-detail.tsx. CG info now only accessible from income calculator. F12 complete. | V2-2.10: Upcoming Dues Lifecycle |
| 2026-04-13 | V2-2.8 | Splash screen rework: light/dark mode aware (Appearance API), larger logo (88px), prominent "अर्थ" Devanagari title, "ARTHA" English subtitle, italic tagline. Inline styles (NativeWind not initialized during splash). F6 complete. | V2-2.9: Remove CG |
| 2026-04-13 | V2-2.7 | SMS custom date range: replaced 6 presets with 4 (30d/90d/6mo/1yr) + "Custom Range" with FROM/TO text inputs. Added end date support (getSmsEndDate/setSmsEndDate in sms-permissions.ts). Updated sms-reader.ts with maxDate filtering. Default start date changed to 30 days ago. F5 complete. | V2-2.8: Splash Screen |
| 2026-04-13 | V2-2.6 | Review queue redesign: already had grouping, batch actions, swipe icons, empty state. Added summary bar ("X items to review" + hint), renamed "Transactions" → "Auto-Detected". F4 feature complete. | V2-2.7: SMS Custom Date Range |
| 2026-04-13 | V2-2.5 | Pending review redesign: replaced inline review list with preview card (max 3 items + count badge + total + "Review All →" CTA). Removed inline approve/reject from expenses tab. Cleaner visual separation from expense list. | V2-2.6: Review Queue Redesign |
| 2026-04-13 | V2-2.4 | Better error messages: created ErrorBanner component, formatError/getErrorMessage utils. Updated 15+ catch blocks across 10 files (review-queue, expenses, [id], add, salary-calculator, budget-config, templates, payment-mode-edit, category-edit, import-excel) with console.error + specific messages. | V2-2.5: Pending Review Redesign |
| 2026-04-13 | V2-2.3 | Created WidgetCard component (Card+CollapsibleSection+close button+fade/scale animation). Refactored all 3 budget widgets to use WidgetCard. Exported from ui/index.ts. | V2-2.4: Better Error Messages |
| 2026-04-13 | V2-2.2 | Widget management UI: gear icon in month selector bar, toggleable panel with Switch for each widget (summary/projection/dues). WIDGET_CONFIG constant. Toggle persists to MMKV. | V2-2.3: Widget Card Component |
| 2026-04-13 | V2-2.1 | Budget widgets scrollable + removable: replaced FlatList with ScrollView, added MMKV-persisted widget visibility (summary/projection/dues), close X button on each widget. getBudgetWidgets/setBudgetWidgets in settings.ts. | V2-2.2: Widget Management UI |
| 2026-04-13 | V2-1.6 | Added 21 tests: 8 for computeBonusTax (marginal method, cess, slab boundaries, zero-tax bracket) + 13 for computeCapitalGainsTax (per-type rates, exemptions, slab stacking, old vs new regime). 865 total tests pass. | V2-2.1: Budget Widgets |
| 2026-04-13 | V2-1.5 | Save as Draft: dual buttons (Save Draft + Save & Use), draft indicator banner, draft badge on yearly-plan Income card, saveProfile(status) refactor. Draft skips validation, doesn't update yearly plan. | V2-1.6: Tests |
| 2026-04-13 | V2-1.4 | Income calculator layout rework: removed duplicate directBonus, added 6 per-type CG fields with live tax, bonus tax display, collapsible Old Regime Deductions + Additional Income, grand total with post-tax values. Updated salary-profile.ts create/update for new fields. | V2-1.5: Save as Draft |
| 2026-04-13 | V2-1.3 | Added computeCapitalGainsTax() to tax-engine.ts: 6 asset classes (equity LTCG 12.5% with Rs 1.25L exemption, equity STCG 20%, debt/FD at slab rate via marginal method, gold 12.5%, real estate 12.5%). Added computeMarginalSlabTax() helper. | V2-1.4: Layout Rework |
| 2026-04-13 | V2-1.2 | Added computeBonusTax() to tax-engine.ts using marginal method: tax on (salary+bonus) - tax on salary, with 4% cess. Returns gross/tax/net/effectiveRate. | V2-1.3: Capital Gains Tax |
| 2026-04-13 | V2-1.1 | Migration 019: added status (draft/complete) + 6 per-type capital gains columns to salary_profiles. Updated types in salary-profile.ts, database.test.ts, migration index. | V2-1.2: Bonus Tax |
| 2026-04-13 | V2-0.8 | All 844 tests pass after Phase 0 bug fixes. | V2-1.1: Migration 019 |
| 2026-04-13 | V2-0.7 | Updated splash screen: imageWidth 200→300, backgroundColor to brand blue #2563EB. Regenerated all app icons via Python/Pillow with Devanagari "अ". | V2-0.8: Run Tests |
| 2026-04-13 | V2-0.6 | Regenerated Android adaptive icon: 432x432 foreground with white "अ" at 45% canvas, blue background, monochrome variant. | V2-0.7: Splash Screen |
| 2026-04-13 | V2-0.5 | Removed react-native-reanimated entry animations from home screen (5 Animated.View→View) and budget screen (1 Animated.View→View). | V2-0.6: Icon Fix |
| 2026-04-13 | V2-0.4d | Added "Paid for Family" button to ReviewQueueItem + wired to review-queue.tsx with lockedMode="they_owe_full" SplitSheet. | V2-0.5: Remove Animations |
| 2026-04-13 | V2-0.4c | Fixed bidirectional hisaab↔expense navigation: expense→hisaab uses ledger route with params, hisaab→expense shows clickable "Expense" badge on entries with linked_expense_id. | V2-0.4d: Paid for Family |
| 2026-04-13 | V2-0.4b | Wired SplitSheet to expense detail ([id].tsx) and review queue. Added split/paidForFamily handlers with approve-then-split flow. Skipped household.tsx (incompatible multi-person model). | V2-0.4c: Hisaab Navigation |
| 2026-04-13 | V2-0.4a | Built SplitSheet (modal bottom sheet with 4-step flow) + unified splitNewExpense/splitExistingExpense/computeSplitAmounts in expense.ts + getExpenseByLinkedEntry in hisaab.ts | V2-0.4b: Wire SplitSheet |
| 2026-04-13 | V2-0.3 | Payment mode seeding already existed from V1. Added missing Debit Card + NACH defaults to payment-modes.ts. | V2-0.4a: SplitSheet |
| 2026-04-13 | V2-0.2 | Migration 018: recreate salary_profiles with nullable yearly_plan_id. Updated index.ts, database.test.ts, SalaryProfile type. | V2-0.3: Seed Payment Modes |
| 2026-04-13 | V2-0.1 | Fixed CollapsibleSection: removed shouldRender unmount, added onLayout height measurement, animate height between 0 and measured value. Toggle cycle now reliable. | V2-0.2: Migration 018 |
| 2026-04-13 | V2 Planning | V2 plan created from 19 user feedback items + codebase investigation. 6 bugs + 12 features identified. PRD_V2.md, MASTER_PLAN_V2.md, TDD_V2.md written. | Task V2-0.1: Fix CollapsibleSection |

---

## CURRENT STATE

> **Quick glance: Where are we right now?**

- **Current Version:** V2
- **Current Phase:** Phase 5 (Insights Dashboard)
- **Current Task:** NONE — V2 COMPLETE
- **Last Completed:** V2-6.3 (APK Build)
- **V1 Status:** COMPLETE (42 tasks, 844 tests, 17 migrations)
- **V2 Status:** COMPLETE — 52 of 52 tasks complete
- **Test Status:** 917 tests pass across 46 suites
- **APK:** `android/app/build/outputs/apk/release/app-release.apk` (96MB)
- **Blockers:** None

---

## MANDATORY BEHAVIORS

### Before Starting Any Work
```
1. Read CLAUDE.md (project context)
2. Read this file (MASTER_PLAN_V2.md) — check SESSION LOG and CURRENT STATE
3. Find the next task with [ ] status
4. Read that task's prerequisite files
5. Execute the task
```

### After Completing Any Task
```
1. Mark the task [x] in the task list below
2. Add an entry to the SESSION LOG above
3. Update CURRENT STATE above
4. If a feature is complete, update CLAUDE.md "V2 Feature Roadmap" status
```

### After Every Context Compaction
```
1. IMMEDIATELY read docs/V2/MASTER_PLAN_V2.md
2. Check SESSION LOG — understand what was done
3. Check CURRENT STATE — understand where you are
4. Resume the current task or start the next one
```

---

## V2 FEATURE SUMMARY

| # | Feature | Size | Tasks | Status |
|---|---------|------|-------|--------|
| B1-B6 | Bug Fixes | M | V2-0.1 to V2-0.8 | [x] |
| F1 | Income Calculator Rework | XL | V2-1.1 to V2-1.6 | [x] |
| F2 | Budget Widgets | M | V2-2.1 to V2-2.3 | [x] |
| F3 | Better Error Messages | S | V2-2.4 | [x] |
| F4 | Review Queue UX Redesign | M | V2-2.5 to V2-2.6 | [x] |
| F5 | SMS Custom Date Range | S | V2-2.7 | [x] |
| F6 | Splash Screen Update | S | V2-2.8 | [x] |
| F7 | SMS Account Type Detection | M | V2-3.1 to V2-3.2 | [ ] |
| F8 | Account Filter on Expenses | S | V2-3.3 | [x] |
| F9 | Merchant Identification | L | V2-3.4 to V2-3.6 | [x] |
| F10 | Tags System | L | V2-4.1 to V2-4.4 | [x] |
| F11 | Insights Dashboard | XL | V2-5.1 to V2-5.6 | [ ] |
| F12 | Remove CG from Investment Detail | S | V2-2.9 | [x] |

---

## PHASE 0: Bug Fixes

> **Goal:** Fix all reported bugs before building new features.

### V2-0.1: Fix CollapsibleSection Animation (B1) [x]
**Prereqs:** Read `components/ui/CollapsibleSection.tsx`
**What to build:**
- Fix `heightProgress` shared value not resetting on remount
- Use `onLayout` to measure actual content height instead of `undefined`
- Ensure toggle cycle works: expand → collapse → expand → collapse reliably
- Keep MMKV persistence of collapse state
- Test on budget page with all 3 sections

**Acceptance:** All CollapsibleSections can be toggled unlimited times. State persists across navigation.

---

### V2-0.2: Migration 018 — Make yearly_plan_id Nullable (B2, B3) [x]
**Prereqs:** Read `database/migrations/008_salary_profiles.ts`, `services/salary-profile.ts`
**What to build:**
- New migration `database/migrations/018_salary_profile_nullable_plan.ts`
- SQLite doesn't support ALTER COLUMN — recreate table:
  1. Create `salary_profiles_new` with `yearly_plan_id TEXT REFERENCES yearly_plans(id)` (nullable)
  2. Copy data from old table
  3. Drop old table
  4. Rename new → old
  5. Recreate indexes
- Register in `database/migrations/index.ts`
- Update `database.test.ts`

**Acceptance:** Salary profiles can be created without a yearly plan. Existing data preserved.

---

### V2-0.3: Seed Default Payment Modes on Startup (B2) [x]
**Prereqs:** Read `app/_layout.tsx` (seedDefaultCategories pattern), `services/expense.ts` (payment mode functions)
**What to build:**
- Create `seedDefaultPaymentModes(userId)` function
- Default modes: Cash, UPI, Credit Card, Debit Card, Bank Transfer, Wallet, NACH
- Call in `app/_layout.tsx` after database init (same pattern as categories)
- Idempotent: don't create if already exist

**Acceptance:** Payment modes exist on first launch. SMS scan doesn't fail FK on payment_mode_id.

---

### V2-0.4a: Build SplitSheet Component + Unified Split Service (B4) [x]
**Prereqs:** Read `services/expense.ts` (createSplitExpense, splitExistingExpense), `services/hisaab.ts`, `app/expense/add.tsx` (current split UI lines 219-384)
**What to build:**
- New `components/expense/SplitSheet.tsx` — reusable bottom sheet with:
  - Step 1: "Who paid?" toggle (I paid / {person} paid)
  - Step 2: Split mode selector (Split equally / They owe full / I owe full / By exact amounts / By percentage)
  - Step 3: Person picker from hisaab contacts (+ "Add new person" inline)
  - Step 4: Live preview showing each person's share with editable amounts
- New unified `splitExpense()` in `services/expense.ts`:
  - Replaces old `createSplitExpense()` + handles existing expenses
  - Computes shares based on split mode + who paid
  - Creates/updates expense + hisaab entries in single transaction
  - Direction logic: "I paid" → hisaab debit (they owe me), "{Person} paid" → hisaab credit (I owe them)
  - Auto-creates hisaab person if they don't exist yet
- New helpers in `services/hisaab.ts`:
  - `getEntryByLinkedExpense(expenseId)` — bidirectional lookup
  - `getExpenseByLinkedEntry(entryId)` — bidirectional lookup

**Acceptance:** SplitSheet renders correctly with all 5 split modes. Service correctly computes shares and creates bidirectional links. Unit tests for all split modes + direction logic.

---

### V2-0.4b: Wire SplitSheet to All Transaction Entry Points (B4) [x]
**Prereqs:** V2-0.4a complete. Read `app/expense/add.tsx`, `app/expense/[id].tsx`, `app/expense/review-queue.tsx`, `app/hisaab/household.tsx`
**What to build:**
- `app/expense/add.tsx` — Replace old percentage-only split UI with SplitSheet. "Split this expense?" toggle opens the sheet.
- `app/expense/[id].tsx` — Wire SplitSheet to "Split" action card (remove opacity-50 placeholder). On press: open SplitSheet with expense amount pre-filled.
- `app/expense/review-queue.tsx` — Add "Split" option in approve action. When approving an SMS-detected expense, user can optionally split before confirming.
- `app/hisaab/household.tsx` — Replace old equal/percentage/fixed segmented buttons with SplitSheet for consistency.

**Acceptance:** Split works identically from all 4 entry points. Same SplitSheet, same UX everywhere. Splitting an SMS-detected expense during review creates correct hisaab entry.

---

### V2-0.4c: Verify Hisaab Linkage + Bidirectional Navigation (B4) [x]
**Prereqs:** V2-0.4b complete
**What to build:**
- Expense detail: if expense has split, show "Split with {person} ({amount})" info card → tap navigates to hisaab person ledger
- Hisaab ledger entry: if entry has `linked_expense_id`, show "From: {expense description}" → tap navigates to expense detail
- Test scenarios:
  1. Manual add + split → verify hisaab entry created with correct direction (debit/credit)
  2. SMS expense approved + split → verify same
  3. Existing expense split from detail view → verify same
  4. Household expense → verify same
  5. Delete split → verify hisaab entry removed
  6. Delete expense with split → verify hisaab entry cleaned up

**Acceptance:** All bidirectional links work. Navigating expense → hisaab → expense round-trips correctly. Deletion cascades properly.

---

### V2-0.4d: Wire "Paid for Family" Action to Review Queue (B4) [x]
**Prereqs:** V2-0.4b complete (SplitSheet wired to review queue)
**What to build:**
- Add "Paid for Family" button to review queue alongside Approve/Reject for SMS expenses
- On press: open simplified person picker (skip split mode selection — always 100% to hisaab)
- Calls `splitExpense()` with `split_mode: 'they_owe_full'`, `paid_by: 'me'`
- Result: expense `amount=0`, hisaab debit for full amount, excluded from budget
- Also available on expense detail as "I paid for someone else" option in split menu

**Acceptance:** User can route an SMS-detected expense entirely to hisaab from the review queue with 2 taps (Paid for Family → pick person). Expense shows ₹0 in budget. Hisaab shows full amount owed.

---

### V2-0.5: Remove Entry Animations (B5) [x]
**Prereqs:** Read `app/(tabs)/index.tsx`, `app/(tabs)/budget.tsx`
**What to build:**
- Remove all `entering={FadeInDown...}` props from cards in home and budget pages
- Remove `Animated.View` wrappers that only exist for entry animation
- Keep `Animated` imports only if used for other purposes (e.g., collapsible)

**Acceptance:** Home and budget pages render instantly without slide-in animations.

---

### V2-0.6: Fix App Icon Sizing (B6) [x]
**Prereqs:** Read `app.json` (adaptive icon config), check current icon dimensions
**What to build:**
- Redesign `android-icon-foreground.png`:
  - Sanskrit character "अ" or "अर्थ" with proper padding
  - Character should fit within ~40-50% of canvas area
  - Canvas: 432x432px (standard for xxxhdpi)
  - Safe zone: inner 288px diameter — character must fit here
- Update `android-icon-background.png` if needed (solid #2563EB is fine)
- Update `android-icon-monochrome.png` with same proportions
- Test in both circle and squircle launcher shapes

**Acceptance:** Icon looks properly sized in app drawer. Not cut off in any mask shape.

---

### V2-0.7: Update Splash Screen (B6 + F6) [x]
**Prereqs:** Read `app.json` (splash-screen plugin config), `app/_layout.tsx` (splash logic)
**What to build:**
- Update splash screen to show:
  - Artha logo (matching new icon)
  - "अर्थ" large Devanagari text
  - "your finances, your way" English subtitle
- Light mode: white background, dark text
- Dark mode: #111111 background, white text
- Maintain 2.5s minimum duration

**Acceptance:** Splash shows logo + tagline. Readable before app loads.

---

### V2-0.8: Run Tests + Verify All Fixes [x]
**What to build:**
- Run full test suite — all 844+ tests must pass
- Manually verify each bug fix on emulator
- Update any tests broken by migration 018

**Acceptance:** All tests pass. All 6 bugs confirmed fixed.

---

## PHASE 1: Income Calculator Rework (F1)

> **Goal:** Comprehensive income calculator with proper bonus taxation, per-type capital gains, draft saving, and clean layout.
> **Depends on:** Phase 0 (B2/B3 fix for salary save)

### V2-1.1: Migration 019 — Income Calculator Schema (F1) [x]
**Prereqs:** Read `database/migrations/016_goals_v1_restructure.ts`
**What to build:**
- New migration `database/migrations/019_income_calculator_v2.ts`
- ALTER salary_profiles:
  - `status TEXT NOT NULL DEFAULT 'complete' CHECK(status IN ('draft','complete'))`
  - `capital_gains_equity_ltcg REAL NOT NULL DEFAULT 0`
  - `capital_gains_equity_stcg REAL NOT NULL DEFAULT 0`
  - `capital_gains_debt REAL NOT NULL DEFAULT 0`
  - `capital_gains_fd REAL NOT NULL DEFAULT 0`
  - `capital_gains_gold REAL NOT NULL DEFAULT 0`
  - `capital_gains_real_estate REAL NOT NULL DEFAULT 0`
- Register in index.ts, update database.test.ts

**Acceptance:** Migration runs. New columns default to 0/'complete'. Existing data preserved.

---

### V2-1.2: Bonus Tax Computation Service (F1-IC1) [x]
**Prereqs:** Read `services/salary-profile.ts`, `services/tax-engine.ts`
**What to build:**
- New function `computeBonusTax(annualSalaryIncome, bonusAmount, taxRegime)`:
  - Calculate tax on (salary + bonus) using slab rates
  - Subtract tax on salary alone
  - Difference = marginal tax on bonus
  - Return: `{ grossBonus, taxOnBonus, netBonus, effectiveRate }`
- Use existing tax slab rates from tax-engine.ts (or salary calculator computation)

**Acceptance:** Bonus taxed at correct marginal slab rate. Net bonus = gross - tax.

---

### V2-1.3: Capital Gains Tax Computation Service (F1-IC2) [x]
**Prereqs:** Read `services/capital-gains.ts` (existing rates)
**What to build:**
- New function `computeCapitalGainsTax(gains)`:
  - Input: per-type gross amounts (equity_ltcg, equity_stcg, debt, fd, gold, real_estate)
  - Per type: apply the correct rate from capital-gains.ts
  - Equity LTCG: 12.5% on amount exceeding Rs 1.25L exemption
  - Equity STCG: 20%
  - Debt MF, FD: at income slab rate (needs total income context)
  - Gold LTCG: 12.5%, Gold STCG: slab rate
  - Real Estate LTCG: 12.5%, Real Estate STCG: slab rate
  - Return: per-type `{ gross, tax, net }` + totals

**Acceptance:** Each asset class taxed at correct rate. Exemptions applied. Total post-tax capital gains computed.

---

### V2-1.4: Income Calculator Layout Rework (F1-IC3, IC4, IC6) [x]
**Prereqs:** Complete V2-1.2, V2-1.3. Read `app/goals/salary-calculator.tsx`
**What to build:**
- **Remove** duplicate `directBonus` field from Direct Input mode
- **Rearrange** layout per PRD Section 3/F1:
  1. FY Selector
  2. Mode Toggle
  3. CTC/Direct input section
  4. Calculated in-hand result
  5. Additional Income (collapsible) — bonus with tax display + capital gains per type
  6. Grand Total (salary post-tax + bonus post-tax + CG post-tax)
- **Make collapsible:** Old Regime Deductions section, Additional Income section
- **Capital gains input:** 6 fields (one per asset class) with live tax calculation
- **Bonus display:** "Rs X gross → Tax Rs Y (Z% slab) → Net Rs X-Y"

**Acceptance:** Clean top-to-bottom flow. No duplicate fields. All income at top, all calculations at bottom.

---

### V2-1.5: Save as Draft (F1-IC5) [x]
**Prereqs:** Complete V2-1.1 (migration), V2-1.4 (layout)
**What to build:**
- Two buttons at bottom: "Save as Draft" and "Save"
- "Save as Draft": saves all current values with `status = 'draft'`, no validation
- "Save": validates required fields, sets `status = 'complete'`
- On goals screen: show draft badge if salary profile is draft
- On load: restore draft data, show "Draft" indicator at top

**Acceptance:** User can partially fill and save draft. Resume later. Complete save validates.

---

### V2-1.6: Income Calculator Tests [x]
**Prereqs:** Complete V2-1.2 to V2-1.5
**What to build:**
- Test bonus tax computation (various slab brackets)
- Test capital gains tax per type (with exemptions)
- Test save/load draft
- Test layout renders correctly

**Acceptance:** New tests pass. All existing tests still pass.

---

## PHASE 2: UX Improvements (F2-F6, F12)

> **Goal:** Polish the UI/UX based on user feedback.

### V2-2.1: Budget Widgets — Scrollable + Removable (F2) [x]
**Prereqs:** Fix V2-0.1 first. Read `app/(tabs)/budget.tsx`
**What to build:**
- Replace fixed top sections with scrollable widget cards
- All budget content in single ScrollView (widgets + category list)
- Each widget has a close/remove "X" button in header
- MMKV key `budget_widgets_visible`: array of visible widget IDs
- Default: all 3 visible

**Acceptance:** Budget page scrolls fully. Widgets removable. Removal persists.

---

### V2-2.2: Widget Management UI (F2) [x]
**Prereqs:** Complete V2-2.1
**What to build:**
- "Manage Widgets" button (gear icon) at top of budget page
- Shows list of all available widgets with toggle switches
- Toggling ON adds widget back to budget page
- Toggling OFF removes it
- Alternatively: bottom sheet with widget list

**Acceptance:** User can restore removed widgets. Clear UI for widget management.

---

### V2-2.3: Widget Card Component (F2) [x]
**Prereqs:** V2-0.1 (CollapsibleSection fix)
**What to build:**
- New `WidgetCard` component wrapping `CollapsibleSection`
- Adds: close button (top-right "X"), optional badge
- Removal animation (slide out or fade)
- Consistent styling across all widgets

**Acceptance:** WidgetCard looks clean. Close button works. Animation smooth.

---

### V2-2.4: Better Error Messages (F3) [x]
**Prereqs:** Read all files with `catch` blocks and generic error alerts
**What to build:**
- Audit all try/catch blocks across the app
- Replace generic "Failed to..." messages with specific reasons
- Format: "[Action] failed: [specific reason]"
- Add new `ErrorBanner` component for inline (non-blocking) errors
- Log error details to console for debugging
- Key files: salary-calculator.tsx, sms-reader.ts, expense.ts, hisaab.ts

**Acceptance:** Errors explain what went wrong. User can self-diagnose common issues.

---

### V2-2.5: Pending Review Section Redesign (F4) [x]
**Prereqs:** Read `app/(tabs)/expenses.tsx` (pending review section)
**What to build:**
- Replace simple collapsible with distinct visual card
- Prominent count badge (e.g., orange pill "5 pending")
- Show max 3 preview items with amount + merchant
- "Review All →" button navigating to full review queue
- Clear visual separation from expense list below
- When 0 items: section hidden entirely (not empty collapsed)

**Acceptance:** Pending review section is visually distinct. Clear CTA to review.

---

### V2-2.6: Review Queue Page Redesign (F4) [x]
**Prereqs:** Read `app/expense/review-queue.tsx`
**What to build:**
- Group items by type: "Auto-Detected" / "Matched Forecasts" / "Overdue"
- Each group has count badge + batch action ("Approve All", "Dismiss All Overdue")
- Better swipe action labels with icons
- Filter options: by bank, date range
- Empty state: checkmark illustration + "All caught up!"
- Summary at top: "X items to review"

**Acceptance:** Review queue organized by type. Batch actions work. Empty state shows.

---

### V2-2.7: SMS Custom Date Range (F5) [x]
**Prereqs:** Read `app/(tabs)/settings.tsx` or wherever SMS scan UI lives
**What to build:**
- Remove fixed "Last 6 months" and "1 year" buttons
- Add date range picker: "From" and "To" date inputs
- Quick presets: "Last 30 days", "Last 90 days", "Custom"
- "Custom" shows native date pickers
- Default: last 30 days
- Pass date range to SMS reader service

**Acceptance:** User can scan SMS for any custom date range.

---

### V2-2.8: Splash Screen with Logo + Tagline (F6) [x]
**Prereqs:** V2-0.7 (icon fix)
**What to build:**
- Custom splash screen component (not just Expo splash plugin image)
- Layout:
  - Center: Artha logo/icon
  - Below: "अर्थ" in large Devanagari
  - Below: "your finances, your way" in smaller English
- Light/dark mode aware
- 2.5s minimum visible time (existing V1 behavior)

**Acceptance:** Splash shows full branding. Same logo as app icon.

---

### V2-2.9: Remove Capital Gains from Investment Detail (F12) [x]
**Prereqs:** Read `app/goals/investment-detail.tsx`
**What to build:**
- Remove capital gains tax rate display section
- Keep all other investment detail content
- Link to capital gains reference page remains in income calculator only

**Acceptance:** Investment detail shows investment info only. No tax rates.

---

### V2-2.10: Upcoming Dues Lifecycle Actions (F13) [x]
**Prereqs:** Read `services/expense.ts` (realizeForecast, findMatchingForecast, dismissOverdueForecasts), `app/(tabs)/index.tsx` (upcoming dues card), `app/(tabs)/budget.tsx` (forecast list)
**What to build:**
- New `components/expense/ForecastActionBar.tsx` — reusable action bar with 3 buttons:
  - **Mark as Paid:** calls new `markForecastAsPaid(id)` — searches for matching realized expense (same account, ±5% amount, ±7 days), links via `matched_forecast_id` if found, rejects forecast
  - **Realise Now:** calls existing `realizeForecast(id, today)` — converts to realized expense, counts in budget
  - **Delete:** sets `status='rejected'` — disappears from upcoming dues
- New `markForecastAsPaid(id)` in `services/expense.ts`
- Wire ForecastActionBar to:
  - Home screen upcoming dues card (swipe or long-press)
  - Budget screen forecast list (compact inline buttons)
  - Review queue "Upcoming" section (full buttons)
  - Expense detail when viewing a forecast (action bar at bottom)

**Acceptance:** All 3 actions work from all 4 screens. "Mark as Paid" correctly finds and links matching realized expenses. "Realise Now" converts forecast to budget expense. "Delete" removes forecast. Confirmation dialogs prevent accidental actions.

---

## PHASE 3: SMS/Data Improvements (F7, F8, F9)

> **Goal:** Better account type detection, merchant identification, account filtering.
> **Depends on:** Phase 0 (bug fixes)

### V2-3.1: Account Type Keyword Detection (F7) [x]
**Prereqs:** Read `services/sms/bank-patterns.ts`, `services/financial-account.ts`, `Downloads/Bank SMS Example.txt`
**What to build:**
- Update all 60+ bank patterns to explicitly set `accountType` based on SMS keywords:
  - "Card" / "Card no." → `credit_card`
  - "A/c no." / "Acc" / "Avl Bal" → `savings`
  - "Loan A/c" → `loan`
  - "Wallet" → `wallet`
  - "Credit Card" (in Standing Instruction) → `credit_card`
- Remove fallback "default to savings" from `inferAccountType()`
- Unknown type → null (user classifies in review)

**Tests:**
- Test each keyword pattern sets correct account type
- Test unknown SMS gets null account type

**Acceptance:** Account type correctly detected from SMS. No false "savings" defaults.

---

### V2-3.2: UPI P2M vs P2A Detection (F7, F9) [x]
**Prereqs:** Read bank-patterns.ts (Axis UPI patterns)
**What to build:**
- Parse UPI reference: `UPI/P2M/ref/MERCHANT` vs `UPI/P2A/ref/PERSON`
- P2M: set `merchant` from 4th UPI segment, `type: 'upi_p2m'`
- P2A: set `merchant` from 4th segment as person name, `type: 'upi_p2a'`
- In sms-to-expense.ts: P2A transactions flagged differently (optional: suggest hisaab entry)
- Add `transaction_subtype` or use existing `type` field for P2M/P2A

**Tests:** P2M creates expense with merchant. P2A flagged as person transfer.

**Acceptance:** UPI merchant vs person transfers clearly distinguished.

---

### V2-3.3: Account Filter on Expenses Page (F8) [x]
**Prereqs:** Read `app/(tabs)/expenses.tsx` (existing filters), `services/financial-account.ts`
**What to build:**
- Add account filter dropdown alongside category and payment mode filters
- Load accounts from `getAccounts()` service
- Display as: "ICICI CREDIT 3001", "AXIS SAVINGS 2836", etc.
- Filter query: `WHERE account_id = ?`
- Clear filter option

**Acceptance:** User can filter expenses by bank account. Works with other filters.

---

### V2-3.4: Migration 020 — Merchant Aliases Table (F9) [x]
**Prereqs:** Read `database/defaults/merchant-mappings.ts`
**What to build:**
- New migration `database/migrations/020_merchant_aliases.ts`
- Create table: `merchant_aliases(id, user_id, sms_name, canonical_name, category_id, created_at)`
- Unique index on (user_id, sms_name)
- Seed with common Indian merchant aliases (Zomato, Swiggy, Amazon, Netflix, Uber, etc.)
- Register in index.ts, update database.test.ts

**Acceptance:** Table created. Seed data populated. Tests pass.

---

### V2-3.5: Merchant Name Normalization Service (F9) [x]
**Prereqs:** Complete V2-3.4. Read `services/sms/sms-to-expense.ts`
**What to build:**
- New function `normalizeMerchantName(userId, rawName)`:
  1. Strip prefixes: `PYU*`, `CAS*`, `InfoEBA*`
  2. Trim whitespace
  3. Look up in merchant_aliases by sms_name (case-insensitive)
  4. If found: return canonical_name
  5. If not: return cleaned raw name
- Wire into sms-to-expense.ts: normalize merchant before storing
- Auto-learn: if user edits merchant name on an expense, create alias

**Tests:** Normalize "ZOMATO LTD" → "Zomato". Strip "PYU*Swiggy Food" → "Swiggy". Unknown stays as-is.

**Acceptance:** SMS expenses get clean merchant names. Aliases auto-created from user edits.

---

### V2-3.6: Merchant Alias Management in Settings (F9) [x]
**Prereqs:** Complete V2-3.5
**What to build:**
- New settings screen: "Merchant Aliases"
- List all aliases: sms_name → canonical_name
- Edit canonical name
- Delete alias
- Add new alias manually
- Show alias count

**Acceptance:** User can manage merchant name mappings. Changes apply to future SMS scans.

---

## PHASE 4: Tags System (F10)

> **Goal:** Replace "Attach Receipt" with taggable labels on expenses.
> **Depends on:** Phase 2 (UX improvements)

### V2-4.1: Migration 021 — Tags Tables (F10) [x]
**Prereqs:** None
**What to build:**
- New migration `database/migrations/021_tags.ts`
- Create `tags(id, user_id, name, color, created_at)` with unique index on (user_id, name)
- Create `expense_tags(expense_id, tag_id)` with composite PK and CASCADE deletes
- Index on tag_id for reverse lookups
- Register in index.ts, update database.test.ts

**Acceptance:** Tables created. Cascade delete works. Tests pass.

---

### V2-4.2: Tags Service Layer (F10) [x]
**Prereqs:** Complete V2-4.1
**What to build:**
- `services/tags.ts`:
  - `getTags(userId)` — all tags
  - `getTagsForExpense(expenseId)` — tags on a specific expense
  - `createTag(userId, name, color?)` — create new tag (auto-generate color if not specified)
  - `addTagToExpense(expenseId, tagId)` — add tag
  - `removeTagFromExpense(expenseId, tagId)` — remove tag
  - `findOrCreateTag(userId, name)` — auto-create if doesn't exist (for autocomplete)
  - `deleteTag(tagId)` — delete tag (cascades to expense_tags)
  - `updateTag(tagId, name?, color?)` — edit tag

**Tests:** CRUD operations for tags. Cascade delete. Find-or-create logic.

**Acceptance:** Full tag CRUD. Tags link to expenses many-to-many.

---

### V2-4.3: Tags UI on Expense Detail + Add (F10) [x]
**Prereqs:** Complete V2-4.2. Read `app/expense/[id].tsx`, `app/expense/add.tsx`
**What to build:**
- **Expense detail:** Replace "Attach Receipt" placeholder with tags section
  - Show existing tags as colored chips
  - "+" button to add tag
  - Tag picker: autocomplete dropdown with existing tags + "Create new" option
  - Long-press or swipe to remove tag from expense
- **Expense add:** Optional tag selector below other fields
  - Same autocomplete tag picker
  - Selected tags shown as chips

**Acceptance:** Tags visible on expense detail. Can add/remove. New tags auto-created.

---

### V2-4.4: Tags Management in Settings + Filter (F10) [x]
**Prereqs:** Complete V2-4.3
**What to build:**
- New settings screen: "Tags"
  - List all tags with color, usage count
  - Edit tag name/color
  - Delete tag (with confirmation — cascades)
  - Create new tag
- Add tag filter to expenses page (alongside category, payment mode, account)
  - Multi-select: show expenses with ANY of selected tags
- Show tag chips in expense list rows (small, below merchant/description)

**Acceptance:** Tag management in settings. Tag filter on expenses. Tags visible in list.

---

## PHASE 5: Insights Dashboard (F11)

> **Goal:** Analytics by merchant, account, payment method, right-spend.
> **Depends on:** Phase 3 (account detection, merchant normalization)

### V2-5.1: Insights Navigation + Shell [x]
**Prereqs:** Read `app/(tabs)/index.tsx` (home screen layout)
**What to build:**
- "Insights" card on home screen with tap to navigate
- New `app/insights/` directory with `_layout.tsx`
- Insights hub screen with cards: Merchants, Accounts, Payment Methods, Right Spend, Monthly Comparison
- Each card shows a preview stat + "View Details →"

**Acceptance:** Insights accessible from home. Hub shows preview cards.

---

### V2-5.2: Merchant Analytics Screen (F11-A) [x]
**Prereqs:** Read `services/spending-insights.ts` (analyzeMerchants)
**What to build:**
- `app/insights/merchants.tsx`
- Top merchants by spend (bar chart or ranked list)
- Transaction count per merchant
- Tap merchant → detail: all transactions, monthly trend, categories used, avg amount
- Time range selector: this month, last 3 months, last 6 months, custom
- New service: `getMerchantDetail(userId, merchantName, dateRange)`

**Acceptance:** Merchant list with spend ranking. Detail view with trends.

---

### V2-5.3: Account Analytics Screen (F11-B) [x]
**Prereqs:** Read `services/financial-account.ts`
**What to build:**
- `app/insights/accounts.tsx`
- Per-account spending breakdown (pie chart or list)
- Account monthly trend (line chart or bar)
- Credit card utilization: spend vs limit (if available)
- New service: `getAccountAnalytics(userId, dateRange)`

**Acceptance:** Account-level spending visible. Trends by account.

---

### V2-5.4: Payment Method Analytics Screen (F11-C) [x]
**Prereqs:** Read `services/spending-insights.ts` (analyzePaymentModes)
**What to build:**
- `app/insights/payment-methods.tsx`
- Payment mode split: UPI / Card / Cash / Wallet / Bank Transfer / NACH (donut chart)
- Trend over months: which payment method is growing/shrinking
- New service: `getPaymentModeTrend(userId, dateRange)`

**Acceptance:** Payment method breakdown with trend.

---

### V2-5.5: Right-Spend Trends (F11-D) [x]
**Prereqs:** Read `utils/spending-insights.ts`, `app/budget/spending-split.tsx`
**What to build:**
- `app/insights/right-spend.tsx`
- Monthly right-spend % over last 6 months (line chart)
- Which categories drive avoidable spending (ranked list)
- Month-over-month change in right-spend ratio
- Recommendation: "Reduce [category] by Rs X to reach Y% right-spend"
- New service: `getRightSpendTrend(userId, months)`

**Acceptance:** Right-spend trend visible. Actionable category breakdown.

---

### V2-5.6: Monthly Comparison View (F11-E) [x]
**Prereqs:** Read `app/summary/[month].tsx`
**What to build:**
- `app/insights/monthly-comparison.tsx`
- Side-by-side comparison: this month vs last month vs 3-month avg
- Dimensions: total spend, by category, by payment mode, right-spend %
- Highlights: biggest increase, biggest decrease
- Service: `getMonthlyComparison(userId, month1, month2)`

**Acceptance:** Clear month-over-month comparison. Highlights meaningful changes.

---

## PHASE 6: Testing + APK

### V2-6.1: Integration Tests for V2 Features [x]
**What to build:**
- Tests for: bonus tax computation, CG tax per type, merchant normalization, tags CRUD, account type detection, budget widgets
- Update existing tests for migration 018-021 changes
- All tests pass

**Acceptance:** Test count increases. All pass. Critical paths covered.

---

### V2-6.2: Update V2 Documentation [x]
**What to build:**
- Update PRD_V2.md status to Complete
- Update TDD_V2.md with final implementation details
- Update CLAUDE.md version table

**Acceptance:** Docs reflect actual implementation.

---

### V2-6.3: V2 APK Build [x]
**What to build:**
- Bump version: 1.0.0 → 2.0.0
- `npx expo prebuild --platform android --clean`
- Set `sdk.dir` in `android/local.properties`
- `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"` ./gradlew assembleRelease
- Install on Pixel 9 emulator
- Test all bug fixes + new features

**Acceptance:** APK installs. All features work. No regressions from V1.

---

## TASK DEPENDENCY GRAPH

```
Phase 0: Bug Fixes (V2-0.1 to V2-0.8)
  |
  ├── Phase 1: Income Calculator (V2-1.1 to V2-1.6) — needs B2/B3 fix
  │
  ├── Phase 2: UX Improvements (V2-2.1 to V2-2.9) — needs B1 fix
  │     |
  │     └── Phase 4: Tags (V2-4.1 to V2-4.4) — needs UX polish
  │
  └── Phase 3: SMS/Data (V2-3.1 to V2-3.6) — needs bug fixes
        |
        └── Phase 5: Insights (V2-5.1 to V2-5.6) — needs data quality
              |
              └── Phase 6: Testing + APK (V2-6.1 to V2-6.3)
```

Total: **52 tasks** across 7 phases.
