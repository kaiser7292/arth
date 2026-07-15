---
title: Balance Sheet
slug: balance-sheet
summary: See your net worth at a point in time — assets minus liabilities — with a live column and a historical column for comparison.
tags: [balance sheet, net worth, assets, liabilities, investments, savings, demat, goals, historical, live balance]
contextKeys: [balance-sheet, goals-tab]
phrasings:
  - What is the balance sheet in Arth?
  - How is net worth calculated?
  - What counts as an asset?
  - What counts as a liability?
  - How do I see my net worth?
  - Add a balance sheet column
  - Historical net worth
  - Balance sheet past year
  - Net worth comparison
  - Goals track section
  - Demat in balance sheet
  - Loan in balance sheet
  - How is demat value shown?
---

The **Balance Sheet** (Goals tab → Track section → Balance Sheet) shows your net worth — total assets minus total liabilities — at one or more points in time. It is a snapshot view, not a running ledger.

## Default columns

When you open the Balance Sheet for the first time, it shows two columns:

- **Previous FY close** — your net worth at the last day of the previous fiscal year
- **Live** — your net worth right now, updated each time the page loads

You can tap the **+** button to add more historical columns, such as the FY-close two years ago or any specific month-end.

## What goes into assets

- **Savings and current accounts** — the closing balance of each bank account as of the column date
- **Wallets** — wallet balances
- **Demat accounts** — the value of your demat holdings. Arth uses the last price snapshot you have recorded (either entered manually or fetched via Kite Connect if you have linked it). If no price has been recorded, the demat account shows the cost basis.
- **Pension / NPS / EPF** — the balance of each pension account as of the column date
- **Investment Buckets** — cumulative contributions tracked in Arth (note: this is the contributed amount, not the market value, unless you update the bucket value manually)

## What goes into liabilities

- **Loans** — outstanding principal on each active loan as of the column date
- **Credit card outstanding** — current outstanding balance on each credit card account

## Net worth

Net worth is Assets minus Liabilities. A positive number means your assets exceed your obligations. Arth shows this as the final line at the bottom of the Balance Sheet.

## Adding and removing columns

Tap the **+** button to add a historical month-end column. Select any past month from the date picker. The column appears alongside the existing ones.

To remove a column you added, tap the column header. The Live and Previous FY close columns cannot be removed — they are always present.

## Recomputing indicator

A small spinner appears next to column headers while Arth is computing the values. Balance sheet data is not cached — it recalculates each time the screen opens or a data change occurs. On the first open after a long session, there may be a brief moment where numbers appear as loading placeholders.

## Common situations

**"My net worth shows much lower than expected."** Check whether your demat accounts have an up-to-date price snapshot. If the last snapshot is old or zero, the demat value will be understated. Update the price via the demat account detail screen or link Kite Connect for live prices.

**"My loan is in the assets section."** Loans are liabilities. If a loan account appears under assets, check that the account type is set to `Loan` in Settings → Master Data → Accounts. The balance sheet categorises by account type.

**"I have a PPF account — how do I track it?"** Add it as a Savings account or a custom Investment Bucket. Arth does not have a dedicated PPF account type; the balance you enter is used as-is.

**"The Live column and account balance don't match."** The balance sheet uses the account's computed closing balance as of today, which includes all approved transactions. If there are pending-review SMS transactions that affect this account, approve or reject them first to see the accurate balance.

## Related

- Link live demat prices: [Kite Connect (Zerodha)](kite-connect)
- Track savings accounts: [Setting up your accounts](accounts)
- See net worth change over years: [Year-over-Year comparison](yoy-comparison)
