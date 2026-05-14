# Artha (अर्थ) — Version 3 Product Requirements Document

**Version:** 3.0 (Draft — Phases 0-2 complete, Phases 3-6 planned)
**Author:** Sourav Baid
**Date:** 2026-04-13
**Status:** In Progress
**Predecessor:** V2 PRD at `docs/V2/PRD_V2.md`

---

## 1. Executive Summary

Version 3 transforms Artha from a *tracking* app into an *action-enabling* app. The focus is on three pillars:

1. **External collaboration** — Export hisaab ledgers as PDF/Excel for people not using the app
2. **Smart automation** — Push notifications for SMS-detected transactions and overdue/upcoming dues
3. **Actionable savings** — Credit card/membership recommendations based on spending patterns + bank statement reconciliation

**V2 delivered:** 52 tasks, 917 tests, 4 migrations, 12 features + 6 bug fixes.

**V3 targets:** ~48 tasks across 7 phases, 2+ migrations, 6 major features. Currently Phases 0-2 complete + 10 bug fixes.

### Current State (as of 2026-04-13)

| Metric | V2 (Baseline) | V3 (Current) | V3 (Projected) |
|--------|--------------|-------------|----------------|
| Tests | 917 | 982 | ~1,062 |
| Migrations | 21 | 22 | 23+ |
| Services | ~34 | ~39 | ~48 |
| Screens | 43 | 45+ | ~60 |
| Version | 2.0.0 | 2.0.0 | 3.0.0 |

---

## 2. Completed — Phase 0: Navigation & Notification Infrastructure (F6)

**Goal:** Create room for V3 features in the Home dashboard + set up push notification plumbing.

### V3-0.1: Home Screen Dashboard Redesign

Enhanced the Home screen from a simple stats display to a categorized dashboard with action cards:
- **Quick Stats** section (monthly spending, budget remaining)
- **Action Cards**: Upcoming Dues, Hisaab, Insights (existing) + Savings Advisor, Reconciliation (new placeholders)
- **Recent Transactions** section

File: `app/(tabs)/index.tsx` (+66 lines)

### V3-0.2: Route Groups (Advisor + Reconciliation)

Created new route groups for V3 features with Stack layouts and placeholder screens:
- `app/advisor/_layout.tsx` + `app/advisor/index.tsx` — Savings Advisor hub (placeholder)
- `app/reconciliation/_layout.tsx` + `app/reconciliation/index.tsx` — Statement Reconciliation (placeholder)

Both follow the existing `app/insights/_layout.tsx` pattern.

### V3-0.3: Settings Screen Reorganization

Reorganized settings from a flat list into clear sections:
- Data & Import
- Appearance
- SMS & Detection
- Backup & Export
- Notifications (new entry point)
- About

File: `app/(tabs)/settings.tsx`

### V3-0.4: Notification Infrastructure

Installed `expo-notifications` and created the notification service layer:
- `services/notifications.ts` (206 lines): `requestNotificationPermissions()`, `scheduleLocalNotification()`, `cancelNotification()`, `cancelAllNotifications()`
- MMKV settings for per-category toggles (SMS scan, overdue, upcoming dues)
- Notification tap handler wired in `app/_layout.tsx` for deep-linking

### V3-0.5: Notification Preferences Screen

New screen at `app/settings/notifications.tsx`:
- Toggle switches per notification type (SMS scan alerts, overdue reminders, upcoming due reminders)
- Toggles persist via MMKV
- Master enable/disable for all notifications

### V3-0.6: Phase 0 Tests

16 new tests covering notification service (mocked `expo-notifications`), Home screen card rendering, and route accessibility. Total: 917 → 933.

---

## 3. Completed — Phase 1: Hisaab Export — PDF & Excel (F1)

**Goal:** Let users share their family ledger as PDF or Excel with people who don't use the app.

### V3-1.1: PDF Generation Service

`services/hisaab-export-pdf.ts` (244 lines):
- `generatePersonPDF(personId)` — person ledger with balance, all entries, running balance
- `generateHouseholdPDF(userId)` — household summary with per-person balances and recent entries
- HTML template with Artha branding, formatted tables, color-coded debits/credits
- Uses `expo-print` for HTML-to-PDF conversion

