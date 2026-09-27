---
title: Accounts and balances
slug: accounts
summary: How to add, edit, close and read balances for savings, credit cards, wallets, loans, demat, pension and fixed deposit accounts.
tags: [accounts, balances, banks, credit-card, loan, demat, wallet, savings, utilized, limit, available-credit, account-ledger]
contextKeys: [account-list, account-detail, account-add]
phrasings:
  - How do accounts work?
  - Add a new bank account
  - Credit card balance is wrong
  - Available credit limit not updating
  - What is a demat account in Arth?
  - How do I delete an account?
  - Loan EMI tracking
  - Why are there two accounts for the same card?
  - Last known balance is stale
  - Can I see account-wise spending?
  - Link SMS to an account manually
  - Reconcile an account against the bank statement
  - UI bank balance summary
  - UI credit card dashboard
  - UI demat summary card
  - UI wallet summary
  - Home hero card balance
  - Available credit on credit card
  - Utilized amount
  - Account ledger page
  - Pool balance shared credit cards
  - Fund vs portfolio on demat
  - Adjust balance button
  - Demat portfolio trend chart
  - Tap a point on the chart
  - Interactive chart on demat
  - Loans card on home screen
  - Your Accounts section on Home
  - Total on demat account card
---

Accounts represent where your money actually lives - savings, credit cards, wallets, loans, demat, pension and fixed deposits. Arth keeps a running balance for each by applying every expense, credit, and transfer in date order.

## Where to find them

- **Settings tab → Data Management → Accounts** - the master list of all accounts.
- **Home tab** - summary cards show live balances for Credit cards, Bank balances, Wallets, **Investments** (demat, pension and fixed deposits together) and Loans. Tap any card to drill into account-specific details.
- **Investments screen** (tap the Investments card) - every demat, pension and FD account. See [Investments and fixed deposits](investments).

## Adding an account

1. **Settings tab → Data Management → Accounts → tap +** (top-right).
2. Pick a type: **Savings**, **Credit Card**, **Wallet**, **Loan**, **Demat** or **Pension**. (Fixed deposits are added from the Investments screen, or with **Mark as Fixed Deposit** on the debit that funded them.)
3. Fill in:
   - **Name** (e.g. "HDFC Savings")
   - **Last 4 digits** of the card/account (used to match bank SMS)
   - **Current balance** (savings/wallet) or **credit limit** + **utilized** (credit card) or **principal remaining** (loan)
4. Tap **Save account**.

For savings, credit card and loan accounts, Arth offers to **Add credentials** - a shortcut to save the login in the [Vault](vault).

Arth uses the last-4 to auto-route incoming SMS. If two cards share the same last-4, rename one with a clearer label.

## Reading the balance

Balances are **computed**, not stored. For every month, Arth does:

```
Opening balance (start of month)
 - expenses dated in that month
 + credits / refunds dated in that month
 + transfers in − transfers out
 + any balance adjustments you made
 = closing balance
```

- **Savings/Wallet** - higher = more money.
- **Credit card** - shows **utilized** (how much you owe). Lower = better. A payment from savings to credit card lowers both. The card also tracks available credit = limit − utilized.
- **Loan** - shows **principal remaining**. Lower = better. EMI payments reduce it.
- **Pension (EPF / NPS / PPF)** - the running total of contributions credited, like a savings balance.
- **Fixed deposit** - the principal, until it matures and closes. See [Investments and fixed deposits](investments).
- **Demat** - shows **fund** (idle cash with broker) + **portfolio** (invested value). Each account card displays the combined total when both fund and portfolio exist, with a breakdown subtitle. The portfolio trend chart is interactive - tap any data point to see exact values and dates. Move money in/out via transfers. When you transfer money **out** of a demat account (demat as the "From Account"), the idle fund is automatically reduced.

## Demat Account Details

Tap the **Investments** card on Home, then tap a demat account to open the **Demat Account Details** screen. It shows:

- **Portfolio Summary** - total portfolio value, idle cash/fund, and combined total across all demat accounts.
- **Deposited / Withdrawn / Net Invested** - running totals computed from all transfers into and out of the demat account. Deposited = transfers in (fund + portfolio). Withdrawn = transfers out. Net Invested = Deposited − Withdrawn.
- **Trend chart** - last 12 weeks of portfolio + fund, plotted per-account with a combined "Total" line when you have multiple accounts. **Tap any point** on the chart to see the exact value and date in a tooltip. A dashed vertical line highlights the selected week.
- **Per-account breakdown** - each account shows its combined total (portfolio + fund) as the primary number, with a subtitle breaking down the two components.

## Common situations

**"My credit card balance is wrong after a payment."**
Check two things:
1. The payment should be a **transfer** from savings → credit card, not a credit "expense" on the card.
2. Open the card's **Ledger** (Settings tab → Data Management → Accounts → Credit Cards → tap the card) and scroll to the transfer date. If it's missing, add it manually.

**"Bank says I have ₹X, Arth shows ₹Y."**
Open the account's ledger and scroll to the first date where the running balance doesn't match the bank. Usually a missing expense or a duplicate. See the reconciliation article.

**"Why do I have two entries for the same card?"**
If you added the card manually AND an SMS came in that didn't match the last-4, Arth may have auto-created a second. Delete the extra from Settings tab → Data Management → Accounts.

**"Close an account."**
Settings tab → Data Management → Accounts → tap the account → **Close account**. Closing removes it from active balance tracking, hides it from home cards, charts, and Net Worth, but keeps the full history browsable. You can reopen it at any time from the same screen. Prefer Close over Delete — Delete removes the account permanently and unlinks its expenses.

**"Delete an account."**
Settings tab → Data Management → Accounts → tap the account → **Delete** at the bottom. If it has expenses linked, those expenses will lose their account (they won't be deleted). Prefer **Close** instead - it hides the account from active views but keeps history intact.

**"Change last-known balance without adding a fake expense."**
On the account detail screen, tap **Adjust Balance**. This creates a ledger-adjustment row (visible in the ledger as "[Balance Adjustment]") without affecting budget.

## Related
- Fixing discrepancies: [Reconciling a ledger](reconciliation)
- How SMS is routed: [How SMS detection works](sms-detection)
