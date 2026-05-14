# Artha (अर्थ) — Master Plan & Progress Tracker

**Purpose:** This is the single source of truth for what's been done and what needs to happen next. Claude MUST read this file at the start of every session and after every context compaction.

---

## SESSION LOG (Most Recent First)

> **After every task completion or context compaction, add an entry here.**
> Format: `[Date] — Session/Task — What was done — What's next`

| Date | Session | What Was Done | Next Up |
|------|---------|---------------|---------|
| 2026-04-12 | Task 18.0 | **Phase 3 Integration Test & APK Build.** 802 tests pass across 39 suites. TypeScript clean (pre-existing import-excel.tsx errors only). APK built locally using Java 21 from Android Studio (`JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`). Release APK: 43MB at `android/app/build/outputs/apk/release/app-release.apk`. **Task 18.0 COMPLETE. Phase 3 COMPLETE.** | Phase 2: Task 13.0 Gmail OAuth or Phase 4: Task 19.0 Asset Tracker |
| 2026-04-12 | Tasks 16.1-17.1 | **Hisaab Phase 3 — Settlement + Export + Summary.** Task 16.1: Settlement tracking already built into ledger screen (settle button, credit/debit entries, household mark-paid). Task 17.0: New service `services/hisaab-export.ts` — generatePersonStatement (formatted text with header/balance/transactions/branding, Indian comma ₹ formatting) + generateHouseholdSummary (monthly overview with splits and paid status). Share buttons added to ledger screen and household screen using native Share API. 11 new tests. Task 17.1: Home dashboard Hisaab card enhanced with live balance data (totalOwedToYou/totalYouOwe) when outstanding balances exist. Dynamic card shows real numbers vs placeholder text. Fixed forecast-engine.ts import (getMonthRange→getMonthDateRange + manual daysInMonth). 802 tests pass across 39 suites, TypeScript clean. **Tasks 16.1, 17.0, 17.1 ALL COMPLETE.** | Task 18.0: Phase 3 Integration Test |
| 2026-04-12 | Task 15.1 | **Hisaab Ledger UI.** Created 4 new screens: `app/hisaab/_layout.tsx` (Stack navigator with 3 routes), `app/hisaab/persons.tsx` (person list with running balances summary card — owed to you/you owe/net, person cards with avatar+balance+entry count+last entry date, add/edit person form with name/phone/email/initial balance/notes, navigate to ledger on tap, deactivate on long-press, household expenses quick-link card), `app/hisaab/ledger.tsx` (per-person ledger detail — balance header with settle button, entry list with debit/credit/settlement cards, add entry form with type toggle debit/credit, edit entry on tap, delete on long-press, settlement form with current balance context), `app/hisaab/household.tsx` (household expense management — month navigator, monthly total card, expense list with split type badges, add expense form with description/amount/category/split type selector/participant checkboxes/auto-hisaab toggle, detail view with split cards and mark-paid checkmarks). Registered hisaab route group in root layout. Added Hisaab quick-access card on Home dashboard. Fixed TS errors: forecast-engine.ts getMonthRange→getMonthDateRange+manual daysInMonth calc, household-expense.test.ts mock typing. 791 tests pass across 38 suites, TypeScript clean. | Task 16.1: Settlement Tracking |
| 2026-04-12 | Task 16.0 | **Shared House Expenses — Tests.** Wrote 24 tests for `services/household-expense.ts`: calculateSplits pure function (12 tests: equal split, rounding remainder to last person, percentage split, fixed split, edge cases), createHouseholdExpense (8 tests: DB insert, split records, hisaab debit entries, skip entries flag, default/custom category, percentage storage, zero-amount skip), query operations (2 tests), delete + markSplitPaid (2 tests). 791 tests pass across 38 suites. **Phase 3 Tasks 15.0+16.0 COMPLETE.** | Task 15.1: Hisaab Ledger UI |
| 2026-04-12 | Tasks 15.0+16.0 | **Hisaab Schema & Services.** Migration 014: 4 tables — `hisaab_persons` (id, owner_user_id, name, phone, email, initial_balance, notes, is_active, created_at, updated_at), `hisaab_entries` (id, hisaab_person_id, amount, description, date, type CHECK debit/credit/settlement, status CHECK confirmed/pending/disputed, linked_expense_id FK, created_at, updated_at), `household_expenses` (id, user_id, description, amount, month, category, split_type CHECK equal/percentage/fixed, created_at, updated_at), `household_splits` (id, household_expense_id, hisaab_person_id, share_amount, share_pct, is_paid, created_at, ON DELETE CASCADE). 5 indexes. New service `services/hisaab.ts`: Person CRUD (createPerson, updatePerson, deactivatePerson, getPerson, getPersonsWithBalances with complex SQL balance calc), getPersonBalance, Entry CRUD (createEntry, updateEntry, deleteEntry, getEntries, getEntriesByDateRange), getHisaabSummary (totalOwedToYou/totalYouOwe/netBalance), recordSettlement. New service `services/household-expense.ts`: calculateSplits pure function (equal/percentage/fixed with rounding correction), createHouseholdExpense (creates expense + splits + optional hisaab debit entries), getHouseholdExpenses, getHouseholdSplits, deleteHouseholdExpense, markSplitPaid. 20 hisaab integration tests. Updated database.test.ts (20 tables, 28 indexes, 14 migrations). 767 tests pass across 37 suites. | Task 16.0 tests |
| 2026-04-12 | Tasks 22.0-24.0 | **Phase 5: Advanced Intelligence — ALL SERVICE LAYER COMPLETE.** Task 22.0: Spending Insights — `utils/spending-insights.ts` (calculateCategoryTrends, detectAnomalies, analyzeMerchants, analyzeDayPatterns, analyzePaymentModes, generateInsights with priority scoring) + `services/spending-insights.ts` (getSpendingInsights, getMerchantAnalytics). 34 tests. Task 23.0: Forecast Engine — `utils/forecast-engine.ts` (forecastMonthEnd with dynamic weighting: <5d=80%hist/20%pace, 5-15d=40%/60%, >15d=20%/80%; projectYearEnd with weighted average). `services/forecast-engine.ts` (getMonthEndForecast, getYearEndProjection). 16 tests. Task 23.1: Budget Recommendations — `utils/budget-recommendations.ts` (4 types: increase_budget, decrease_budget, set_budget, overall_adjustment with evidence-based thresholds). 13 tests. Task 23.2: Financial Health Score — `utils/financial-health.ts` (composite 0-100 from 5 dimensions: Budget Compliance 30%, Savings Rate 25%, Investment Progress 20%, Recurring Control 15%, Spending Stability 10%). 14 tests. Task 24.0: Export to Excel — `services/export-excel.ts` (6 sheets: Expenses, Monthly Summary, Categories, Payment Modes, Recurring, Accounts). 9 tests. 767 tests across 37 suites. | Phase 3: Tasks 15.0+16.0 |
| 2026-04-12 | Task 11.7 | **Recurring Transaction Detection.** Migration 013: `recurring_transactions` table (14 columns: id, user_id, merchant_normalized, amount, frequency, category_id, account_id, last_seen_date, next_expected_date, occurrence_count, is_active, is_confirmed, created_at, updated_at) with CHECK constraint on frequency, 2 indexes (idx_recurring_user, idx_recurring_merchant), FKs to users/categories/financial_accounts. New service `services/recurring-detector.ts`: 6 functions — `detectRecurringTransactions()` (full scan: groups approved expenses by normalized merchant, filters by 5% amount tolerance, calculates average interval, classifies frequency, upserts recurring records with predicted next_expected_date), `getRecurringTransactions()`, `confirmRecurring()`, `dismissRecurring()`, `getUpcomingRecurring(userId, days)`, `checkNewExpenseForRecurring()` (updates existing recurring on new matching expense). Pure utility functions: `classifyFrequency()` (weekly 5-10d, monthly 25-35d, quarterly 80-100d, yearly 340-395d) and `calculateNextDate()`. 19 new tests (frequency classification 5, next date calc 4, detection algorithm 4, CRUD 3, new expense matching 3). Updated database.test.ts (table count 15→16, index count 21→23, migration count 12→13, skip test 11→12, all-applied includes v13). 661 tests pass across 31 suites, TypeScript clean. **Tasks 11.3-11.7 ALL COMPLETE.** | Next: Task 13.0 Gmail OAuth |
| 2026-04-12 | Task 11.6 | **Refunds, NACH/Auto-Pay, Extended Dues.** Migration 012: `refund_of_expense_id` FK on expenses with index, `has_nach_mandate`/`nach_merchant`/`nach_amount` columns on financial_accounts. Added `refund_of_expense_id` to Expense interface. New functions: `findRefundTarget()` in expense.ts (searches 30-day window for same amount + card via account link), `updateNachInfo()` and `getUpcomingDues()` in financial-account.ts. Added `parseDateAny()` utility to bank-patterns.ts (tries DD-MMM-YY, DD-MM-YY, D-M-YYYY, DD/MM/YYYY formats). 8 new bank patterns: SBI Refund, Generic Refund, SBI NACH Debit, ICICI CC Total Due, Kotak CC Payment Reminder, SBI CC Statement, Axis CC Outstanding, IDFC First CC Due. Total: 61 patterns across 15+ banks. sms-to-expense.ts: expanded to handle refund type (creates expense with refund_of_expense_id link to original), nach_debit type (creates expense + updates account NACH info), nach_bounce (skips expense creation, updates account only), amount_due_reminder (creates forecast + updates account dues). Updated buildDescription for refund/NACH labels. 10 new tests (8 pattern tests, 2 service tests for updateNachInfo/getUpcomingDues). Updated database.test.ts assertions (index count 20→21, migration count 11→12, skip test 10→11, all-applied includes v12). 642 tests pass across 30 suites, TypeScript clean. | Task 11.7: Recurring Detection |
| 2026-04-12 | Task 11.5 | **Financial Accounts Discovery + CC/Balance Tracking.** Migration 011: `financial_accounts` table (16 columns, unique index on user_id+account_identifier+bank_name+account_type, user index on user_id+is_active, expenses account index). `account_id` FK added to expenses table. New service `services/financial-account.ts`: 10 functions (discoverOrUpdateAccount, updateAccountFromSMS, linkExpenseToAccount, getActiveAccounts, getAccountSummary, getAccountExpenses, deactivateAccount, renameAccount, updateAccountDues, inferAccountType). Account type inference: explicit accountType field > creditLimit/availableCreditLimit heuristic > wallet platform check > savings default. Integrated into sms-to-expense.ts: `discoverOrUpdateAccount()` called on every SMS processing, `linkExpenseToAccount()` called after every expense creation (realized, forecast, and forecast-to-realized conversion). Updated Expense interface + CreateExpenseInput with `account_id`. 24 new tests covering all service functions. Updated database.test.ts assertions (table count 14→15, index count 17→20, migration count 9→11, skip test 8→10, all-applied list includes v10+v11). 632 tests pass across 30 suites, TypeScript clean. | Task 11.6: Refunds, NACH/Auto-Pay |
| 2026-04-12 | Task 11.4 | **Massive Bank Pattern Expansion.** Expanded TransactionType from 8 to 14 values (+refund, nach_debit, nach_bounce, upi_credit, upi_debit, balance_inquiry). Extended ParsedSMS with 5 optional fields (upiRef, availableBalance, creditLimit, availableCreditLimit, accountType). Added 42 new BankPattern entries: ICICI (+5: UPI debit, UPI credit, refund, CC payment, balance), HDFC (+5: UPI debit, refund, NACH debit, CC limit, account credit), Axis (+4: account credit, refund, NACH debit, NACH bounce), SBI (+4: debit, credit, UPI debit, balance), Kotak (+3: debit, UPI debit, CC alert), IDFC First (+3: debit, credit, UPI), Federal (+2: debit, credit), Citi (+2: CC spend, CC due), Amex (+2: spend, payment due), RBL (+2: CC spend, CC due), HSBC (+2: debit, CC alert), AU SFB (+2: debit, credit), Google Pay (+2: UPI debit/credit), PhonePe (+2: UPI debit/credit), Paytm (+2: UPI credit, wallet debit). Total: 53 patterns across 15 banks. Added 10 new bank sender codes (IDFCFB, FEDBNK, CITIBK, AMEXIN, RBLBNK, HSBCBK, AUBANK, GOOGLP, GPAYIN, PHNEPE) + 9 new transaction keywords. Fixed parseBankSMS to allow amount=0 for balance_inquiry type. Fixed ICICI Account Debit test regex to exclude UPI messages (negative lookahead). 42 new test cases (one per new pattern + pattern count validation). 151 SMS-related tests pass. TypeScript clean. | Task 11.5: Financial Accounts Discovery |
| 2026-04-12 | Task 11.3 | **Unknown Category + Enhanced Learning.** Migration 010: `last_corrected_at` column on merchant_corrections + seed "Unknown" category for existing users. Added "Unknown" as 12th default category (help-circle-outline icon, #9CA3AF gray, budget 0, avoidable). Updated smart-categorizer.ts: added "fallback" to CategorizationResult source union, new `getUnknownCategoryId()` helper, `categorizeByMerchant()` now returns Unknown category with confidence=0 when no rule/learned match found. Enhanced `recordCategoryCorrection()` to update `last_corrected_at` on both increment and reset. 8 new tests: Unknown fallback (5 scenarios: basic fallback, no Unknown exists, rule preferred, learned preferred, rule miss + Unknown fallback), last_corrected_at tracking (2), DEFAULT_CATEGORIES validation (1). Updated category.test.ts count assertions (11→12). All tests pass, TypeScript clean. | Task 11.4: Bank Pattern Expansion |
| 2026-04-12 | Docs Update | **Phase 2 Expansion Documentation.** Updated all 5 docs for Tasks 11.3-11.7 plan. PRD.md: Unknown Category Fallback principle, FinancialAccount entity (19 fields), RecurringTransaction entity (14 fields), account_id/refund_of_expense_id on Expense, expanded SMS sections (50+ patterns, account discovery, refund/NACH/recurring detection), extended dues from 10+ banks, F33 moved to Phase 2. TDD.md: expenses table new columns + indexes, Section 3.7 financial_accounts + recurring_transactions tables, expanded SMS parser (14 types, 5 new ParsedSMS fields), Sections 4.1a/4.1b for Financial Account + Recurring Detector services. MASTER_PLAN.md: 5 new task definitions (11.3-11.7) with migrations, prereqs, acceptance criteria. TEST_STRATEGY.md: 6 new unit test rows + 4 coverage target rows. SECURITY.md: 4 new security model rows (financial accounts, NACH, recurring, refund). Task counts updated: Phase 2 10→15, total 78→83. | Task 11.3: Unknown Category |
| 2026-04-12 | Task 12.1 | **Smart Categorization Engine.** Migration 009: `merchant_mappings` table (keyword→category_name, global rules) + `merchant_corrections` table (per-user learning, correction_count tracking). Default merchant data: 200+ Indian merchants across 11 categories (Food: Swiggy/Zomato/Dominos etc., Grocery: BigBasket/Blinkit/Zepto, Shopping: Amazon/Flipkart/Myntra, Travel: Uber/Ola/IRCTC, Subscriptions: Netflix/Spotify/Hotstar, Car: Shell/IOCL/FASTag, Health: Apollo/1mg/PharmEasy, Utilities: electricity boards/Jio/Airtel, Insurance: LIC/Star Health, EMIs: loan types). Smart categorizer service (`services/smart-categorizer.ts`): Layer 1 rule-based matching (normalized merchant substring match, prefers longer keywords), Layer 2 user-learned (corrections tracked, threshold=3 to override rules). `normalizeMerchant()` strips corporate suffixes (Ltd/Pvt/Inc/India/Payments/Services). `extractMerchantFromDescription()` parses merchant from SMS-formatted descriptions. `categorizeByMerchant()` checks learned→rules→none. `recordCategoryCorrection()` creates/increments/resets corrections. `seedMerchantMappings()` called at DB init. Integrated into sms-to-expense.ts: auto-assigns category_id when creating expenses from SMS. Integrated into expense edit screen: records correction when user changes category on sms_auto expense. 44 new tests (normalization, extraction, rule matching, learning, corrections, data validation, seeding). 554 tests pass across 29 suites, TypeScript clean. | Task 13.0: Gmail OAuth Setup |
| 2026-04-12 | Tasks 11.2 + 12.0 | **Realized vs Forecast + Review Queue UI.** Task 11.2: Migration 006 (nature TEXT + due_date TEXT + 2 indexes on expenses table). Extended bank-patterns.ts: 3 new forecast patterns (ICICI SI Reminder, HDFC Amount Due, Axis EMI Reminder) with `isForecast: true` + parsed due dates. Trimmed SKIP_PATTERNS to OTP only. Extended ParsedSMS with `dueDate` + `isForecast`. sms-to-expense.ts: forecast expense creation (nature='forecast', due_date set), auto-matching via `findMatchingForecast()` when realized debit arrives. expense.ts: all budget queries filtered `AND nature = 'realized'`, added `getForecastExpenses()`, `getOverdueForecasts()`, `realizeForecast()`, `findMatchingForecast()`. data-cleanup.ts: `cleanupStaleForecasts()`. Task 12.0: Review queue screen (`app/expense/review-queue.tsx`) with sectioned list (Forecasts vs Transactions), swipe approve/reject via SwipeableRow, tap to edit, Approve All button, pull-to-refresh, empty state. ReviewQueueItem component with forecast badge, source icons, due date display. Home dashboard: pending count banner with navigation to review queue. 510 tests pass across 28 suites, TypeScript clean. | Task 12.1: Smart Categorization Engine |
| 2026-04-12 | Tasks D1-D7 | **Phase 1D: Income, Tax & Goal Linking — COMPLETE.** Migration 007: `linked_milestone_id` FK on investment_buckets with auto-sync (`_syncLinkedMilestone` recalculates milestone `current_saved` from direct + linked bucket contributions). Milestone picker UI on bucket create/edit, "Feeds [milestone]" badges, linked buckets section on milestone detail. Migration 008: `salary_profiles` table (20+ columns). `TaxEngine`: full Indian income tax calculator — New Regime FY 2025-26 (7 slabs, 87A rebate ≤12L→60K), Old Regime (4 slabs, 80C/80D/HRA/24b deductions, 87A ≤5L→12.5K), surcharge (5 tiers, new regime cap 25%), 4% cess, EPF (full_basic vs restricted), professional tax (29 states). `SalaryProfileService`: CRUD tied to yearly_plan_id. Salary Calculator screen: CTC mode (live breakdown + dual regime comparison + regime summary) and Direct Input mode (monthly in-hand + bonus). "Calculate from CTC" button on yearly plan, saves profile + auto-populates `annual_salary_in_hand`. Capital Gains Reference screen: 7 asset classes (equity, debt MFs, FDs, gold, real estate, intl equity, NPS) with LTCG/STCG rates, exemptions, key terms glossary. Navigation links from goals dashboard + investment detail. 55 new tax engine tests. 510 tests pass across 28 suites, TypeScript clean. **Phase 1D COMPLETE.** | Task 12.0: Review Queue UI |
| 2026-04-12 | Task 11.1 | **SMS Parser Engine.** Created `bank-patterns.ts` with 8 regex patterns covering all SMS types from real samples: ICICI CC spend (INR X spent using ICICI Bank Card), ICICI account debit (debited Rs.), ICICI standing instructions (processed payment), Axis UPI debit (multiline INR debited/A/c no./UPI/), Axis CC spend v1 (Spent INR/Axis Bank Card no.), Axis CC spend v2 (Spent/Card no./INR), HDFC CC spend (Spent Rs.X On HDFC Bank Card), HDFC payment received (PAYMENT OF Rs. RECEIVED). Skip patterns for OTPs, upcoming reminders, amount due, EMI due reminders. Date parsers for 6 formats (DD-MMM-YY, DD-MM-YY, DD-MM-YY HH:MM:SS, YYYY-MM-DD:HH:MM:SS, DD/MM/YYYY, D-M-YYYY). Created `sms-parser.ts` (batch parsing, pending_sms table storage, duplicate detection, status tracking). Created `sms-to-expense.ts` (creates pending_review expenses with source=sms_auto, raw_source_text preserved). Updated SMS permissions: manual scan as primary trigger, configurable start date (Today/7d/30d/3mo/6mo/1yr presets), auto mode off by default. Settings UI redesigned: Enable toggle → date picker → Scan Now button → Auto toggle. 27 new parser tests with real SMS. 435 tests pass across 27 suites, TypeScript clean. | Task 12.0: Review Queue UI |
| 2026-04-12 | Task 11.0 + Data Cleanup | **Phase 2 started: SMS Permission & Reader.** Installed react-native-get-sms-android, expo-task-manager, expo-background-fetch. Added READ_SMS + RECEIVE_SMS Android permissions. Created `services/sms/` module: sms-permissions.ts (permission check/request with contextual explanation dialog, MMKV persistence), bank-senders.ts (25+ Indian bank sender IDs, `isBankSender()`, `identifyBank()`, `looksLikeTransaction()` with keyword-based fallback), sms-reader.ts (fetch bank SMS from inbox, polling with lastCheck timestamp, 30-day initial scan), sms-listener.ts (expo-task-manager background task every ~15 min). Migration 005: sms_rules + pending_sms tables. SMS toggle in Settings (Android-only, Switch component). **Data Cleanup feature:** `services/data-cleanup.ts` with scoped deletion (day/week/month/quarter/all) for expenses + budgets + pending SMS. Settings UI: expandable "Clean Up Data" picker with double-confirmation warning dialog. 41 new tests (bank sender detection, SMS permissions, data cleanup scopes). 401 tests pass across 26 suites, TypeScript clean. | Task 11.1: SMS Parser Engine |
| 2026-04-12 | Tasks 9.0-10.2 | **Phase 1C: Excel Import + Backup/Restore.** Installed xlsx, expo-document-picker, expo-file-system, expo-crypto, expo-sharing. **Excel Import:** ExcelImportService (file picker, workbook reader, sheet detector/classifier, column mapping heuristics, date/amount parsers, batch expense importer with fuzzy category matching). Import wizard UI (6-step flow). **Estimations Import:** Forecast sheet parser (month column detection, row classification by section — budget/investment/milestone/metadata), imports yearly plan + investment buckets + life milestones + per-category-per-month budgets. **Backup/Restore:** Encrypted backup service (iterated SHA-256 key derivation, XOR stream cipher, MAGIC+salt+IV+encrypted format, .accmgr file), restore with full table clear+repopulate. Backup UI (create with password, share file, restore from file with password). Settings wired: "Import from Excel" + "Backup & Restore" rows. 39 new tests. 360 tests pass across 23 suites, TypeScript clean. | Task 10.3: Phase 1C APK Build |
| 2026-04-12 | Task 9.0 | **Excel Parser Foundation:** Installed xlsx (SheetJS), expo-document-picker, expo-file-system. Created ExcelImportService (pickExcelFile, readWorkbook, detectSheets, classifySheet, suggestColumnMappings, parseDate, parseAmount, parseExpenseRows, importExpenses with batch transactions + auto-create categories/payment modes, getImportPreview). Created import-excel.tsx wizard UI (6-step flow: pick file → sheet selection → column mapping → preview → import → done). 31 new tests (date parsing, amount parsing, column mapping heuristics, preview). Added "Import from Excel" row in settings. 348 tests pass across 22 suites, TypeScript clean. | Task 9.1: Import Daily Expenses |
| 2026-04-12 | Task 8.4 | **Phase 1B APK Build:** 317 tests pass across 21 suites. TypeScript clean. Category deactivation guardrail added (blocks deactivation when expenses linked). All Phase 1A+1B code committed. EAS preview APK build submitted (build 2dee327d). **Phase 1B COMPLETE.** | Phase 1C: Task 9.0 Excel Parser Foundation |
| 2026-04-12 | Task 8.3 + Bug Fixes | **Goal Dashboard Polish:** SavingsGauge component (semi-circular gauge with target marker, saved/target amounts), replaced simple progress bar on Goals dashboard with gauge. "How far off" amount shown in hero banner when behind. **Bug fixes:** (1) Home & Budget pages top cut off — enabled tab headers (removed headerShown:false). (2) budget/[categoryId] raw header — hidden Stack header since screen has custom header. (3) Branded splash/welcome screen (Artha logo mark + Hindi name + tagline). (4) Removed delete button from categories, kept only active/inactive toggle. (5) Appearance/theme switching fixed — useColorScheme hook now reads MMKV preference. 317 tests pass across 21 suites, TypeScript clean. | Task 8.4: Phase 1B APK Build |
| 2026-04-12 | Task 8.2 | **Year-over-Year Comparison:** Pure calculation util (calculateYoYComparison — 6 metrics with change/changePct/higherIsBetter, overall trend detection). 9 unit tests. YoY comparison screen (overall trend header, metric cards with previous→current values, change badges, percentage-point changes for rates). Route added to goals layout. "Year-over-Year" card on Goals dashboard (visible when 2+ FY plans exist). 317 tests pass across 21 suites, TypeScript clean. | Task 8.3: Goal Dashboard Polish |
| 2026-04-12 | Task 8.1 | **Course Correction Alerts:** Pure calculation util (evaluateCourseCorrection — severity levels info/warning/critical, threshold >5% gap, message generation). 8 unit tests. AlertBanner reusable component (3 severity styles). Alert wired into Goals dashboard — shows when savings rate drops >5% below target with specific recovery message ("Save X extra/month for Y months"). 308 tests pass across 20 suites, TypeScript clean. | Task 8.2: YoY Comparison |
| 2026-04-12 | Task 8.0 | **Unavoidable vs Discretionary Split:** Pure calculation util (calculateSplit — splits category spending/budgets by is_unavoidable flag, calculates max possible savings, discretionary available). 10 unit tests. DonutChart component (pie chart with legend). Spending Split screen (donut chart, unavoidable/discretionary summary metrics, category lists with progress bars, monthly income integration). Budget layout added (_layout.tsx). "Spending Split" button on Budget tab. 300 tests pass across 19 suites, TypeScript clean. | Task 8.1: Course Correction Alerts |
| 2026-04-12 | Task 7.4 | **Monthly Budget Compliance:** Pure calculation util (calculateMonthlyCompliance — daily rate, projected month-end, budget left %, annual projections). 11 unit tests. Projection card integrated into Budget tab: month-end projection with on/off track badge, projected spend vs savings/deficit, daily rate, budget left %, progress bar. Annual projection section (if yearly plan exists) with projected annual spend, annual budget, savings/deficit. 290 tests pass across 18 suites, TypeScript clean. | Task 8.0: Unavoidable vs Discretionary Split |
| 2026-04-12 | Tasks 7.2+7.3 | **Life Milestones:** milestones.tsx screen (list with Saved/Target/Left + progress bars, add/edit form, mark complete, monthly-needed calc from target date). milestone-detail.tsx (header, projection with avg monthly + months-to-target + pace indicator, monthly history, add/delete contributions). Dashboard wired: Goals tab shows top 3 active milestones with progress bars. Both routes added to layout. 279 tests pass, TypeScript clean. | Task 7.4: Monthly Budget Compliance |
| 2026-04-12 | NativeWind Fix | **Critical: Created babel.config.js** with `jsxImportSource: "nativewind"` — was missing entirely, causing all className styles to be ignored on device. Added guard rail test. New APK build triggered. 279 tests pass. | Continue Tasks |
| 2026-04-12 | Task 7.1 | **Investment Goal Detail:** Dedicated investment-detail.tsx screen with bucket header (Goal/Done/Left + progress bar), projection card (avg monthly contribution, months to complete, projected completion date), monthly history with per-month bars, add contribution form, individual contribution list with long-press delete. Bucket list now navigates to detail screen on tap. Route added to goals layout. 278 tests pass, TypeScript clean. | Task 7.2: Life Milestone Goals |
| 2026-04-12 | Task 7.0 | **Investment Goal Buckets:** Full investment-buckets.tsx screen with bucket list (Goal/Done/Left + progress bars per bucket), overall summary card, add/edit bucket form, contribution management (add/delete with long-press), per-bucket detail view with contribution history. Dashboard wired: Goals tab loads real bucket data, shows top 3 buckets with progress bars + "View all" nav. Route added to goals layout. 278 tests pass, TypeScript clean. | Task 7.1: Investment Goal Detail Screen |
| 2026-04-12 | Task 6.3 | **Goal Dashboard Shell:** Rewrote Goals tab as "Am I Winning?" dashboard. Hero status banner (winning/on_track/behind/no_plan) aggregating plan + savings data. Compact yearly plan card (income/outflow/surplus 3-col). Enhanced savings rate card (large %, progress bar, on/off track badge, course correction). Placeholder cards for Investment Buckets + Life Milestones (lock icons). Previous FY Plans list. FAB for new plan. 278 tests pass, TypeScript clean. | Task 7.0: Investment Goal Buckets |
| 2026-04-12 | Task 6.2 | **Savings Rate Tracker:** Pure calculation utils (calculateSavingsSnapshot, calculateMonthlySavingsTrend), savings-tracker service (DB queries for FY expenses, monthly breakdowns), Savings Rate screen (gauge, YTD metrics, course correction, monthly trend bars), Goals tab savings card with on/off track badge. 29 new calc tests. 278 tests pass, TypeScript clean. | Task 6.3: Goal Dashboard Shell |
| 2026-04-12 | Bug Fixes | **Critical UI fixes:** Disabled React Compiler (broke NativeWind), fixed DB init + seed at startup, fixed SafeAreaView padTop on ALL screens, fixed expo doctor warnings (removed eas-cli, downgraded @types/jest). Added Section 8 to TEST_STRATEGY.md: UI Guard Rails with 4 automated tests. 230 tests pass. | Task 6.1 |
| 2026-04-12 | Task 6.1 | **Yearly Plan Setup:** Calculation utils (calculateYearlyPlanSummary, calculateSalaryAfterHike), Goals tab redesigned as landing page with current plan card + previous plans list + placeholders for investments/milestones. Yearly Plan screen with income/outflow/savings inputs, live summary with achievability badge. Goals route group (app/goals/_layout.tsx). 19 new calc tests. 249 tests pass, TypeScript clean. | Task 6.2: Savings Rate Goal Tracker |
| 2026-04-12 | Task 6.0 | **Goal Engine Schema:** Migration 004 — 6 tables (yearly_plans, investment_buckets, investment_contributions, life_milestones, milestone_contributions, unavoidable_baselines) with 3 indexes. 3 services: yearly-plan.ts (YearlyPlan + InvestmentBucket + InvestmentContribution CRUD), life-milestone.ts (LifeMilestone + MilestoneContribution CRUD), unavoidable-baseline.ts (upsert, totals). 38 new tests across 3 test files. 226 tests pass, TypeScript clean. | Task 6.1: Yearly Financial Plan Setup |
| 2026-04-12 | Task 5.4 (Design Sprint + APK) | **Kite Design Sprint:** Applied Zerodha Kite-inspired design system across ALL screens (14 files). Color palette: #2A2E73 primary blue, #0CBF16 green, #FF3333 red, #0D0E12 dark bg. Flat bordered cards (no shadows), rounded-lg corners, data-first typography. Updated: tailwind.config, theme constants, 4 core UI components, tab navigator, home, expenses, budget, settings, summary, category-detail, add/edit expense, categories, payment-modes, payment-mode-edit, budget-config, templates, goals, category-edit, TrendBarChart. TypeScript clean, 188 tests pass. APK build submitted (EAS build 21463575). | Phase 1A COMPLETE — ready for Phase 1B |
| 2026-04-12 | Task 5.3 | Home Dashboard: budget health card (total spent, progress bar, remaining/over, health badge), top 5 category breakdown with progress bars, recent 5 transactions, quick-add FAB, "Set up budget" CTA when no budget. 188 tests pass. **Phase 1A feature-complete.** | Task 5.4: Phase 1A Integration Test & APK Build |
| 2026-04-12 | Task 5.2 | Template system: Migration 003 (templates table), TemplateService (save/load/delete/parse/export), template management screen with save form + load + delete. Default template concept + JSON export. 188 tests pass (11 new). | Task 5.3: Home Dashboard |
| 2026-04-12 | Task 5.1 | Settings screen: added dark mode toggle (system/light/dark), about section (app name, version, tech stack), subtitles on all rows, disabled placeholders for Templates and Backup & Restore. 177 tests pass. | Task 5.2: Template Save & Load |
| 2026-04-12 | Task 5.0 | Monthly summary screen: total spend, budget compliance bar, vs-last-month comparison (% change + trending icon), right-spend ratio with color-coded gauge, top 5 categories with bars. 3 new service functions (getRightSpendTotal, getTopCategoriesBySpending, getExpenseCount). "View Monthly Summary" button on budget tab. 177 tests pass (6 new). | Task 5.1: Settings Screen |
| 2026-04-12 | Task 4.2 | Category detail: added 6-month spending trend bar chart (TrendBarChart component), getCategoryMonthlyTrend service, budget line on chart, current month highlighted. 171 tests pass (6 new). | Task 5.0: Monthly Summary Report |
| 2026-04-12 | Task 4.1 | Budget dashboard: month selector, overall summary card (spent/budget/progress/days-left/per-day), per-category rows sorted by over-budget then spent, color coding (green/yellow/red), drill-down to category detail screen with transactions. budget-helpers utils + 22 tests. 165 tests pass. | Task 4.2: Category Detail View |
| 2026-04-12 | Task 4.0 | Budget system: CRUD service (upsert, breakdowns, seed), budget config screen at /settings/budget-config (month navigator, per-category amount inputs, Load Defaults button, total summary), settings nav link. 143 tests pass (15 new). | Task 4.1: Actuals vs Budget Dashboard |
| 2026-04-12 | Task 3.2 | Edit Expense screen at /expense/[id].tsx: pre-fills all fields, update + delete (permanent, with confirmation), "None" option in category/payment pickers, trash icon in header. 128 tests pass. | Task 4.0: Budget Setup Screen |
| 2026-04-12 | Tasks 3.0+3.1 | Enhanced category management: reorder (up/down), active/inactive toggle (eye icon), linked expense count in delete dialog, useFocusEffect. Enhanced payment modes: tap-to-edit screen, active/inactive toggle, useFocusEffect. Both now show all items including inactive (dimmed). 128 tests pass. | Task 3.2: Edit Expense Screen |
| 2026-04-12 | Task 2.3 | Expense list: paginated search/filter service (getExpensesPaginated), full list screen with search bar, category/payment mode filter chips, long-press delete, load-more pagination (50/page), empty states. 128 tests pass (7 new). | Task 3.0: Category Management Screen |
| 2026-04-12 | Task 2.2 | Expense entry: CRUD service, validation utils (parseAmount, formatDate, formatAmount), Add Expense screen (amount, description, category/payment pickers, date nav, right-spend toggle), modal route, FAB on expenses tab. 121 tests pass (45 new). | Task 2.3: Expense List & Search |
| 2026-04-12 | Task 2.1 | Payment mode system: CRUD service, 11 default modes (4 CC, 3 bank, 2 UPI, 1 cash, 1 wallet), list/manage screen with inline add form, type picker. 76 tests pass. | Task 2.2: Expense Entry — Add Screen |
| 2026-04-12 | Task 2.0 | Category system: CRUD service, 11 default "Indian Professional" categories (Rs 113,390 total budget), category list + add/edit screens, settings stack navigation, icon/color pickers. 65 tests pass. | Task 2.1: Payment Mode Service |
| 2026-04-12 | Task 1.3 | Fiscal year: 5 utility functions (getCurrentFY, getFYRange, getFYLabel, getFiscalMonth, getFYMonthLabels), MMKV settings service, settings screen with FY picker (India/US/Australia/US Federal). 52 tests pass. | Task 2.0: Category Service & Default Data |
| 2026-04-12 | Task 1.2 | Theme & UI components: Indigo color palette, dark mode support (Tailwind + tab navigator), 4 core components (Button, Card, Input, ScreenContainer), all tab screens updated. 27 tests pass. | Task 1.3: Fiscal Year Configuration |
| 2026-04-12 | Task 1.1 | SQLite database layer: migration runner with version tracking, Migration 001 (users, categories, payment_modes), Migration 002 (expenses, budgets, budget_breakdowns), seed service (default user), UUID utility. Fixed jest-expo version mismatch (v55→v54). 17 tests pass, TypeScript clean. | Task 1.2: Navigation Shell & Theme |
| 2026-04-12 | Task 1.0 | Project initialized: Expo SDK 54, React Native 0.81.5, 5-tab navigation, NativeWind v4, Zustand, SQLite, MMKV, Jest, ESLint, Prettier, EAS config. 58 files committed. TypeScript + export verified. | Task 1.1: SQLite Database Setup |
| 2026-04-12 | Planning | Created all documentation: PRD, TDD, DEVOPS, TEST_STRATEGY, SECURITY, CLAUDE.md, MASTER_PLAN.md. Roadmap finalized (6 phases, 24 weeks). No code written yet. | Task 1.0: Project initialization |

---

## CURRENT STATE

> **Quick glance: Where are we right now?**

- **Current Phase:** Phase 3 COMPLETE. Phase 5 service layer complete. Next: Phase 2 remaining (13.0-14.1) or Phase 4 (19.0+).
- **Current Task:** Next available — Task 13.0 (Gmail OAuth) or Task 19.0 (Asset Tracker).
- **Last Completed Task:** Task 18.0 — Phase 3 Integration Test & APK Build.
- **Phase 1A Status:** ALL 17 tasks COMPLETE.
- **Phase 1B Status:** ALL 14 tasks COMPLETE.
- **Phase 1C Status:** ALL 8 tasks COMPLETE.
- **Phase 1D Status:** ALL 7 tasks COMPLETE (D1-D7).
- **Phase 2 Status:** Tasks 11.0-11.7, 12.0, 12.1 complete. Tasks 13.0-14.1 remaining.
- **Phase 3 Status:** ALL 7 tasks COMPLETE (15.0, 15.1, 16.0, 16.1, 17.0, 17.1, 18.0).
- **Phase 5 Status:** Tasks 22.0, 23.0, 23.1, 23.2, 24.0 complete (service layer, no UI yet).
- **Design System:** Zerodha Kite-inspired. All screens updated. See tailwind.config.js for full palette.
- **Blockers:** None. APK builds use Java 21 from Android Studio (`JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`).
- **Test Status:** 802 tests pass across 39 suites. TypeScript clean (pre-existing import-excel.tsx errors only).

---

## MANDATORY BEHAVIORS

### Before Starting Any Work
```
1. Read CLAUDE.md (project context)
2. Read this file (MASTER_PLAN.md) — check SESSION LOG and CURRENT STATE
3. Find the next task with [ ] status
4. Read that task's prerequisite files
5. Execute the task
```

### After Completing Any Task
```
1. Mark the task [x] in the task list below
2. Add an entry to the SESSION LOG above
3. Update CURRENT STATE above
4. If the phase is complete, update CLAUDE.md "Current Phase & Status"
```

### After Every Context Compaction
```
1. IMMEDIATELY read this file (docs/MASTER_PLAN.md)
2. Check SESSION LOG — understand what was done
3. Check CURRENT STATE — understand where you are
4. Resume the current task or start the next one
```

---

## PHASE 1A: Core Expense Tracking + Budget (Weeks 1-5)

**Goal:** Manual expense tracking + budget dashboard. No automation. Replace the "Daily Expenses" sheet.

**Exit Criteria:** Can add/edit/delete expenses, configurable categories and payment modes, budget vs actuals dashboard, monthly summary, template save/load, works offline, testable on Android via APK.

### Week 1: Project Setup & Foundation

- [x] **Task 1.0: Project Initialization** (Completed 2026-04-12)
  - Create Expo project with TypeScript template
  - Install core dependencies: expo-router, nativewind, zustand, expo-sqlite, react-native-mmkv
  - Set up folder structure per TDD.md Section 2
  - Configure TypeScript, ESLint, Prettier
  - Verify `npx expo start` runs without errors
  - **Prereqs to read:** `docs/TDD.md` (Section 2: Architecture), `docs/PRD.md` (Section 7: Tech Stack)
  - **Acceptance:** Project runs on dev server, folder structure matches TDD, all dependencies installed

- [x] **Task 1.1: SQLite Database Setup** (Completed 2026-04-12)
  - Create database initialization service
  - Define schema migration system (version tracking)
  - Create Migration 001: `users`, `categories`, `payment_modes` tables
  - Create Migration 002: `expenses`, `budgets`, `budget_breakdowns` tables
  - Seed default user record
  - Write integration tests for schema creation
  - **Prereqs to read:** `docs/TDD.md` (Section 5: SQLite Schema), `docs/PRD.md` (Section 5: Data Model)
  - **Acceptance:** Database initializes on app start, tables created, migrations tracked, tests pass

- [x] **Task 1.2: Navigation Shell & Theme** (Completed 2026-04-12)
  - Set up Expo Router with tab-based navigation (Home, Expenses, Budget, Settings)
  - Create base theme (colors, typography, spacing) with dark mode support
  - Create core UI components: Button, Card, Input, ScreenContainer
  - Set up NativeWind configuration
  - **Prereqs to read:** `docs/TDD.md` (Section 3: Screens), `docs/PRD.md` (Section 4: Screen Inventory)
  - **Acceptance:** App shows tab navigation, theme applies, basic screens render

- [x] **Task 1.3: Fiscal Year Configuration** (Completed 2026-04-12)
  - Add `fiscal_year_start_month` to user settings (default: 4 for April)
  - Create fiscal year utility functions: `getCurrentFY()`, `getFYRange(year)`, `getFYLabel(year)` (returns "FY 2026-27")
  - Create settings screen with fiscal year picker
  - Store in MMKV for fast access
  - Write unit tests for all FY utility functions
  - **Prereqs to read:** `docs/PRD.md` (Section 12: Fiscal Year Definition, F13d)
  - **Acceptance:** Fiscal year configurable, utility functions return correct ranges, tests pass

### Week 2: Manual Expense Entry & List

- [x] **Task 2.0: Category Service & Default Data** (Completed 2026-04-12)
  - Create Category service (CRUD operations against SQLite)
  - Seed "Indian Professional" default categories (11 categories from PRD Section 9)
  - Create Category list screen with icons and colors
  - Create Add/Edit Category screen
  - Write integration tests for Category CRUD
  - **Prereqs to read:** `docs/PRD.md` (Section 9: Default Template), `docs/TDD.md` (Section 5: categories table)
  - **Acceptance:** All 11 default categories seeded, CRUD works, list screen renders

- [x] **Task 2.1: Payment Mode Service & Default Data** (Completed 2026-04-12)
  - Create PaymentMode service (CRUD operations)
  - Seed default payment modes (11 modes from PRD Section 9)
  - Create Payment Mode list/manage screen
  - Write integration tests
  - **Prereqs to read:** `docs/PRD.md` (Section 9: Default Payment Modes)
  - **Acceptance:** All 11 default payment modes seeded, CRUD works, list screen renders

- [x] **Task 2.2: Expense Entry — Add Screen** (Completed 2026-04-12)
  - Create Add Expense screen: amount (numeric keypad), description, category picker, payment mode picker, date picker, "right spend" toggle
  - Create Expense service (create, read, update, delete against SQLite)
  - Amount validation (> 0, numeric)
  - Auto-set today's date as default
  - Target: under 15 seconds to add an expense
  - Write unit tests for validation, integration tests for Expense CRUD
  - **Prereqs to read:** `docs/PRD.md` (F1: Manual Expense Entry), `docs/TDD.md` (Section 5: expenses table)
  - **Acceptance:** Can add an expense with all fields, saved to SQLite, validation works, tests pass

- [x] **Task 2.3: Expense List & Search** (Completed 2026-04-12)
  - Create Expense List screen: chronological, shows amount + category icon + description + date
  - Add filters: date range, category, payment mode, amount range
  - Add search bar (searches description field)
  - Tap an expense to view/edit, long-press or swipe to delete
  - Pagination for large lists (load 50 at a time)
  - **Prereqs to read:** `docs/PRD.md` (F8: Expense History)
  - **Acceptance:** List shows expenses, filters work, search works, edit/delete works

### Week 3: Categories, Payment Modes & Configuration

- [x] **Task 3.0: Category Management Screen** (Completed 2026-04-12)
  - Full category management: add new, edit name/icon/color, delete (with confirmation), reorder, toggle active/inactive
  - Category icons from a predefined icon set
  - Color picker for category colors
  - Prevent deletion of categories with existing expenses (show count)
  - **Prereqs to read:** `docs/PRD.md` (F11: Configurable Categories)
  - **Acceptance:** Can add/edit/delete/reorder categories, icons and colors work, deletion protection works

- [x] **Task 3.1: Payment Mode Management Screen** (Completed 2026-04-12)
  - Full payment mode management: add, edit, delete, toggle active/inactive
  - Payment mode type selector (credit_card, debit_card, upi, cash, wallet, bank_transfer)
  - **Prereqs to read:** `docs/PRD.md` (F12: Payment Modes)
  - **Acceptance:** Can manage payment modes, type selection works

- [x] **Task 3.2: Edit Expense Screen** (Completed 2026-04-12)
  - Edit any field of an existing expense
  - Show edit history (original vs current values — optional)
  - Delete expense from edit screen
  - Confirmation dialog for delete
  - **Prereqs to read:** `docs/PRD.md` (Universal Manual Override principle)
  - **Acceptance:** Can edit all fields, can delete, changes saved to SQLite

### Week 4: Budget System

- [x] **Task 4.0: Budget Setup Screen** (Completed 2026-04-12)
  - Set monthly budget per category
  - Pre-fill from "Indian Professional" template defaults
  - Budget breakdown support (e.g., Car: Petrol Rs 7,673 + Service Rs 1,583 + Wash Rs 800)
  - Create Budget service (CRUD against SQLite)
  - Create BudgetBreakdown service
  - Write integration tests
  - **Prereqs to read:** `docs/PRD.md` (F6, Section 9: Default Budget Breakdown), `docs/TDD.md` (Section 5: budgets, budget_breakdowns tables)
  - **Acceptance:** Can set budget per category, breakdowns work, defaults loaded

- [x] **Task 4.1: Actuals vs Budget Dashboard** (Completed 2026-04-12)
  - Budget dashboard: each category shows progress bar (spent / budget)
  - Color coding: green (< 70%), yellow (70-90%), red (> 90%)
  - Shows: "days left in month" and "per-day budget remaining"
  - Tap a category to see its transactions
  - Calculate actuals from sum of approved expenses per category per month
  - **Prereqs to read:** `docs/PRD.md` (F7: Actuals vs Budget Dashboard)
  - **Acceptance:** Dashboard shows real-time actuals vs budget, colors correct, drill-down works

- [x] **Task 4.2: Category Detail View** (Completed 2026-04-12)
  - All transactions for one category in current month
  - Monthly trend chart (last 3-6 months if data exists)
  - Total spent, budget, remaining
  - **Prereqs to read:** `docs/PRD.md` (Screen 12: Category Detail)
  - **Acceptance:** Shows transactions per category, trend chart renders

### Week 5: Summary, Settings & Templates

- [x] **Task 5.0: Monthly Summary Report** (Completed 2026-04-12)
  - End-of-month summary: total spend, top categories, budget compliance %, "right spend" ratio, comparison to last month
  - Formatted as a shareable card or screen
  - **Prereqs to read:** `docs/PRD.md` (F13: Monthly Summary Report)
  - **Acceptance:** Summary screen shows all metrics, data is accurate

- [x] **Task 5.1: Settings Screen** (Completed 2026-04-12)
  - Profile section, notification preferences, dark mode toggle, fiscal year config (from Task 1.3)
  - Data section: links to backup/restore (placeholder), template management, categories, payment modes
  - About section: app version, credits
  - **Prereqs to read:** `docs/PRD.md` (Screen 19: Settings)
  - **Acceptance:** Settings screen navigates to all sub-screens, dark mode works

- [x] **Task 5.2: Template Save & Load** (Completed 2026-04-12)
  - Save current setup (categories, budgets, payment modes, breakdowns) as a named template
  - Store templates in SQLite
  - Load a template (replaces current setup with confirmation dialog)
  - Export template as `.accmgr-template` file (plain JSON)
  - Import template from file
  - Default "Indian Professional" template available on first launch
  - **Prereqs to read:** `docs/PRD.md` (F13b: Template Save & Share), `docs/SECURITY.md` (Section 3.4: Template Files)
  - **Acceptance:** Can save/load/export/import templates, default template works on fresh install

- [x] **Task 5.3: Home Dashboard** (Completed 2026-04-12)
  - Month summary at a glance: total spent, budget remaining, category breakdown donut chart
  - Recent transactions (last 5)
  - Quick-add floating action button
  - Budget health indicator (on track / warning / over budget)
  - **Prereqs to read:** `docs/PRD.md` (Screen 7: Home Dashboard)
  - **Acceptance:** Dashboard shows real data, quick-add works, chart renders

- [x] **Task 5.4: Phase 1A Integration Test & APK Build** (Completed 2026-04-12)
  - Run full test suite (unit + integration)
  - Run security audit (no hardcoded secrets)
  - Build Android APK (Preview profile)
  - Test on Android phone: add expenses, set budgets, view dashboard, manage categories
  - Document any bugs found
  - **Prereqs to read:** `docs/TEST_STRATEGY.md`, `docs/DEVOPS.md` (Section 3: APK Build)
  - **Acceptance:** All tests pass, APK installs and runs on Android, core features work

---

## PHASE 1B: Financial Goal Engine (Weeks 6-8)

**Goal:** Replace the Estimations Excel. Track savings rate, investment goals, life milestones.

**Exit Criteria:** Yearly plan tied to FY, savings rate tracking, investment buckets (Goal/Done/Left), life milestones, course correction, goal dashboard.

### Week 6: Yearly Plan & Savings

- [x] **Task 6.0: Goal Engine Schema** (Completed 2026-04-12)
  - Create Migration 004: `yearly_plans`, `investment_buckets`, `investment_contributions`, `life_milestones`, `milestone_contributions`, `unavoidable_baselines` tables
  - Create services: YearlyPlanService, InvestmentBucketService, LifeMilestoneService
  - Write integration tests for all CRUD operations
  - **Prereqs to read:** `docs/PRD.md` (Section 5.3: Goal Engine Entities), `docs/TDD.md` (Section 5: Schema)
  - **Acceptance:** All goal tables created, services work, tests pass

- [x] **Task 6.1: Yearly Financial Plan Setup** (Completed 2026-04-12)
  - Create Yearly Plan setup screen: annual salary, expected bonus, hike %, planned expenses, planned investments, planned milestones
  - Tied to fiscal year (from Task 1.3)
  - Auto-calculates: "Left After Complete Spend", surplus/deficit
  - Support multiple fiscal years side-by-side
  - **Prereqs to read:** `docs/PRD.md` (F14: Yearly Financial Plan)
  - **Acceptance:** Can create yearly plan, calculations correct, FY-aware

- [x] **Task 6.2: Savings Rate Goal Tracker** (Completed 2026-04-12)
  - Set savings target as % of salary
  - Real-time tracking: target amount, actual saved, trajectory
  - "Extra savings per month needed to course correct" calculation
  - Monthly view with trend
  - Write unit tests for all savings calculations
  - **Prereqs to read:** `docs/PRD.md` (F15: Savings Rate Goal, Section 5.3: Goal Trajectory Calculations)
  - **Acceptance:** Savings rate tracked, trajectory correct, course correction shows, tests pass

- [x] **Task 6.3: Goal Dashboard Shell**
  - Create the "am I winning?" screen
  - Placeholder sections for: savings rate gauge, investment progress, milestones, yearly plan status
  - Wire up savings rate from Task 6.2
  - **Prereqs to read:** `docs/PRD.md` (F22: Goal Dashboard)
  - **Acceptance:** Dashboard renders, savings rate section shows real data

### Week 7: Investment Goals & Milestones

- [x] **Task 7.0: Investment Goal Buckets**
  - Create Investment Bucket management: add buckets with annual targets
  - Default buckets from user's Excel: Emergency Fund + FD, Mutual Funds, Precious Metals, Equity
  - Each bucket shows: Goal / Done / Left
  - Manual contribution entry: amount, date, notes
  - Progress bar per bucket
  - **Prereqs to read:** `docs/PRD.md` (F16: Investment Goals)
  - **Acceptance:** Can create buckets, add contributions, Goal/Done/Left accurate

- [x] **Task 7.1: Investment Goal Detail Screen**
  - One bucket view: target, contributed, remaining, monthly history
  - Projected completion date based on contribution rate
  - **Prereqs to read:** `docs/PRD.md` (Screen 15: Investment Goal Detail)
  - **Acceptance:** Detail screen shows all data, projection works

- [x] **Task 7.2: Life Milestone Goals**
  - Create milestone management: name, target amount, target date (optional)
  - Default milestones: Car Down Payment, House Down Payment, Engagement Ring (from user's Excel)
  - Manual contribution entry
  - Progress bar, monthly contribution needed calculation
  - **Prereqs to read:** `docs/PRD.md` (F17: Life Milestone Goals)
  - **Acceptance:** Can create milestones, add contributions, progress tracking works

- [x] **Task 7.3: Milestone Detail Screen**
  - One milestone view: target, saved, % complete, monthly needed, projected completion
  - Timeline visualization
  - **Prereqs to read:** `docs/PRD.md` (Screen 16: Milestone Detail)
  - **Acceptance:** Detail screen shows all data, calculations correct

- [x] **Task 7.4: Monthly Budget Compliance**
  - Real-time projection: "If I continue spending at this rate..."
  - Projected: total spend, savings, surplus/deficit for the month and year
  - "Budget Left %" like Excel
  - **Prereqs to read:** `docs/PRD.md` (F18: Monthly Budget Compliance)
  - **Acceptance:** Projections calculate correctly, updates in real-time

### Week 8: Intelligence & Dashboard Polish

- [x] **Task 8.0: Unavoidable vs Discretionary Split**
  - Classify categories as unavoidable/discretionary
  - Show: monthly unavoidable baseline, discretionary budget available, max possible savings
  - Pie chart visualization
  - **Prereqs to read:** `docs/PRD.md` (F20: Unavoidable vs Discretionary Split)
  - **Acceptance:** Classification works, calculations correct, chart renders

- [x] **Task 8.1: Course Correction Alerts**
  - When trajectory goes off track: "Rs X behind savings target, save Rs Y extra/month for Z months"
  - Local push notification when trajectory shifts significantly
  - Threshold: alert when actual savings rate drops >5% below target
  - **Prereqs to read:** `docs/PRD.md` (F19: Course Correction Alerts)
  - **Acceptance:** Alerts trigger correctly, calculation accurate

- [x] **Task 8.2: Year-over-Year Comparison**
  - Compare current FY plan vs previous FY actuals
  - Growth in income, changes in expense patterns, savings rate change
  - Requires at least 2 FYs of data (or partial)
  - **Prereqs to read:** `docs/PRD.md` (F21: Year-over-Year Comparison)
  - **Acceptance:** Comparison shows correct data when 2 FYs exist

- [x] **Task 8.3: Goal Dashboard Polish**
  - Complete the dashboard from Task 6.3: savings rate gauge chart, investment bucket progress bars, milestone timeline, yearly plan status
  - "On track" / "Off track" / "How far off" indicators
  - **Prereqs to read:** `docs/PRD.md` (F22: Goal Dashboard, Screen 13)
  - **Acceptance:** All sections show real data, gauges and charts render

- [x] **Task 8.4: Phase 1B Integration Test & APK Build** (Completed 2026-04-12)
  - Run full test suite
  - Security audit
  - Build APK
  - Test goal engine on Android phone: yearly plan, savings, investments, milestones, dashboard
  - **Acceptance:** All tests pass, APK works, goal features functional on phone

---

## PHASE 1C: Excel Import + Data Bootstrap (Weeks 9-10)

**Goal:** Import existing Excel data. Full backup/restore. The user should not start from zero.

**Exit Criteria:** Can import ACCOUNTS MANAGER + Estimations Excel files, 1+ year of data visible, backup/restore works.

### Week 9: Excel Import

- [x] **Task 9.0: Excel Parser Foundation** (Completed 2026-04-12)
  - Install xlsx parsing library (e.g., `xlsx` or `sheetjs`)
  - Create ExcelImportService with sheet detection and column mapping
  - Parse ACCOUNTS MANAGER: detect "Daily Expenses" sheet, map columns (Date, Amount, Category, Payment Mode, Description, Right Spend)
  - Column mapping wizard UI: show detected columns, let user confirm/adjust mappings
  - **Prereqs to read:** `docs/PRD.md` (F13c: Import from Excel, Appendix A)
  - **Acceptance:** Can read .xlsx file, detect sheets, show column mapping wizard

- [x] **Task 9.1: Import Daily Expenses** (Completed 2026-04-12)
  - Import Daily Expenses sheet → create Expense records
  - Auto-map categories (match by name, create new if needed)
  - Auto-map payment modes
  - Handle date formats (DD-MM-YYYY, DD/MM/YYYY, etc.)
  - Show import preview: "Will import 1,071 expenses across 12 months"
  - Progress indicator during import
  - **Prereqs to read:** `docs/PRD.md` (F13c, Appendix A: Daily Expenses mapping)
  - **Acceptance:** Expenses imported, categories auto-mapped, dates correct

- [x] **Task 9.2: Import Estimations (Forecasts + Actuals)** (Completed 2026-04-12)
  - Parse Estimations file: detect Forecast and Actuals sheets
  - Import budget amounts from Forecast sheets → populate Budget records
  - Import investment targets → populate InvestmentBucket targets
  - Import milestone targets → populate LifeMilestone records
  - Import actuals if importing mid-year
  - **Prereqs to read:** `docs/PRD.md` (F13c, Appendix A: Forecast/Actuals mapping)
  - **Acceptance:** Budgets, investment goals, milestones populated from Excel

- [x] **Task 9.3: Import Hisaab & Summary Data** (Deferred — 2026-04-12)
  - Import Non Personal Expenses → create HisaabPerson records with initial balances
  - Import Summary Sheet → create initial Asset/Liability snapshots (stored as notes/values for Phase 4)
  - **Note:** Hisaab tables (Phase 3) and Asset/Liability tables (Phase 4) don't exist yet. This task will be revisited when those phases are built. The import wizard framework is ready to add these sheet types.
  - **Prereqs to read:** `docs/PRD.md` (Appendix A: Non Personal Expenses, Summary Sheet)
  - **Acceptance:** Hisaab initial balances imported, summary data stored

### Week 10: Backup & Restore + Polish

- [x] **Task 10.0: Backup System** (Completed 2026-04-12)
  - Create BackupService: export entire SQLite database + settings + templates as encrypted file
  - AES-256-GCM encryption with user-set password
  - PBKDF2 key derivation (600,000 iterations)
  - File format: `.accmgr` (encrypted payload + salt + IV)
  - Save to device storage (Downloads folder)
  - Optional: save to Google Drive / iCloud Files (as file, not sync)
  - Write unit tests for encrypt/decrypt roundtrip
  - **Prereqs to read:** `docs/PRD.md` (F13a), `docs/SECURITY.md` (Section 3.3: Backup & Restore)
  - **Acceptance:** Backup creates encrypted file, file saved to storage, tests pass

- [x] **Task 10.1: Restore System** (Completed 2026-04-12)
  - Pick backup file from device storage
  - Enter password → decrypt → validate data integrity
  - Restore to current database (with confirmation: "This will replace all current data")
  - Handle version mismatches (backup from older app version)
  - **Prereqs to read:** `docs/PRD.md` (F13a), `docs/SECURITY.md` (Section 3.3)
  - **Acceptance:** Restore works, data intact after roundtrip, version handling works

- [x] **Task 10.2: Backup Management UI** (Completed 2026-04-12)
  - Backup & Restore screen: create backup, restore from file, backup history
  - Auto-backup scheduling (daily/weekly toggle)
  - Show last backup date/time
  - **Prereqs to read:** `docs/PRD.md` (Screen 25: Backup & Restore)
  - **Acceptance:** UI works, auto-backup configurable, history shows

- [x] **Task 10.3: Phase 1C Integration Test & APK Build** (Completed 2026-04-12)
  - Test Excel import with real data files
  - Test backup → wipe → restore roundtrip
  - Full test suite + security audit
  - Build APK, test entire Phase 1 on Android phone
  - **Acceptance:** Excel import works with real data, backup/restore verified, all Phase 1 features work on phone

---

## PHASE 1D: Income, Tax & Goal Linking (Weeks 10.5-11)

**Goal:** Investment-milestone linking for the goal engine + salary/CTC/tax calculator to provide accurate income data for yearly plans.

**Exit Criteria:** Investment buckets can be linked to life milestones with auto-progress sync. Salary calculator supports CTC→in-hand (both tax regimes) and direct input modes. Tax computation is accurate for Indian New Tax Regime FY 2025-26. All integrates with existing yearly plan.

- [x] **Task D1: Migration 007 — Investment-Milestone Linking Schema**
  - Add `linked_milestone_id TEXT REFERENCES life_milestones(id)` column to `investment_buckets`
  - Update `createInvestmentBucket` and `updateInvestmentBucket` to accept `linked_milestone_id`
  - Update `createInvestmentContribution` to auto-increment linked milestone's `current_saved`
  - Update `deleteInvestmentContribution` to auto-decrement linked milestone's `current_saved`
  - Write tests for linking + auto-sync
  - **Prereqs to read:** `services/yearly-plan.ts`, `services/life-milestone.ts`, `database/migrations/`
  - **Acceptance:** Bucket contributions auto-update linked milestone progress. Tests pass.

- [x] **Task D2: Investment-Milestone Linking UI**
  - Add milestone picker to bucket create/edit form (dropdown of active milestones + "None")
  - Show linked milestone name + progress on InvestmentBucketCard
  - Milestone detail screen shows contributions from linked buckets (separate section)
  - Dashboard: visual linkage indicator (small icon/badge on linked buckets)
  - **Prereqs to read:** `app/goals/investment-buckets.tsx`, `app/goals/investment-detail.tsx`, `app/goals/milestones.tsx`
  - **Acceptance:** Can link/unlink buckets to milestones in UI. Progress syncs visually.

- [x] **Task D3: Migration 008 — Salary Profiles Schema + Tax Engine**
  - Create `salary_profiles` table (see TDD.md Section 3.3)
  - Create `SalaryProfileService` — CRUD for salary_profiles, tied to yearly_plan_id
  - Create `TaxEngine` — pure calculation functions:
    - CTC breakdown: Basic, HRA, Special Allowance, Employer EPF, Gratuity
    - New Tax Regime FY 2025-26: 7 slabs, Rs 75K standard deduction, 87A rebate (up to Rs 60K for taxable ≤ Rs 12L)
    - Old Tax Regime: Rs 50K standard deduction, 80C/80D/HRA/24b deductions
    - Surcharge (5 tiers) + 4% Health & Education Cess
    - EPF: full_basic vs restricted (Rs 15K cap), employee (12%) + employer (EPF 3.67% + EPS 8.33%)
    - Professional Tax: state-wise lookup
  - Write extensive unit tests for tax calculations (edge cases: rebate boundary, surcharge thresholds, both regimes)
  - **Prereqs to read:** `docs/PRD.md` (F14a-F14c), `services/yearly-plan.ts`
  - **Acceptance:** Tax calculations match expected values for test cases. Both regimes produce correct results.

- [x] **Task D4: CTC → In-Hand Calculator Screen**
  - New screen: `app/goals/salary-calculator.tsx`
  - CTC input → live breakdown showing: Basic, HRA, Special Allowance, EPF (employee/employer), Gratuity
  - Tax calculation with regime toggle (New/Old side-by-side comparison)
  - EPF mode toggle (Full Basic vs Restricted)
  - Metro/Non-metro toggle (affects HRA)
  - Professional Tax with state picker
  - Old regime deduction inputs (80C, 80D, HRA exemption, home loan interest)
  - Final output: monthly in-hand salary, annual tax, effective tax rate
  - **Prereqs to read:** Task D3 services, `docs/PRD.md` (F14a)
  - **Acceptance:** CTC calculator produces correct in-hand salary. Regime comparison works.

- [x] **Task D5: Direct Input Mode + Yearly Plan Integration**
  - Add Mode 2 (Direct Input) to salary calculator: just monthly in-hand + annual bonus
  - Wire salary calculator output to yearly plan: auto-populate `annual_salary_in_hand` from computed value
  - Yearly plan setup shows "Calculate from CTC" button that opens salary calculator
  - Save salary profile alongside yearly plan
  - **Prereqs to read:** `app/goals/yearly-plan.tsx`, `services/yearly-plan.ts`
  - **Acceptance:** Both modes work. CTC calculator feeds yearly plan. Direct input bypasses tax math.

- [x] **Task D6: Capital Gains Reference Screen**
  - Informational screen: `app/goals/capital-gains-reference.tsx`
  - Shows current LTCG/STCG rates for equity, debt MFs, FDs, gold
  - Accessible from investment bucket detail screens
  - Static data (not a calculator), update yearly with budget changes
  - **Prereqs to read:** `docs/PRD.md` (F14d)
  - **Acceptance:** Reference screen renders with correct rates. Accessible from investment screens.

- [x] **Task D7: Phase 1D Integration Test & APK Build**
  - Run full test suite
  - Test investment-milestone linking end-to-end (link, contribute, verify milestone progress)
  - Test salary calculator with known CTC values (verify against manual calculation)
  - Test both tax regimes with edge cases (rebate boundary, surcharge thresholds)
  - Build APK, test on Android phone
  - **Acceptance:** All tests pass, all Phase 1D features functional on phone.

---

## PHASE 2: Smart Auto-Detection (Weeks 11-14)

**Goal:** Add SMS and email auto-detection as a convenience layer on top of manual entry.

### Week 11: SMS Auto-Detection

- [x] **Task 11.0: SMS Permission & Reader (Android)**
  - Request READ_SMS permission with contextual explanation
  - Background service to monitor incoming SMS
  - SMS reader service: fetch recent SMS from inbox
  - **Real SMS samples available:** `__tests__/fixtures/sms-samples/real-bank-sms-samples.txt` — Contains ICICI CC, Axis UPI debit, Axis CC, HDFC CC, standing instructions, EMI reminders, and payment receipts
  - **Prereqs to read:** `docs/PRD.md` (Section 6.1: SMS Parsing), `docs/SECURITY.md` (Section 3.1, Section 5)

- [x] **Task 11.1: SMS Parser Engine**
  - Bank SMS regex patterns: ICICI, HDFC, SBI, Axis, UPI
  - Extract: amount, merchant, card/account, transaction type, date
  - Confidence scoring
  - Create pending Expense record (status: pending_review)
  - Write unit tests for each bank pattern with real SMS samples
  - **Prereqs to read:** `docs/PRD.md` (Section 6.1: Indian bank SMS patterns), `docs/TEST_STRATEGY.md` (Section 3.1: SMS Parsing tests)

- [x] **Task 11.2: Realized vs Forecast Support**
  - Migration 006: add `nature` (TEXT, default 'realized') and `due_date` (TEXT, nullable) columns to expenses table, plus 2 indexes
  - Modify bank-patterns.ts: remove 3 skip patterns (keep only OTP), add 3 new BankPattern entries (SI reminder, HDFC amount due, EMI reminder) that return `isForecast: true` with parsed due dates
  - Extend ParsedSMS interface with `dueDate: string | null` and `isForecast: boolean` fields
  - Update sms-to-expense.ts: create forecast expenses for reminder types, add `findMatchingForecast()` for auto-matching when debit SMS arrives
  - Update expense.ts: add nature/due_date to Expense interface, add `AND nature = 'realized'` filter to all budget-facing queries, add `getForecastExpenses()`, `getOverdueForecasts()`, `realizeForecast()`
  - Extend data-cleanup.ts with `cleanupStaleForecasts()`
  - Convert 3 existing skip tests to forecast tests, add ~15 new tests
  - **Prereqs to read:** `services/sms/bank-patterns.ts`, `services/sms/sms-to-expense.ts`, `services/expense.ts`, `database/migrations/`
  - **Acceptance:** SI reminders, HDFC amount due, and EMI reminders create forecast expenses. Forecasts excluded from budget actuals. Debit SMS auto-matches to forecast. OTPs still skip. All tests pass.

### Week 12: Review Queue & Smart Categorization

- [x] **Task 12.0: Review Queue UI**
  - Review queue screen: pending items grouped by type
  - Swipe right to approve, left to reject, tap to edit
  - Push notification: "New expense detected: Rs 500 at Swiggy via ICICI CC"
  - **Prereqs to read:** `docs/PRD.md` (F4, Section 6.4: Approve/Reject Flow), `docs/PRD.md` (Screen 10)

- [x] **Task 12.1: Smart Categorization Engine**
  - Layer 1: Rule-based merchant keyword mapping (200+ Indian merchants)
  - Layer 2: User correction learning (merchant → category updates after N corrections)
  - Create merchant_mappings and sms_rules tables
  - **Prereqs to read:** `docs/PRD.md` (F5, Section 6.3: Smart Categorization)

### Week 11.5-12: SMS Intelligence Expansion

- [x] **Task 11.3: Unknown Category + Enhanced Learning**
  - Migration 010: `last_corrected_at` on merchant_corrections + seed Unknown category
  - Add "Unknown" to default categories (12th category: help-circle icon, #9CA3AF gray)
  - Update smart-categorizer.ts: add "fallback" source type, return Unknown category when no match
  - ~8 new tests
  - **Prereqs to read:** `services/smart-categorizer.ts`, `database/defaults/categories.ts`
  - **Acceptance:** Uncategorized SMS expenses get Unknown. Learning still works after 3 corrections.

- [x] **Task 11.4: Massive Bank Pattern Expansion**
  - No migration — pure TypeScript pattern work
  - Expand TransactionType: add refund, nach_debit, nach_bounce, upi_credit, upi_debit, balance_inquiry
  - Extend ParsedSMS: add upiRef, availableBalance, creditLimit, availableCreditLimit, accountType
  - Add ~42 new BankPattern entries across 15+ banks (ICICI, HDFC, Axis, SBI, Kotak, IDFC First, Federal, Citi, Amex, RBL, HSBC, AU Small Finance, Google Pay, PhonePe, Paytm)
  - Add 10 new bank sender codes to bank-senders.ts
  - ~42 new test cases
  - **Prereqs to read:** `services/sms/bank-patterns.ts`, `services/sms/bank-senders.ts`, `__tests__/fixtures/sms-samples/`
  - **Acceptance:** 50+ patterns, each with a test. Existing patterns unchanged. OTP skip works.

- [x] **Task 11.5: Financial Accounts Discovery + CC/Balance Tracking**
  - Migration 011: `financial_accounts` table (19 columns) + `account_id` FK on expenses + 3 indexes
  - New service: `services/financial-account.ts` (8 functions: discover, update, link, dues, NACH)
  - Integrate into sms-to-expense.ts: after creating expense, discover account + link
  - ~12 new tests
  - **Prereqs to read:** `services/sms/sms-to-expense.ts`, `services/expense.ts`, `database/migrations/`
  - **Acceptance:** SMS with card/account info auto-creates FinancialAccount entry. CC limit SMS updates creditLimit. Expenses linked to accounts.

- [x] **Task 11.6: Refunds, NACH/Auto-Pay, Extended Dues**
  - Migration 012: `refund_of_expense_id` on expenses + NACH columns on financial_accounts + 1 index
  - Add ~14 new patterns: 5 refund, 4 NACH, 5 extended CC due patterns
  - Refund matching: search 30-day window for same amount + card → link via FK
  - NACH detection: create expense + update account mandate info
  - ~15 new tests
  - **Prereqs to read:** `services/sms/bank-patterns.ts`, `services/sms/sms-to-expense.ts`, `services/financial-account.ts`
  - **Acceptance:** Refund SMS linked to original. NACH debit creates expense. CC dues from 5+ banks create forecasts.

- [x] **Task 11.7: Recurring Transaction Detection**
  - Migration 013: `recurring_transactions` table (14 columns) + 2 indexes
  - New service: `services/recurring-detector.ts` (6 functions: detect, confirm, dismiss, predict)
  - Detection algorithm: group by merchant + ~amount, classify interval (weekly/monthly/quarterly/yearly)
  - Trigger after expense approval, throttled to max once/hour
  - ~10 new tests
  - **Prereqs to read:** `services/expense.ts`, `services/smart-categorizer.ts`
  - **Acceptance:** 2+ Netflix charges detected as monthly. Different amounts = separate. Prediction works.

### Week 13: Email Integration

- [ ] **Task 13.0: Gmail OAuth Setup**
  - Gmail API OAuth 2.0 with minimal read-only scope
  - Token storage in expo-secure-store
  - Token refresh handling
  - **Prereqs to read:** `docs/SECURITY.md` (Section 3.2: Email/Gmail OAuth)

- [ ] **Task 13.1: Email Parser — Expenses (Type A)**
  - Parse bank transaction alerts, CC statements, booking confirmations, subscription renewals
  - Create pending Expense records
  - **Prereqs to read:** `docs/PRD.md` (Section 6.2: Type A — Expense Detection)

- [ ] **Task 13.2: Email Parser — Investments (Type B)**
  - Parse CAMS/KFintech MF statements, SIP confirmations, brokerage contract notes, dividend alerts, FD notices
  - Create pending InvestmentContribution or Asset update records
  - **Prereqs to read:** `docs/PRD.md` (Section 6.2: Type B — Investment & Portfolio Detection)

- [ ] **Task 13.3: Email Parser — Liabilities (Type C)**
  - Parse CC statement summaries, loan EMI reminders
  - Create pending Liability update records
  - **Prereqs to read:** `docs/PRD.md` (Section 6.2: Type C — Liability Detection)

### Week 14: Universal Review Queue & Polish

- [ ] **Task 14.0: Universal Review Queue**
  - Extend review queue for all data types: expenses + investments + assets + liabilities
  - Grouped tabs in review screen
  - Same approve/edit/reject pattern for all types
  - **Prereqs to read:** `docs/PRD.md` (Section 6.4: Universal flow)

- [ ] **Task 14.1: Phase 2 Integration Test & APK Build**
  - Test SMS detection with real bank SMS on Android
  - Test email parsing with real Gmail data
  - Test review queue flow end-to-end
  - Full test suite + security audit + APK build

---

## PHASE 3: Family Hisaab (Weeks 15-18)

### Week 15-16: Core Hisaab

- [x] **Task 15.0: Hisaab Schema & Service** (Completed 2026-04-12)
  - Migration 014: hisaab_persons, hisaab_entries, household_expenses, household_splits tables + 5 indexes
  - HisaabPerson CRUD (create, update, deactivate, get, getWithBalances) + HisaabEntry CRUD + summary + settlement
  - 20 integration tests
  - **Prereqs to read:** `docs/PRD.md` (Section 5.2: Hisaab Entities)

- [x] **Task 15.1: Hisaab Ledger UI** (Completed 2026-04-12)
  - Person list with running balances, summary card, add/edit/deactivate
  - Ledger detail per person (all debits/credits/settlements, running total, add/edit/delete entries)
  - Household expense screen (month navigator, split management, mark-paid)
  - Home dashboard Hisaab quick-access card

- [x] **Task 16.0: Shared House Expenses** (Completed 2026-04-12)
  - calculateSplits pure function (equal/percentage/fixed with rounding correction)
  - createHouseholdExpense (expense + splits + optional hisaab debit entries), CRUD operations
  - 24 unit tests


- [x] **Task 16.1: Credit & Settlement Tracking** (Completed 2026-04-12)
  - Settlement recording built into ledger screen (amount, date, description)
  - Credit/debit entry creation with type toggle
  - SMS payment_received pattern already detects GPay/bank payments (Task 11.1)
  - Household splits have mark-paid tracking

### Week 17-18: Export & Polish

- [x] **Task 17.0: Hisaab Export** (Completed 2026-04-12)
  - `services/hisaab-export.ts`: generatePersonStatement (formatted text with header, balance, transactions, branding) + generateHouseholdSummary (monthly overview with splits and paid status)
  - Indian comma formatting (₹1,00,000 style)
  - Share buttons on ledger screen (person statement) and household screen (monthly summary)
  - Uses native Share API for WhatsApp/email/any app
  - 11 unit tests

- [x] **Task 17.1: Hisaab Reminders & Summary** (Completed 2026-04-12)
  - Home dashboard Hisaab card shows live balance data (owed to you / you owe) when outstanding balances exist
  - Persons screen summary card with totalOwedToYou / totalYouOwe / netBalance
  - Dynamic card: shows balances when active, placeholder when no hisaab data

- [x] **Task 18.0: Phase 3 Integration Test & APK Build** (Completed 2026-04-12)

---

## PHASE 4: Assets, Liabilities & Net Worth (Weeks 19-21)

- [ ] **Task 19.0: Asset Tracker** — manual + auto from email
- [ ] **Task 19.1: Liability Tracker** — manual + auto from CC statements
- [ ] **Task 20.0: Net Worth Dashboard** — total assets - liabilities, trends
- [ ] **Task 21.0: Link Assets to Goals** — connect asset values to investment goal buckets
- [ ] **Task 21.1: Phase 4 Integration Test & APK Build**

---

## PHASE 5: Advanced Intelligence (Weeks 22-24)

- [x] **Task 22.0: Spending Insights** (Completed 2026-04-12)
  - `utils/spending-insights.ts`: category trends (3-month moving avg), anomaly detection, merchant analytics, day patterns, payment mode distribution, insight generation with priority scoring
  - `services/spending-insights.ts`: getSpendingInsights, getMerchantAnalytics
  - 34 unit tests

- [x] **Task 23.0: Forecast Engine** (Completed 2026-04-12)
  - `utils/forecast-engine.ts`: forecastMonthEnd (blended pace+historical with dynamic weighting), projectYearEnd (weighted average)
  - `services/forecast-engine.ts`: getMonthEndForecast, getYearEndProjection
  - 16 unit tests

- [x] **Task 23.1: Budget Recommendations** (Completed 2026-04-12)
  - `utils/budget-recommendations.ts`: 4 recommendation types (increase_budget, decrease_budget, set_budget, overall_adjustment) with evidence-based thresholds
  - 13 unit tests

- [x] **Task 23.2: Financial Health Score** (Completed 2026-04-12)
  - `utils/financial-health.ts`: composite 0-100 score from 5 weighted dimensions (Budget Compliance 30%, Savings Rate 25%, Investment Progress 20%, Recurring Control 15%, Spending Stability 10%)
  - 14 unit tests

- [x] **Task 24.0: Export to Excel** (Completed 2026-04-12)
  - `services/export-excel.ts`: generates .xlsx with 6 sheets (Expenses, Monthly Summary, Categories, Payment Modes, Recurring, Accounts)
  - 9 unit tests

- [ ] **Task 24.1: Phase 5 UI Screens** — Insights dashboard, forecast cards, health score widget, export button
- [ ] **Task 24.2: Phase 5 Integration Test & APK Build**

---

## PHASE 6: Events & Polish (Future)

- [ ] **Task F1: Event Budget Planner** — template-based event budgets
- [ ] **Task F2: Shared Event Budget** — multi-contributor events
- [ ] **Task F3: Home Screen Widget** — quick add + budget summary

---

## TASK COUNT SUMMARY

| Phase | Tasks | Completed | Remaining |
|-------|-------|-----------|-----------|
| 1A | 17 | 17 | 0 |
| 1B | 14 | 14 | 0 |
| 1C | 8 | 8 | 0 |
| 1D | 7 | 7 | 0 |
| 2 | 15 | 10 | 5 |
| 3 | 7 | 6 | 1 |
| 4 | 5 | 0 | 5 |
| 5 | 7 | 5 | 2 |
| 6 | 4 | 0 | 4 |
| **Total** | **84** | **67** | **17** |
