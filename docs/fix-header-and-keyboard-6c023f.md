# Fix Header Duplication and Keyboard Blocking in Form Pages

Remove custom headers from simulator entry, loan correction, and loan prepayment pages while keeping Expo Router headers, and fix keyboard blocking dropdown values issue.

## Current State Analysis

### Header Duplication Issue
- **Problem**: 3 pages show 2 headers - Expo Router header (from _layout.tsx) + custom header inside the page
- **Pages affected**:
  1. `app/simulator/[id]/entry.tsx` - Custom header at lines 250-257
  2. `app/loans/[id]/correction.tsx` - Custom header at lines 174-182
  3. `app/loans/[id]/prepayment.tsx` - Custom header at lines 208-215
- **Previous fix attempt**: Set `headerShown: false` for [id] routes in _layout.tsx (WRONG approach)
- **User requirement**: Keep Expo Router header, remove custom headers from pages

### Keyboard Blocking Dropdowns Issue
- **Problem**: Keyboard blocks dropdown values when modal pickers are open
- **Current implementation**: Simulator entry uses Modal-based pickers (lines 599-730)
- **Expense implementation**: Uses inline SearchablePickerList that expands below the field (not modals)
- **Expense keyboard handling**:
  - `KeyboardAvoidingView` with `behavior="padding"`
  - `ScrollView` with `keyboardShouldPersistTaps="handled"`
  - Inline picker lists that expand within the ScrollView

## Proposed Solution

### Option 1: Remove Custom Headers + Change to Inline Pickers (RECOMMENDED)

**Changes:**
1. Revert _layout.tsx changes (restore headerShown for [id] routes)
2. Remove custom headers from 3 pages
3. Change simulator entry from Modal pickers to inline SearchablePickerList (like expenses)

**Pros:**
- Consistent with expense pages pattern
- No keyboard blocking issues (inline pickers work with KeyboardAvoidingView)
- Simpler UI (no modal transitions)
- Better user experience (pickers expand in place)

**Cons:**
- More code changes in simulator entry (rewrite picker logic)
- Inline pickers take up more vertical space when expanded

**Breakage risk:** Low - inline pickers are proven pattern in expenses

### Option 2: Remove Custom Headers + Fix Modal Positioning

**Changes:**
1. Revert _layout.tsx changes (restore headerShown for [id] routes)
2. Remove custom headers from 3 pages
3. Fix modal positioning to avoid keyboard blocking

**Modal fix approaches:**
- Use `Modal` with `animationType="slide"` and position above keyboard
- Add `Keyboard.dismiss()` when opening modals
- Use `keyboardVerticalOffset` in KeyboardAvoidingView
- Render modals outside KeyboardAvoidingView

**Pros:**
- Less code changes (keep modal structure)
- Modal pattern is common in mobile apps

**Cons:**
- Keyboard handling is tricky across iOS/Android
- May need platform-specific adjustments
- More complex to get right

**Breakage risk:** Medium - modal positioning can be finicky

### Option 3: Remove Custom Headers + Use Bottom Sheet Library

**Changes:**
1. Revert _layout.tsx changes (restore headerShown for [id] routes)
2. Remove custom headers from 3 pages
3. Replace Modal with BottomSheet library (e.g., react-native-bottom-sheet)

**Pros:**
- Bottom sheets handle keyboard automatically
- Better UX for mobile
- Industry-standard pattern

**Cons:**
- New dependency
- More complex setup
- May need to install and configure library

**Breakage risk:** Medium - new dependency integration

## Recommended Approach: Option 1

**Rationale:**
- Inline pickers are already proven in expense pages
- No keyboard blocking issues
- Consistent UX across app
- No new dependencies
- Lower risk of platform-specific issues

## Implementation Plan

### Step 1: Revert _layout.tsx Changes and Set Proper Titles

**File: app/simulator/_layout.tsx**

**Before:**
```tsx
<Stack.Screen 
  name="[id]" 
  options={{ headerShown: false }}
/>
```

**After:**
```tsx
<Stack.Screen 
  name="[id]" 
  options={{ title: "" }}
/>
<Stack.Screen 
  name="[id]/entry" 
  options={{ title: "Add Planned Entry" }}
/>
```

**File: app/loans/_layout.tsx**

**Before:**
```tsx
<Stack.Screen 
  name="[id]" 
  options={{ headerShown: false }}
/>
```

**After:**
```tsx
<Stack.Screen 
  name="[id]" 
  options={{ title: "Loan Details" }}
/>
<Stack.Screen 
  name="[id]/correction" 
  options={{ title: "Manual Correction" }}
/>
<Stack.Screen 
  name="[id]/prepayment" 
  options={{ title: "Record Prepayment" }}
/>
```

**Impact:** Expo Router header will show with proper camel case titles

**Note:** For dynamic titles (e.g., "Edit Planned Entry" vs "Add Planned Entry"), the individual pages can override the title using `useSetOptions` hook if needed.

### Step 2: Remove Custom Headers from Pages

**File: app/simulator/[id]/entry.tsx**
- Remove lines 250-257 (custom header with back button and title)
- Change `ScreenContainer padTop={false}` to `ScreenContainer` (restore top padding)
- The Expo Router header will provide the title and back button

