# Artha V12 — PRD

> **Stabilization Release: Audit Remediation + Functional Gap Fixes**
> Comprehensive stabilization across data integrity, security, performance, UI, dead code + 10 functional gap fixes.

---

## Release Theme

V12 is a **stabilization + gap-fix release**. No new headline features. Focus is on:
1. Fixing data-correctness bugs (orphan cleanup, stale UI after writes)
2. Closing security gaps (prod stack leaks, password validation)
3. Fixing perf bottlenecks on hot paths (expense list, account balances)
4. Enforcing design-system consistency (Button, Card, theme tokens)
5. Removing dead code (2 tables, ~30 exports)
6. Closing 10 small functional gaps the audit surfaced (filter totals, trend deltas, backup reminders, etc.)

**Success criteria:**
- Zero data-integrity bugs from orphan rows or missing data-version bumps
- All writes trigger UI refresh
- All primary actions use `<Button>`, all cards use `<Card>`, zero hardcoded hex fallbacks in app logic
- Expenses tab renders <50ms on keystroke for 50-row page
- Backup file size reduced (two dead tables removed)
- Filter totals available on all list screens with amount filters

---

## Scope Summary

| Bucket | Features | Size |
|--------|----------|------|
| **A. Data Integrity** | A1–A4 | M |
| **B. Security** | B1–B2 | S |
| **C. Performance** | C1–C5 | L |
| **D. UI Consistency** | D1–D4 | M |
| **E. Dead Code Removal** | E1–E3 | L |
| **F. Functional Gap Fixes** | F1–F10 | L |

Total: **27 items across 6 buckets.**

---

## A. Data Integrity

### A1. Cascade splits on purge (HIGH)
**Problem:** [services/expense-crud.ts:234 `purgeOldDeletedExpenses`](../../services/expense-crud.ts) does not delete `expense_splits` rows that reference purged expense IDs. Orphan split rows leave hisaab balances broken.
**Fix:** Wrap purge in transaction; delete from `expense_splits WHERE expense_id IN (?)` before deleting the expense rows.
**Acceptance:** After "Empty Recycle Bin" with split expenses present, `SELECT COUNT(*) FROM expense_splits WHERE expense_id NOT IN (SELECT id FROM expenses)` returns 0.

### A2. `bumpDataVersion()` on recycle-bin purge (HIGH)
**Problem:** Same function — no data version bump. UI stays stale.
**Fix:** Call `bumpDataVersion()` at end of `purgeOldDeletedExpenses`.
**Acceptance:** Expense list / hisaab balances refresh immediately after purge, no manual reload needed.

### A3. `bumpDataVersion()` on merchant rename (HIGH)
**Problem:** [services/merchant-alias.ts:345 `propagateMerchantRename`](../../services/merchant-alias.ts) updates many rows, no bump.
**Fix:** Call `bumpDataVersion()` after the UPDATE.
**Acceptance:** Rename merchant in settings → list, insights, budget screens show new name without manual refresh.

### A4. Remove dead deep link (HIGH)
**Problem:** `expense/duplicate-review` in `constants/routes.ts` doesn't resolve to a file.
**Fix:** Remove it from `ALLOWED_DEEP_LINK_SCREENS`. If a duplicate-review screen is wanted, add it properly.
**Acceptance:** `constants/routes.ts` has no dead allowlist entries.

---

## B. Security

### B1. Guard ErrorBoundary stack trace with `__DEV__` (HIGH)
**Problem:** [app/_layout.tsx:23](../../app/_layout.tsx) renders `error.message` AND `error.stack` unconditionally. Users see full JS stacks in production.
**Fix:** Show friendly "Something went wrong, please restart." in production (`!__DEV__`); keep `stack` only in dev.
**Acceptance:** Force an error in a release build → users see only generic message. In dev, full stack still visible.

### B2. Align password validation (MEDIUM)
**Problem:** UI allows ≥4 chars, service rejects <8 → confusing UX.
**Fix:** Import `MIN_PASSWORD_LENGTH` from `services/backup.ts` into the UI; button `disabled={password.length < MIN_PASSWORD_LENGTH}`.
**Acceptance:** UI won't let users submit a password below the service threshold.

---