### V3-1.2: Excel Export Service

`services/hisaab-export-excel.ts` (197 lines):
- Person export: 3 sheets (Info, Entries, Summary)
- Household export: 2 sheets (Expenses, Per-Person Summary)
- Auto-width columns, formatted headers, currency formatting
- Uses SheetJS (`xlsx` library, already in project from V2 Excel import)

### V3-1.3: Export Format Picker Component

`components/hisaab/ExportFormatPicker.tsx`:
- Bottom sheet with 3 format options: PDF, Excel, Text (plain text summary)
- On select → generates file → opens system share sheet via `expo-sharing`
- Loading states and error handling

### V3-1.4: Wire Export to Hisaab Screens

Export button added to all 3 hisaab screens:
- `app/hisaab/ledger.tsx` — "Export" quick action in balance header
- `app/hisaab/persons.tsx` — export icon per person card
- `app/hisaab/household.tsx` — "Export Summary" button

### V3-1.5: Phase 1 Tests

30 new tests covering PDF HTML template generation, Excel workbook structure (sheet names, column headers), export format selection, and integration flow. Total: 933 → 963.

---

## 4. Completed — Phase 2: Push Notifications (F2)

**Goal:** Notify users when SMS scan finds new transactions or when dues are approaching/overdue.

### V3-2.1: Wire Notifications to SMS Background Task

After `processParseResults()` in `services/sms/sms-listener.ts`:
- If new items created, push notification: "X new transactions found (Swiggy ₹450, Amazon ₹1,200, +1 more)"
- Notification deep-links to `/expense/review-queue`
- Respects user's notification toggle (MMKV)

### V3-2.2: Overdue Forecast Notifications

`services/notification-scheduler.ts` (128 lines):
- `scheduleOverdueCheck()` — daily at 9 AM, queries overdue forecasts
- Notification: "You have X overdue payments (₹Y total)"
- Deep-links to budget screen with overdue filter

### V3-2.3: Upcoming Due Notifications

Same scheduler:
- `scheduleUpcomingDueCheck()` — dues within 2 days
- Max 3 notifications per check to avoid spam
- Deep-links to specific forecast expense detail

### V3-2.4: Notification Tap Deep-Linking

Notification payload includes `data.screen` field:
- Tap handler in `app/_layout.tsx` parses payload and calls `router.push()`
- Handles both foreground and cold-start cases
- Supported screens: review-queue, budget, expense detail

### V3-2.5: Phase 2 Tests

11 new tests covering notification message formatting, scheduler query logic, and mock scheduling. Total: 963 → 974.

---

## 5. Bug Fixes (Post-Phase 2, Pre-Phase 3)

10 bugs discovered during user testing of Phases 0-2. All fixed before proceeding.

### B1: Household Self-Split FK Constraint

**Problem:** App user couldn't participate in household expense splits because the split system required a `hisaab_persons` record, but the app user has no such record.

**Fix:** Migration 022 (`household_self_split`) — added `self_share_amount REAL` and `self_is_paid INTEGER` columns to `household_expenses` table. The app user's share is now stored on the parent record, avoiding the FK constraint entirely.

### B2: Yearly Plan Outflow Breakdown Missing

**Problem:** Plan Summary card showed only a single "Total Outflow" line without decomposition.

**Fix:** Added Expenses, Investments, and Milestones detail rows before the Total Outflow line with appropriate icons.

### B3: Date Inputs — No Native Date Picker

**Problem:** All 7 screens with date inputs used manual text entry (YYYY-MM-DD format). Error-prone, bad UX.

**Fix:** Created reusable `components/ui/DateInput.tsx` (152 lines) combining TextInput for manual entry + calendar icon button that opens the platform-native date picker. Android uses dialog mode, iOS uses modal with spinner.

New dependency: `@react-native-community/datetimepicker`

**Screens updated:** milestones, milestone-detail, investment-detail, ledger (2 fields), expense add, expense detail, settings (2 fields).

