---
title: Hisaab - shared accounts with people
slug: hisaab
summary: Track who owes whom for splits, loans, and shared expenses. Separate from your bank accounts.
tags: [hisaab, split, shared, family, friends, loan, settle, settlement]
contextKeys: [hisaab-tab, hisaab-person, expense-split, credit-detail]
phrasings:
  - What is hisaab?
  - Track money lent to a friend
  - Split an expense with someone
  - How do I settle with a friend?
  - Mom owes me money
  - Shared account with family
  - Who owes whom
  - Record a loan to a friend
  - Settle up
  - Hisaab balance is wrong
  - Hisaab export Excel PDF
  - Mark credit as settlement
  - UPI payment from friend settle hisaab
  - Link incoming credit to hisaab person
  - Vinay paid me back
---

Hisaab (हिसाब) tracks money between you and specific people - family, roommates, friends. Each person is a separate running balance.

## Where to find it

- **Home tab → People & Money → Hisaab - Family Ledger** card.
- Tap it to open the people list. Each person shows their current balance (+ owes you / − you owe).
- Tap a person → their ledger (entries + settlements + running balance).

## The model

For every person you have a hisaab with:

- Each entry is either **they owe you** (you paid or lent) or **you owe them** (they paid for you).
- A running balance is shown at the top of the person's ledger.
- **Settlement** entries zero out or reduce the balance when money actually changes hands.

## Add a person

1. Home tab → Hisaab card → tap **+**.
2. Fill: name, optional phone number (used to flag duplicate splits).
3. Tap **Save**.

## Split an expense with someone

The available **split modes** are:

- **Equal 50-50** - the amount is split evenly.
- **They owe full** - you paid, they owe all of it.
- **I owe full** - they paid, you owe all of it.
- **Exact amount** - custom, e.g. "they owe ₹400 of ₹1,000".
- **Percentage** - custom, e.g. "they owe 30%".

To create the split:

1. Tap **+** → **Add Expense** (or open an existing one).
2. Tap **Split with person**.
3. Pick a hisaab person.
4. Pick a split mode from the list above.
5. Tap **Save**.

Arth then does the book-keeping automatically:

- Your share goes into your budget.
- Their share becomes a hisaab entry - "they owe ₹X".
- If they paid (I owe), the entire expense amount becomes a hisaab entry the other way.

## Settle up (two ways)

### Option A - record settlement from the person's ledger

When money moves and you want to log it manually:

1. Home tab → Hisaab card → tap the person.
2. Tap **Settle** (top-right).
3. Enter the amount + date + optionally the account the money landed in.
4. Save.

The settlement shows up in the ledger and nets the balance down. If you picked an account, Arth also records a credit on that account to keep your balances honest.

### Option B - mark an existing credit as a settlement

When you see an incoming credit (a UPI payment SMS, a bank transfer notification) that was actually a friend paying you back:

1. Open the credit from the Transactions tab.
2. Tap **Mark as Settlement**.
3. Pick the hisaab person from the list (people who currently owe you are listed first).

The credit stays as-is on your account ledger, and a settlement entry appears in the person's hisaab ledger with the same amount and date. The expense detail now shows **Settlement from [person]** with a "View ledger" button.

**Unlink** - tap Unlink on that badge to remove the hisaab link. The credit stays (it's a real bank transaction); only the settlement entry is removed.

This is available for any realized credit on a savings, wallet, or loan account. Credit-card credits are always bill-payment or refund, so the action is hidden there.

## Export

Home tab → Hisaab card → tap the person → menu → **Export Excel / Export PDF.** Share via Android share sheet.

Export contains: every entry with date, amount, description, direction, running balance, and settlements.

## Common situations

**"The balance is wrong."**
Open the ledger and scan the entries top-to-bottom. Usually a split was logged with the wrong mode (they owe vs I owe flipped). Delete the wrong entry and redo.

**"I want to track our shared household expenses separately from personal lending."**
Create one hisaab person for "Household" (you + spouse) and another for "Monika" (a friend you lent ₹5k to). Separate ledgers, separate running balances.

**"Delete a person."**
Home tab → Hisaab card → tap the person → **Delete**. Any hisaab entries (and their linked expenses) are removed or unlinked per the confirm prompt.

**"My spouse and I share money - do we need hisaab?"**
Only if you want to see who-paid-what. If you pool everything, you don't need hisaab - you can instead add both your salaries and log all expenses normally.

**"I marked a credit as settlement but actually it was a refund from a merchant."**
Open the credit → **Unlink** on the settlement badge. The hisaab entry goes away; the credit stays. Then tap "Mark as CC Bill Payment" or whatever the correct classification is.

## Related

- How split-tender (multi-card) differs from hisaab-split: [Split-tender purchases](split-tender)
- Adjusting a hisaab balance after the fact: [Reconciling a ledger](reconciliation)
