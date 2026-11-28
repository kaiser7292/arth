---
title: Investments and fixed deposits
slug: investments
summary: One place for every investment - demat, pension (EPF / NPS / PPF) and fixed deposits - with an allocation chart, idle cash, an FD ladder of when money comes back, and automatic FD closing when the payout arrives.
tags: [investments, fixed deposit, FD, deposit, demat, pension, EPF, NPS, PPF, maturity, interest, TDS, portfolio, allocation, net worth]
contextKeys: [investments, investments-add, add-fd, home-investments]
phrasings:
  - How do I add a fixed deposit?
  - Track my FD in Arth
  - Where are my investments?
  - Investments card on home
  - Mark as fixed deposit
  - I booked an FD from my savings account
  - FD maturity
  - What happens when my FD matures?
  - FD interest is different from what Arth calculated
  - TDS on FD interest
  - FD still showing after maturity
  - Rate and maturity not set
  - Undo fixed deposit
  - FD auto renewal
  - Renew FD principal and interest
  - FD term in days
  - How does Arth calculate FD interest?
  - Add a pension account
  - Add EPF NPS PPF
  - Add a demat account
  - Investment allocation chart
  - Upcoming maturities
  - When do my FDs mature?
  - Idle cash in demat
  - Link FD to investment bucket
  - Where did the Demat and Pension cards go?
---

The **Investments** screen brings every kind of investment together - demat and broker accounts, pension accounts like EPF / NPS / PPF, and fixed deposits - so you can see what you hold in one place instead of adding up separate cards in your head.

## Where to find it

- **Home tab → Investments card.** Shows the total value with a breakdown by type (e.g. "Equity · EPF · FD"). Tap it to open the Investments screen.
- The Investments card replaces the older separate **Demat** and **Pension** cards. If you had hidden either of those, the new card stays hidden too - turn it back on from Settings tab → Preferences & Security → Home Cards.

## The Investments screen

- **Allocation chart** - a donut split across **Fixed Deposits**, **Market (Demat)** and **Pension**. Tap a slice to jump to that section.
- **At a glance** - Value now, Idle cash, what comes back in the next 90 days, and FD interest still to come. Tap one to see that part.
- **Idle cash** - cash in each demat account that isn't invested yet, with the date of that figure (the last sync or update).
- **Fixed deposits** - all your FDs as one card: how many, the total, the average rate and when money next comes back. They're grouped by when they mature (this month, the next 3 months, 3–12 months, later): tap a group to see its FDs. An FD past its date that's still open asks whether you renewed or closed it. Underneath, a bar for each of the next 12 months shows how much comes back.
- **Accounts** - grouped by type with each group's total and share; groups fold once you have more than 5 accounts. With 8 or more you can search them and group them by institution instead. Tap a demat account for its portfolio details, a pension account for its contributions, or an FD for its details and ledger.

Fixed deposits that have matured or been closed drop off this screen and out of the Investments total, so the payout is never counted twice.

## Sync, and see how it moved

Tap **Sync** next to your total on the Investments screen. Zerodha, Angel One and Zebpay fetch on their own. For anything else, like an account you track by hand, Arth asks for its holdings value and idle funds, filled in from the last time. Change what's changed or carry on; clear both boxes to skip one. You can sync as often as you like: a new sync the same day replaces that day's values.

You then see how much your investments went up or down since their last value, all together and one by one. Money you moved in or out in that time isn't counted as a gain or a loss. Anything you skipped is left out and says so. Fixed deposits and pension aren't included, because they don't change with the market each day.

Zerodha's login ends every day, so when it has, tap **Log in**: its login page opens, filled from the Vault if you've linked it, and the sync carries on when you're back.

## Where could this get to?

**Projections**, next to your total, works forward from what each investment is worth today. Tap one to set the yearly return you want to assume, a monthly amount (a SIP), a yearly step-up and any one-time amounts. **Invest more** tries the same with money that isn't in any investment yet. It then lists what you set up, what you'd put in and what it adds.

**In today's money** shows what the future amount could really buy after inflation. Tap it to change the inflation rate (6% a year to start with). Tap a year's bar to read that year.

A 12% return here means exactly 12% a year. Many online calculators use 1% a month, which works out to 12.68%, so they show a little more. These are your assumptions worked forward, not a forecast or financial advice: real returns go up and down, and tax isn't taken off.

## Three kinds of investment

When you tap **+** (Add investment) on the Investments screen, you pick one of three kinds. Each works out its value differently:

- **Equity / Mutual Fund / Gold** (demat or broker account) - the value comes from **snapshots** you record, or that a broker connection saves for you. See [Zerodha Kite](kite-connect), [Angel One](angel-one) or [Zebpay](zebpay).
- **EPF / NPS / PPF** (pension or retirement account) - the value is your **running contributions**, worked out just like a savings balance from the credits that land in it.
- **Fixed Deposit** - principal, interest rate and maturity date. The value is **computed** from those.

## Add a fixed deposit

There are two ways.

### From the transaction (quickest)

When you book an FD, your bank usually sends a debit SMS from your savings account. Turn that debit straight into the FD:

1. Open the debit (Transactions tab → tap it).
2. Tap **Mark as fixed deposit**.
3. Amount, date and funding account are already filled in. Pick the **bank** (or **Other** to type one), add the **FD account / receipt number**, and a **name** for the deposit so you can tell FDs apart.
4. Optionally add the **interest rate** and **maturity date** (or the term) now - or leave them blank and fill them in later. Choose what happens **at maturity** too.
5. Save. The debit becomes the transfer that funded the FD - it no longer counts as spending.

If you skip the rate and maturity, the FD shows **Rate & maturity not set** on the Investments screen, and its detail screen offers **Add interest rate & maturity date**.

### From the Investments screen

1. Investments screen → **+** → **Fixed Deposit**, or Settings → Accounts → **Add account** → **Fixed deposit** (the form opens on the same page).
2. Pick the **bank** - the banks you already have accounts with are listed, or tap **Other** to type a name. Add the FD account / receipt number, principal, interest rate, and **Simple** or **Compound** interest (Monthly / Quarterly / Annually).
3. Set the start date and when it **matures**: tap **Date** to pick the maturity date, or **Term** to type it as years / months / days (for example 0 / 0 / 400 for a 400-day FD). Arth shows the other one underneath.
4. Pick **Funded from / pays back to** - the savings account the money came from and will return to.
5. Choose what happens **at maturity**: **No auto-renew**, **Renew principal only**, or **Renew principal + interest**.
6. Tap **Save fixed deposit**.

Arth shows the maturity amount and interest as you type. If your FD receipt shows a different figure, tap **Bank's figure differs? Correct it** and enter the receipt's maturity amount or interest.

### How Arth works out the interest

The same way Indian banks do: deposits under 6 months earn simple interest. Longer ones compound once every completed quarter from the start date, and the days left over after the last full quarter earn simple interest. The year counts as 365 days. Interest is rounded to the rupee. A small difference can still remain if your bank counts 366 days in a leap year or deducts TDS - correct the figure if so.

You can also link the FD to a yearly-plan **investment bucket** - pick it under **Count towards investment bucket** when you add the FD, or later from the FD's details. The deposit counts towards the bucket, and a withdrawal is recorded in the bucket when the FD matures.

> An FD account / receipt number is required. It's how Arth tells apart several FDs at the same bank. Letters are allowed.

## When an FD matures

What happens depends on the **at maturity** choice.

### Renewing FDs

- **Renew principal only** - the interest is queued as a credit on the funding account for you to review (or your bank's own interest SMS is used, even net of TDS). The principal stays in the FD, which starts again on the maturity date for the same term.
- **Renew principal + interest** - nothing comes to your bank account. The interest is added inside the FD (as a credit to review), and the whole maturity amount is deposited again for the same term.

Banks renew at their rate on the day, which Arth can't know, so a renewed FD keeps the old rate. Its edit screen says it was renewed; enter the new rate there if it changed. If you close a renewed FD at the bank instead, mark the payout credit with **Close FD**, as for any FD. You can change the at-maturity choice in the FD's edit screen until it matures.

### No auto-renew

Arth doesn't move money on its own. At maturity:

1. A **pending credit** for the maturity amount is queued on the funding savings account, in your Review Queue.
2. When your bank's real credit SMS arrives, Arth matches it to the FD and **replaces its own placeholder** with it, so the money isn't counted twice.
3. Once the payout is approved, Arth marks the FD **matured**, records any bucket withdrawal, and **closes the FD account**.

Arth recognises real-world payouts, including:

- One credit for the full maturity amount.
- Principal and interest credited as **two separate entries**.
- Interest paid **net of TDS** (less than the computed interest).

It looks on the funding account (or any savings account, if none was recorded) from 3 days before to 10 days after the maturity date. A closed FD can be reopened from the account screen if needed.

## Undo a fixed deposit

Open the original debit. It shows a **Fixed Deposit** card with the principal, rate, maturity, status and bucket. Tap **Undo fixed deposit** to turn it back into an ordinary debit.

**Mark as transfer**, **Mark as fixed deposit**, **Mark as investment** and **Mark as loan payment** can't all be used together. One debit can only be one of them - otherwise it would be counted twice.

## In your Net Worth

An FD is money that left a savings account, so on the [Net Worth](balance-sheet) screen it sits **under the savings account that funded it**. Each savings row shows "+₹X deposits" beneath its balance. The emergency-fund figure in the Financial health [report](reports) counts FD money too.

## Common situations

**"My FD matured but it's still showing."** Check the Review Queue for the maturity credit and approve it. If the bank credited principal and interest separately, approve both. The FD closes once every matched credit is approved.

**"The interest credited is less than Arth calculated."** That's usually TDS. Approve the real credit - Arth accepts it as the payout. To make the figures match beforehand, set a maturity amount override on the FD.

**"I have several FDs at one bank."** Give each a distinct receipt number and a clear name.

**"Where do I add a pension account now?"** Investments screen → **+** → **EPF / NPS / PPF**.

**"The FD doesn't appear in the calendar."** Turn on **FD maturities** in [Calendar sync](calendar-sync).

## Related

- [Accounts and balances](accounts)
- [Net Worth](balance-sheet)
- [Recording transfers between accounts](transfers)
- [Yearly Plan and budget](yearly-plan)
- [The review queue](review-queue)
