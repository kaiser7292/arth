# Transfer Reclassification Fix Plan

This plan fixes the transfer reclassification feature to not soft-delete expenses/credits, instead keeping them visible with transfer details and undo functionality.

## UI Mockups

### Expense Details Page - Reclassified Expense

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
│  │ 💳 Marked as Transfer          │   │
│  │ From: HDFC Savings →          │   │
│  │ To: ICICI Credit Card         │   │
│  │                        [View]   │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ ↩ Undo Transfer                │   │
│  │ Convert back to expense        │   │
│  │                        [Undo]   │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ 📝 Other Actions                 │   │
│  │ • Split payment                  │   │
│  │ • Create recurring               │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### Expense Details Page - Normal Expense (Not Reclassified)

```
┌─────────────────────────────────────────┐
│ ← Expense Details          [Edit] [Delete] │
├─────────────────────────────────────────┤
│                                         │
│  [Amount: ₹5,000]                       │
│  Merchant: Amazon                      │
│  Date: 14 May 2026                      │
│  Account: HDFC Savings                 │
│  Category: Shopping                   │
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

### Transfer Details Section (Expanded)

```
┌─────────────────────────────────────────┐
│  ┌─────────────────────────────────┐   │
│  │ 💳 Marked as Transfer          │   │
│  │                                 │   │
│  │ From: [HDFC Savings] →         │   │
│  │       (tap → HDFC ledger)       │   │
│  │                                 │   │
│  │ To:   [ICICI Credit Card] →    │   │
│  │       (tap → ICICI ledger)     │   │
│  │                                 │   │
│  │ Amount: ₹5,000                 │   │
│  │ Date: 14 May 2026              │   │
│  │                        [View]   │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### Transactions Tab - All Nature (Shows Reclassified)

```
┌─────────────────────────────────────────┐
│  All | Expenses | Committed | Credits | Transfers│
├─────────────────────────────────────────┤
│                                         │
│  14 May 2026                            │
│  ₹5,000  Amazon              HDFC Savings│
│  Shopping                                │
│                                         │
│  14 May 2026                            │
│  ₹5,000  IMPS Transfer        HDFC Savings│
│  [Transfer Badge]                        │
│                                         │
│  13 May 2026                            │
│  ₹15,000 Salary Credit        ICICI Savings│
│  Income                                 │
└─────────────────────────────────────────┘
```

### Transactions Tab - Transfers Nature

```
┌─────────────────────────────────────────┐
│  All | Expenses | Committed | Credits | Transfers│
├─────────────────────────────────────────┤
│                                         │
│  14 May 2026                            │
│  ₹5,000  HDFC Savings → ICICI CC        │
│  [Transfer Badge]                        │
│                                         │
│  13 May 2026                            │
│  ₹15,000 Salary → ICICI Savings         │
│  [Transfer Badge]                        │
└─────────────────────────────────────────┘
```

## Current Issues

1. Expenses/credits are soft-deleted when marked as transfer (should remain visible)
2. No transfer details shown in expense details page
3. No undo action in expense details
4. No redirection to from/to account ledger
5. Transfers not visible in "all" nature filter

## Proposed Solution

### 1. Remove Soft-Deletion from Backend Functions

**Files**: `services/account-transfer.ts`

**Changes to `reclassifyExpenseAsTransfer`:**
- Remove the `UPDATE expenses SET deleted_at = ?` statement (lines 445-451)
- Instead, add a flag to mark the expense as reclassified:
  - Option A: Add `reclassified_as_transfer = 1` column to expenses table
  - Option B: Use existing `linked_transfer_id` column (if exists)
- Keep the transfer creation with `linked_expense_id`

**Changes to `reclassifyCreditAsTransfer`:**
- Remove the `UPDATE expenses SET deleted_at = ?` statement (lines 568-575)
- Add the same reclassification flag
- Keep the transfer creation with `linked_expense_id` (or `linked_credit_id`)

### 2. Add Reclassification Flag to Database Schema

**Files**: `database/TABLE_SCHEMAS.ts` and migration file

**Add to expenses table:**
- `reclassified_as_transfer INTEGER DEFAULT 0` - Boolean flag
- `linked_transfer_id TEXT` - Reference to the transfer record

**Migration:**
- Create migration to add these columns
- Update existing reclassified records (those with deleted_at and linked_expense_id in transfers)

### 3. Update Expense Details Page to Show Transfer Information

**Files**: `app/expense/[id].tsx`

**Add transfer details section (around line 2200-2300):**
- Query transfer by `linked_transfer_id` or check `reclassified_as_transfer` flag
- If expense is reclassified, show:
  - Header: "Marked as Transfer"
  - From account name (tappable → ledger view filtered to this account)
  - To account name (tappable → ledger view filtered to this account)
  - Amount and date
  - Undo button (calls undo function)
- Style similar to existing split section (lines 2100-2172)

**Remove "Mark as Transfer" button:**
- Hide the button if `reclassified_as_transfer = 1`
- Show "Undo Transfer" button instead

