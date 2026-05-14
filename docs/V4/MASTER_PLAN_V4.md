# Artha V4 — MASTER PLAN

> **Data Quality, Flexibility & Accuracy**
> ~33 tasks | 4 phases | Version 2.0.0 → 4.0.0

---

## SESSION LOG

| # | Session Date | Tasks Completed | Notes |
|---|-------------|-----------------|-------|
| 1 | 2026-04-13 | Documentation | V4 PRD, TDD, MASTER_PLAN created. V3 Phases 3-6 deferred; V4 prioritized. |
| 2 | 2026-04-13 | V4-1.1 to V4-1.12 | Phase 1 implementation: 2 migrations, inferPaymentMode, account-master service, sms-to-expense V4 update, merchant master screen, account master screen, settings update, expense account picker, insights display names. Phase 1 tests next. |
| 3 | 2026-04-13 | V4-2.1 to V4-2.6 | Phase 2 complete: comparison-insights service, weekly comparison screen, period comparison screen with presets, wired to insights hub, 22 new tests. |
| 4 | 2026-04-13 | V4-3.1 to V4-3.7 | Phase 3 complete: V4-3.1–3.4 already done in Phase 1 (migration 024, extractTime, SMS parsers, sms-to-expense). Added transaction_time to Expense interface, hero card shows "at X:XX PM" for SMS expenses, read-only time in edit mode, 15 new tests. |
| 5 | 2026-04-13 | V4-4.1 to V4-4.3 | Phase 4 complete: 15 cross-feature integration tests, documentation finalized, APK build. V4 COMPLETE. |

## CURRENT STATE

```
PHASE: V4 COMPLETE
TASK: All 29 tasks done
STATUS: Complete
TESTS: 1068 (982 V3 + 34 Phase 1 + 22 Phase 2 + 15 Phase 3 + 15 Phase 4)
MIGRATIONS: 24 (14 MVP + 3 V1 + 4 V2 + 1 V3 bug fix + 2 V4)
```

---

## MANDATORY BEHAVIORS

1. Read this file at session start and after context compaction
2. Update SESSION LOG after every task
3. Update CURRENT STATE after every task
4. Mark checkboxes [x] as tasks complete
5. Follow task order — dependencies matter

---

## Feature Summary

| # | Feature | Phase | Size |
|---|---------|-------|------|
| F1 | SMS Parser: Payment Mode Detection | 1 | L |
| F2 | Master Data: Merchant Name Mappings | 1 | M |
| F3 | Master Data: Account-Payment Mode Linking | 1 | L |
| F4 | Account & Mode Editing on Expenses | 1 | M |
| F5 | Insights: Week-on-Week Comparison | 2 | M |
| F6 | Insights: Custom Date Range Comparison | 2 | L |
| F7 | Transaction Timestamps | 3 | M |
| F8 | Testing, Documentation & Build | 4 | M |

---

## Phase 1: Master Data Management (F1 + F2 + F3 + F4) — 13 tasks

- [x] **V4-1.1** Migration 023 — `account_payment_modes` junction table
  - Prereqs: `database/migrations/011_financial_accounts.ts`, `database/migrations/001_core_tables.ts` (payment_modes)
  - Create `database/migrations/023_account_payment_modes.ts`
  - Schema: id, account_id (FK), payment_mode_id (FK), first_seen_date, created_at, UNIQUE(account_id, payment_mode_id)
  - AC: Migration runs, table created, indexes created, registered in migration index

- [x] **V4-1.2** Add `paymentMode` + `transactionTime` fields to `ParsedSMS` interface
  - Prereqs: `services/sms/bank-patterns.ts` (lines 26-59 — ParsedSMS interface)
  - Add `paymentMode?: "credit_card" | "debit_card" | "upi" | "net_banking" | "wallet" | "auto_debit" | null`
  - Add `transactionTime?: string | null` (HH:MM:SS format)
  - AC: Interface compiles, no downstream breakage (fields are optional)

