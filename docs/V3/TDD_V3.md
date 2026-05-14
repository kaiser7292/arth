# Artha (अर्थ) — Version 3 Technical Design Document

**Version:** 3.0 (Draft — Phases 0-2 implemented)
**Date:** 2026-04-13
**Status:** In Progress
**Predecessor:** V2 TDD at `docs/V2/TDD_V2.md`

---

## 1. Overview

V3 adds 1 new migration, 5 new services, 2 new UI components, and 2 new route groups. Architecture remains 100% local (SQLite + MMKV, no cloud). Major infrastructure addition: local push notifications via `expo-notifications`.

**Schema version after V3 Phase 2 + Bug Fixes:** 22 migrations (14 MVP + 3 V1 + 4 V2 + 1 V3)
**Tables:** 22 (unchanged — migration 022 only adds columns)
**New services:** 5
**New components:** 2
**New route groups:** 2 (`app/advisor/`, `app/reconciliation/`)

---

## 2. Schema Changes — Implemented

### 2.1 Migration 022: household_self_split

**Purpose:** Allow the app user to participate in household expense splits without needing a `hisaab_persons` record (which would create an FK constraint issue since the app user is not in the persons table).

**File:** `database/migrations/022_household_self_split.ts`

```sql
ALTER TABLE household_expenses ADD COLUMN self_share_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE household_expenses ADD COLUMN self_is_paid INTEGER NOT NULL DEFAULT 0;
```

**Impact:**
- No new tables or indexes (ALTER TABLE only)
- `self_share_amount` stores the app user's portion of the expense
- `self_is_paid` tracks whether the user has settled their share
- Consumed by `services/household-expense.ts` for split calculation and display

### 2.2 Planned: Migration 023 (Phase 3 — Statement Reconciliation)

Two new tables:
- `statement_imports` — import metadata (id, user_id, account_id, file_name, file_type, import_date, total_rows, matched_count, unmatched_count, status)
- `statement_entries` — parsed rows (id, import_id, date, description, amount, balance, reference, match_status, matched_expense_id)

---

## 3. New Services — Implemented

### 3.1 services/notifications.ts (206 lines) — Phase 0

Local push notification service using `expo-notifications`.

**Key exports:**
| Function | Purpose |
|----------|---------|
| `requestNotificationPermissions()` | Request OS notification permission |
| `hasNotificationPermission()` | Check if permission granted |
| `sendLocalNotification(title, body, data?)` | Fire immediate local notification |
| `scheduleLocalNotification(title, body, trigger, data?)` | Schedule future notification |
| `cancelNotification(id)` | Cancel specific notification |
| `cancelAllNotifications()` | Cancel all pending |
| `isNotificationEnabled(category)` | Check MMKV toggle for category |
| `setNotificationEnabled(category, enabled)` | Set MMKV toggle |

**Types:** `NotificationCategory = "sms_scan" | "overdue_forecast" | "upcoming_due"`

**Storage:** MMKV keys `notif_sms_scan`, `notif_overdue`, `notif_upcoming` (all default `true`)

### 3.2 services/notification-scheduler.ts (128 lines) — Phase 2

Scheduled checks for overdue and upcoming dues.

**Key exports:**
| Function | Purpose |
|----------|---------|
| `checkOverdueForecasts()` | Query overdue forecasts → send notification if any |
| `checkUpcomingDues()` | Query dues within 2 days → send up to 3 notifications |

**Dependencies:** `services/notifications.ts`, `services/expense.ts` (`getOverdueForecasts`, `getForecastExpenses`)

**Notification format:**
- Overdue: "You have X overdue payments (₹Y total)" → deep-links to budget
- Upcoming: "{Expense} due in X days (₹Y)" → deep-links to expense detail

### 3.3 services/hisaab-export-pdf.ts (244 lines) — Phase 1

HTML-to-PDF generation for hisaab ledger export.

**Key exports:**
| Function | Purpose |
|----------|---------|
| `generatePersonPDF(personId)` | Person ledger: balance header, entry table, running balance |
| `generateHouseholdPDF(userId)` | Household summary: per-person balances, recent entries |

**Approach:** Builds an HTML string with inline CSS (Artha branding, table styles, color-coded debits/credits), then uses `expo-print` to convert to PDF. Returns the file URI for sharing.

