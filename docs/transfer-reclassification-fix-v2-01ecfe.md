# Fix Transfer Reclassification Display Issues

This plan fixes the issues where expenses marked as transfers don't show in the transfers filter and undo transfer removes expenses from views.

## Root Cause Analysis

### Issue 1: getTransfersForMonth called with wrong parameter
In `app/(tabs)/expenses.tsx` line 166-170, `getTransfersForMonth` is called with `DEFAULT_USER_ID` but the function signature expects `accountId`. This causes the query to return no results.

### Issue 2: Migration may not have run
The `reclassified_as_transfer` column might not exist in the database if migration 046 didn't run on the device.

### Issue 3: Expense queries may filter reclassified expenses
General expense queries might be filtering out expenses that have `reclassified_as_transfer = 1`, causing them to disappear from ledger and expense/credit views.

## Implementation Plan

### 1. Fix getTransfersForMonth call
**File**: `app/(tabs)/expenses.tsx`

Create a new function `getTransfersForUser` that queries all transfers for a user across all accounts, then update the expenses tab to use this function instead of `getTransfersForMonth`.

### 2. Verify migration runs
**File**: `database/migrations/index.ts`

Ensure migration 046 is properly registered. If the column doesn't exist on device, the user may need to clear app data to force migration rerun.

### 3. Check expense queries for reclassified filter
**File**: `services/expense-queries.ts`

Review all expense query functions to ensure they don't filter out reclassified expenses (`reclassified_as_transfer = 1`). These expenses should appear in general views with their original nature (realized/credit).

### 4. Fix undo transfer logic
**File**: `services/account-transfer.ts`

The `undoTransfer` function already correctly sets `reclassified_as_transfer = 0` and `linked_transfer_id = NULL`. Verify this is working and check if any other logic is interfering.

## Testing
- Mark an expense as transfer and verify it appears in transfers filter
- Undo transfer and verify expense reappears in ledger and expense/credit views
- Verify expense appears in general expense/credit views after undo
