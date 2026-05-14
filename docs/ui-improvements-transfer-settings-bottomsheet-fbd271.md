# UI Improvements: Transfer Display, Settings Styling, Bottom Sheet Sizing, and Biometric Lock

Investigate and fix four UI issues: settings styling adherence, transfer section display/navigation, bottom sheet sizing problems, and biometric lock loop issue with immediate timeout.

## Investigation Findings

### 1. Settings Styling
- **Status**: Settings screen follows consistent styling patterns
- **Findings**: 
  - Uses text-base, text-xs, text-sm for font sizes
  - Uses font-semibold, font-medium for font weights
  - Consistent with other screens in the app
  - No issues found with current styling

### 2. Transfer Section Issues

#### Issue 2a: "unknown -> account" display
- **Root Cause**: In `account-ledger.tsx` line 375, `counterAccountName: acctMap.get(counterId) ?? "Unknown"`
- **Problem**: The `acctMap` is built from `getActiveAccounts()`, so if a counter account is inactive or deleted, it won't be found and displays as "Unknown"
- **Solution**: Fetch all accounts (including inactive) when building the account map for transfer display, or show "(Deleted)" instead of "Unknown" for better UX

#### Issue 2b: Clicking transfers in account ledger doesn't navigate to expense
- **Root Cause**: Transfers in account-ledger don't have onPress handlers to navigate to linked expense
- **Problem**: The `linked_expense_id` field exists in account_transfers table but isn't used for navigation
- **Solution**: Add onPress handler to transfer rows that navigates to `/expense/[linked_expense_id]` when linked_expense_id is not null

#### Issue 2c: Expense details doesn't show transfer indicator
- **Root Cause**: `linkedTransfer` state exists in expense/[id].tsx but isn't displayed in the UI
- **Problem**: Unlike split/investment indicators, there's no visual badge showing the expense is marked as transfer
- **Solution**: Add a "Transfer" badge in ExpenseHeroCard or a dedicated section in expense details showing transfer info (from/to accounts) with undo action

### 3. Bottom Sheet Issues

#### Issue 3a: Sheets are too small
- **Root Cause**: Fixed max-height of 420px (EntryEditSheet, PrepaymentSheet, ManualCorrectionSheet)
- **Problem**: This fixed height doesn't adapt to content, causing unnecessary whitespace or cutting off content
- **Solution**: Use dynamic height based on content (e.g., max-h-[70vh]) or increase to a larger fixed height (e.g., max-h-[500px] or max-h-[600px])

#### Issue 3b: Button not visible in cash flow simulator
- **Root Cause**: Limited scroll area with max-h-[420px] causes button to be off-screen when content is long
- **Problem**: EntryEditSheet has many fields (flavor, amount, date, account, to account, category, merchant, description, person) that exceed the scrollable area
- **Solution**: 
  - Increase max-height to accommodate all fields
  - Or move save button outside scrollable area (fixed at bottom)
  - Or use `flex-1` on ScrollView with proper flex layout

## Fix Plan

### 1. Settings Styling
- **Action**: No changes needed - styling is already consistent

### 2. Transfer Display Fixes

#### Fix 2a: Show proper account names for transfers
- **File**: `app/reconciliation/account-ledger.tsx`
- **Change**: Modify account map to include all accounts (not just active), or show "(Deleted)" for missing accounts
- **Code**: Change `getActiveAccounts()` to include inactive accounts for transfer display

#### Fix 2b: Add navigation from transfers to expense details
- **File**: `app/reconciliation/account-ledger.tsx`
- **Change**: Add `linked_expense_id` to LedgerEntry interface and onPress handler
- **Code**: 
  - Add `linkedExpenseId?: string` to LedgerEntry interface
  - Populate it when building ledger from transfers
  - Add onPress to transfer row: `onPress={() => router.push(\`/expense/\${entry.linkedExpenseId}\`)}`
  - Show chevron icon when linkedExpenseId exists

#### Fix 2c: Add transfer indicator to expense details
- **File**: `app/expense/[id].tsx`
- **Change**: Display transfer badge/section when linkedTransfer is not null
- **Code**:
  - Add transfer badge to ExpenseHeroCard (similar to refund badges)
  - Or add a dedicated section showing "Transfer from/to X account" with undo action
  - Show counter account name using the transfer record's from_account_id/to_account_id

### 3. Bottom Sheet Sizing Fixes

#### Fix 3a: Increase bottom sheet height
- **Files**: 
  - `components/simulator/EntryEditSheet.tsx`
  - `components/loans/PrepaymentSheet.tsx`
  - `components/loans/ManualCorrectionSheet.tsx`
