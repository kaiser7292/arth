# Artha V12 — MASTER PLAN

> **Stabilization Release: Audit Remediation + Functional Gap Fixes**
> 6 phases | Version 11.2.0 → 12.0.0

---

## SESSION LOG

| # | Session Date | Tasks Completed | Notes |
|---|-------------|-----------------|-------|
| 1 | 2026-04-23 | V11.2.0 commit: account_id bugfix + FilterSummaryCard (F1 seed) + 3 credit-card enhancements (in-flight) | See "In-Flight Work Folded Into V11.2.0" below |
| 2 | 2026-04-23 | **Phase 0 complete** — A1 (split cascade on purge), A2 (bump on purge), A3 (bump on merchant rename), A4 (dead deep link removed), B1 (ErrorBoundary __DEV__ guard), B2 (password validation alignment, MIN_PASSWORD_LENGTH=8 exported) | 6 items, one commit, no release |
| 3 | 2026-04-23 | **Phase 1 complete** — C1 (batched getComputedBalances: 5×N → 5 queries), C2 (batched getAllAccountsWithModes: N+1 → 2 queries), C3 (useMemo maps + useCallback render/handlers), C4 (React.memo ExpenseListItem + new ExpenseListRow wrapper), C5 (explicit column projection on getExpensesPaginated, ~3× row-size reduction) | 5 items, one commit |
| 4 | 2026-04-23 | **Phase 2 complete** — D1 (3 Pressable Save → Button: tags, merchant-aliases, account-ledger), D2 (conditional colorScheme hex duplicates replaced with theme tokens in ExportFormatPicker + ConfidenceDots; WaterfallBar/MoneyWaterfall left alone — semi-transparent overlays not duplicates), D3 (new <EmptyState> component + 4 call sites adopted), D4 (reconciliation/index + advisor/index switched to <Card>) | 4 items, deferred: remaining ~10 EmptyState sites + 3 complex modal Card refactors |
| 5 | 2026-04-23 | **Phase 3 partial** — E1 done (migration 006 drops sms_rules; removed from TABLE_SCHEMAS + BACKUP_TABLES). E2 deferred (users table has ~15 FK constraints, too invasive). E3 partial (removed 4 truly-unused settings exports + 2 orphaned MMKV keys; test-only exports deferred). | Migration 006 added |
| 6 | 2026-04-23 | **Phase 4 partial** — F2 already satisfied (no status filter to add); F3 hisaab soft-delete bug CONFIRMED + FIXED on all 3 balance queries; F1 partial (recycle bin "Total at Risk" banner); F4 `<DateRangeChips>` component built + exported, wiring deferred; F5 deferred to V13 roadmap. | Hisaab balance correctness bug fixed |
| 7 | 2026-04-23 | **Phase 5 complete** — F6 stale backup warning (home banner + MMKV state + dismissal); F7 verified already correct (no fix); F8 verified already satisfied; F9 MoM trend on FilterSummaryCard (new `getPreviousPeriodTotal` + UI delta); F10 deferred (pure refactor). | Phase 5 done |

## CURRENT STATE

```
PHASE: V12 CONTENT COMPLETE — awaiting build (commit/push/release/APK) together
NEXT TASK: Build pipeline when user triggers
TESTS: 1047 (baseline)
MIGRATIONS: 005 → 006 (sms_rules dropped)
VERSION: 11.2.0 → 12.0.0 (bump on build)
```

---

## In-Flight Work Folded Into V11.2.0 (pre-V12 baseline)

The following was already in-flight in the working tree when V12 was planned. Committed together as **11.2.0**, NOT counted as V12 tasks:

