# Artha (अर्थ) — Version 5 Product Requirements Document

**Version:** 5.0 (Draft)
**Author:** Sourav Baid
**Date:** 2026-04-15
**Status:** Ready to implement
**Predecessor:** V4 PRD at `docs/V4/PRD_V4.md`

---

## 1. Executive Summary

Version 5 is a **quality, security, and hardening release**. No new user-facing features are added — every change traces directly to a finding from the comprehensive audit report (`~/.claude/work-docs/artha/Artha_Comprehensive_Audit_Report.md`).

V5 addresses:
- **Security gaps** — real AES-256-GCM encryption for backups, SQL injection fixes, deep-link protection
- **Broken features** — forecast engine crash, wrong savings calculations, incomplete backup
- **Architecture debt** — dead code removal, file splitting, deduplication
- **UI polish** — design system compliance across all screens
- **Performance** — N+1 query fixes, startup optimization, lazy-loading

### Why V5 Is a Major Version

The backup file format changes (V1 → V2 with new encryption), the `default-user` constant extraction touches 50+ files, and the expense service splits into multiple modules. These are breaking internal changes that warrant a major version bump per the project's versioning rules (>5 features/changes = MAJOR).

### Version Metrics

| Metric | V4 (Baseline) | V5 (Projected) |
|--------|--------------|----------------|
| Tests | 1,068 | ~1,187 |
| Migrations | 25 | 26 |
| Services | ~43 | ~43 (split, not new) |
| Screens | ~56 | ~56 (no new screens) |
| Version | 4.0.0 | 5.0.0 |
| Audit findings open | 80 | ~3 (deferred) |

---

## 2. Security Fixes (SEC-1 through SEC-10)

### S1: Real AES-256-GCM Backup Encryption (SEC-1, SEC-5, SEC-7)

**Problem:** Documentation claims AES-256-GCM encryption with PBKDF2 key derivation for backups. Reality: a custom XOR stream cipher with iterated SHA-256 (100,000 rounds). No integrity verification (MAC). Password+salt concatenation has a collision vulnerability.

**Solution:**
- Add `react-native-aes-crypto` dependency (provides AES-256-GCM, PBKDF2, HMAC)
- Replace XOR cipher with real AES-256-GCM authenticated encryption
- Replace iterated SHA-256 with proper PBKDF2 (600,000 rounds as documented)
- Add HMAC-SHA256 MAC for per-chunk integrity verification
- Use HMAC-based key derivation to eliminate password+salt collision

**Impact:** Backup file format changes (V1 → V2). Old backups still restorable via backward compatibility.

### S2: Minimum Password Length (SEC-3)

**Problem:** Backup passwords can be as short as 4 characters — brute-forceable in seconds.

**Solution:** Enforce minimum 8 characters on backup creation. Existing short-password backups remain restorable (validation only on create, not restore).

### S3: SQL Injection in Backup Restore (SEC-4)

**Problem:** Column names from backup file are interpolated directly into INSERT SQL. A malicious backup could inject SQL.

**Solution:** Whitelist known column names per table. Any column not in the whitelist is rejected before SQL construction.

### S4: SQL Injection in Template Service (SEC-8)

**Problem:** `template.ts` line 172 interpolates `userId` directly into a DELETE query instead of using parameterized query.

**Solution:** Change to `db.runAsync("DELETE FROM budget_breakdowns WHERE budget_id IN (SELECT id FROM budgets WHERE user_id = ?);", userId)`.

### S5: Deep-Link Screen Whitelist (SEC-6)

**Problem:** Notification tap handler pushes any string from notification data to the router without validation.

**Solution:** Define a whitelist of valid screen paths. Only navigate if the screen value matches the whitelist. Log and ignore unknown paths.

### S6: Backup Cache Cleanup (SEC-9)

**Problem:** Encrypted backup files written to cache are never deleted after sharing.

**Solution:** After `Sharing.shareAsync()` completes, delete the temp file from cache using `FileSystem.deleteAsync()`.