- **Change**: Change max-h-[420px] to max-h-[70vh] or max-h-[600px]
- **Code**: Replace `max-h-[420px]` with `max-h-[70vh]` for dynamic height based on screen size

#### Fix 3b: Ensure button visibility in EntryEditSheet
- **File**: `components/simulator/EntryEditSheet.tsx`
- **Change**: Move save button outside scrollable area or increase scroll height
- **Code**: 
  - Increase ScrollView max-height to ensure button is always visible
  - Or use flex layout with button fixed at bottom
  - Or use `keyboardShouldPersistTaps="handled"` and ensure proper padding

## Notes

- Transfer navigation should only work when linked_expense_id is not null
- For deleted accounts, consider showing "(Deleted account)" instead of "Unknown" for better UX
- Bottom sheet height should be responsive to screen size (use vh units)
- EntryEditSheet has the most fields and needs the most height consideration

### 4. Biometric Lock and Loader Page (Main Branch Investigation)

#### Investigation Summary
- **Files compared**: `services/biometric-lock.ts` and `app/_layout.tsx` between main and staging branches
- **Finding**: `biometric-lock.ts` is identical between main and staging branches
- **Finding**: `app/_layout.tsx` has significant differences between main and staging

#### Key Differences in app/_layout.tsx

**Main branch has:**
- `initClassificationSystem()` call during initialization (line ~200)
- No `lockEvaluated` state
- Error handling that shows error screen BEFORE checking dbReady/minSplashDone
- No fresh install retry logic
- Simpler biometric lock evaluation without `lockEvaluated` gating

**Staging branch has:**
- Removed `initClassificationSystem()` call
- Added `lockEvaluated` state to prevent content flash before lock screen
- Error handling that shows error screen AFTER checking dbReady/minSplashDone
- Added fresh install retry logic (up to 3 attempts)
- Biometric lock evaluation gated by `lockEvaluated` state

#### Issue: "Immediate" Timeout Causes Loop

**Root Cause**: When biometric lock is enabled with "immediate" timeout:
1. User enables lock with "immediate" timeout → `markUnlocked()` sets `lastUnlockAt` to now
2. When app opens, `shouldShowLock()` checks: `now - lastUnlock >= 0` → always true
3. Lock screen redirects to lock screen
4. After unlock, redirects back to tabs
5. On re-render or app state change, evaluates again → infinite loop

**Main Branch Approach**: Does not use `lockEvaluated` gating. The lock evaluation happens but doesn't prevent splash dismissal.

**Staging Branch Approach**: Added `lockEvaluated` to prevent content flash, but this may be causing the loop with immediate timeout.

#### Proposed Fix

**Option 1**: Revert to main branch biometric lock logic
- **Pros**: Simple, removes complexity, known to work in main branch
- **Cons**: Loses the `lockEvaluated` gating that prevents content flash, may reintroduce splash stuck issue
- **Impact**: High risk of re-introducing splash stuck bug

**Option 2**: Fix immediate timeout logic in biometric-lock.ts
- **Pros**: Maintains `lockEvaluated` gating, targeted fix, minimal code change
- **Cons**: Doesn't address cold restart issue, grace period is a workaround not a root cause fix
- **Impact**: Medium risk, solves immediate loop but not other timeout issues

**Option 3**: Fix the loop in app/_layout.tsx
- **Pros**: Addresses the loop at the source, keeps immediate timeout working as intended
- **Cons**: More complex, requires careful state management
- **Impact**: Medium risk, but more comprehensive solution

**Option 4**: Comprehensive fix - address both loop and cold restart
- **Pros**: Solves all biometric lock issues at once, proper cold start detection
- **Cons**: Larger code change, more testing required
- **Impact**: High complexity but best long-term solution

**Recommended Approach**: Option 4 - Comprehensive fix
- Fix immediate timeout loop by adding grace period
- Fix cold restart by clearing `lastUnlockAt` on app kill (using AppState or startup detection)
- This addresses all reported issues while maintaining the `lockEvaluated` gating

### 2. Transfer Section - "Unknown" Account Display (Deep Dive Investigation)

#### Investigation Summary
- **Problem**: Even when accounts are NOT deleted or inactive, transfer display shows "Unknown → account" or vice versa
- **User feedback**: "Even when account is not deleted or not inactive we see unknown"
- **Root cause analysis**: Multiple potential issues identified

#### Deep Dive into Soft Delete Logic

**Database Schema Analysis:**
- `financial_accounts` table has `is_active` column (0 = inactive, 1 = active)
- `account_transfers` table has `from_account_id` and `to_account_id` referencing `financial_accounts(id)`
- `account_transfers` has `deleted_at` column for soft delete
- Both tables use soft delete pattern (is_active for accounts, deleted_at for transfers)