## C. Performance

### C1. Batch account balance queries (HIGH)
**Problem:** [services/account-balance.ts:263 `getComputedBalances`](../../services/account-balance.ts) loops `getCurrentBalance(id)` → 10–30 sequential queries for users with many accounts.
**Fix:** Single query using `WHERE account_id IN (?)` + group by account_id in JS.
**Acceptance:** Home / reconciliation screens load balances in one query; verified via a debug log.

### C2. Batch account-master JOIN (HIGH)
**Problem:** [services/account-master.ts:78 `getAllAccountsWithModes`](../../services/account-master.ts) fires one JOIN per account.
**Fix:** Single query with `IN (...)` + group client-side, or use `GROUP_CONCAT`.
**Acceptance:** Same result data, one query instead of N.

### C3. Memoize expense list (HIGH)
**Problem:** [app/(tabs)/expenses.tsx](../../app/(tabs)/expenses.tsx) creates three `new Map(...)` + inline `renderItem` + non-memoized list items → every keystroke re-renders all 50 rows.
**Fix:** Wrap maps in `useMemo`, handlers in `useCallback`, wrap `ExpenseListItem` in `React.memo`.
**Acceptance:** Profile the Expenses tab with React DevTools — only the searchbar re-renders on keystroke.

### C4. Memoize `ExpenseListItem` (HIGH)
**Problem:** [components/expense/ExpenseListItem.tsx:22](../../components/expense/ExpenseListItem.tsx) used by 5 FlatLists, not memoized.
**Fix:** `export const ExpenseListItem = React.memo(function ExpenseListItem(...) {...})`.
**Acceptance:** All 5 consuming screens render only changed rows.

### C5. Replace `SELECT *` on hot path (MEDIUM)
**Problem:** [services/expense-queries.ts:47 `getExpensesPaginated`](../../services/expense-queries.ts) pulls all 33 columns; UI needs ~10.
**Fix:** Explicit column projection in list query. Keep `SELECT *` for detail view.
**Acceptance:** Query result size shrinks ~3×; no UI regressions.

---

## D. UI Consistency

### D1. Replace 3 custom primary-action `Pressable`s with `<Button>` (HIGH)
- [app/settings/tags.tsx:152](../../app/settings/tags.tsx)
- [app/settings/merchant-aliases.tsx:370](../../app/settings/merchant-aliases.tsx)
- [app/reconciliation/account-ledger.tsx:821](../../app/reconciliation/account-ledger.tsx)

### D2. Remove conditional `colorScheme ===` + hex duplicates of theme tokens (HIGH)
4 occurrences in cockpit + exports:
- [components/cockpit/WaterfallBar.tsx:60](../../components/cockpit/WaterfallBar.tsx)
- [components/cockpit/MoneyWaterfall.tsx:72](../../components/cockpit/MoneyWaterfall.tsx)
- [components/hisaab/ExportFormatPicker.tsx:249,315](../../components/hisaab/ExportFormatPicker.tsx)
- [components/analytics/ConfidenceDots.tsx:30](../../components/analytics/ConfidenceDots.tsx)

**Fix:** Replace with `theme.border` or corresponding token.

### D3. Extract `<EmptyState>` shared component (MEDIUM)
15+ screens duplicate the same empty-state pattern with magic `py-16 px-8`. Extract to `components/ui/EmptyState.tsx` with props `{icon, title, subtitle}` and replace all call sites.

### D4. Replace 5 ad-hoc `<Card>` wrappers (MEDIUM)
- [app/reconciliation/index.tsx:21](../../app/reconciliation/index.tsx)
- [app/advisor/index.tsx:21](../../app/advisor/index.tsx)
- [components/expense/SplitSheet.tsx:455](../../components/expense/SplitSheet.tsx)
- [components/expense/MultiSplitSheet.tsx:358](../../components/expense/MultiSplitSheet.tsx)
- [components/analytics/InsightCard.tsx:43](../../components/analytics/InsightCard.tsx), [ForecastBreakdown.tsx:28](../../components/analytics/ForecastBreakdown.tsx)

---

## E. Dead Code Removal