### B4: Household Expense Creation FK Constraint

**Problem:** Creating household expenses with person splits failed due to FK constraint validation order.

**Fix:** Fixed creation flow and validation in `services/household-expense.ts`.

### B5: Budget Forecast Matching Edge Cases

**Problem:** Multi-select account/category/payment mode filtering had edge cases in SQL `IN(...)` clauses.

**Fix:** Updated query construction in `services/expense.ts`.

### B6: Tag Picker Keyboard Covering Content

**Problem:** On expense add/edit screens, opening the TagPicker dropdown was hidden behind the keyboard.

**Fix:** Added `onOpen` callback prop to TagPicker. Parent screens use ScrollView refs with `scrollToEnd({ animated: true })` after a 150ms delay (for keyboard animation).

### B7: SMS Listener Edge Cases

**Problem:** SMS background processing had error handling gaps.

**Fix:** Improved error handling and edge case coverage in `services/sms/sms-listener.ts` and `services/sms/sms-to-expense.ts`.

### B8: SMS Parser Improvements

**Problem:** Minor merchant detection edge case.

**Fix:** Parsing fix in `services/sms/sms-parser.ts`.

### B9: Insights & Settings Layout Fixes

**Problem:** Stack header styles in insights and settings route groups didn't use theme tokens consistently.

**Fix:** Updated `app/insights/_layout.tsx` and `app/settings/_layout.tsx` to use `theme.X` tokens.

### B10: Salary Calculator FY Isolation + Copy-Forward

**Problem (FY Isolation):** Saving income data for one fiscal year overwrote all other FYs. Root cause: the `getSalaryProfileByPlanId` fallback loaded a profile from a different FY, then UPDATE overwrote it instead of CREATE.

**Fix:** Removed the faulty fallback. Form now resets to defaults on every FY change. Only `getSalaryProfileByFY` is used for loading — ensures FY-specific profiles.

**Problem (Copy-Forward):** When navigating to a new FY with no income data, the form started completely blank. No way to carry forward income data.

**Fix:** When no profile exists for the selected FY but the previous FY has data, the user sees a card with two options:
- **"Copy As-Is"** — copies all settings unchanged
- **"Copy with Hike %"** — user enters a CTC increase percentage. Hike applies to CTC only (or monthly in-hand for direct mode). All other settings (basic %, HRA %, EPF mode, deductions, state) copy as-is.

After copying, the form is populated but NOT auto-saved — user reviews and saves manually.

---

## 6. Planned — Phase 3: Statement Reconciliation (F5)

**Status:** PLANNED — 10 tasks

**Goal:** Import bank/CC statements (CSV/Excel), match against logged expenses, find missing transactions.

**Key decisions:**
- CSV/Excel only (Indian banks rarely offer OFX; PDF parsing unreliable)
- Reuses existing `services/excel-import.ts` infrastructure
- Auto-detect bank format from column patterns (HDFC, ICICI, SBI, Axis, generic)
- Matching engine: amount ±1%, date ±2 days, merchant fuzzy match — scoring system

**Deliverables:**
- Migration 023: `statement_imports` + `statement_entries` tables
- `services/statement-parser.ts` — bank format detection + CSV parsing
- `services/reconciliation.ts` — matching engine (scoring: amount, date, merchant)
- `app/reconciliation/index.tsx` — import flow (select account → pick file → auto-detect → reconcile)
- `app/reconciliation/results.tsx` — matched (green), unmatched (red), extra in app (orange)
- `app/reconciliation/history.tsx` — past imports with stats
- `constants/bank-statement-formats.ts` — column mappings for top 10 Indian banks
- ~30 new tests

---

## 7. Planned — Phase 4: Credit Card & Membership Recommendations (F4)

**Status:** PLANNED — 12 tasks

**Goal:** Analyze spending patterns and recommend credit cards/memberships that maximize savings.

**Key decisions:**
- Bundled JSON database (~40 Indian cards, ~10 loyalty programs) — sourced ONLY from bank websites
- Three recommendation approaches: Maximum (many cards), Balanced (moderate), Minimum (single best)
- Financial advice disclaimers on every advisor screen
- No card application links, no affiliate — purely informational

