---
title: Reminders for recurring payments
slug: reminders
summary: Track bills, EMIs, and subscriptions that repeat. You confirm the real amount each cycle - no silent pre-filling.
tags: [reminders, recurring, bills, emi, subscriptions, rent, rules, upcoming, dues, fixed-spend]
contextKeys: [home-reminders, reminder-detail, expense-detail, settings-recurring]
phrasings:
  - How do reminders work?
  - Set up a recurring payment
  - Netflix every month
  - EMI reminder
  - Rent reminder
  - How do I mark a reminder as paid?
  - Link an expense to a reminder
  - Stop a reminder
  - I already paid but the reminder still shows due
  - Why did the amount stay blank on the reminder?
  - Difference between forecast and reminder
  - Don't see my upcoming bill
  - Reminder is not disappearing after payment
  - UI reminders card
  - UI upcoming dues
  - Home tab reminders card
  - Set reminder button
  - Stop reminder button
  - Reminder sheet calendar picker
  - Reminder start date suggestion
  - Reminders list screen
---

Reminders track bills that come back regularly - Netflix, rent, EMIs, insurance premiums, utility bills. Arth reminds you when one is coming up, and lets you link the real expense (with the real amount) when it actually happens.

> Reminders do NOT auto-create expenses with guessed amounts. Rent varies, utilities vary, even subscriptions change. You confirm the amount each cycle.

## Where to find reminders

- **Home tab → Reminders card** - what's due soon or overdue.
- **Settings tab → Automation → Reminders** - the full list of active reminders.

## Create a reminder

Reminders are always created **from an expense you just paid**. This lets Arth remember the merchant, category, account, and payment mode - so next cycle's entry is already halfway filled out.

1. Open the expense you just paid - Transactions tab → tap it.
2. Tap **Set reminder**.
3. Pick:
   - **Repeats** - Weekly / Monthly / Quarterly / Yearly.
   - **Starts** - a calendar date picker. Arth suggests the next cycle's start (e.g. for Monthly, one month from the expense date). Tap to change.
   - **Until** *(optional)* - a calendar date picker. Leave blank for open-ended.
   - **Notes** *(optional)*.
4. Tap **Save reminder**.

Arth uses this expense as the **source** - it remembers the merchant, category, account, payment mode, and description. These get pre-filled when you log the next cycle. The amount stays blank, so you type the real value each time.

## When a reminder is due

Reminders appear on the Home card as **Due Soon** (≤ 3 days) or **Overdue**. Each has two buttons: **Skip** and **Link**.

**Skip** — you consciously chose not to pay this cycle (e.g. you paused a subscription, paid it through another channel, or it isn't relevant this month). Tapping Skip advances the due date by one cycle without recording a payment. The reminder returns next cycle.

**Link** — you paid and want to record it. Tap **Link** → two options:

- **Pick an existing expense.** If you already logged the payment (e.g. the SMS came in), pick that expense from the list of recent same-merchant expenses. It becomes the fulfillment, and the reminder's next due date advances.
- **Log new expense.** Opens the Add Expense screen pre-filled with everything except the amount. You type the amount. On save, the expense is linked to the reminder and the next due date advances.

## Advance semantics

The next due date advances from the **cycle's due date**, not from today. So if rent is due on the 1st and you pay late on the 5th, next month's due date is still the 1st - not the 5th. Consistent late payers don't see their cadence drift.

## The "Fulfilled" badge

Open an expense that's already linked to a reminder - it shows a **Fulfilled a recurring reminder** row with an **Undo** action. Undo rewinds the reminder's next-due by one cycle.

## Suggested-reminder banner

Open a realized expense that isn't yet linked. If Arth sees a pending reminder matching its merchant within ±7 days, a soft "Link to a reminder?" banner appears at the top of the expense detail. Tap **Link** to fulfill it, or **Dismiss** to ignore the suggestion for this session.

## Stop a reminder

Two ways:

- **Settings tab → Automation → Reminders → tap the rule → Stop.**
- **On the source expense → Stop reminder.**

Stopping doesn't delete history - every past fulfillment stays in your ledger.

## Common situations

**I paid rent but the reminder still says overdue.** The rent expense may already be in your ledger but not linked. Open the reminder → **Link** → pick the existing rent expense from the list.

**The reminder amount is blank. Why?** Deliberately. Utility bills change every month; using last month's amount silently would be wrong. You type it.

**Reminder for a bill that's already done this year (one-off EMI payoff).** Stop the reminder. Any future cycles won't appear.

**Difference between a reminder and a forecast.** Reminders replaced an older approach where Arth silently pre-created expenses with guessed amounts. Now nothing auto-creates; you confirm the actual amount when you log the expense. Reminder fulfillments are real expenses you logged, not guesses.

**Keyboard covers the Notes field on the reminder sheet.** The sheet scrolls and both the Starts and Until fields are calendar pickers - you won't need to type dates.

## Related

- [The review queue](review-queue)
- [Hisaab - shared accounts](hisaab)