### 3.4 services/hisaab-export-excel.ts (197 lines) — Phase 1

SheetJS-based Excel workbook generation.

**Key exports:**
| Function | Purpose |
|----------|---------|
| `generatePersonExcel(personId)` | 3 sheets: Info, Entries, Summary |
| `generateHouseholdExcel(userId)` | 2 sheets: Expenses, Per-Person Summary |

**Approach:** Uses `xlsx` (SheetJS) to create workbooks with auto-width columns, formatted headers, and currency formatting. Writes to a temporary file and returns the path.

### 3.5 services/hisaab-export.ts (140 lines) — Phase 1

Export coordinator — ties format selection to generation + sharing.

**Key exports:**
| Function | Purpose |
|----------|---------|
| `exportPerson(personId, format)` | Generate + share person ledger |
| `exportHousehold(userId, format)` | Generate + share household summary |

**Formats:** `"pdf" | "excel" | "text"`

---

## 4. Modified Services — Bug Fixes

### 4.1 services/household-expense.ts

- Added self-split logic: `self_share_amount` and `self_is_paid` fields in create/update operations
- Fixed FK constraint validation order for person splits
- Updated query to include self-share in balance calculations

### 4.2 services/expense.ts

- Fixed multi-select filter edge cases in SQL `IN(...)` clause construction
- Improved account/category/payment mode filter query building

### 4.3 services/sms/sms-listener.ts (+29 lines)

- Added notification trigger after successful SMS scan (calls `sendLocalNotification` with scan results)
- Improved error handling and edge case coverage in background task

### 4.4 services/sms/sms-parser.ts

- Minor merchant detection fix for edge case patterns

### 4.5 services/sms/sms-to-expense.ts

- Defensive null checks for FK references

### 4.6 services/settings.ts (+8 lines)

- Added notification-related settings helpers

---

## 5. New Components — Implemented

### 5.1 components/hisaab/ExportFormatPicker.tsx — Phase 1

Bottom sheet for selecting export format (PDF, Excel, Text).

**Props:**
```typescript
interface ExportFormatPickerProps {
  visible: boolean;
  onClose: () => void;
  target: { type: "person"; personId: string; userId: string }
        | { type: "household"; userId: string };
}
```

**Behavior:** On format selection, generates file via `services/hisaab-export.ts`, shows loading state, then opens system share sheet. Error handling with user-facing alert.

### 5.2 components/ui/DateInput.tsx (152 lines) — Bug Fix B3

Reusable date input combining manual text entry + native date picker.

**Props:**
```typescript
interface DateInputProps {
  label?: string;
  value: string;              // YYYY-MM-DD format
  onChange: (date: string) => void;
  placeholder?: string;
  error?: string;
  maximumDate?: Date | null;  // null = no limit, undefined = today
  minimumDate?: Date;
  containerClassName?: string;
}
```

**Platform behavior:**
- Android: Calendar icon opens `DateTimePicker` in dialog mode
- iOS: Calendar icon opens modal with spinner picker + "Done" button
- Both: TextInput always available for manual YYYY-MM-DD entry

---

## 6. New/Updated Screens

### New Screens

| Screen | Route | Phase | Purpose |
|--------|-------|-------|---------|
| Notification Preferences | `app/settings/notifications.tsx` | 0 | Toggle notification categories |
| Advisor Hub (placeholder) | `app/advisor/index.tsx` | 0 | Future: CC recommendations |
| Reconciliation (placeholder) | `app/reconciliation/index.tsx` | 0 | Future: statement reconciliation |

### Updated Screens