**Account Fetching Logic:**
- `getActiveAccounts()` in financial-account.ts line 373-378:
  ```typescript
  export async function getActiveAccounts(userId: string): Promise<FinancialAccount[]> {
    const db = getDatabase();
    return db.getAllAsync<FinancialAccount>(
      `SELECT * FROM financial_accounts WHERE user_id = ? AND is_active = 1 ORDER BY bank_name, account_type;`,
      userId,
    );
  }
  ```
- **Only returns accounts with is_active = 1**

**Account Map Building in account-ledger.tsx:**
- Line 273-277:
  ```typescript
  const acctMap = new Map<string, string>();
  for (const a of allAccountsForMin) {
    acctMap.set(a.id, a.account_label || `${a.bank_name} ****${a.account_identifier}`);
  }
  setAccountMap(acctMap);
  ```
- Line 375 (counter account lookup):
  ```typescript
  counterAccountName: acctMap.get(counterId) ?? "Unknown",
  ```

#### Root Causes Identified

**Cause 1: Account Soft-Delete (is_active = 0)**
- When an account is soft-deleted via `deactivateAccount()` (sets is_active = 0)
- The account is excluded from `getActiveAccounts()` results
- Transfers still reference the old account ID
- Account map doesn't include the soft-deleted account
- Result: "Unknown" displayed

**Cause 2: Account Hard-Delete**
- When an account is permanently deleted via `hardDeleteAccount()`
- The account row is removed from `financial_accounts` table
- Transfers still reference the deleted account ID (no FK constraint enforcement in SQLite)
- Account map cannot find the account
- Result: "Unknown" displayed

**Cause 3: Transfer Created with Invalid Account ID**
- If a transfer is created with an account ID that doesn't exist
- Or if the account ID is corrupted/incorrect
- Account map cannot find the account
- Result: "Unknown" displayed

**Cause 4: Timing/Race Condition**
- Account map is built from `allAccountsForMin` fetched at line 183
- If accounts are added/deleted between the fetch and map building
- Or if the transfer references a newly created account not yet in the map
- Result: "Unknown" displayed

**Cause 5: Shared-Pool CC Sibling Accounts**
- For shared-pool credit cards, multiple sibling cards are involved
- The transfer might reference a sibling card not in the current view
- Account map includes all active accounts, but display logic might filter incorrectly
- Result: "Unknown" displayed

#### Proposed Fix

**Option 1: Fetch All Accounts (Including Inactive) for Map**
- **Pros**: Simple, ensures all accounts are in the map
- **Cons**: Performance impact (fetches more data), shows deleted account names
- **Impact**: Low risk, minor performance hit

**Option 2: Fetch Counter Accounts On-Demand**
- **Pros**: Only fetches accounts when needed, always gets latest data
- **Cons**: N+1 query problem (one query per transfer), performance hit
- **Impact**: Medium risk, significant performance impact with many transfers

**Option 3: Add Fallback to Inactive Accounts**
- **Pros**: Maintains performance, shows account name if account exists (even inactive)
- **Cons**: Slightly more complex query
- **Impact**: Low risk, minimal performance impact

**Option 4: Add Account Name to Transfer Record**
- **Pros**: Denormalizes data, always has account name available
- **Cons**: Requires schema change, data migration, potential stale data
- **Impact**: High risk, requires database migration

**Recommended Approach**: Option 3 - Add Fallback to Inactive Accounts
- Modify account map building to include inactive accounts as fallback
- Use a two-tier map: active accounts first, inactive accounts second
- Display inactive account names with "(Inactive)" suffix
- This ensures "Unknown" only appears when account truly doesn't exist

#### Comprehensive Implementation Plan for Transfer Display Fix

**Step 1: Modify Account Map Building**
- In account-ledger.tsx, fetch both active and inactive accounts
- Build separate maps for active and inactive accounts
- When looking up counter account, check active map first, then inactive map

**Step 2: Add Visual Indicators for Inactive Accounts**
- Display "(Inactive)" suffix for accounts with is_active = 0
- Use different styling (e.g., gray color, italic) for inactive accounts
- This helps users understand why they're seeing old account names

**Step 3: Add Error Handling for Truly Missing Accounts**
- If account not found in either map, log the issue
- Display "(Account deleted)" instead of generic "Unknown"
- This provides better user feedback

**Step 4: Add Navigation to Expense Details**
- Add `linked_expense_id` to LedgerEntry interface
- Populate it when building ledger from transfers
- Add onPress handler to transfer rows to navigate to expense details
- Show chevron icon when linked_expense_id exists

