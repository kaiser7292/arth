# Fix Credit Deletion and Utilization Recalculation Issue

Plan to fix the issue where deleting a credit entry doesn't trigger month balance recalculation, causing incorrect utilization amounts.

## Problem
- User deleted an old credit entry from the credit card account ledger
- The deletion worked (entry was removed)
- But the utilization calculation got messed up
- The month balance summary didn't recalculate after deletion

## Root Cause
- The `deleteCredit` function in `services/account-credit.ts` does a soft delete and bumps data version
- It does NOT call `resetMonthBalance` to force recalculation of the month balance
- The `getMonthBalanceSummary` function caches balances in `account_month_balances` table
- When a credit is deleted, the cached balance becomes stale
- The UI shows the old (stale) utilization amount instead of recalculating

## Solution

Update `deleteCredit` function to reset the month balance after deletion, forcing recalculation:

```typescript
export async function deleteCredit(creditId: string): Promise<void> {
  const db = getDatabase();
  // Get the credit's account_id and date before deleting
  const credit = await db.getFirstAsync<{ account_id: string; date: string }>(
    `SELECT account_id, date FROM expenses WHERE id = ? AND nature IN ('credit', 'ledger_adjustment');`,
    creditId,
  );
  
  // Soft delete
  await db.runAsync(
    `UPDATE expenses SET deleted_at = datetime('now') WHERE id = ? AND nature IN ('credit', 'ledger_adjustment');`,
    creditId,
  );
  
  // Reset month balance to force recalculation
  if (credit) {
    const month = credit.date.substring(0, 7);
    await resetMonthBalance(credit.account_id, month);
  }
  
  await bumpDataVersion();
}
```

## Files to Modify
- `services/account-credit.ts` (update deleteCredit function)
