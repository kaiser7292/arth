---
title: Loans and EMI tracking
slug: loans
summary: How Arth tracks your loans - EMIs, prepayments, manual corrections, and what happens when you pay extra.
tags: [loans, emi, prepayment, foreclosure, amortization, reduce-emi, reduce-tenure, correction, home-loan, personal-loan, auto-loan]
contextKeys: [loan-detail, loan-add, loans-list]
phrasings:
  - How does Arth track my loan?
  - Record a loan prepayment
  - Reduce tenure vs reduce EMI
  - What is a manual correction on a loan?
  - Foreclose a loan
  - Why doesn't my EMI update after prepayment?
  - Small prepayment vs big prepayment
  - Loan amortization schedule
  - Delete a prepayment
  - Edit a prepayment
  - Loan outstanding is wrong
  - Override outstanding principal
  - Override EMI
  - How is interest calculated on a prepayment?
  - Prepayment charges and GST
  - Does my SMS EMI payment auto-update the schedule?
  - Loan shows wrong EMI after I prepaid
  - Loans card in Your Accounts
  - Monthly EMI total on home
  - Total outstanding on home
  - Next EMI due date
---

A **loan** in Arth is a structured obligation with a fixed principal, interest rate, tenure, and monthly EMI. Unlike savings or credit-card accounts where Arth tracks a running balance, a loan tracks an **amortization schedule** - the month-by-month breakdown of how much principal and interest each EMI pays down.

## Where to find them

- **Home tab → Your Accounts → Loans card** - shows total outstanding, monthly EMI, and next EMI due date. Tap to open the full loans list.
- **Goals tab → Loans** - list of all active and closed loans with per-loan outstanding, current EMI, and bank name.
- **Settings tab → Master Data → Accounts** → Loans → tap any loan.

Tapping a loan anywhere routes you to the loan detail screen.

## Adding a loan

**Goals → Loans → + button** opens the Add Loan form. Fill in:

- **Loan type** (Personal, Home, Auto, Education, Business, Gold, Against FD, Other)
- **Bank / Lender** + optional agreement ID
- **Currency** (default INR; non-INR loans skip conversion in totals)
- **Amount approved** (sanctioned) vs **Amount received** (disbursed) - usually the same; sometimes different for home loans disbursed in tranches
- **Disbursement date** + **EMI start date** - Arth handles broken-period interest if these differ
- **EMI day of month** (1–31)
- **Interest rate % p.a.** + **Interest type** (fixed / floating)
- **Tenure (months)** and optional **EMI amount** (auto-computed if left blank)
- **Fees** (processing fee, stamp duty, insurance)
- **Prepayment / Foreclosure rules** from your Key Fact Sheet
- **Late-payment (penal) charges**

If you already paid some EMIs before adding the loan, enter the count in **EMIs paid so far** - Arth backfills those installments as paid so your outstanding matches reality.

## What you see on loan detail

- **Hero card** - Outstanding principal, current EMI (this reflects any EMI reductions from prepayments), progress bar, % paid, principal paid vs disbursed.
- **Manage this loan** - action tiles:
  - **Record Prepayment** (primary button)
  - **Foreclose quote** - preview the total to close the loan today
  - **Manual correction** - override outstanding / EMI / remaining EMIs (see below)
  - **Edit loan details** - change rate, tenure, fees, etc.
  - **Delete loan**
- **Summary** - all the loan parameters.
- **Prepayments** - every recorded prepayment (tap to edit, trash to delete).
- **Manual Corrections** - every manual override (tap to edit, trash to delete).
- **Amortization Schedule** - installment-by-installment breakdown.

## Recording a prepayment

Tap **Record Prepayment** on loan detail. Enter:

- **Amount** (what you're paying extra, on top of your usual EMI)
- **Prepayment date**
- **Strategy** - only shown when the amount is MORE than one EMI:
  - **Reduce Tenure** - EMI stays the same, loan ends earlier (you save more interest this way)
  - **Reduce EMI** - tenure stays the same, every future EMI is smaller

### Small prepayments (≤ one EMI)

When you pay anything up to exactly one EMI extra, Arth uses the **trivial path**: the money just reduces principal, and no strategy choice is offered. The tenure and EMI stay unchanged; the last installment will absorb a small saving. This matches how banks actually process sub-EMI part-payments on statements.

### Prepayment charges

If your loan's Key Fact Sheet specifies a prepayment charge %, Arth applies it to the gross amount (with GST). The net (amount minus charge minus GST) is what actually reduces principal. If your loan has a foreclosure waiver window, Arth detects when it applies.

### After a reduce_emi prepayment

Every scheduled installment from the prepayment date forward gets a new, lower EMI. The loan detail Hero card updates to show this new EMI. Yearly Plan totals recompute from the same updated schedule, so your annual outflow drops accordingly.

## Manual correction

Sometimes the bank's actual outstanding doesn't exactly match Arth's formula - rounding, mid-cycle rate changes, or a prepayment posted through the bank's app that Arth didn't see. **Manual correction** lets you override:

- **Effective date**
- **Outstanding principal** (what the bank says you owe right now)
- **EMI amount** (what you're actually paying)
- **Remaining EMIs** (optional - inferred if blank)
- **Reason** (free-text note to yourself)

From the correction forward, Arth regenerates the amortization using your overridden numbers. Prepayments recorded after a correction apply on top of the corrected baseline. You can edit or delete a correction later; the schedule rebuilds cleanly either way.

## Foreclose quote

Tap **Foreclose quote** to see what it would cost to close the loan today - principal outstanding + accrued interest + foreclosure charge + GST, minus any applicable waiver.

If you want to actually foreclose, use **Record Prepayment** and change the kind to Foreclosure. The loan gets marked closed and the schedule stops.

## Loan accounts in Account Master

Every loan automatically creates a matching entry in **Settings → Master Data → Accounts** (type `Loan`). Tapping that entry routes to the loan detail screen - the loan's amortization schedule is the source of truth, so generic balance-tracking UI (Monthly Balance Ledger, Payment Modes, Bank-Reported Balance) is not shown for loans. You'll see a "View loan details" tile instead.

## SMS auto-detection and EMI matching

When an EMI payment SMS arrives ("Rs 22,317 debited from A/C XXX for EMI …"), Arth tries to match it to the next unpaid installment within ±5 days and ±5% of the expected EMI. When matched, that installment is stamped `paid` automatically. This keeps working after `reduce_emi` prepayments because the SMS amount lines up with the schedule's new (lower) EMI.

## Yearly Plan integration

Active loans feed the **Yearly Plan → Debt Servicing** total - Arth sums every scheduled EMI falling in the FY plus any recorded prepayments within the FY window. This updates automatically when you record a prepayment.

The **Reality Check card** in Yearly Plan includes a **Debt Servicing** section showing how much you have actually paid in EMIs + prepayments year-to-date versus the prorated expected amount, along with a year-end projection. A "behind" status here typically means a scheduled EMI hasn't been marked paid yet — check the amortization schedule on the loan detail screen.

The **YoY Comparison** view has a dedicated **Loans & Debts** category. Row direction is "lower is better" (shrinking outflow year-over-year = good), but the plan-vs-actual gap inverts: paying MORE than planned is treated as GOOD (faster debt payoff).

## Editing and deleting

- **Edit a prepayment** - tap the row. Amount, date, and strategy can change; schedule regenerates.
- **Delete a prepayment** - tap the trash icon. Schedule regenerates as if the prepayment never happened. Deleting a foreclosure reopens the loan.
- **Edit a correction** - same as prepayment, via the row tap.
- **Delete a correction** - trash icon. Downstream prepayments reapply on top of the pre-correction baseline.
- **Edit loan details** - opens the Add Loan form pre-filled; changing rate/tenure/EMI regenerates the schedule (paid installments preserved).
- **Delete a loan** - removes everything: schedule, prepayments, corrections, and the Account Master entry. Expenses you linked as EMIs or prepayments stay as regular expenses, just unlinked.

## Common situations

- **"My EMI is wrong after prepayment."** If you chose Reduce EMI, the Hero card should show the new (lower) EMI. If it still shows the old amount, the prepayment might have been recorded with Reduce Tenure (tenure drops, EMI stays same). Check the prepayment row's strategy pill.
- **"Outstanding is off by a few thousand."** Indian banks round everything to ₹1; Arth's INR loans use rupee rounding too. Small drift from a rate reset or mid-cycle change? Use Manual Correction to realign.
- **"I paid my bank directly without recording in Arth."** Record a prepayment with today's date - or use Manual Correction to set the new outstanding.
- **"I deleted a paid EMI expense - did the schedule unpaid too?"** Yes. Deleting the linked expense reverts its installment to `scheduled`.

## Non-goals

Arth does not:
- Fetch your actual loan balance from the bank via API (no bank integration).
- Auto-detect out-of-band prepayments from SMS (a "Rs 1,00,000 debited… loan" with no EMI keyword is matched as a transfer or expense, not as a prepayment). You record prepayments yourself.
- Handle partial-month interest on manual corrections (the tail regenerates using monthly compounding from the correction date).
