---
title: Investments and fixed deposits
slug: investments
summary: One place for every investment - demat, pension (EPF / NPS / PPF) and fixed deposits - with an allocation chart, upcoming FD maturities, and automatic FD closing when the payout arrives.
tags: [investments, fixed deposit, FD, deposit, demat, pension, EPF, NPS, PPF, maturity, interest, TDS, portfolio, allocation, net worth]
contextKeys: [investments, investments-add, add-fd, home-investments]
phrasings:
  - How do I add a fixed deposit?
  - Track my FD in Arth
  - Where are my investments?
  - Investments card on home
  - Mark as Fixed Deposit
  - I booked an FD from my savings account
  - FD maturity
  - What happens when my FD matures?
  - FD interest is different from what Arth calculated
  - TDS on FD interest
  - FD still showing after maturity
  - Rate and maturity not set
  - Undo fixed deposit
  - Add a pension account
  - Add EPF NPS PPF
  - Add a demat account
  - Investment allocation chart
  - Upcoming maturities
  - Link FD to investment bucket
  - Where did the Demat and Pension cards go?
---

The **Investments** screen brings every kind of investment together - demat and broker accounts, pension accounts like EPF / NPS / PPF, and fixed deposits - so you can see what you hold in one place instead of adding up separate cards in your head.

## Where to find it

- **Home tab → Investments card.** Shows the total value with a breakdown by type (e.g. "Equity · EPF · FD"). Tap it to open the Investments screen.
- The Investments card replaces the older separate **Demat** and **Pension** cards. If you had hidden either of those, the new card stays hidden too - turn it back on from Settings tab → Preferences & Security → Home Cards.

## The Investments screen

- **Allocation chart** - a donut split across **Fixed Deposits**, **Market (Demat)** and **Pension**. Tap a slice to jump to that section.
- **Upcoming maturities** - the next fixed deposits due to mature, with dates.
- **Sections with subtotals** - accounts grouped by type. Tap a demat account for its portfolio details, a pension account for its contributions, or an FD for its details and ledger.

Fixed deposits that have matured or been closed drop off this screen and out of the Investments total, so the payout is never counted twice.

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
2. Tap **Mark as Fixed Deposit**.
3. Amount, date and funding account are already filled in. Add the **bank name**, the **FD account / receipt number**, and a **name** for the deposit so you can tell FDs apart.
4. Optionally add the **interest rate** and **maturity date** now - or leave them blank and fill them in later.
5. Save. The debit becomes the transfer that funded the FD - it no longer counts as spending.

If you skip the rate and maturity, the FD shows **Rate & maturity not set** on the Investments screen, and its detail screen offers **Add interest rate & maturity date**.

### From the Investments screen

1. Investments screen → **+** → **Fixed Deposit**.
2. Fill in bank name, FD account / receipt number, principal, interest rate, start and maturity dates, and **Simple** or **Compound** interest (Monthly / Quarterly / Annually).
3. Pick **Funded from / pays back to** - the savings account the money came from and will return to.
4. Tap **Save fixed deposit**.

Arth shows a live preview of the maturity amount as you type. If your bank quotes a different figure, you can enter a **maturity amount override**.

You can also link the FD to a yearly-plan **investment bucket** - pick it under **Count towards investment bucket** when you add the FD, or later from the FD's details. The deposit counts towards the bucket, and a withdrawal is recorded in the bucket when the FD matures.

> An FD account / receipt number is required. It's how Arth tells apart several FDs at the same bank. Letters are allowed.

## When an FD matures

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

Open the original debit. It shows a **Fixed Deposit** card with the principal, rate, maturity, status and bucket. Tap **Undo Fixed Deposit** to turn it back into an ordinary debit.

**Mark as Transfer**, **Mark as Fixed Deposit**, **Mark as Investment** and **Mark as Loan Payment** can't all be used together. One debit can only be one of them - otherwise it would be counted twice.

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
