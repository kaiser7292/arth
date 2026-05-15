# SMS Scan Runs UI and Account Filtering Fix

Implement Option 1 (move account filtering to after parsing) and create a dedicated "SMS Scan Runs" page in Settings to view scan history with detailed breakdown, adhering to system design and supporting both light/dark modes.

## System Design Adherence

**Database Schema:**
- Follow existing migration pattern (numbered migration file in `database/migrations/`)
- Use TEXT for JSON fields (account_ids, parse_result) to maintain SQLite compatibility
- Include `user_id` for multi-user support (follows existing pattern)
- Use `created_at` TEXT in ISO format (follows existing pattern)
- Add proper foreign key with CASCADE delete (follows existing pattern)

**Service Layer:**
- Create new service file `services/sms-scan-logging.ts` for scan logging logic
- Follow existing service pattern (export functions, use getDatabase)
- Return proper types from all functions
- Handle errors gracefully with try-catch

**UI Components:**
- Use existing components: `Card`, `ScreenContainer`, `SettingsRow`
- Follow existing color scheme pattern via `useColorScheme()`
- Use `StatusColors[colorScheme]` for semantic colors
- Use `ac()` function for accent color calculation
- Follow existing typography patterns (text-xs, text-sm, text-lg, etc.)
- Use existing spacing patterns (mb-2, mt-4, etc.)

## Functional Correctness

**Account Filtering Logic:**
- Preserve exact same matching logic when moving to `sms-to-expense.ts`
- Test with existing account types: demat, pension, credit_card, savings
- Handle edge cases: empty accountIds list, null account identifiers
- Ensure EPFO merchant matching works with passbook IDs
- Ensure cardLast4 matching works for regular accounts

**Scan Logging:**
- Log counts at each stage (read, parsed, filtered, created)
- Ensure counts are accurate and consistent
- Handle scan failures gracefully (log error state)
- Don't block scan on logging failures (non-fatal)

**Data Integrity:**
- Use transactions when inserting scan details (atomicity)
- Clean up old scan runs (implement retention policy)
- Handle duplicate SMS correctly (existing logic in sms-parser.ts)

## Light/Dark Mode Considerations

**Color Usage:**
- Use `useColorScheme()` hook for theme colors
- Use semantic color tokens: `text-primary`, `text-secondary`, `text-tertiary`
- Use dark mode variants: `text-dark-primary`, `text-dark-secondary`, etc.
- Use `border-border-light` / `border-border-dark` for borders
- Use `bg-primary/10` for accent backgrounds with opacity

**Component Styling:**
- All text elements should include dark mode classes
- All borders should include dark mode classes
- Backgrounds should use conditional styling or theme-aware colors
- Icons should use theme-aware colors from `useColorScheme()`

**Scan Runs List:**
- Card background: white (light) / dark gray (dark)
- Text: primary colors for headers, secondary for details
- Accents: use `accent[500]` for primary actions
- Status indicators: use `StatusColors` for success/warning/error

**Drilldown View:**
- Category headers: bold primary text
- SMS cards: same styling as existing expense cards
- Expandable sections: use existing expand/collapse pattern
- Code/data display: use monospace font with theme-aware background

## UI Mockups

### Main SMS Scan Runs List View
```
┌─────────────────────────────────────────┐
│ ← SMS Scan Runs                    │
├─────────────────────────────────────────┤
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Manual Scan • May 15, 2:30 PM      │ │
│ │ Date: Last 7 days                  │ │
│ │ Accounts: All accounts             │ │
│ │                                   │ │
│ │ 50 SMS read  •  40 parsed  •  30   │ │
│ │ filtered  •  25 expenses created   │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Auto Scan • May 14, 9:00 AM        │ │
│ │ Date: Since last check            │ │
│ │ Accounts: All accounts             │ │
│ │                                   │ │
│ │ 12 SMS read  •  10 parsed  •  8    │ │
│ │ filtered  •  6 expenses created    │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Manual Scan • May 12, 5:45 PM      │ │
│ │ Date: Last 30 days                │ │
│ │ Accounts: HDFC, ICICI              │ │
│ │                                   │ │
│ │ 120 SMS read  •  95 parsed  •  70  │ │
│ │ filtered  •  55 expenses created   │ │
│ └─────────────────────────────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

### Scan Run Drilldown View
```
┌─────────────────────────────────────────┐
│ ← Scan: May 15, 2:30 PM               │
├─────────────────────────────────────────┤
│ Manual Scan • Last 7 days • All accts  │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ ▼ Hardcoded Matches (25)            │ │
│ │   25 SMS matched by bank patterns   │ │
│ │   [Tap to view SMS list]            │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ ▼ Template Matches (15)             │ │
│ │   15 SMS matched by user templates  │ │
│ │   [Tap to view SMS list]            │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ ▼ Filtered Out (30)                  │ │
│ │   20: Account mismatch              │ │
│ │   10: No card last4 found           │ │
│ │   [Tap to view SMS list]            │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ ▼ Unrecognized (0)                   │ │
│ │   0 SMS couldn't be parsed          │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ ▼ Skipped (0)                        │ │
│ │   0 SMS skipped (OTP, reminders)    │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Summary: 50 read → 40 parsed → 30      │ │
│ filtered → 25 expenses created         │ │
└─────────────────────────────────────────┘
```

### SMS Detail View (within category)
```
┌─────────────────────────────────────────┐
│ ← Hardcoded Matches (25)              │
├─────────────────────────────────────────┤
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ AD-HDFCBK • May 15, 2:28 PM        │ │
│ │                                   │ │
│ │ Your A/c XX1234 debited Rs.2,500  │ │
│ │ for UPI transaction to Amazon...   │ │
│ │ [Tap to expand full SMS]          │ │
│ │                                   │ │
│ │ Amount: ₹2,500                    │ │
│ │ Merchant: Amazon                  │ │
│ │ Card: ••••1234                    │ │
│ │ Type: debit                       │ │
│ │ Source: Hardcoded pattern         │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ VM-ICICIB • May 15, 2:25 PM        │ │
│ │                                   │ │
│ │ Rs.1,200 credited to A/c XX5678   │ │
│ │ via NEFT from John Doe...          │ │
│ │ [Tap to expand full SMS]          │ │
│ │                                   │ │
│ │ Amount: ₹1,200                    │ │
│ │ Merchant: John Doe                │ │
│ │ Card: ••••5678                    │ │
│ │ Type: credit                      │ │
│ │ Source: Hardcoded pattern         │ │
│ └─────────────────────────────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

