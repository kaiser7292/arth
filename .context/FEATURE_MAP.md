# Feature Map — Where Does My Problem Live?

**Start here when something looks wrong in the app.** This file is organized by what you actually *see* on screen, not by code structure. Find the area that matches your symptom, read the plain-English description to confirm it's the right one, then either read the linked detail file yourself or just describe the symptom to Claude and point it at this entry — it will read the rest.

⚠️ marks areas with a documented history of bugs (see `CLAUDE.md` → "Common Failure Patterns" for the full incident list). Be extra precise describing symptoms here — small details (which month you were viewing, whether it's a past or current month, manual vs SMS-detected) usually point straight at the cause.

---

## Quick symptom lookup

| If you're seeing... | Go to area |
|---|---|
| Balance looks right but the transaction list under it is empty | [Reconciliation / Account Ledger](#5-reconciliation--account-ledger-️) |
| A credit/transfer you just added isn't showing in the month you expected | [Reconciliation / Account Ledger](#5-reconciliation--account-ledger-️) |
| An SMS-detected expense/credit never showed up, or showed up against the wrong account | [SMS Auto-Detection](#8-sms-auto-detection-️) |
| EMI amounts, prepayment results, or outstanding balance look wrong on a loan | [Loans](#6-loans-️) |
| Someone's hisaab balance looks wrong, or a settlement didn't link to its expense | [Hisaab (Family Ledger)](#7-hisaab-family-ledger-️) |
| Something's missing or wrong after restoring a backup | [Backup & Restore](#11-backup--restore-️) |
| Budget month-end projection / "Spending Pulse" number looks off | [Budget](#3-budget) |
| A scenario in the cash-flow simulator didn't match against the real transaction it should have | [Cash-flow Simulator](#10-cash-flow-simulator) |
| Wrong category was auto-applied, or a Smart Rule didn't fire | [Expenses & Smart Automation](#2-expenses--smart-automation) |
| Yearly plan / investment bucket / milestone numbers look off | [Goals & Planning](#4-goals--planning) |

---

## 1. Home

**What it does:** Landing screen — net worth snapshot, quick stats, configurable cards (you can hide/show cards in Settings → Home Cards).

**Where:** `app/(tabs)/index.tsx`

**Technical:** `services/home-preload.ts` runs expensive queries once on app start and caches them; each card "consumes" its slot once (single-use — won't show stale data on re-entry, but also won't refresh until next cold start unless it re-queries itself). `services/home-card-preferences.ts` controls visibility.

---

## 2. Expenses & Smart Automation

**What it does:** Add/edit/review every transaction — manual entry or SMS auto-detected. Auto-detected items sit in a **review queue** until you approve/edit/reject them; nothing reaches your reports unapproved. Smart Rules can auto-categorize by merchant/amount/account. Smart Categorizer (separate, simpler engine) has built-in keyword rules for 200+ Indian merchants and learns from your corrections.

**Where:** `app/(tabs)/expenses.tsx`, `app/expense/add.tsx`, `app/expense/review-queue.tsx`, `app/expense/[id].tsx`, `app/settings/categories.tsx`, `app/settings/recurring-rules.tsx`, `app/settings/merchant-aliases.tsx`, `app/settings/dismissed-duplicates.tsx`

**Technical:** `services/expense-crud.ts` (CRUD + cascades), `services/expense-queries.ts` (reads), `services/smart-rules.ts` (user-defined auto-categorization), `services/smart-categorizer.ts` (built-in keyword engine + learning), `services/duplicate-detection.ts`, `services/recurring-detector.ts` / `recurring-rules.ts`, `services/merchant-alias.ts`. Table: `expenses` (the single table for debits/credits/adjustments/forecasts — see `nature` column).

---

## 3. Budget

**What it does:** Set a monthly budget per category. Tracks rolling surplus (unspent budget carries forward), month-end projection with a confidence level, and a "Spending Pulse" health indicator.

**Where:** `app/(tabs)/budget.tsx`, `app/budget/[categoryId].tsx`, `app/budget/spending-split.tsx`, `app/budget/transactions.tsx`, `app/settings/budget-config.tsx`

**Technical:** `services/budget.ts` (CRUD + rolling surplus), `services/analytics-forecast.ts` + `services/analytics/forecast-engine-v2.ts` (month-end projection — `forecast-engine.ts` is the legacy v1, don't add new logic there), `services/spend-classification.ts` (single source of truth for "unavoidable vs discretionary" — Monthly Summary and Spending Split both read this, so they should never disagree).

---

## 4. Goals & Planning

**What it does:** Yearly plan (how this year's income gets allocated), investment buckets and their contributions, life milestones (long-term goals), year-over-year comparison across 6 categories, balance sheet (net worth), salary/tax calculator.

**Where:** `app/(tabs)/goals.tsx`, `app/goals/yearly-plan.tsx`, `app/goals/investment-buckets.tsx`, `app/goals/investment-detail.tsx`, `app/goals/milestones.tsx`, `app/goals/milestone-detail.tsx`, `app/goals/yoy-comparison.tsx`, `app/goals/balance-sheet.tsx`, `app/goals/salary-calculator.tsx`, `app/goals/capital-gains-reference.tsx`, `app/goals/loans.tsx` (entry point into the Loans feature, below)

**Technical:** `services/yearly-plan.ts`, `services/life-milestone.ts`, `services/savings-tracker.ts`, `services/salary-profile.ts`, `services/tax-engine.ts`, `services/capital-gains.ts`, `services/balance-sheet.ts`. Fiscal year (Apr 1 – Mar 31) drives all of this — see `services/settings.ts` → `getFYStartMonth`.

---

## 5. Reconciliation / Account Ledger ⚠️

**What it does:** Per-account transaction history and running balance for every bank/savings, credit card, wallet, demat, and pension account. This is where "did my balance update correctly" questions get answered.

**Where:** `app/reconciliation/account-ledger.tsx` (the core screen), `app/reconciliation/bank-accounts.tsx`, `app/reconciliation/credit-cards.tsx`, `app/reconciliation/wallets.tsx`, `app/reconciliation/demat-portfolio.tsx`, `app/reconciliation/pension-accounts.tsx`, `app/settings/account-master.tsx`, `app/settings/account-add.tsx`, `app/settings/account-detail.tsx`

**Full detail file:** [`.context/features/ledger-and-balances.md`](features/ledger-and-balances.md)

**The one thing to know:** if the balance number at the top looks correct but the transaction list below it is empty, that is *always* a crash partway through loading the screen — not a data problem. Tell Claude exactly which account, which month, and whether it's a savings/CC/wallet/demat/pension account.

---

## 6. Loans ⚠️

**What it does:** Full loan tracking with amortization schedules, EMI tracking, prepayments (two strategies: reduce the tenure, or reduce the EMI amount), manual corrections, and SMS-based auto-matching of EMI debits to the right installment.

**Where:** `app/goals/loans.tsx` (list), `app/loans/add.tsx`, `app/loans/[id].tsx` (detail + schedule)

**Full detail file:** [`.context/features/loans.md`](features/loans.md)

---

## 7. Hisaab (Family Ledger) ⚠️

**What it does:** Track money owed between you and friends/family — per-person running balance, settlements, PDF/Excel export. Can link an expense split to a hisaab entry (e.g. "I paid ₹1000, ₹400 of it was for Raj").

**Where:** `app/hisaab/persons.tsx`, `app/hisaab/ledger.tsx`

**Full detail file:** [`.context/features/hisaab.md`](features/hisaab.md)

---

## 8. SMS Auto-Detection ⚠️

**What it does:** Reads bank/wallet SMS from your phone, recognizes the transaction (14+ private banks, 11 PSU banks, EPFO, wallets, plus any custom templates you've taught it), and creates a pending expense/credit for you to approve. You can also teach it new SMS formats it doesn't recognize yet ("Smart SMS Templates").

**Where:** `app/expense/review-queue.tsx` (approve/reject), `app/settings/sms-templates/` (teach new formats), `app/settings/sms-scan-runs.tsx` (diagnostic log of every SMS the last scan processed, including ones it skipped/ignored)

**Full detail file:** [`.context/features/sms-pipeline.md`](features/sms-pipeline.md)

---

## 9. Insights & Analytics

**What it does:** Spending patterns, lifestyle-creep year-over-year tracking, merchant breakdown, period comparison, forecast, and "insight" cards that surface specific findings (overspend, win, spending leak, etc.) you can drill into.

**Where:** `app/insights/index.tsx`, `app/insights/compare.tsx`, `app/insights/forecast.tsx`, `app/insights/merchants.tsx`, `app/insights/patterns.tsx`, `app/insights/insight-detail.tsx`, `app/insights/filtered.tsx`

**Technical:** `services/insight-engine.ts` (generates the insight cards), `services/comparison-insights.ts`, `services/spending-insights.ts`, `services/financial-cockpit.ts`, `services/analytics/*` (classifier, pattern-learner, data-layer, lifecycle — the newer analytics engine that insight-engine and forecasting both draw from).

---

## 10. Cash-flow Simulator

**What it does:** Named "what-if" scenarios with planned future transactions (money going out, coming in, or being collected/paid back). The simulator tries to automatically match a planned entry to a real transaction once it happens ("fulfillment"), and flags entries that look stale (planned date long past, never fulfilled).

**Where:** `app/simulator/index.tsx` (scenario list), `app/simulator/[id].tsx` (scenario detail)

**Technical:** `services/simulator.ts` (DB layer — CRUD, fulfillment reconciliation, retention/cleanup), `services/simulator-engine.ts` (pure calculation functions, unit-testable without a DB). If a planned entry isn't auto-matching a real transaction, the matching logic lives in `simulator-engine.ts`'s fulfillment-candidate functions.

---

## 11. Backup & Restore ⚠️

**What it does:** Exports your entire database to an encrypted file you can save and restore from later. This is the only way data leaves the device.

**Where:** `app/settings/backup-restore.tsx`

**Full detail file:** [`.context/features/backup-restore.md`](features/backup-restore.md)

**The one thing to know:** if something is missing *specifically* after a restore (not before), the cause is almost always a column or table that got left out of the restore's whitelist — not a bug in your data.

---

## 12. Settings

**What it does:** Catch-all for configuration: account management, categories/tags/payment modes, Smart Rules, SMS templates, security (biometric lock), notifications, region/currency/date format, recurring reminders, recycle bin (soft-deleted items, 30-day auto-purge), audit log, Kite Connect (Zerodha) integration, Excel import.

**Where:** everything under `app/settings/`

**Technical:** mostly thin CRUD wrappers — `services/category.ts`, `services/payment-mode.ts`, `services/tags.ts`, `services/settings.ts`, `services/biometric-lock.ts`, `services/notifications.ts` / `notification-scheduler.ts`, `services/locale-preferences.ts`, `services/recurring-rules.ts`, `services/data-cleanup.ts`, `services/audit-log.ts`, `services/kite-connect.ts`, `services/excel-import.ts`.

---

## 13. Onboarding & Lock Screen

**What it does:** First-run flow (welcome, SMS permission consent) and the biometric/passcode lock shown on app open.

**Where:** `app/(onboarding)/`, `app/(lock)/`

**Technical:** `services/onboarding.ts`, `services/biometric-lock.ts`.

---

## 14. Monthly Summary

**What it does:** A single month's narrative summary — income, spend, savings rate, category breakdown.

**Where:** `app/summary/`

**Technical:** Reads through `services/spend-classification.ts` (shared with Budget's Spending Split — they're required to agree).

---

## Documentation map

| Need | File |
|---|---|
| Architecture, stack, patterns | `.context/ARCHITECTURE.md` |
| Database schema & migrations | `.context/DATABASE_SCHEMA.md` |
| Every service file and its purpose | `.context/SERVICES_MAP.md` |
| Design system (colors, spacing, components) | `.context/DESIGN_SYSTEM.md` |
| Build & release process | `.context/BUILD_AND_RELEASE.md` |
| Code conventions & templates | `.context/CONVENTIONS_AND_PATTERNS.md` |
| Testing | `.context/TESTING_STRATEGY.md` |
| Deep-dive on the 5 historically-buggiest areas | `.context/features/*.md` |
| Verified, still-open bugs (from the May 2026 audit) | `.context/KNOWN_ISSUES.md` |
| Incident history / "what not to do" | `CLAUDE.md` (root) |