- [x] **V4-1.3** Implement `inferPaymentMode()` function
  - Prereqs: V4-1.2
  - Add to `services/sms/bank-patterns.ts`
  - Decision tree: UPI subtype → auto_debit types → wallet → credit_card → Card keyword analysis → savings fallback → null
  - AC: Function returns correct mode for all 48 bank patterns

- [x] **V4-1.4** Enhance bank patterns with payment mode + time extraction
  - Prereqs: V4-1.2, V4-1.3
  - Add `parseDateAndTime()` helper — returns `{ date: string; time: string | null }`
  - Update each pattern's `parse()` to call `inferPaymentMode()` and `parseDateAndTime()`
  - Key banks: ICICI (9 patterns), Axis (9), HDFC (8), SBI (7), Kotak (5), others (10)
  - AC: All patterns set `paymentMode` and `transactionTime` where determinable

- [x] **V4-1.5** Service — `account-master.ts` (CRUD for account-payment mode links)
  - Prereqs: V4-1.1
  - Create `services/account-master.ts`
  - Exports: `getAccountWithModes`, `getAllAccountsWithModes`, `addPaymentModeToAccount`, `removePaymentModeFromAccount`, `autoPopulateAccountMode`, `getLinkedModesForAccount`, `updateAccountLabel`
  - AC: All CRUD operations work, `autoPopulateAccountMode` is idempotent

- [x] **V4-1.6** Update `sms-to-expense.ts` — resolve and set payment_mode_id
  - Prereqs: V4-1.3, V4-1.5
  - After account discovery, look up `payment_modes` for matching type from `parsed.paymentMode`
  - Set `payment_mode_id` on expense INSERT (was always NULL)
  - Set `transaction_time` from `parsed.transactionTime ?? '00:00:00'`
  - Call `autoPopulateAccountMode(accountId, paymentModeId)` to build link table
  - AC: New SMS-detected expenses have payment_mode_id set, link table auto-populated

- [x] **V4-1.7** Update `financial-account.ts` — integrate with link table
  - Prereqs: V4-1.5, V4-1.6
  - After `discoverOrUpdateAccount()`, ensure link table is populated via `autoPopulateAccountMode`
  - AC: Account discovery triggers link table population

- [x] **V4-1.8** Screen — Merchant Master Data (`app/settings/merchant-aliases.tsx`)
  - Prereqs: `services/merchant-alias.ts` (existing), `database/migrations/020_merchant_aliases.ts`
  - List all `merchant_aliases` with search/filter
  - Inline edit for display name (canonical_name)
  - Stats footer: "X patterns, Y unique merchants"
  - AC: Screen lists all aliases, edit saves to DB, search filters work

- [x] **V4-1.9** Screen — Account Master Data (`app/settings/account-master.tsx`)
  - Prereqs: V4-1.5
  - List accounts with linked payment modes as chips
  - Edit account label inline
  - Bottom sheet to add/remove payment modes from linked list
  - AC: All accounts shown with correct linked modes, edit/add/remove works

- [x] **V4-1.10** Update Settings screen — Data Management section
  - Prereqs: V4-1.8, V4-1.9
  - Add "Data Management" section to `app/(tabs)/settings.tsx`
  - Two entries: "Merchant Names" and "Accounts & Payment Modes"
  - AC: Navigation works to both new screens

- [x] **V4-1.11** Add account picker to expense add/edit
  - Prereqs: V4-1.5
  - `app/expense/add.tsx`: Account dropdown + auto-suggest payment mode from linked modes
  - `app/expense/[id].tsx`: Account picker in edit mode + mode auto-suggest on change
  - Auto-suggest logic: 1 linked mode → auto-set; multiple → show filtered dropdown; 0 → show all
  - AC: Account selectable on both screens, mode auto-suggests correctly

- [x] **V4-1.12** Update insights queries — use merchant display names
  - Prereqs: V4-1.8
  - Modify `services/spending-insights.ts` — JOIN `merchant_aliases` for canonical_name in merchant grouping
  - AC: Insights show canonical merchant names, not raw SMS names

