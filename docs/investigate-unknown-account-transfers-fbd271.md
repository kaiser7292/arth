---
description: Investigate and fix 'Unknown' account in transfers section
---

# Investigate and Fix 'Unknown' Account in Transfers Section

Investigate why "Unknown" account is shown in the transfers section of the transactions tab despite account being present in the expense.

## Investigation Findings

### Two Issues in Expenses Tab (Transfers Filter)

**Issue 1: "From Account" Shows as Unknown**
- Transfer filter shows "from account -> to account" in UI
- The "from account" always shows as "unknown"
- This is an account lookup issue

**Issue 2: Expense Details Page Missing Transfer Indicator**
- When clicking on a transfer row, it correctly opens the expense details page
- But the expense details page does not show that this expense is marked as a transfer
- Should show a transfer indicator similar to how multi-split is displayed

### Current Implementation

In `app/(tabs)/expenses.tsx`:
- `filterNature` can be: `"realized" | "committed" | "credit" | "all" | "transfers"`
- When `filterNature === "transfers"`, loads `transferExpenses` via `loadTransfers()`
- `loadTransfers()` queries:
```sql
SELECT e.* FROM expenses e
INNER JOIN account_transfers t ON t.linked_expense_id = e.id
WHERE e.user_id = ? AND e.deleted_at IS NULL
  AND t.deleted_at IS NULL
  AND e.date >= ? AND e.date <= ?
ORDER BY e.date DESC;
```
- Renders using same `renderExpenseItem` as regular expenses
- Does NOT fetch transfer destination account info from the transfer record

## Root Cause Analysis

1. The query only fetches expense data, not transfer data (from_account_id, to_account_id)
2. Account lookup fails because transfer account IDs are not fetched
3. Expense details page doesn't check if the expense is linked to a transfer

## Proposed Fix

### Fix 1: Expenses Tab Transfer Row Display
1. Modify `loadTransfers()` in `app/(tabs)/expenses.tsx` to also fetch transfer records alongside expenses (include from_account_id, to_account_id)
2. Build account map from `getAllAccounts()` filtered to transfer-eligible types (savings, wallet, demat)
3. Pass transfer account info to the row renderer
4. Display "From [Account] → To [Account]" correctly in the transfer filter row

### Fix 2: Expense Details Page Transfer Indicator

Reference implementation: Split-tender (lines 1741-1802) and Multi-split (lines 2087-2165) in `app/expense/[id].tsx`

**UI Pattern (similar to split-tender):**
- Blue card with accent background: `style={{ backgroundColor: ac(accent, colorScheme, 50, 800) }}`
- Header with icon and title "Transfer"
- Subtitle showing transfer details
- Pressable rows for each account (from and to)
- Action buttons at bottom ("Change Transfer", "Remove Transfer")

**Implementation Steps:**
1. In `app/expense/[id].tsx`, add state to fetch linked transfer:
   - Query `account_transfers` table where `linked_expense_id = expense.id`
   - Store transfer record with `from_account_id`, `to_account_id`, `amount`, `date`

2. Build account map for transfer display:
   - Use `getAllAccounts(DEFAULT_USER_ID)` filtered to transfer-eligible types (savings, wallet, demat)
   - Include both active and inactive accounts

3. Display blue card (similar to split-tender lines 1743-1802):
   ```tsx
   {linkedTransfer && (
     <View className="mx-4 mt-3 rounded-xl bg-surface-light-alt dark:bg-surface-dark-alt">
       {/* Header */}
       <View className="flex-row items-center px-4 py-3 border-b border-border-light dark:border-border-dark">
         <View className="w-8 h-8 rounded-full items-center justify-center mr-2.5" style={{ backgroundColor: ac(accent, colorScheme, 50, 800) }}>
           <Ionicons name="swap-horizontal-outline" size={16} color={ac(accent, colorScheme, 500, 200)} />
         </View>
         <View className="flex-1">
           <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary">
             Transfer
           </Text>
           <Text className="text-xs text-text-tertiary dark:text-text-dark-secondary mt-0.5">
             Money moved between accounts
           </Text>
         </View>
         <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary">
           {formatAmount(linkedTransfer.amount)}
         </Text>
       </View>

       {/* From Account Row - Pressable to navigate to from account ledger */}
       <Pressable
         onPress={() => router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: linkedTransfer.from_account_id } })}
         className="flex-row items-center px-4 py-3 border-b border-border-light dark:border-border-dark"
       >
         <Ionicons name="card-outline" size={16} color={colors.textSecondary} style={{ marginRight: 8 }} />
         <Text className="flex-1 text-sm text-text-primary dark:text-text-dark-primary">
           From: {getAccountName(linkedTransfer.from_account_id)}
         </Text>
         <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
       </Pressable>

       {/* To Account Row - Pressable to navigate to to account ledger */}
       <Pressable
         onPress={() => router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: linkedTransfer.to_account_id } })}
         className="flex-row items-center px-4 py-3"
       >
         <Ionicons name="card-outline" size={16} color={colors.textSecondary} style={{ marginRight: 8 }} />
         <Text className="flex-1 text-sm text-text-primary dark:text-text-dark-primary">
           To: {getAccountName(linkedTransfer.to_account_id)}
         </Text>
         <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
       </Pressable>

       {/* Action Buttons (similar to multi-split lines 2087-2165) */}
       <View className="flex-row items-center justify-end px-4 py-2">
         <Pressable onPress={handleChangeTransfer} className="py-2 px-3 rounded-lg">
           <Text className="text-[10px] font-medium" style={{ color: ac(accent, colorScheme, 500, 300) }}>
             Change Transfer
           </Text>
         </Pressable>
         <Pressable onPress={handleRemoveTransfer} className="py-2 px-3 rounded-lg">
           <Text className="text-[10px] font-medium" style={{ color: StatusColors[colorScheme].danger }}>
             Remove Transfer
           </Text>
         </Pressable>
       </View>
     </View>
   )}
   ```