1. **Manual expense account-id save bug fix** — `services/expense-crud.ts` — `createExpense` INSERT was missing `account_id` column/value
2. **Filtered Total card (option C)** — `components/expense/FilterSummaryCard.tsx` + `app/(tabs)/expenses.tsx` — sum + groupBy breakdown on filtered expense list
3. **Credit-cards screen — "Utilized" line per bank section** — sum of card Tracked Spends shown on each bank
4. **Credit-cards screen — period selector minMonth considers sibling cards for shared-limit CCs**
5. **Reset ledger → "Adjust available"** — user enters actual balance, app creates a debit/credit adjustment entry
6. **Other small fixes** across `hisaab/ledger.tsx`, `reconciliation/account-ledger.tsx`, `demat-portfolio.tsx`, `services/account-balance.ts`, `services/hisaab.ts`, `services/sms/sms-to-expense.ts`

**Build:** skipped for 11.2.0. Build happens after V12 completes, shipping 11.2.0 + V12 together as **12.0.0**.

---

## MANDATORY BEHAVIORS

1. Read this file at session start and after context compaction
2. Update SESSION LOG after every task
3. Update CURRENT STATE after every task
4. Mark checkboxes [x] as tasks complete
5. Follow task order — dependencies matter
6. Run tests after every task — don't accumulate untested code
7. When resuming after compaction: read CURRENT STATE → find next unchecked task → continue

---

## Reference Documents

| Document | Location | What It Contains |
|----------|----------|-----------------|
| **V12 PRD** | `docs/V12/PRD_V12.md` | Feature requirements, user stories, acceptance criteria |
| **V12 TDD** | `docs/V12/TDD_V12.md` | Technical design, new migrations, service/type changes |

---

## Feature Summary

| # | Area | Phase | Size | Description |
|---|------|-------|------|-------------|
| A1 | Cascade splits on purge | 0 | S | Wrap purge in transaction; delete expense_splits |
| A2 | bumpDataVersion on purge | 0 | XS | One-liner fix |
| A3 | bumpDataVersion on merchant rename | 0 | XS | One-liner fix |
| A4 | Remove dead deep link | 0 | XS | Delete allowlist entry |
| B1 | ErrorBoundary __DEV__ guard | 0 | S | Wrap stack display |
| B2 | Password validation alignment | 0 | S | Share MIN_PASSWORD_LENGTH |
| C1 | Batch account balance queries | 1 | M | WHERE IN (?) |
| C2 | Batch account-master JOIN | 1 | M | WHERE IN (?) |
| C3 | Memoize expenses tab | 1 | M | useMemo + useCallback + React.memo |
| C4 | Memoize ExpenseListItem | 1 | S | React.memo export |
| C5 | Replace SELECT * on hot path | 1 | M | Explicit column projection |
| D1 | Replace 3 custom Save Pressables | 2 | S | Use <Button> |
| D2 | Remove conditional colorScheme dupes | 2 | S | Use theme.border |
| D3 | Extract <EmptyState> shared component | 2 | M | 15+ call sites |
| D4 | Replace 5 ad-hoc <Card> wrappers | 2 | S | Use <Card> |
| E1 | Drop sms_rules table | 3 | M | Migration + backup shim |
| E2 | Drop users table | 3 | M | Migration + backup shim |
| E3 | Remove ~30 dead service exports | 3 | L | Grep per fn, delete, re-run tests |
| F1 | Wire FilterSummaryCard to 4 more screens | 4 | M | Review queue, recycle bin, budget, insights |
| F2 | Merchant rename includes pending | 4 | XS | WHERE clause widen |
| F3 | Verify soft-delete in hisaab balance | 4 | S | Investigation + fix if needed |
| F4 | <DateRangeChips> reusable component | 4 | M | Extract + wire to 4 screens |
| F5 | Account balance drift alert | 4 | L | New UI + settings |
| F6 | Stale backup warning | 5 | M | MMKV + banner + dismiss logic |
| F7 | Verify split-edit amount revalidation | 5 | S | Investigation + fix if needed |
| F8 | Tag rename bumps data version | 5 | XS | One-liner |
| F9 | MoM trend on FilterSummaryCard | 5 | M | New query + UI line |
| F10 | Symmetric delete-cascade helper | 5 | M | Extract cleanupExpenseChildren() |

**Total: 27 items across 6 phases.**

