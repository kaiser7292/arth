# Fix my data: AI corrections across the whole app

Status: built; ships in the next release. Code: `services/corrections/`, screen `app/settings/fix-my-data.tsx`,
tests `__tests__/integration/corrections.test.ts`. Related: `AI_EXPORT_PROPOSAL.md`, `AI_SUGGESTIONS_PROPOSAL.md`.

## Why

Export for AI Insights was built for getting started: categories, budgets, rules, goals. After
months of use the problems are different. The same merchant is spelled five ways and filed under
three categories; a transfer between your own accounts counts as spending and income; a refund
isn't linked to its purchase; an account's balance drifts from what the bank says; a credit card
was guessed as a savings account. Each is small; together they make every figure in the app a
little wrong: budgets, savings rate, yearly plan, goals, balances, net worth.

Fix my data gives the user's own AI assistant the whole history, asks it to find what's
inconsistent or doesn't add up, and takes back a correction file that Arth applies everywhere,
with every downstream figure following.

## The flow

1. **Data health** (Settings → Fix my data). Arth checks the data itself, on the phone, with no AI:
   uncategorised entries, entries with no account, possible duplicates, transfers counted as
   spending, refunds not linked, unsorted redemptions, SIPs not linked to a bucket, balances that
   differ from the bank's own figure, accounts whose type looks wrong, merchant names spelled
   several ways, merchants filed under more than one category, long-overdue dues. A tidy score
   sums it up. Rows open the screen that fixes them by hand; a bank-balance gap can be matched in
   one tap.
2. **Export.** One file with the whole history (every transaction with a reference, its account,
   payment mode, category, tags, links), Arth's own figures (balances by month, budgets, loans,
   investments, net worth, plan), the consistency tables Arth works out (merchant variants and the
   categories and modes each was given) and every mismatch from step 1. Plus the correction format.
3. **The user's AI replies** with a correction file: `{"corrections": [ ... ]}`.
4. **Review.** Arth reads the reply, checks every item (references must repeat the row's date and
   amount, names must exist, changes must make sense), drops what's wrong or already true, and
   lists the rest in groups, ticked. Nothing has changed yet.
5. **Apply.** A snapshot of all data is taken first. Corrections are applied in dependency order,
   each through the same service the app's own screens use, so every side effect happens the way
   it does when a person makes the change. Figures are measured before and after.
6. **Impact report.** What changed, in the app's own numbers: balances, this year's income,
   spending, investing and savings rate, this month's spending, uncategorised count, merchant
   spellings, health score. **Undo** puts back the snapshot.

## Correction format (`arth-corrections/1`)

Transactions are named by `ref` (from the export) and must repeat `date` and `amount`. Accounts
by their `fix_ref` from `accounts_for_fixes`. Goals, buckets, categories and payment modes by name.

| Type | Fields | Applied with |
|---|---|---|
| `set_account_type` | `account`, `account_type` (savings, credit_card, wallet, loan) | `updateAccountType` |
| `mark_duplicate` | `ref`, `date`, `amount`, `same_as_ref`, `same_as_date`, `same_as_amount` | `deleteExpense` (Recycle Bin) |
| `mark_transfer` | `ref`, `date`, `amount`, `other_account` | debit: `convertDebitToTransfer`; credit: `reclassifyCreditAsTransfer` |
| `link_refund` | `ref` (the credit), `date`, `amount`, `purchase_ref`, `purchase_date`, `purchase_amount` | `linkCreditAsRefund` |
| `move_account` | `ref`, `date`, `amount`, `account` | `updateExpense` (account_id) |
| `set_merchant` | `ref`, `date`, `amount`, `merchant` | `updateExpense` |
| `set_payment_mode` | `ref`, `date`, `amount`, `payment_mode` | `updateExpense` |
| `set_spend_type` | `ref`, `date`, `amount`, `unavoidable` (true/false) | `updateExpense` (is_right_spend) |
| `set_income_type` | `ref`, `date`, `amount`, `income_type` | `updateExpense` (credit_kind) |
| `mark_redemption` | `ref`, `date`, `amount` | `setMoneyEvent('investment_withdrawal')` |
| `link_to_bucket` | `ref`, `date`, `amount`, `bucket` | `linkExpenseToBucket` |
| `adjust_balance` | `account`, `balance` | `adjustAccountAvailable` (a visible adjustment, this month) |
| `update_goal` | `goal`, `target_amount`?, `target_date`? | `updateLifeMilestone` |

Also accepted, read and applied by the existing suggestions code: `add_category`, `fix_merchant`,
`merchant_category`, `recategorise`, `add_rule`, `set_budget`, `set_savings_target`,
`add_investment_bucket`, `add_milestone`.

Never accepted: changing an amount or a date, or deleting anything outright. A duplicate goes to
the Recycle Bin. At most 2,000 corrections per reply.

## Apply order

Each step can depend on the ones before it:

1. Account types (later checks read the type)
2. Duplicates (so a duplicate isn't then made a transfer)
3. Transfers, refunds, account moves (the structure)
4. Categories, merchant names, merchant categories, single re-categorisations
5. Merchant, payment mode, spend type, income type on single entries
6. Investment buckets, then redemptions and bucket links
7. Balance adjustments (after every movement is in place, so the gap measured is the real one)
8. Budgets, savings target, goals
9. Rules (last, so they're about the corrected data and keep it that way)

## Downstream effects

Budgets, spending, the yearly plan's actuals, savings rate, net worth and goal progress are
computed from transactions, so they follow once the transactions are right. The balance chain
re-anchors every month that isn't a manual opening on the next read. Bucket contributions move
with `linkExpenseToBucket`. Every write bumps the data version, so open screens reload.

## Safety

- The reply is untrusted text. It is parsed item by item, checked against the data, and nothing
  happens on reading.
- Every item is shown before applying, and can be unticked.
- A full snapshot (every backed-up table and setting) is written before applying; Undo restores it
  through the same path as a backup restore. One undo is kept: the latest correction.
- What was applied is listed; anything that failed is listed with the reason, and the rest still
  applies.
- The export leaves out SMS text, the vault, account numbers beyond the last 4 digits and
  credentials, as Export for AI always has. Names of people are left out unless the user turns
  them on.

## Size

A year of history is a few thousand rows, which assistants read as an upload. The file puts the
guide, the health findings and the consistency tables first, so an assistant reading only part of
it still sees what matters.
