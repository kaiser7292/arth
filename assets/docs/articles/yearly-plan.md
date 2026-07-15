---
title: Yearly Plan and budget
slug: yearly-plan
summary: Plan your annual income, spending, investments, and loan EMIs. The Reality Check card shows how your actual numbers compare to your plan mid-year.
tags: [yearly plan, budget, savings, investments, milestones, debt, EMI, reality check, fiscal year, income, outflow, surplus, projection]
contextKeys: [yearly-plan, goals-tab]
phrasings:
  - How does the yearly plan work?
  - How is the yearly plan calculated?
  - What is the Reality Check card?
  - Planned vs actual spending
  - Year-end projection
  - How is surplus calculated?
  - What counts as income in the yearly plan?
  - Why is my projected surplus wrong?
  - Debt servicing in the yearly plan
  - Expected vs actual investments
  - Yearly plan income vs outflow
  - Annual budget
  - What is FY budget?
  - Why does Reality Check say I'm behind?
---

The **Yearly Plan** screen (Goals tab → open automatically, or tap the Financial Health card) shows a single-screen view of your entire fiscal year: income, planned outflows, and how your actual numbers compare to the plan so far.

## Where to find it

**Goals tab → Financial Health card → tap anywhere** → Yearly Plan.

Or use **Goals tab → Yearly Plan** if it appears as a direct card.

The screen respects your fiscal year setting (default: April–March). Use the period navigator at the top to switch to a previous FY.

---

## Plan Summary card

Shows the high-level income vs outflow picture for the full FY:

| Row | What it is |
|-----|-----------|
| **Gross Income** | Annual salary / income as set in the Income Calculator |
| **Taxes** | Estimated tax liability based on your income and savings profile |
| **In-Hand** | Gross minus taxes — what you actually receive |
| **Expenses** | Planned annual spending across all budget categories |
| **Investments** | Total target contributions to Investment Buckets for the FY |
| **Milestones** | Annual milestone contributions |
| **Debt Servicing** | Total EMIs + prepayments due across all active loans this FY |
| **Surplus / Deficit** | In-Hand minus all outflows; positive = achievable plan, negative = deficit |

A green "Plan is achievable" or amber "Plan has a deficit" badge at the bottom summarises at a glance.

---

## Reality Check card

Compares your **actual YTD** (year-to-date) numbers against what was **expected by now** given how many months of the FY have elapsed. Appears only when at least one month of the FY has passed.

### How it works

For each category, Arth computes:

- **Expected so far** = (Annual plan / 12) × months elapsed
- **Actual** = real transactions recorded for the same period
- **Status pill** = on track / ahead / behind compared to the prorated expected figure

### Category sections

Each category gets its own block with full amounts, a year-end projection, and a correction hint:

**Expenses** — are you spending more or less than planned?
- *Ahead* (lower cost): spending less than the prorated target; year-end projection < plan.
- *Behind* (higher cost): overspending; correction hint shows how much to cut per month to close the gap.

**Investments** — are your bucket contributions on pace?
- *Ahead*: contributing more than expected; on pace for a larger FY total.
- *Behind*: under-contributing; correction hint shows the monthly catch-up amount.

**Milestones** — are milestone contributions on pace?
- Same logic as investments.

**Debt Servicing** — are you paying your EMIs and prepayments on schedule?
- Compares EMIs paid so far (from the amortization schedule + recorded prepayments) against the prorated annual total.
- *Under* expected: could indicate a missed EMI — check the loan detail.
- *Over* expected: you made a prepayment or had a higher-than-usual instalment.

### Year-end projection

Each block shows a projection box: at your current pace, what will the full-year total be? A projection much higher than planned (expenses) or much lower than planned (investments) indicates the gap is widening.

### Projected Surplus

At the bottom of the card, a single "Projected Surplus" line shows:

```
Projected = Projected Income − Projected Expenses − Projected Investments
           − Projected Milestones − Projected Debt Servicing
```

Compared against the planned surplus so you can see at a glance whether the year will end better or worse than planned.

### Past FY (Year-End Review)

When viewing a completed fiscal year, the card title changes to "Year-End Review". The "Expected so far" column becomes "Planned" (the annual target), and "Actual" is the full-year outcome. No projection box is shown — the year is done.

---

## Loan Debt section

Below the Reality Check, a dedicated Loan Debt section lists every active loan with:

- Bank name and loan type
- Current EMI
- Annual EMI total (sum of all scheduled EMIs in the FY)
- Annual prepayment total (sum of all prepayments in the FY)
- Combined annual outflow

Loans in non-INR currencies are shown separately and excluded from the INR totals.

---

## Income Calculator

The income figure in the Yearly Plan comes from the **Income Calculator** (Goals tab → Income Calculator). Set your CTC (or take-home) there; Arth calculates monthly in-hand, taxes, and PF/NPS deductions.

Without an income profile, the Yearly Plan and Financial Health grade cannot compute savings rates or surpluses — set it up first.

---

## Common situations

**"My projected surplus looks wrong."**
Check that your income is set correctly in the Income Calculator. Also verify that your Investment Bucket targets reflect actual annual commitments — over-targeting buckets will inflate the projected outflow.

**"Reality Check says I'm behind on investments but my SIPs are running."**
If your SIPs arrive via SMS and are in the review queue, they count as pending, not approved. Approve them in the review queue; the Investments actual will update.

**"The Debt Servicing row is blank."**
Appears only if you have active INR loans tracked in Arth. Add your loans under Goals → Loans & Debt.

**"Why does the surplus show negative even though I'm saving?"**
The surplus is Income − All planned outflows. If your combined bucket + milestone + EMI targets exceed your income, the plan shows a deficit even if you're saving something — it means you can't fund all targets simultaneously and something needs to give.

---

## Related

- Set your income and savings target: [Income Calculator](salary-calculator)
- Financial Health grade and monthly headroom: [Financial Health grade explained](financial-health-grade)
- Track investment contributions: [Goals, milestones, and investment buckets](goals-milestones)
- Track and record loan prepayments: [Loans and EMI tracking](loans)
- Compare two years side by side: [Year-over-Year comparison](yoy-comparison)
