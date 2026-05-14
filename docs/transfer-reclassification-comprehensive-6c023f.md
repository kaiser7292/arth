# Transfer Reclassification Feature - Comprehensive Documentation

Comprehensive documentation of the transfer reclassification feature including UI mockup, edge cases, and conflicting action management.

## Current Implementation Status

The transfer reclassification feature is **already implemented** in the codebase. This document provides a comprehensive overview of the existing implementation.

## UI Mockup - Expense Details Page

### For Realized Savings Debits (Mark as Transfer)

```
┌─────────────────────────────────────────┐
│ ← Expense Details          [Edit] [Delete] │
├─────────────────────────────────────────┤
│                                         │
│  [Amount: ₹5,000]                       │
│  Merchant: IMPS Transfer                │
│  Date: 14 May 2026                      │
│  Account: HDFC Savings                 │
│  Category: Transfers                   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ Forecast Actions                │   │
│  │ (hidden for realized expenses)  │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ 💳 Mark as Transfer              │   │
│  │ This was a transfer, not spending│   │
│  │                        [→]        │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ 📝 Other Actions                 │   │
│  │ • Split payment                  │   │
│  │ • Create recurring               │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### For Credits (Mark as Transfer / CC Bill Payment)

```
┌─────────────────────────────────────────┐
│ ← Expense Details          [Edit] [Delete] │
├─────────────────────────────────────────┤
│                                         │
│  [Amount: ₹15,000]                      │
│  Merchant: Salary Credit               │
│  Date: 14 May 2026                      │
│  Account: ICICI Savings                │
│  Category: Income                     │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ 💳 Mark as CC Bill Payment       │   │
│  │ This was your bill paid from    │   │
│  │ another account                  │   │
│  │                        [→]        │   │
│  └─────────────────────────────────┘   │
│                                         │
│  (If account is savings, shows "Mark as Transfer")
│  (Label: "This money came from another account of yours")
└─────────────────────────────────────────┘
```

### Account Picker Sheet (Bottom Sheet)

```
┌─────────────────────────────────────────┐
│ ← Select Destination Account              │
├─────────────────────────────────────────┤
│                                         │
│  Search accounts...                   [_] │
│                                         │
│  ○ HDFC Savings                     ●   │
│     Savings • HDFC                     │
│                                         │
│  ● ICICI Credit Card               ○   │
│     Credit Card • ICICI                │
│                                         │
│  ○ Paytm Wallet                     ○   │
│     Wallet • Paytm                     │
│                                         │
│  ○ None (Cancel)                    ○   │
│                                         │
│  [Cancel]          [Confirm]            │
└─────────────────────────────────────────┘
```

### Demat Transfer Target Sheet (For Demat Accounts)

```
┌─────────────────────────────────────────┐
│ ← Categorize Transfer                     │
├─────────────────────────────────────────┤
│                                         │
│  Transfer to: Zerodha Demat            │
│  Amount: ₹50,000                       │
│  Date: 14 May 2026                     │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ What did you invest in?          │   │
│  │                                 │   │
│  │ ○ Mutual Fund                  ●   │
│  │ ○ Stock                        ○   │
│  │ ○ ETF                          ○   │
│  │ ○ Other (skip categorization)  ○   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ Add to bucket?                  │   │
│  │                                 │   │
│  │ ○ Retirement Fund              ○   │
│  │ ○ Emergency Fund               ○   │
│  │ ○ None                         ○   │
│  └─────────────────────────────────┘   │
│                                         │
│  [Skip]            [Confirm]             │
└─────────────────────────────────────────┘
```

## How It Works

### Backend Functions

#### 1. `reclassifyExpenseAsTransfer(expenseId, toAccountId)`
- **Purpose**: Convert a realized expense (debit) into an inter-account transfer
- **Process**:
  1. Validates the expense exists and is reclassifiable (nature='realized', not deleted)
  2. Preserves SMS trace if source was SMS-auto detected
  3. Creates a transfer record with `linked_expense_id` pointing to the original expense
  4. Soft-deletes the original expense
  5. Bumps data version to trigger UI refresh

#### 2. `reclassifyCreditAsTransfer(creditId, fromAccountId)`
- **Purpose**: Convert a credit into an inter-account transfer
- **Process**:
  1. Validates the credit exists and is not deleted
  2. **Special case for CC repayment**: If credit has `matched_forecast_id` pointing to a 'repayment' forecast:
     - Delegates to `approveCcRepaymentCredit` to close the forecast
     - Updates CC dues and `paid_from_account_id`
  3. **Plain credit case**: Creates transfer record and soft-deletes the credit
  4. Preserves SMS trace if source was SMS-auto detected

### UI Flow

#### For Savings Debit → Transfer:
1. User taps "Mark as Transfer" button
2. AccountPickerSheet slides up showing destination accounts
3. User selects destination account
4. If destination is demat account:
   - DematTransferTargetSheet opens
   - User selects fund/portfolio type and optional bucket
   - Side-effects applied (snapshot bump, bucket progress)
5. Alert shown: "Reclassified - This expense has been converted to an inter-account transfer"
6. Navigate back to previous screen
7. Original expense is now hidden (soft-deleted)
8. Transfer record appears in both accounts' ledgers

#### For Credit → Transfer:
1. User taps "Mark as Transfer" (or "Mark as CC Bill Payment")
2. AccountPickerSheet slides up showing source accounts
3. User selects source account
4. If credit was matched to repayment forecast:
   - Forecast is closed automatically
   - CC dues reduced
5. If destination (credit's account) is demat:
   - DematTransferTargetSheet opens for categorization
6. Navigate to destination account's ledger (cross-link to transfer)
7. Original credit is now hidden (soft-deleted)
8. Transfer record appears in both accounts' ledgers

## Edge Cases Handled

### 1. Same-Account Transfer Prevention
- **Guard**: `createTransfer` throws error if `fromAccountId === toAccountId`
- **Reason**: Self-transfers would create a self-loop that balance math nets to zero but leaves garbage in ledger

### 2. Invalid Amounts
- **Guard**: Rejects non-finite, non-positive, or absurdly-large amounts (>= 1e12)
- **Reason**: Prevents balance math corruption and demat snapshot poisoning

### 3. Invalid Date Format
- **Guard**: Requires YYYY-MM-DD format
- **Reason**: Demat side-effects slice date.slice(0,7) for month bucket, balance-sheet math assumes this format

### 4. Demat-Linked Transfer Edits
- **Guard**: `updateTransfer` rejects amount/date edits if `demat_target != NULL`
- **Reason**: Changing amount/date would corrupt fund/portfolio snapshot math and bucket progress without paired reverse/re-apply
- **Workaround**: User must delete + re-create to change amount/date

### 5. Transfer Deletion with Source Restoration
- **Guard**: When deleting a transfer created via "Mark as Transfer", the original expense/credit is restored
- **Process**:
  1. Reverse demat side-effects if applicable
  2. Soft-delete transfer
  3. Restore linked expense/credit (set `deleted_at = NULL`)
- **Reason**: Deleting the transfer is the user's undo - both sides should return to pre-reclassification state

### 6. CC Repayment Credit Handling
- **Special Case**: Credits matched to repayment forecasts are routed through `approveCcRepaymentCredit`
- **Reason**: Without this, the forecast would stay open forever and user would see "bill due" in forecast UIs
- **Side Effects**: Forecast closed, CC dues reduced, `paid_from_account_id` recorded

### 7. SMS Trace Preservation
- **Feature**: When reclassifying SMS-auto detected expenses/credits, the SMS body and sender ID are preserved on the transfer
- **Fields**: `raw_source_text`, `source_sms_address`
- **Reason**: Maintains audit trail and allows debugging of SMS-based reclassifications

### 8. Pending Review State
- **Guard**: Only approved expenses/credits can be reclassified
- **Reason**: Pending review rows haven't been confirmed by user yet

## Conflicting Action Management

### 1. Split Expenses
- **Conflict**: Can a split expense leg be marked as transfer?
- **Current Behavior**: Not explicitly blocked, but UI only shows "Mark as Transfer" for non-split expenses
- **Recommendation**: Add guard to prevent reclassifying split legs - this would orphan the other legs

### 2. Linked Forecast
- **Conflict**: What if expense is linked to a forecast (other than repayment)?
- **Current Behavior**: Not handled explicitly
- **Recommendation**: Should block reclassification or unlink forecast first

### 3. Linked Reminder
- **Conflict**: What if expense fulfills a reminder?
- **Current Behavior**: Not handled explicitly
- **Recommendation**: Should block reclassification or unlink reminder first

### 4. Linked Settlement
- **Conflict**: Credits with `linked_settlement_id` (already claimed as settlement)
- **Current Behavior**: UI hides "Mark as Transfer" if `linkedSettlement` exists
- **Reason**: Credit already used for hisaab settlement, shouldn't be reclassified

### 5. Recurring Expense
- **Conflict**: Can a recurring expense instance be marked as transfer?
- **Current Behavior**: Not explicitly blocked
- **Recommendation**: Should allow - individual instance reclassification is valid

### 6. Deleted Expense/Credit
- **Conflict**: Can a deleted expense/credit be reclassified?
- **Current Behavior**: Backend checks `deleted_at IS NULL`
- **Reason**: Already handled by guard in reclassify functions

### 7. Demat Side-Effects Failure
- **Conflict**: What if demat side-effects fail during transfer creation?
- **Current Behavior**: Transaction would roll back, transfer not created
- **Reason**: Atomic transaction ensures consistency

### 8. Concurrent Edits
- **Conflict**: What if user edits expense while reclassification is in progress?
- **Current Behavior**: Not handled explicitly
- **Recommendation**: Add optimistic UI lock or version check

## Database Schema

### account_transfers Table
```sql
CREATE TABLE account_transfers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  from_account_id TEXT NOT NULL,
  to_account_id TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT,
  date TEXT NOT NULL,  -- YYYY-MM-DD format
  linked_forecast_id TEXT,  -- For CC bill payments
  linked_expense_id TEXT,  -- Source expense/credit that was reclassified
  source TEXT DEFAULT 'manual',  -- 'manual' or 'sms_auto'
  raw_source_text TEXT,  -- SMS body when reclassified from SMS
  source_sms_address TEXT,  -- DLT sender ID (e.g., "VM-HDFCBK-S")
  demat_target TEXT,  -- Fund/portfolio target for demat transfers
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (from_account_id) REFERENCES financial_accounts(id),
  FOREIGN KEY (to_account_id) REFERENCES financial_accounts(id)
);
```

### expenses Table (linked fields)
```sql
-- When expense is reclassified as transfer:
-- - deleted_at is set (soft-delete)
-- - Transfer record has linked_expense_id pointing to this expense