### Filtered SMS Detail View
```
┌─────────────────────────────────────────┐
│ ← Filtered Out (30)                    │
├─────────────────────────────────────────┤
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ AD-SBIBNK • May 15, 2:20 PM        │ │
│ │                                   │ │
│ │ Your A/c XX9999 debited Rs.5,000  │ │
│ │ for UPI transaction to Flipkart... │ │
│ │ [Tap to expand full SMS]          │ │
│ │                                   │ │
│ │ Amount: ₹5,000                    │ │
│ │ Merchant: Flipkart                │ │
│ │ Card: ••••9999                    │ │
│ │ Type: debit                       │ │
│ │ Source: Template match            │ │
│ │                                   │ │
│ │ ⚠️ Filtered: Account mismatch      │ │
│ │    (Card ••••9999 not in selected  │ │
│ │     accounts: HDFC, ICICI)         │ │
│ └─────────────────────────────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

## Testing Strategy

### Integration Tests

**Test File: `__tests__/integration/sms-scan-runs.test.ts`**
- Test that scan runs are logged correctly after manual scan
- Test that scan details are logged with correct categories
- Test that account filtering works after template matching
- Test that SMS Scan Runs UI displays data correctly
- Test drilldown navigation from list to category to SMS detail

**Test Scenarios:**
1. Manual scan with no account selection → all SMS should be logged
2. Manual scan with specific accounts → filtering should happen after parsing
3. Template-based SMS should be included in scan details
4. Hardcoded pattern SMS should be categorized correctly
5. Filtered SMS should show correct filter reason

### Regression Tests

**Test File: `__tests__/regression/account-filtering-move.test.ts`**
- Test that existing SMS scan flow still works without account selection
- Test that existing SMS scan flow still works with account selection
- Test that template matching still works for user templates
- Test that hardcoded patterns still take precedence
- Test that expense creation still works correctly after filtering

**Test Scenarios:**
1. Existing manual scan (no account selection) → same behavior as before
2. Existing manual scan (with account selection) → same expense count as before
3. User template matching → should still work and be logged
4. EPFO account matching → should still work with passbook IDs
5. Regular account matching → should still work with cardLast4

### Existing Flow Verification

**Manual Verification Steps:**
1. Run manual scan without account selection → verify expenses created match previous behavior
2. Run manual scan with account selection → verify only selected accounts' SMS create expenses
3. Create a user template → verify it still matches SMS correctly
4. Check SMS Scan Runs UI → verify it displays scan history correctly
5. Drill into scan details → verify categories and SMS details are correct

**Automated Verification:**
- Run existing SMS scan integration tests
- Run existing template matching tests
- Run existing account linking tests
- Ensure no tests fail after changes

### Performance Tests

**Test File: `__tests__/performance/scan-logging.test.ts`**
- Test that logging doesn't significantly slow down SMS scan
- Test that scan details insertion is efficient (use transactions)
- Test that SMS Scan Runs UI loads quickly with many scan runs
- Test that drilldown navigation is responsive

**Test Scenarios:**
1. Scan 100 SMS → verify logging overhead < 500ms
2. Scan 500 SMS → verify logging overhead < 2s
3. Load 50 scan runs in UI → verify load time < 1s
4. Load scan details with 100 SMS → verify load time < 500ms

### Data Integrity Tests

**Test File: `__tests__/data-integrity/scan-runs.test.ts`**
- Test that scan runs are cleaned up after retention period
- Test that cascade delete works when scan run is deleted
- Test that duplicate SMS are handled correctly in scan details
- Test that failed scans are logged with error state

**Test Scenarios:**
1. Create scan run → verify it's saved correctly
2. Delete scan run → verify cascade delete removes details
3. Retention cleanup → verify old scan runs are removed
4. Scan with error → verify error state is logged

## Implementation Plan

### Part 1: Move Account Filtering to After Parsing (Option 1)

**File: `services/sms/sms-reader.ts`**
- Remove account filtering logic from `fetchBankSMSRange()` (lines 142-182)
- Pass `accountIds` parameter through to caller without filtering
- SMS reader will return all bank SMS (plus user-claimed senders)

**File: `services/sms/sms-to-expense.ts`**
- Add account filtering logic after template matching
- In `processParseResults()`, filter parsed items by account identifiers
- Use same matching logic as current filter (cardLast4 for regular accounts, merchant for EPFO)
- This ensures templates get to match before any filtering

### Part 2: Database Schema for Scan Runs

**New Table: `sms_scan_runs`**
```sql
CREATE TABLE sms_scan_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  run_timestamp INTEGER NOT NULL,
  is_manual INTEGER NOT NULL,
  start_date TEXT,
  end_date TEXT,
  account_ids TEXT, -- JSON array of selected account IDs
  sms_read_count INTEGER NOT NULL,
  sms_parsed_count INTEGER NOT NULL,
  sms_filtered_count INTEGER NOT NULL,
  sms_hardcoded_match_count INTEGER NOT NULL,
  sms_template_match_count INTEGER NOT NULL,
  sms_unrecognized_count INTEGER NOT NULL,
  sms_skipped_count INTEGER NOT NULL,
  expense_created_count INTEGER NOT NULL,
  credit_created_count INTEGER NOT NULL
);
```

**New Table: `sms_scan_details`**
```sql
CREATE TABLE sms_scan_details (
  id TEXT PRIMARY KEY,
  scan_run_id TEXT NOT NULL,
  sms_id TEXT NOT NULL,
  sms_address TEXT,
  sms_body TEXT,
  sms_date INTEGER,
  parse_source TEXT, -- 'hardcoded', 'template', 'unrecognized', 'skipped'
  parse_result TEXT, -- JSON of parsed data
  filter_reason TEXT, -- 'account_mismatch', 'no_card_last4', etc.
  created_at TEXT NOT NULL,
  FOREIGN KEY (scan_run_id) REFERENCES sms_scan_runs(id) ON DELETE CASCADE
);
```

**Migration:** Add new migration file for these tables

### Part 3: SMS Scan Logging

**File: `services/sms/sms-orchestrator.ts`**
- Create `logScanRun()` function to save scan results to `sms_scan_runs`
- Create `logScanDetails()` function to save per-SMS details to `sms_scan_details`
- Call these functions in `runSmsScan()` after each stage:
  - After SMS read: log SMS count
  - After parsing: log parse counts (hardcoded vs template)
  - After filtering: log filtered count
  - After expense creation: log expense/credit counts

**File: `services/sms/sms-parser.ts`**
- Return detailed parse results including source (hardcoded vs template)
- Track which SMS matched which pattern type

### Part 4: SMS Scan Runs UI

**New File: `app/settings/sms-scan-runs.tsx`**
- List view of all scan runs with:
  - Timestamp
  - Scan type (manual/auto)
  - Date range
  - Selected accounts (if any)
  - Summary counts: read, parsed, filtered, created
- Tap on a scan run to show drilldown view

**Drilldown View:**
- Grouped by category:
  - Hardcoded matches (count, tap to see SMS list)
  - Template matches (count, tap to see SMS list)
  - Filtered out (count, tap to see SMS list with filter reason)
  - Unrecognized (count, tap to see SMS list)
  - Skipped (count, tap to see SMS list)
- Each SMS detail shows:
  - Sender address
  - SMS body (truncated with expand)
  - SMS date
  - Parse source
  - Parsed data (amount, merchant, etc.)
  - Filter reason (if filtered)

**File: `app/(tabs)/settings.tsx`**
- Add new SettingsRow for "SMS Scan Runs" under SMS Detection section
- Link to `/settings/sms-scan-runs`

### Part 5: Route Registration

**File: `app/_layout.tsx`**
- No changes needed (file-based routing)

## Execution Order

1. Create database migration for new tables
2. Modify `sms-reader.ts` to remove account filtering
3. Modify `sms-to-expense.ts` to add account filtering after parsing
4. Add logging functions to `sms-orchestrator.ts`
5. Modify `sms-parser.ts` to track parse source
6. Create `sms-scan-runs.tsx` UI page
7. Add link in `settings.tsx`
8. Test end-to-end with manual scan