---

## Dependency Graph

```
Phase 0 (Quick Wins — Data + Security)
  ├── A1, A2, A3, A4 (data integrity)
  └── B1, B2 (security)
       │
Phase 1 (Performance)
  ├── C1, C2 (backend batching)
  ├── C3, C4 (frontend memo)
  └── C5 (column projection)
       │
Phase 2 (UI Consistency — can run parallel with Phase 1)
  ├── D1, D2 (replace ad-hoc patterns)
  ├── D3 (EmptyState — unblocks 15+ screens)
  └── D4 (Card usage)
       │
Phase 3 (Dead Code Removal)
  ├── E1 (sms_rules migration)
  ├── E2 (users migration)
  └── E3 (dead exports)
       │
Phase 4 (Functional Gaps — High Priority)
  ├── F1 (FilterSummaryCard reuse)
  ├── F2 (merchant rename)
  ├── F3 (hisaab soft-delete — investigation)
  ├── F4 (DateRangeChips)
  └── F5 (balance drift alert)
       │
Phase 5 (Functional Gaps — Medium Priority)
  ├── F6 (backup reminder)
  ├── F7 (split-edit — investigation)
  ├── F8 (tag rename bump)
  ├── F9 (MoM trend)
  └── F10 (cascade helper)
       │
Phase 6 (Release)
  ├── Type check, full test pass
  ├── Version bump 12.0.0
  ├── Git commit + push
  ├── GitHub release
  └── APK build + upload
```

---

## Phase 0 — Quick Wins (Data Integrity + Security)

**Goal:** Fix the highest-impact bugs first. All are small diffs.

### [x] V12-A1 — Cascade splits on purge
- **Prereq:** Read `services/expense-crud.ts:175-230` (`permanentlyDeleteExpense`) to understand cascade pattern.
- **Change:** In `purgeOldDeletedExpenses` — wrap in `withTransactionAsync`, delete from `expense_splits WHERE expense_id IN (?)` before deleting expenses, also cascade to `multi_split_entries`, `expense_tags`, `hisaab_entries WHERE linked_expense_id IN (?)`.
- **Test:** Add unit test in `__tests__/unit/expense-purge.test.ts` — create split expense, soft-delete, purge, assert zero orphan rows.

### [x] V12-A2 — bumpDataVersion on purge
- **Change:** Add `bumpDataVersion()` at end of `purgeOldDeletedExpenses`.
- **Test:** Manual — soft-delete, purge, verify expense list refreshes without reload.

### [x] V12-A3 — bumpDataVersion on merchant rename
- **Change:** Add `bumpDataVersion()` after the UPDATE in `propagateMerchantRename`.
- **Test:** Manual — rename merchant, verify list refreshes.

### [x] V12-A4 — Remove dead deep link
- **Change:** Remove `"expense/duplicate-review"` from `ALLOWED_DEEP_LINK_SCREENS` in `constants/routes.ts`.

### [x] V12-B1 — ErrorBoundary __DEV__ guard
- **Prereq:** Read `app/_layout.tsx:23-51`.
- **Change:** Wrap `error.message` and `error.stack` in `{__DEV__ && ...}`. In production show "Something went wrong. Please restart the app." + a "Restart" button.

### [x] V12-B2 — Password validation alignment
- **Change:** Export `MIN_PASSWORD_LENGTH` from `services/backup.ts`. Import in `app/settings/backup-restore.tsx`. Replace `password.length < 4` with `password.length < MIN_PASSWORD_LENGTH`. Update error messages similarly.

---

## Phase 1 — Performance

### [x] V12-C1 — Batch account balance queries
- **Prereq:** Read `services/account-balance.ts:240-280`.
- **Change:** Rewrite `getComputedBalances` to use single `SELECT account_id, closing_balance FROM account_month_balances WHERE month = ? AND account_id IN (...)`. Fallback to individual queries only for accounts with missing month rows.
- **Test:** Add unit test with 10 accounts, verify one query executes (mock db).