### E1. Drop `sms_rules` table (HIGH)
Created, backed up, indexed — never read or written. New migration to `DROP TABLE sms_rules`. Remove from `TABLE_SCHEMAS`, `BACKUP_TABLES`, `data-cleanup.ts`.

### E2. Drop `users` table (HIGH)
Same pattern. `constants/app.ts` hardcodes `DEFAULT_USER_ID = "default-user"`. Either drop or actually use it. Decision: drop, since app is 100% local single-user.

### E3. Remove ~30 unused service exports (HIGH)
Full list in audit report. Verify each with a project-wide grep, then delete. Examples:
- `addBreakdown`, `updateBudget`, `deleteBudget`, `getBudgetById`, `getBreakdowns`, `deleteBreakdown` in `services/budget.ts`
- `deleteCategory` in `services/category.ts`
- `deletePaymentMode` in `services/payment-mode.ts`
- `deleteSalaryProfile`, `getSalaryProfileByPlanId` in `services/salary-profile.ts`
- `autoBuildPlanData`, `deleteYearlyPlan`, `resetYearlyPlan`, `getYearlyPlanById`, `projectNextFY` in `services/yearly-plan.ts`
- `cancelAllNotifications`, `cancelNotification`, `scheduleDelayedNotification`, `getNotificationPreferences`, `getPendingNotificationCount` in `services/notifications.ts`
- `getUpcomingDues` in `services/notification-scheduler.ts`
- `checkNewExpenseForRecurring`, `getUpcomingRecurring` in `services/recurring-detector.ts`
- `cleanupStaleForecasts`, `refreshClassifications` in `services/analytics/lifecycle.ts`
- `updateClassification` in `services/analytics/classifier.ts`
- `confirmPattern`, `correctPattern` in `services/analytics/pattern-learner.ts`
- `getWeeklyComparison` in `services/comparison-insights.ts`
- `getAnalyticsDashboard` in `services/financial-cockpit.ts`
- `getBalanceHistory`, `resetMonthBalance` in `services/account-balance.ts`
- `renameAccount` in `services/account-master.ts`
- `handleCreditReceived`, `getEntryByLinkedExpense`, `getExpenseByLinkedEntry` in `services/account-credit.ts`
- `getUserTransfersForMonth` in `services/account-transfer.ts`
- `getCurrency`, `setCurrency`, `isAutoRefreshEnabled`, `setAutoRefreshEnabled` in `services/settings.ts`
- `getAccountExpenses`, `getAccountSummary` in `services/financial-account.ts`
- `suggestColumnMappings`, `parseExpenseRows` in `services/excel-import.ts`
- `seedFinancialData` in `services/seed-data.ts`
- `seedMerchantMappings` in `services/smart-categorizer.ts`

---

## F. Functional Gap Fixes

These are product-level gaps discovered during the audit.

### F1. Reuse `FilterSummaryCard` on all filtered list screens (HIGH)
Card already built in V11.2 for Expenses tab. Wire it to:
- **Review queue** — "₹ X pending approval across N items"
- **Recycle bin** — "About to purge ₹ X across N expenses"
- **Budget category detail** — add breakdown beneath existing total
- **Insights → merchants / accounts / payment-methods / patterns** — filter-aware totals

**Acceptance:** Any screen with filters + amounts shows a filtered total card.

### F2. Merchant rename propagates to pending (review queue) rows (MEDIUM)
**Problem:** `propagateMerchantRename` only updates approved expenses. Pending SMS rows in review queue still show the old name.
**Fix:** Widen the WHERE clause to include `status = 'pending_review'`.

### F3. Verify soft-delete exclusion in hisaab balance math (HIGH, investigation first)
**Problem:** Suspected bug — when an expense is soft-deleted, do hisaab balance queries exclude it?
**Investigation:** Grep all queries in `services/hisaab.ts` that sum `hisaab_entries.amount`. Verify each JOINs `expenses` with `deleted_at IS NULL`, OR checks the `hisaab_entries.linked_expense_id` doesn't point to a soft-deleted row.
**Fix:** If missing, add the filter. Write a test that soft-deletes a split expense and asserts hisaab balance updates.