4. Implement action handlers:
   - `handleChangeTransfer`: Open transfer picker to change destination account
   - `handleRemoveTransfer`: Call existing `handleUndoTransfer` (lines 620-634) to remove transfer and restore expense

### Fix 3: Bottom Sheet Size and Button Positioning

**Reference Implementation: SplitSheet (components/expense/SplitSheet.tsx)**
- Line 530: ScrollView ends
- Lines 532-546: Confirm button is OUTSIDE ScrollView but INSIDE KeyboardAvoidingView
- This pattern ensures the button stays visible while content scrolls
- No max-h constraint on ScrollView - it takes available space naturally

**Current Implementation in `components/simulator/EntryEditSheet.tsx`:**
- Line 312: ScrollView has `max-h-[70vh]` - limits scrollable content to 70% of viewport height
- Lines 632-656: Buttons (Cancel/Save) are outside the ScrollView in a separate View (correct structure)
- Issue: When ScrollView content is tall, the fixed max-h constraint leaves insufficient space for buttons

**Proposed Changes:**

**Change 1: Remove ScrollView max height constraint**
```tsx
// Before (line 312):
className="max-h-[70vh]"

// After:
className="flex-1"
```
**What this changes:** Removes the fixed height constraint, allowing ScrollView to take available space naturally (like SplitSheet). This ensures buttons always have room to display.

**Change 2: Add bottom padding to ScrollView**
```tsx
// Before (line 312):
className="max-h-[70vh]"

// After:
className="flex-1 pb-4"
```
**What this changes:** Adds padding at the bottom of the ScrollView content so the last item doesn't touch the edge when scrolled.

**Change 3: Ensure button container has minimum space**
```tsx
// Before (lines 632-656):
<View className="flex-row mt-4 gap-3">
  <Pressable onPress={handleClose} ...>
    <Text>Cancel</Text>
  </Pressable>
  <Pressable onPress={handleSave} ...>
    <Text>Save</Text>
  </Pressable>
</View>

// After (no change needed - structure is already correct):
// Buttons are already outside ScrollView and inside KeyboardAvoidingView (same as SplitSheet)
// The fix is to remove the max-h constraint so buttons have natural space
```

**What this changes:** The current structure matches SplitSheet (buttons outside ScrollView). The fix is to remove the artificial height constraint, allowing the layout to work naturally like SplitSheet.

### Fix 4: Keyboard Avoidance in Bottom Sheets

**Reference Implementation: MultiSplitSheet (components/expense/MultiSplitSheet.tsx)**
- Uses KeyboardAvoidingView with ScrollView for keyboard avoidance
- No platform-specific behavior or offset configuration
- Works correctly - keyboard doesn't cover input fields

**Current Implementation in `components/simulator/EntryEditSheet.tsx`:**
- Line 275: `KeyboardAvoidingView behavior="padding"` - uses padding behavior to avoid keyboard
- Line 621: Description TextInput has `onFocus={scrollToBottom}` - scrolls to bottom when focused
- Issue: On some platforms, `behavior="padding"` doesn't work correctly with bottom sheets, causing the keyboard to cover the active input field

**Other Bottom Sheets to Update:**
- `components/expense/SplitSheet.tsx`
- `components/expense/MultiSplitSheet.tsx` (already works correctly)
- `components/expense/AccountPickerSheet.tsx`
- Other picker sheets in expense details page

**Proposed Changes:**

**Change 1: Update EntryEditSheet KeyboardAvoidingView to match MultiSplitSheet pattern**
```tsx
// Before (line 275 in EntryEditSheet.tsx):
<KeyboardAvoidingView behavior="padding" className="flex-1">

// After (remove behavior property, use default):
<KeyboardAvoidingView className="flex-1">
```
**What this changes:** Removes the explicit behavior="padding" to use the default behavior, matching the MultiSplitSheet pattern which works correctly.

