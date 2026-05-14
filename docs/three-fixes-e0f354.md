# Three Fixes: Split Refund Hisaab, Duplicate Keep-Both-All, Wallet Min-Month

Addresses three independent issues: hisaab adjustment when a split expense is refunded, a "Keep Both All" bulk action on the duplicate review queue, and preventing the wallets screen from navigating into months with no data.

---

## 1 · Split Expense Refund → Hisaab Adjustment

**Root cause**: Recording a refund credit for a split expense does nothing to the existing hisaab entry/entries — the other person still appears to owe the original amount even though the expense is partially or fully returned.

**Design (no new hisaab entries)**:
- **Full refund** (`totalRefunds ≥ expense.amount`): call `removeSplit` (single-split) or `removeMultiSplit` (multi-split). This deletes all hisaab entries for the other person(s) and restores the expense to its original amount.
- **Partial refund** (`0 < totalRefunds < expense.amount`): proportionally reduce each linked hisaab entry:
  - `fraction_remaining = (expense.amount − totalRefunds) / expense.amount`
  - Single split: `new_hisaab_amount = (split_original_amount × (1 − split_pct/100)) × fraction_remaining`
  - Multi-split: for each `expense_splits` row → `new_amount = expense_splits.amount × fraction_remaining`
  - Updates go to the existing `hisaab_entries` rows (no new rows created)

**New service function** in `services/expense-splits.ts`:
```
adjustSplitAfterRefund(originalExpenseId: string): Promise<void>
```

**Call sites**:
1. `app/expense/add.tsx` `handleSave` — after the refund credit is created, if `isRefund && linkedExpenseId` load the linked expense and call `adjustSplitAfterRefund(linkedExpenseId)`.
2. `services/expense-crud.ts` `approveExpense` — after setting `status='approved'`, if the row has `nature='credit'` and a non-null `refund_of_expense_id`, call `adjustSplitAfterRefund(refund_of_expense_id)`.
3. `services/expense-crud.ts` `approveExpenses` (bulk) — same check, run in parallel via `Promise.all`.

No changes to the add-expense form prefill or the `RefundTargetSheet` — the existing UX (user enters their budget-impact portion) is already correct.

---

## 2 · Duplicate Review Queue — "Keep Both All" Bulk Action

**Root cause**: The duplicates section has "Resolve All N Groups" (auto-reject all) but no equivalent bulk "keep both" action.

**Changes** (all in `app/expense/review-queue.tsx`):
1. Add handler `handleKeepBothAllDuplicates`: iterates `duplicateGroups`, calls `dismissDuplicateGroup(group.expenses)` for each, then `loadItems()`. Wrapped in an `alert` confirmation.
2. Add list item type `keep_both_all_duplicates` to the `ListItem` union.
3. Push both items into `listData` when the duplicates section is shown — render them side by side (or stacked) above the individual group cards:
   - Left: "Keep Both All" (success-tinted, `checkmark-done-circle-outline` icon)
   - Right: existing "Resolve All N Groups" (danger-tinted)

---

## 3 · Wallets Screen — PeriodNavigator Min-Month Bound

**Root cause**: `wallets.tsx` passes no `minMonth` to `<PeriodNavigator>`, so the user can navigate back indefinitely even when there is no wallet data.

**Pattern** (same as `account-ledger.tsx`): use `getEarliestMonthForAccounts` from `@/services/account-balance`.

**Changes** in `app/reconciliation/wallets.tsx`:
1. Add state `const [minMonth, setMinMonth] = useState<string | undefined>(undefined)`.
2. Import `getEarliestMonthForAccounts` from `@/services/account-balance`.
3. Inside `useDataRefresh` callback, after filtering wallets, call `getEarliestMonthForAccounts(wallets.map(a => a.id))` and `setMinMonth(earliest ?? undefined)`.
4. Pass `minMonth={minMonth}` to `<PeriodNavigator>`.

---

## Files changed

| File | Change |
|---|---|
| `services/expense-splits.ts` | Add `adjustSplitAfterRefund()` |
| `services/expense-crud.ts` | Call `adjustSplitAfterRefund` in `approveExpense` + `approveExpenses` |
| `app/expense/add.tsx` | Call `adjustSplitAfterRefund` after saving refund credit |
| `app/expense/review-queue.tsx` | Add `handleKeepBothAllDuplicates`, new list item type + button |
| `app/reconciliation/wallets.tsx` | Compute & pass `minMonth` to `PeriodNavigator` |