### S7: Database Encryption Documentation (SEC-2)

**Problem:** CLAUDE.md and SECURITY.md claim SQLCipher encryption, but the database is plaintext.

**Decision:** Document honestly. expo-sqlite doesn't support SQLCipher natively, and migrating DB libraries is too risky for V5. Android 10+ provides full-disk encryption at the OS level, protecting the database file on non-rooted devices.

**Action:** Update CLAUDE.md and `docs/MVP/SECURITY.md` to remove SQLCipher claim. Document that the database relies on Android's OS-level encryption.

### S8: Accessibility Labels (SEC-10)

**Problem:** Zero `accessibilityLabel` or `accessibilityHint` props throughout the app. Screen readers cannot describe any interactive elements.

**Solution:** Systematic pass through all screens adding accessibility labels to buttons, inputs, list rows, and interactive elements.

---

## 3. Functional Bug Fixes (FUNC-1 through FUNC-15)

### F1: Forecast Engine Wrong Column Names (FUNC-1) — Critical

**Problem:** `getYearEndProjection()` in `forecast-engine.ts` queries `annual_planned_expenses` and `fiscal_year` — these columns don't exist. The actual columns are `total_planned_expenses` and `financial_year`. Feature crashes on every call.

**Fix:** Rename column references in the SQL query (lines 139-143).

### F2: Right Spend Wrong Column (FUNC-4) — Critical

**Problem:** Spending insights queries `c.is_avoidable` but the categories table column is `is_unavoidable`. SQLite returns NULL for the non-existent column, so Right Spend shows zeros.

**Fix:** Change `is_avoidable` to `is_unavoidable` and invert the logic (3 occurrences in `spending-insights.ts`).

### F3: Savings Tracker Counts Forecasts (FUNC-3) — High

**Problem:** The savings rate calculation includes forecast expenses (not yet paid) alongside realized expenses, making the savings rate appear worse than reality.

**Fix:** Add `AND nature = 'realized'` to the expense sum query in `savings-tracker.ts` line 29.

### F4: Complete Backup (FUNC-2) — Critical

**Problem:** Backup only includes 13 of 26 tables. Hisaab (family ledger), bank accounts, recurring transactions, tags, merchant aliases, salary profiles, and account-payment links are all silently lost on restore.

**Fix:** Expand `BACKUP_TABLES` to include all 26 tables. Part of the Phase 3 backup rewrite.

### F5: UPI App Wrong Dates (FUNC-7)