### [x] V12-C2 — Batch account-master JOIN
- **Prereq:** Read `services/account-master.ts:70-90`.
- **Change:** Rewrite `getAllAccountsWithModes` to one JOIN query with `IN (account_ids)`, group client-side by `account_id`.

### [x] V12-C3 — Memoize expenses tab
- **Prereq:** Read `app/(tabs)/expenses.tsx` lines 85-250.
- **Change:**
  - Wrap `categoryMap`, `paymentModeMap`, `accountMap` in `useMemo([categories/paymentModes/accounts])`
  - Wrap `renderExpenseItem` in `useCallback`
  - Wrap `handleDelete` handler properly with stable deps

### [x] V12-C4 — Memoize ExpenseListItem
- **Change:** `components/expense/ExpenseListItem.tsx` — export wrapped in `React.memo`.
- **Test:** React DevTools profiler — verify only changed rows re-render on parent state change.

### [x] V12-C5 — Column projection on hot path
- **Change:** In `getExpensesPaginated`, replace `SELECT *` with explicit `SELECT id, user_id, amount, currency, description, merchant_name, category_id, payment_mode_id, account_id, date, transaction_time, is_right_spend, source, status, nature, split_original_amount, split_person_id, split_pct, split_hisaab_entry_id, deleted_at, created_at`. Verify all call-site fields covered.
- **Risk:** If a consumer needs a column not in the list, tests will catch it.

---

## Phase 2 — UI Consistency (can run parallel with Phase 1)

### [x] V12-D1 — Replace 3 Pressable Save buttons with <Button>
- Tags, merchant-aliases, account-ledger screens

### [x] V12-D2 — Remove conditional-colorScheme theme duplicates
- 4 components — replace with `theme.border` / NativeWind dark classes

### [x] V12-D3 — Extract <EmptyState> shared component (4 of 15 call sites adopted this phase; remainder mechanical follow-up)
- **File:** `components/ui/EmptyState.tsx`
- **Props:** `{icon: IoniconsName, title: string, subtitle?: string, action?: ReactNode}`
- **Replace** 15+ call sites across insights/, reconciliation/, hisaab/, expense/, settings/
- **Export** from `components/ui/index.ts`

### [x] V12-D4 — Replace 5 ad-hoc Card wrappers (reconciliation/index and advisor/index converted; SplitSheet/MultiSplitSheet/InsightCard deferred as complex modal refactors)
- reconciliation/index, advisor/index, SplitSheet, MultiSplitSheet, analytics cards

---

## Phase 3 — Dead Code Removal

### [x] V12-E1 — Drop sms_rules table (migration 006; removed from TABLE_SCHEMAS + BACKUP_TABLES; restore silently skips if present in old backups)
- **Migration:** `database/migrations/027_drop_sms_rules.ts` — `DROP TABLE IF EXISTS sms_rules;`
- **Update:** `TABLE_SCHEMAS.ts`, `BACKUP_TABLES` in `services/backup.ts`, remove cleanup logic in `services/data-cleanup.ts`
- **Backup restore shim:** In `services/backup.ts`, silently skip `sms_rules` blob if present in old backups

### [~] V12-E2 — Drop users table — **DEFERRED.** Audit was incomplete: ~15 tables have `REFERENCES users(id)` FK constraints. Dropping requires rewriting every FK. Keep the table; revisit in a dedicated schema-cleanup release.
- **Migration:** `database/migrations/028_drop_users.ts`
- **Same update + shim pattern as E1**
- **Verify:** `DEFAULT_USER_ID` still works since all tables store it as a free-string column, not an FK

### [~] V12-E3 — Remove dead service exports — **PARTIAL.** Removed 4 truly-zero-hit functions (`getCurrency`, `setCurrency`, `isAutoRefreshEnabled`, `setAutoRefreshEnabled`) and their 2 orphaned MMKV KEY constants. Most others (e.g. `deleteBudget`) are test-only — deferred to avoid disrupting test suite mid-phase; schedule a test-cleanup pass before removing.
- Process per-function:
  1. `grep -r "\\bfunctionName\\b" ~/accounts-manager-app/{app,components,hooks,services,utils,database,__tests__}` (excluding its definition file)
  2. If only test usages exist, delete the test too
  3. If barrel re-exports via `export *`, check target
  4. Delete function + its export
