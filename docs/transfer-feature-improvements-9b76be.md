# Transfer Feature Improvements Plan

This plan improves the transfer feature by adding visibility in the transactions page, showing transfer details in expense view, adding undo functionality with SMS type restoration, re-implementing transaction guards, fixing settings search filtering, and converting export logs to a separate page.

## 1. Add Transfers Section to Transactions Page

**Current State**: The expenses page (`app/(tabs)/expenses.tsx`) has tabs for All, Expenses (realized), Committed, and Credits. Transfers are not shown as a separate section.

**Proposed Changes**:
- Add a new tab "Transfers" to the expenses page (similar to Committed/Credits tabs)
- Create a filter for `nature: "transfer"` or query from `account_transfers` table
- Show transfer entries with:
  - From account name
  - To account name
  - Amount
  - Date
  - Transfer badge
- Tapping a transfer should navigate to a transfer detail page or show transfer info

**Files to Modify**:
- `app/(tabs)/expenses.tsx` - Add Transfers tab and filter logic
- May need to create a service function to get transfers for the date range

## 2. Add Transfer Details to Expense View

**Current State**: When an expense is marked as transfer via `reclassifyExpenseAsTransfer`, it soft-deletes the expense and creates a transfer. The expense detail page doesn't show transfer information.

**Proposed Changes**:
- In `app/expense/[id].tsx`, check if the expense has a linked transfer (query `account_transfers` by `linked_expense_id`)
- Add a section similar to the multiperson split section (around line 2100-2172)
- Show:
  - "From [account] → To [account]" header
  - Amount and date
  - "Change Transfer" button (opens transfer edit sheet)
  - "Undo Transfer" button (calls undo transfer function)
- Style similar to split section with accent color background

**Files to Modify**:
- `app/expense/[id].tsx` - Add transfer details section
- `services/account-transfer.ts` - Add function to get transfer by linked expense ID

## 3. Add Undo Transfer Functionality with SMS Type Restoration

**Current State**: `deleteTransfer` function already restores the linked expense when deleted, but the user says it doesn't properly unlink SMS type.

**Proposed Changes**:
- Modify `deleteTransfer` in `services/account-transfer.ts` to:
  - When restoring the linked expense, also check `pending_sms` table
  - Update `pending_sms.type` from "transfer" back to "debit" or "credit" (whichever it was originally)
  - Ensure the expense is properly unlinked from the transfer
- Add a new function `undoTransfer` that wraps this logic
- In expense detail, call this function when "Undo Transfer" is pressed

**Files to Modify**:
- `services/account-transfer.ts` - Modify deleteTransfer or add undoTransfer function
- `app/expense/[id].tsx` - Add undo transfer handler

## 4. Re-implement Transaction Guards

**Current State**: Transaction guards were removed in previous work. Need to add them back.

**Proposed Changes**:
- Add back the conflict detection in `services/expense-investment-link.ts`:
  - Check for existing loan link before linking to investment
  - Check for existing transfer link before linking to investment
- Add back the conflict detection in `services/expense-loan-link.ts`:
  - Check for existing transfer link before linking to loan
- Use the same error messages as before

**Files to Modify**:
- `services/expense-investment-link.ts` - Re-add loan and transfer link checks
- `services/expense-loan-link.ts` - Re-add transfer link check

## 5. Fix Settings Search to Filter Sections and Items

**Current State**: Search in settings (`app/(tabs)/settings.tsx`) only auto-expands sections with matching items but doesn't hide non-matching sections or items.

**Proposed Changes**:
- Modify the search logic to:
  - Hide entire sections that have no matching items
  - Within visible sections, hide individual items that don't match the search query
- Add a `matchesSearch` check to each SettingsRow or CollapsibleSection
- When search is active, only render items that match

**Files to Modify**:
- `app/(tabs)/settings.tsx` - Update search logic to hide non-matching sections and items

## 6. Convert Export Logs to Separate Route/Screen

**Current State**: Export logs is a bottom sheet (`app/settings/log-export-sheet.tsx`) with a ScrollView form.

**Proposed Changes**:
- Create a new route `app/settings/export-logs.tsx` as a full page
- Move the LogExportSheet content to this new page
- Remove the bottom sheet approach
- Update settings to navigate to this route instead of showing sheet
- Keep the same functionality (time scope, format, issue description, export, share)

**Files to Modify**:
- Create `app/settings/export-logs.tsx` - New page for export logs
- Modify `app/(tabs)/settings.tsx` - Change navigation to use route instead of sheet
- May keep `app/settings/log-export-sheet.tsx` for backward compatibility or remove it

## Implementation Order

1. Re-implement Transaction Guards (simplest, just re-add code)
2. Fix Settings Search (modify existing logic)
3. Add Transfer Details to Expense View (add new section)
4. Add Undo Transfer Functionality (modify service function)
5. Add Transfers Section to Transactions Page (add new tab)
6. Convert Export Logs to Separate Route (create new page)