**Problem:** Google Pay, PhonePe, and Paytm SMS parsers use `new Date()` (today's date) instead of extracting the actual transaction date from the SMS text.

**Fix:** Update these three bank pattern parsers to extract the date from the SMS body.

### F6: Manual Expense Ignores Fields (FUNC-8)

**Problem:** Manual expense creation ignores `nature` (realized vs. forecast) and `transaction_time` parameters, always defaulting to realized and NULL time.

**Fix:** Pass through `nature` and `transaction_time` parameters in the INSERT statement.

### F7: Budget Shows Deactivated Categories (FUNC-9)

**Problem:** Budget screen displays budget lines for categories the user has deactivated.

**Fix:** Add `WHERE is_active = 1` filter to the budget categories query.

### F8: Merchant Analytics Wrong Column (FUNC-11)

**Problem:** Merchant detail view searches the `description` field instead of the dedicated `merchant_name` column, missing some expenses.

**Fix:** Change query to use `merchant_name` instead of `description`.

### F9: Credit SMS Handling (FUNC-6)

**Problem:** Credit/income SMS (salary, UPI received, NEFT credits) are parsed successfully but silently dropped, accumulating in pending status forever.

**Decision:** Mark them as "ignored" status instead of silently dropping. This stops them accumulating in pending. Full income tracking is deferred to a future version.

### F10: Backup Version String (FUNC-12)

**Problem:** Backup metadata hardcodes version as `"0.2.0"` even though the app is at 4.0.0.

**Fix:** Read version dynamically from `app.json` instead of hardcoding.

### F11: Budget Deletion Transaction (FUNC-15)

**Problem:** Deleting a budget does two DB operations without wrapping in a transaction.

**Fix:** Wrap in `db.withTransactionAsync()`.

### F12: Refund Detection (FUNC-5)

**Problem:** Refund matching only uses exact amount + card last 4. Partial refunds and same-amount duplicates aren't handled.

**Fix:** Allow fuzzy amount matching (within 2% tolerance) and include merchant name in matching criteria.

### F13: Forecast Tolerance (FUNC-10)

**Problem:** "Mark as paid" searches for matching expenses within 5% of the forecast amount — too loose for large amounts.

**Fix:** Tighten tolerance from 5% to 2%.

### F14: Recurring Detection (FUNC-13)

**Problem:** Groups by `description` instead of `merchant_name`, creating false groupings.

**Fix:** Change grouping column to `merchant_name`.

### F15: Surcharge Sentinel (FUNC-14)

**Problem:** Tax engine returns 0% surcharge for incomes above Rs 500 crore instead of the correct rate.

**Fix:** Add the correct surcharge rate for this bracket.

---

## 4. Architecture & Code Quality (ARCH + CODE findings)

### A1: Extract DEFAULT_USER_ID Constant (ARCH-1)

Extract `"default-user"` to `constants/app.ts` as `DEFAULT_USER_ID`. Replace ~174 occurrences across 50 files. TypeScript will catch any missed replacements at compile time.

### A2: Split Expense Service (ARCH-2)

Split `services/expense.ts` (1,314 lines, 39 functions) into focused modules:
- `expense-crud.ts` — create, update, delete
- `expense-queries.ts` — list, filter, search
- `expense-aggregations.ts` — totals, trends, groupings
- `expense-filters.ts` — filter helpers

Keep `expense.ts` as a barrel re-export for backward compatibility.

### A3: Extract Shared Expense Form (ARCH-3)

Extract ~500 lines of duplicate UI from `add.tsx` (756 lines) and `[id].tsx` (1,141 lines) into shared components:
- `ExpenseFormFields.tsx` — category picker, payment mode picker, account picker, date selector
- `AmountInput.tsx` — amount field with formatting

### A4: Remove Dead Code (CODE-1, CODE-4, CODE-5)

Delete 5 unused files (only imported by test files, never by app screens):
- `services/unavoidable-baseline.ts` (~170 lines)
- `services/export-excel.ts` (~240 lines)
- `services/hisaab-export.ts` (~170 lines)
- `hooks/use-theme-color.ts` (22 lines)
- `components/ui/ErrorBanner.tsx` (~40 lines)

**Kept for future use:** `utils/financial-health.ts` (310 lines), `utils/budget-recommendations.ts` (210 lines).

### A5: Deduplicate Utilities (CODE-2, CODE-3, CODE-8, CODE-9)

| Utility | Current State | Target |
|---------|--------------|--------|
| `round2()` | Duplicated in 7 files | Extract to `utils/math.ts` |
| `formatAmount()` | Duplicated in 8+ files | Consolidate to `utils/format.ts` |
| `getLastDayOfMonth()` | Duplicated in 2 services | Extract to `utils/date.ts` |
| `TYPE_ICONS` | Duplicated in 3 files | Extract to `constants/icons.ts` |

### A6: Remove V1 Split API (CODE-6)

Delete superseded `createSplitExpense()` and `updateSplitPercentage()` — V2 API is what screens use.

### A7: Extract Forecast Callbacks (CODE-7)

Home and Budget screens have identical forecast action callbacks (~80 lines each). Extract into `hooks/use-forecast-actions.ts`.

### A8: Centralized Logger (CODE-10, CODE-11)

Replace 35+ `console.error` calls and fix silent/empty catch blocks with a centralized `utils/logger.ts` that no-ops in production and logs in development.

### A9: Split Salary Calculator (CODE-14)

Split `salary-calculator.tsx` (1,581 lines) into subcomponents: `SalaryInputForm`, `TaxBreakdown`, `DeductionsSection`, `SalarySummary`.

### A10: Consolidate Insights Services (CODE-16)

`spending-insights.ts` has `getMonthlyComparison()` that overlaps with V4's `comparison-insights.ts`. Deprecate the old function and wire screens to the V4 version.

### A11: Barrel Exports (ARCH-5)

Update `services/index.ts` to export all 37+ services (currently only exports 6).

### A12: Remove Unused Dependencies (ARCH-4, CODE-15)

- Remove `zustand` from `package.json` (installed but never imported)
- Remove unused `Fonts` export from `constants/theme.ts`

---

## 5. UI & Design System Compliance (UI findings)

### U1: Summary Layout Header (UI-1)

Add full header styling to `app/summary/_layout.tsx` — currently a bare `<Stack>` with zero styling.

### U2: Tab Header Tint (UI-2)

Change `headerTintColor: theme.text` to `headerTintColor: theme.tint` in `app/(tabs)/_layout.tsx`.

### U3: ScrollView Bottom Padding (UI-4, UI-8, NEW-2)

Add `contentContainerStyle={{ paddingBottom }}` to 5+ screens: Settings, spending-split, category-edit, payment-mode-edit, account-add.

### U4: Card Component Adoption (UI-5, UI-9)

Replace raw `<View>` card-like containers with the `<Card>` component in Summary and Budget category detail screens.

### U5: FAB Spec Compliance (UI-7, UI-12, NEW-1)

- Fix shared FAB component: `bottom: 20→24`, `right: 20→24`, icon `24→28`
- Refactor account-master to use shared FAB instead of inline `<Pressable>`

### U6: Semantic Token Fixes (UI-13, UI-14)

- Card component: `bg-white` → semantic token class
- ScreenContainer: `bg-[#111111]` → theme token class

### U7: Shadow Method (UI-15)

Replace `shadowColor: "transparent"` + `elevation: 0` with standard `headerShadowVisible: false`.

### U8: Empty State Icons (UI-11)

Verify and standardize all empty state icons to 48px per design system.

---

## 6. Performance Optimizations (PERF findings)

### P1: Tag Loading N+1 (PERF-1) — Critical

**Problem:** Each expense in the list triggers a separate query to load its tags. 50 expenses = 50 extra queries.

**Fix:** Batch query: `SELECT * FROM expense_tags WHERE expense_id IN (?, ?, ...)` for all visible expenses in one query.

### P2: Monthly Trend N+1 (PERF-2)

**Problem:** Category trend chart runs 6 separate queries (one per month).

**Fix:** Single aggregate query with `GROUP BY strftime('%Y-%m', date)`.

### P3: Forecast Pairs N+1 (PERF-3)

**Problem:** Each matched forecast pair triggers a separate query.

**Fix:** Batch query for all matched forecasts.

### P4: Backup Streaming (PERF-4, PERF-5)

**Problem:** Backup loads entire database into one JSON string in memory. Restore inserts one row at a time.

**Fix:** Chunked export (table-by-table). Batch INSERT on restore (50-100 rows per statement). Part of the Phase 3 backup rewrite.

### P5: deleted_at Index (PERF-7)

**Problem:** Nearly every query filters `AND deleted_at IS NULL` but there's no index on the column.

**Fix:** Migration 026: `CREATE INDEX idx_expenses_deleted_at ON expenses(deleted_at)`.

### P6: Lazy-Load xlsx (PERF-6)

**Problem:** The xlsx library (~400KB) is imported at startup even though it's only used when the user triggers import/export.

**Fix:** Convert static `import` to dynamic `await import("xlsx")` in the 4 service files that use it.

### P7: Startup Optimization (PERF-8, PERF-9)

- Reduce forced splash delay from 2,500ms to 800ms
- Parallelize independent startup tasks (notification setup can run alongside DB init)

---

## 7. Updated Data Model

### Migration 026: `deleted_at` Index (Phase 6)

```sql
CREATE INDEX IF NOT EXISTS idx_expenses_deleted_at ON expenses(deleted_at);
```

**Purpose:** Optimize the `AND deleted_at IS NULL` filter that appears in nearly every query. As the expenses table grows, this index increasingly matters.

### No Other Schema Changes

All bug fixes correct code that references wrong column names — the schema itself is correct. The backup table list expansion is a code change (updating the BACKUP_TABLES array), not a migration.

---

## 8. Screens Summary

### No New Screens

V5 modifies existing screens but adds none. All changes are fixes, not features.

### Modified Screens

| Screen | Route | Change |
|--------|-------|--------|
| Summary Layout | `app/summary/_layout.tsx` | Add header styling |
| Tab Layout | `app/(tabs)/_layout.tsx` | Fix headerTintColor |
| Settings | `app/(tabs)/settings.tsx` | Add ScrollView bottom padding |
| Budget | `app/(tabs)/budget.tsx` | Filter deactivated categories, extract forecast callbacks |
| Home | `app/(tabs)/index.tsx` | Extract forecast callbacks |
| Expense Add | `app/expense/add.tsx` | Extract shared form components |
| Expense Detail | `app/expense/[id].tsx` | Extract shared form components |
| Summary Month | `app/summary/[month].tsx` | Replace raw Views with Card |
| Budget Category | `app/budget/[categoryId].tsx` | Replace raw Views with Card |
| Spending Split | `app/budget/spending-split.tsx` | Add bottom padding, use Card |
| Category Edit | `app/settings/category-edit.tsx` | Add bottom padding |
| Payment Mode Edit | `app/settings/payment-mode-edit.tsx` | Add bottom padding |
| Account Master | `app/settings/account-master.tsx` | Use shared FAB component |
| Account Add | `app/settings/account-add.tsx` | Add bottom padding |
| Salary Calculator | `app/goals/salary-calculator.tsx` | Split into subcomponents |
| Backup & Restore | `app/settings/backup-restore.tsx` | 8-char password, new encryption UX |
| All screens | Various | Accessibility labels, default-user constant |

---

## 9. Tech Stack Changes

| Change | Old | New |
|--------|-----|-----|
| Add dependency | — | `react-native-aes-crypto` (AES-256-GCM, PBKDF2, HMAC) |
| Remove dependency | `zustand` (unused) | — |
| Lazy-load | `xlsx` (static import) | `xlsx` (dynamic import) |

---

## 10. Testing Summary

| Phase | New Tests | Running Total |
|-------|-----------|---------------|
| V4 Baseline | — | 1,068 |
| Phase 0 | 0 | 1,068 |
| Phase 1 | ~24 | ~1,092 |
| Phase 2 | ~20 | ~1,112 |
| Phase 3 | ~15 | ~1,127 |
| Phase 4 | ~20 | ~1,147 |
| Phase 5 | ~8 | ~1,155 |
| Phase 6 | ~12 | ~1,167 |
| Phase 7 | ~20 | ~1,187 |
| **V5 Total** | **~119** | **~1,187** |

---

## 11. Deferred (Not in V5)

| Item | Reason |
|------|--------|
| SEC-11: MMKV encryption | Stores only preferences (theme, currency), no sensitive data |
| ARCH-6: Centralized state | Acceptable for local-only app with fast SQLite queries |
| ARCH-7: Migration rollbacks | Forward-only is standard for mobile (Android Room, iOS Core Data) |
| SEC-2: SQLCipher | expo-sqlite doesn't support it; DB library migration too risky for V5 |
| Income tracking from SMS | Full feature requiring new screens/services; V5 is fix-only |

---

## 12. Version History

| Version | Date | Change |
|---------|------|--------|
| 5.0 | 2026-04-15 | Initial V5 PRD — audit remediation, 72 tasks, 8 phases |
