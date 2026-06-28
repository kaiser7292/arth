# Loans

[← back to Feature Map](../FEATURE_MAP.md)

## In plain English

For each loan you add, the app builds a full month-by-month payment schedule (amortization) up front — how much of each EMI is interest vs. principal, and what's left owing after each payment. As real EMI debits come in (manually or via SMS), they get matched against this schedule.

Two ways to make an extra payment beyond your normal EMI ("prepayment"):
- **Reduce tenure** — keep paying the same EMI amount, but finish the loan sooner.
- **Reduce EMI** — keep the original end date, but lower the EMI amount going forward.

If you ever need to manually correct the numbers (e.g. the bank's actual outstanding amount doesn't match what the app calculated), you can enter a **manual correction** at a specific date. Everything calculated *after* that date uses the correction as its new starting point — the app doesn't try to recalculate anything before it.

A **foreclosure quote** estimates what it would cost to pay off the loan entirely right now, including any prepayment waiver rules the bank applies (e.g. no penalty after N months, or only above a minimum amount).

## Technical

**Files:**
- `services/loan-engine.ts` — pure math, no database. `generateSchedule` (the amortization table), `applyPrepayment` (reduce_tenure / reduce_emi strategies, plus a trivial short-circuit path when ≤ 1 EMI remains), `computeOutstandingAt` (walks forward from the latest applicable manual correction, or from loan origin if none exists — only applies prepayments/installments *after* that correction date, since everything before it is already baked into the correction's `outstanding_principal`). All rupee math is rounded at the rupee level, not float-precision.
- `services/loan-accounts.ts` — CRUD, schedule rebuild orchestration, correction CRUD, outstanding-balance queries. All schedule-mutating operations run inside a DB transaction.
- `services/loan-sms-matcher.ts` — matches an SMS-detected debit to the right installment.
- `services/loan-emi-reminder.ts` — EMI due-date reminders.
- `services/loan-account-merge.ts` — merges duplicate loan records (e.g. if you accidentally created the same loan twice).

**Screens:** `app/goals/loans.tsx` (list), `app/loans/add.tsx`, `app/loans/[id].tsx` (schedule + corrections + prepayment UI).

**Tables:** loan-specific columns live on `financial_accounts` (account_type = `loan`) plus dedicated loan schedule/correction tables added across migrations 029, 032–035, 039, 043, 050–051 — check `database/migrations/` by number if you need the exact column list for a specific loan feature.

**Don't:** recalculate schedule entries *before* a manual correction date — the correction is the new ground truth for everything up to that point; only the math after it should move.