### 4. Implement Undo Transfer Functionality

**Files**: `services/account-transfer.ts`

**Add `undoTransfer` function:**
```typescript
export async function undoTransfer(transferId: string): Promise<void> {
  const db = getDatabase();
  
  // Get transfer details
  const transfer = await db.getFirstAsync<AccountTransfer>(
    `SELECT * FROM account_transfers WHERE id = ?;`,
    transferId
  );
  
  if (!transfer) throw new Error("Transfer not found");
  
  // Reverse demat side-effects if applicable
  const { reverseDematTransferSideEffectsInTxn } = await import("@/services/demat-transfer");
  
  await db.withTransactionAsync(async () => {
    await reverseDematTransferSideEffectsInTxn(transferId);
    
    // Remove reclassification flag from expense/credit
    await db.runAsync(
      `UPDATE expenses SET reclassified_as_transfer = 0, linked_transfer_id = NULL WHERE id = ?;`,
      transfer.linked_expense_id
    );
    
    // Soft-delete the transfer
    const now = new Date().toISOString();
    await db.runAsync(
      `UPDATE account_transfers SET deleted_at = ? WHERE id = ?;`,
      now,
      transferId
    );
  });
  
  await bumpDataVersion();
}
```

**Files**: `app/expense/[id].tsx`

**Add undo handler:**
```typescript
const handleUndoTransfer = useCallback(async () => {
  try {
    await undoTransfer(transferId);
    alert("Success", "Transfer has been undone");
    router.back();
  } catch (e) {
    alert("Error", formatError("Undo transfer", e));
  }
}, [transferId, alert, router]);
```

### 5. Add From/To Account Ledger Redirection

**Files**: `app/expense/[id].tsx`

**Add navigation to account ledger:**
```typescript
const navigateToAccountLedger = useCallback((accountId: string) => {
  router.push({
    pathname: "/reconciliation/account-ledger",
    params: { accountId }
  });
}, [router]);
```

**Link the account names in transfer details section:**
```typescript
<Pressable onPress={() => navigateToAccountLedger(transfer.from_account_id)}>
  <Text className="text-sm font-semibold" style={{ color: accent[500] }}>
    {fromAccountName}
  </Text>
</Pressable>

<Pressable onPress={() => navigateToAccountLedger(transfer.to_account_id)}>
  <Text className="text-sm font-semibold" style={{ color: accent[500] }}>
    {toAccountName}
  </Text>
</Pressable>
```

**Note**: Both from and to account names are independently tappable. Clicking from account navigates to from account ledger. Clicking to account navigates to to account ledger.

### 6. Ensure Transfers Appear in All and Transfers Nature

**Files**: `app/(tabs)/expenses.tsx`

**Update expense query logic:**
- Currently, reclassified expenses are soft-deleted so they don't appear
- With new approach, they should appear in "all" nature
- For "transfers" nature, query both:
  - Direct transfers from `account_transfers` table
  - Reclassified expenses/credits with `reclassified_as_transfer = 1`

**Modify `loadExpenses` function:**
- When `filterNature === "transfers"`, query both:
  ```typescript
  const [transfers, reclassifiedExpenses] = await Promise.all([
    getTransfersForMonth(DEFAULT_USER_ID, filterStartDate, filterEndDate),
    getReclassifiedExpenses(DEFAULT_USER_ID, filterStartDate, filterEndDate)
  ]);
  ```
- Merge and display both types

### 7. Update deleteTransfer Function

**Files**: `services/account-transfer.ts`

**Remove restoration logic:**
- Currently, `deleteTransfer` restores the linked expense/credit (lines 269-279)
- With new approach, the expense/credit is not deleted, so no restoration needed
- Just soft-delete the transfer and reverse demat side-effects

### 8. Update Account Ledger to Handle Reclassified Expenses

**Files**: `app/reconciliation/account-ledger.tsx`

**Mark reclassified expenses:**
- Check `reclassified_as_transfer` flag
- Show visual indicator (badge or icon)
- Add option to view transfer details or undo

## Implementation Order

1. Add reclassification flag to database schema (migration)
2. Update backend functions (remove soft-delete, add flag)
3. Implement undoTransfer function
4. Update expense details page (show transfer info, add undo)
5. Add ledger redirection
6. Update expenses page (show in all/transfers nature)
7. Update account ledger (mark reclassified items)
8. Update deleteTransfer function
9. Test end-to-end flow

## Testing Checklist

- [ ] Mark expense as transfer - expense remains visible in all/transfers
- [ ] Mark credit as transfer - credit remains visible in all/transfers
- [ ] Expense details shows transfer information
- [ ] From account link navigates to ledger
- [ ] To account link navigates to ledger
- [ ] Undo transfer converts back to expense
- [ ] Undo transfer converts back to credit
- [ ] Transfer is deleted after undo
- [ ] Transfers appear in "all" nature
- [ ] Transfers appear in "transfers" nature
