# Artha (अर्थ) — Project CLAUDE.md

**What this file is:** Every new Claude Code session reads this first. It tells Claude what the project is, where to find context, what phase we're in, and how to work.

---

## Project Overview

**Artha** is a personal finance mobile app (Android + iOS) built with React Native + Expo. It replaces Excel-based finance tracking with a mobile app that supports manual expense entry, budget tracking, financial goal planning, auto-detection from SMS/email, family shared accounts (hisaab), and asset/liability tracking.

**Architecture:** 100% local. No cloud, no server, no sync. SQLite on device (plaintext; protected by Android/iOS OS-level full-disk encryption). Backup/restore via encrypted files for device migration.

**User:** Sourav Baid — non-technical, building this as a personal tool with plans to monetize later.

---

## Documentation (Read These Before Working)

**App version (from `app.json`): 17.6.5** — current. Last shipped: 17.6.5.

### Project Context Documentation

All detailed project documentation is located in the `.context/` folder. Read these files to understand the project structure, architecture, and development workflow:

- **`.context/README.md`** - Overview of context documentation
- **`.context/PROJECT_OVERVIEW.md`** - High-level project summary and philosophy
- **`.context/ARCHITECTURE.md`** - System architecture and technical decisions
- **`.context/SETUP_GUIDE.md`** - Setup instructions for macOS/Linux
- **`.context/SETUP_GUIDE_WINDOWS.md`** - Setup instructions for Windows (current system)
- **`.context/BUILD_AND_RELEASE.md`** - Build and release process, including GitHub Actions workflow
- **`.context/DEVELOPMENT_WORKFLOW.md`** - Development workflow and Git conventions
- **`.context/CONVENTIONS_AND_PATTERNS.md`** - Code conventions and patterns
- **`.context/DATABASE_SCHEMA.md`** - Database schema and migrations
- **`.context/SERVICES_MAP.md`** - Service layer architecture and mapping
- **`.context/DESIGN_SYSTEM.md`** - UI/UX design system and components
- **`.context/TESTING_STRATEGY.md`** - Testing approach and guidelines
- **`.context/VERSION_HISTORY.md`** - Version history and changelog

### Current System Configuration

**Development Environment:** Windows 11
- **Package Manager:** Scoop
- **Node.js:** v25.5.0 (via Scoop)
- **Java:** JDK 21 (via Scoop)
- **Android SDK:** C:\Users\soura\AppData\Local\Android\Sdk
- **Build System:** GitHub Actions (automated) + local Gradle scripts
- **Branch Strategy:** staging → main workflow

### Build Workflow

1. **Staging Branch:**
   - Package name: `com.souravbaid.artha.staging`
   - App name: "Artha Stg"
   - Purpose: Testing new features
   - Separate app from production

2. **Main Branch:**
   - Package name: `com.souravbaid.artha`
   - App name: "Artha"
   - Purpose: Production builds
   - Updates main app

3. **Automated Builds:**
   - GitHub Actions automatically builds APKs on push to staging/main
   - Creates GitHub releases with version tags
   - Uploads APKs to releases
   - No manual build scripts needed (unless testing locally)

### Available Batch Scripts (Windows)

- `install-deps.bat` - Install npm dependencies
- `setup-env.bat` - Set environment variables
- `prebuild-android.bat` - Generate android/ directory
- `configure-android.bat` - Configure Android build
- `build-apk.bat` - Build release APK locally
- `build-eas.bat` - Build using EAS CLI (fallback)

### 17.5.24–17.5.26 session additions — UX overhaul: Home accounts, Compare fixes, Notifications, Saved Filters, Demat charts

Multi-release session covering 4 builds. Key changes:

**v17.5.24 — Home accounts + interactive charts:**
- Loan summary card moved to "Your Accounts" section (matching bank/demat/wallet card design)
- Added totalMonthlyEMI to loan summary
- Demat per-account cards show combined total (portfolio + fund) with breakdown
- TrendLineChart redesigned: tap-for-tooltip, vertical indicator, better x-axis, legend shows values
- Compare drill-down: all amounts tappable → opens filtered expense list

**v17.5.25 — Compare bugs + Notifications rewrite:**
- Fixed 3 compare bugs: missing deleted_at filter, investment-linked inflation, raw vs effective amounts
- Added NOT_INVESTMENT_LINKED exclusion to all compare queries (consistent with budget)
- Fixed filtered list to show effective amounts (amount - refunds)
- Notifications rewrite: pre-scheduled system alarms (DailyTriggerInput, DateTriggerInput, MonthlyTriggerInput)
- Monthly summary notification on 1st of month at 9am
- Demat chart changed to monthly with month-by-month navigation

**v17.5.26 — Saved filter views + per-day chart + clear SMS:**
- Saved Filter Views: save/recall/default named filter combos on Transactions tab
- Active filter pills: removable chips showing applied filters when panel is closed
- Demat chart: per-day snapshots within a month, navigate month-by-month (← May 2026 →)
- Clear unrecognised SMS button in Settings → Smart SMS Templates
- Compare: "R1"/"R2" labels replaced with date ranges + year (e.g., "May '26")
- Compare: "+N more merchants" is now tappable (expand/collapse)
- Compare: merchant list increased from 15 → 30

**Files touched (across 3 releases):**
- `components/home/LoanSummaryCard.tsx` (new)
- `services/saved-filter-views.ts` (new)
- `app/(tabs)/index.tsx`, `app/(tabs)/expenses.tsx`
- `app/insights/compare.tsx`, `app/insights/filtered.tsx`
- `app/reconciliation/demat-portfolio.tsx`
- `app/settings/notifications.tsx`, `app/settings/sms-templates/index.tsx`
- `components/charts/TrendLineChart.tsx`
- `services/comparison-insights.ts`, `services/financial-account.ts`
- `services/loan-accounts.ts`, `services/notifications.ts`
- `services/notification-scheduler.ts`, `services/sms/sms-parser.ts`
- Help docs + index.json regenerated

**Testing:** 1335/1335 pass. TS clean on source files.

### 17.5.12 session additions — expense→loan prepayment gate uses current (not sanctioned) EMI

User report: after a `reduce_emi` prepayment has lowered a loan's tail EMI, linking a subsequent expense whose amount is ≥ the CURRENT EMI (but still < the original sanctioned EMI) was wrongly taking the trivial-path short-circuit in `LoanPaymentPickerSheet` — auto-skipping the strategy picker.

**Root cause:** the gate was comparing `expenseAmount < selectedLoan.emi_amount`. `loan.emi_amount` is the immutable sanctioned-at-disbursement value; after any `reduce_emi` prepayment the real tail EMI on the schedule is lower. So an expense that matches (or just exceeds) the current EMI still compared as "smaller than one EMI" under the sanctioned yardstick, and the sheet silently used `reduce_tenure` without asking.

**Fix:** `components/expense/LoanPaymentPickerSheet.tsx` now resolves the current EMI from the loaded schedule using the same fallback chain as `getCurrentEMIsByLoanId` — prefer the next scheduled / overdue installment on-or-after the expense date, else the most recent installment on-or-before, else fall back to `selectedLoan.emi_amount`. Both the forward-direction trivial-path gate and the back-navigation condition on the payment-details step use this live value.

Side effect consistent with the user's literal ask: when the prepayment amount equals or exceeds the real EMI, the strategy picker (Reduce tenure / Reduce EMI) is always shown.

No engine change needed — the engine's trivial-path gate in `services/loan-engine.ts` already operates on the current loan state (via the fresh schedule), so the UI gate just needed to agree.

**Files touched:**
- `components/expense/LoanPaymentPickerSheet.tsx` — new `currentEmi` derived value; two gate references updated
- `app.json` — 17.5.11 → 17.5.12, versionCode 170511 → 170512

**Testing:** 1333/1333 pass. TS clean.

Version bump: **17.5.11 → 17.5.12** (PATCH — 1 logic fix).

### 17.5.11 session additions — prepayment list restyle + expense→loan link metadata capture

Two user reports post-v17.5.10:

**1. Prepayment list doesn't match the app's list grammar.** The Prepayments card on loan detail rendered rows inside a shadowed `<Card>` with a hand-rolled 36×36 icon + two-column layout — visually distinct from every other list in the app (Expenses, Simulator, Reminders, etc., which share the `ExpenseListItem` silhouette).

Rewrote the card to the canonical shape:
- Dropped the `<Card>` shell in favour of an inline uppercase section header `Prepayments · N` (matching the simulator `EntryGroup` and Expenses section labels).
- Row uses `flex-row items-center px-4 py-3.5 border-b border-border-light dark:border-border-dark` — same as `ExpenseListItem`.
- 40×40 icon circle: accent tint for part-payment (`arrow-down-circle-outline`), `StatusColors.warning` tint for foreclosure (`flag-outline`) — foreclosure reads as a terminal event so the warning color is honest.
- Primary label is the kind ("Part payment" / "Foreclosure") with the strategy ("Reduce tenure" / "Reduce EMI") rendered as a small accent-tinted pill after the label — exactly mirrors how `ExpenseListItem` shows the "Split" pill.
- Metadata line: only shows when there's actually a charge (previously always rendered a date line).
- Right column: amount in `text-sm font-bold` (success green) + date beneath in `text-[11px] text-secondary` — stacked, right-aligned, same as `ExpenseListItem`.
- Trash moved into a 36×36 pressable at the far right of the row.

**2. Expense → Loan prepayment link dropped user metadata.** `LoanPaymentPickerSheet` only asked the user for kind=emi|prepayment + strategy and called `linkExpenseAsPrepayment` with `kind: "part_payment"`, `prepayment_charge: 0`, `gst_on_charge: 0` hard-coded. The standalone `PrepaymentSheet` (used from the loan detail "Record Prepayment" button) captures all three — so expense-linked prepayments looked under-reported next to manual ones.

Added a 4th step "Payment details" to `LoanPaymentPickerSheet`:
- **Type chip toggle**: Part payment / Foreclosure (pill-style, accent-filled when selected, same grammar as Expenses tab filter chips).
- **Prepayment charge + GST**: two `decimal-pad` text rows inside a bordered surface card with helper text clarifying that charges are over-and-above the expense amount.
- **Save prepayment** primary button at the bottom.
- Works on both the normal strategy-picked path AND the v17.5.7 trivial-path short-circuit — in the trivial case the strategy step is auto-skipped but the details step still renders (previously auto-submitted with zero charges).
- Back-nav routes correctly: from details back to strategy on normal path, or back to installment picker / loan picker on the trivial-path short-circuit.

Consumer in `app/expense/[id].tsx:handleLoanPaymentSubmit` extended to thread `prepayment_kind`, `prepayment_charge`, `gst_on_charge` through to `linkExpenseAsPrepayment`. Service signature already accepted these — the UI just wasn't collecting them.

**Files touched:**
- `app/loans/[id].tsx` — prepayment list rewrite (~100 LOC rewritten; net ~+30 LOC after formatter)
- `components/expense/LoanPaymentPickerSheet.tsx` — new `prepayment_details` step + `KindChip` helper + extended `onSubmit` payload; strategy picks now advance to details instead of submitting
- `app/expense/[id].tsx` — forward new payload fields to `linkExpenseAsPrepayment`

**Testing:** 1333/1333 pass. TS clean on source files.

Version bump: **17.5.10 → 17.5.11** (PATCH — 1 UI consistency fix + 1 metadata-capture parity fix, no new feature surface).

### 17.5.10 session additions — rollup of v17.5.8 + v17.5.9 + v17.5.10 (data safety, cold-start perf, UX cleanup, simulator matched-entry card fix)

Three-in-one release driven by the post-v17.5.7 audit (`~/.claude/work-docs/treasury/personal/Artha_v17.5.8-v17.5.10_Plan.md`). Executed together rather than as three patch releases to minimise re-install churn — all three rollups scoped to non-overlapping file sets.

**Part 1 — Data safety (transaction wrappers).** Seven multi-statement delete/cascade functions now execute inside `db.withTransactionAsync`, so a crash mid-sequence rolls back rather than leaving orphan rows. Also dropped two misleading `await bumpDataVersion()` calls on a sync function.

- `services/loan-accounts.ts:deleteLoanFully` — 4 mutations (expense_loan_links clear, investment_buckets FK null, loan_accounts delete, financial_accounts delete) now transactional.
- `services/yearly-plan.ts:deleteYearlyPlan` — 3-step cascade (contributions → buckets → plan) wrapped; FKs don't have `ON DELETE CASCADE` so order mattered and partial failure was possible.
- `services/yearly-plan.ts:deleteInvestmentBucket` — contributions-then-bucket wrapped.
- `services/financial-account.ts:hardDeleteAccount` — 7 mutations (4 deletes + 2 unlinks + 1 final delete) wrapped; stray `await bumpDataVersion()` on a sync function dropped.
- `services/hisaab.ts:hardDeletePerson` — 5 mutations wrapped (hisaab entry cleanup + split-person clear + person delete).
- `services/account-credit.ts:hardDeleteCredit` + `purgeAllDeletedCredits` — wrapped; stray `await bumpDataVersion()` dropped; `purgeAll…` now captures the final `changes` count outside the transaction block and only bumps when > 0.

**Part 2 — Cold-start perf (duplicate-scan cache + splash decouple + yearly-plan batch + loan detail parallelization).** The root causes of "app takes time to load":

1. **Duplicate-scan module-level cache + auto-invalidation.** `scanAllDuplicates` used to run on every Home load + every Review Queue focus + cold-start splash. New `scanAllDuplicatesCached(userId)` in `services/duplicate-detection.ts` — in-memory cache with 60s TTL and single-inflight-promise guard (second caller awaits the first rather than stampeding). A module-level `subscribeDataVersion` listener auto-invalidates the cache on any expense mutation, so cache freshness is driven by real writes rather than clock. `invalidateDuplicateScanCache()` exposed for the Settings "Scan now" button (bypasses cache for user-initiated fresh scans). The subscribe call is guarded in a try/catch so the test environment's simpler MMKV mock can still import the module without crashing. Wired into `app/(tabs)/index.tsx`, `services/home-preload.ts`, `app/expense/review-queue.tsx` — all three hot paths now share the cache.

2. **Splash decoupled from preload.** `app/_layout.tsx` used to `await preloadHomeData()` before dismissing the splash — which meant the scan duration directly inflated cold start for users with long history. Changed to fire-and-forget: `preloadHomeData().catch(...)`. Splash dismisses as soon as seeds + notification channel finish; Home renders on the live loader with its existing skeleton state, then re-renders when preload cache lands.

3. **Yearly Plan loan-forecast N+1 → 3 batched queries.** `app/goals/yearly-plan.tsx` used to run 3 serial queries × N loans per focus (`getSchedule`, `getPrepayments`, `SELECT bank_name FROM financial_accounts`). Two new service helpers — `getSchedulesByLoanIds(ids)` + `getPrepaymentsByLoanIds(ids)` in `services/loan-accounts.ts` — return `Map<loanId, rows[]>` via single IN-clause queries. Bank name comes from the existing `listAllLoansWithBankName`. 5 loans = 15 round-trips → 3 parallel queries.

4. **Loan detail screen — 5 serial awaits → Promise.all.** `app/loans/[id].tsx` `load()` resolved the loan then did 5 independent reads one-at-a-time (bank name, schedule, prepayments, corrections, outstanding). Now `Promise.all` after the initial `getLoanById`. Noticeable on loans with long schedules.

**Part 3 — UX cleanup.** Small changes, broad user-visible impact.

1. **DateInput rewritten — tap-to-open picker, no raw text entry.** `components/ui/DateInput.tsx` used to expose a TextInput with "YYYY-MM-DD" placeholder + a "Use format YYYY-MM-DD" blur error. Users were typing 04/2025 and seeing cryptic validation failures. Now a pressable row that displays the formatted date via `formatDate(value)` (locale-aware) and opens the `CalendarModal` on tap. Same prop signature (`label`, `value`, `onChange`, etc.) so every caller — account-ledger, insights/compare, account-detail, account-add, milestones, milestone-detail, investment-detail, settings, expenses, hisaab/ledger — benefits without touching call sites.

2. **Reminders list formatted dates.** `app/settings/recurring-rules.tsx` used to render raw ISO: "Last paid on 2026-05-02" and "Next: 2026-06-02". Now both pass through the canonical `formatDate` helper.

3. **Loan form + account-ledger date alerts — ISO suffix dropped.** `app/loans/add.tsx` validation messages lost the "(YYYY-MM-DD)" suffix. `app/reconciliation/account-ledger.tsx` date-format alerts rewritten from "Please enter date as YYYY-MM-DD" / "Date must be in YYYY-MM-DD format" to "Please pick a valid date" — the DateInput picker already enforces the format; the alert was dead-code visible.

4. **Per-entity noise cleanup (extends v17.5.6).** `app/settings/account-detail.tsx`:
   - Monthly Balance Ledger now hidden for `accountType === "credit_card"` (was already hidden for loan/demat). The Bank-Reported Balance card below already owns the authoritative utilized/remaining figures — two overlapping concepts were confusing users. Also dropped the "Available limit at start" placeholder that mislabeled the seed input when CC ledger WAS visible.
   - Linked Payment Modes now hidden for `accountType === "demat"` (was already hidden for loan). Investment accounts don't route expenses.