### F4. Add "All Time" / custom-range support to budget detail + insights screens (MEDIUM)
**Problem:** Only Expenses tab has FY / Custom / All-Time chips. Other date-filtered screens default to current month with no escape.
**Fix:** Extract the date-filter chip block from `app/(tabs)/expenses.tsx:276-398` into a reusable `<DateRangeChips>` component. Use on:
- Budget category detail
- Insights dashboard + all sub-screens
- Hisaab ledger

### F5. Account balance drift alert (MEDIUM)
**Problem:** Balance is computed from expenses + transfers. SMS miss → silent drift.
**Fix:** On account-detail screen, add "Last reconciled: <date>, Auto-balance: ₹X, Reconciled: ₹Y, Δ ₹Z" if delta > 1% or > ₹100. Add a "Reconcile now" action.
**Acceptance:** User can see and act on balance drift.

### F6. Stale backup warning (MEDIUM)
**Problem:** No reminder. Users forget.
**Fix:** Store `lastBackupAt` in MMKV. On home screen load, if >30 days stale, show dismissible warning banner linking to backup settings.
**Acceptance:** New user after 30 days sees warning. Dismissal suppresses for 7 days.

### F7. Verify split-expense revalidates on amount edit (HIGH, investigation first)
**Problem:** Edit a split expense's amount — does "my share" recalculate from `split_pct`, or does it stay stale?
**Investigation:** Read `updateExpense` in `services/expense-crud.ts` — verify logic. Test: create ₹2000 50/50 split (my share ₹1000), edit amount to ₹3000, check expense.amount and linked hisaab_entry.amount.
**Fix:** If stale, recompute and update both sides in the same transaction.

### F8. Tag rename bumps data version (LOW)
**Problem:** Similar to A3 for tags.
**Fix:** `bumpDataVersion()` after tag rename.

### F9. Month-over-month trend on Expenses tab (MEDIUM)
**Problem:** Filter summary shows absolute total but no context.
**Fix:** Add "+12% vs same period last year" / "-3% vs last month" line on `FilterSummaryCard`. Only show when date filter is a recognized period (FY, month, quarter).
**Acceptance:** User sees trend context on the card.

### F10. Symmetric delete-cascade helper (MEDIUM)
**Problem:** `permanentlyDeleteExpense` cascades correctly; `purgeOldDeletedExpenses` does not. Same data, different code paths.
**Fix:** Extract `cleanupExpenseChildren(db, ids: string[])` helper — one function handles splits, multi-splits, hisaab_entries, expense_tags. Both delete paths call it.
**Acceptance:** New helper covers all deletion paths. Unit test: both `permanentlyDeleteExpense(id)` and `purgeOldDeletedExpenses()` produce identical DB state.

---

## Out of Scope for V12

1. New features (any net-new capability) — V13 or later.
2. UI visual overhaul — V6 already did that; small polish only here.
3. Low-severity audit items (getItemLayout, switch trackColor hex, ErrorBoundary splash hex). Deferred — tech debt backlog.
4. Duplicate utility consolidation (formatNum, formatDate, parseAmount) — deferred to V13 (low user impact, mechanical).
5. Tax engine magic-number extraction — deferred.

---

## Version & Release Strategy

**Starting version:** 11.2.0 (current after account-fix + FilterSummaryCard commit)
**Target version:** 12.0.0
- 4 Data Integrity fixes (bug fixes → PATCH-worthy)
- 2 Security fixes (PATCH-worthy)
- 5 Performance fixes (PATCH-worthy)
- 4 UI consistency (PATCH-worthy)
- 3 Dead code removal (MINOR — user-invisible but structural)
- 10 Functional gap fixes (F1-F10, MINOR/MAJOR — some user-visible features)

**Total impact:** 10 user-visible functional improvements + structural cleanup → **MAJOR bump to 12.0.0**.

---

## Risk Notes

- **F3 and F7 are investigations** — if either confirms a bug, fix is cheap. If no bug, mark resolved with test evidence.
- **E1, E2 (drop tables)** — need a migration. Backups created before V12 must still restore (include shim to ignore missing tables on restore).
- **E3 (dead exports)** — verify each function is truly unused via grep before deletion. Some may be called dynamically or from tests.
- **C3, C4 (memoization)** — measure before/after with React DevTools. Do not assume the fix works.