**File: app/loans/[id]/correction.tsx**
- Remove lines 174-182 (custom header with back button and title)
- Change `ScreenContainer padTop={false}` to `ScreenContainer`
- The Expo Router header will provide navigation

**File: app/loans/[id]/prepayment.tsx**
- Remove lines 208-215 (custom header with back button and title)
- Change `ScreenContainer padTop={false}` to `ScreenContainer`
- The Expo Router header will provide navigation

**Impact:** Single header (Expo Router) will show, no duplication

### Step 3: Change Simulator Entry to Inline Pickers

**File: app/simulator/[id]/entry.tsx**

**Remove:**
- Modal imports (line 29)
- All Modal components (lines 599-730, ~135 lines)
- Modal state visibility variables (accountPickerVisible, etc.) - keep but change usage

**Add:**
- Inline picker components similar to AccountPicker from ExpenseFormFields
- Or use the existing AccountPicker, CategoryPicker components directly

**Implementation:**
```tsx
// Replace modal-based approach with inline expandable pickers
// Similar to how expenses do it:

<AccountPicker
  accounts={accounts}
  accountId={accountId}
  selectedAccount={selectedAccount}
  showAccounts={accountPickerVisible}
  onToggle={() => setAccountPickerVisible(prev => !prev)}
  onSelect={(id) => {
    setAccountId(id);
    setAccountPickerVisible(false);
  }}
/>

// Repeat for category, person, toAccount
```

**Impact:**
- No keyboard blocking (inline pickers work with KeyboardAvoidingView)
- Consistent with expense pages
- Simpler code structure

### Step 4: Update Navigation Behavior

**Expo Router header back button behavior:**
- Simulator entry: Back goes to simulator detail page (/[id]) → then to simulator index
- Loan correction: Back goes to loan detail page (/[id]) → then to loans index
- Loan prepayment: Back goes to loan detail page (/[id]) → then to loans index

This is the default Expo Router behavior - no changes needed.

**Home button:**
- The HeaderBackHome component already handles home navigation
- No changes needed

## Potential Issues and Mitigations

### Issue 1: ScreenContainer Padding
**Problem:** Removing `padTop={false}` might add unwanted top padding
**Mitigation:** Test on device, adjust if needed. The Expo Router header should handle spacing.

### Issue 2: Title Display
**Problem:** Expo Router header might not show appropriate title
**Mitigation:** Set proper title in _layout.tsx or individual screen options:
- Simulator entry: "Add planned entry" / "Edit planned entry"
- Loan correction: "Manual Correction" / "Edit Correction"
- Loan prepayment: "Record Prepayment" / "Edit Prepayment"

### Issue 3: Inline Picker Expansion
**Problem:** Inline pickers might push content off-screen
**Mitigation:** ScrollView with flexGrow handles this. Test with long forms.

### Issue 4: State Management Change
**Problem:** Changing from modal to inline requires state management change
**Mitigation:** Keep existing state variables, just change how they're used (expand/collapse instead of modal show/hide)

## Testing Checklist

### Header Tests
- [ ] Verify only one header shows on simulator entry page
- [ ] Verify only one header shows on loan correction page
- [ ] Verify only one header shows on loan prepayment page
- [ ] Verify back button navigates correctly on all 3 pages
- [ ] Verify home button works on all 3 pages

### Dropdown/Picker Tests
- [ ] Account picker expands inline without keyboard blocking
- [ ] Category picker expands inline without keyboard blocking
- [ ] Person picker expands inline without keyboard blocking
- [ ] To-account picker expands inline without keyboard blocking
- [ ] Pickers collapse when item selected
- [ ] Pickers collapse when tapped outside
- [ ] Search functionality works in pickers

### Form Tests
- [ ] Can save entry with selected account
- [ ] Can save entry with selected category
- [ ] Can save entry with selected person
- [ ] Can save entry with selected to-account (for transfers)
- [ ] Form validation still works
- [ ] Keyboard doesn't block any form interactions

## Code Changes Summary

**Files to modify:**
1. `app/simulator/_layout.tsx` - Revert headerShown change
2. `app/loans/_layout.tsx` - Revert headerShown change
3. `app/simulator/[id]/entry.tsx` - Remove custom header, change to inline pickers
4. `app/loans/[id]/correction.tsx` - Remove custom header
5. `app/loans/[id]/prepayment.tsx` - Remove custom header

**Lines removed:**
- ~135 lines from simulator entry (modal components)
- ~10 lines from simulator entry (custom header)
- ~10 lines from loan correction (custom header)
- ~10 lines from loan prepayment (custom header)

**Lines added:**
- ~2 lines to simulator _layout (restore header, add nested screen with title)
- ~6 lines to loans _layout (restore header, add nested screens with titles)
- ~50-80 lines to simulator entry (inline picker components)

**Net change:** ~ -100 lines of code

**Header Titles:**
- Simulator [id]: "" (empty, detail page shows scenario name)
- Simulator [id]/entry: "Add Planned Entry"
- Loans [id]: "Loan Details"
- Loans [id]/correction: "Manual Correction"
- Loans [id]/prepayment: "Record Prepayment"
