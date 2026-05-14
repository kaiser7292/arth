# Transfer Reclassification Plan

Change the "Mark as Transfer" feature to reclassify expenses as transfers instead of soft-deleting them, allowing users to view and undo transfers in the transaction tab while maintaining backward compatibility with the existing account_transfers table.

## Current Implementation

When a user marks an expense as transfer:
1. A transfer record is created in `account_transfers` table with `linked_expense_id` pointing to the expense
2. The original expense is soft-deleted (`deleted_at` is set)
3. Debit/credit entries appear in the to/from account ledgers
4. Clicking ledger entries navigates to the expense details page (still accessible despite soft-delete)
5. "Mark as Transfer" button remains visible but shows errors when clicked

## Desired Behavior

1. Introduce a new classification "transfers" in the transaction tab nature type (similar to "committed" or "credit")
2. Instead of soft-deleting, add an `is_transfer` flag to the expense and keep it visible
3. Show transfers in the transaction tab with a dedicated "transfers" filter, and also include them in "all" filter
4. Provide an "undo transfer" option that:
   - Uses an `is_transfer` flag on the account_transfers table instead of soft-delete
   - Reclassifies the expense back to its original nature (realized or credit)
   - Clears transfer-related columns on the expense
5. Show from/to account info in the expense details page with links to the account ledgers (similar to how split shows hisaab ledger links)
6. Allow editing transfer expenses similar to split expenses - when amount/date changes, update both expense and transfer record
7. Keep the account_transfers table for balance calculations (less risky approach)

## Proposed Implementation

### 1. Database Schema Changes

Add a new nature value "transfer" to the expenses table:

```sql
-- Migration to add transfer nature
ALTER TABLE expenses ADD COLUMN is_transfer INTEGER DEFAULT 0;
ALTER TABLE expenses ADD COLUMN transfer_from_account_id TEXT REFERENCES financial_accounts(id);
ALTER TABLE expenses ADD COLUMN transfer_to_account_id TEXT REFERENCES financial_accounts(id);
ALTER TABLE expenses ADD COLUMN previous_nature TEXT;
CREATE INDEX IF NOT EXISTS idx_expenses_is_transfer ON expenses(is_transfer);
CREATE INDEX IF NOT EXISTS idx_expenses_transfer_from ON expenses(transfer_from_account_id);
CREATE INDEX IF NOT EXISTS idx_expenses_transfer_to ON expenses(transfer_to_account_id);
```

Add columns to expenses table to store transfer information:
- `transfer_from_account_id` - The account money was transferred from
- `transfer_to_account_id` - The account money was transferred to
- `previous_nature` - Stores the original nature (realized/credit) before becoming a transfer

### 2. Service Layer Changes

**Modify `reclassifyExpenseAsTransfer` in `account-transfer.ts`:**
- Instead of soft-deleting the expense, update:
  - `is_transfer = 1`
  - `transfer_from_account_id = expense.account_id`
  - `transfer_to_account_id = toAccountId`
  - `previous_nature = 'realized'`
- Keep the `account_transfers` record for balance calculation purposes
- Set `linked_expense_id` on the transfer to point to the (now reclassified) expense

**Add new function `undoExpenseAsTransfer`:**
- Accept expenseId as parameter
- In a transaction:
  1. Restore the expense's nature from `previous_nature` (realized or credit)
  2. Clear `transfer_from_account_id`, `transfer_to_account_id`, `previous_nature`
  3. Soft-delete the corresponding `account_transfers` record (set deleted_at)
  4. If the expense was a credit, ensure any hisaab settlements are preserved
- Handle edge cases:
  - If the expense has been edited since becoming a transfer, validate the amount matches
  - If the transfer has demat side-effects, require user confirmation before undoing
  - If the transfer is linked to a forecast, handle appropriately

**Modify `reclassifyCreditAsTransfer`:**
- Similar changes as above but for credits
- Set `previous_nature = 'credit'`

**Update `deleteTransfer` function:**
- When deleting a transfer that was created from an expense:
  - Instead of restoring the soft-deleted expense, reclassify it back from 'transfer' to its `previous_nature`
  - Clear transfer-related columns on the expense

### 3. Query Layer Changes

**Update `expense-queries.ts`:**
- Add support for filtering by nature='transfer'
- Ensure transfers are excluded from regular expense/credit queries
- Add query to get expenses by transfer account (from or to)

**Update `account-balance.ts`:**
- Modify `getLedgerExpenses` to exclude expenses with nature='transfer'
- Ensure transfer expenses don't count toward account balance calculations
- Transfers should only affect balance via the `account_transfers` table

### 4. UI Changes

**Transaction tab (`app/(tabs)/expenses.tsx`):**
- Add "Transfers" to the filterNature options: "realized" | "committed" | "credit" | "transfers" | "all"
- When filterNature is "transfers", query expenses where nature='transfer'
- Show transfer expenses with appropriate styling (similar to committed expenses)
- Display from/to account info in the expense list item