**Step 5: Add Transfer Indicator in Expense Details**
- Add transfer badge to ExpenseHeroCard or ExpenseMetadata
- Show "Transfer" badge when linkedTransfer is not null
- Display from/to account names using the transfer record
- Add undo action for transfers (already exists, just needs UI indicator)

#### Files to Modify for Transfer Display Fix
- `app/reconciliation/account-ledger.tsx` - Modify account map building, add navigation
- `app/(tabs)/expenses.tsx` - Ensure transfers load correctly
- `app/expense/[id].tsx` - Add transfer indicator in UI
- `components/expense/ExpenseHeroCard.tsx` - Add transfer badge (optional)
- `components/expense/ExpenseMetadata.tsx` - Add transfer info (optional)

### 3. Biometric Lock and Loader Page (Main Branch Investigation)

**Cold Restart Issue Analysis:**
- **Problem**: Lock doesn't trigger on app kill + restart (cold start)
- **Root Cause**: `lastUnlockAt` persists in MMKV across app kills
- **Expected behavior**: "Cold start while enabled → always locked" (per comment in biometric-lock.ts)
- **Actual behavior**: Code checks `if (lastUnlock === null) return true` but MMKV retains the value
- **Fix needed**: Detect cold start and clear `lastUnlockAt` or add explicit cold start flag

**Other Timeouts (1m, 5m, 15m, never) Issue Analysis:**
- **Problem**: User reports other timeout settings not working
- **Root Cause**: Likely related to the same cold restart issue - if `lastUnlockAt` is old, timeout calculation is wrong
- **Expected behavior**: 
  - "1m": Lock after 1 minute in background
  - "5m": Lock after 5 minutes in background
  - "15m": Lock after 15 minutes in background
  - "never": Only lock on cold start, never on background
- **Actual behavior**: May not lock at all if `lastUnlockAt` persists incorrectly
- **Fix needed**: Proper cold start detection + timeout calculation

**Proposed Comprehensive Fix:**

1. **Add cold start detection:**
   - Use AppState to detect if app was killed (not just backgrounded)
   - On cold start, clear `lastUnlockAt` to force lock
   - Or add a separate `app_start_time` flag to distinguish cold vs warm start

2. **Fix immediate timeout loop:**
   - Add minimum grace period (e.g., 500ms-1s) for "immediate" timeout
   - Prevent re-lock immediately after successful unlock
   - Use a ref to track "just unlocked" state

3. **Fix timeout calculation:**
   - Ensure timeout calculation uses correct baseline
   - Consider background time vs wall clock time
   - Handle device time changes gracefully

4. **Maintain `lockEvaluated` gating:**
   - Keep the staging branch fix for preventing content flash
   - Ensure it works with the new cold start detection

#### Comprehensive Implementation Plan for Biometric Lock Fix (Option 4)

**Step 1: Add Cold Start Detection to biometric-lock.ts**

Add a new key to track app startup time:
```typescript
const KEYS = {
  LOCK_ENABLED: "biometric_lock_enabled",
  LOCK_TIMEOUT: "biometric_lock_timeout_seconds",
  LAST_UNLOCK_AT: "biometric_last_unlock_at",
  APP_START_TIME: "biometric_app_start_time", // NEW
} as const;
```

Add functions to manage app start time:
```typescript
export function setAppStartTime(): void {
  storage.set(KEYS.APP_START_TIME, Date.now());
}

export function getAppStartTime(): number | null {
  return storage.getNumber(KEYS.APP_START_TIME) ?? null;
}

export function clearAppStartTime(): void {
  storage.delete(KEYS.APP_START_TIME);
}
```

Modify `shouldShowLock()` to detect cold start:
```typescript
export function shouldShowLock(now: number = Date.now()): boolean {
  if (!isLockEnabled()) return false;

  const lastUnlock = getLastUnlockAt();
  
  // Cold start detection: if app start time is more recent than last unlock,
  // this is a cold start and should always lock
  const appStartTime = getAppStartTime();
  if (appStartTime && lastUnlock && appStartTime > lastUnlock) {
    return true; // Cold start - always lock
  }

  // No prior unlock (first time ever) → lock
  if (lastUnlock === null) return true;

  const option = getLockTimeout();
  const timeoutMs = TIMEOUT_SECONDS[option] * 1000;

  // "never" timeout → only lock on cold start (handled above)
  if (!Number.isFinite(timeoutMs)) return false;

  // For "immediate", add grace period to prevent loop
  if (option === "immediate") {
    const gracePeriodMs = 1000; // 1 second grace period
    return now - lastUnlock >= gracePeriodMs;
  }

  // Other timeouts (1m, 5m, 15m)
  return now - lastUnlock >= timeoutMs;
}
```

