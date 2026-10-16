---
title: Importing from Excel
slug: excel-import
summary: Bulk-import expenses, committed payments, credits, transfers and hisaab entries from a spreadsheet using Arth's templates.
tags: [excel, import, bulk, spreadsheet, template, csv, migration]
contextKeys: [settings-import]
phrasings:
  - Import from Excel
  - Upload expenses from spreadsheet
  - Migrate from another app
  - Bulk add expenses
  - Import template
  - I have my data in Google Sheets
  - CSV import
  - Can I import Axio data?
  - Import hisaab from Excel
  - Import income/credits from sheet
---

Bulk-load transactions (expenses, committed payments, credits and transfers) or hisaab entries from an Excel or CSV file. Useful when migrating from another tracker or bringing in historical data.

## Where to find it

**Settings tab → Import & Config → Import from Excel.**

## Supported files

- `.xlsx`, `.xls`, `.csv`
- Google Sheets - download as Excel (`.xlsx`) first.
- Multi-sheet files are fine - Arth asks which sheet to import.

## Step 1 - Get the template

At the top of the Import screen choose **Transactions** or **Hisaab Ledger**, then tap **Download CSV Template**. The template has sample rows showing each kind of entry.

## Transactions template - columns

One row per transaction. Only **Date** and **Amount** are required.

- **Date** *(required)* - `2026-05-15` or `15/05/2026`.
- **Type** - `Expense`, `Committed`, `Credit` or `Transfer`, the same four as the Transactions tab. Blank means Expense.
- **Amount** *(required)* - a positive number. The Type decides the direction, so don't put a minus sign.
- **Description**, **Merchant** *(optional)* - free text.
- **Category** *(optional)* - matched to your categories by name. A name Arth doesn't have is created.
- **Payment Mode** *(optional, spending only)* - matched by name; a new one is created.
- **Account** *(optional)* - the account the money left, or for a credit, arrived in. Use the account's name or its last 4 digits. Arth never creates accounts from an import: a row naming an account it can't find is left out.
- **To Account** *(transfers only, required)* - the account the money moved to.
- **Credit Type** *(credits only, optional)* - Salary, Interest, Refund, Cashback, Reimbursement, Gift, Investment gain or Other.
- **Linked To** *(committed only, required)* - the loan (for an EMI) or the investment bucket (for a SIP) the payment belongs to, by name.
- **Right Spend** *(spending only, optional)* - `Yes` or `No`.

### What "Committed" means

Committed is spending that is tied to a loan or an investment bucket, as on the Transactions tab. On import the payment is saved as spending and then linked. An EMI links when the loan has an instalment of about that amount due around that date; a SIP links to the bucket of that financial year. If the link can't be made, the payment is still imported as an expense and the result screen tells you which rows weren't linked.

## Hisaab template - columns

- **Person** *(required)* - name of the hisaab person. New names are created.
- **Date** *(required, except for initial_balance)*.
- **Amount** *(required)*.
- **Type** *(required)* - `debit` (they owe you more), `credit` (they paid you back), `settlement`, or `initial_balance` (sets the person's opening balance; may be negative).
- **Description**, **Category**, **Merchant** *(optional)*. Files with only the first five columns still import.

## Step 2 - Run the import

1. Tap **Choose File** and select your Excel / CSV.
2. If the file has multiple sheets, pick the sheet to import.
3. The **Preview** shows how many of each type will be imported with totals, and every row that will be left out with its reason (unreadable date, unknown account, transfer missing an account, and so on).
4. Fix the sheet and re-pick if needed, then tap **Import**.

## Importing the same file twice

Rows Arth already has are left out, so re-importing a file doesn't double anything. A transaction counts as the same when its type, date, amount and merchant (or description) match; a transfer when its date, amount and two accounts match. Hisaab entries are compared per person by date, amount and type.

## What happens after import

All imported rows are saved **as approved transactions** - they do **not** go through the Review Queue. They are saved the same way as ones you add by hand, so account balances update and your smart rules apply. They're marked as manually entered so they're distinguishable from SMS-detected ones.

## Undo

There's no one-click undo for a bulk import. Your options:

- If the import is wildly wrong, use **Settings tab → Backup and Data → Permanently delete data → pick a date range** to bulk-delete everything you just imported.
- For individual rows, standard delete works - they go to the recycle bin for 30 days.

## Common situations

**My sheet says "Food" but my category is "Food & Groceries".** Close names are matched for you: a name contained in an existing category's name (or differing only by a final "s") uses that category. Anything else is created as a new category, which you can merge later via Settings tab → Data Management → Categories.

**I imported from Axio / Walnut / Money Manager.** Export as CSV from the source app, then map columns to Arth's template. A few minutes of spreadsheet work.

**Dates look weird after import.** Almost always an Excel auto-formatting issue. Open the date column in Excel, format as `YYYY-MM-DD`, re-save.

**Can I import 10,000 rows?** One sheet is read up to 5,000 rows; split a bigger file into several. Large imports take a minute or two.

## Related

- [The review queue](review-queue) - Uncategorized filter helps clean up bulk-imported rows
- [Auto-categorize with smart rules](smart-rules) - rules catch future imports