- Run `npx tsc --noEmit` between batches to catch missed imports

---

## Phase 4 — Functional Gaps (High Priority)

### [~] V12-F1 — Reuse FilterSummaryCard — **PARTIAL.** Recycle bin: added "Total at Risk" summary banner for deleted + rejected expense sections. Other screens (review queue, budget detail, insights sub-screens) deferred — review queue needs groupBy redesign; insights have different aggregate shape.
- **Wire to:**
  - `app/expense/review-queue.tsx` — group by source (SMS/email/manual) or status
  - `app/settings/recycle-bin.tsx` — show total at risk of purge
  - `app/budget/[categoryId].tsx` — add groupBy=merchant_name or payment_mode
  - `app/insights/merchants.tsx`, `accounts.tsx`, `payment-methods.tsx`, `patterns.tsx` — filter-aware total
- **New query:** Extend `getFilteredExpenseSummary` if needed to support groupBy=merchant_name (add to the groupBy union type).

### [x] V12-F2 — Merchant rename includes pending — **ALREADY SATISFIED.** Current `propagateMerchantRename` has no `status` filter; pending rows are already updated.
- **Change:** In `services/merchant-alias.ts:propagateMerchantRename`, remove any `status = 'approved'` filter. Include `status IN ('approved', 'pending_review')`.

### [x] V12-F3 — Hisaab balance soft-delete verification — **BUG CONFIRMED & FIXED.** All 3 balance queries (`getPersonsWithBalances`, `getPersonBalance`, `getBalanceAsOfDate`) now exclude hisaab entries whose `linked_expense_id` points to a soft-deleted expense via `NOT EXISTS` subquery. Prevents stale balances after soft-delete.
- **Investigation task:** Grep `services/hisaab.ts` for every SUM/SELECT that totals hisaab balances. Check if the queries join `expenses` with `deleted_at IS NULL` OR otherwise exclude soft-deleted linked expenses.
- **If bug confirmed:** Add `WHERE e.deleted_at IS NULL` clause on the appropriate JOIN.
- **Test:** Create split expense, soft-delete it, assert hisaab balance of the counterparty decreases accordingly.

