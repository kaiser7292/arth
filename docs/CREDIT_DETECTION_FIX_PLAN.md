# Credit Detection Fix — Plan & Progress Tracker

**Status:** Code complete — awaiting on-device verification
**Started:** 2026-04-21
**Goal:** Fix 3 bugs in credit detection by migrating credits into the `expenses` table with `nature='credit'`, routing SMS credits through the universal review queue, and eliminating the `account_credits` table.

---

## Bugs Being Fixed

| # | Bug | Severity |
|---|-----|----------|
| 1 | Refunds double-count: subtracted as expense AND added as credit, net = 0 | High |
| 2 | Credit SMS bypasses universal review queue — silently updates balances | High |
| 3 | Credit SMS creates phantom accounts with no user review | Medium |

## Design Decisions (Locked)

1. **`nature='credit'`** — extend the existing `nature` column on `expenses` (current values: `realized`, `forecast`)
2. **Migrate `account_credits` → `expenses`** — convert all historical rows (manual + SMS)
3. **Refunds become credits** — flip `nature` from `realized` to `credit` for all rows with `refund_of_expense_id IS NOT NULL`
4. **SMS credits go through review queue** — inserted as `status='pending_review'`, no account creation until approved
5. **Drop `account_credits` table** — after successful migration
6. **Rename `expenses` → `transactions`** — deferred to a separate future session (purely cosmetic; doesn't block this fix)

---

## Impact Analysis

### Database
| Table | Change |
|-------|--------|
| `expenses.nature` | Add `'credit'` as valid value (no CHECK constraint, so no schema change needed — just doc) |
| `account_credits` | Data migrated into `expenses`, then table dropped |
| `hisaab_entries.linked_account_credit_id` | Must be repointed to new `expenses.id` via id-map during migration, then column deprecated |
| `account_transfers.linked_expense_id` / related | Audit usages of `account_credits` FK; migrate to `expenses` |

### Files with SQL filter `nature = 'realized'` (30+ queries in 15 files)

Each query must be audited: does this view want **expenses only**, or **expenses + refunds/credits** (net spend)?

| File | Queries | Decision |
|------|---------|----------|
| `services/savings-tracker.ts` | 3 | Keep `='realized'` — savings math uses spend only |
| `services/expense-queries.ts` | 11 | **Mixed** — some list views should show only realized; totals may want net. Audit each. |
| `services/insight-engine.ts` | 8 | Keep `='realized'` — insights are about spending patterns |
| `services/spending-insights.ts` | 12 | Keep `='realized'` — same reason |
| `services/comparison-insights.ts` | 6 | Keep `='realized'` |
| `services/analytics-forecast.ts` | 4 | Keep `='realized'` |
| `services/analytics/forecast-engine-v2.ts` | 1 | Keep `='realized'` |
| `services/analytics/lifecycle.ts` | 1 | Keep `='realized'` |
| `services/financial-cockpit.ts` | 3 | Keep `='realized'` |
| `services/financial-account.ts` | 1 | Keep — account expense totals |
| `services/duplicate-detection.ts` | 2 | Keep — duplicate detection is spend-side |
| `services/expense-forecasts.ts` | 11 | Keep `='realized'` / `='forecast'` — forecast promotion needs realized |
| `services/account-transfer.ts` | 1 | Keep `='realized'` |
| `services/forecast-engine.ts` | 4 | Keep `='realized'` |
| `services/recurring-detector.ts` | 1 | Keep `='realized'` |
| `services/account-balance.ts` | 2 | **Audit** — `getAccountExpensesTotal` (keeps realized-only), `getAccountCreditsTotal` (rewrite to pull from `expenses WHERE nature='credit'`) |
| `app/expense/review-queue.tsx` | 3 filters | **Change** — add credit items to review queue |
| `app/insights/forecast.tsx` | 1 | Keep `='realized'` |

**Default rule:** keep `='realized'` everywhere (expenses-only semantics). Only change balance math in `account-balance.ts` and review queue.

### `account_credits` table usages (files to update or delete logic from)
- `services/account-credit.ts` — full CRUD service → rewrite to operate on `expenses` table
- `services/financial-account.ts` — `handleCreditReceived`, `DELETE FROM account_credits` in data cleanup
- `services/account-balance.ts` — `getAccountCreditsTotal`, date range query, delete manual credits
- `services/account-transfer.ts` — joins `account_credits` for transfer detection; `DELETE` on revert
- `services/hisaab.ts` — `linked_account_credit_id` create/delete paths
- `services/data-cleanup.ts` — `DELETE FROM account_credits WHERE account_id = ?`
- `services/backup.ts` — `BACKUP_TABLES` includes `account_credits`
- `database/TABLE_SCHEMAS.ts` — schema registry
- `app/reconciliation/account-ledger.tsx` — UI uses `getCreditsForMonth`, `addCredit`, `updateCredit`, `deleteCredit`

### Types
- `services/expense-types.ts` — `Expense.nature` union: add `"credit"`
- `components/expense/ExpenseHeroCard.tsx` — same union

### SMS flow
- `services/sms/sms-to-expense.ts:57-65` — credit SMS branch: insert into `expenses` with `nature='credit'`, `status='pending_review'`, skip `discoverOrUpdateAccount` (only run on approve)
- `services/sms/sms-to-expense.ts:138-171` — refund branch: change `nature` from `'realized'` to `'credit'`

### Approve/reject flow
- `services/expense-crud.ts` (or wherever `status='pending_review' → 'approved'` happens) — on approval of a `nature='credit'` row, call `discoverOrUpdateAccount` + `linkExpenseToAccount`

### UI
- `app/expense/review-queue.tsx` — render credit items with green `+₹X` and "Credit received" label
- `components/expense/ReviewQueueItem.tsx` — branch on `nature === 'credit'`
- `components/expense/ExpenseListItem.tsx` — same
- `components/expense/ExpenseMetadata.tsx` — same
- `app/expense/[id].tsx` — detail screen branches on nature
- `app/reconciliation/account-ledger.tsx` — rewrite credit list source from `account_credits` to `expenses WHERE nature='credit'`

### Tests to update
- `__tests__/integration/expense.test.ts` — nature-filter tests
- `__tests__/integration/forecast-matching.test.ts` — uses nature values
- `__tests__/integration/v4-cross-feature.test.ts`, `v5-cross-feature.test.ts`
- `__tests__/unit/v4-transaction-time.test.ts`

### Bug 1 fix status
Already applied (`refund_of_expense_id IS NULL` filter added to `getAccountExpensesTotal` + `getLedgerExpenses`). **Will be partially reverted** once refunds become `nature='credit'` — the nature filter makes the refund-id filter redundant. Net correctness preserved.

---

## Execution Phases

### Phase 1 — Types & contracts (no runtime impact)
- [ ] 1.1 Update `Expense.nature` union in `services/expense-types.ts`
- [ ] 1.2 Update `ExpenseHeroCard` nature prop type
- [ ] 1.3 `npx tsc --noEmit` — expect no new errors (union widening is compatible)

### Phase 2 — Migration 005: schema + data
- [ ] 2.1 Write `database/migrations/005_credits_into_expenses.ts`:
  - Insert `account_credits` rows → `expenses` with `nature='credit'`, preserve id (for FK compat)
  - Preserve `deleted_at`, `source`, `user_id`, `account_id`, `amount`, `description`, `date`
  - Set `status='approved'` (existing credits are already applied to balances)
  - Flip refunds: `UPDATE expenses SET nature='credit' WHERE refund_of_expense_id IS NOT NULL`
  - Repoint hisaab FKs: `UPDATE hisaab_entries SET linked_expense_id = linked_account_credit_id WHERE linked_account_credit_id IS NOT NULL`
  - **Don't drop `account_credits` yet** — leave for Phase 7 (safety: can roll back)
- [ ] 2.2 Register in `database/migrations/index.ts`

### Phase 3 — Balance math (the core fix)
- [ ] 3.1 Rewrite `getAccountCreditsTotal` in `services/account-balance.ts` to query `expenses WHERE nature='credit' AND status='approved'`
- [ ] 3.2 **Revert** the `refund_of_expense_id IS NULL` filter in `getAccountExpensesTotal` and `getLedgerExpenses` (now redundant because refunds are `nature='credit'`, not `realized`)
- [ ] 3.3 Rewrite the earliest-transaction-date query (line 389) to use `expenses WHERE nature='credit'` instead of `account_credits`
- [ ] 3.4 Remove `DELETE FROM account_credits` in balance reset (line 336) — no-op after migration, but keep for the still-existing empty table
- [ ] 3.5 Run `jest` on `__tests__/unit/financial-account.test.ts` and any account-balance tests

### Phase 4 — SMS credit flow (fixes Bugs 2 & 3)
- [ ] 4.1 Update `services/sms/sms-to-expense.ts` credit branch (line 58-65):
  - Insert into `expenses` with `nature='credit'`, `status='pending_review'`
  - **Do NOT** call `discoverOrUpdateAccount` (deferred to approval)
  - Store `cardLast4` + `bank` in `raw_source_text` or dedicated fields so approval can resolve the account
- [ ] 4.2 Update refund branch (line 138-171): change `nature` from `'realized'` to `'credit'`
- [ ] 4.3 `buildDescription` — add credit branch

### Phase 5 — Approve flow
- [ ] 5.1 Find the approve function in `services/expense-crud.ts` (or wherever)
- [ ] 5.2 On approve of `nature='credit'` row: resolve account via `discoverOrUpdateAccount` (use stored bank + cardLast4), then `linkExpenseToAccount`
- [ ] 5.3 Confirm rejection path deletes correctly

### Phase 6 — Manual credit & hisaab flows
- [ ] 6.1 Rewrite `services/account-credit.ts`: all CRUD operates on `expenses WHERE nature='credit'`
- [ ] 6.2 Update `services/financial-account.ts` `handleCreditReceived` — insert into `expenses` not `account_credits`
- [ ] 6.3 Update `services/hisaab.ts` — use `linked_expense_id` instead of `linked_account_credit_id`
- [ ] 6.4 Update `services/account-transfer.ts` — credit join + revert delete logic
- [ ] 6.5 Update `services/data-cleanup.ts`, `services/backup.ts`, `database/TABLE_SCHEMAS.ts`

### Phase 7 — UI
- [ ] 7.1 `app/expense/review-queue.tsx` — include `nature='credit'` in items, render distinctly (green badge, "Credit received")
- [ ] 7.2 `components/expense/ReviewQueueItem.tsx` — branch on credit nature
- [ ] 7.3 `components/expense/ExpenseListItem.tsx` — credit display
- [ ] 7.4 `components/expense/ExpenseMetadata.tsx` — credit-specific metadata
- [ ] 7.5 `app/expense/[id].tsx` — detail screen credit handling
- [ ] 7.6 `app/reconciliation/account-ledger.tsx` — source credits from new API

### Phase 8 — Tests
- [ ] 8.1 Update existing nature tests for new union
- [ ] 8.2 Add regression test: ₹1000 spend + ₹300 refund → closing = opening − 700
- [ ] 8.3 Add regression test: SMS credit → `expenses` row with `pending_review` status
- [ ] 8.4 Add regression test: credit approval creates/links account
- [ ] 8.5 Add regression test: credit rejection does NOT create account
- [ ] 8.6 `npx jest` full run

### Phase 9 — Drop `account_credits` table (optional, defer until Phase 8 green on-device)
- [ ] 9.1 Migration 006: drop table + indexes + hisaab FK column
- [ ] 9.2 Remove from `BACKUP_TABLES`, `TABLE_SCHEMAS`

### Phase 10 — QA
- [ ] 10.1 `npx tsc --noEmit` — zero errors
- [ ] 10.2 `npx jest` — green
- [ ] 10.3 Review post-change checklist (per global CLAUDE.md feedback_post_change_checklist)
- [ ] 10.4 Build APK and test on device (user-initiated per project rules)

---

## Session Log

| Date | Phase | Notes |
|------|-------|-------|
| 2026-04-21 | Pre-plan | Bug 1 quick fix applied directly to `services/account-balance.ts` (refund filter). Will be partially reverted in Phase 3. |
| 2026-04-21 | Plan | This document created. Impact analysis done across ~30 SQL queries + 15 files + UI + hisaab FK. |
| 2026-04-21 | P1–P8 done | Types widened, migration 005 added, balance math rewritten, SMS credit → review queue, approve flow resolves account for credits, manual credit CRUD migrated to expenses, hisaab/transfer/ledger services updated, review queue shows credits with green +amount + CREDIT badge, database migration tests updated to expect 5 migrations. |
| 2026-04-21 | QA done | `tsc --noEmit`: 0 new errors (2 pre-existing in backup.ts unrelated). `jest`: 990 pass / 21 fail — all 21 are pre-existing on main; this change introduces 0 regressions and fixes 4 database test failures. |
| 2026-04-21 | Pattern bug | Root cause found: `detectRecurringTransactions` (populates the `recurring_transactions` table that the Patterns UI reads from) was never called at runtime. Only `detectNewPatterns` (writes to separate `expense_classifications` table) runs on startup. Fixed by adding `detectRecurringTransactions` calls to `initClassificationSystem` and `refreshClassifications`. Three additional smaller bugs also identified (see Pattern Recognition section below). |

---

## Pattern Recognition Bugs (Separate Track)

### Root Cause
Two parallel pattern systems exist:
- `recurring_transactions` table — what the Patterns screen (`app/insights/patterns.tsx`) displays
- `expense_classifications` table — what `pattern-learner.ts` writes to (used by forecast engine)

They were never bridged at write-time. `initClassificationSystem` only ran `detectNewPatterns` (classifications), so **no patterns ever appeared in the UI**.

### Fixed
1. ✅ **Historic data not recognized** — added `detectRecurringTransactions(userId)` to `initClassificationSystem` and `refreshClassifications` ([services/analytics/lifecycle.ts](../services/analytics/lifecycle.ts)). Historic expenses now become visible patterns on next app launch.

### Not Fixed (smaller bugs — surfaced for separate session)
2. ❌ **"Set up manually →" button is a no-op** — [app/insights/patterns.tsx:127-134](../app/insights/patterns.tsx#L127-L134) has empty `onPress={() => {}}`. Manual pattern creation flow doesn't exist.
3. ❌ **`variable` / unrecognized-frequency patterns hidden** — [app/insights/patterns.tsx:239-247](../app/insights/patterns.tsx#L239-L247) `groupPatterns` only shows monthly/yearly/weekly/quarterly. Any other frequency silently dropped.
4. ❌ **Two pattern systems drift apart** — new patterns from classifier don't appear in recurring_transactions and vice versa. Longer-term: unify into one table.

---

## Post-Fix Audit: Downstream Menus (2026-04-21)

User-requested audit of goals, recycle bin, backup, cleanup. Findings:

### Fixed
1. ✅ **Recycle bin — deleted credits double-listed** — credits (nature='credit') appeared in BOTH the Deleted Expenses section AND the Credits section. Fixed [services/expense-crud.ts:200](../services/expense-crud.ts#L200) `getDeletedExpenses` and [:212](../services/expense-crud.ts#L212) `getRejectedExpenses` to filter `nature != 'credit'`.

### Verified safe (no change needed)
2. ✅ **Goals / Savings tracker** — [services/savings-tracker.ts](../services/savings-tracker.ts) filters `nature='realized'` on all SQL. Credits naturally excluded from savings-rate math.
3. ✅ **Life milestones** — doesn't query the expenses table.
4. ✅ **Backup** — backs up `expenses` table in full via column-agnostic string copy; credits included automatically.
5. ✅ **Budgets** — all budget/spending queries in [spending-insights.ts](../services/spending-insights.ts), [expense-queries.ts](../services/expense-queries.ts), [insight-engine.ts](../services/insight-engine.ts) filter `nature='realized'`. Credits do not reduce budget counts (per user requirement).
6. ✅ **Hisaab export PDF/Excel** — Dr/Cr terminology is unrelated ledger-speak. Not affected.
7. ✅ **Data cleanup by account** — unlinks expenses (including credits) via `UPDATE expenses SET account_id = NULL` at [data-cleanup.ts:497](../services/data-cleanup.ts#L497). `DELETE FROM account_credits` on line 492 is a harmless no-op post-migration.
8. ✅ **Data cleanup "clear expenses"** — now also clears credits (they live in same table). Acceptable — matches user intent of "clear all expenses".
9. ✅ **Recurring detector** — filters `nature='realized'`. Credits won't be mis-detected as recurring subscriptions.

### Still open (non-blocking, smaller gaps)
10. ❌ **Expense detail screen** ([app/expense/[id].tsx](../app/expense/[id].tsx)) — credits open the same detail UI as expenses, showing Split / Right-spend / Category actions that don't make sense for credits. Fix: branch on `expense.nature === 'credit'` and render a simpler credit detail view. Deferred to a follow-up session.
11. ❌ **Legacy `DELETE FROM account_credits` statements** in [financial-account.ts:519](../services/financial-account.ts#L519) and [data-cleanup.ts:492](../services/data-cleanup.ts#L492) — harmless no-ops today; will be removed in Phase 9 cleanup migration.
12. ❌ **`linked_account_credit_id` column** on `hisaab_entries` — populated by legacy data only; new hisaab settlements write to `linked_expense_id` (already fixed). Column drop deferred to Phase 9.

---

## Comprehensive Audit (2026-04-21) — Deep Dive

Second audit pass covering edge cases, data integrity, and less obvious coupling.

### Fixed
- **Finding F (backup/restore orphans credits)** — Legacy backups pre-migration-005 contain rows in `account_credits`. Restore clears tables, imports old data, but migrations already ran on empty DB so there's nothing to promote. Result: restored credits invisible. Fixed [services/backup.ts](../services/backup.ts) by re-running migration 005 logic in a post-restore hook (safe: uses `INSERT OR IGNORE` + idempotent UPDATEs).
- **Finding G (hard-delete of credit FK constraint)** — `hardDeleteCredit` and `purgeAllDeletedCredits` didn't clear hisaab FK references before DELETE, risking FK constraint failure when a credit linked to a settlement is purged. Fixed [services/account-credit.ts](../services/account-credit.ts): clear `linked_expense_id` and `linked_account_credit_id` first.
- **Finding H (permanentlyDeleteExpense missing legacy FK)** — Could fail for migrated credits still referenced via legacy `linked_account_credit_id`. Fixed [services/expense-crud.ts](../services/expense-crud.ts) `permanentlyDeleteExpense`, `purgeOldDeletedExpenses`, and [services/data-cleanup.ts](../services/data-cleanup.ts) expense-cleanup path.
- **Finding B (merchant-alias pollution)** — Credit merchants (salary senders, UPI payer names) appearing in merchant dropdown for regular expenses. Fixed [services/merchant-alias.ts:324](../services/merchant-alias.ts#L324) to filter `nature != 'credit'`.

### Verified safe (no change needed)
- **Forecast engine** ([services/forecast-engine.ts](../services/forecast-engine.ts)) — all queries filter `nature='realized'`. Credits excluded from forecast math.
- **Duplicate detection for realized** — filters `nature='realized'`. Credits not scanned (acceptable — rare; logged as gap #13 below).
- **Financial cockpit, spending/comparison insights, lifecycle analytics** — all filter `nature='realized'`.
- **Excel import, seed data, splits** — explicitly write `nature='realized'` or default to it.
- **Findings D (source CHECK), E (refund target)** — checked and confirmed safe.
- **Migration 005 idempotency** — uses `INSERT OR IGNORE` + WHERE clauses that prevent double-flip. Safe to re-run (which the post-restore hook now does).

### Still open (non-blocking)
~~13-16 completed below.~~

---

## Follow-Up Pass (2026-04-21) — Closing Remaining Opens

### Fixed
13. ✅ **Duplicate detection for credits** ([services/duplicate-detection.ts](../services/duplicate-detection.ts)) — realized scan now includes `nature IN ('realized', 'credit')`. Group key includes nature so a debit and credit with matching amount/date don't collide.
14. ✅ **Category delete guard counts credit** — split into `getCategoryExpenseCount` (realized only, for user-facing messages) and `getCategoryLinkedRowCount` (all natures, for FK safety on hard-delete). [services/category.ts](../services/category.ts).
15. ✅ **Data-cleanup credits scope** — added `"credits"` as a separate `CleanupObjectType`. Expenses scope now excludes credits; credits scope handles them independently. UI updated [app/(tabs)/settings.tsx](../app/(tabs)/settings.tsx) with a dedicated "Credits (Salary, Refunds)" chip. FK cleanup (hisaab `linked_expense_id` + legacy `linked_account_credit_id`) handled in both paths.
16. ✅ **Expense detail screen branches for credits** — Spend Classification section and entire Split section hidden for `nature === 'credit'` rows. Forecast actions and Mark-as-Transfer already nature-guarded. Credits now show a simpler read-only view appropriate for income entries.

### Splits / Hisaab / Account Ledger Audit (user-requested)

**Splits** — [services/expense-splits.ts](../services/expense-splits.ts) only writes `nature='realized'`. Credits cannot be split (by design). No issue.

**Hisaab ledger** — `enrichEntriesFromExpenses` ([services/hisaab.ts:440](../services/hisaab.ts#L440)) correctly fetches linked credit rows via `linked_expense_id` (repointed in migration 005). Hisaab PDF/Excel exports use their own `hisaab_entries` columns, no expense-side join. Safe.

**Account ledger (savings)** — [app/reconciliation/account-ledger.tsx](../app/reconciliation/account-ledger.tsx) correctly routes debits through `getLedgerExpenses` (filters `nature='realized'`), and credits through `getCreditsForMonth` (filters `nature='credit'`). No double-count risk. Opening − Expenses + Credits = Closing math is correct.

**Account ledger (credit card)** — Same query path as savings. Math works: opening (available limit) − spends + payments = new available limit. ✓

### Pre-existing gap (not fixed, flagged for separate session)
17. ❌ **CC bill payments invisible in ledger** — `payment_received` SMS type ([sms-to-expense.ts:107](../services/sms/sms-to-expense.ts#L107)) updates `total_due` and `last_known_balance` directly, but doesn't create a ledger entry. Result: a user viewing CC account ledger doesn't see their ₹25,000 bill payment — only the individual spends that reduced the limit. Pre-existing design; fix would require creating a `nature='credit'` row on payment receipt (similar to how we handle account credits). Deferred to a dedicated CC ledger session.

### Final QA
- `tsc --noEmit`: 0 new errors (2 pre-existing in backup.ts)
- `jest`: 990 pass / 21 fail — all 21 pre-existing on main. **Zero regressions introduced by this full credit detection fix.**

---

## Rollback Strategy

- **Phase 2 migration is additive** — new rows in `expenses`, no deletes. If broken, stop running it (user can reinstall previous APK, data intact).
- **Phase 9 (drop table) is irreversible** — only execute after Phase 8 tests pass on-device and user gives green light.
- **Backup files** — any backup taken before Phase 2 will still restore, but won't contain the new credit rows. After Phase 9, old backup files become invalid (can't restore dropped table).

---

## Open Questions

- None currently. User approved the plan on 2026-04-21.