**Change 2: Improve scrollToBottom function in EntryEditSheet**
```tsx
// Before (existing scrollToBottom function):
const scrollToBottom = useCallback(() => {
  scrollRef.current?.scrollToEnd({ animated: true });
}, []);

// After:
const scrollToBottom = useCallback(() => {
  setTimeout(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, 100);
}, []);
```
**What this changes:** Adds a small delay to ensure the keyboard has time to open before scrolling to the bottom, preventing the input field from being covered.

**Change 3: Verify SplitSheet keyboard avoidance**
```tsx
// Check if SplitSheet has the same pattern as MultiSplitSheet
// If it has behavior="padding", remove it to match
```
**What this changes:** Ensures consistent keyboard avoidance behavior across all bottom sheets.

## Other Issues to Fix

### Fix 5: Fix Biometric Lock Cold Start Infinite Loop

**Issue:** Biometric lock gets stuck in a loop during cold start due to cold start detection logic causing an infinite lock loop.

**Current Implementation in `services/biometric-lock.ts`:**
- Cold start detection compares app start time with last unlock time
- If app start time is more recent than last unlock, it forces lock
- This can cause an infinite loop if the lock evaluation triggers repeatedly

**Research Findings - Common Solutions:**
1. **Use a flag to track lock evaluation in progress** - prevent re-evaluation while lock screen is visible
2. **Grace period after cold start** - prevent re-lock for a short window after first unlock
3. **One-time cold start flag** - clear after first successful unlock
4. **State machine approach** - explicit states (locked, unlocking, unlocked) to prevent loops
5. **Debounce/throttle** - prevent rapid successive evaluations

**Proposed Changes:**

**Change 1: Add lock evaluation in progress flag**
```tsx
// Before (in app/_layout.tsx):
const [lockEvaluated, setLockEvaluated] = useState(false);

// After:
const [lockEvaluated, setLockEvaluated] = useState(false);
const [lockEvaluationInProgress, setLockEvaluationInProgress] = useState(false);

// In the useEffect that evaluates lock:
if (!lockEvaluated && !lockEvaluationInProgress) {
  setLockEvaluationInProgress(true);
  const evaluateLock = () => {
    if (shouldShowLock() && routerRef.current) {
      routerRef.current.replace("/(lock)/lock" as never);
    }
    setLockEvaluated(true);
    setLockEvaluationInProgress(false);
  };
  evaluateLock();
}
```
**What this changes:** Adds a flag to track when lock evaluation is in progress, preventing infinite loops by blocking re-evaluation until the current evaluation completes.

**Change 2: Add 10-second grace period and home screen check**
```tsx
// Before (in shouldShowLock function):
const appStartTime = getAppStartTime();
if (appStartTime && lastUnlock && appStartTime > lastUnlock) {
  return true; // Cold start - always lock
}

// After:
const appStartTime = getAppStartTime();
const hasLandedOnHome = getHasLandedOnHome(); // New function to track home screen navigation
if (appStartTime && lastUnlock && appStartTime > lastUnlock) {
  // Cold start - lock only if:
  // 1. User has landed on home screen, OR
  // 2. More than 10 seconds have passed since app start
  const gracePeriodMs = 10000;
  const timeSinceAppStart = now - appStartTime;
  return hasLandedOnHome || timeSinceAppStart >= gracePeriodMs;
}
```
**What this changes:** Adds a 10-second grace period and checks if user has landed on home screen before triggering cold start lock. This prevents the lock from triggering during navigation/transitions and only locks when the user has actually reached the home screen or after 10 seconds have passed.

**Change 3: Track home screen navigation**
```tsx
// Before (in app/_layout.tsx):
// No tracking of home screen navigation

// After:
// Add state to track if user has landed on home screen
const [hasLandedOnHome, setHasLandedOnHome] = useState(false);

// In the tabs layout or home screen, set the flag when user navigates there
// For example, in app/(tabs)/_layout.tsx or app/(tabs)/index.tsx:
useEffect(() => {
  setHasLandedOnHome(true);
}, []);

// Store in biometric-lock.ts:
function setHasLandedOnHome(value: boolean) {
  // Store in AsyncStorage or memory
}
function getHasLandedOnHome(): boolean {
  // Retrieve from AsyncStorage or memory
}
```
**What this changes:** Tracks whether the user has actually landed on the home screen, allowing the cold start lock to only trigger when the user has reached the home screen rather than during app initialization.

**Change 4: Clear cold start flag after successful unlock**
```tsx
// Before (in lock.tsx attemptUnlock):
await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
router.replace("/(tabs)" as never);

// After:
await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
// Clear app start time and home screen flag to prevent cold start re-lock
clearAppStartTime();
setHasLandedOnHome(false);
router.replace("/(tabs)" as never);
```
**What this changes:** Clears the app start time and home screen flag after successful unlock, preventing the cold start detection from triggering again on the same app launch.
