# MASTER PLAN V17

**Target versions:** v17.0.0 → v17.3.0
**Source docs:** PRD_V17.md, TDD_V17.md, PROPOSAL_V17_loans_and_investments.md

## Session status

| Milestone | Status |
|---|---|
| v17.0.0 — foundation (Part 1 complete + loan schema + Add Loan + read-only detail) | Pending |
| v17.1.0 — prepayment + foreclosure + what-if | Pending |
| v17.2.0 — SMS EMI auto-match + notifications | Pending |
| v17.3.0 — debt-reduction bucket + Yearly Plan + simulator + FX | Pending |

## v17.0.0 tasks (current)

- [ ] Migration 028 — `expense_investment_links`
- [ ] Migration 029 — `loan_accounts` + `loan_schedule_entries` + `loan_prepayments`
- [ ] `services/loan-engine.ts` — pure math
- [ ] `__tests__/unit/loan-engine.test.ts` — validate against Axis PDF 60-row schedule
- [ ] `services/expense-investment-link.ts` — CRUD
- [ ] `services/loan-accounts.ts` — CRUD + schedule generation + outstanding computation
- [ ] `services/yearly-plan.ts` — extend `recomputeBucketContributed`
- [ ] `services/budget.ts` — exclude linked expenses from category spending
- [ ] `services/insight-engine.ts` — exclude linked from spending/creep/forecast
- [ ] `services/balance-sheet.ts` — live loan outstanding for loans with `loan_accounts` row
- [ ] `services/smart-rules.ts` — `link_to_investment_bucket` action
- [ ] `services/backup.ts` + `database/TABLE_SCHEMAS.ts` — 4 new tables
- [ ] `services/feature-flags.ts` — `v17_expense_investment_link`, `v17_loans_v1`
- [ ] `components/expense/InvestmentBucketPickerSheet.tsx`
- [ ] `components/home/LoansSummary.tsx`
- [ ] `app/expense/[id].tsx` — Mark as Investment action + linked badge
- [ ] `app/goals/investment-detail.tsx` — Contributions from expenses section
- [ ] `app/(tabs)/budget.tsx` — Tracked via Buckets strip
- [ ] `app/(tabs)/index.tsx` — Loans card
- [ ] `app/loans/_layout.tsx`, `index.tsx`, `[id].tsx`, `add.tsx` — new stack
- [ ] `constants/routes.ts` — allowlist loans routes
- [ ] Tests — expense-link + loan-accounts + database migration counts
- [ ] Bump app.json 16.0.9 → 17.0.0, versionCode 160009 → 170000
- [ ] Commit `feat(v17.0.0): loans + expense→investment linking`

## v17.1.0 tasks

- [ ] `services/loan-engine.ts` — `applyPrepayment` + `computePrepaymentCharge` + `computeForeclosureQuote` + `computePrepaymentImpact`
- [ ] `services/loan-accounts.ts` — `recordPrepayment`, schedule regen
- [ ] `components/loans/PrepaymentSheet.tsx`
- [ ] `components/loans/ForeclosureQuoteSheet.tsx`
- [ ] `components/loans/WhatIfCalculator.tsx`
- [ ] `app/loans/[id].tsx` — wire in prepayment + foreclose + what-if
- [ ] Tests — prepayment math + regen + charge calc
- [ ] Bump to 17.1.0
- [ ] Commit `feat(v17.1.0): loan prepayment + foreclosure calc`

## v17.2.0 tasks

- [ ] `services/sms/sms-templates.json` — add EMI debit templates
- [ ] `services/loan-sms-matcher.ts` — match SMS debit to loan schedule
- [ ] `services/sms/sms-to-expense.ts` — wire matcher into realize path
- [ ] `services/notification-scheduler.ts` — EMI due + overdue checks
- [ ] Tests
- [ ] Bump to 17.2.0
- [ ] Commit `feat(v17.2.0): SMS EMI auto-match + notifications`

## v17.3.0 tasks

- [ ] Migration 030 — `bucket_type` + `linked_loan_account_id`
- [ ] `services/yearly-plan.ts` — debt-reduction bucket support, debt metric
- [ ] `services/financial-cockpit.ts` — debt-reduced YTD metric
- [ ] `services/simulator.ts` + engine — prepayment planned entries
- [ ] FX rate UI on loans for non-INR display
- [ ] Tests
- [ ] Bump to 17.3.0 (MINOR → MAJOR if combining) → I'm bundling into **17.3.0** as MINOR with 4 new capabilities under the same feature umbrella
- [ ] Commit `feat(v17.3.0): debt reduction tracking + simulator prepayment + FX`
- [ ] Full pipeline: push + `gh release v17.3.0` + APK + upload

## Build convention (v17)

- Each milestone is ONE commit on `main`.
- No push / release / APK build until v17.3.0 is complete.
- Final pipeline runs ONCE after 17.3.0 commit lands.