| Screen | Route | Change |
|--------|-------|--------|
| Home | `app/(tabs)/index.tsx` | +66 lines — advisor + reconciliation cards |
| Settings | `app/(tabs)/settings.tsx` | Section reorganization + notification entry + date pickers |
| Budget | `app/(tabs)/budget.tsx` | Forecast filter edge case fixes |
| Expense Add | `app/expense/add.tsx` | Date picker + TagPicker scroll fix |
| Expense Detail | `app/expense/[id].tsx` | Date picker + TagPicker scroll fix |
| Milestones | `app/goals/milestones.tsx` | DateInput component |
| Milestone Detail | `app/goals/milestone-detail.tsx` | DateInput component |
| Investment Detail | `app/goals/investment-detail.tsx` | DateInput component |
| Ledger | `app/hisaab/ledger.tsx` | Export button + DateInput (2 fields) |
| Persons | `app/hisaab/persons.tsx` | Export icon per person |
| Household | `app/hisaab/household.tsx` | Export button + self-split UI |
| Yearly Plan | `app/goals/yearly-plan.tsx` | Outflow breakdown rows |
| Salary Calculator | `app/goals/salary-calculator.tsx` | +195 lines — FY isolation fix + copy-forward |
| Insights Layout | `app/insights/_layout.tsx` | Theme token fix |
| Settings Layout | `app/settings/_layout.tsx` | Theme token fix |
| Root Layout | `app/_layout.tsx` | +41 lines — notification tap handler |

---

## 7. Infrastructure Additions

### expo-notifications

- **Purpose:** Local push notifications (no server, no FCM/APNs tokens)
- **Configuration:** Foreground handler set in `services/notifications.ts` (show alert + sound)
- **Tap handling:** Wired in `app/_layout.tsx` — parses `data.screen` from notification payload, calls `router.push()`
- **Plugin:** Added to `app.json` plugins array

### @react-native-community/datetimepicker

- **Purpose:** Native date picker for date input fields
- **Usage:** Wrapped in `components/ui/DateInput.tsx`, used on 7 screens
- **Plugin:** Added to `app.json` plugins array

### Deep Linking

- **Scheme:** `artha://` (configured in `app.json` as `"scheme": "artha"`)
- **Notification deep-links:** Tap notification → `router.push()` to target screen
- **Supported targets:** `/expense/review-queue`, `/budget`, `/expense/{id}`

---

## 8. Testing Strategy

### Test Progression

| Phase | New Tests | Total | New Test Files |
|-------|-----------|-------|---------------|
| V2 Baseline | — | 917 | — |
| Phase 0 | +16 | 933 | notification service tests |
| Phase 1 | +30 | 963 | hisaab export tests |
| Phase 2 | +11 | 974 | notification scheduler tests |
| Bug Fixes | +8 | 982 | household expense, expense filter, database migration |
| **Current** | — | **982** | **50 test suites** |

### Test Categories

- **Unit tests:** Service functions (notification formatting, export HTML template, scheduler queries, filter construction)
- **Integration tests:** Database migrations (count assertions, schema verification), export pipeline (generate + verify structure)
- **Component tests:** DateInput rendering, ExportFormatPicker format selection, notification toggle persistence

---

## 9. Planned Technical Work (Phases 3-6)

### Phase 3: Statement Reconciliation

| Deliverable | File | Lines (est.) |
|-------------|------|-------------|
| Migration 023 | `database/migrations/023_statement_imports.ts` | ~40 |
| Bank Statement Parser | `services/statement-parser.ts` | ~200 |
| Reconciliation Engine | `services/reconciliation.ts` | ~250 |
| Bank Format Presets | `constants/bank-statement-formats.ts` | ~150 |
| Import Screen | `app/reconciliation/index.tsx` | ~300 |
| Results Screen | `app/reconciliation/results.tsx` | ~350 |
| History Screen | `app/reconciliation/history.tsx` | ~200 |

**Key technical decision:** Matching engine uses a scoring system (amount exact=100pts, ±1%=80pts; date exact=50pts, ±1d=30pts, ±2d=10pts; merchant substring=40pts). Auto-match threshold: 100pts. Reuses `services/excel-import.ts` infrastructure.

### Phase 4: Recommendation Engine

- Static credit card database in `constants/credit-cards.ts` (~40 cards)
- Category-to-MCC mapping service
- Spending pattern analyzer (queries existing expense data by category/merchant)
- Recommendation engine with 3 approaches (max/balanced/min)

### Phase 5: Play Store

- Privacy Policy + Terms of Service as in-app screens
- Business Plan document (markdown)
- Optional premium gate (MMKV flag-based, no payment integration)

### Phase 6: Final Build

- Cross-feature integration tests
- Version bump 2.0.0 → 3.0.0
- Final APK/AAB build

---

## 10. Version History

| Version | Date | Change |
|---------|------|--------|
| 3.0 | 2026-04-13 | Initial V3 TDD — 1 migration, 5 services, 2 components, Phases 0-2 implemented |