**Deliverables:**
- `constants/credit-cards.ts` — ~40 Indian credit cards with cashback rates per MCC category
- `constants/memberships.ts` — ~10 loyalty programs with cost/savings per merchant
- `services/category-mcc-mapper.ts`, `services/spending-analyzer.ts`, `services/recommendation-engine.ts`
- 4 screens: Advisor Hub, Card Recommendations, Analyze My Card, Membership Recommendations
- `constants/disclaimers.ts` — financial advice disclaimer
- ~40 new tests

---

## 8. Planned — Phase 5: Play Store Publishing (F3)

**Status:** PLANNED — 6 tasks

**Deliverables:**
- Privacy Policy screen (`app/settings/privacy-policy.tsx`)
- Terms of Service screen (`app/settings/terms-of-service.tsx`)
- Business Plan document (`docs/V3/BUSINESS_PLAN.md`)
- App Store assets (descriptions, feature list, content rating)
- Optional: Premium gate (`services/premium.ts`)
- ~10 new tests

---

## 9. Planned — Phase 6: Testing, Documentation & APK Build

**Status:** PLANNED — 4 tasks

**Deliverables:**
- Cross-feature integration tests (~20 new tests)
- Final V3 documentation (this PRD complete, TDD complete, CLAUDE.md update)
- V3 APK build (version bump to 3.0.0)
- Optional: Play Store prep (signed AAB)

---

## 10. Updated Data Model

### Migration 022: household_self_split (Bug Fix)

```sql
ALTER TABLE household_expenses ADD COLUMN self_share_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE household_expenses ADD COLUMN self_is_paid INTEGER NOT NULL DEFAULT 0;
```

**Purpose:** Allow the app user to participate in household splits without needing a `hisaab_persons` record.

### Planned: Migration 023 (Phase 3)

Two new tables: `statement_imports` (import metadata) and `statement_entries` (parsed rows with match status).

---

## 11. Tech Stack Additions

| Package | Version | Purpose | Phase |
|---------|---------|---------|-------|
| `expo-notifications` | ^0.29 | Local push notifications | Phase 0 |
| `@react-native-community/datetimepicker` | ^8.3 | Native date picker | Bug Fix B3 |
| `expo-print` | (already available via Expo) | HTML-to-PDF generation | Phase 1 |

---

## 12. Testing Summary

| Phase | New Tests | Running Total |
|-------|-----------|---------------|
| V2 Baseline | — | 917 |
| Phase 0 | +16 | 933 |
| Phase 1 | +30 | 963 |
| Phase 2 | +11 | 974 |
| Bug Fixes | +8 | 982 |
| **Current** | — | **982** |
| Phase 3 (est.) | +30 | ~1,012 |
| Phase 4 (est.) | +40 | ~1,052 |
| Phase 5 (est.) | +10 | ~1,062 |

---

## 13. V4 Forward Look

After V3 is complete, V4 will focus on **data quality, flexibility, and accuracy**. Full backlog at `docs/V4/V4_FEATURE_BACKLOG.md`.

| Feature | Summary |
|---------|---------|
| Merchant Name Master Data | Editable mappings of detected merchant patterns → readable display names |
| Account-Payment Mode Linking | Formalize that one account (e.g., HDFC Savings) can have multiple payment modes (debit card, UPI, net banking) |
| Account Editing on Expenses | Allow changing account on any expense; auto-suggest payment mode from master data |
| Week-on-Week Comparison | Short-term spending trends in insights |
| Custom Date Range Comparison | Pick any two date ranges, compare all metrics side-by-side |
| Transaction Timestamps | Store time on expenses (from SMS for auto, start-of-day for manual); show on detail page only; immutable on edit |

---

## 14. Version History

| Version | Date | Change |
|---------|------|--------|
| 3.0 | 2026-04-13 | Initial V3 PRD — Phases 0-2 complete, 10 bugs fixed, Phases 3-6 planned, V4 backlog referenced |