- [x] **V4-1.13** Phase 1 Tests (~34 new tests, 1016 total)
  - Payment mode inference (15): each rule in the decision tree
  - Account-mode link CRUD (8): insert, duplicate skip, query, add, remove
  - Merchant master data (8): list, search, edit, bulk
  - Account master data (6): list with modes, edit label, add/remove modes
  - Expense account picker (8): select → auto-suggest, edit → change
  - AC: All tests pass, total ~1,027

---

## Phase 2: Insights Enhancements (F5 + F6) — 6 tasks

- [x] **V4-2.1** Service — `comparison-insights.ts` (`getWeeklyComparison` + `getDateRangeComparison`)
  - Prereqs: `services/spending-insights.ts` (existing — pattern reference)
  - Create `services/comparison-insights.ts`
  - Two main functions querying expenses by date ranges, computing deltas
  - Types: ComparisonResult, RangeSummary, DeltaSummary, ComparisonPreset
  - AC: Both functions return correct data for test date ranges

- [x] **V4-2.2** Screen — Weekly Comparison (`app/insights/weekly.tsx`)
  - Prereqs: V4-2.1
  - Week picker (current vs previous, navigable)
  - Two-column comparison: total spend, categories, merchants, payment modes
  - Delta indicators (green/red arrows with %)
  - AC: Correct comparison displayed, navigation works

- [x] **V4-2.3** Screen — Period Comparison (`app/insights/compare.tsx`)
  - Prereqs: V4-2.1
  - Two date range pickers (4 DateInput fields)
  - Preset chips: This vs Last Month, This vs Last Quarter, YoY, Custom
  - Full comparison output + export button
  - AC: Presets populate dates, custom works, comparison renders, export works

- [x] **V4-2.4** Comparison presets
  - Prereqs: V4-2.1
  - Add `getComparisonPresets()` function — calculates date ranges for common comparisons
  - AC: Presets return correct date ranges for current date

- [x] **V4-2.5** Wire new views to Insights hub
  - Prereqs: V4-2.2, V4-2.3
  - Add "Weekly Comparison" and "Compare Periods" cards to `app/insights/index.tsx`
  - AC: Cards visible, navigation works

- [x] **V4-2.6** Phase 2 Tests (~30 new tests)
  - Weekly comparison service (10): date range calculation, category deltas, empty weeks
  - Date range comparison service (10): arbitrary ranges, presets, YoY, deltas
  - UI (10): preset selection, date entry, export
  - AC: All tests pass, total ~1,057

---

## Phase 3: Transaction Timestamps (F7) — 7 tasks

- [x] **V4-3.1** Migration 024 — `transaction_time` on expenses
  - Create `database/migrations/024_transaction_time.ts`
  - `ALTER TABLE expenses ADD COLUMN transaction_time TEXT NOT NULL DEFAULT '00:00:00'`
  - AC: Migration runs, all existing expenses get 00:00:00

- [x] **V4-3.2** Implement `parseDateAndTime()` helper
  - Prereqs: Already partially done in V4-1.4 for Phase 1
  - If not done in Phase 1: add to `services/sms/bank-patterns.ts`
  - Handles: DD-MM-YY,HH:MM:SS | DD-MM-YY HH:MM:SS IST | YYYY-MM-DD:HH:MM:SS | DD-MM-YY HH:MM:SS
  - Returns null for formats without time
  - AC: All date format tests pass with correct time extraction

- [x] **V4-3.3** Update SMS parser date extractors to use `parseDateAndTime()`
  - Prereqs: V4-3.2
  - All bank patterns that have date+time in SMS call the new helper
  - Set `parsed.transactionTime` from extracted time
  - AC: Time extracted correctly for all patterns with time data

- [x] **V4-3.4** Update `sms-to-expense.ts` — set transaction_time on INSERT
  - Prereqs: V4-3.1, V4-3.3
  - If already done in V4-1.6 (Phase 1): verify and skip
  - Set `transaction_time = parsed.transactionTime ?? '00:00:00'` on expense creation
  - Manual expense creation: always '00:00:00'
  - AC: SMS expenses get real time, manual expenses get 00:00:00

