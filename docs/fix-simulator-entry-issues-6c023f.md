# Fix Simulator Entry Page Dropdowns and Dual Header Issues

Fix dropdowns not working in simulator entry page and dual header issues in both simulator and loans pages.

## Investigation Findings

### Dropdown Issue (Simulator Entry Page Only)
- The simulator entry page (`app/simulator/[id]/entry.tsx`) has state for picker visibility (accountPickerVisible, toAccountPickerVisible, categoryPickerVisible, personPickerVisible) but does NOT render any actual picker modal components
- The page also has merchant autocomplete (text input with suggestions) which works correctly
- The expense pages use custom picker components from `components/expense/ExpenseFormFields.tsx` (AccountPicker, CategoryPicker, etc.) which use an inline expandable SearchablePickerList pattern
- The simulator entry page has Pressable triggers that set visibility state, but no picker UI is rendered when these states are true
- **Loan pages (correction, prepayment) do NOT have dropdowns** - they use simple text inputs and date pickers, so no dropdown fix needed there

### Dual Header Issue
- The simulator folder has `_layout.tsx` with a Stack showing headers with custom styling for all routes
- The simulator entry page uses `ScreenContainer padTop={false}` and has a custom header with back button
- This creates dual headers: one from the layout and one from the page
- The loans folder has `_layout.tsx` with headers shown, and the correction/prepayment pages also use `ScreenContainer padTop={false}` with custom headers
- The expense folder has `_layout.tsx` with `headerShown: false` for all expense routes, allowing pages to have custom headers

### Downstream Business Logic Verification
- **Simulator entry save**: Calls `createEntry` or `updateEntry` from `services/simulator.ts`. The service validates inputs and saves to `simulation_entries` table. Adding dropdowns will not affect this logic as long as the selected IDs are passed correctly.
- **Loan correction save**: Calls `createCorrection` or `updateCorrection` from `services/loan-accounts.ts`. The service validates the correction (date, outstanding, EMI) and saves to `loan_corrections` table. No dropdowns involved, so no impact.
- **Loan prepayment save**: Calls `recordPrepayment` or `updatePrepayment` from `services/loan-accounts.ts`. The service computes impact and saves to `loan_prepayments` table. No dropdowns involved, so no impact.

## Proposed Solution

### Fix Dropdowns in Simulator Entry Page
1. Import the SearchablePickerList component from ExpenseFormFields
2. Create modal picker components for account, category, and person selection (similar to CalendarModal)
3. Render these modal pickers conditionally when their visibility state is true
4. Update the picker state management to handle selection properly
5. Ensure merchant autocomplete continues to work (it already works)

### Fix Dual Header for Simulator
Update `app/simulator/_layout.tsx` to hide the header for the nested `[id]/*` routes while keeping it for the index page:
- Add a nested Stack for `[id]` routes with `headerShown: false`
- This allows the detail page and its nested routes (entry) to have custom headers
- Similar pattern to how expense _layout.tsx handles it

### Fix Dual Header for Loans
Update `app/loans/_layout.tsx` to hide the header for the nested `[id]/*` routes while keeping it for other routes:
- Add a nested Stack for `[id]` routes with `headerShown: false`
- This allows the detail page and its nested routes (correction, prepayment) to have custom headers

## Potential Issues and Mitigations

### Dropdown Implementation
- **Issue**: Modal pickers might conflict with KeyboardAvoidingView
- **Mitigation**: Ensure modals are rendered outside the KeyboardAvoidingView or use proper z-indexing
- **Issue**: SearchablePickerList expects specific item structure (id, label, subtitle, icon, color)
- **Mitigation**: Map account, category, and person data to this structure correctly

### Dual Header Fix
- **Issue**: Removing headers from nested routes might break navigation
- **Mitigation**: The pages already have custom back buttons, so navigation will work
- **Issue**: The detail pages ([id].tsx) also have custom headers and might show dual headers
- **Mitigation**: The nested Stack with headerShown: false will apply to all routes under [id]/, including the detail page

### Business Logic
- **Issue**: Dropdown selection might pass null or invalid IDs
- **Mitigation**: The existing validation logic in the save handlers already checks for required fields (accountId, personId, etc.)

## Code Changes - Add and Remove

### Simulator Entry Page (`app/simulator/[id]/entry.tsx`)