5. **BalanceSourceCard section label — branches by account type.** `components/account/BalanceSourceCard.tsx` used to say "Bank-Reported Balance" for every account in a non-pool context. Wrong for wallets (Paytm/PhonePe aren't banks) and for credit cards (SMS reports utilized/available, not a "balance"). New optional `accountType` prop; label derives from it: `"Latest Reported Balance"` for wallets, `"Latest Reported Usage"` for credit cards, `"Bank-Reported Balance"` as default. Pool label unchanged.

6. **Smart Rules terminology — "right/wrong-spend" → "unavoidable/discretionary".** The rest of the app uses Unavoidable / Discretionary; Smart Rules had drifted. Copy updates only (internal column name `action_is_right_spend` stays).

7. **Hisaab ledger hardcoded colors.** Three `#2E2E2E` hex leaks (dark-mode token inside static classNames — breaks in light mode) replaced with theme tokens: `border-[#2E2E2E]` → `border-border-light dark:border-border-dark`; `bg-[#2E2E2E]/10` on the phone-call badge → `bg-border-light/40 dark:bg-border-dark/40`.

8. **Settings Duplicate Groups banner — warning token.** Two hardcoded `bg-[#F59E0B14]` + `text-[#F59E0B]` banner instances now derive from `StatusColors[colorScheme].warning` so dark mode and future theming work correctly.

9. **Simulator matched-entry card — consistent with planned entries.** `app/simulator/[id].tsx` "Already happened" rows were rendering inside `<Card>` (elevated = shadowed) which produced a visible white floating panel in light mode. Now they use the same flat `Pressable` row styling as planned entries — surface background, 1px border, no shadow — with 75% opacity to keep the "past/done" visual cue. Long-press + tap-to-open behavior preserved.

10. **Silent-catch logging.** Two catch blocks that swallowed real failures now surface them via `@/utils/logger`: `app/settings/account-detail.tsx` load path (`logger.warn`), `app/reconciliation/account-ledger.tsx` reclassify-credit path (`logger.error` + the error message appended to the existing user-facing alert).

**Test mock updates.**
- `__tests__/integration/yearly-plan.test.ts` + `__tests__/unit/v14-regression.test.ts` — mock `db` objects now include `withTransactionAsync: jest.fn(async (fn) => { await fn(); })`, matching the real SQLite API the transaction-wrapped delete functions now invoke.

**Files touched:**
- Services (transaction wrappers): `services/loan-accounts.ts`, `services/yearly-plan.ts`, `services/financial-account.ts`, `services/hisaab.ts`, `services/account-credit.ts`
- Services (perf): `services/duplicate-detection.ts` (cache + subscribe), `services/home-preload.ts`, `services/loan-accounts.ts` (`getSchedulesByLoanIds`, `getPrepaymentsByLoanIds`)
- App (perf): `app/_layout.tsx` (splash decouple), `app/(tabs)/index.tsx`, `app/(tabs)/settings.tsx`, `app/expense/review-queue.tsx`, `app/goals/yearly-plan.tsx`, `app/loans/[id].tsx`
- UI primitives: `components/ui/DateInput.tsx`, `components/account/BalanceSourceCard.tsx`
- App (UX cleanup): `app/settings/recurring-rules.tsx`, `app/loans/add.tsx`, `app/reconciliation/account-ledger.tsx`, `app/settings/account-detail.tsx`, `app/settings/smart-rules/index.tsx`, `app/settings/smart-rules/[id].tsx`, `app/hisaab/ledger.tsx`, `app/simulator/[id].tsx`
- Tests: `__tests__/integration/yearly-plan.test.ts`, `__tests__/unit/v14-regression.test.ts`
- Version: `app.json` 17.5.7 → 17.5.10, versionCode 170507 → 170510

**Testing:** 1333/1333 pass. TS clean on source files (only pre-existing `services/backup.ts` AES noise unchanged).

**Deferred (per plan):**
- `account-ledger` / `hisaab/ledger` ScrollView → FlatList (C3) — high-risk, own release, flagged since v14.8.0
- Loan-accounts integration tests (H9–H11) — bundle with next loan feature change
- Remaining analytics `React.memo` pass — not user-perceptible
- Unified account-view navigation (H13-nav) — needs design decision

Version bump: **17.5.7 → 17.5.10** (PATCH ×3 rolled up — data-safety + perf + UX scope stays within the PATCH envelope because no new feature surface lands).

### 17.5.6 session additions — current-EMI display, loan/account linkage, account-detail noise cleanup

Post v17.5.5 feedback. Several threads:

1. **Current-EMI display fixed in two more spots.** v17.5.2's `reduce_emi` prepayment correctly writes the new (lower) EMI onto every tail schedule row, but two UI surfaces were reading `loan.emi_amount` (the immutable sanctioned-at-disbursement value) and showing the stale original:
   - Loan detail Hero card's "EMI" line — now reads `nextEMI?.emi_amount ?? loan.emi_amount` (falls back only if no scheduled installments remain).
   - `app/goals/loans.tsx` list card "… · EMI X" line — now uses a new `current_emi` field enriched from `getCurrentEMIsByLoanId` (new service helper, batched per-loan lookup of the next scheduled EMI).
   Yearly Plan + YoY Comparison already read from the schedule directly and were correct before; no change needed there.

2. **New service: `getCurrentEMIsByLoanId(userId, asOfDate) → Map<loanId, number>`.** Batched single-query lookup of each active loan's current EMI. Preference order:
   - Next `scheduled` installment on/after `asOfDate` → its `emi_amount`.
   - Fallback: last installment on/before `asOfDate` (captures closed loans + edge cases).

3. **Account Master ↔ Loan linkage cleanup.** User asked: "no linkage between loan added and the loan account in account master." Looking at the code, account-master.tsx already routes loan-type account taps to `/loans/[id]`. But the problem is deeper — when a user navigates to a loan account via OTHER paths (home stat card, hisaab, deep-link), they land on `app/settings/account-detail.tsx` which shows a generic layout that doesn't apply to loans:
   - "Monthly Balance Ledger" — irrelevant (loan's source of truth is the amortization schedule, not user-entered monthly balances)
   - "Bank-Reported Balance" (BalanceSourceCard) — irrelevant (loan has no reported balance; the outstanding is derived)
   - "Linked Payment Modes" — meaningless (loans aren't payment instruments)
   - "Account Type" picker (2-col grid) — dangerous to allow on loans (changing the type would orphan the loan_accounts row + its schedule)
   All four now hidden for `accountType === "loan"`. Replaced with a single clean navigation tile: "View loan details" (amortization schedule, prepayments, corrections) that routes to `/loans/[id]`.

4. **Prepayment / Correction row icon parity.** User flagged inconsistent presentation on loan detail — Prepayment rows had a colored circle icon + text, Manual Correction rows had text only. Added a matching circle icon (`construct-outline` inside the accent-tinted circle) to every Correction row so the two lists read as peers.

5. **≤ EMI trivial path.** Already shipped in v17.5.5 but noted here for continuity: the engine's "tiny prepayment, just reduce principal" short-circuit now triggers at `net <= loan.emi_amount` (was `<`). Sheet gates (strategy toggle visibility, small-prepayment info card, "Months saved" / "New EMI" preview rows) all updated consistently.

6. **SMS → amortization: no-op today, documented.** User asked whether SMS auto-detect updates amortization. Answer: partially. `services/loan-sms-matcher.ts` already tries to match an SMS-detected expense to an unpaid installment within ±5d and ±5%. When it matches, it stamps the installment `paid`. That's enough to keep the "current EMI" logic accurate after `reduce_emi` prepayments because the SMS amount matches the (post-reduction) schedule EMI. What's NOT done: out-of-band prepayments (user pays extra via their bank app without recording it in Artha) don't auto-trigger `recordPrepayment`. Deferred — needs a product decision on auto-detection thresholds and confirmation UX.

7. **"Amortization doesn't update" bug (from v17.5.4 session).** Closed after investigation in this session. Engine + rebuildLoanSchedule math verified correct via 3 new repro tests (`__tests__/unit/loan-rebuild-repro.test.ts`). The actual user-visible issue was the stale `loan.emi_amount` display on the Hero card (item 1 above), not an engine bug.

**Files touched:**
- `services/loan-accounts.ts` — new `getCurrentEMIsByLoanId` batch helper.
- `app/loans/[id].tsx` — Hero EMI uses `nextEMI`; Manual Correction rows now have circle icon + text matching Prepayment rows.
- `app/goals/loans.tsx` — list enrichment + render of `current_emi`.
- `app/settings/account-detail.tsx` — hide Monthly Balance Ledger, BalanceSourceCard, Linked Payment Modes, Account Type picker for `accountType === "loan"`; add "View loan details" navigation tile for loan accounts.
- `__tests__/unit/loan-rebuild-repro.test.ts` (new) — 3 repro tests for prepayment-updates-amortization flow.

**Files untouched by design:**
- `services/loan-sms-matcher.ts` — already correct for post-prepayment EMI matching (matches against schedule's current EMI, not `loan.emi_amount`).
- `app/settings/account-master.tsx` — already routes loan account taps to `/loans/[id]` (was done in v17.4.0).

**Testing:** 1333/1333 pass. TypeScript clean on source files.

Version bump: **17.5.5 → 17.5.6** (PATCH — current-EMI display fixes surface correct math that was already in place; UI cleanup on the loan-in-account-detail screen).

### 17.5.5 session additions — loan detail action tiles + amount ≤ EMI trivial path

Two small threads bundled:

**1. Loan detail action layout restructured (second rework).**

v17.5.4 had introduced an "ActionRow" list inside a bordered box — each row had a small icon tile (36×36 with `colors.background` fill, no accent color). User flagged it as still poor:
> "all the actions, foreclose quote and manual correction, why are you designing it so badly… everything is just left aligned and sticking"

The underlying issue: the ActionRow pattern didn't match the rest of the app. Home tab's "Explore & Tools" section uses individual `<Card>` tiles per action, each with a w-10 h-10 rounded-full accent-alpha icon circle. That's the app's native "tap tile" shape.

Rewrote loan detail's action section to use the same pattern:
- Uppercase section label "Manage this loan" (text-xs font-semibold uppercase tracking-wider — matches "Explore & Tools" exactly).
- Each action is now its own `<Card className="mb-2">` tile via a new `ActionTile` component.
- Icon circle uses `acAlpha(accent, 500, 0.08)` + `ac(accent, colorScheme, 600, 300)` for normal actions, red alpha + red for destructive (`danger` prop).
- `Pressable` wraps the whole Card so the entire tile is a tap target.
- Actions listed: Foreclose quote, Manual correction, Edit loan details, Delete loan (danger).

Also dropped the leftover `ActionRow` helper at the bottom of the file.

**2. Small-prepayment trivial path threshold: `<` → `≤`.**

User feedback:
> "prepayment condition should be less than or equal"

`services/loan-engine.ts:applyPrepayment` was gating the trivial path (reduce principal only, no strategy, preserve tail EMI + length) at `net > 0 && net < loan.emi_amount`. The boundary `net === loan.emi_amount` was incorrectly falling through to the strategy-driven full-regen path. Now `net > 0 && net <= loan.emi_amount` — exactly-one-EMI prepayments take the trivial path, matching user mental model.

Sheet gates synchronized:
- Strategy toggle: shown only for `amountNum > loan.emi_amount` (was `>= loan.emi_amount`).
- Small-prepayment info note: shown for `amountNum <= loan.emi_amount` (was `< loan.emi_amount`). Text updated from `<` to `≤` symbol.
- Impact preview "Months saved" / "New EMI" rows: `> loan.emi_amount` (was `>= loan.emi_amount`).
- `handleConfirm` effective strategy: `amountNum <= loan.emi_amount ? "reduce_tenure" : strategy` (strategy ignored for trivial-path amounts; `reduce_tenure` is the default hint — engine ignores it on the trivial path anyway).

**Files touched:**
- `app/loans/[id].tsx` — ActionTile component + section label, replaces prior ActionRow list.
- `services/loan-engine.ts` — `<` → `<=` in trivial-path gate.
- `components/loans/PrepaymentSheet.tsx` — mirrored gate updates.
- `__tests__/unit/loan-rebuild-repro.test.ts` kept from v17.5.4 investigation.

Version bump: **17.5.4 → 17.5.5** (PATCH — 1 UI rework + 1 engine boundary fix).

### 17.5.4 session additions — loan detail UI rework + bulk review-queue ops

User-reported issues after v17.5.3 install:
- Loan detail page icons "compressed together on the left"; delete icon on prepayment rows "not aligned"
- Amortization "does not update after EMI reduction or Tenure Reduction" — investigated; engine + rebuildLoanSchedule logic is correct (tests green); likely a stale-render or small-amount trivial-path case.

**Loan detail UI rework:**
- Action strip (4 cramped icons) → proper **ActionRow** component: each row has a rounded icon tile (36×36), primary label, sublabel, right chevron. Same pattern as the Goals list rows. 4 rows instead of 4 squashed icons: "Foreclose quote", "Manual correction", "Edit loan details", "Delete loan". "Delete loan" row is flagged `danger` — uses red icon tile + red text.
- Primary "Record Prepayment" button stays at top.
- Prepayment + Manual Correction rows rewritten: flat `View` with `flexDirection: row` parent, inner `Pressable` (flex: 1) for tap-to-edit, right-aligned 36×36 Pressable for trash icon. Fixes the nested-Pressable + `className="p-1"` misalignment that was causing the compressed icon column.

**Perf: bulk approve/reject in review queue.**
- New `approveExpenses(ids[])` + `rejectExpenses(ids[])` in `services/expense-crud.ts` — one `UPDATE ... WHERE id IN (?, ?, ...)` instead of N serial UPDATEs. Account-resolution for unlinked credits still per-row but via `Promise.all`.
- Wired into `app/expense/review-queue.tsx:handleApproveAutoDetected` + `handleRejectAutoDetected`. Bulk approving a 30-item queue goes from 30 serial round-trips → 1 UPDATE + ≤N parallel account resolves.
- Re-exported from `services/expense.ts` barrel.

**Files touched:**
- `app/loans/[id].tsx` — ActionRow component + action-row grid + prepayment/correction row rewrites
- `app/expense/review-queue.tsx` — bulk approve/reject calls
- `services/expense-crud.ts` — `approveExpenses` + `rejectExpenses`
- `services/expense.ts` — barrel re-exports
- `app.json` — 17.5.3 → 17.5.4

**Testing:** 1330/1330 pass. TS clean on source files.

Version bump: **17.5.3 → 17.5.4** (PATCH — 2 UI fixes + 1 perf win, no new feature surface).

### 17.5.3 session additions — loan crash fix + perf batches + UI polish + color tokens

User-reported bug on v17.5.2: "Something went wrong, please restart the app" on loan details page.

**Loan detail crash fix (critical).**
- Rules-of-hooks violation introduced by v17.5.2 memoization pass: `useMemo` for `totalInterestPaidToDate` / `Remaining` / `nextEMI` / `visibleSchedule` ran AFTER `if (!loaded) return` / `if (!loan) return` early-returns. When `loaded` flipped false→true React saw a different hook count across renders and crashed with "Rendered more hooks than during the previous render". Moved both `useMemo` calls ABOVE the guards.

**Perf (N+1 + batch writes):**
- **Simulator list N+1** — new `getScenarioOverviewsBatch(scenarioIds, userId)` computes baseline ONCE (identical across all scenarios) and threads it into per-scenario overview math. Fan-out drops from 4 queries × N scenarios to (3 baseline queries + 2 × N). Wired into `app/simulator/index.tsx` list load.
- **Expenses tab `loadExpenses` callback** — was recreated on every append via `expenses.length` in deps, causing callback-ref churn. Now reads offset via `useRef`; deps dropped.
- **Tag writes batched** — new `addTagsToExpense(expenseId, tagIds[])` multi-row INSERT helper. Wired into add-expense + split-tender legs (via `Promise.all` for per-leg). Was N serial INSERTs per tag.
- **`ActionSuggestionCard` memoized.** Chart components (`DonutChart`, `TrendBarChart`, `TrendLineChart`) already memoized by linter.

**UI polish:**
- Categories icon collision fixed in Data Cleanup sheet (both Categories + Tags were `pricetags-outline`; Categories → `grid-outline`).
- Recycle-bin "Recurring" dialogs renamed to "Pattern" for terminology consistency.
- Stop reminder copy synchronized between `app/expense/[id].tsx` and `app/settings/recurring-rules.tsx`.

**Color tokens:**
- Notifications banner permission prompt — hardcoded `bg-[#FEF3C7] dark:bg-[#78350F]` + `text-[#92400E] dark:text-[#FDE68A]` → `StatusColors[colorScheme].warningBg` + `.warning`. Linter swept this during v17.5.2.
- Spending Pulse arrows — hardcoded `#22C55E`/`#EF4444` → `StatusColors[colorScheme].success`/`.danger` (linter).

**Dead cards (from v17.5.2 product audit, user-confirmed cleanup):**
- `app/advisor/*` (Coming Soon stub) removed.
- `app/reconciliation/*` (Coming Soon stub) removed.
- `v15_advisor_card` + `v15_reconcile_card` feature flags dropped from the home-card catalog.
- Deep-link allowlist in `constants/routes.ts` pruned.

**Files touched:**
- `app/loans/[id].tsx` — useMemo moved above early-returns
- `app/simulator/index.tsx` — batch overview load + static logger import
- `app/(tabs)/expenses.tsx` — ref-based offset
- `app/expense/add.tsx` — `addTagsToExpense` in lieu of serial loop
- `app/(tabs)/settings.tsx` — Categories icon on cleanup sheet
- `app/settings/recycle-bin.tsx` — "Recurring" → "Pattern" copy
- `app/settings/recurring-rules.tsx` — Stop reminder alert copy
- `services/expense-crud.ts` + `services/loan-accounts.ts` + `services/notification-scheduler.ts` — 15 empty `catch {}` → `logger.warn`
- `services/smart-rules.ts` — `safeParseTagIds` helper extracted
- `services/simulator.ts` — `getScenarioOverviewsBatch` added
- `services/tags.ts` — `addTagsToExpense` batch helper
- `services/yearly-plan.ts` — `onLoanPrepayment` parallel
- `services/backup.ts` — AES typing pin
- `services/home-card-preferences.ts` — advisor/reconcile pruned
- `components/analytics/ActionSuggestionCard.tsx` — `memo` wrap
- `components/charts/*` — `memo` (linter)
- `components/simulator/EntryEditSheet.tsx` + `StaleEntryResolveSheet.tsx` + `simulator/[id].tsx` — local `todayIso`/`addDays` duplicates cleaned
- Dead files removed: `components/simulator/TrajectoryChart.tsx`, `components/ui/DateRangeChips.tsx`, `app/loans/index.tsx`, `app/advisor/*`, `app/reconciliation/*`
- `app.json` — 17.5.2 → 17.5.3

**Testing:** 1330/1330 pass. TS clean on source files.

Version bump: **17.5.2 → 17.5.3** (PATCH — 1 critical crash fix + batch perf wins + UI polish + dead-code removal).

### 17.5.2 session additions — loan correctness, rupee rounding, N+1 fixes, code safety pass

User reported two live bugs on v17.5.1: "Couldn't record prepayment" UNIQUE constraint crash, and interest-saved math that didn't match bank statements. Bundled fix into a broad correctness + perf + code-hardening pass driven by three audit agents.

**Loan math (user-reported bugs + correctness):**

- **Small-amount prepayment → trivial path.** When prepayment amount < one EMI, engine now reduces principal only: no strategy toggle, no tail regen, same installment_num set, same EMI (last installment absorbs drift). Matches what Indian banks actually do on statements and sidesteps the UNIQUE constraint bug by never touching installment_num. The strategy toggle is conditionally hidden in `PrepaymentSheet` when amount drops below EMI.
- **Rupee-level rounding (migration 034).** New `round_mode` column on `loan_accounts` — default `'rupee'` for INR loans, `'paise'` for others. Engine rounds EMI/principal/interest to ₹1 for Indian loans so numbers match bank statements. New `roundBy(n, mode)` helper in `services/loan-engine.ts`. Threaded through `generateSchedule` + `applyPrepayment` via `loanToParams()`.
- **`rebuildLoanSchedule` hardening.**
  - Wrapped in `db.withTransactionAsync` — partial rebuild can't leave the schedule table in a corrupt state on UNIQUE violation.
  - Dedup safety-net before INSERT: groups stamped entries by `installment_num`, keeps the last occurrence per num. Belt-and-suspenders for the class of bug user hit.
  - Batched INSERTs into multi-row VALUES chunks of 50 rows. 120 serial inserts → 3 chunks for a 10-year loan. `createLoan` + `updateLoan` + `rebuildLoanSchedule` all use the new `batchInsertScheduleEntries` helper.
- **Error surfacing.** `recordPrepayment` / `updatePrepayment` / `deletePrepayment` / `createCorrection` / `updateCorrection` / `deleteCorrection` now wrap their inner work with `try { ... } catch (e) { throw new Error(\`[Step] — ${reason}\`) }`. Generic "Couldn't record prepayment" alerts now show the actual step + SQLite reason. Non-fatal bucket-recompute failures log via `logger.warn` instead of silent swallow.
- **Single-source engine params.** Replaced three inline spreads of loan fields into `generateSchedule`/`applyPrepayment` with `loanToParams(loan)` calls. Ensures `round_mode` threads through every call site without manual plumbing.

**YoY Comparison — Loans & Debts gap semantics (user-reported):**

Shipped in v17.5.1: row direction `lowerIsBetter: true` (outflow shrinks YoY = good). But plan-vs-actual gap inherited the same flag and punished over-delivery — paying *more* than planned should be good (faster debt payoff). Added optional `gapActualHigherIsBetter` to `YoYCategory`, set `true` for Loans & Debts. Updated the gap banner in `app/goals/yoy-comparison.tsx:actualVsPlan` + the overall-trend scorer. New test `"loans & debts: gap semantics invert"`.

**Loan perf:**

- **`/goals/loans` triple N+1 → 2 queries.** Was: 1 JOIN + per-loan `SELECT bank_name` + per-loan `getLoanOutstandingAt` (which itself does 3 sub-queries). With 5 loans = 20 round-trips per focus. New `listAllLoansWithBankName()` JOIN + new `getLoanOutstandingsByLoanId()` batch that pulls all schedules/prepayments via IN-clause. Same treatment applied to the older `getLoanOutstandingsByFA` (used by balance-sheet).
- **Loan detail memoization.** `totalInterestPaidToDate` / `totalInterestRemaining` / `nextEMI` wrapped in `useMemo([schedule])`. `visibleSchedule` (slice(0,5).concat(slice(-5))) memoized too. Prevents full `.filter/.reduce/.sort` on every sheet open or state change.
- **`onLoanPrepayment` serial → parallel.** `for-await` on debt-payoff buckets → `Promise.all`. Typically 1-2 buckets but parallel-safe now.
- **Dynamic import → static** for `@/services/loan-accounts` in the home tab. Single-bundle RN doesn't benefit from dynamic splitting anyway. Paired with a new exported `LoansSummary` type so home no longer uses `Awaited<ReturnType<typeof import(...)>>`.

**Code safety:**

- `services/smart-rules.ts` — extracted `safeParseTagIds` helper used by both `materialize()` and the update path at line 352. Fixes a latent crash on rule edit when a DB row has malformed JSON.
- **15 empty `catch {}` blocks → `logger.warn`.** Across `services/expense-crud.ts` (7 sites: EMI match, bucket link, unfulfill reminder, bucket sync, rule stamp, recurring cleanup, loan-link cleanup, SMS matcher unlink, restore paths) + `services/loan-accounts.ts` (6 prepay/correction recompute sites) + `services/notification-scheduler.ts` (2 background-task sites). Any TypeError in a helper that used to silently drop now surfaces in dev logs.
- **2 raw `console.warn` → `logger.warn`** (`app/(tabs)/index.tsx`, `app/simulator/index.tsx`).
- **AES typing pin.** `services/backup.ts` now uses a named `AesAlgorithmGCM` type + `AES_256_GCM` constant with a boundary cast, with a comment pointing at the upstream typings drift. The two pre-existing TS errors on source files are now zero.

**Dead code:**

- Deleted `components/simulator/TrajectoryChart.tsx` (orphan since v16.0.4, no importers).
- Deleted `components/ui/DateRangeChips.tsx` (never imported).
- Removed barrel re-exports from `components/ui/index.ts`.
- Deleted `app/loans/index.tsx` (orphan duplicate of `/goals/loans.tsx`, only reached via deep-link). Repointed `notification-scheduler.ts` EMI deep-link from `/loans` → `/goals/loans`.

**Duplicate helpers:**

- `utils/date.ts` extended with `addDays(iso, days)` + `daysBetween(a, b)`. Local copies in simulator/loan-engine files left in place for now (drop-replacement is a mechanical pass scheduled for v17.5.3). `services/loan-engine.ts` migrated to the import — local `daysBetween` removed.

**Migrations:**

- **034** — `loan_accounts.round_mode` column with backfill (`'paise'` for non-INR, `'rupee'` default for INR).
- **035** — two hot-path indexes:
  - `idx_loan_prepay_loan_date` on `loan_prepayments(loan_account_id, prepayment_date)` matches `getPrepayments` ORDER BY + rebuild replay order.
  - `idx_expenses_fulfills_rule_live` partial index on `expenses(fulfills_rule_id) WHERE deleted_at IS NULL AND fulfills_rule_id IS NOT NULL` for v14.7.0 reminder-fulfillment suggestion queries.

Both registered in `database/migrations/index.ts`. `loan_accounts.round_mode` added to `database/TABLE_SCHEMAS.ts`. `__tests__/integration/database.test.ts` expectations updated: execAsync 54 → 57, inserts 33 → 35.

**Files touched:**

New:
- `database/migrations/034_loan_round_mode.ts`
- `database/migrations/035_loan_perf_indexes.ts`

Deleted:
- `components/simulator/TrajectoryChart.tsx`
- `components/ui/DateRangeChips.tsx`
- `app/loans/index.tsx`

Modified:
- `services/loan-engine.ts` — `RoundMode` type, `roundBy`, `applyPrepayment` trivial-path branch, import `daysBetween` from utils, drop local duplicate
- `services/loan-accounts.ts` — `round_mode` column handling in createLoan INSERT, `LoanAccount` interface extended, `loanToParams` passes through round_mode, new `listAllLoansWithBankName` + `getLoanOutstandingsByLoanId`, `getLoanOutstandingsByFA` rewritten to batch, `rebuildLoanSchedule` wrapped in transaction + dedup + chunked INSERTs, new `batchInsertScheduleEntries` helper, 6 empty catches → logger.warn, error-context wrapping on 6 write functions, `LoansSummary` type exported
- `services/expense-crud.ts` — 7 empty catches → logger.warn + stampApplication .catch → logger.warn
- `services/notification-scheduler.ts` — 2 empty catches → logger.warn, logger import, `/loans` deep-link → `/goals/loans`
- `services/backup.ts` — AES typing pin (`AES_256_GCM` constant + cast)
- `services/yearly-plan.ts` — `onLoanPrepayment` parallel
- `services/smart-rules.ts` — `safeParseTagIds` helper extracted
- `utils/date.ts` — `addDays` + `daysBetween` added
- `utils/yoy-comparison.ts` — `gapActualHigherIsBetter` field on `YoYCategory`, gap scorer honors it, Loans & Debts overrides
- `components/loans/PrepaymentSheet.tsx` — strategy toggle conditionally hidden for amount < EMI
- `app/loans/[id].tsx` — `useMemo` import + memoized derived values (totalInterest*, nextEMI, visibleSchedule)
- `app/goals/loans.tsx` — batched load using new service helpers
- `app/goals/yoy-comparison.tsx` — gap direction honors `gapActualHigherIsBetter`
- `app/(tabs)/index.tsx` — static loan-accounts import, logger replaces raw console.warn, typed loansSummary state
- `app/simulator/index.tsx` — logger replaces raw console.warn
- `components/ui/index.ts` — drop DateRangeChips re-exports
- `database/migrations/index.ts` — register 034 + 035
- `database/TABLE_SCHEMAS.ts` — `round_mode` on loan_accounts
- `__tests__/integration/database.test.ts` — migration 034 + 035 expectations
- `__tests__/unit/yoy-comparison.test.ts` — new "gap semantics invert" test
- `app.json` — 17.5.1 → 17.5.2, versionCode 170501 → 170502
- `app/loans/add.tsx` — 9 jargon label rewrites (Amount approved, Amount received, No charge after, Late fee rate, etc.)
- `app/loans/[id].tsx` — compact action strip redesign, new `ActionStripButton` helper
- `app/(tabs)/settings.tsx` — Categories icon `pricetags-outline` → `grid-outline`
- `app/settings/recycle-bin.tsx` — "Recurring" tab label → "Patterns", empty state title matching
- `components/charts/DonutChart.tsx`, `TrendBarChart.tsx`, `TrendLineChart.tsx` — wrapped in `React.memo`
- `services/home-card-preferences.ts` — dropped `advisor` + `reconcile` HomeCardId variants

**Additional items ALSO done this session:**
- Loan detail UI rework: single primary CTA (Record Prepayment) + compact icon strip for secondary actions (Foreclose / Correct / Edit / Delete). Replaces the 5 full-width buttons that dominated the page. New `ActionStripButton` helper.
- Plain-English loan form labels: "Principal Sanctioned" → "Amount approved", "Principal Disbursed" → "Amount received", "Foreclosure waiver after (months)" → "No charge after N months", "Foreclosure waiver min loan amount" → "No charge if loan ≥ amount", "Penal Charges (delayed payments)" → "Late-payment charges", "Penal rate % p.a." → "Late fee rate % per year", "Penal cap % p.a." → "Maximum late fee % per year". Copy clarifies late-payment is different from prepayment above.
- React.memo on all 3 chart components (DonutChart, TrendBarChart, TrendLineChart).
- Coming Soon stub removal: `advisor` + `reconcile` dropped from `HomeCardId` union + `HOME_CARDS` catalog. Orphan `/app/advisor` screen already gone.
- recycle-bin "Recurring" tab renamed to "Patterns" (and empty state title to "No Dismissed Patterns"). Categories icon collision fixed — Categories now uses `grid-outline`, Tags keeps `pricetags-outline`.
- Home Review Queue dedupe: "Explore & Tools" Review Queue card now hidden when the "Action Required" card is showing for the same items.

**Deferred to v17.5.3 / v17.6.0:**
- 12 analytics components React.memo pass (DrillGroupRow, YoYComparisonRow, InsightCard, ForecastBreakdown, etc.)
- Simulator list N+1 (needs new batch helpers)
- Home-preload wallet/savings batch (needs new `getMonthBalanceSummariesByIds` helper)
- Bulk ops (tag writes, review-queue bulk approve, data-cleanup loops, hardDeletePerson/Account, split-tender legs, invest-bucket copy) — need new batch service fns
- Expense + budget custom-header → Stack header migration (visual consistency, risky rewrite)
- account-ledger + hisaab/ledger ScrollView → FlatList (high-risk, own PR per CLAUDE.md v14.8.0)
- `noUnusedParameters` TS flip + `any`-type tightening in recycle-bin / use-back-override / home-cards
- Spending Pulse hardcoded hex colors → theme tokens
- Expenses tab useCallback dep churn
- Remaining local `todayIso` / `addDays` copies in simulator UI (3 sheet components)

**Testing:** 1330/1330 pass. TS clean on source files (AES noise resolved).

Version bump: **17.5.1 → 17.5.2** (PATCH — 2 user-reported bug fixes + correctness + perf + safety pass; no new feature surface).

### 17.5.1 session additions — loan polish: PDF removal, prepayment ergonomics, manual overrides, debt visibility

Bundled pass driven by user feedback after v17.5.0 landed. Ten coordinated fixes + one new capability, all on the loan management surface.

**1. PDF import for loans — fully removed.** The v17.4.0 PDF field extractor (with optional encryption / password prompt) didn't work reliably in practice. User decision: delete the feature rather than debug. Gone: `services/loan-pdf-parser.ts`, `services/pdf-decrypt.ts`, the "Import from PDF" button on Add Loan, the password Modal, all associated state + callbacks. Loans are now manual-entry only (same as before v17.4.0).

**2. "Late prepayment %" label rename — oxymoron removed.** The loan form had two prepayment-charge rate fields labeled "Early prepayment %" and "Late prepayment %" with a threshold controlling which rate applies. User correctly called out that "late prepayment" reads nonsensical — there's no such thing as a late prepayment. The fields describe the *standard* charge rate and an *optional reduced rate when the loan is near its end*. Renamed: "Standard prepayment charge %" + "Reduced rate % (near end of tenure)" + clearer threshold label. Copy also clarifies this has nothing to do with penal charges (see Penal Charges card below).

**3. Prepayment date picker — CalendarModal instead of raw text.** `components/loans/PrepaymentSheet.tsx` had a `Input label="Prepayment Date (YYYY-MM-DD)"` raw text field. Replaced with tappable row + CalendarModal, matching the pattern used everywhere else in the app (expense add, loan form disbursement/EMI dates). `minimumDate` seeded from the loan's disbursement date so users can't pick an impossibly-early date.

**4. Edit/delete prepayments — inline actions on loan detail.** v17.1.0 built record-only prepayments — no way to correct a mistake. The Prepayments card now makes each row tappable (opens edit sheet) with a trash icon for delete. New service functions `updatePrepayment` + `deletePrepayment` both rebuild the schedule from scratch by replaying remaining prepayments in date order (an incremental in-place update can't express schedule changes correctly when edits affect other prepayments' remaining-EMI context). Deleting a foreclosure reopens the loan (`status = 'active'`, `closed_date = NULL`).

**5. Schedule rebuild refactor — single path through `rebuildLoanSchedule`.** `recordPrepayment` previously did incremental tail-replacement (keep paid entries, replace the tail from prepayment date forward). Switched to full rebuild so new prepayments AND existing manual corrections (see #6) coexist cleanly. Slight cost: rebuild is O(N) instead of O(tail), but N is typically ≤120 installments for a 10-year loan. Well under 100ms.

**6. Manual corrections — user-entered overrides for outstanding / EMI / tenure (NEW).** When the bank's actual numbers diverge from Artha's formula (rate resets, interest-day convention, lender-specific rounding), the user can now apply a "Manual Correction" at any date. Migration **033** adds `loan_corrections` (effective_date, outstanding_principal, emi_amount, tenure_remaining_months nullable, reason). New sheet `components/loans/ManualCorrectionSheet.tsx` with computed-value previews showing what Artha currently computed versus what the user is overriding to. The schedule regenerates from the correction forward: installments on/before the correction are preserved, the tail regenerates using the corrected baseline + loan's current interest rate. Prepayments recorded after a correction apply on top of the corrected baseline. Corrections are editable + deletable (each rebuilds schedule). Corrections list renders as a dedicated card above Amortization Schedule; tap to edit, trash to delete. Full downstream handling: `onLoanPrepayment` fires so any debt-payoff bucket recalculates against the corrected outstanding.

**7. Yearly Plan — Debt Servicing now folded into Total Outflow.** User feedback: "Debt servicing not included as part of outflow in the plan summary." The per-loan "Debt servicing this year" grand total already existed as a sub-card, but the main "Plan Summary" card's Total Outflow + Surplus row ignored it entirely — users reading the Plan Summary saw a rosier surplus than reality. Now when INR loans exist, a "Debt Servicing" row appears between Investments and Total Outflow (sublabel: "EMIs + planned prepayments"), and both Total Outflow + Surplus/Deficit + Achievability banner compute from the debt-adjusted surplus.

**8. YoY Comparison — Loans & Debts as a 6th category.** `utils/yoy-comparison.ts` gained `totalPlannedLoanOutflow` + `totalActualLoanOutflow` inputs and the comparison now produces 6 categories (was 5): Income, Expenses, Investments, Milestones, **Loans & Debts**, Savings Rate. Planned = scheduled EMIs in the FY window + expected prepayments. Actual = paid-status EMIs + recorded prepayments. INR-only to keep one currency on the chart. Test suite updated (9/9 green, new loans-test added).

**9. Database cleanup + schema bookkeeping.** Migration 033 registered in `database/migrations/index.ts`; `loan_corrections` added to `TABLE_SCHEMAS` (for backup restore whitelist) + `BACKUP_TABLES` (after `loan_accounts` per FK dependency). Integration test counts bumped: `execAsync` 53→54, inserts 32→33, already-applied arrays +1.

**10. Prepayment Sheet — edit-mode preview dedup.** When editing an existing prepayment, the impact preview now excludes the row being edited from the "other prepayments" context so it doesn't double-count itself. Subtle but matters for accuracy.

**Files touched:**

New:
- `database/migrations/033_loan_corrections.ts`
- `components/loans/ManualCorrectionSheet.tsx`

Deleted:
- `services/loan-pdf-parser.ts`
- `services/pdf-decrypt.ts`

Modified:
- `app/loans/add.tsx` — strip PDF imports + state + handlers + "Import from PDF" button + password Modal; rename "Late prepayment %" labels
- `app/loans/[id].tsx` — prepayment tap-to-edit + trash-to-delete, Manual Correction button + corrections list card + sheet mount, editing state, editing-correction state
- `components/loans/PrepaymentSheet.tsx` — edit-mode support (`editing` prop), CalendarModal date picker, preview excludes row being edited
- `services/loan-accounts.ts` — `LoanCorrectionRow` type, `getCorrections` / `createCorrection` / `updateCorrection` / `deleteCorrection`, `updatePrepayment` / `deletePrepayment`, refactored `rebuildLoanSchedule` with correction-aware replay, `applyCorrection` helper, `addMonthsFromStart` helper
- `database/migrations/index.ts` — register migration 033
- `database/TABLE_SCHEMAS.ts` — add `loan_corrections` whitelist
- `services/backup.ts` — add `loan_corrections` to `BACKUP_TABLES`
- `app/goals/yearly-plan.tsx` — Debt Servicing row in Plan Summary + debt-adjusted Total Outflow + Surplus + Achievability
- `app/goals/yoy-comparison.tsx` — loan data fetch + FY-window EMI/prepayment math, Loans & Debts category icon
- `utils/yoy-comparison.ts` — FYData extended, Loans & Debts category added before Savings Rate
- `__tests__/unit/yoy-comparison.test.ts` — fixture data updated, new test "loans & debts category tracks planned vs actual", category count 5→6
- `__tests__/integration/database.test.ts` — migration 033 expectations (execAsync 53→54, inserts 32→33)
- `app.json` — 17.5.0 → 17.5.1, versionCode 170500 → 170501

**Testing:** 1329/1329 pass. TS clean on source files (only pre-existing `services/backup.ts` AES noise).

Version bump: **17.5.0 → 17.5.1** (PATCH — 9 bug fixes + UX polish + 1 additive capability (Manual Corrections) that extends the existing loan management feature without opening new top-level surface).

### 16.0.8 session additions — export collision fix, save-to-phone, button polish, help-center grouping

Four user-reported issues bundled.

**1. `FileAlreadyExistsException` on back-to-back exports.**

Both PDF and Excel export services used a date-only timestamp (`YYYY-MM-DD`) in the filename. A second export on the same day hit `File.move()` / `file.write()` with a path that already existed, throwing `FileAlreadyExistsException`.

Fix in `services/hisaab-export-pdf.ts` + `services/hisaab-export-excel.ts`:
- Second-level timestamp (`YYYY-MM-DDTHH-MM-SS`) matches the backup file pattern.
- Defensive: `if (dest.exists) dest.delete()` before the write/move so even a clock-skew collision doesn't crash.

**2. Save-to-phone now available for hisaab exports (PDF + Excel).**

Previously only Backup & Restore had the Android SAF "Save to Phone" option; exports dumped the file to cache and only offered the Share sheet. Now extracted a shared `services/save-to-phone.ts` helper that:
- Wraps `StorageAccessFramework.requestDirectoryPermissionsAsync` (seeded to Downloads).
- Reads source file as base64 or utf8 depending on caller (exports = base64 binary, backup = utf8 text).
- Optionally deletes the cache copy on success.

`services/backup.ts:saveBackupToStorage` now delegates to the shared helper (old inline implementation gone).

`components/hisaab/ExportFormatPicker.tsx` wired up with a 3-way post-export alert on Android: **Later · Save to phone · Share…**. iOS falls through directly to the Share sheet (no SAF equivalent).

**3. Backup-result buttons were inconsistent width + truncating.**

The success screen put "Save to Phone", "Share...", "Done" in a `flex-row flex-wrap` — varying label lengths + wrapping made them look mismatched and truncated on narrow screens. Switched to a vertical stack in `app/settings/backup-restore.tsx` (`gap-2`, each button gets full width). Labels shortened to "Save to phone" / "Share" / "Done" — the title case matches the casual tone of the rest of the app and keeps Android alert-button labels under the truncation threshold.

**4. Help center "Getting started" buried in alphabetical sort.**

Flat A→Z sort of 28 articles put "Getting started" in the middle. User asked for a more meaningful, journey-based ordering instead. New `listArticleGroups()` API in `services/docs/index.ts` returns ordered domain groups:

| Group | Articles |
|-------|----------|
| **Start here** | getting-started |
| **Track day-to-day** | accounts, categories, tags, reconciliation, refunds, hisaab, review-queue |
| **Plan & remind** | budget, simulator, reminders, goals-milestones |
| **Let Artha do the work** | sms-detection, smart-sms-templates, smart-rules, merchant-aliases, duplicate-detection |
| **Understand your money** | insights, projection-block, projection-math, min-balance-alert |
| **Personalize** | preferences-region, fiscal-year |
| **Protect your data** | biometric-lock, privacy-offline, backup-restore, recycle-bin, audit-log, excel-import |

Anything not explicitly listed falls into a "More" group at the end (alphabetical there). Help home screen now renders these as section headers with their articles in author-ordered sequence (not alphabetical inside the group either — pedagogical order beats alphabetical when the user is browsing rather than searching).

`listAllArticles()` kept as a thin wrapper flattening the groups — used by the context-filter logic and any other consumer.

Contextual articles ("Related to where you were") still surface first when opened via a `?context=` deep link; group sections hide any article already shown there to avoid duplication.

**Test update:** `__tests__/unit/docs-search.test.ts` — the `listAllArticles() sorted by title` assertion dropped. Replaced with a `first article is getting-started` assertion that expresses the new contract.

**Files touched:**
- `services/save-to-phone.ts` (new)
- `services/backup.ts` — delegates to shared helper
- `services/hisaab-export-pdf.ts` — second-level timestamp + pre-delete
- `services/hisaab-export-excel.ts` — same
- `components/hisaab/ExportFormatPicker.tsx` — 3-way post-export alert on Android
- `app/settings/backup-restore.tsx` — vertical stacked buttons + shorter labels
- `services/docs/index.ts` — `listArticleGroups` + reordered `listAllArticles`
- `app/settings/help/index.tsx` — group-by-group rendering
- `__tests__/unit/docs-search.test.ts` — updated assertion
- `app.json` — 16.0.7 → 16.0.8, versionCode 160007 → 160008

**Tests:** 1288/1288 pass. TS clean on source files.

Version bump: **16.0.7 → 16.0.8** (PATCH — bug fixes + additive save-to-phone + UX polish, no new feature surface).



### 16.0.7 session additions — sheet bottom-gap, source-dot cleanup, merchant autocomplete

Three small UX fixes on the simulator sheets + planned-entry row.

**1. Dead strip under action row on bottom sheets.**

Four sheets had a fixed `pb-8` (32px) on their outer container, which created a visible gap between "Save entry" / "Save" / "Save reminder" buttons and the bottom of the screen. Set Reminder and Record Refund (the user's reference) sit flush because they use dynamic safe-area insets. Switched every sheet to `paddingBottom: Math.max(insets.bottom, 8)` via `useSafeAreaInsets` — that clears the gesture bar / home indicator precisely without the dead strip above it.

Fixed:
- `components/simulator/EntryEditSheet.tsx`
- `components/simulator/HisaabInclusionSheet.tsx`
- `components/expense/RecurringRuleSheet.tsx`
- `app/simulator/index.tsx:NewScenarioSheet`

**2. Grey source-dot above direction arrow removed for manual entries.**

v16.0.5 added a tiny colored dot above each direction-arrow avatar to mark entries auto-seeded from reminders (accent dot) or CC forecasts (warning dot). The fall-through case — user-added manual entries — used `colors.textSecondary` which rendered as a grey dot, which carried no information. Now: the dot only appears when the source is `seeded_reminder` or `seeded_forecast`. Manual entries just show the direction avatar cleanly.

**3. Merchant field autocomplete from aliases + past entries.**

EntryEditSheet's Merchant input was a plain text field — users couldn't pick from the merchants they'd already taught the app via `merchant_aliases` or the ones that had appeared on real expenses. Added a dropdown under the field (visible only while focused) showing up to 6 suggestions, pulled via the existing `services/merchant-alias.ts:getDistinctMerchantNames` helper that unions canonical alias names + distinct non-credit expense merchants.

Filtering: empty query → top 6 sorted; typed query → prefix matches first, then substring matches, exact matches filtered out (already typed). Tap a suggestion to fill the field.

**Files touched:**
- `components/simulator/EntryEditSheet.tsx` — safe-area padding, merchant dropdown, focus/blur state
- `components/simulator/HisaabInclusionSheet.tsx` — safe-area padding
- `components/expense/RecurringRuleSheet.tsx` — safe-area padding
- `app/simulator/index.tsx` — safe-area padding on NewScenarioSheet
- `app/simulator/[id].tsx` — source dot conditional render for manual entries
- `app.json` — 16.0.6 → 16.0.7, versionCode 160006 → 160007

**Tests:** 1288/1288 pass. TS clean on source files.

Version bump: **16.0.6 → 16.0.7** (PATCH — scoped UX polish, no new feature surface).



### 16.0.6 session additions — hisaab settlement sync + keyboard handling

Two user-surfaced bugs, both in the "edit something and downstream doesn't follow" family.

#### Bug 1 — settlement-linked credit edit didn't refresh hisaab ledger

User report:

> "there was a credit marked as settlement and I selected manoj then I edited the date, the same did not reflect in the hisaab ledger, when I unlinked and relinked then it did, I also did edit and clicked view ledger and went to ledger manually, still no update"

Root cause: `updateCredit` + `updateExpense` only touched the `expenses` row. The linked `hisaab_entries` row (which carries its own `amount` + `date` columns) was left stale. Same pattern for split expenses — editing the date on a split expense without changing the amount took the "lightweight" path, which skipped the split-rebuild and left the hisaab row's date old.

Fix — new `syncSettlementLinkedHisaabEntry(expenseOrCreditId, { amount?, date? })` helper in `services/account-credit.ts`:

- **Date** — mirrors onto EVERY linked hisaab row (`linked_expense_id = ?`). Settlement, split debit, split credit — all get the new date.
- **Amount** — only mirrors onto `type='settlement'` rows. Those are 1:1 with the credit. Split rows have per-leg amounts managed by the existing rebuild path when the total changes, and we deliberately leave those alone so the helper doesn't fight the rebuild.
- Safe no-op when no linked row exists.

Wired into both code paths:
- `services/account-credit.ts:updateCredit` — the account-ledger inline edit form.
- `services/expense-crud.ts:updateExpense` — the expense-detail screen (imports the helper statically; dynamic `await import()` doesn't work in Jest's VM without `--experimental-vm-modules`).

Gated on amount or date actually changing so we don't churn hisaab rows on cosmetic edits.

**Scope of this fix (checked other downstream links):**
- **Mark-as-Transfer** — N/A. Source expense is soft-deleted at reclassify time; nothing to sync. Subsequent transfer edits go through `updateTransfer` which already guards demat transfers and updates its own row directly.
- **Refund links** — not affected today (refund amount/date is independent of source expense).
- **CC repayment forecast match** — no sync needed; forecast represents expected amount, user re-matches if real differs.
- **Reminder fulfillments** — already handled in `updateExpense` (auto-unfulfills on amount/date change). No regression.
- **Simulator fulfillments** — out of scope per user ("simulator is not involved").
- **Split hisaab amounts** — handled by existing rebuild path when total changes. Our helper only syncs date on the "no amount change" lightweight path.

**Files touched (bug 1):**
- `services/account-credit.ts` — `updateCredit` calls sync; new exported helper.
- `services/expense-crud.ts` — static import + sync call at end of `updateExpense`.

#### Bug 2 — keyboard covers form fields in modals / sheets

User reported three spots:
1. New Scenario sheet's Name field (Android).
2. EntryEditSheet's Merchant + Description fields (bottom of the scroll list).
3. PatternEditSheet (had no keyboard handling at all).

Root cause: several sheets used `KeyboardAvoidingView` with `behavior={Platform.OS === "ios" ? "padding" : undefined}`. Android got no handling at all. Where `behavior` was set correctly, inputs near the bottom of a ScrollView still didn't auto-scroll into view on focus.

Fixes:
- **`app/simulator/index.tsx:NewScenarioSheet`** — `behavior="height"` on Android; added `maxHeight: "92%"` cap; wrapped form body in a ScrollView with `keyboardShouldPersistTaps="handled"` so long content can scroll when the keyboard is up. Action row moved outside the ScrollView so Cancel/Create stay pinned.
- **`components/expense/RecurringRuleSheet.tsx`** — same `undefined` → `"height"` fix + `keyboardVerticalOffset={0}`.
- **`components/analytics/PatternEditSheet.tsx`** — wrapped the sheet body in a new `KeyboardAvoidingView` + `maxHeight: "92%"` cap.
- **`components/simulator/EntryEditSheet.tsx`** — added a `scrollRef` + `scrollToBottom` helper; Merchant and Description `TextInput`s fire `onFocus={scrollToBottom}` so the focused field scrolls above the keyboard on Android. The sheet's own keyboard-handling attributes were correct; this is a scroll-positioning layer on top.

Not touched (deliberate): `SplitSheet.tsx` + `MultiSplitSheet.tsx` use `behavior="padding"` which works on both platforms. `TagPicker.tsx` uses a FlatList search input that auto-handles via system window resize. No reports against these.

**Files touched (bug 2):**
- `app/simulator/index.tsx` — NewScenarioSheet keyboard + scroll rewrite.
- `components/simulator/EntryEditSheet.tsx` — scrollRef + scroll-to-bottom on focus.
- `components/expense/RecurringRuleSheet.tsx` — Android keyboard behavior fix.
- `components/analytics/PatternEditSheet.tsx` — KeyboardAvoidingView + maxHeight.

**Overall:**
- `app.json` — 16.0.5 → 16.0.6, versionCode 160005 → 160006.
- `CLAUDE.md` — this section.

**Tests:** 1288/1288 pass. TS clean on source files (only pre-existing `backup.ts` AES noise). No new tests — both fixes are UI-side without a unit-testable seam; existing `updateCredit` / `updateExpense` coverage still exercises bug 1, and the helper is a pass-through when no settlement link exists.

Version bump: **16.0.5 → 16.0.6** (PATCH — two scoped bug fixes, no new feature surface).

### 16.0.5 session additions — Simulator hisaab integration + UI polish + matcher tightening

Bundled release: UI polish, hisaab integration (two-part: inclusions + planned entries), exact-amount fulfillment matcher, and a batch of bug fixes.

**Hisaab integration — two separate capabilities:**

1. **Per-scenario hisaab inclusion** (migration 026). User opens the Starting balance drawer → taps "Include hisaab balances" → `HisaabInclusionSheet` lists every active hisaab person with non-zero balance. For each person: toggle on/off, enter a **percentage** (0–100 %) OR a **rupee amount** (capped at their current balance). The two inputs are linked; typing in either updates the other. Positive-balance persons (they owe you) add to Money available; negative-balance (you owe them) add to Money owed. Stored in the new `simulation_hisaab_inclusions` table (composite PK `scenario_id + person_id`, `ON DELETE CASCADE`). Amount is always positive; `amount_sign` captures direction at write time so a later flip on the underlying hisaab ledger doesn't silently reclassify the inclusion.

2. **Collect / Pay-back planned entries**. Two new flavors on the Add/Edit entry sheet: "Collect from hisaab" and "Pay back to hisaab". Requires picking a hisaab person (search picker with balance sublabels). Direction is derived (collect = in, payback = out). Persisted via two new columns on `simulation_entries`: `hisaab_person_id` + `hisaab_kind`. Planned-entry row shows the sublabel "Collect from Manoj" / "Pay back to Raj" in accent color, overriding any account label.

Scenario overview returns `hisaabIncluded: SimulationHisaabInclusion[]` which the UI folds into the adjusted starting/projected balances on both the detail screen AND the scenario list card previews. Inclusion net is constant across the window (not a cash-flow event), so it lifts start AND end equally, keeping delta honest.

**UI polish (full rework of v16.0.4 hero + list):**

- **Projected balance** promoted to `text-3xl` hero on top of the card. Supporting copy "Starts at ₹X today, after N planned entries" below the hero.
- **Starting balance drawer** now handles:
  - Overpaid credit cards (negative utilized → "bank owes you") → moved to Money available with absolute-value rendering. Previously these showed on Money owed with a confusing double-negative prefix.
  - Hisaab inclusion rows appear in their respective sides with "Hisaab · they owe you" / "Hisaab · you owe" sublabels.
  - Include-hisaab launcher row inside the drawer.
- **By Account** breakdown now mirrors the Money available / Money owed grouping for consistency.
- **Warnings strip** promoted to a sibling of the hero card with sentence-form messages ("HDFC CC crosses credit limit on 18 May").
- **Key Moments** card — icon + name + date pill + big amount.
- **Planned entries segregated by direction** (v16.0.5 user feedback): Outgoing and Incoming are now two separate sections, each with their own total pill and internal Today/Tomorrow/This week/Later sub-grouping. Previously they were interleaved under one "Planned entries" header.
- **Direction-aware labels everywhere**: default entry title for empty-merchant rows is "Outgoing" / "Incoming" (was "Expense" / "Incoming"); onboarding copy says "outgoings and incomings"; StaleEntryResolveSheet matches.
- **Entry source as a dot**: compact colored dot above the direction arrow (accent for seeded reminder, warning for CC forecast, grey for manual) instead of a text tag.
- **EntryEditSheet** redesigned with a 2×2 flavor chip grid (Outgoing / Incoming / Collect / Pay back). Category + merchant fields hidden for hisaab flavors (the person IS the merchant). Copy adapts to flavor.
- **Scenario list cards** (v16.0.4 refinement): previews now correctly reflect hisaab inclusions.
- **FAB hide predicate** extended to include `hisaabSheetVisible` — no more "+" icon bleeding through the Include-hisaab sheet on Android.

**Fulfillment matcher tightened (user-requested):**

- **Amount tolerance is now EXACT to the paise** (1 paise epsilon for SQLite REAL float noise). Previously ±5% which caused false positives — a ₹997 real expense matching a ₹1,000 planned entry, etc. Opt-in percentage tolerance retained in the API signature (`{ amountPct: 0.05 }`) but never invoked from production code. Date tolerance still ±3 days.
- Test suite updated: the two "matches within 5% tolerance" tests are now "rejects any non-exact amount by default" + a "paise epsilon" + opt-in-percentage tolerance tests.

**Is-default guards dropped:**

- v16.0.0 auto-created a default scenario that couldn't be archived/deleted. v16.0.4 stopped auto-creating new ones but legacy defaults remained stuck. v16.0.5 drops the `is_default` guard from `archiveScenario` + `deleteScenario` + retention passes 2 & 3 + the detail screen menu + the list card actions. Legacy default scenarios are now removable like any other.

**Bug fixes:**

- `duplicateScenario` was silently dropping the `hisaab_person_id` / `hisaab_kind` columns on copied entries + had no clause to carry hisaab inclusions over. Fixed — full clone.
- Scenario list card previews didn't include `hisaabNet`, so the list and detail showed different projected numbers. Fixed.
- `listHisaabInclusionCandidates` had the wrong SQL: used `hp.user_id` (column is `owner_user_id`) and a bogus settlement-sign branch. Rewritten to exactly mirror `hisaab.ts:getPersonsWithBalances` — initial_balance + debits − (credits + settlements), filtering soft-deleted linked expenses.
- CC double-negation when rendering "Money owed" (v16.0.4 bug regressed from the new drawer rework).

**Hisaab ledger — opening / closing balance on filter (v16.0.5):**

User feedback: "When I apply filter in hisaab ledger, I should see total based on the date range for which filter is applied and the balance — considering the ending balance like how we have for account ledger. And have this concept of opening and closing balance."

When a date filter is active in `app/hisaab/ledger.tsx`, a new bank-statement-style summary card appears just above the entries list:

- **Opening balance** — the running balance as of filter `From` date (exclusive, using existing `getBalanceAsOfDate`).
- **Activity in range** — lines for "They owed (debits)" / "They paid (credits)" / "Settlements", only shown when > 0.
- **Net change in range** — closing − opening, colored by direction.
- **Closing balance** — opening + debits − (credits + settlements) in range. Bold, accent-colored.
- **Interpretation footer** — "They owe you as of filter end" / "You owe them as of filter end" / "All settled as of filter end".

Semantics match the account ledger (`reconciliation/account-ledger.tsx`) — opening is the balance BEFORE the first day's entries; closing rolls activity forward from there. No change to the hero balance card at the top (that remains the current person balance regardless of filter).

**Schema (migration 026):**

```sql
CREATE TABLE simulation_hisaab_inclusions (
  scenario_id   TEXT NOT NULL REFERENCES simulation_scenarios(id) ON DELETE CASCADE,
  person_id     TEXT NOT NULL,
  included      INTEGER NOT NULL DEFAULT 1,
  amount        REAL NOT NULL,
  amount_sign   TEXT NOT NULL CHECK (amount_sign IN ('positive','negative')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (scenario_id, person_id)
);
CREATE INDEX idx_sim_hisaab_inclusions_person ON simulation_hisaab_inclusions(person_id);

ALTER TABLE simulation_entries ADD COLUMN hisaab_person_id TEXT;
ALTER TABLE simulation_entries ADD COLUMN hisaab_kind TEXT;
```

Idempotent (CREATE IF NOT EXISTS + PRAGMA check before ALTER). Both tables added to `TABLE_SCHEMAS` + `BACKUP_TABLES` (`simulation_hisaab_inclusions`) — scenarios round-trip cleanly via backup.

**Help docs:** `assets/docs/articles/simulator.md` rewritten for v16.0.5 — four entry kinds, hisaab inclusion sheet, exact-amount matcher, planned-entry segregation, v16.0.5 retention rules. 28 articles total.

**Files touched:**

New:
- `database/migrations/026_simulator_hisaab.ts`
- `components/simulator/HisaabInclusionSheet.tsx`

Modified:
- `database/migrations/index.ts`, `database/TABLE_SCHEMAS.ts`
- `services/simulator.ts` (hisaab types + CRUD + `listHisaabInclusionCandidates` + `listHisaabInclusions` + `upsertHisaabInclusion` + `removeHisaabInclusion` + overview extension + `duplicateScenario` carry-over + `is_default` guard drops)
- `services/simulator-engine.ts` (exact-amount matcher)
- `services/backup.ts` (BACKUP_TABLES)
- `app/simulator/[id].tsx` (hero redesign, drawer rewrite with hisaab, By-Account grouping, warning strip, Key Moments simplification, planned-entry segregation, person-name loader, hisaab sheet mount, FAB predicate, label normalization)
- `app/simulator/index.tsx` (hisaabNet in preview numbers, copy update to "outgoings and incomings")
- `app/hisaab/ledger.tsx` (opening/closing balance summary card on active filter)
- `components/simulator/EntryEditSheet.tsx` (4-flavor grid, person picker, conditional field hide, hisaab payload threading, adaptive copy)
- `components/simulator/StaleEntryResolveSheet.tsx` (label normalization)
- `__tests__/integration/database.test.ts` (execAsync count 36 → 39, inserts 25 → 26, v26 added to skip arrays)
- `__tests__/integration/simulator.test.ts` (archive/delete no longer guarded, retention passes unguarded)
- `__tests__/unit/simulator-engine.test.ts` (exact-amount + opt-in pct tests replace ±5%)
- `assets/docs/articles/simulator.md` (v16.0.5 rewrite)
- `assets/docs/index.json` (28 articles)
- `app.json` 16.0.4 → 16.0.5, versionCode 160004 → 160005

**Tests:** **1288/1288 pass**. TS clean on source files (only pre-existing `services/backup.ts` AES noise).

Version bump: **16.0.4 → 16.0.5** (PATCH — UI polish + scoped bug fixes + one additive capability that extends existing simulator without new top-level feature surface).

### 16.0.4 session additions — Simulator baseline + overview polish

Post-v16.0.3 round on the simulator driven by user feedback on how balances show up on the scenario detail.

**Baseline changes (`services/simulator.ts`):**

- **Loans removed from baseline.** User doesn't want EMI/loan principal shaping the starting balance; the simulator is about day-to-day cash flow. Now bank + wallet + credit_card only.
- **New `getComputedBalancesAsOfToday(ids)`** replaces the shared `getComputedBalances` inside the simulator baseline path. The shared helper returns the current-month CLOSING balance — which counts future-dated real entries within the current month against the starting point. The new helper stops at today so the simulator's "starting balance" matches what the user sees on Home.
- Unused `getComputedBalances` import dropped.

**Overview card rebuilt (`app/simulator/[id].tsx`):**

- **Starting balance drawer** — collapsible, closed by default. When opened, two semantic sub-sections:
  - **Money available** — savings + wallet balances (green pill, "I have" side).
  - **Money owed · Credit cards** — CC utilized shown as a negative (red pill, "I owe" side).
  - **Net starting balance** row at the bottom reconciles to the simulator's `netWorthStart`.
  - User feedback: "savings account balance would mean money I have left and credit card would be money I owe" — the mixed list was conflating those two notions.
- **Projected balance** remains the main number but with clearer supporting copy: "After N planned entries roll through" instead of the earlier scope line.
- **"Starts at ₹X today · …" helper line** removed from under the projected number — duplicated by the new drawer.

**No auto-created default scenario (`app/simulator/index.tsx`):**

- User feedback: "there's a scenario always added by default, why? it is strictly optional." v16.0.0 auto-created a "This month" default on first open of the simulator home. Now the simulator only shows what the user explicitly created — the list's empty state invites the user to tap **+ New scenario**. `getOrCreateDefaultScenario` is no longer called from the list screen.

**Visible delete button on every planned entry:**

- Long-press (Duplicate / Remove) was discoverable only by accident. Added a small trash icon on each entry row inside the group list — one-tap → confirm → delete. Long-press kept for the richer Duplicate / Remove sheet.

**Trajectory chart removed (`app/simulator/[id].tsx`):**

- User feedback: "not readable and has no value". Stripped the collapsible per-account line-chart section and the `TrajectoryChart` import entirely.
- Replaced with a **Key moments** card that lists, per affected account, the single most-important date:
  - Non-CC accounts → the day the balance hits its LOWEST in the horizon ("Lowest on 22 May · ₹8,230").
  - CC accounts → the day the balance hits its HIGHEST utilized ("Fullest on 18 May · −₹42,500").
  - Accounts whose extreme is within ₹0.50 of today are hidden (avoids noise like "lowest: today").
  - Visible only when at least one account actually sees movement in the scenario.

**Files touched (code):**

- `services/simulator.ts` — loans removed from baseline, `getComputedBalancesAsOfToday` added, import cleanup
- `app/simulator/[id].tsx` — `expandStarting` state, split-drawer starting-balance UI, projected-balance subtitle copy, Key Moments replacement for trajectory chart, removed trajectory state + TrajectoryChart import

**Unused:** `components/simulator/TrajectoryChart.tsx` remains in the codebase unreferenced. Not deleted in this patch — the chart primitives may be reused in a future "compare scenarios" screen.

**Tests:** 1286/1286 pass. No new tests; changes are in UI composition + presentational DB helper.

Version bump: **16.0.3 → 16.0.4**. `versionCode` 160003 → 160004.

### 16.0.3 session additions — Cash-flow Simulator bug sweep + UX rework

Post-release audit on the simulator. User hit multiple bugs + surfaced several UX gaps after v16.0.0 landed. Everything batched into a PATCH release since it's bug fixes + UX polish, no new features.

**Name**: "What-if simulator" → **"Cash-flow Simulator"** (user preference — more descriptive, matches the mental model).

**Bug fixes** (from audit + user reports):

- **[CRITICAL] Hooks-order violation in `StaleEntryResolveSheet`** — `useAnimatedStyle` was called AFTER an early `return null`. Every tap on a stale entry was crashing the detail screen with "Rendered more hooks than during the previous render". Moved the hook above the guard.
- **[HIGH] Fulfillment matcher rejected NULL-account candidates** — SMS-detected orphan expenses / refunds often have `account_id IS NULL`; the matcher skipped them entirely when the planned entry had an account. Now matches with a small tie-break penalty so an exact-account match still wins.
- **[HIGH] Auto-reseed triggered after user deleted every entry** — list screen checked `upcoming + fulfilled + stale == 0` to decide if it should re-seed reminders. Missed the `dismissed` bucket + hard-deletes, so a user who wiped their scenario got reminders re-seeded on every open. Now `getOrCreateDefaultScenario` returns `{ scenario, justSeeded }` — reseeding only happens on first-create or horizon roll-forward.
- **[HIGH] Timezone drift near local midnight** — `new Date("YYYY-MM-DD").toISOString()` parses as UTC; in IST that's off by a day late-night. Standardized `todayIso`, `endOfMonthIso`, `addDays`, `daysBetween` across service + engine + sheets to use local-wall-clock date math (same pattern as the rest of Artha).
- **[HIGH] `data-cleanup.cleanupData` didn't purge simulator tables** — "Wipe all" left scenarios + entries behind. Added `simulator` to `CleanupObjectType`, preview count, and cleanup DELETE pass.
- **[HIGH] Warnings fired for baseline state, not simulation-caused breach** — user saw "OVERDRAFT" pills on accounts that were already negative before any planned entry. `checkWarnings` now compares current state to baseline and only fires when the SIMULATION pushed the account across the threshold.
- **[MED] Default scenario race / duplicate cleanup** — v16.0.0 shipped without a uniqueness guard; two "This month" scenarios could coexist. `getOrCreateDefaultScenario` now fetches ALL defaults, keeps the oldest, demotes the rest to `is_default=0` (they become regular scenarios the user can review + delete).
- **[MED] N×reconcile on scenario list** — list pre-computed every scenario's overview to show warning pills; each overview ran the expensive `reconcileStaleEntries` scan. New `{ skipReconcile: true }` option on `getScenarioOverview`; list uses it. Detail screen still reconciles on mount.
- **[MED] `updateEntry` did NOT reset status on date/amount edit** — if the user edited a stale entry's date forward, it stayed `stale` and the engine ignored it. `updateEntry` now flips back to `upcoming` when date or amount changes (mirrors `rescheduleEntry`).
- **[MED] Transfer fulfilled two entries via duplicate candidates** — transfers were added to the candidate list once per account side (from + to). Reconcile now tracks claimed ids; a real transaction can only fulfill one simulator entry.
- **[MED] Retention pass-3 ignored archive window** — `DELETE` was gated only on `horizon_date < now-180d`. Now also requires `archived_at IS NOT NULL AND archived_at < now-90d`, so the 90-day "you can still view it" window the UI advertises is honoured.
- **[LOW] `navigation.setOptions({ title })` dep narrowed** — re-fired on every overview change; now keyed on `scenario.name` only.
- **[LOW] Duplicate entry unreachable from UI** — long-press was wired to a single "Remove" alert. Now offers Cancel / Duplicate / Remove options.
- **[LOW] `purgeRetention` bumped data version unconditionally** — cascaded `useDataRefresh` to every listener on every simulator open. Now gated on `changes > 0`.

**UX reworks**:

- **Baseline scope narrowed** — simulator baseline now excludes **demat** + **pension** (investment assets with no entry-driven flow) and **hisaab** (not an account). Only bank / credit_card / wallet / loan / savings. Net-worth projection no longer falsely includes market assets.
- **Overview card redesigned** — "Projected net worth" label → "Projected balance · [horizon date]" + a per-account breakdown showing `current → projected` for every affected account. User feedback: "it's not projected net worth, it's projected balance, and there should be a breakdown of current balance being seen."
- **Trajectory chart moved above the planned entries list** — user shouldn't have to scroll past dozens of entries to see the trend chart. Also now expanded-by-default when any account is affected.
- **Account picker rebuilt as modal searchable list** — was an inline expander that pushed the layout and could hide fields under the keyboard. New full-height searchable modal titled "Account balances" shows each account's current balance (or CC utilized) beside the name so the user knows what they're drawing from.
- **EntryEditSheet keyboard handling hardened** — `KeyboardAvoidingView` with Android `height` fallback + `keyboardShouldPersistTaps="handled"` + `maxHeight: 92%`. Notes + Description fields no longer hidden on Android.
- **New scenario sheet: copy-from-existing** — when creating a scenario, user can pick an existing one as the source; planned entries are duplicated into the new scenario. Chip row of existing active scenarios + "Start fresh" option.

**Files touched (code):**

- `components/simulator/StaleEntryResolveSheet.tsx` — hooks-order + local-date helpers
- `components/simulator/EntryEditSheet.tsx` — modal searchable pickers for account + category, account-balance sublabels, local-date helper, keyboard-aware layout
- `services/simulator-engine.ts` — fulfillment matcher NULL-account fix, checkWarnings baseline-comparison, local-date `daysBetween`, 3-tuple score
- `services/simulator.ts` — `getOrCreateDefaultScenario` returns `{ scenario, justSeeded }`, duplicate-default dedupe, `updateEntry` unstale on date/amount, transfer dedupe in reconcile, retention pass-3 archive-window guard, conditional data-version bump, `getScenarioOverview` `skipReconcile` option, baseline narrowed to bank/cc/wallet/loan, local-date helpers
- `services/data-cleanup.ts` — `simulator` CleanupObjectType + preview count + DELETE pass
- `app/simulator/_layout.tsx` — title "Cash-flow Simulator"
- `app/simulator/index.tsx` — auto-seed gate on `justSeeded`, list uses `skipReconcile`, new scenario sheet copy-from-existing
- `app/simulator/[id].tsx` — overview card redesign (per-account breakdown), trajectory above entries + default-open, account balances passed to EntryEditSheet, long-press offers Duplicate + Remove, title dep narrowed, local-date helpers
- `app/(tabs)/index.tsx` — Home card title "Cash-flow Simulator"
- `assets/docs/articles/simulator.md` — renamed throughout

**Tests:** 1286/1286 pass. +6 new simulator tests (reactivation dedupe, justSeeded true/false, null-account match, account preference, baseline-already-breached, already-negative-no-warning).

Version bump: **16.0.2 → 16.0.3**. `versionCode` 160002 → 160003.

### 16.0.0 session additions — Cash-flow Simulator ("What-if")

First whole-new feature since v15.2 (biometric lock + smart rules). Major version bump.

**Docs:** [`docs/V16/PRD_V16.md`](docs/V16/PRD_V16.md) + [`docs/V16/MASTER_PLAN_V16.md`](docs/V16/MASTER_PLAN_V16.md) + [`docs/V16/TDD_V16.md`](docs/V16/TDD_V16.md) cover scope, lifecycle, schema, engine algorithm, test plan.

**Feature:** Home tab → Explore & Tools → **What-if simulator**. User lays out expected expenses + incomes before a horizon date (default: end of month). Artha rolls them forward from today's realized balances and shows:
- Net worth today → net worth on horizon, with delta
- Per-account trajectory line charts (dashed threshold lines + red-tinted danger regions)
- Warnings — min-balance breach, CC over-limit, non-CC overdraft (first-trigger date, dedup per account/kind)
- Fulfilled entries auto-move off the "upcoming" list when they're matched to real transactions
- Stale entries (past-date, unmatched) surface with 3 actions: Reschedule / It happened · link / Remove

Nothing writes to the real ledger. Isolated tables, full backup support.

**Lifecycle:**
- Baseline re-pivots on every open — current realized balances feed the engine fresh.
- Fulfillment reconciliation runs on every mount (±3 days, ±5%, same account). Matches auto-link; no-match moves to `stale`.
- Default scenario auto-rolls-forward: on day 1 of each month, horizon advances + stale/fulfilled/dismissed entries wipe + reminders re-seed.
- Retention: entries past horizon+30d purge, non-default scenarios past horizon+90d archive, past horizon+180d hard-delete. Default scenario never archived.

**Schema (migration 025):**
- `simulation_scenarios` — named what-if plans (default + user-saved). `archived_at` nullable.
- `simulation_entries` — planned expenses/incomes. FK `scenario_id` CASCADE. `status` CHECK ('upcoming' | 'fulfilled' | 'stale' | 'dismissed'). `originally_planned_for` for reschedule audit. `seed_source_id` links back to the reminder / CC forecast that seeded it.
- Both tables added to `TABLE_SCHEMAS` + `BACKUP_TABLES` — round-trip via backup.

**Engine:** `services/simulator-engine.ts` — pure functions, no DB. `runSimulation(input)` returns trajectory + warnings + net-worth endpoints. `findFulfillmentCandidate(entry, candidates)` is the fulfillment matcher. 27 engine unit tests.

**Service:** `services/simulator.ts` — scenario + entry CRUD, `seedScenarioFromReminders`, `reconcileStaleEntries`, `purgeRetention`, `getScenarioOverview` (one-shot read for detail screen). Pulls baselines via existing `getComputedBalances` + `getCurrentFundBalances`. 22 service tests.

**UI:**
- `app/simulator/index.tsx` — scenario list (active cards + archived expandable, + New scenario sheet)
- `app/simulator/[id].tsx` — scenario detail (overview hero, stale-entries card, planned-entries list grouped by date, trajectory section, fulfilled-entries section, FAB + menu)
- `app/simulator/_layout.tsx` — stack header
- `components/simulator/EntryEditSheet.tsx` — add/edit bottom sheet (direction / amount / date / account / category / merchant / description)
- `components/simulator/StaleEntryResolveSheet.tsx` — Reschedule / Link-real / Remove
- `components/simulator/TrajectoryChart.tsx` — per-account SVG line chart with danger regions
- `app/(tabs)/index.tsx` — new Home card under Explore & Tools
- `app/_layout.tsx` — register `simulator` stack
- `constants/routes.ts` — `simulator` in allowlist

**Help docs:**
- New: `assets/docs/articles/simulator.md` (full article — where to find, scenarios, entries, overview, lifecycle, trajectory, common situations, non-goals)
- `assets/docs/index.json` regenerated — 27 → 28

**Tests:** +49 (27 engine + 22 service). Full suite: **1280/1280 pass**.

**Files touched:**
- New: `docs/V16/{PRD,MASTER_PLAN,TDD}_V16.md`, `database/migrations/025_simulation_tables.ts`, `services/simulator-engine.ts`, `services/simulator.ts`, `app/simulator/{_layout,index,[id]}.tsx`, `components/simulator/{EntryEditSheet,StaleEntryResolveSheet,TrajectoryChart}.tsx`, `assets/docs/articles/simulator.md`, `__tests__/unit/simulator-engine.test.ts`, `__tests__/integration/simulator.test.ts`
- Modified: `database/migrations/index.ts`, `database/TABLE_SCHEMAS.ts`, `services/backup.ts`, `app/(tabs)/index.tsx`, `app/_layout.tsx`, `constants/routes.ts`, `assets/docs/index.json`, `__tests__/integration/database.test.ts`, `app.json` (15.13.1 → 16.0.0, versionCode 151301 → 160000)

**Testing:** 1280/1280 pass. TS clean on source files (only pre-existing `backup.ts` AES noise).

**Deferred (v16.x or v17):**
- Multi-currency per-scenario with FX conversion
- SMS-based salary / recurring-credit auto-detection
- Stress test / Monte Carlo
- Side-by-side scenario comparison UI
- Budget editing within a scenario

### 15.13.1 session additions — split-edit bugs + "Set reminder" UNIQUE crash + refund cross-link + Transactions tab rename

User surfaced a batch of bugs after v15.13.0. All fixed in one PATCH release.

**1. Split-edit amount drift + paidBy flip (migration 024 + service rewrites).**

The single-split flow stored only `split_pct` (derived percentage). Every time the user saved ANY edit to a split expense, the reconstruction forced `splitMode: "percentage"` + `paidBy: "me"` — causing:
- **Exact-amount splits**: round-tripped through `(myShare / total) * 100` + rounding, drifting by paise every save. Worse, editing the total (₹1000 → ₹1200) re-applied the percentage and shifted the other-person share from the intended ₹400 to ₹480.
- **"They paid" splits**: hardcoded `"me"` flipped the hisaab entry from `"credit"` to `"debit"` on every edit, moving the balance by 2× the split amount.
- Every edit (even just changing merchant/date/category) ran `removeSplit + splitExistingExpense` — UUID churn + drift even for no-op saves.

Fixes:
- **Migration 024** — adds `expenses.split_mode` (text enum) + `expenses.split_exact_amount` (REAL). Both nullable; legacy rows without them fall back to percentage reconstruction so existing behaviour is preserved.
- **`splitNewExpense` / `splitExistingExpense` / `removeSplit`** — persist/clear the two new columns.
- **Edit flow in `app/expense/[id].tsx`**:
  - `paidBy` reconstructed from the linked hisaab entry's `type` (via new `getEntryById` in `services/hisaab.ts`). Debit → "me", credit → "them".
  - `splitMode` reconstructed from the persisted column; exact-mode uses the persisted `splitExactAmount` so rupee amounts survive total edits.
  - **Skip the rebuild** when `parsedAmount === originalTotalAmount`. Only touches expense fields that actually changed.
- Multi-split edit flow also skips rebuild when the total is unchanged (avoids unnecessary hisaab UUID churn).

**2. "Set reminder" UNIQUE constraint crash on re-enable.**

`recurring_expense_rules.source_expense_id` has a DB-level `UNIQUE` constraint (migration 013). `createRule` only checked `is_active = 1` — so if a rule was previously stopped (`is_active = 0`), the guard let a fresh INSERT through, which then tripped the UNIQUE constraint mid-transaction. User saw `UNIQUE constraint failed: recurring_expense_rules.source_expense_id` on seemingly-fresh "Set reminder" taps.

Fix: `services/recurring-rules.ts:createRule` now detects both shapes:
- `is_active = 1` → refuse with the clear "already has an active reminder" message (unchanged).
- `is_active = 0` → **UPDATE** the stopped row back to active with the new config (frequency, start_date, end_date, notes, recomputed `next_due_date`). Matches user mental model: re-tapping "Set reminder" = resume, not duplicate. No DB migration needed.

**3. Refund credit → link back to originating expense on account ledger.**

On CC / savings / wallet / loan / demat ledgers, incoming SMS refund credits (`nature='credit'` with `refund_of_expense_id` set) and manual refund rows had no deep-link back to the originating expense. User couldn't audit the refund→source pair from the ledger.

- **`services/account-credit.ts`**: `AccountCredit` interface + `getCreditsForMonth` select now include `refund_of_expense_id`. `hardDeleteCredit` unchanged — FK cascades already handle this side.
- **`app/reconciliation/account-ledger.tsx`**: new `LedgerEntry.refundOfExpenseId` field populated on both credit + manual-refund paths. Tap handler routes `isRefund && refundOfExpenseId` → `/expense/[originatingId]`; chevron visible. Priority sits above hisaab-deep-link and credit-edit so refund→source wins when both apply.

**4. Transactions tab rename (UI + docs).**

User feedback: "rename Expenses header and tab icon to Transactions, makes more sense." The tab's list shows expenses AND credits (via toggle chips), so "Transactions" is more accurate.

- **`app/(tabs)/_layout.tsx`** — `title: "Expenses"` → `title: "Transactions"`. Icon `receipt-outline` → `swap-vertical-outline`. Route name stays `expenses` (deep-link compatibility + `constants/routes.ts`).
- **Help docs** — 8 articles updated: every "Expenses tab" → "Transactions tab". The 5-tabs table in `getting-started.md` renamed with a copy update reflecting that both expenses and credits live there.
- **Settings row subtitle** for Import from Excel updated to "Import transactions or hisaab entries from an .xlsx file".
- **Stack title** `import-excel` renamed to "Import from Excel" (was "Import Expenses" — misleading since the screen also imports hisaab).

Data-category labels like "Expenses" / "Credits" in filter chips, audit-log object filters, and recycle-bin section headers are kept as-is — they describe object types (not navigation), and calling them "Transactions" would lose the distinction between the sub-types.

**5. Audit log help doc: markdown table → bullet list.**

`components/ui/SimpleMarkdown.tsx` doesn't render GFM tables. The audit-log article's "What counts as an action" table was being rendered as continuous pipe-separated text. Rewrote as a bullet list (works with the same markdown renderer). Other pre-existing tables in `fiscal-year.md`, `smart-sms-templates.md`, `excel-import.md`, `getting-started.md`, `insights.md`, `smart-rules.md`, `goals-milestones.md` remain broken — not introduced this session, out of scope for this patch (follow-up release).

**Files touched:**

Code:
- `database/migrations/024_split_mode_persistence.ts` (new)
- `database/migrations/index.ts` — register 024
- `database/TABLE_SCHEMAS.ts` — `split_mode` + `split_exact_amount` on expenses
- `services/expense-types.ts` — `Expense` interface extended
- `services/expense-splits.ts` — persist/clear `split_mode` + `split_exact_amount` in create/existing/remove paths
- `services/recurring-rules.ts` — `createRule` reactivation path
- `services/hisaab.ts` — new `getEntryById` helper
- `services/account-credit.ts` — `AccountCredit.refund_of_expense_id` + select
- `app/expense/[id].tsx` — edit flow rewrite (single-split reconstruction + multi-split skip)
- `app/reconciliation/account-ledger.tsx` — refund deep-link, `refundOfExpenseId` threading, chevron
- `app/(tabs)/_layout.tsx` — Transactions rename + icon
- `app/settings/_layout.tsx` — "Import from Excel" stack title
- `app/(tabs)/settings.tsx` — Import from Excel subtitle

Docs:
- `assets/docs/articles/audit-log.md` — table → bullet list
- `assets/docs/articles/{hisaab,fiscal-year,privacy-offline,review-queue,getting-started,recycle-bin,reconciliation,refunds}.md` — "Expenses tab" → "Transactions tab"
- `assets/docs/articles/getting-started.md` — 5-tabs row rewritten for Transactions
- `assets/docs/index.json` (regenerated, 27 articles)

Tests:
- `__tests__/integration/database.test.ts` — migration 024 expectation (execAsync 33→35, inserts 23→24, already-applied arrays +1)
- `__tests__/unit/recurring-rules.test.ts` — mock extended with `is_active: 1`; new reactivation test

Version bump:
- `app.json` — 15.13.0 → 15.13.1 (PATCH — 5 bug fixes + copy rename)
- `app.json` — versionCode 151300 → 151301

**Testing:** 1231/1231 pass. TS clean on source files (only pre-existing `backup.ts` AES noise).

### 15.13.0 session additions — SMS trace on transfers + hisaab cross-link on credits + Audit Log + Balance Sheet recompute indicator

Four pieces bundled in one release. All surfaced from user feedback after v15.12.0 shipped.

**1. SMS traceability on `account_transfers` — migration 023.**

Before today, when a user marked an SMS-detected credit as a CC bill payment / self-transfer (via `reclassifyCreditAsTransfer` or `markRepaymentAsPaid`), the resulting transfer row had no back-pointer to its SMS origin. The original credit carried `raw_source_text` and a `pending_sms` row, but the credit was soft-deleted on reclassify — leaving the transfer orphaned from its SMS trail.

- **Migration 023** — additive: `account_transfers.raw_source_text` + `account_transfers.source_sms_address`. Both nullable; populated on reclassify.
- **createTransfer** extended with `rawSourceText` / `sourceSmsAddress` params.
- **reclassifyCreditAsTransfer**, **reclassifyExpenseAsTransfer**, **markRepaymentAsPaid** all query the source expense's `raw_source_text` + the matching `pending_sms.address`, pass both through to the new transfer.
- **Account ledger UI** — transfer rows with SMS trace now show a blue **SMS** pill + chevron. Tapping opens a Source SMS modal showing the full SMS body (monospace, selectable) and the DLT sender ID.

**2. Hisaab settlement cross-link on credit rows.**

User pointed out: when `recordSettlement` creates a settlement entry AND a linked credit (two rows, bidirectional FK), the hisaab ledger shows where the money landed — but the account ledger showed the credit with no indication it was a settlement. Dead-end for the reverse navigation.

- **New batch helper** `getSettlementsForCredits(creditIds)` in `services/hisaab.ts` — one query returns a map of `creditId → { entryId, personId, personName }`. Works for both `'created'` (old `recordSettlement`) and `'linked'` (v15.12 `linkCreditAsSettlement`) settlement provenance.
- **Account ledger** — per-credit lookup populates new `LedgerEntry.linkedHisaabPersonName` / `linkedHisaabPersonId` fields. Rendered as a **HISAAB · [NAME]** pill alongside other pills. Tapping the row deep-links to `/hisaab/ledger?personId=...`.

**3. Audit Log — new Settings screen.**

User asked for a view to filter by action taken on manual / SMS-detected records. Built as a read-only timeline screen under Automation.

- **New service** `services/audit-log.ts` — one unified query across `expenses` + `account_transfers` + `hisaab_entries`. Classifier derives `actionType` from `status` + `deleted_at` + `nature` + `source` + FK stamps (`matched_forecast_id`, `fulfills_rule_id`, `applied_rule_id`, `settlement_source`, `refund_of_expense_id`). Emits an `AuditLogEntry[]` with 10 action types: `approved`, `rejected`, `created`, `deleted`, `marked_as_transfer`, `marked_as_cc_bill`, `marked_as_settlement`, `linked_to_reminder`, `reclassified_by_rule`, `refunded`. Supports filters on source (SMS / manual), object type (expense / credit / transfer / hisaab / forecast), action, date range (7d / 30d / 90d / year / all), free-text search.
- **New screen** `app/settings/audit-log.tsx` — filter chips at the top (date scope, source, object type, action), search box, results list. Each row shows a colored action pill, description, amount, account/person label, and date. Tappable rows deep-link to the underlying record's detail screen (expense, credit, forecast detail; person hisaab ledger).
- **Settings tab entry** — new row under Automation card: "Audit Log · See every action taken on detected and manual records".
- **Route allowlist** — `settings/audit-log` added to `constants/routes.ts`.
- **Stack layout** — registered under `app/settings/_layout.tsx`.

**4. Balance Sheet recompute indicator.**

User feedback: "value change, it is computing in background and shows old numbers upfront". Net worth and column totals were silently swapping in on every `useDataRefresh` fire, with no visual cue that numbers on screen were stale during recompute.

- **`app/goals/balance-sheet.tsx`** — new `recomputing` state set to true during `getBalanceSheet()`. A small accent-tinted "Updating…" pill with a spinner appears next to the "Net Worth · Today" label. The hero amount and the entire column table dim to 55% opacity while recomputing, then snap back full-opacity with the new numbers. Visual contract: dimmed = about to change, full-opacity = current.

**Help docs:**

- **New**: `assets/docs/articles/audit-log.md` — full article covering all 10 action types, filter use cases, tips.
- **Updated**: `assets/docs/articles/reconciliation.md` — new "Tappable rows on the ledger" section documenting the Source SMS viewer + HISAAB pill behavior.
- **Regenerated**: `assets/docs/index.json` — 26 → 27 articles.

**Files touched:**

Code:
- `database/migrations/023_transfer_sms_trace.ts` (new)
- `database/migrations/index.ts` — register 023
- `database/TABLE_SCHEMAS.ts` — `raw_source_text` + `source_sms_address` on account_transfers
- `services/account-transfer.ts` — AccountTransfer interface + createTransfer + reclassifyCreditAsTransfer + reclassifyExpenseAsTransfer
- `services/expense-forecasts.ts` — markRepaymentAsPaid SMS trace
- `services/hisaab.ts` — getSettlementsForCredits batch helper
- `services/audit-log.ts` (new)
- `app/reconciliation/account-ledger.tsx` — LedgerEntry extended, Source SMS modal, HISAAB pill on credits, tap handlers
- `app/settings/audit-log.tsx` (new)
- `app/settings/_layout.tsx` — register audit-log stack
- `app/(tabs)/settings.tsx` — Audit Log row under Automation
- `app/goals/balance-sheet.tsx` — recomputing state + "Updating…" pill + dim-while-recomputing
- `constants/routes.ts` — `settings/audit-log` whitelisted

Docs:
- `assets/docs/articles/audit-log.md` (new)
- `assets/docs/articles/reconciliation.md` (new tappable-rows section)
- `assets/docs/index.json` (regenerated, 27 articles)

Tests:
- `__tests__/integration/database.test.ts` — execAsync count 31→33, inserts count 22→23, already-applied arrays +1

Version bump:
- `app.json` — 15.12.0 → 15.13.0 (MINOR — 1 substantial new feature: Audit Log; plus two traceability fixes)
- `app.json` — versionCode 151200 → 151300

**Testing:** 1230/1230 pass. TS clean on source files (only pre-existing `backup.ts` AES noise).

### 15.12.0 session additions — reminder sheet rewrite + CC bill cross-link + hisaab credit settlement + docs overhaul

User surfaced a batch of feedback after v15.11.5 — several UX gaps on the reminder sheet, a missing cross-link on CC bill payments, a missing capability on hisaab credits, and terminology drift across the help docs. Fixed all four in one release.

**1. Reminder sheet rewrite (`components/expense/RecurringRuleSheet.tsx`).**

Four fixes bundled:

- **Keyboard overlap on Notes.** The sheet was a plain `Modal` + `Animated.View` with no `KeyboardAvoidingView` and no scroll — the multiline Notes at the bottom got covered by the soft keyboard. Now wrapped in `KeyboardAvoidingView` (iOS `padding`, Android default) + a `ScrollView` with `keyboardShouldPersistTaps="handled"`, `maxHeight: 90%` cap.
- **Missing date picker.** Starts and Until were raw `TextInput` with `placeholder="YYYY-MM-DD"` — error-prone and inconsistent with the rest of the app. Replaced both with tappable rows that open the shared `CalendarModal` component, same as the expense add/edit forms. End-date picker's `minimumDate` is seeded from the current start date so users can't pick an invalid range.
- **Frequency-aware start-date suggestion.** New `suggestStartDate(sourceYMD, freq)` helper — Monthly → same day next month, Weekly → +7 days, Quarterly → +3 months, Yearly → same day next year. Seeded on open AND when the user changes frequency, but only until the user manually taps the date (tracked via `startTouched` ref). Shows a "Suggested based on [frequency] cadence — tap to change." hint until overridden.
- **Terminology aligned to "Reminder" everywhere.** Sheet title: "Make recurring" → "Set reminder" / "Edit reminder". Body copy: "We'll create one forecast at a time" → "We'll remind you before each cycle. When you log the expense, the next cycle advances automatically." Save button: "Save" → "Save reminder" / "Save changes". Matching rename in caller sites: `app/expense/[id].tsx` alerts ("Couldn't set up recurring" → "Couldn't save reminder"; "Stop recurring?" → "Stop reminder?"); `app/settings/recurring-rules.tsx` empty state ("No recurring reminders yet" + 'Open an expense and tap "Make recurring"' → "No reminders yet" + 'Open an expense and tap "Set reminder"').

**2. CC bill payment cross-link (`app/expense/[id].tsx`).**

When a credit-card SMS lands as a credit and the user taps "Mark as CC Bill Payment" → picks the source account → `reclassifyCreditAsTransfer` creates a transfer row and soft-deletes the original credit. Previously the UI just showed a "Reclassified" alert and called `router.back()` — the user lost sight of the resulting transfer.

Now `handleCreditTransferSourceSelected` + `handleRepaymentAccountSelected` both `router.replace` to `/reconciliation/account-ledger?accountId=<cc>&transferId=<new>` after reclassify, reusing the v14.7.1 `transferId` focus-highlight plumbing. User lands on the CC ledger with the new payment row visually highlighted. Same cross-link applies to the forecast-based CC repayment flow (tap "Pay now" on an open repayment forecast).

**3. Hisaab credit-settlement marking.**

New capability — the inverse of the existing `recordSettlement` (which creates a settlement entry AND a linked credit). This takes an EXISTING credit (e.g. an incoming UPI SMS from a friend) and says "this was a settlement from Vinay".

- **Migration 022** — adds `hisaab_entries.settlement_source` ('created' | 'linked', default 'created'). `'created'` = old path (delete cascades to credit); `'linked'` = new v15.12 path (delete only unlinks; credit stays).
- **New service fns** (`services/hisaab.ts`): `linkCreditAsSettlement(creditId, personId)`, `unlinkCreditSettlement(creditId)`, `getSettlementForCredit(creditId)`. `linkCreditAsSettlement` rejects double-linking (one credit → one settlement).
- **New UI** — `components/expense/HisaabSettlementPickerSheet.tsx`. Slide-up person picker, shows each hisaab person with current balance (people who owe you are listed first — the likely settlement candidates). Same visual grammar as `DematTransferTargetSheet` / `RecurringRuleSheet`.
- **Expense detail integration** (`app/expense/[id].tsx`) — "Mark as Settlement" action row visible on realized non-CC credits that aren't already linked. When linked, a soft accent-tinted badge card replaces the row: "Settlement from [person]" + "View ledger" (deep-link to `/hisaab/ledger?personId=...`) + "Unlink" (keeps credit, drops hisaab row).
- **Delete cascade plumbing** — `services/hisaab.ts:deleteEntry` now checks `settlement_source` and preserves linked credits on `'linked'` settlements. `services/account-credit.ts:hardDeleteCredit` + `services/expense-crud.ts:permanentlyDeleteExpense` (both single and bulk paths) drop any `settlement_source='linked'` hisaab rows pointing at the hard-deleted credit. Soft-delete of the credit keeps the hisaab link intact (restorable).
- **Schema** — `database/TABLE_SCHEMAS.ts:hisaab_entries` extended with `settlement_source`. Backup/restore works forward AND backward (pre-v15.12 backups have no `settlement_source` column → DB default 'created' applies; v15.12 backups carry the column).

**4. Documentation overhaul (`assets/docs/articles/`).**

Driven by "language inconsistency in documentation" feedback: some docs said "Settings tab", others just "Settings", some referenced card structure that predated v15.8.2/v15.9 reshuffling.

- **Terminology normalized** — every "Settings → X" replaced with "Settings tab → X". Card-structure paths updated to the current 5-card Settings layout (Master Data / Automation / Import & Config / Security & Privacy / Backup & Storage / Preferences / About), plus SMS Detection / Duplicate Detection / Help & setup. Stale refs fixed: "Settings tab → Accounts" → "Settings tab → Master Data → Accounts"; "Settings tab → Reminders" → "Settings tab → Automation → Reminders"; "Settings tab → Smart Rules" → "Settings tab → Automation → Smart Rules"; "Settings tab → Backup & Restore" → "Settings tab → Backup & Storage → Backup & Restore"; "Settings tab → Recycle Bin" → "Settings tab → Backup & Storage → Recycle Bin"; etc. "Insights tab" corrected to "Insights screen" everywhere (it's reached from Home, not a bottom-nav tab).
- **`reminders.md` rewritten** — reflects the v15.12 sheet UX (calendar pickers, frequency-aware suggestion, "Set reminder" nomenclature) and the existing suggestion-banner / fulfilled-badge model.
- **`hisaab.md` rewritten** — documents the new v15.12 "Mark as Settlement" flow as Option B alongside the existing Option A (recordSettlement).
- **`insights.md` + `getting-started.md`** — fixed the "Insights tab" / "5 tabs" factual error.
- **3 new articles**:
  - `biometric-lock.md` — App Lock feature (shipped v15.2, previously undocumented).
  - `preferences-region.md` — currency / number format / date format / fiscal year (v15.9 Region pref consolidation).
  - `recycle-bin.md` — dedicated article for the soft-delete / restore / auto-purge model; previously only mentioned inline.
- **`index.json` regenerated** — 23 articles → 26.

**Files touched:**

Code:
- `components/expense/RecurringRuleSheet.tsx` — rewritten
- `components/expense/HisaabSettlementPickerSheet.tsx` (new)
- `app/expense/[id].tsx` — reminder alerts renamed, CC cross-link nav, hisaab settlement state + handlers + action row + linked badge + sheet mount
- `app/settings/recurring-rules.tsx` — empty state copy
- `services/hisaab.ts` — HisaabEntry type extended; `linkCreditAsSettlement` / `unlinkCreditSettlement` / `getSettlementForCredit` added; `recordSettlement` + `deleteEntry` honor `settlement_source`
- `services/account-credit.ts` — `hardDeleteCredit` drops linked settlements
- `services/expense-crud.ts` — single-row + bulk `permanentlyDeleteExpense` drop linked settlements
- `database/migrations/022_hisaab_settlement_source.ts` (new)
- `database/migrations/index.ts` — register 022
- `database/TABLE_SCHEMAS.ts` — `settlement_source` column

Docs:
- `assets/docs/articles/biometric-lock.md` (new)
- `assets/docs/articles/preferences-region.md` (new)
- `assets/docs/articles/recycle-bin.md` (new)
- `assets/docs/articles/reminders.md` — rewrite
- `assets/docs/articles/hisaab.md` — rewrite for settlement flow + Home-tab entry
- `assets/docs/articles/insights.md` — Insights screen, not tab
- `assets/docs/articles/getting-started.md` — 5-tabs fact fix
- `assets/docs/articles/privacy-offline.md` — Data Cleanup path updated
- `assets/docs/articles/excel-import.md` — Import & Config path
- `assets/docs/articles/{accounts,reconciliation,min-balance-alert,getting-started,categories,merchant-aliases,smart-rules,smart-sms-templates,sms-detection,backup-restore,review-queue,duplicate-detection,fiscal-year,projection-block}.md` — Settings tab path normalization
- `assets/docs/index.json` — 23 → 26 entries

Tests:
- `__tests__/integration/database.test.ts` — migration 022 expectation (execAsync count 30→31, inserts count 21→22, already-applied arrays +1)

Version bump:
- `app.json` — 15.11.5 → 15.12.0 (MINOR — 3 meaningful new UX capabilities bundled with docs refresh)
- `app.json` — versionCode 151105 → 151200

**Testing:** 1230/1230 pass. TS clean on source files (only pre-existing `backup.ts` AES noise; test-file type mocks were already broken pre-v15.12).

### 15.11.5 session additions — Lifestyle Creep drill visualization

User feedback on the v15.11.4 drill: "it shows rent and utility yoy 156% and on clicking I see 6 transactions … I do not understand." The issue was that the drill showed only the current-side transactions with a bare `+156% YoY` suffix in the label — no way to see what last year's number actually was, why the % was so high, or how categories compared to each other.

**Rebuilt the Lifestyle Creep drill as a proper side-by-side YoY view:**

- **Hero card** now shows two labelled columns: current window total (e.g. `Mar–May 2026: ₹53,738`) next to the prior-year window total (`Mar–May 2025: ₹21,000`), with a separator row underneath showing the absolute change `+₹32,738 (+156%)` in red/green.
- **Breakdown rows** use a new `YoYComparisonRow` component — per-category twin horizontal bars (current in red if grew / green if shrank, previous in muted grey) scaled against the largest value in the entire drill so you can eyeball size differences across rows.
- **Delta badge** on the right of each row: `+156%` in red with an up-arrow, or `−22%` in green with a down-arrow.
- **"NEW THIS YEAR" pill** replaces the % when the category has zero spend in the last-year window (avoids divide-by-zero AND explains why the headline % looks huge — it's the #1 real-world cause of inflated creep numbers).
- **Footer per row** shows `N transactions this year · +₹32,738 vs last yr`.
- **Sort order** — by largest absolute rupee increase (not % change), so small-base noise doesn't dominate the list.
- **"How to read this" footnote card** at the bottom explains what red/green/grey mean and calls out that "new this year" can inflate the headline creep %.

All other insight drills (breach, win, leaks) keep the existing `DrillGroupRow` layout — the `YoYComparisonRow` is only used when `insight.type === 'lifestyle_creep'` and `detail.yoyComparison` is populated.

**Type changes:**
- `InsightDrillGroup.comparison?: { previousAmount; deltaAmount; deltaPct | null }` (optional; populated only by the creep drill).
- `InsightDetail.yoyComparison?: { currentTotal; previousTotal; currentLabel; previousLabel }` — drives the hero card.
- Labels (`Mar–May 2026`) computed from the current-calendar month; current window is `month-2 .. month`.

**Files touched:**
- `services/insight-engine.ts` — types extended; `getLifestyleCreepDrill` populates `comparison` + `yoyComparison`, sorts by absolute ₹ delta, drops the `+X% YoY` suffix from labels (the row UI now owns that).
- `components/analytics/YoYComparisonRow.tsx` (new) — twin-bar comparison row.
- `app/insights/insight-detail.tsx` — branches on `insight.type === 'lifestyle_creep'` for hero + breakdown + footnote; all other types unchanged.
- `app.json` — 15.11.4 → 15.11.5.

**Testing:** 1230/1230 pass. TS clean on source files.



### 15.11.4 session additions — analytics bugs + help-search smarts

Three UI bugs on the Insights / Budget analytics flow, plus a round of help-center improvements so users can self-serve.

**Bug A — literal `·` rendering as text on the Forecast card.** `components/analytics/ForecastBreakdown.tsx:94` had the raw escape inside a JSX text node: `{formatAmount(variable.dailyPace)}/day pace · {variable.daysLeft} days left`. In JS string literals `"·"` is parsed to `·`; in JSX **text**, escapes are rendered verbatim. Replaced the literal with the actual middle-dot character. Other `\uXXXX` usages in the file are inside `{"✓"}` etc. (JS string literals, fine).

**Bug B — "Lifestyle Creep" insight tap → "Insight not available".** `services/insight-engine.ts:getInsightDrill` only handled `breach`, `win`, `leaks` types. Creep insights have id `creep_<yearMonth>` and were falling through to `return null`. Added `getLifestyleCreepDrill` that does a category-level YoY breakdown — current 3mo vs same 3mo last year, grouped by category, labelled with the per-category YoY delta (`Food · +42% YoY` / `Travel · -15% YoY` / `Gifts · new this year`). Percentages computed from current-period totals so the breakdown progress bars sum sensibly.

**Bug C — Budget's Month-End Projection widget hidden on day 1 of the month.** Gate was `daysElapsed > 0`. On the 1st (before any expense lands), the widget vanished — inconsistent with the Insights forecast card which shows regardless. Dropped the gate; the widget now renders whenever a budget exists. Low-confidence data shows up as low confidence in the widget itself, which is the honest answer.

**Also — "See all" button removed from Insights home.** The button on the Insights SectionHeader did nothing on tap (`onPress: () => {}`). User asked to remove rather than fix — `SectionHeader title="Insights"` now renders without an action chip.

**Help center — smarter search + content enrichment.** User feedback: "update help docs to reflect the latest and greatest and make it a much smarter and close to semantic search, where if I type UI element month end projection it shows stuff."

Changes in `services/docs/index.ts`:
- **Synonym expansion table** — 50+ bidirectional entries (`projection` ↔ `forecast`, `cap` ↔ `budget` ↔ `limit`, `creep` ↔ `lifestyle` ↔ `yoy`, `reminder` ↔ `recurring`, `rightspend` ↔ `avoidable` ↔ `unavoidable`, etc.). A query token hits if the token OR any synonym appears in the text.
- **Prefix match instead of whole-word** — `project` now matches `projection`, `projected`, `projects`. Keeps hit counts honest without the false positives of pure substring search.
- **Wider stopword list** — dropped UI-scaffolding noise (`ui`, `element`, `button`, `tab`, `page`, `screen`, `widget`, `card`, `icon`, `pill`, `chip`, `row`, `section`, `field`, `label`, `show/shows/showing`, `see`, `view`, `from`, `vs`). So "UI element month end projection" tokenizes to `["month", "end", "projection"]` and hits the right article.
- **Tokenizer preserves hyphens** so terms like `month-end`, `right-spend`, `credit-card` survive.

Content additions:
- `assets/docs/articles/projection-math.md` (new) — full explanation of fixed / fixed-pending / variable / daily pace / days-left / confidence with worked numeric example. Slug `projection-math`, 20+ authored phrasings including explicit "UI element X" forms.
- `assets/docs/articles/insights.md` (new) — tour of the Insights tab (Forecast, Insight cards, Spending Pulse, Explore, Compare, Patterns, Merchants). Explains the five insight types, severity bands, drill-down behavior. 20+ phrasings.
- `accounts.md`, `budget.md`, `reminders.md`, `getting-started.md` — phrasings + tags expanded with UI-element keywords so "Budget tab", "Home tab", "Home hero card", "UI credit card dashboard", "FAB add button", "Pool balance", "UI insights tab" etc. now resolve.

`assets/docs/index.json` regenerated — 23 articles total (was 21).

**Files touched:**
- `components/analytics/ForecastBreakdown.tsx` — `·` → `·`
- `services/insight-engine.ts` — `getLifestyleCreepDrill`
- `app/(tabs)/budget.tsx` — removed `daysElapsed > 0` gate
- `app/insights/index.tsx` — removed "See all" button
- `services/docs/index.ts` — synonyms + prefix match + wider stopwords
- `assets/docs/articles/projection-math.md` (new)
- `assets/docs/articles/insights.md` (new)
- `assets/docs/articles/{accounts,budget,reminders,getting-started}.md` — phrasings expanded
- `assets/docs/index.json` — regenerated (23 articles)
- `app.json` — 15.11.3 → 15.11.4

**Testing:** 1230/1230 pass. Docs-search existing tests still green (synonyms/prefix are additive; the old whole-word path is a subset of the new prefix path, and existing test assertions don't rely on whole-word strictness).



### 15.11.3 session additions — account linking loosened + stale scan CTAs

Two bugs, both reported after v15.11.2 installed.

**Fix A — wallet template SMSes weren't linking to the wallet account.** Root cause: `linkExpenseToAccount` required `bank_name` to match exactly between what the template captured and what was saved on the wallet. User had `bank_name = "Tata Neu Coins"` on the wallet (original, verbose) but typed `bank_name = "TataNeu"` on the template row. Mismatch → no account link → expense went "Not set". This also blocked the nickname-fallback because the nickname SQL had `WHERE bank_name = ?` upstream of the `account_label` check.

Fix: rewrite both paths in `services/financial-account.ts:linkExpenseToAccount` to use bank_name as a tiebreaker in `ORDER BY` rather than a strict filter.
- Path 1 (digit match via `cardLast4`): match on `account_identifier` only; prefer same-bank in tiebreak.
- Path 2 (nickname match): match on EITHER `account_label` OR `bank_name` (case-insensitive). Either field can hold the name the user associates with the account. Tiebreak prefers: same-bank-name → wallet type → account_label match (over bank_name match) → oldest.

Restated as a plain rule: *"When an SMS says 'account X', find an account where either the 4-digit code, the nickname, or the bank name matches X. Prefer exact same-bank matches when available, else fall through."*

**Fix B — stale "Review N" / "N duplicates" CTAs on Settings.** The SMS-scan result banner + duplicate-scan result banner kept their content after the user tapped the CTA, navigated to the Review Queue, emptied it, and came back. Tapping the banner again sent the user to an empty queue.

Fix: `app/(tabs)/settings.tsx` `useFocusEffect` now clears `smsScanResult / smsScanCreated / dupScanResult / dupGroupCount` every time the screen gains focus. The CTAs are "just-now" signals, not persistent badges — resetting on focus means they only appear in the narrow window between a scan completing and the user acting. Actual pending-review work is still surfaced via the dedicated Review Queue icon / Home card.

**Files touched:**
- `services/financial-account.ts` — loosened `linkExpenseToAccount` for both digit and nickname paths
- `app/(tabs)/settings.tsx` — focus-effect clears stale scan CTA state
- `app.json` — 15.11.2 → 15.11.3

**Testing:** 1230/1230 pass. No changes needed in existing test suites — the linkExpenseToAccount behavior change is covered by the existing wallet-link tests, which don't exercise the too-strict bank_name filter being removed.


### 15.11.2 session additions — save nav Edit flow + the REAL wallet SMS scan fix

Two separate fixes bundled.

**Fix A — template save Edit-flow lands on list.** v15.11.1 fixed the Create flow but the Edit flow still bounced to `/new`. Root cause: `tag.tsx` has a hot-reload-fallback `useEffect` redirecting to `/new` when `draft.smsBody` goes empty. Save did `clearDraft()` before navigation settled → useEffect fired → pushed to /new.

Fix: navigate FIRST, `clearDraft()` SECOND; plus a `savingRef` guard on the redirect useEffect. Dropped the unnecessary `router.dismissAll()` (only dismisses modals in Expo Router, not regular stack routes).

**Fix B — wallet SMS scan + Diagnose still missing SMSes after v15.11.1.** The v15.11.1 "user-claims-sender bypasses keyword gate" fix landed at the wrong layer. There are FOUR gates in the SMS scan pipeline; v15.11.1 only fixed the last one:

1. `sms-reader.ts:fetchBankSMSRange` — filters `allSms.filter()` at read time. Wallet SMSes rejected here never reach the parser.
2. `sms-parser.ts:template-match gate` — v15.11.1 fixed.
3. `sms-parser.ts:unrecognised-persistence gate` — v15.11.1 fixed.
4. `user-sms-templates.ts:diagnoseUserTemplate` — filters candidate SMSes by `sender_address contains bank_name_prefix` or `looksLikeTransaction(body)`. For bank_name="TataNeu", senderPrefix="TATA", which doesn't appear in "VM-MYTNEU-S". Wallet SMSes rejected from the Diagnose scope before the regex runs.

Fix: new sync helpers `loadUserSenderClaims()` (async, pre-loads the list once) + `matchesAnyUserSenderPattern(addr, claims)` (sync, 3-mode match). Used in:
- `sms-reader.ts`: pre-load claims before the sync filter, include user-claimed senders.
- `diagnoseUserTemplate`: use the template's own `sender_pattern` as the primary relevance signal, falling back to bank-name-prefix only if no sender claim.
- `testPatternAgainstUnrecognised`: takes optional `UserSenderClaim` arg, uses pattern substring in the SQL `LIKE` filter alongside the bank-name-prefix fallback.
- `tag.tsx:handleTestUnrecognised`: passes the effective sender claim to the test function.

**Fix C — restore backup coverage gap for 6 tables.** Audit of `BACKUP_TABLES` vs `TABLE_SCHEMAS` surfaced six tables in the former but missing from the latter: `sms_sender_registry`, `reminder_suggestions` (both carry user data — user-authored sender→bank mappings + harvested reminder hints), plus `ifsc_bank_registry`, `mcc_codes`, `merchant_brand_registry`, `data_bundle_versions` (public reference data, re-seeded on boot so absence isn't catastrophic but they're bundled anyway).

Pre-v15.11.2 every restore silently dropped all six. `sms_sender_registry` drop was user-visible: after restore, user-taught templates had to re-learn their sender→bank mappings even though the backup captured them.

Fix: add the 6 whitelists to `TABLE_SCHEMAS`. Harmless even for the reference-data ones — their seed path uses `INSERT OR IGNORE` so it still overlays bundled data on top of restored rows.

**Files touched:**
- `services/sms/user-sms-templates.ts` — new sync helpers, Diagnose + test-against-unrecognised rewired
- `services/sms/sms-reader.ts` — pre-load user claims, include claimed senders in read filter
- `app/settings/sms-templates/tag.tsx` — save nav + pass sender claim to test function
- `database/TABLE_SCHEMAS.ts` — +6 whitelists for previously-dropped backup tables
- `app.json` — 15.11.1 → 15.11.2

**Testing:** 1230/1230 pass.


### 15.11.1 session additions — SMS template fixes + recycle-bin bulk FK

Seven bugs surfaced by the user after v15.11.0 went to their phone. Batched into one patch.

**1. SMS template: save flow went to /new instead of the list.**
`tag.tsx` used `router.back()` then `router.back()` then `router.replace("/settings/sms-templates")` — but sequential `back()` + `replace()` on the same tick races on Expo Router, sometimes landing on `/new.tsx` instead of the list. Switched to `router.dismissAll()` + `router.replace(...)` — race-free.

**2. SMS template: auto-label was "<Bank> <tx_type>" instead of sender pattern.**
The sender pattern (e.g. `MYTNEU`) is the actual routing key and more useful as a label than "TataNeu debit". Updated `createUserTemplate` + `updateUserTemplate` in `services/sms/user-sms-templates.ts` to prefer sender pattern when user didn't provide an explicit label.

**3. SMS scan / Diagnose not picking up wallet SMSes (critical).**
Two sub-bugs, same root cause:
- `sms-parser.ts:101` gated template matching on `isBankSender(sender) || registeredBank != null || looksLikeTransaction(body)`. Wallet SMSes (TataNeu NeuCoins, Amazon Pay Rewards) lack the transaction keywords (`debited`, `UPI`, `Rs.`, `A/c`, etc.) — so the parser rejected them before the matcher ran, even though a user template existed.
- `user-sms-templates.ts` Diagnose + testPatternAgainst called `re.test(r.body)` against **raw** SMS bodies. But v15.11.0 compiled regexes live in **normalized-space** (lowercased, URL-wildcarded, etc.). Diagnose silently returned "0 matches" while the production matcher (which DOES normalize) would have worked.

Fixes:
- New helper `hasSenderScopedUserTemplate(senderAddress)` in user-sms-templates.ts. Runs the same 3-mode sender-match logic against `sms_template_patterns WHERE source='user' AND sender_pattern IS NOT NULL`. One cheap SQL query.
- `sms-parser.ts` template-match gate AND unrecognised-persistence gate both OR in `userClaimsSender` — if the user has explicitly authored a template for this sender, trust them and let the matcher run regardless of body content.
- Diagnose and testPatternAgainstUnrecognised now normalize `r.body` through `normalizeSms()` before calling `re.test()`.

**4. Unrecognised-SMS card on Smart SMS Templates list broke design system.**
Pre-v15.11.1 the ListHeaderComponent used a bespoke `bg-surface-light-alt` box with custom padding + border radius. Template cards below used `<Card>` with different radius + elevation + padding — side-by-side looked off. Wrapped the header in `<Card>` to match.

**5. Recycle Bin bulk delete threw FK constraint errors.**
`purgeOldDeletedExpenses` (used by "Empty All") was missing four FK-clears that the single-row `permanentlyDeleteExpense` does:
- `account_transfers.linked_forecast_id = NULL` where pointing at recycled expenses
- `account_transfers.linked_expense_id = NULL` where pointing at recycled expenses
- `DELETE FROM reminder_fulfillments WHERE expense_id IN ...`
- `UPDATE expenses SET recurring_rule_id = NULL` where the rule's source_expense was in the recycle bin (prevents orphan-rule-stamp on materialized forecasts after the cascade)

Mirror-added to the bulk path so it matches the single-row path exactly.

**Files touched:**
- `services/sms/user-sms-templates.ts` — new `hasSenderScopedUserTemplate`, normalize calls in Diagnose + test, auto-label prefers sender pattern
- `services/sms/sms-parser.ts` — both gates OR in `userClaimsSender`
- `services/expense-crud.ts` — `purgeOldDeletedExpenses` mirrors single-row FK-clear set
- `app/settings/sms-templates/tag.tsx` — `dismissAll + replace` save nav
- `app/settings/sms-templates/index.tsx` — unrecognised-card wrapped in `<Card>`
- `app.json` — 15.11.0 → 15.11.1
- `__tests__/unit/sms-parser-gate.test.ts` (new) — 7 regression tests on `hasSenderScopedUserTemplate`

**Testing:** 1230/1230 pass (+7 new regression tests). TS clean on source files.


### 15.11.0 session additions — SMS template hardening + sender-ID routing

Bundled pass driven by a user-reported bug (template compiled against a TataNeu wallet SMS didn't match the next TataNeu SMS). Root-cause investigation surfaced 17 known pitfalls in regex-based Indian SMS parsing; we fixed the 8 critical ones in one release and documented the rest for deferral.

**1. Nine-step normalization pipeline (`services/sms/sms-normalize.ts`).**

Applied symmetrically at compile time (user's sample SMS) and match time (every incoming SMS). Each pass is offset-aware so the tagger UI can keep operating on the original text while the compiled regex lives in normalized-space.

Passes:
1. Lowercase (case variance HDFC vs hdfc)
2. Currency prefixes `Rs.` / `INR` / `₹` → canonical `rs.` + collapse space before digit (so "Rs. 500", "Rs.500", "₹500", "INR 500" all produce the same form)
3. Thousands commas stripped between digits (`1,23,456` → `123456`, handles Indian lakh + Western formats)
4. Whitespace runs collapsed to single space
5. Leading DLT sender-ID header stripped if pasted into sample (`AX-HDFCBK-S `)
6. URLs replaced with `<url>` placeholder (per-message unique shortener slugs like `m.tneu.in/MYTNEU/joogO2l` were the originating bug)
7. RTL / zero-width chars stripped
8. Trailing boilerplate (`Not you?`, `T&C apply`, `SMS BLOCK`, `Call <number>`) stripped
9. Trailing DLT template ID (`-<15-25 digits>`) stripped

The compiler runs user tap offsets through `mapOriginalSpanToNormalized` so spans compile in normalized space. `testTemplate` at runtime normalizes the incoming SMS before the regex runs. UI outputs (preview, testTemplate extractions, deriveSpansFromRegex offsets) map back to original offsets so users see the pretty original-cased values.

**2. Sender-based template routing (migration 021 + matcher rewrite).**

Previous design routed user templates by `bank_name`, which required Artha to already know the brand. Wallets / new fintechs / obscure PSU banks weren't recognised → their templates never got invoked on incoming SMS.

New columns on `sms_template_patterns`:
- `sender_match_mode` — `code` (default, matches [A-Z]{4,} DLT code like `MYTNEU`), `exact` (full string), `contains` (substring)
- `sender_pattern` — the stored pattern string, uppercased

Matcher (`tryTemplateMatch`) now tries sender-scoped templates first. A TataNeu template set to `code: MYTNEU` matches `VM-MYTNEU-S`, `AD-MYTNEU-T`, `JD-MYTNEU` — survives telco route changes which were the #1 cause of silent breakage. Bank-scoped (legacy `bank_name`-only) templates still work as a fallback.

Returned `ParsedSMS.bank` prefers the template's own `bank_name` when sender-matched, so brand labelling works for wallets even when the DLT-resolver doesn't know them.

**3. Wallet-nickname account field (carried forward from v15.10.0).**

`FIELD_REGEX.account` widened from `\d{3,6}` to also accept text (2-50 char nickname). Matcher branches on digits vs text. `linkExpenseToAccount` extended with label-based fallback, case-insensitive, tiebreak by wallet-type → active → oldest.

**4. URL wildcarding (the original user bug).**

`escapeLiteral` in the compiler now detects URLs in anchor text and replaces them with `scheme+host\\S*`, so per-message shortener slugs don't defeat matching. Plus normalization step 6 now replaces URLs with a stable placeholder before compile.

**5. Tag-screen UX improvements (carried forward).**

Preview no longer blanks when one field is mis-tagged (v15.10.0). Per-field format helpers on tap (v15.10.0). Sender ID input + match-mode chips added (v15.11.0). Auto-extract from pasted `VM-MYTNEU-S` → `MYTNEU` with live preview of what will match.

**6. Backup / restore gap fixed.**

`sms_template_patterns` was in `BACKUP_TABLES` but NOT in `TABLE_SCHEMAS` (the restore whitelist). Every restore silently dropped user templates. Added the whitelist entry so restores now preserve them.

**Files touched:**
- `services/sms/sms-normalize.ts` (new)
- `services/sms/template-compiler.ts` (normalizer wiring, original-case preservation, URL wildcard)
- `services/sms/user-sms-templates.ts` (sender fields, SELECT/INSERT/UPDATE updates)
- `services/sms/template-draft-store.ts` (carries sender fields across screens)
- `services/public-data/sms-template-matcher.ts` (sender-precedence, 3 modes, brand label from template row)
- `services/financial-account.ts` (label-based account linking, v15.10.0 carry-forward)
- `services/sms/sms-to-expense.ts` (accountNickname threading, v15.10.0 carry-forward)
- `database/migrations/021_sms_template_sender_pattern.ts` (new)
- `database/migrations/index.ts` (register 021)
- `database/TABLE_SCHEMAS.ts` (add sms_template_patterns whitelist)
- `app/settings/sms-templates/tag.tsx` (Sender ID + match-mode UI, format helpers)
- `app/settings/sms-templates/new.tsx` (pre-fill sender from pending_sms.address)
- `app/settings/sms-templates/[id].tsx` (load sender fields on edit)
- `assets/docs/articles/smart-sms-templates.md` (functional doc for sender ID + wallet accounts)
- `app.json` (15.10.0 → 15.11.0)

**Deferred to v15.11.x / v15.12.0 (documented but not fixed):**
- Amount-format edge cases beyond normalization (e.g. `Rs.500/-` trailing slash-hyphen)
- Balance label alternation dictionary (`Avl Bal` vs `Available Balance` vs `Bal.`)
- Reversal-SMS branching (zero-amount / `reversal of txn dt...` detection)
- Hindi / Devanagari body text (very rare in transactional SMS)
- Multi-part SMS reassembly (OS handles it on modern Android)

**Tests:** 1213 → 1223 (10 new sender-match tests, 6 new normalization tests carried from v15.10.0).


### 15.10.0 session additions — SMS template tagger: wallet accounts + preview fix + field-format help

Driven by three linked user reports on the v15.5.0 template tagger:

**1. The `account` tag can now be multi-word text (wallet nicknames), not just digits.**

Previously `FIELD_REGEX.account` was `\d{3,6}` — so tagging "Amazon Pay Wallet" or "TataNeu Coins" on a wallet SMS compiled but then failed at runtime because the matcher did `groups["account"].slice(-4)` = `"llet"` / `"oins"` and tried to match that garbage against `financial_accounts.account_identifier`.

The regex is now `(?:\d{3,6}|[A-Za-z][A-Za-z0-9 &.'\-]{1,49})` — digits-first (preserves existing card/savings behavior as a hot path) or text starting with a letter (2-50 chars). The matcher (`sms-template-matcher.ts`) now branches at extraction time: all-digits → `parsed.cardLast4` as before; otherwise → new `parsed.accountNickname` field on `ParsedSMS`, and `cardLast4` stays null.

`linkExpenseToAccount` (`financial-account.ts`) extended to accept an optional `accountNickname` argument. Falls through to an exact-string match on `account_label` (case-insensitive, trimmed) within the same `bank_name` when `cardLast4` doesn't find a match. Tiebreak for same-label rows: `account_type='wallet'` first, then `is_active=1`, then oldest `created_at`. Six call sites in `sms-to-expense.ts` now thread `parsed.accountNickname` through. **No auto-create** on nickname match — wallets still need to be manually created first; template just plays matchmaker.

**2. Preview no longer goes blank when any field is mis-tagged.**

Previously `previewFields` in `app/settings/sms-templates/tag.tsx` returned `compiled.extracted` only when `compiled.ok` — so any one field failing round-trip validation (e.g. tagging "Hi" as Amount) wiped the preview for every correctly-tagged field. Users lost all visual anchor on what they'd already tagged.

Fix: `previewFields` now derives directly from the span offsets (`smsBody.slice(s.start, s.end)`). Compile errors still show in the red warning card, but each field row keeps showing its tagged substring so the user can see which field is problematic and untag just that one.

**3. Per-field format helper on the tagger screen.**

New tap-to-expand info icon on every field row in `tag.tsx`. Collapsed by default; when tapped, shows a two-line helper: (a) what the field accepts, (b) concrete examples. Table of help copy lives in `FIELD_FORMAT_HELP` — kept in sync with `FIELD_REGEX` in the compiler. Gives users an on-screen answer to "what should I tag here?" without needing to read docs.

**Files touched:**
- `services/sms/template-compiler.ts` — `FIELD_REGEX.account` regex change.
- `services/sms/bank-patterns.ts` — new `accountNickname` field on `ParsedSMS`.
- `services/public-data/sms-template-matcher.ts` — split digit/text branches, populate one or the other.
- `services/financial-account.ts` — `linkExpenseToAccount` extended with nickname fallback + tiebreak.
- `services/sms/sms-to-expense.ts` — six call sites thread `accountNickname` through.
- `app/settings/sms-templates/tag.tsx` — preview fix, `FIELD_FORMAT_HELP` copy, per-row info icon.
- `app.json` — 15.9.3 → 15.10.0.

**Testing:**
- TS clean on source files.
- Full test suite expected green (no changes to logic tested by existing suites).

**Version bump:** MINOR — 1 meaningful new capability (wallet SMS templates), bundled with 2 UX fixes.


### 15.9.3 session additions — Save backup to phone (SAF) + stable signing keystore

**Feature — "Save to Phone" button in Backup & Restore.**

Previously backup had only "Save / Share" which opens the system share sheet. Now a second path: a proper Android file-picker (Storage Access Framework, SAF) lets the user drop the `.artha` file directly into Downloads (pre-seeded) or any folder they pick. The `.artha` file shows up in Files / Google Files / My Files and can be restored later via the existing Restore flow — same format, round trips unchanged.

Post-save-alert now shows 3 buttons on Android: `Later` · `Save to Phone` · `Share...` (iOS only gets the 2, since SAF doesn't exist there). Success panel mirrors the same buttons.

Implementation: `services/backup.ts:saveBackupToStorage(filePath)` wraps `StorageAccessFramework.requestDirectoryPermissionsAsync` + `createFileAsync` + `writeAsStringAsync`. Pre-seeds the picker URI to `content://com.android.externalstorage.documents/document/primary:Download`. Cache copy is deleted after a successful save so the authoritative file is at the user-chosen location.

**Infra — stable local signing keystore (`bin/artha-release.keystore`).**

v15.9.1 was signed by EAS Build's per-run ephemeral keystore (cert DN was blank; private key deleted with the scratch dir). v15.9.2 built via the direct-Gradle wrapper got the Android-stock debug cert instead — Android refused the update because cert fingerprints didn't match. User had to back up → uninstall → install v15.9.2 → restore to land that release.

Fix: generated `bin/artha-release.keystore` (25-year RSA 2048, alias `artha`, store/key password `artha-local`). Wired into `android/app/build.gradle` via `signingConfigs.release`. Every release APK from v15.9.3 onwards shares cert SHA-256 `9B:8B:80:23:97:81:80:5A:EF:B2:10:64:96:36:02:70:CC:C0:F8:67:4B:0F:12:18:52:D6:FF:6B:9A:CF:A5:C4`. Future builds are update-compatible — no more uninstall-to-update pain.

Committing a signing keystore to a public repo is acceptable for a solo-dev personal app (the public cert ships with every APK regardless). Losing the keystore would be the catastrophe; committing it is the insurance.

**Files touched:**
- `services/backup.ts` — new `saveBackupToStorage` function + SAF import.
- `app/settings/backup-restore.tsx` — 3-button alert + new Save-to-Phone button in success panel.
- `bin/artha-release.keystore` (new) — committed keystore.
- `android/app/build.gradle` — `signingConfigs.release` + `buildTypes.release` now point at stable keystore.
- `bin/build-apk.sh` — versionCode + versionName injection from app.json (landed in v15.9.2, ensures future builds have correct versions).
- `app.json` — 15.9.2 → 15.9.3.

**Testing:**
- TS clean on source files.
- Existing backup/restore tests still green (behavior unchanged for existing paths).


### 15.9.2 session additions — shared-CC pool staleness + direct-Gradle build wrapper

**Bug fix — Credit Cards page blind to cross-month pool staleness.**

After v15.9.1 landed the date-wins pool-aggregation fix, a second shared-CC bug surfaced on 2026-05-01 (HDFC 8957 + 9628): the Account Detail page for each sibling correctly showed the Pool Balance as **stale** (via `BalanceSourceCard`'s "New activity recorded after the last balance SMS" banner), but the Credit Cards reconciliation page showed the same pool as **fresh**.

Root cause: two different staleness checks.
- `services/balance-source.ts` (used by Account Detail) runs SQL with **no date range** — any expense/credit/transfer ever recorded after the pool's freshest balance SMS flags it stale.
- `app/reconciliation/credit-cards.tsx` (pre-v15.9.2) used `getAccountLatestStaleCheckDates` scoped to the **currently-selected month's range**. On May 1, that only covered May activity — it was blind to any April 29–30 ledger event that happened between the freshest April 28 SMS and month-end. Same cross-month pattern for any first-of-month moment.

Fix (Option B from the investigation): Credit Cards now calls `getBalanceSourceInfo(anchorId)` once per bank group (anchored on any sibling; pool logic is bank-scoped internally) and takes its `isStale` flag as the pool's staleness. Single source of truth — Account Detail and Credit Cards can no longer drift.

`services/home-preload.ts`'s `loadCreditCardsSection` got the same rewrite so the first-paint preload of the Credit Cards screen also carries correct staleness. The preload shape changed: `staleDates: Record<string, string>` → `poolStaleByBank: Record<string, boolean>`. The sibling savings/wallet preload (different screens, different semantics) kept the old per-account `getAccountLatestStaleCheckDates` flow untouched.

Cost: N extra SQL calls per Credit Cards render, where N = number of distinct bank groups (typically 1-4). Well under 50ms on-device.

**Build infra — direct-Gradle wrapper at `bin/build-apk.sh`.**

v15.9.1's ccache + Gradle-cache experiment proved that `eas build --local` makes both caches useless (UUID-scoped scratch dir per run defeats both). The wrapper runs `./gradlew assembleRelease` in the persistent `android/` directory and copies the APK to `./build-<timestamp>.apk` (matches the old EAS convention so `gh release upload ./build-*.apk` keeps working). First build populates caches normally; rebuilds get 60-70% faster with both caches warm.

See the "Build APK Command" section for invocation. Retained the EAS command as a documented fallback.

**Files touched:**
- `app/reconciliation/credit-cards.tsx` — swap month-scoped staleness map for per-pool `getBalanceSourceInfo`
- `services/home-preload.ts` — mirror the change in `loadCreditCardsSection`
- `bin/build-apk.sh` (new) — direct-Gradle release wrapper
- `CLAUDE.md` — Build & DevOps section rewritten to lead with the wrapper
- `app.json` — 15.9.1 → 15.9.2

**Testing:**
- TS clean on source files.
- Full suite: 1207/1207 green (no changes to test code required this release).


### 15.9.1 session additions — shared-CC pool balance fix + build-perf retrospective

**Bug fix — phantom "Untracked Spend" on shared-limit credit cards.**

Symptom user saw on 2026-05-01: two CCs in the same shared-limit pool (HDFC, cards 2445 + 8920). Each card's **Account Detail** page showed Auto-detected = Calculated (correctly). But the **Credit Cards** reconciliation page (pool roll-up) showed the two numbers diverging by a few ₹ thousand, with a "`₹X untracked spend`" label — implying money had vanished. Nothing was actually lost.

**Root cause:** Two different pool-aggregation formulas. `services/balance-source.ts:93-102` (used by account-detail) picks the **latest-dated** sibling's SMS as authoritative. `app/reconciliation/credit-cards.tsx:136-146` (used by the Credit Cards screen) took **min balance** from one sibling paired with **max date** from another — mixing a stale sibling's number with a fresh sibling's date.

For shared-limit pools, each sibling's SMS reports **the same pool remaining** (both cards carry the same shared-limit number). So min-wins across siblings = picking the oldest snapshot even when a newer SMS from the other card has already reported an updated pool remaining. The reconciliation page would then compare this phantom-stale pool number against the ledger-calculated pool remaining, get a non-zero diff, and label it "untracked spend".

**Fix:** `credit-cards.tsx:136-146` now uses date-wins just like `balance-source.ts`. Both `autoDetectedAvailable` and `autoDetectedDate` come from the **same** sibling (the one with the freshest balance SMS). Account-detail and Credit-Cards screens now agree.

No other file replicates the min-wins pattern (checked `services/home-preload.ts` — it just delegates to the same helpers). Home tab was unaffected because it doesn't do a pool roll-up in that file.

**Build-perf retrospective (no user-facing change, docs only):**

v15.9.0 tried bumping Gradle heap to 6GB + enabling `org.gradle.caching`, `configureondemand`, `daemon`. Measured one build: **10:54 vs baseline 6:44 — 4 minutes SLOWER.** Root cause: EAS Build `--local` creates a UUID-scoped scratch directory per run (`/var/folders/.../eas-build-local-nodejs/<uuid>/build/android/`); the Gradle build cache lives in `./build/` which is wiped every build. Daemon dies with the scratch dir. Only `ccache` (via `~/.gradle/init.d/ccache.gradle`, user-global cache in `~/Library/Caches/ccache`) survives scratch-dir wipes and gives real savings on the native C++ compile phase after the first cache-populating build.

Reverted `android/gradle.properties` to the baseline (`-Xmx2048m`, `parallel=true` only). Left a comment explaining why. Kept the ccache init script — it's user-global and doesn't live in this repo.

**Files touched:**
- `app/reconciliation/credit-cards.tsx` — pool auto-detect fix
- `android/gradle.properties` — revert + explanation comment
- `app.json` — 15.9.0 → 15.9.1

**Testing:**
- TS clean on source files (pre-existing `backup.ts` AES noise unchanged).
- Full suite: 1207/1207 green.


### 15.9.0 session additions — locale preferences

New user-configurable display preferences (cosmetic only; true multi-currency with FX conversion remains deferred to v16.0.0).

**What users see:**
- New **Settings → Preferences → Region** screen with three pickers:
  - **Currency** — 30 options + "None (no symbol)". Full-screen picker with search by code/name/symbol. Covers South Asia (INR, PKR, BDT, LKR, NPR), North America (USD, CAD, MXN), Europe (EUR, GBP, CHF, SEK, NOK, DKK, PLN), Middle East (AED, SAR, QAR), East/SE Asia (JPY, CNY, SGD, HKD, KRW, MYR, THB, IDR, PHP, VND), Oceania (AUD, NZD).
  - **Number format** — Indian (1,23,456), Western (12,345,678), None (no separators).
  - **Date format** — DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MMM-YYYY.
- Onboarding's `(onboarding)/region.tsx` now also asks these three on first run. Picking a currency auto-applies its default number format; users can override afterwards.
- Live sample on every row so users see exactly what their app will look like.

**Architecture:**
- `constants/currencies.ts` — currency catalog (30 + NONE) with code/symbol/decimals/defaultGrouping/displayName.
- `services/locale-preferences.ts` — MMKV-backed prefs with in-memory cache; keys `locale_currency`, `locale_number_grouping`, `locale_date_format`. Writes invalidate cache.
- `utils/format.ts` — `formatAmount` rewritten to read prefs. Applies grouping manually (supports Indian/Western/None). `formatAmountPreview(amount, currency, grouping)` for pure picker rendering without touching storage.
- `utils/date.ts` — new `formatDate(iso)`/`formatDateWith(iso, format)`/`todayIso()`/`formatMonthLabel(ym, style)`. Legacy `formatDisplayDate` kept for back-compat.
- `utils/expense-validation.ts` — `formatDateForDisplay` now delegates to the locale-aware `formatDate` for non-Today/Yesterday dates. Today/Yesterday shortcuts preserved.
- `utils/course-correction.ts` — removed local `formatRs` helper; uses canonical `formatAmount`. Cleans up the `₹` vs `₹` inconsistency the audit flagged.

**Deliberately NOT done (documented gaps):**
- **Preferences are device-local — NOT backed up.** Consistent with the biometric-lock pattern (backup file is portable; user re-picks on new device). This is the same reason `fiscal_year_start_month` isn't backed up either.
- **Per-transaction currency / FX conversion** — still deferred to v16.0.0 (requires schema change + historical FX rates).
- **Account-ledger `ScrollView → FlatList`** — still deferred (v14.8.0 note stands; separate release).

**Follow-up refinements (same release):**
- **Currency picker overlay opacity** — the overlay used invalid `bg-background-*` tailwind classes (undefined in `tailwind.config.js`), rendering transparent. Fixed with valid surface classes + explicit `style={{ backgroundColor: colors.background }}` fallback + proper top inset (`pt-12`).
- **"SMS Expense Detection" → "SMS Detection"** + Duplicate Detection card merged into SMS Detection as a sub-section (since duplicates are mostly SMS-driven). iOS still gets a dedicated Duplicate Detection card since SMS isn't available.
- **Onboarding currency picker** reworked from horizontal scroll to searchable dropdown (matches the Settings → Region UX). Full-screen overlay with search-by-code/name/symbol.
- **Settings tab card reorg** — merged **Notifications + Appearance + Region** into a single **Preferences** card. Fiscal Year moved into the Region screen (one place for everything locale-related).
- **"Built with" About row removed** — implementation detail, not user-facing.
- **Hisaab PDF/Excel exports honor locale** — previously hardcoded `₹` prefix + hand-rolled Indian grouping in `formatNum`. Now use canonical `formatNumber` + `currencyPrefix()` helpers that read MMKV. Excel date cells also go through `formatDate` now instead of raw ISO strings.

**Testing:**
- Updated `__tests__/unit/expense-validation.test.ts` — `formatDateForDisplay` default is now `DD/MM/YYYY` (`15/01/2026` instead of `15 Jan 2026`).
- Full suite: **1207/1207 green**. Zero new TS errors (pre-existing `backup.ts` AES noise unchanged).
- FK-sensitive integration tests (expense, hisaab, backup) all pass.

**Files touched:**
- New: `constants/currencies.ts`, `services/locale-preferences.ts`, `app/settings/region.tsx`
- Modified: `app.json`, `utils/format.ts`, `utils/date.ts`, `utils/expense-validation.ts`, `utils/course-correction.ts`, `app/(tabs)/settings.tsx`, `app/settings/_layout.tsx`, `app/(onboarding)/region.tsx`, `services/hisaab-export-pdf.ts`, `services/hisaab-export-excel.ts`, `__tests__/unit/expense-validation.test.ts`

### 15.8.2 session additions — Settings kitchen-sink split

UI-only patch: the `Settings → Data & Import` card (10 rows mixing master data, automation, config, and import) was too heavy to scan. Split into three semantically coherent cards:

- **Master Data** — Categories, Payment Modes, Accounts, Tags. The reference data that expenses/budgets attach to.
- **Automation** — Reminders, Smart Rules, Smart SMS Templates, Merchant Aliases. Things Artha does for you on its own.
- **Import & Config** — Budget Configuration, Import from Excel. One-off setup flows.

Same 10 rows, same routes, same order within each group. Pure visual reorg. Zero behavior change, zero new screens.

### 15.8.1 session additions — product audit cleanup

Bundled hygiene release driven by a full product audit. Takes the 15.8.0 work (post-save nav + Expenses filter rework) and layers on top:

**UI blockers from the audit:**
- **Savings Advisor card hidden** — Home card `router.push("/advisor")` was leading to a "Coming Soon" stub. Now gated by `v15_advisor_card: false` (new feature flag). Card reappears when the feature ships.
- **Reconcile Statements card hidden** — Home card moved behind `v15_reconcile_card: false`. Still reachable via deep-link/settings when users need it; just not Home-promoted. Historical V3 product docs (PRD_V3.md, MASTER_PLAN_V3.md) reference these cards — left untouched (they're archival "what we shipped" records).
- **`app/summary/[month].tsx` double-padding fixed** — the screen was using `<ScreenContainer>` (default `padTop=true`) *and* rendering a hand-rolled in-body header *and* the layout had `headerShown: false`. Now uses the Stack header with dynamic title (`<Stack.Screen options={{ title: monthLabel }} />`), `padTop={false}`, and the in-body header + custom back button are gone.

**Terminology normalization (pick one word):**
- Concept that was called "Recurring Expenses" (Settings), "Reminders" (Home), "Recurring" (recycle-bin filter), "Make Recurring" (expense detail action) is now consistently **"Reminders"** user-facing.
- Settings row: "Recurring Expenses" → "Reminders".
- Stack title for `/settings/recurring-rules`: "Recurring Expenses" → "Reminders".
- Expense detail action: "Make recurring" → "Set reminder"; "Stop recurring" → "Stop reminder"; subtitle updated.
- Recycle-bin "Recurring" filter kept — that filter targets a different feature (auto-detected recurring transaction patterns via `recurring-detector` service), not the manual reminder rules. Preserving the distinction.
- Code identifiers (`recurring_rule_id` column, `recurring-rules.tsx` filename) left alone — internal-only, renaming them is a separate refactor.

**Migration 020 — three partial indexes for perf headroom:**
- `idx_expenses_user_rightspend` — speeds up the v15.8.0 Avoidability filter.
- `idx_expenses_refund_live` — covers the v15.8.0 Refund-status subquery fully (old index covered the column alone).
- `idx_account_transfers_live_date` — covers the hot `deleted_at IS NULL AND date >= ?` pattern used by `financial-account.ts` + `account-balance.ts`.

**Performance:**
- **Expenses tab search debounced 300ms.** Typing was triggering `getExpensesPaginated + getFilteredExpenseSummary + getPreviousPeriodTotal + getTagsForExpenses + sumRefundsByExpenseIds` (5 queries) on every keystroke via `useFocusEffect`'s dep-change replay. New hook `hooks/use-debounced-value.ts`; TextInput still updates instantly, only the filter object reads the debounced value.
- **Budget rolling-surplus loop replaced with aggregate queries.** Was `for each month since FY start → Promise.all([getBudgetsForMonth, getExpenseTotal])` — 2×N serial queries (24 in March). New batched helpers `getMonthlyExpenseTotals` (`GROUP BY SUBSTR(date,1,7)`) + `getMonthlyBudgetTotals` return `Map<"YYYY-MM", total>` in one query each; the tab does an in-memory per-month diff.
- **Cold-start seeds parallelized** in `app/_layout.tsx`. Was 5 sequential awaits (cleanup → seedCategories → seedPaymentModes → seedPublicData → migrateExistingUser → setupNotificationChannel). Now `Promise.all` after `initDatabase`. ~150-300ms faster splash dismiss.
- **Home components memoized.** `CreditCardDashboard`, `BankBalanceSummary`, `WalletSummary`, `MinBalanceAlert`, `DematSummaryCard` now wrapped in `React.memo`. Parent Home re-renders (on search typing, min-balance ack, etc.) no longer cascade into these when their props are stable.

**Code quality:**
- **MMKV instances centralized.** 8 scattered `new MMKV({ id: "artha-settings" })` calls → single `services/storage.ts` module exporting `settingsStorage`, `duplicateDismissalsStorage`, `minBalanceAcksStorage`. Same MMKV singletons at the native layer, but code ownership is now single-source-of-truth — a typo can no longer silently split writes into a different namespace.
- **`formatAmount` consolidated (13 duplicates → 1).** All local `function formatAmount(n) { return \`₹${Math.round(n).toLocaleString("en-IN")}\`; }` copies replaced with `import { formatAmount } from "@/utils/format"`. Covers analytics components (ActionSuggestionCard, AmountChangeCard, DrillGroupRow, ForecastBreakdown, LearningNudge, MonthlyReviewCard, PatternBreakCard, PatternEditSheet), insights screens (index, forecast, patterns, insight-detail), and `services/notification-scheduler.ts`. `formatCompact` left alone (local copies have `₹` prefix; canonical doesn't).
- **`formatDate` consolidated (9 → 2 canonical).** Added `toIsoDate(d: Date): "YYYY-MM-DD"` + `formatDisplayDate(input: string | Date): "5 Jan 2026"` to `utils/date.ts`. Swapped: `app/goals/yoy-comparison.tsx`, `services/savings-tracker.ts`, `services/excel-import.ts`, `utils/financial-cockpit.ts`, `components/analytics/LearningNudge.tsx`, `components/expense/ExpenseMetadata.tsx`, `app/(tabs)/settings.tsx`, `app/insights/compare.tsx`. `services/hisaab-export-pdf.ts` kept its local `formatDate` — uses `day: "2-digit"` for column-aligned PDF output (intentionally divergent).
- **Dead code deleted.** `services/seed-data.ts` (zero callers), `utils/analytics/drill-helpers.ts` (zero), `utils/analytics/text-templates.ts` (zero). Functions removed: `cleanupStaleForecasts`, `effectiveAmountSqlSplitAware`, `getMultiSplits`. Barrels updated (`services/index.ts`, `services/expense.ts`, `utils/analytics/index.ts`).
- **Migration 001 cleanup.** `CREATE TABLE sms_rules` block removed — it was created only to be dropped by migration 006. Fresh installs now skip the pointless create. Migration 006 kept (still runs on older installs; `DROP TABLE IF EXISTS` makes it a no-op on fresh).
- **31 unused imports cleared** via a targeted sweep across 25 files. Remaining 53 unused-locals warnings are unused function parameters + destructured fields — deferred (human judgment needed).

**What this release does NOT do (explicitly deferred):**
- Account-ledger `ScrollView → FlatList` rewrite. CLAUDE.md v14.8.0 marked this as "high-risk; separate release" — still true; own PR.
- `noUnusedLocals`/`noUnusedParameters` tsconfig flip. 53 remaining warnings need human triage; flipping would break CI.
- Add-Expense custom header `font-semibold` → `font-bold` (pre-existing design-system drift, not introduced here).

**Files touched (35):** `app.json`, `CLAUDE.md`, `app/(tabs)/{index,budget,expenses,settings}.tsx`, `app/_layout.tsx`, `app/expense/{add,[id]}.tsx`, `app/settings/{_layout,recurring-rules,recycle-bin}.tsx`, `app/summary/{_layout,[month]}.tsx`, `app/insights/compare.tsx`, `app/goals/yoy-comparison.tsx`, `components/analytics/*.tsx` (11 files), `components/expense/ExpenseMetadata.tsx`, `components/home/*.tsx` (5 files), `components/ui/CollapsibleSection.tsx`, `database/migrations/{001,index,020-new}`, `hooks/use-debounced-value.ts` (new), `services/{budget,expense-effective-amount,expense-multi-split,expense-queries,expense-types,expense,feature-flags,min-balance,notifications,notification-scheduler,settings,storage-new,biometric-lock,duplicate-detection,data-cleanup,sms/sms-permissions,index}`, `utils/{analytics/index,date,financial-cockpit}`.

### 15.8.0 session additions — post-save nav + Expenses tab filter rework

Small stabilization pass that fixes a confusing post-save navigation on the Duplicate / Refund flows and rethinks the Expenses tab filter set.

**Bug fix — "I just saved, why am I on the old expense?":**
- Duplicate (`/expense/[id]` → Duplicate → `/expense/add?copyFromExpenseId=…`) used to `router.back()` on save, landing the user on the source expense's detail screen. They just created a NEW expense but saw the OLD one — jarring. Now `router.dismissAll()` + `router.replace("/(tabs)/expenses")` so they land on the list with their new row visible.
- Record-a-Refund (`/expense/[id]` → Record a Refund → `/expense/add?type=refund&linkExpenseId=…`) got the same treatment — and additionally passes `preset=refunded` so the list opens pre-filtered to Refunded expenses with the filter panel expanded (transparency: the user should see why the list looks narrowed).
- Regular Add flows (FAB, reminder-fulfillment, onboarding) unchanged — `router.back()` still correct for those.
- Implementation: new `navigateAfterSave` helper in `app/expense/add.tsx` that branches on `copyFromExpenseId` / `isRefund` / else.

**Expenses tab filter rework:**
- **Removed** the Status filter chips (All / Approved / Pending / Rejected). Rationale: users who want pending-review items have a dedicated Review Queue; the list default (`status != 'rejected'`) is what ~everyone wants. Server-side default stays, so rejected expenses remain hidden regardless.
- **Added** Refund-status filter (All / Refunded / Not refunded). Implemented as a subquery against `expenses.refund_of_expense_id` on the credit side — "refunded = has at least one non-deleted credit pointing at it". Gated to `nature='realized'`; credits can't themselves be refunded.
- **Added** Avoidability filter (All / Unavoidable / Avoidable). Maps to `is_right_spend = 1 | 0`. Also gated to `nature='realized'` (credits don't have avoidability).
- Both new filters live inside the collapsible filter panel (`showFilters` gate), next to Category/Payment Mode/Account/Tags.
- `ExpenseFilters` type extended with `refundedStatus?: "refunded" | "not_refunded"` + `avoidability?: "avoidable" | "unavoidable"`. `status` field retained on the interface (Review Queue and other screens still use it) — just no longer wired from the tab.
- `getExpensesPaginated` + `getFilteredExpenseSummary` + (via delegation) `getPreviousPeriodTotal` all inherit the new predicates.
- Preset seeding: the tab reads `useLocalSearchParams().preset`; if `"refunded"`, it sets `filterNature="realized"`, `filterRefundedStatus="refunded"`, `showFilters=true` once (guarded by a ref so later focus-refresh doesn't re-apply).

**Files touched:**
- `app/expense/add.tsx` — `navigateAfterSave` helper, both save paths updated.
- `app/(tabs)/expenses.tsx` — state rename, preset handler, Status chips removed, two new chip rows added, `clearFilters` + `hasNonDateFilters` updated.
- `services/expense-types.ts` — `ExpenseFilters` extended.
- `services/expense-queries.ts` — predicate logic in both `getExpensesPaginated` + `getFilteredExpenseSummary`.
- `app.json` — bump 15.7.0 → 15.8.0.

**No migration needed** — the two new filters read from existing columns (`is_right_spend`, `refund_of_expense_id`).

### 15.5.0 — User SMS template tagger + savings min-balance alert

Two orthogonal features bundled in one release. Both flag-gated, both additive.

**Feature 1: Smart SMS Templates (user-authored)**
- Settings → Smart SMS Templates. User pastes an unrecognised bank SMS, taps tokens to assign them to fields (amount/account/merchant/date/balance/ref), picks tx type + bank, saves.
- Also lists last 30 days of `pending_sms` rows that never became expenses — "Browse unrecognised SMS (N)" — each with a "Teach this" button that pre-fills the paste screen.
- Template compiler (`services/sms/template-compiler.ts`, 20 tests) turns tagged spans into a regex with named capture groups. Whitespace in anchors collapsed to `\s+`, tail truncated to 20 chars for resilience, round-trip validated against the sample.
- Stored in existing `sms_template_patterns` table extended by migration 018 with `source`/`user_id`/`sample_sms`/`created_from_sms_id`. User rows travel with backup automatically.
- Matcher (`services/public-data/sms-template-matcher.ts`) now returns ORDER BY system-first-then-user, ensuring built-in parsers always win. User rows tagged `confidence: 0.5` vs 0.7 for system.
- Screens: `app/settings/sms-templates/{index,new,tag,[id],unrecognised}.tsx` + shared `template-draft-store` + `TokenTagger` component.
- Flag: `v15_user_sms_templates`.

**Feature 2: Savings min-balance alert**
- Each savings account gets a `min_balance` column (migration 019, default 0 = off).
- Settings → Accounts → [savings account] → "Minimum Balance Alert" card — user sets rupee threshold.
- When computed closing balance drops below, Home shows a red dismissable card with shortfall amount. Tap card → account ledger. Tap Dismiss → ack for current month only (MMKV, device-local, per-month).
- Pure detector (`services/min-balance.ts`, 16 tests) — reads existing `computedBalanceMap` the Home already loads; no new DB roundtrips.
- `components/home/MinBalanceAlert.tsx` renders above budget ring, below stale-backup warning. One card per breached account.
- Flag: `v15_min_balance_alert`.

**Help docs:** new `assets/docs/articles/smart-sms-templates.md` + `min-balance-alert.md`. Cross-links added to `sms-detection.md` + `getting-started.md`. `index.json` regenerated (21 articles).

**Tests:** 1207 pass / 0 fail (+36 new).
**TS:** clean (pre-existing `backup.ts` AES noise unchanged).

### 15.2.0 session additions — biometric app lock + smart rules

Two quality-of-life features requested by the user. Multi-currency (also requested) was explicitly deferred to v16.0.0 because it's a cross-cutting data-model change that can't be safely bundled with smaller features.

**Biometric app lock (opt-in per device):**
- New `services/biometric-lock.ts` — MMKV-backed settings + `shouldShowLock()` decision tree + `promptUnlock()` wrapping `expo-local-authentication`
- New `app/(lock)/lock.tsx` — auto-prompts biometric on mount, `router.replace('/(tabs)')` on success
- `app/_layout.tsx` gates every cold start + every AppState `active` transition through `shouldShowLock()` → lock screen
- New `app/settings/security.tsx` — toggle, timeout picker (Immediate / 1m / 5m / 15m / Never), "Lock Now" button. Turning lock OFF also requires biometric — prevents casual bypass from inside an unlocked session.
- Timeout options: Immediately / 1 min / 5 min / 15 min / Never. "Never" still locks on cold start.
- Lock prefs stored in MMKV — intentionally NOT part of backup file (security + portability; user re-enables on new device).
- Fallback to device passcode always enabled so biometric-only-failures never brick access.
- 22 unit tests in `__tests__/unit/biometric-lock.test.ts` with mocked `expo-local-authentication`.

**Smart rules (auto-categorize):**
- Migration **017** — new `smart_rules` table + `expenses.applied_rule_id` plain column (not a real FK; same pattern as `recurring_rule_id` / `fulfills_rule_id`).
- New `services/smart-rules.ts` — pure `evaluateRule` / `findFirstMatch` / `materialize` evaluator (unit-testable without DB), CRUD, `applyRules` hot-path helper, retroactive apply (preview + run).
- Conditions (AND semantics): merchant contains, merchant regex, min/max amount, account id, payment mode, SMS keyword. At least one required.
- Actions: set category, set payment mode, add tags, override is_right_spend, auto-approve from review queue (default **OFF** per user spec).
- Wired into both `createExpense` (manual add) and `sms-to-expense.ts` realize path. Rule never stomps user-set fields — only fills blanks.
- Retroactive apply: 90-day window, shows preview counts (matching / wouldOverwrite / wouldSkip) before confirming. Runs in single transaction. Idempotent — skips already-categorized unless user opts in.
- `expenses.applied_rule_id` stamped for audit; expense detail shows "Categorized by rule: <name>" badge that links back to the rule.
- Rule deletion clears `applied_rule_id` stamps but never un-applies past categorizations (user's historical truth).
- `smart_rules` added to `BACKUP_TABLES` — rules survive device migration.
- 22 evaluator unit tests in `__tests__/unit/smart-rules-evaluator.test.ts` (pure functions, no DB mocks).

**New files:** `services/biometric-lock.ts`, `services/smart-rules.ts`, `app/(lock)/_layout.tsx`, `app/(lock)/lock.tsx`, `app/settings/security.tsx`, `app/settings/smart-rules/index.tsx`, `app/settings/smart-rules/[id].tsx`, `database/migrations/017_smart_rules.ts`, `docs/V15/PRD_V15_2.md`, `docs/V15/TDD_V15_2.md`, `docs/V15/MASTER_PLAN_V15_2.md`, `__tests__/unit/biometric-lock.test.ts`, `__tests__/unit/smart-rules-evaluator.test.ts`.

**Modified files:** `services/expense-crud.ts` (rule application in createExpense), `services/sms/sms-to-expense.ts` (rule application + auto-approve bypass in realize path), `services/expense-types.ts` (Expense.applied_rule_id), `services/feature-flags.ts` (`v15_biometric_lock`, `v15_smart_rules`), `services/backup.ts` (BACKUP_TABLES), `database/TABLE_SCHEMAS.ts` (smart_rules table + applied_rule_id column), `database/migrations/index.ts`, `app/_layout.tsx` (lock gate), `app/(tabs)/settings.tsx` (new rows), `app/settings/_layout.tsx` (new screens), `app/expense/[id].tsx` (applied-rule badge), `package.json` (+expo-local-authentication). Plus `__tests__/integration/database.test.ts` and `__tests__/integration/expense.test.ts` updated for migration 017 counts + new INSERT param.

**Flags:** `V15_FLAGS.v15_biometric_lock: true`, `V15_FLAGS.v15_smart_rules: true`. Both flippable-off as rollback.

**Tests:** 44 new tests. Full suite **1151 pass / 0 fail**. Zero new TypeScript errors.

**Pending:** Full build pipeline (commit → push → release → APK → upload) awaiting user "build".

### 15.1.0 session additions — PSU bank SMS parsing (v15 Phase 2d completion)

**Background:** v15.0.0 shipped migration 015 + MCC/IFSC/merchant-brand bundles + onboarding + help center, but the two SMS bundles (`sms-senders.json`, `sms-templates.json`) were never curated — leaving 11 Indian PSU banks with no parsing coverage. This session closes that gap.

**What shipped:**
- **11 PSU banks now parse SMS out of the box** — PNB, Canara, BOB, Union Bank of India, Indian Bank, Central Bank of India, IOB, UCO, Bank of India, Bank of Maharashtra, Punjab & Sind Bank. Coverage includes debit / credit / UPI / NEFT / IMPS / cash deposit / ATM / BOBCARD (credit card) / reminder hints.
- **New `assets/data/sms-senders.json`** — 82 sender codes across 11 PSU + major private + small finance + wallet banks.
- **New `assets/data/sms-templates.json`** — 56 regex templates with named capture groups (`amount`, `account`, `merchant`, `ref`, `balance`, `dueDate`). Each scoped to a bank; `__generic__` templates handle cross-bank extractors + reminder hints.
- **New `services/public-data/sms-template-matcher.ts`** — `tryTemplateMatch(body, senderAddress)`. Resolves sender to bank via hardcoded + `sms_sender_registry`; pulls bank-scoped templates from `sms_template_patterns` (priority ASC); runs regex with `i` flag; returns `ParsedSMS` with confidence 0.7.
- **Wired into `services/sms/sms-parser.ts`** — fires ONLY when hardcoded `parseBankSMS()` returns null AND `isBankSender(address)` AND `V15_FLAGS.v15_sms_template_fallback`. Zero regression surface for the 14 banks already covered.
- **Bug fix — `INDBNK` sender-ID collision.** `bank-senders.ts` previously mapped `INDBNK` to IndusInd Bank, but `INDBNK` is **Indian Bank** (PSU). Real IndusInd DLT codes are `INDUSB` / `INDSIN` / `INDBKL` — now in the allowlist. Cleanest remapping, no compatibility shim needed.
- **Flags flipped ON:** `v15_sms_template_fallback` (enables DB template fallback) and `v15_ifsc_bank_resolver` (enables IFSC → bank lookup via already-seeded registry).
- **All 5 data bundles aligned to version `2026-04-29`** for seed idempotency.

**Research:** patterns derived from real SMS samples collected on Sourav's own devices and public bank SMS format documentation. No third-party parser code incorporated.

**Tests:** 46 new fixture tests in `__tests__/unit/psu-sms-templates.test.ts` — per-bank positive cases + cross-bank false-positive isolation + bundle sanity. Full suite: **1107 pass, 0 fail**.

**TS:** Zero new non-test TypeScript errors. Pre-existing `services/backup.ts` AES type noise unchanged.

**Docs:** `docs/V15/PRD_V15.md`, `TDD_V15.md`, `MASTER_PLAN_V15.md` created per CLAUDE.md version convention.

**Pending:** Full build pipeline (commit → push → release → APK → upload) awaiting user "build".

### 14.8.0 session additions — stabilization sweep (cleanup + UI + guardrails + perf)

Bundled audit remediation — shipped in one release rather than three separate ones.

**Cleanup (dead code & orphan screens):**
- Deleted 6 orphan screens with no entry points: `insights/accounts`, `insights/payment-methods`, `insights/right-spend`, `insights/quick-setup`, `goals/savings-tracker`, `expense/account-expenses`. Their parent `_layout.tsx` stack registrations and `constants/routes.ts` allowlist entries were also removed.
- Deleted 6 orphan components: `cockpit/MoneyWaterfall`, `WaterfallBar`, `HealthScoreRing`, `GoalStrip`, `charts/SavingsGauge`, `expense/ExpenseAccountRow`.
- Deleted 3 orphan utils (and their tests): `budget-recommendations.ts`, `financial-health.ts`, `yearly-plan-calculations.ts` — only referenced by their own tests.
- Deleted dangling wrapper `reverseDematTransferSideEffects` (the `...InTxn` variant is the only live export).
- Cleaned up stale migration-list comments at the top of `database/TABLE_SCHEMAS.ts`.
- `AccountPickerSheet` typed `ACCOUNT_ICONS` as `Record<string, keyof typeof Ionicons.glyphMap>` and dropped `as any`.

**UI (theme-aware palette migration):**
- 7 reconciliation screens migrated from the legacy hardcoded `STATUS_COLORS` to `StatusColors[colorScheme]` (light/dark aware): `account-ledger`, `credit-cards`, `bank-accounts`, `wallets`, `demat-portfolio`, `account-detail`, `goals/balance-sheet`.
- `credit-cards.getUtilColor` now takes the theme palette as a parameter so the helper stays pure while using the right light/dark variant.
- Account-ledger "focused transfer" highlight (from the v14.7.1 cross-link) uses `accent[500] + "33"` (20% alpha) + left border instead of the flat hex so it adapts to the active accent.
- `backup-restore` placeholder text color replaced hardcoded `#6B7280` with `colors.textSecondary`.

**Safety guardrails (prevent cross-link data corruption):**
- **G1:** `updateTransfer` rejects amount/date edits when `demat_target != NULL` — forces delete-and-recreate so linked snapshots/contributions stay consistent.
- **G2:** `deleteInvestmentContribution` clears `account_transfers.linked_contribution_id` / `investment_bucket_id` / `demat_target` stamps FIRST to avoid FK violations (same pattern as the v14.6.0 demat reverse-side-effects fix).
- **G3:** `permanentlyDeleteExpense` also purges `reminder_fulfillments` rows for the expense.
- **G4:** `updateExpense` auto-unfulfills the reminder when the user edits date or amount on a fulfilling expense — the cycle the fulfillment was matched against is no longer valid.
- **G5:** `deleteExpense` captures `purchase_group_id` pre-delete; if ≤1 live leg remains after the soft-delete, the split-tender group is unlinked on the survivor so stale group ghosts don't haunt future UI.
- **G6/G7:** `deleteTransfer` restores a Mark-as-Transfer source expense from the recycle bin when its transfer is deleted (otherwise the user's "Undo" mental model is broken).

**Performance:**
- **Home preload dedup:** new module-level `skipNextHomeLoad` flag prevents `app/(tabs)/index.tsx`'s `loadData` from running immediately after the home preload cache has already painted — avoids a double DB round-trip on cold-start.
- **`getReminders` N+1 → batched:** replaced per-rule source + last-fulfillment lookups with two IN-clause queries + in-memory joins. 20 rules: 40 serial round-trips → 2 parallel.
- **Account-ledger N+1 fixes:** new `getPersonsByIds` batch helper replaces per-row hisaab person fetches; `Promise.all` around `getMonthBalanceSummary` for multiple ledger accounts; dropped duplicate `getActiveAccounts` call (reused `allAccountsForMin`).
- **Weekly net-worth trend:** `getWeeklyNetWorthTrend` batched into 2 parallel queries (portfolio + fund snapshots) instead of serial for-loops per week.
- **Duplicate-group MMKV GC:** `getDismissedDuplicateGroups` now prunes stale keys when it encounters them — no unbounded MMKV growth.
- **Duplicate scan window:** `scanForDuplicates` now scopes to the last 180 days so early users with big histories don't scan the entire dataset on every home load.
- **Migration 016** — partial index `idx_account_transfers_linked_contribution` on `(linked_contribution_id) WHERE linked_contribution_id IS NOT NULL` — speeds up the contribution-delete guardrail (G2) and cross-link lookups.

**Deferred (out of scope for v14.8.0):**
- Account-ledger ScrollView → FlatList rewrite (high-risk; separate release).
- `PatternEditSheet` animation alignment (cosmetic; acceptable).
- xlsx dynamic import (already lazy `require()`; RN bundle is single-chunk so no savings).

### 14.7.1 session additions — cross-link blank-ledger fix + focused-row highlight

**Bug fix.** The v14.7.0 "From transfer · tap to view" link on an investment contribution navigated to the account ledger with only `transferId`, but the ledger requires `accountId` to load anything — so it opened blank.
- `services/yearly-plan.ts` `getInvestmentContributions` now returns `linked_transfer_account_id` and `linked_transfer_date` alongside `linked_transfer_id` (from the existing LEFT JOIN on `account_transfers`).
- `app/goals/investment-detail.tsx` passes all three as URL params.
- `app/reconciliation/account-ledger.tsx` accepts `transferId` and renders a soft accent-tinted background on the matching transfer row so the user's eye lands on it.

### 14.7.0 session additions — reminders, cross-links, demat delete hardening

**Recurring reminders (pivot from v14.6.0 forecasts).** v14.6.0 auto-created forecast expenses with predicted amounts; this polluted the ledger and hisaab because utility/rent amounts aren't fixed. Pivoted to a reminder model:

- **Rules are reminders now**, not forecast templates. They carry a `next_due_date` that advances only when the user confirms a real expense fulfilled the cycle.
- **Home screen Reminders card** shows active rules in `due_soon` / `overdue` state with a "Link" button per row.
- **LinkExpenseSheet** lets the user pick an existing recent same-merchant expense OR tap "Log new expense" to prefill add-expense (`?fulfillsReminderId=…`). Amount stays BLANK so utility-based values get typed fresh each cycle.
- **Expense detail suggestion banner** — for a realized expense not already linked, if it matches a pending reminder by merchant + date window (±7 days), a soft banner offers to link.
- **Fulfilled badge** — when an expense already fulfills a reminder, shows a success-tinted row with Undo. Undo rewinds the rule's `next_due_date`.
- **Advance semantics** — `next_due_date` advances from the CYCLE'S due date, not from today, so consistent late payers don't have their cadence drift.
- **Notification scheduler** — `checkAndNotifyRecurringReminders` fires up to 3 daily notifications for due_soon / overdue reminders (alongside the existing overdue + upcoming checks).
- **Delete cascade** — when a fulfilling expense is soft-deleted (`onFulfillingExpenseDeleted`), the fulfillment is reversed so the reminder's cycle comes back as due.
- **Migration 014** — adds `recurring_expense_rules.next_due_date`, `expenses.fulfills_rule_id`, and a new `reminder_fulfillments` history table. Soft-deletes every un-realized forecast auto-created by v14.6.0 rules (cleaning up the pollution). Clears the legacy `expenses.recurring_rule_id` stamp since it's no longer meaningful.

**Demat delete bug — legacy contribution fallback.** Transfers created before v14.5.0 didn't have the `linked_contribution_id` stamp. When deleted in v14.6.0, the reverse path found `investment_bucket_id` but no contribution id → skipped the contribution delete, leaving the bucket's `current_contributed` untouched. Fallback added: if the stamp is missing but the bucket is set, look up the contribution by `(bucket + amount + date + "Auto from transfer" note)` and delete by PK.

**Investment contribution ↔ source transfer cross-link.** The investment-detail screen now shows a "From transfer · tap to view" link on contributions that came from a demat transfer. Backed by a LEFT JOIN on `account_transfers.linked_contribution_id` in `getInvestmentContributions`.

**Milestone ↔ linked bucket navigation.** Linked bucket rows in the milestone detail are now tappable, navigate to the bucket detail, and show a chevron.

**Duplicate expense (carry-over from 14.6.0).** Unchanged — still works.

### 14.6.0 shipped 2026-04-28 — recurring expenses (forecasts-based) + duplicate action + FK delete fix

- **Recurring expenses (user-explicit).** From any realized expense's detail screen, tap "Make recurring" → sheet picks frequency (weekly/monthly/quarterly/yearly), optional end date, notes. A rule is saved and materializes exactly one forecast at a time. When the user realizes that forecast (Mark Paid / Realize), the next cycle's forecast auto-appears via `onForecastRealized`. Forecasts inherit merchant, amount, category, account, payment mode, description, tags, and split config (single or multi-person) from the source — but are regular expense rows after materialization, so per-cycle edits (different amount, account, tag) are preserved and only NEW cycles read fresh values from the source.
- **Home card "Recurring" tag.** Upcoming Dues rows that came from a rule show a small accent-tinted "Recurring" pill.
- **Settings → Recurring Expenses** screen lists active rules with merchant, amount, frequency, next due, end date. Tap a row → opens the source expense detail. Secondary action on each row to stop the rule.
- **Stop recurring.** Soft-deletes the rule (`is_active = 0`); existing materialized forecasts stay (user can delete them individually). No undo — re-tapping "Make recurring" on the source expense starts fresh.
- **Delete source expense.** Auto-stops the rule (`onSourceExpenseDeleted` hook in `deleteExpense`). Permanent-delete cascades to the rule row via the FK and also clears `recurring_rule_id` stamps on any orphaned forecasts.
- **Delete materialized forecast.** Skips that cycle; the next materialization moves forward as normal (no re-creation of the deleted row).

**Duplicate expense.** New "Duplicate" action on every realized expense detail → opens `add-expense` prefilled with merchant, amount, category, account, payment mode, description, is_right_spend. Date defaults to today. Split config and tags are NOT copied in v1 (explicit safer than silent re-split).

**FK delete-transfer fix (bundled from 14.5.1 draft).** `reverseDematTransferSideEffectsInTxn` now clears `account_transfers.linked_contribution_id` / `demat_target` / `investment_bucket_id` stamps FIRST, THEN deletes the investment_contributions row — SQLite `PRAGMA foreign_keys = ON` blocks DELETE on a row while another table still holds an FK pointer at it.

**Migration 013** — new `recurring_expense_rules` table + `expenses.recurring_rule_id` plain column (not a real FK, to avoid a circular reference with `recurring_expense_rules.source_expense_id → expenses`; orphan-cleanup lives in `permanentlyDeleteExpense`).

### 14.5.0 shipped 2026-04-28 — button regression + fund_balance single source — fund-balance architecture cleanup + regressions

Emergency-style follow-up to 14.4.0. Three user-reported bugs + a structural cleanup they surfaced.

- **Button white-on-white (regression from 14.3.0).** The 14.3.0 bounce-animation removal switched to a function-form `style` prop on `Pressable`; that form doesn't reliably merge inline backgroundColor with NativeWind className on all RN versions, so primary save buttons rendered with no background — white text on white in light mode. Fixed by driving the pressed state through manual `onPressIn`/`onPressOut` state + a static array `style`.
- **Delete transfer "doesn't work".** Delete *was* working for non-demat transfers, but exceptions inside `reverseDematTransferSideEffects` were silently swallowed by the unhandled-async in the Pressable handler. Added `try/catch` in the ledger's delete handler to surface errors via alert.
- **Home hero card shows stale fund balance.** 14.4.0's `handleDematTransferSideEffects` wrote to `demat_fund_snapshots` but not to the legacy `financial_accounts.fund_balance` scalar, which the home card read. Instead of a mirror-write shim, **demat_fund_snapshots is now the single source of truth** for idle-cash on demat accounts:
  - New helpers: `getCurrentFundBalance(accountId)` + `getCurrentFundBalances(ids)` (batched)
  - `getDematSummary` (home card) now sums latest-snapshot-per-account instead of reading the scalar
  - `getDematAccountsWithSummary` (demat-portfolio breakdown) adds a `latestFundValue` field
  - `account-detail.tsx` reads current fund via `getCurrentFundBalance`
  - `balance-sheet.ts` drops the unused `fund_balance` column load
  - `updateFundBalance` (called from account-detail's save) now creates/updates a today-snapshot instead of writing the scalar
  - `addOrUpdateFundSnapshot` and `deleteFundSnapshot` no longer mirror to the scalar
- **Migration 012** — `fund_balance_backfill` — ensures any drift between the scalar and latest snapshot is captured as a today-snapshot so no data is lost in the switchover (INSERT OR IGNORE, safe to re-run).
- **`financial_accounts.fund_balance` column** — not dropped (backup/restore still carries it); now read-never and write-never except for the backfill migration source.

### 14.4.0 shipped 2026-04-28 — demat-aware transfers

- **Connecting the dots on money movement.** When a transfer lands in a demat account (via Add Transfer in the ledger or Mark-as-Transfer on an expense/credit), a follow-up sheet asks whether the money goes into **fund** (idle cash with the broker) or **portfolio** (already invested), and optionally which **investment bucket** it contributes to.
- The side-effects flow through to all the right places: `demat_fund_snapshots` / `demat_portfolio_snapshots` (additive upsert on the transfer date), `investment_buckets.current_contributed`, and any linked milestone's `current_saved`.
- **Delete-undoes-everything.** Deleting the transfer reverses every side-effect: subtracts the snapshot delta (deletes the row if it empties), removes the `investment_contributions` row, and reflows the bucket + milestone totals.
- Persisted via migration **011** — two new columns on `account_transfers`: `demat_target` ('fund' | 'portfolio' | NULL) and `investment_bucket_id` (FK).
- New service `services/demat-transfer.ts` — `handleDematTransferSideEffects` + `reverseDematTransferSideEffects`.
- New component `components/expense/DematTransferTargetSheet.tsx`.

### 14.3.0 shipped 2026-04-28 — follow-ups to 14.2.0

- **Split-tender on the edit screen.** A standalone expense can be converted to a split-tender purchase from the edit form; an existing leg can add new siblings (up to the 3-leg cap) or unlink from the group. New service methods: `convertToSplitTender`, `addLegToExistingGroup`. Save button relabels to "Update Purchase" when relevant.
- **Insight drill back-navigation.** Tapping an insight breakdown row with multiple expenses now opens a new `/insights/filtered` screen (under the insights Stack) instead of the Expenses tab — so the back button returns to insight-detail as expected. The URL-param seeding added to `(tabs)/expenses.tsx` in 14.2.0 has been reverted; the tab is back to its pre-14.2.0 self.
- **Button: bounce animation removed.** The spring `scale`/`opacity` press animation on `<Button>` was dropped entirely. All save buttons now use the system-standard `pressed` opacity dim (0.85), which is consistent across the app — including Create Backup. Haptic feedback is retained.
- **Recycle-bin permanent-delete FK crash (real fix).** 14.2.0 added a bogus `UPDATE hisaab_entries SET linked_forecast_id = NULL` — that column doesn't exist on `hisaab_entries`. It lives on `account_transfers`. Replaced with the correct clears for `account_transfers.linked_forecast_id` and `account_transfers.linked_expense_id`.
- **New `getExpensesByIds`** batch fetch used by the filtered insights screen.

### 14.2.0 shipped 2026-04-28
- Split-tender purchases (add screen only — edit-screen support arrives in 14.3.0)
- Bug fixes: insight drill nav, Create-Backup animation, dismissed-duplicates viewer, recycle-bin FK (partial — see 14.3.0 for the real fix), save button label
- Duplicate detection: sign guardrail + split-tender sibling exclusion

**Expected next app version:** 14.3.0 (MINOR — 1 meaningful new capability: edit-screen split-tender; plus regression fixes).

### Version docs on disk (partial coverage — not every version has a full PRD/MASTER_PLAN/TDD set)

| Version | App version | What's on disk | What It Contains |
|---------|-------------|----------------|-----------------|
| **V14** | 14.1.0 (shipped) | `docs/V14/PRD_V14.md`, `docs/V14/TDD_V14.md` (no MASTER_PLAN) | Advisor Pack repositioning — debt payoff planner + two other advisor features |
| **V13** | 13.0.0 – 13.5.4 | `docs/V13/PROPOSAL_shared_credit_pool.md` only | Proposal only; actual V13 work (CC utilized model, fund snapshots, weekly demat graph, ledger filters, wallet details, YoY balance sheet, duplicate-group redesign, EPF/pension SMS, hot-path perf, fresh-install fix) shipped across v13.0.0–v13.5.4 |
| **V12** | 12.0.0 – 12.6.0 | `docs/V12/PRD_V12.md`, `docs/V12/TDD_V12.md`, `docs/V12/MASTER_PLAN_V12.md` | Stabilization + functional gaps; shipped across v12.0.0–v12.6.0 including CC ledger redesign + IDFC FIRST SMS parsing |
| **V11** | 11.x | `docs/V11/MASTER_PLAN_V11.md` only (no PRD/TDD) | Plan-only record of V11 work |
| **V7** | 7.x | `docs/V7/PLAN_V7.md`, `docs/V7/TDD_V7.md` (no PRD) | Plan + TDD only |
| **V6** | 6.0.0 | `docs/V6/MASTER_PLAN_V6.md`, PRD, TDD | Complete: 5 color themes + Gen Z visual overhaul |
| **V5** | 5.0.0 | `docs/V5/MASTER_PLAN_V5.md`, PRD, TDD | Complete: audit remediation (security, bugs, architecture, UI, perf) |
| **V4** | 4.0.0 | `docs/V4/MASTER_PLAN_V4.md`, PRD, TDD, V4_FEATURE_BACKLOG | Complete: master data, payment mode detection, insights comparison, timestamps |
| **V3** | 3.0.0 | `docs/V3/MASTER_PLAN_V3.md`, PRD, TDD | Partial (Phases 0-2 + bug fixes shipped; Phases 3-6 deferred) |
| **V2** | 2.0.0 | `docs/V2/MASTER_PLAN_V2.md`, PRD, TDD | Complete: bug fixes, income tax rework, UX, SMS, tags, insights |
| **V1** | 1.0.0 | `docs/V1/MASTER_PLAN_V1.md`, PRD, TDD | Complete: expense split, merchant bucketing, Axio-style detail, forecast |
| **MVP** | 0.x – pre-1.0 | `docs/MVP/MASTER_PLAN.md`, `PRD.md`, `TDD.md`, `DEVOPS.md`, `TEST_STRATEGY.md`, `SECURITY.md` | Complete: F1-F38 — core expense, budget, goals, SMS, hisaab, salary, visual |

**Convention going forward:** new versions should ship with a full `PRD_Vn.md` + `TDD_Vn.md` + `MASTER_PLAN_Vn.md` trio. V7/V11/V13/V14 predate or drifted from this rule and won't be backfilled unless there's a specific need.

### Non-version docs in `docs/`
| File | Purpose |
|------|---------|
| `docs/PRIVACY_POLICY.md` | User-facing privacy policy |
| `docs/UI_AUDIT_PROPOSAL.md` | Ad-hoc UI audit proposal (non-release) |
| `docs/CREDIT_DETECTION_FIX_PLAN.md` | Ad-hoc fix plan for credit detection (non-release) |

---

## Current Phase & Status

> **Current app version: 15.8.2 (shipped).** Next build (in-flight this session) targets **15.9.0**.
> There is no active MASTER_PLAN file; work is tracked via the session TODO list plus the "Current in-flight work" block above.

### Version Summary (shipped app versions)

| Version | What shipped | Notes |
|---------|-------------|-------|
| **MVP** | Core expense tracking, budget, goals, SMS auto-detection, hisaab, salary calculator, visual refresh | 67 tasks, 802 tests at time of writing |
| **V1** | Expense split, merchant bucketing, Axio-style detail, forecast workflow, color refresh | |
| **V2** | Bug fixes, income tax rework, UX improvements, SMS/data improvements, tags, insights dashboard | |
| **V3** | Export, notifications, date pickers, salary FY isolation | Partial — Phases 0-2 + bug fixes shipped, Phases 3-6 deferred |
| **V4** | Master data, payment mode detection, insights comparison, timestamps | |
| **V5** | Audit remediation: security, bugs, architecture, UI polish, performance | |
| **V6** | Color themes (5 presets) + Gen Z visual overhaul | |
| **V7** | (plan + TDD on disk, no PRD) | |
| **V11** | (plan on disk only) | |
| **V12** | Stabilization + functional gaps + CC ledger + IDFC FIRST SMS parsing | Shipped across v12.0.0–v12.6.0 |
| **V13** | CC utilized model, fund snapshots, weekly demat graph, ledger filters, YoY balance sheet, duplicate-group redesign, EPF/pension SMS, hot-path perf, fresh-install fix | Shipped across v13.0.0–v13.5.4 |
| **V14** | Advisor Pack: stability + UX fixes; credits view; Mark-as-Transfer; split-tender purchases; insight drill list; demat-aware transfers; fund snapshots single-source; recurring expenses + duplicate action | 14.0.0 – 14.5.0 |

### In-flight feature roadmap (post-14.1.0, targeting 14.2.0)

| Area | Size | Status |
|------|------|--------|
| Migration 010: `purchase_group_id` column | XS | Done ✅ |
| `services/purchase-group.ts` — split-tender service (create/siblings/unlink/propagate) | M | Done ✅ |
| Expense types + crud + queries plumbed for `purchase_group_id` | S | Done ✅ |
| Duplicate detection: sign guardrail + `purchase_group_id` sibling exclusion + `getDismissedDuplicateGroups` / `restoreDismissedGroup` APIs | S | Done ✅ |
| Bug 5: insight drill → filtered expenses list (URL-param seeding on `(tabs)/expenses`) | M | Done ✅ |
| Bug 6: Button press animation settles when `loading` flips | XS | Done ✅ |
| Bug 7: `/settings/dismissed-duplicates` screen + read-only `DuplicateGroupCard` variant | M | Done ✅ |
| Bug 8: `permanentlyDeleteExpense` transaction + missing FK clear | S | Done ✅ |
| Bug 9: dynamic save button label (Expense / Refund / Credit / Forecast / Purchase) | XS | Done ✅ |
| Split-tender UI: Add-Expense multi-leg entry + running total + cap-3 | L | Done ✅ |
| Split-tender UI: Expense detail siblings card + shared-edit propagation | M | Done ✅ |
| Split-tender UI: list-row "Split" pill | XS | Done ✅ |
| Tests: duplicate-detection sign guardrail + purchase-group service | S | Done ✅ |
| TSC green (fix 1 test mock missing `purchase_group_id`; 1 self-inflicted test property-order) | S | Pending |
| Bump `app.json` to 14.2.0 | XS | Pending |
| Full build pipeline (commit → push → GitHub release → APK → upload) | M | Pending — awaiting user "build" |

---

## How to Work in This Project

### Session Workflow

```
1. Read this CLAUDE.md (you're doing it now)
2. Check the "Current in-flight work" + "In-flight feature roadmap" blocks above
3. For shipped versions, consult docs/V<n>/ (PRD/TDD/MASTER_PLAN if present)
4. Read the prerequisite files before coding
5. Propose changes to the user, wait for approval, then execute (per the "Propose Before Coding" rule)
6. After completing the task:
   a. Update the "In-flight feature roadmap" status in this file
   b. Tick off the session's TodoWrite entry
7. If time remains, pick the next task
```

### After Context Compaction (CRITICAL)

When context is compacted (you lose prior messages), you MUST:
```
1. IMMEDIATELY re-read the top of this CLAUDE.md (version + in-flight work)
2. Check git status + git log for recent session activity
3. Check the "In-flight feature roadmap" block for pending items
4. Resume the first [Pending] item, or ask the user which direction to pick up
5. Do NOT ask "where were we?" if the roadmap clearly shows the state
```

### Rules

1. **One task at a time.** Complete it fully before starting the next.
2. **Read before coding.** Every task lists prerequisite files — read them first.
3. **Test on each task.** Run tests after every task. Don't accumulate untested code.
4. **Update the tracker after EVERY task.** This is non-negotiable. Update SESSION LOG + CURRENT STATE + task checkbox.
5. **Don't skip tasks.** Tasks are ordered with dependencies. Follow the sequence.
6. **Ask if stuck.** If a task is ambiguous, ask the user rather than guessing.

### Git Convention

```
feat(expense): add manual expense entry with category selection
fix(sms): handle HDFC SMS format with missing merchant name
test(budget): add unit tests for budget calculation logic
docs(prd): update Phase 1B goal engine features
chore(deps): upgrade expo-sqlite to v15
```

Branch naming: `feature/F1-manual-expense-entry`, `bugfix/approve-queue-crash`

### Tech Stack Quick Reference

| Layer | Technology |
|-------|-----------|
| Framework | React Native + Expo |
| Navigation | Expo Router (file-based) |
| Styling | NativeWind (Tailwind CSS for RN) |
| State | React hooks (useState/useCallback) |
| Database | expo-sqlite (plaintext; OS-level encryption) |
| KV Store | react-native-mmkv (settings only) |
| Charts | react-native-chart-kit or Victory Native |
| Testing | Jest + React Native Testing Library + Maestro |
| Build | EAS Build / codora-app-build |

### Folder Structure (Target)

```
~/accounts-manager-app/
├── CLAUDE.md                  # This file
├── app/                       # Expo Router pages
├── components/                # Reusable UI components
│   ├── ui/                    # Generic (Button, Card, Input, etc.)
│   ├── expense/               # Expense-specific
│   ├── budget/                # Budget-specific
│   ├── goals/                 # Goal engine
│   ├── hisaab/                # Family ledger
│   └── charts/                # Chart wrappers
├── services/                  # Business logic
├── database/                  # SQLite schema, migrations, queries
├── utils/                     # Helpers, formatters, validators
├── constants/                 # Theme, config, category defaults
├── hooks/                     # Custom React hooks
├── assets/                    # Images, fonts
├── __tests__/                 # Jest tests
├── .maestro/                  # Maestro E2E flows
├── docs/                      # Documentation
│   ├── MASTER_PLAN.md
│   ├── PRD.md
│   ├── TDD.md
│   ├── DEVOPS.md
│   ├── TEST_STRATEGY.md
│   └── SECURITY.md
├── app.json                   # Expo config
├── package.json
├── eas.json                   # EAS Build profiles
└── tsconfig.json
```

### Claude Code Skills Available

| Skill | Command | When to Use |
|-------|---------|-------------|
| Mobile Master | `skill-mobile-mt` | Architecture, coding, bug detection |
| Wizard | `/wizard` | 8-phase development workflow |
| APK Build | `/build android` | Build APK for phone testing |
| OWASP | Auto-activates | Security during coding |
| Security Audit | `/security-audit` | Pre-release security scan |
| Maestro | `maestro-skill` | Generate E2E test flows |
| Architecture | `arc-skill` | Project scaffolding |
| App Store Review | `appstore-review-skill` | Pre-publish checklist |

---

## Build & DevOps (Exact Commands — No Guessing)

### Environment Variables (REQUIRED for every build)

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
```

### Prerequisites (one-time setup, verify before first build)

```bash
# local.properties must exist in android/
echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties

# tailwind.config.js symlink must exist in android/ (NativeWind metro resolution)
ln -sf ../tailwind.config.js android/tailwind.config.js

# eas-cli must be installed globally
npm install -g eas-cli
```

### Build APK Command (v15.9.2+)

```bash
cd ~/accounts-manager-app && ./bin/build-apk.sh
```

First build after a branch switch / cache corruption:

```bash
./bin/build-apk.sh --clean
```

The wrapper sets JAVA_HOME/ANDROID_HOME, verifies `android/local.properties` and the tailwind symlink, runs `./gradlew assembleRelease` in the persistent `android/` directory, then copies the APK to `./build-<timestamp>.apk` to match the existing `gh release upload ./build-*.apk` convention.

**Why not `eas build --local`?** Tried it; measured. EAS `--local` creates a fresh UUID-scoped scratch directory per run (`/var/folders/.../eas-build-local-nodejs/<uuid>/build/android/`). That wipes Gradle's build cache (in `./build/`) AND defeats ccache (include paths baked into compile command lines change every run). Direct Gradle against the persistent `android/` gives both caches a warm home. Measured baseline vs EAS: first build ~equal, rebuilds 60-70% faster with warm caches.

**Fallback (if the wrapper is ever broken):**

```bash
cd ~/accounts-manager-app && \
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" && \
export ANDROID_HOME="$HOME/Library/Android/sdk" && \
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH" && \
eas build --platform android --profile preview --local --non-interactive
```

Output: APK file path printed on the last line (e.g., `/Users/sourav.baid/accounts-manager-app/build-xxxxx.apk`)

### Upload APK to GitHub Release

```bash
gh release upload vX.Y.Z ./build-*.apk
```

### Signing keystore (stable, v15.9.3+)

All release APKs are signed by `bin/artha-release.keystore` — a committed, repo-tracked keystore. Cert:

- **DN:** `CN=Artha, OU=Artha, O=Artha, L=Local, ST=Local, C=IN`
- **SHA-256:** `9B:8B:80:23:97:81:80:5A:EF:B2:10:64:96:36:02:70:CC:C0:F8:67:4B:0F:12:18:52:D6:FF:6B:9A:CF:A5:C4`
- **Valid:** 25 years from generation
- **Store password:** `artha-local` (also the key password)
- **Alias:** `artha`

Wired in `android/app/build.gradle` under `signingConfigs.release` + `buildTypes.release`. **Every release APK from v15.9.3 onwards shares this cert**, so updates install cleanly over any prior build.

**Historical context (don't repeat):** v14.x–v15.9.1 shipped via `eas build --local` which generates an ephemeral keystore per run (cert DN is blank fields, never persisted). When we switched to direct Gradle in v15.9.2, we couldn't sign with the old cert because EAS had already deleted it — forcing a one-time uninstall + backup/restore to get v15.9.2 onto the phone. The stable keystore is the permanent fix.

**If `expo prebuild --clean` ever wipes android/:** the `signingConfigs.release` + `buildTypes.release` blocks need to be re-applied manually. Current diff against the stock prebuild output is documented in `bin/build-apk.sh` header + visible in git history on first commit of the stable-keystore change.

**Losing this keystore = future updates break (same trap as v15.9.1→v15.9.2).** Treat it like a real keystore: never rm, never regenerate. It's committed to the repo (not a secret in the cryptographic sense since a solo-dev app signing key is effectively public once distributed).

### Common Build Failures & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `SDK location not found` | Missing ANDROID_HOME or local.properties | Create `android/local.properties` with sdk.dir path |
| `Cannot find module 'tailwind.config'` | Metro resolves from android/ dir during EAS build | Create symlink: `ln -sf ../tailwind.config.js android/tailwind.config.js` |
| `could not determine executable to run` | eas-cli not installed globally | `npm install -g eas-cli` |
| `Gradle build failed` (14s, no compilation) | Usually env var missing, not code error | Check JAVA_HOME and ANDROID_HOME are set |
| `workflow scope required` for gh release | GitHub token missing scope | `gh auth refresh -h github.com -s workflow` or re-auth with PAT |

### GitHub Auth (when token expires)

```bash
echo "ghp_XXXXX" | gh auth login --with-token
```

### Full "Build" Pipeline (what "build" means in this project)

1. `git add` + `git commit` (descriptive message)
2. `git push origin main`
3. `gh release create vX.Y.Z --title "..." --notes "..."`
4. Run APK build command (above)
5. `gh release upload vX.Y.Z ./build-*.apk`

**NEVER skip steps. NEVER improvise the build command. Use exactly what's documented above.**

---

## Version Management (Follow for Every Release)

Every major version of Artha follows this documentation and tracking pattern:

### Documentation Structure
```
docs/<VERSION>/
├── PRD_<VERSION>.md           # Product requirements — features, data model, user stories
├── MASTER_PLAN_<VERSION>.md   # Task tracker — phased tasks, session log, current state
└── TDD_<VERSION>.md           # Technical design — schema changes, services, architecture
```

When starting a new version:
1. **Archive previous version:** Move `docs/<PREV>/` contents to their version folder (already done)
2. **Create new version folder:** `docs/<VERSION>/` with PRD, MASTER_PLAN, TDD
3. **Update CLAUDE.md:** Add new version to Documentation table, update Feature Roadmap, update Current Phase
4. **MASTER_PLAN pattern:** Must include: SESSION LOG table, CURRENT STATE block, MANDATORY BEHAVIORS, Feature Summary, Phased tasks with `[ ]` checkboxes, acceptance criteria, prereqs, dependency graph
5. **Version in app.json:** Bump version following semver — PATCH for 0 features (bugfix), MINOR for 1-5 features, MAJOR for >5 features

### Completed Versions (shipped to users)
| Version | Folder | Features | App version |
|---------|--------|----------|-------------|
| MVP | `docs/MVP/` | F1-F38 core app | 0.x |
| V1 | `docs/V1/` | Expense split, merchant bucketing, Axio detail, forecast | 1.0.0 |
| V2 | `docs/V2/` | Bug fixes + income tax + tags + insights | 2.0.0 |
| V3 | `docs/V3/` | Export, notifications, date pickers, salary FY (partial — Phases 3-6 deferred) | 3.0.0 |
| V4 | `docs/V4/` | Master data, payment mode detection, insights comparison, timestamps | 4.0.0 |
| V5 | `docs/V5/` | Audit remediation (security, bugs, architecture, UI, perf) | 5.0.0 |
| V6 | `docs/V6/` | 5 color themes + Gen Z visual overhaul | 6.0.0 |
| V7 | `docs/V7/` (plan + TDD only) | See `docs/V7/PLAN_V7.md` | 7.x |
| V11 | `docs/V11/` (plan only) | See `docs/V11/MASTER_PLAN_V11.md` | 11.x |
| V12 | `docs/V12/` | Stabilization + functional gaps + CC ledger + IDFC FIRST SMS | 12.0.0 – 12.6.0 |
| V13 | `docs/V13/` (proposal only) | CC utilized, fund snapshots, YoY balance sheet, perf, EPF/pension SMS, fresh-install fix | 13.0.0 – 13.5.4 |
| V14 | `docs/V14/` (PRD + TDD; no MASTER_PLAN) | Advisor Pack direction; stability + UX fixes; credits view; Mark-as-Transfer for credits | 14.0.0 – 14.1.0 |

### In Progress
Post-14.3.0 — demat-aware transfers (fund / portfolio / investment bucket) with full delete-undo.

**App version:** 14.3.0 (target for next build: 14.4.0)

---

## Key Design Decisions (Don't Override These)

1. **100% local, no cloud** — No Supabase, Firebase, or any server. SQLite + MMKV only.
2. **Manual override on everything** — Every record (auto or manual) supports add/edit/delete.
3. **Indian FY default** — April 1 to March 31. Configurable in settings.
4. **Encrypted backup** — AES-256-GCM with user-set password. `.accmgr` file format.
5. **Phase 1 is manual-only** — No SMS/email automation until Phase 2.
7. **Universal review queue** — All auto-detected data (expenses, investments, assets, liabilities) goes through approve/edit/reject.
8. **Fiscal year drives everything** — Yearly plans, savings rates, YoY comparisons all tied to FY.

---

## SDLC Checklists (Mandatory)

### Database / Feature Change Checklist

Run this checklist **every time** you add, remove, or modify a table, column, or FK relationship:

| # | File | What to Check |
|---|------|---------------|
| 1 | `database/migrations/index.ts` | New migration registered in imports + array |
| 2 | `database/TABLE_SCHEMAS.ts` | Column list matches actual DB schema (add new table/columns, remove dropped ones) |
| 3 | `services/backup.ts` — BACKUP_TABLES | New table added in correct dependency order; dropped table removed |
| 4 | `services/data-cleanup.ts` — cleanupData() | Bulk delete cascades to new child tables + clears FKs before parent delete |
| 5 | `services/expense-crud.ts` — permanentlyDeleteExpense() | Hard delete cascades to any new child records of expenses |
| 6 | `services/hisaab.ts` — hardDeletePerson() | Person delete cascades to new tables referencing hisaab_person_id |
| 7 | `services/account-balance.ts` | Balance math uses correct field (amount vs split_original_amount) |
| 8 | `app/reconciliation/account-ledger.tsx` | Ledger display reflects correct amounts and badges |
| 9 | Export services (hisaab-export-pdf/excel) | No dead imports/functions; exports reflect current schema |
| 10 | Test files — mock Expense objects | Include all required fields (new columns need defaults in mocks) |
| 11 | `services/expense-types.ts` | Expense interface includes new columns |
| 12 | `constants/routes.ts` | New screens added / removed screens deleted from allowlist |

### Build & Release Checklist

Run this **every time** you create a build:

| # | Step | Details |
|---|------|---------|
| 1 | Version bump | `app.json` version follows semver (PATCH=bugfix, MINOR=1-5 features, MAJOR=>5) |
| 2 | TypeScript check | `npx tsc --noEmit` — no new errors in non-test files |
| 3 | Tests pass | `npx jest` — relevant test suites green |
| 4 | Git commit + push | Descriptive commit message, pushed to main |
| 5 | GitHub release | `gh release create vX.Y.Z` with changelog |
| 6 | APK build | `eas build --platform android --profile preview --local` |
| 7 | Upload APK | Attach .apk to the GitHub release |

### Delete/Remove Feature Checklist

Run this when **removing** a feature, screen, or service entirely:

| # | What to Check |
|---|---------------|
| 1 | Delete the screen file(s) from `app/` |
| 2 | Remove Stack.Screen from parent `_layout.tsx` |
| 3 | Remove from `constants/routes.ts` allowlist |
| 4 | Delete the service file(s) from `services/` |
| 5 | Remove barrel exports from `services/index.ts` |
| 6 | Remove/update imports in all consuming files (grep for the service/screen name) |
| 7 | Remove related test files from `__tests__/` |
| 8 | Update `database/TABLE_SCHEMAS.ts` (remove dropped table schemas) |
| 9 | Update `services/backup.ts` — remove from BACKUP_TABLES |
| 10 | Update `services/data-cleanup.ts` — remove cleanup logic for dropped tables |
| 11 | Check export services, components, and UI for dead references |
| 12 | Run `npx tsc --noEmit` to catch broken imports |
| 13 | Run affected tests to verify green |

### Comprehensive Stabilization Audit (Run Before Any Release)

This is the MANDATORY full-stack audit checklist. Run it before any version release, after major feature work, or when the user says "stabilize the app."

#### 1. Functional Integrity

| # | Check | How |
|---|-------|-----|
| 1 | No broken imports | `npx tsc --noEmit` — zero errors in non-test files |
| 2 | No dead routes | Verify every path in `constants/routes.ts` has a matching screen file |
| 3 | No orphaned screens | Every screen file in `app/` is declared in its parent `_layout.tsx` |
| 4 | All write ops call `bumpDataVersion()` | Grep all services for INSERT/UPDATE/DELETE and verify bump |
| 5 | FK cascades maintained | Deleting a parent doesn't orphan children (check category/payment mode/expense) |
| 6 | Navigation works end-to-end | All `router.push()` calls reference valid existing routes |

#### 2. Security

| # | Check | Severity |
|---|-------|----------|
| 1 | No raw string interpolation in SQL | CRITICAL — all queries use parameterized `?` |
| 2 | HTML user inputs escaped in PDF/WebView | MEDIUM — use `htmlEscape()` for merchant names, descriptions |
| 3 | No hardcoded secrets/API keys/tokens | CRITICAL |
| 4 | Error boundaries don't leak stack traces in production | MEDIUM — guard with `__DEV__` |
| 5 | File operations use system pickers (no raw path input) | LOW |
| 6 | Password validation consistent (UI matches service) | LOW |

#### 3. Performance

| # | Check | How to Fix |
|---|-------|-----------|
| 1 | No N+1 queries (loop with await per row) | Batch with `IN` clause |
| 2 | Large lists use FlatList with pagination | `PAGE_SIZE`, `onEndReached` |
| 3 | Expensive components wrapped in `React.memo` | List items, chart components |
| 4 | Derived state uses `useMemo` | Maps, filtered arrays, computed values |
| 5 | FlatList has `keyExtractor`, `getItemLayout` where possible | Fixed-height items |
| 6 | No heavy sync operations on UI thread | All DB ops are async |

#### 4. Hardcodings & Magic Numbers

| # | Check | Rule |
|---|-------|------|
| 1 | No hardcoded hex colors in logic | Use theme tokens or named constants |
| 2 | No magic numbers (tolerance thresholds, timeouts, sizes) | Extract to named constants |
| 3 | No locale-specific hardcodings without settings fallback | Currency, FY start month from settings |
| 4 | No duplicate utility functions | Consolidate into shared utils |
| 5 | No duplicate constant arrays | Single source of truth, import everywhere |

#### 5. Dead Code & Redundancy

| # | Check | How |
|---|-------|-----|
| 1 | No unused imports | TypeScript compiler catches these |
| 2 | No unused exports (functions never called) | Grep for function name across codebase |
| 3 | No dead DB tables (created but never queried) | Cross-ref migration with services |
| 4 | No functions that do nothing (all conditions result in no-op) | Review after removing features |
| 5 | Test files updated to match removed/changed code | Remove dead test cases |

#### 6. UI Consistency

| # | Check | Rule |
|---|-------|------|
| 1 | All screens use `<ScreenContainer>` | `padTop={false}` under Stack headers |
| 2 | All headers follow design system | `fontWeight: "700"`, `fontSize: 18`, no shadow |
| 3 | Primary actions use `<Button>` component | Not custom Pressable for submit/save |
| 4 | Colors use theme tokens | No conditional `colorScheme === "dark" ?` patterns |
| 5 | Empty states follow pattern | Center icon + title + subtitle |

---

## Design System Rules (Mandatory)

Every new page, sub-page, or UI element MUST follow these rules. Creativity is encouraged for new components, but the basics below are non-negotiable.

### Stack/Route Layout Headers

All `_layout.tsx` files with headers MUST use this exact pattern:
```tsx
<Stack
  screenOptions={{
    headerStyle: {
      backgroundColor: theme.background,
    },
    headerTitleStyle: {
      fontWeight: "700",
      fontSize: 18,
      color: theme.text,
    },
    headerTintColor: theme.tint,
    headerShadowVisible: false,
  }}
>
```
- **Never** use conditional `colorScheme === "dark" ? Colors.dark.X : Colors.light.X` — always use `theme.X`
- **Always** include `fontWeight: "700"` and `fontSize: 18` in `headerTitleStyle`
- **Always** disable header shadow with `headerShadowVisible: false`
- Root layout keeps `headerShown: false` for all child routes (child layouts own their headers)

### Color Tokens (from `constants/theme.ts`)

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `theme.text` | #1A1A1A | #FFFFFF | Primary text |
| `theme.textSecondary` | #6B7280 | #A0A0A0 | Secondary text, labels |
| `theme.background` | #FFFFFF | #111111 | Screen/header backgrounds |
| `theme.surface` | #F7F7F5 | #1E1E1E | Cards, elevated surfaces |
| `theme.border` | #E5E5E3 | #2E2E2E | Borders, dividers |
| `theme.tint` | #2563EB | #60A5FA | Primary actions, links, icons |

**Rules:**
- Use NativeWind classes (`text-text-primary`, `dark:text-text-dark-primary`) for text
- Use theme tokens from `Colors[colorScheme]` for inline styles
- Never hardcode colors — always reference theme tokens or NativeWind classes
- Exception: One-off accent colors for icons/charts may use hex directly
- **Never use hardcoded hex as a fallback for optional color props** (e.g., `color ?? "#1A1A1A"` breaks dark mode). Instead, use NativeWind dark-mode classes as the default and only apply `style={{ color }}` when a color prop is explicitly provided: `className="text-text-primary dark:text-text-dark-primary" style={color ? { color } : undefined}`
- **Use shared UI components** — for label/value metric rows, use `<MetricRow>` from `@/components/ui`. Never create local copies of shared components.

### Typography Scale

| Usage | Class / Style | Weight | Size |
|-------|--------------|--------|------|
| Screen title (Stack header) | `headerTitleStyle` | 700 | 18 |
| Section header | `text-base font-bold` | 700 | 16 |
| Card title | `text-base font-semibold` or `text-sm font-semibold` | 600 | 14-16 |
| Body text | `text-sm` | 400 | 14 |
| Caption / label | `text-xs` | 400-600 | 12 |
| Section label (uppercase) | `text-xs font-semibold uppercase tracking-wider` | 600 | 12 |
| Amount (large) | `text-lg font-bold` | 700 | 18 |
| Amount (inline) | `text-sm font-bold` | 700 | 14 |

### Spacing & Padding

| Context | Value | NativeWind |
|---------|-------|------------|
| Screen horizontal padding | 16px | `px-4` |
| Screen vertical padding (top) | 16px | `py-4` |
| Card internal padding | 16px | (via Card component default) |
| Card margin-bottom | 8-16px | `mb-2` to `mb-4` |
| Between section label and content | 8-12px | `mb-2` to `mb-3` |
| Between form fields | 12px | `mb-3` |
| Bottom padding (for scroll) | 32-80px | `paddingBottom: 32` to `80` |
| FAB bottom offset | 24px | `bottom-6 right-6` |

### Component Patterns

**Card:** Always use `<Card>` from `@/components/ui` — provides consistent surface color, border radius, padding, shadow.

**Screen layout:** Always use `<ScreenContainer padTop={false}>` for screens under a Stack header. Use `padTop={true}` only for standalone screens without Stack headers.

**ScrollView:** Always set `showsVerticalScrollIndicator={false}` and `contentContainerStyle={{ paddingBottom: N }}` where N >= 32.

**Empty state:** Center-aligned icon (48px, #9CA3AF) + title (`text-lg font-medium`) + subtitle (`text-sm text-center`).

**Section labels:** Use uppercase tracking-wider pattern: `text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-3`.

**Icon button (circular):** `w-9 h-9 rounded-full bg-primary-500/10 items-center justify-center` with Ionicons size 18.

**FAB:** `absolute bottom-6 right-6 w-14 h-14 rounded-full bg-primary-500 items-center justify-center shadow-lg` with Ionicons add size 28 white.