- [x] **V4-3.5** Update expense detail page — show timestamp
  - Prereqs: V4-3.1
  - `app/expense/[id].tsx`: Display time next to date ("Apr 11, 2026 at 3:39 PM")
  - Only show if `transaction_time !== '00:00:00'` (don't show "at 12:00 AM" for manual)
  - AC: SMS expenses show time, manual expenses show date only

- [x] **V4-3.6** Ensure edit mode keeps timestamp read-only
  - Prereqs: V4-3.5
  - Date field remains editable (existing behavior)
  - Transaction time shown as read-only text (greyed out, not in a TextInput)
  - AC: Edit saves new date, time stays unchanged

- [x] **V4-3.7** Phase 3 Tests (~15 new tests)
  - Time extraction (8): each format with time, formats without time, null
  - Transaction time on expenses (4): auto gets time, manual gets 00:00:00, edit preserves
  - Detail page display (3): formatted time, hidden for 00:00:00, read-only in edit
  - AC: All tests pass, total ~1,072

---

## Phase 4: Testing, Documentation & Build (F8) — 3 tasks

- [x] **V4-4.1** Cross-Feature Integration Tests (~20 new tests)
  - Full SMS pipeline: parse → detect mode → create expense → verify account + mode + time
  - Insights with display names: merchant aliases used in comparisons
  - Account-mode link: auto-population verified end-to-end
  - AC: All integration tests pass, total ~1,092

- [x] **V4-4.2** V4 Documentation Update
  - Finalize PRD_V4.md, TDD_V4.md with implementation details
  - Update CLAUDE.md with V4 completion status
  - AC: All docs reflect final V4 state

- [x] **V4-4.3** V4 APK Build (version 4.0.0)
  - Version bump in `app.json`
  - Clean prebuild + assembleRelease
  - AC: APK builds successfully

---

## Dependency Graph

```
V4-1.1 (migration) ─────────────────┐
                                      ├→ V4-1.5 (account-master service)
V4-1.2 (ParsedSMS fields) ──┐        │     ├→ V4-1.6 (sms-to-expense update)
                              │        │     │     └→ V4-1.7 (financial-account update)
V4-1.3 (inferPaymentMode) ──┤        │     ├→ V4-1.9 (account master screen)
                              │        │     └→ V4-1.11 (expense account picker)
V4-1.4 (pattern enhancement)┘        │
                                      ├→ V4-1.10 (settings update) ← V4-1.8 + V4-1.9
V4-1.8 (merchant screen) ────────────┤
                                      └→ V4-1.12 (insights display names)
                                      
V4-1.13 (Phase 1 tests) ← all Phase 1 tasks

V4-2.1 (comparison service) → V4-2.2 (weekly) + V4-2.3 (compare) + V4-2.4 (presets)
V4-2.5 (wire to hub) ← V4-2.2 + V4-2.3
V4-2.6 (Phase 2 tests) ← all Phase 2 tasks

V4-3.1 (migration) → V4-3.4 (sms-to-expense) + V4-3.5 (detail page)
V4-3.2 (parseDateAndTime) → V4-3.3 (update parsers) → V4-3.4
V4-3.5 → V4-3.6 (read-only edit)
V4-3.7 (Phase 3 tests) ← all Phase 3 tasks

V4-4.1 (integration tests) ← all phases
V4-4.2 (docs) + V4-4.3 (build) ← V4-4.1
```

---

## Estimated Totals

| Metric | Estimate |
|--------|----------|
| New migrations | 2 (account_payment_modes, transaction_time) |
| New services | 2 (account-master, comparison-insights) |
| New screens | 4 (merchant master, account master, weekly, compare) |
| Modified services | 4 (bank-patterns, sms-to-expense, financial-account, spending-insights) |
| Modified screens | 4 (settings, expense add, expense detail, insights hub) |
| New tests | ~110 |
| Total tasks | 29 |
| Phases | 4 |

---

## Note: V3 Phases 3-6 Deferred

V3 Phases 0-2 + bug fixes are complete (982 tests). Phases 3-6 (reconciliation, recommendations, Play Store, final build) are deferred — V4 master data and insights work is prioritized. V3 Phase 3+ can be revisited after V4.