**Add:**
1. Import SearchablePickerList from ExpenseFormFields
2. Import Modal component from react-native
3. Add AccountPickerModal component (lines ~600-650)
4. Add CategoryPickerModal component (lines ~650-700)
5. Add PersonPickerModal component (lines ~700-750)
6. Add ToAccountPickerModal component (lines ~750-800)
7. Render these modals after the CalendarModal (after line 597)

**Remove:**
- Nothing removed, only adding modal components

**Impact:**
- Adds ~200 lines of code for modal picker components
- No changes to existing state management or business logic
- Modal components are self-contained and only render when visibility state is true

### Simulator Layout (`app/simulator/_layout.tsx`)

**Add:**
- Nested Stack for [id] routes with headerShown: false
- Screen options for nested routes

**Remove:**
- Remove the existing `<Stack.Screen name="[id]" options={{ title: "" }} />` from the top-level Stack
- Replace with nested Stack structure

**Code change:**
```tsx
// Before:
<Stack screenOptions={{...}}>
  <Stack.Screen name="index" options={{ title: "Cash-flow Simulator" }} />
  <Stack.Screen name="[id]" options={{ title: "" }} />
</Stack>

// After:
<Stack screenOptions={{...}}>
  <Stack.Screen name="index" options={{ title: "Cash-flow Simulator" }} />
  <Stack.Screen name="[id]">
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: "" }} />
      <Stack.Screen name="entry" options={{ title: "" }} />
    </Stack>
  </Stack.Screen>
</Stack>
```

**Impact:**
- Hides Expo Router header for simulator detail page and entry page
- Allows custom headers in those pages to display without duplication
- No impact on navigation - custom back buttons handle navigation

### Loans Layout (`app/loans/_layout.tsx`)

**Add:**
- Nested Stack for [id] routes with headerShown: false
- Screen options for nested routes

**Remove:**
- Remove the existing `<Stack.Screen name="[id]" options={{ title: "Loan Details" }} />` from the top-level Stack
- Replace with nested Stack structure

**Code change:**
```tsx
// Before:
<Stack screenOptions={{...}}>
  <Stack.Screen name="add" options={{ title: "Add Loan" }} />
  <Stack.Screen name="[id]" options={{ title: "Loan Details" }} />
  <Stack.Screen name="import-schedule" options={{ title: "Import Schedule" }} />
</Stack>

// After:
<Stack screenOptions={{...}}>
  <Stack.Screen name="add" options={{ title: "Add Loan" }} />
  <Stack.Screen name="import-schedule" options={{ title: "Import Schedule" }} />
  <Stack.Screen name="[id]">
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: "Loan Details" }} />
      <Stack.Screen name="correction" options={{ title: "" }} />
      <Stack.Screen name="prepayment" options={{ title: "" }} />
    </Stack>
  </Stack.Screen>
</Stack>
```

**Impact:**
- Hides Expo Router header for loan detail page and nested routes
- Allows custom headers in those pages to display without duplication
- No impact on navigation - custom back buttons handle navigation

## Header Naming

### Current State
- Simulator entry page: "Add planned entry" or "Edit planned entry"
- Loan correction page: "Manual Correction" or "Edit Correction"
- Loan prepayment page: "Record Prepayment" or "Edit Prepayment"

### Proposed Changes
- Ensure headers are consistent with the app's naming conventions
- Simulator entry: Keep current naming - it's clear and descriptive
- Loan correction: Keep current naming - it's clear and descriptive
- Loan prepayment: Keep current naming - it's clear and descriptive

**No changes needed** - the current header names are appropriate and follow the app's conventions.

## Impact Analysis

### Positive Impacts
1. **Dropdowns will work** - Users can now select accounts, categories, and persons from pickers
2. **No dual headers** - Cleaner UI with single header per page
3. **Consistent navigation** - Back buttons work correctly
4. **No business logic impact** - Save operations remain unchanged

### Potential Risks
1. **Modal z-index issues** - Modals might not appear above KeyboardAvoidingView
   - **Mitigation**: Test on both iOS and Android, adjust if needed
2. **Navigation breakage** - Removing Expo Router headers might break navigation
   - **Mitigation**: Custom back buttons already handle navigation, so this is low risk
3. **Performance** - Adding modal components might slightly increase bundle size
   - **Mitigation**: Minimal impact (~200 lines of code), modal components are lightweight

### Rollback Plan
If issues arise:
1. Revert _layout.tsx changes to restore Expo Router headers
2. Remove modal picker components from simulator entry page
3. Dropdowns will be non-functional again, but app will be stable
