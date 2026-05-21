---
title: Importing from Excel
slug: excel-import
summary: Bulk-import expenses, credits, and hisaab entries from a spreadsheet using Arth's templates.
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

Bulk-load expenses, credits (salary / refunds), or hisaab entries from an Excel or CSV file. Useful when migrating from another tracker or bringing in historical data.

## Where to find it

**Settings tab → Import & Config → Import from Excel.**

## Supported files

- `.xlsx`, `.xls`, `.csv`
- Google Sheets — download as Excel (`.xlsx`) first.
- Multi-sheet files are fine — Arth asks which sheet to import.

## Step 1 — Get the template

On the Import screen, tap **Download Template** and pick one of three:

- **Expenses**
- **Credits**
- **Hisaab**

Each template has its own expected columns. Fill in the sheet following the columns below.

## Expenses template — columns

- **Date** *(required)* — format must be `YYYY-MM-DD`.
- **Amount** *(required)* — a positive number. Direction is "expense", so don't put a minus sign.
- **Merchant** *(recommended)* — free text. Blank is allowed but makes the row hard to identify later.
- **Description** *(optional)* — free text.
- **Category** *(required)* — must match an existing category name **exactly** (case-sensitive). Create missing categories first in Settings tab → Master Data → Categories.
- **Payment Mode** *(optional)* — matches a configured payment mode (e.g. "UPI", "Credit Card", "Cash").
- **Account** *(optional)* — matches a configured account name (e.g. "HDFC Savings").
- **Right Spend** *(optional)* — `1` for unavoidable, `0` for discretionary.

## Credits template — columns

Similar to expenses, but:

- **Type** *(required)* — `salary`, `refund`, or `other`.
- **Category** — not required.

## Hisaab template — columns

- **Person** *(required)* — name of the hisaab person.
- **Date** *(required)* — `YYYY-MM-DD`.
- **Amount** *(required)* — positive number.
- **Direction** *(required)* — `they-owe` or `i-owe`.
- **Description** *(optional)*.

## Step 2 — Fill the sheet

- Dates must be `YYYY-MM-DD`. Excel often reformats automatically — if in doubt, open the cell and type the date explicitly.
- Amounts are positive. Direction is inferred from the column semantics, not the sign.
- Category names must match your existing categories exactly. Create missing ones first, or adjust the sheet to use existing names.

## Step 3 — Run the import

1. Tap **Pick File** → select your Excel / CSV.
2. If the file has multiple sheets, pick the sheet to import.
3. The **Preview** page shows: total rows found, accepted, skipped (and why), plus sample rows.
4. Review. If skipped rows outnumber accepted, fix the sheet and re-pick.
5. Tap **Import**. Progress is shown. A summary appears when done.

## What happens after import

All imported rows land in your ledger **as approved expenses** — they do **not** go through the Review Queue. They're marked as manually entered so they're distinguishable from SMS-detected expenses.

## Undo

There's no one-click undo for a bulk import. Your options:

- If the import is wildly wrong, use **Settings tab → Backup & Storage → Clean Up Data → pick a date range** to bulk-delete everything you just imported.
- For individual rows, standard delete works — they go to the recycle bin for 30 days.

## Common situations

**Category "Food" doesn't match — my category is "Food & Groceries".** Update the sheet's category column to `Food & Groceries` exactly, OR create a `Food` category first and merge it into `Food & Groceries` later via Settings tab → Master Data → Categories.

**I imported from Axio / Walnut / Money Manager.** Export as CSV from the source app, then map columns to Arth's template. A few minutes of spreadsheet work.

**Dates look weird after import.** Almost always an Excel auto-formatting issue. Open the date column in Excel, format as `YYYY-MM-DD`, re-save.

**Can I import 10,000 rows?** Yes, but it'll take a minute or two and use memory. For very large imports, split into chunks of 2,000–3,000 rows.

## Related

- [The review queue](review-queue) — Uncategorized filter helps clean up bulk-imported rows
- [Auto-categorize with smart rules](smart-rules) — rules catch future imports