**Step 2: Update app/_layout.tsx to Set App Start Time**

In the initialization useEffect, add:
```typescript
useEffect(() => {
  (async () => {
    try {
      // Set app start time for cold start detection
      const { setAppStartTime } = await import("@/services/biometric-lock");
      setAppStartTime();
      
      // ... rest of initialization
    } catch (e) {
      // ... error handling
    }
  })();
}, []);
```

**Step 3: Fix Immediate Timeout Loop with Grace Period**

Already handled in Step 1 with the grace period logic in `shouldShowLock()`.

**Step 4: Add Lock Dismissal Tracking**

Add a ref to track if lock was just dismissed to prevent immediate re-lock:
```typescript
const lockDismissedRef = useRef(false);
const lockDismissedAtRef = useRef<number | null>(null);

const evaluateLock = useCallback(() => {
  if (!routerRef.current) return;
  
  // If lock was just dismissed within grace period, don't re-lock
  if (lockDismissedRef.current && lockDismissedAtRef.current) {
    const timeSinceDismiss = Date.now() - lockDismissedAtRef.current;
    if (timeSinceDismiss < 2000) { // 2 second grace after dismissal
      setLockEvaluated(true);
      return;
    }
  }
  
  if (shouldShowLock()) {
    routerRef.current.replace("/(lock)/lock" as never);
  }
  setLockEvaluated(true);
}, []);
```

**Step 5: Update Lock Screen to Set Dismissal Flag**

In `app/(lock)/lock.tsx`, after successful unlock:
```typescript
const attemptUnlock = useCallback(async () => {
  if (inFlight) return;
  setInFlight(true);
  setLastError(null);
  const result: UnlockResult = await promptUnlock({
    promptMessage: "Unlock Artha",
  });
  setInFlight(false);

  if (result.ok) {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    
    // Set dismissal flag to prevent immediate re-lock
    // This needs to be communicated to app/_layout.tsx
    // Can use MMKV or a callback
    router.replace("/(tabs)" as never);
    return;
  }
  // ... error handling
}, [inFlight, router]);
```

**Step 6: Add AppState Change Handling for Cold Start**

Use AppState to detect when app comes back from background vs cold start:
```typescript
useEffect(() => {
  const sub = AppState.addEventListener("change", (state) => {
    if (state === "active") {
      // Check if this is a background resume or cold start
      const appStartTime = getAppStartTime();
      const now = Date.now();
      
      // If app start time is very recent (< 2 seconds), this is likely a cold start
      // If app start time is older, this is a background resume
      if (appStartTime && now - appStartTime < 2000) {
        // Cold start - ensure lock evaluation happens
        evaluateLock();
      }
    }
  });
  return () => sub.remove();
}, [evaluateLock]);
```

**Step 7: Test All Timeout Scenarios**

Test cases to verify:
1. **Immediate timeout**:
   - Enable lock with immediate timeout
   - Unlock app
   - Close and reopen app → should show lock
   - Should NOT loop on lock screen

2. **1 minute timeout**:
   - Enable lock with 1m timeout
   - Unlock app
   - Close and reopen within 1 minute → should NOT show lock
   - Close and reopen after 1 minute → should show lock

3. **5 minute timeout**:
   - Same as 1m but with 5 minute threshold

4. **15 minute timeout**:
   - Same as 1m but with 15 minute threshold

5. **Never timeout**:
   - Enable lock with "never" timeout
   - Unlock app
   - Close and reopen → should show lock (cold start)
   - Background app within 1 minute → should NOT show lock
   - Background app after any time → should NOT show lock

6. **Cold start**:
   - Enable lock with any timeout
   - Kill app completely
   - Restart app → should always show lock

**Step 8: Add Logging for Debugging**

Add debug logging to track lock evaluation:
```typescript
if (__DEV__) {
  logger.info("Biometric lock evaluation:", {
    enabled: isLockEnabled(),
    lastUnlock: getLastUnlockAt(),
    appStartTime: getAppStartTime(),
    timeout: getLockTimeout(),
    shouldShow: shouldShowLock(),
  });
}
```

#### Files to Modify for Biometric Lock Fix
- `services/biometric-lock.ts` - Add cold start detection, grace period for immediate timeout
- `app/_layout.tsx` - Set app start time, add lock dismissal tracking
- `app/(lock)/lock.tsx` - Optionally add dismissal flag communication
- `app/(tabs)/settings.tsx` - Test timeout changes work correctly
