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

1. Open the **Transactions** tab.
2. Tap the **+** button → **Add Transfer**.
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
2. Tap **Mark as Transfer**.
3. Select the **destination account** (where the money went).
4. Tap **Confirm**.

The expense is marked as reclassified and a transfer is created. The original expense stays visible but is filtered out from spending views.

If the debit was money going into a **fixed deposit**, use **Mark as Fixed Deposit** instead - see [Investments and fixed deposits](investments). One debit can only be one of Mark as Transfer, Mark as Fixed Deposit, Mark as Investment or Mark as Loan Payment, so it's never counted twice.

## Convert a credit to a transfer

If you received a credit that was actually a transfer (e.g., money moved from one account to another):

1. Open the **credit** (Transactions tab → tap it).
2. Tap **Mark as Transfer**.
3. Select the account the money came **from** - a savings account, wallet or demat account.
4. Tap **Confirm**.

The credit is marked as reclassified and a transfer is created. It appears only once in the ledger and the balances. If the credit was still waiting in the Review Queue, it's approved at the same time.

You can also do this from an account ledger: long-press the credit → **Convert to Transfer**.

## Undo a transfer

If you converted an expense or credit to a transfer by mistake:

1. Open the original expense or credit (Transactions tab → tap it).
2. Tap **Undo Transfer**.
3. Tap **Confirm**.

The transfer is deleted and the original expense/credit is restored (no longer marked as reclassified).

## Where transfers show up

- **Transactions tab → Transfers page** - all transfers listed by date, with a count and total at the top
- **Account ledgers** - appears as debit in source account, credit in destination account; both sides show the counter-account name (e.g. "From Savings" or "To Credit Card")
- **Wallet screens** - the wallet ledger and the Wallets overview both show Transfers In and Transfers Out rows so your wallet balance reconciles correctly
- **Home tab → account summary rows** - Transfers Out and Transfers In are shown alongside the month's expenses and credits for each account
- **Budget / Insights** - excluded from spending totals
- **Transactions tab** - filtered when "Transfers" nature is selected

## Common situations

**I paid my credit card from savings.** Record a transfer: source = savings, destination = credit card, amount = payment amount.

**I logged a credit card payment as an expense by mistake.** Open the expense → Convert to Transfer → destination = credit card → Confirm. The expense is marked as reclassified and a transfer is created.

**I need to move money between my wallets.** Record a transfer: source = wallet 1, destination = wallet 2.

**I withdrew money from my demat account.** Record a transfer with the demat account as the source ("From Account") - or, if the money arrived as a credit SMS in your savings account, open that credit → **Mark as Transfer** → pick the demat account as the source. Either way Arth subtracts the amount from the demat account's idle fund snapshot. If you delete or undo the transfer later, the fund snapshot is restored.

**I want to see all my money movements.** Swipe to the **Transfers** page on the Transactions tab.

## Related

- [Setting up your accounts](accounts)
- [Reconciling a ledger](reconciliation)
- [Recording refunds](refunds)
- [Investments and fixed deposits](investments)