-- When credit is reclassified as transfer:
-- - deleted_at is set (soft-delete)
-- - Transfer record has linked_expense_id pointing to this credit
```

## Audit Trail

### Audit Log Actions
- `"reclassified_by_rule"` - Applied when `applied_rule_id` is set
- Transfer reclassification via UI doesn't add this action (it's manual)
- SMS-auto reclassification would have `source = 'sms_auto'`

### Audit Log Entry Structure
```typescript
{
  id: string,
  user_id: string,
  action_type: "reclassified_by_rule" | ...,
  source_type: "manual" | "sms_auto" | ...,
  amount: number,
  date: string,
  account_id: string,
  category_id: string | null,
  merchant_name: string | null,
  description: string | null,
  created_at: string
}
```

## Balance Calculation Impact

### Formula
```
closing_balance = opening_balance - expenses + credits - transfers_out + transfers_in
```

### Transfer Impact
- **Outgoing transfer**: Reduces `from_account` balance by amount
- **Incoming transfer**: Increases `to_account` balance by amount
- **NOT** included in spending totals or budgets
- Affects account balance via the formula above

### Functions Used
- `getTransfersOutTotal(accountId, startDate, endDate)` - Total transferred out
- `getTransfersInTotal(accountId, startDate, endDate)` - Total transferred in
- `getTransfersForMonth(accountId, startDate, endDate)` - All transfers for month

## Current Gaps & Recommendations

### 1. No Explicit Guard for Split Expenses
- **Gap**: Split expense legs can potentially be reclassified
- **Recommendation**: Add check: if expense is part of split, block reclassification
- **Implementation**: Check `split_group_id` in expense before allowing reclassification

### 2. No Guard for Linked Forecasts (non-repayment)
- **Gap**: Expenses linked to other forecast types can be reclassified
- **Recommendation**: Block reclassification if `matched_forecast_id` exists and is not repayment
- **Implementation**: Check forecast type before allowing reclassification

### 3. No Guard for Linked Reminders
- **Gap**: Expenses fulfilling reminders can be reclassified
- **Recommendation**: Block reclassification if `fulfills_reminder_id` exists
- **Implementation**: Check reminder linkage before allowing reclassification

### 4. No Concurrent Edit Protection
- **Gap**: Race condition if user edits while reclassifying
- **Recommendation**: Add version check or UI lock
- **Implementation**: Use `updated_at` timestamp to detect concurrent modifications

### 5. No Undo/Redo for Demat Categorization
- **Gap**: Once demat target is set, can't change it without delete+recreate
- **Recommendation**: Allow editing demat target via transfer edit screen
- **Implementation**: Add demat target edit mode in transfer details

### 6. Limited Visual Feedback for Reclassified Items
- **Gap**: In ledger, reclassified expenses/credits just disappear
- **Recommendation**: Show indicator that item was reclassified as transfer
- **Implementation**: Add visual marker or "View as Transfer" option

### 7. No Bulk Reclassification
- **Gap**: Can only reclassify one item at a time
- **Recommendation**: Add bulk action for multiple similar items
- **Implementation**: Multi-select in review queue or ledger

## Testing Checklist

### Happy Path
- [ ] Mark savings debit as transfer to savings account
- [ ] Mark savings debit as transfer to credit card account
- [ ] Mark savings debit as transfer to demat account (with categorization)
- [ ] Mark credit as transfer from savings account
- [ ] Mark credit as CC bill payment (with forecast closure)
- [ ] Delete transfer (expense/credit restored)
- [ ] SMS-auto detected expense reclassification preserves SMS trace

### Edge Cases
- [ ] Attempt same-account transfer (should fail)
- [ ] Attempt reclassification of deleted expense (should fail)
- [ ] Attempt reclassification of split expense leg (should fail - not implemented)
- [ ] Attempt reclassification with invalid amount (should fail)
- [ ] Attempt reclassification with invalid date (should fail)
- [ ] Edit demat-linked transfer amount (should fail)
- [ ] Credit with linked settlement (button hidden)

### Conflicting Actions
- [ ] Mark as transfer while expense is being edited
- [ ] Mark as transfer while linked to non-repayment forecast (should fail - not implemented)
- [ ] Mark as transfer while fulfilling reminder (should fail - not implemented)
- [ ] Recurring expense instance reclassification

## Summary

The transfer reclassification feature is **fully implemented** with:
- ✅ Backend functions for expense and credit reclassification
- ✅ UI with account picker sheets
- ✅ Demat account categorization flow
- ✅ SMS trace preservation
- ✅ Transfer deletion with source restoration
- ✅ CC repayment special case handling
- ⚠️ Some gaps in conflicting action guards (split expenses, linked forecasts, linked reminders)
- ⚠️ No concurrent edit protection
- ⚠️ Limited visual feedback for reclassified items

The feature is production-ready for the main use cases but would benefit from additional guards for edge cases and improved UX for demat categorization.
