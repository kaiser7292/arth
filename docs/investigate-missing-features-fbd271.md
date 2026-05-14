---
description: Investigate and fix 4 missing features
---

# Investigate and Fix 4 Missing Features

Investigate why 4 features are still missing despite previous implementation: transfer details in expense page, "Unknown" account in transfers, bottom sheet sizing, and biometric cold start loop.

## Issues to Investigate

### 1. Transfer Details in Expense Details Page
- User wants transfer details shown like multisplit is shown
- Currently only shows a badge in ExpenseHeroCard
- Need to add a section similar to split-tender siblings showing transfer details (source account, destination account, etc.)
- Add section after split-tender section in expense/[id].tsx

### 2. "Unknown" Account Still Showing in Transfers
- User says account is present in the expense (where it was charged)
- While marking for transfer they select the credit account
- Still shows "Unknown" despite fallback logic in account-ledger.tsx
- Need to verify where account names are displayed in transfer flow
- Check if getAccountName is being used everywhere counterAccountName is displayed

### 3. Bottom Sheet Size and Buttons
- User wants to increase size of bottom sheet
- Fix buttons at the bottom and increase height upwards
- Currently changed max-h-[420px] to max-h-[70vh] in EntryEditSheet
- Buttons are outside ScrollView at line 632-656, need to ensure they're visible
- May need to adjust ScrollView height or move buttons inside

### 4. Biometric Cold Start Loop
- Cold start option doesn't work properly
- Still sees scenarios where it gets stuck in a loop
- When loop happens, loader screen starts glitching
- Need to investigate edge cases in cold start detection logic
- Check if appStartTime is being cleared properly after unlock