**Expense details page (`app/expense/[id].tsx`):**
- When expense nature is 'transfer':
  - Replace "Mark as Transfer" button with "Undo Transfer" button
  - Show a transfer info card displaying:
    - From account name with link to account ledger
    - To account name with link to account ledger
    - Transfer amount and date
    - Original nature (realized/credit) indicator
  - Disable editing fields that would break the transfer (account, amount, date)
  - Show warning if user tries to edit critical fields

- Implement "Undo Transfer" handler:
  - Call `undoExpenseAsTransfer(expenseId)`
  - Show success message
  - Navigate back or reload the expense

- Update the split info display pattern to reuse for transfer info:
  - Similar to how split shows person name and hisaab ledger link
  - Transfer shows from/to accounts with account ledger links

**Account ledger (`app/reconciliation/account-ledger.tsx`):**
- Update transfer row display:
  - When a transfer has `linked_expense_id`, show it as a transfer expense
  - On tap, navigate to the expense details (which now shows transfer info)
  - Ensure transfer rows still show the counter-account name

### 5. Edge Cases to Handle

**1. Existing soft-deleted expenses with linked transfers:**
- Create a migration to restore and reclassify existing soft-deleted expenses:
  - Find all expenses where deleted_at IS NOT NULL and linked in account_transfers
  - Restore the expense (clear deleted_at)
  - Set nature='transfer'
  - Populate transfer_from_account_id, transfer_to_account_id, previous_nature
  - This ensures backward compatibility

**2. Editing a transfer expense:**
- Allow editing of description, merchant, category, payment mode
- Restrict editing of: account, amount, date (these are tied to the transfer)
- If user needs to change these, they must undo the transfer first

**3. Deleting a transfer expense:**
- When deleting a transfer expense:
  - Soft-delete the expense
  - Soft-delete the corresponding account_transfers record
  - This maintains the current behavior but with the new classification

**4. Transfers with demat side-effects:**
- If a transfer has demat side-effects (fund/portfolio snapshot), show confirmation before undoing
- Explain that undoing will reverse the demat snapshot/bucket progress

**5. Transfers linked to forecasts:**
- If a transfer is linked to a forecast, handle appropriately when undoing
- For repayment forecasts, ensure the forecast is not left in an invalid state

**6. Credits marked as transfers:**
- Ensure hisaab settlements are preserved when undoing a credit transfer
- The credit should revert to nature='credit' with all hisaab links intact

**7. Split expenses marked as transfers:**
- Prevent marking a split expense as a transfer (show error)
- Split expenses have hisaab entries that would break

**8. Refund expenses marked as transfers:**
- Handle refund_of_expense_id appropriately
- When undoing, preserve the refund link

**9. Multi-leg purchase expenses:**
- Prevent marking a purchase_group_id expense as transfer
- Or handle by marking all legs in the group

**10. Balance calculation:**
- Ensure transfer expenses (nature='transfer') don't count toward spending totals
- They should only affect balance via account_transfers table
- Update all balance calculation queries to exclude nature='transfer'

### 6. Migration Strategy

Create migration file to:
1. Add new columns to expenses table:
   - `is_transfer INTEGER DEFAULT 0`
   - `transfer_from_account_id TEXT REFERENCES financial_accounts(id)`
   - `transfer_to_account_id TEXT REFERENCES financial_accounts(id)`
   - `previous_nature TEXT`
2. Add index for transfer nature
3. Migrate existing data:
   - For each account_transfers record with linked_expense_id:
     - Restore the expense (clear deleted_at)
     - Set nature='transfer'
     - Populate transfer_from_account_id, transfer_to_account_id
     - Set previous_nature based on original nature (realized or credit)
4. Update any hardcoded nature checks to include 'transfer'

### 7. Testing Checklist

- [ ] Mark expense as transfer - expense becomes nature='transfer'
- [ ] Transfer shows in transaction tab with "transfers" filter
- [ ] Transfer info card shows in expense details with from/to account links
- [ ] Account links navigate to correct account ledger
- [ ] Undo transfer restores expense to original nature
- [ ] Undo transfer soft-deletes account_transfers record
- [ ] Transfer expenses don't appear in regular expense/credit lists
- [ ] Transfer expenses don't count toward spending totals
- [ ] Balance calculation still works correctly
- [ ] Ledger still shows transfer_in/transfer_out entries
- [ ] Ledger entries link to transfer expense details
- [ ] Editing non-critical fields on transfer expense works
- [ ] Editing critical fields on transfer expense is blocked
- [ ] Deleting transfer expense works correctly
- [ ] Migration handles existing soft-deleted expenses
- [ ] Credits marked as transfer preserve hisaab settlements
- [ ] Split expenses cannot be marked as transfer
- [ ] Refund expenses handle refund link correctly