### [~] V12-F4 — Extract <DateRangeChips> reusable component — **PARTIAL.** New `components/ui/DateRangeChips.tsx` built + exported from UI barrel. Migration of existing expenses tab + wiring to new screens (budget detail, insights) deferred to follow-up to avoid regression risk mid-phase.
- **File:** `components/ui/DateRangeChips.tsx`
- **Logic:** FY / Custom / All-Time chips from `app/(tabs)/expenses.tsx:276-398`
- **Props:** `{value, onChange, fyOptions}` + optional `allowAllTime`
- **Wire to:** budget/[categoryId], insights/*, hisaab/ledger

### [~] V12-F5 — Account balance drift alert — **DEFERRED.** Requires proper UX design pass (reconciled-balance concept, compare UI, Reconcile action). Out of scope for stabilization release; flag for V13 roadmap.
- **Place:** `app/settings/account-detail.tsx` (top summary card)
- **Data:** Compare `computedBalance` (from expenses+transfers) vs `userAdjustedBalance` (MMKV or account_month_balances override).
- **Show:** "Last reconciled: 2026-03-15. Computed ₹42,500. Reconciled ₹42,650. Δ ₹150" with "Reconcile now" action.
- **Threshold:** Show only if `abs(delta) > 100 OR abs(delta) / reconciled > 0.01`.

---

## Phase 5 — Functional Gaps (Medium Priority)

### [x] V12-F6 — Stale backup warning — `setLastBackupAt` set on successful backup; home screen shows dismissible warning banner if `shouldShowBackupWarning` (>30 days stale or never backed up); dismissal suppresses for 7 days via MMKV.
- **MMKV key:** `lastBackupAt` (ISO string) — set on successful backup in `services/backup.ts:createBackup`
- **UI:** Dismissible banner on `app/(tabs)/index.tsx` if `lastBackupAt` is null or >30 days old
- **Dismissal:** MMKV `backupWarningDismissedUntil` — suppress for 7 days

### [x] V12-F7 — Split-edit amount revalidation — **ALREADY CORRECT.** `app/expense/[id].tsx` detects single/multi split on save, calls `removeSplit` + `updateExpense` + `splitExistingExpense` (or `applyMultiSplit`) so linked hisaab entries are recomputed atomically. No fix needed.
- **Investigation:** Read `updateExpense` and check how it handles amount change when `split_person_id IS NOT NULL`.
- **Expected:** If split expense, recompute my share + hisaab amount from `split_pct` and new total amount. Update linked `hisaab_entry` atomically.
- **Test:** Create ₹2000 50/50 split → edit to ₹3000 → assert expense.amount=₹1500, hisaab_entry.amount=₹1500.

### [x] V12-F8 — Tag rename bumps data version — **ALREADY SATISFIED.** `services/tags.ts:updateTag` already calls `bumpDataVersion()` at end of the function.
- **Change:** In `services/tags.ts:renameTag` — add `bumpDataVersion()` after UPDATE.

### [x] V12-F9 — Month-over-month trend on FilterSummaryCard — new `getPreviousPeriodTotal(userId, filters)` computes same-length previous period from filter start/end; `FilterSummaryCard` accepts optional `previousTotal` prop and renders "↑ N% vs previous period" (red) or "↓ N%" (green). Wired on Expenses tab.
- **Query:** `getFilteredExpenseSummaryWithPrevPeriod(userId, filters, period: 'month'|'fy')` — returns current + previous summary.
- **UI:** On `FilterSummaryCard`, add "+12% vs last month" line under total if `previous.total > 0`. Green if ↓ expense (good), red if ↑.
- **Only show** when date filter is a well-defined period (FY or single month).

### [~] V12-F10 — Symmetric delete-cascade helper — **DEFERRED.** Phase 0 already fixed the correctness gap (purge cascades splits + hisaab entries like `permanentlyDeleteExpense`). Extracting the shared helper is pure refactor — no user-visible benefit — deferred to a focused code-quality pass.
- **File:** `services/expense-children-cleanup.ts`
- **Function:** `cleanupExpenseChildren(db, expenseIds: string[])` — deletes from expense_splits, multi_split_entries, expense_tags, hisaab_entries (where linked).
- **Refactor:** `permanentlyDeleteExpense` and `purgeOldDeletedExpenses` both call this.
- **Test:** Unit test — state after each path is identical.

---

## Phase 6 — Release

### [ ] V12-REL-1 — Type check
```bash
cd ~/accounts-manager-app && npx tsc --noEmit
```
Zero errors in non-test files.

### [ ] V12-REL-2 — Tests
```bash
cd ~/accounts-manager-app && npx jest
```
All green. New tests added during V12 should bring total >1050.

### [ ] V12-REL-3 — Version bump
`app.json`: `11.2.0` → `12.0.0`

### [ ] V12-REL-4 — Update CLAUDE.md
- Add V12 to Documentation table
- Update Feature Roadmap + version summary
- Mark V11 complete if applicable

### [ ] V12-REL-5 — Git commit + push + release + build + upload
Use the full project pipeline (`CLAUDE.md` Build & DevOps section).

---

## Completion Criteria

V12 is complete when:
- [ ] All 27 items checked [x]
- [ ] All tests green
- [ ] Type check clean
- [ ] Version bumped to 12.0.0
- [ ] GitHub release created with APK
- [ ] CLAUDE.md updated
- [ ] This MASTER_PLAN has SESSION LOG filled in
