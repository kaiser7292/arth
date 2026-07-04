---
title: Recording transfers between accounts
slug: transfers
summary: Move money between your accounts. Transfers don't count as spending and don't affect your budget.
tags: [transfers, account-transfer, money-movement, between-accounts]
contextKeys: [transactions, account-detail]
phrasings:
  - How do I record a transfer?
  - Money moved from savings to credit card
  - Transfer between accounts
  - Does a transfer count as spending?
  - Where do transfers show up?
  - Convert an expense to a transfer
  - Convert a credit to a transfer
  - Undo a transfer
---

A transfer is money moving between your accounts - from savings to credit card, from wallet to bank, or any other movement. Transfers don't count as spending and don't affect your budget.

## Why this matters

Transfers are different from expenses:
- **Not spending** - money you already own, just moving it around
- **No budget impact** - doesn't reduce your budget caps
- **Shows separately** - filtered out from spending insights
- **Ledger math** - appears in both account ledgers, balances net out correctly

## Record a transfer

1. Open the **Transfers** tab (bottom navigation).
2. Tap the **+** button.
3. Select the **source account** (where money is coming from).
4. Select the **destination account** (where money is going).
5. Enter the **amount**.
6. Enter the **date** (defaults to today).
7. Add a **description** (optional, e.g., "Credit card payment").
8. Tap **Save**.

The transfer appears in both account ledgers and is filtered in the Transfers nature filter.

## Convert an existing expense to a transfer

If you logged an expense that was actually a transfer (e.g., a credit card payment that you recorded as an expense):

1. Open the **expense** (Transactions tab → tap it).
2. Tap the **Convert to Transfer** action.
3. Select the **destination account** (where the money went).
4. Tap **Confirm**.

The expense is marked as reclassified and a transfer is created. The original expense stays visible but is filtered out from spending views.

## Convert a credit to a transfer

If you received a credit that was actually a transfer (e.g., money moved from one account to another):

1. Open the **credit** (Transactions tab → tap it).
2. Tap the **Convert to Transfer** action.
3. Select the **destination account** (where the money went).
4. Tap **Confirm**.

The credit is marked as reclassified and a transfer is created.

## Undo a transfer

If you converted an expense or credit to a transfer by mistake:

1. Open the **transfer** (Transfers tab → tap it).
2. Tap the **Undo** action.
3. Tap **Confirm**.

The transfer is deleted and the original expense/credit is restored (no longer marked as reclassified).

## Where transfers show up

- **Transfers tab** - all transfers listed by date, separate from spending
- **Account ledgers** - appears as debit in source account, credit in destination account
- **Budget / Insights** - excluded from spending totals
- **Transactions tab** - filtered when "Transfers" nature is selected

## Common situations

**I paid my credit card from savings.** Record a transfer: source = savings, destination = credit card, amount = payment amount.

**I logged a credit card payment as an expense by mistake.** Open the expense → Convert to Transfer → destination = credit card → Confirm. The expense is marked as reclassified and a transfer is created.

**I need to move money between my wallets.** Record a transfer: source = wallet 1, destination = wallet 2.

**I want to see all my money movements.** Use the Transfers tab or filter Transactions by "Transfers" nature.

## Related

- [Setting up your accounts](accounts)
- [Reconciling a ledger](reconciliation)
- [Recording refunds](refunds)
