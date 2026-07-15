---
title: Income Calculator
slug: salary-calculator
summary: Set your salary or income profile so Arth can calculate in-hand pay, taxes, and feed the Yearly Plan and Financial Health grade.
tags: [income, salary, CTC, take-home, tax, EPF, VPF, NPS, HRA, 80C, deductions, new tax regime, old tax regime, bonus, capital gains, savings rate, income calculator]
contextKeys: [salary-calculator, goals-tab, income-profile]
phrasings:
  - How do I set my salary in Arth?
  - What is the Income Calculator?
  - CTC vs take-home
  - How is my tax calculated?
  - Old vs new tax regime
  - EPF and VPF in Arth
  - How to enter my salary
  - HRA deduction
  - 80C deduction
  - How does Arth know my in-hand salary?
  - Capital gains in yearly plan
  - Bonus income in Arth
  - PF contribution in Arth
  - Why is my savings rate wrong?
  - Set salary profile
  - How does income feed the yearly plan?
---

The **Income Calculator** (Goals tab → Income Calculator) is where you tell Arth what you earn. Without it, the Yearly Plan has no income figure, the Financial Health grade cannot compute a savings rate, and Monthly Headroom on the Financial Health card stays blank.

## Two input modes

**CTC mode** — you enter your annual Cost to Company and Arth breaks it down into gross, taxes, EPF/VPF/NPS deductions, and net in-hand. Use this if you know your annual package but not the monthly number.

**Direct monthly mode** — you enter the take-home amount you actually receive each month. Arth uses this directly as your monthly income without computing deductions. Use this if your salary structure is complex and it is easier to just enter what lands in your account.

## CTC mode: what you fill in

**Basic salary percentage** — the portion of your CTC that counts as basic pay. Typically 40–50%. This drives the PF calculation.

**HRA percentage** — the portion of CTC paid as House Rent Allowance. Used to compute the HRA exemption if you are in the old tax regime.

**Metro or non-metro** — affects the HRA exemption cap (50% of basic for metro cities, 40% for others).

**EPF mode** — choose between:
- Statutory (12% of basic up to ₹15,000/month ceiling, i.e., max ₹1,800/month employee contribution)
- Actual (12% of full basic salary with no ceiling)
- None (no EPF deducted, e.g., employer is exempt or you are on a different scheme)

**VPF** — any additional voluntary PF contribution amount per month you make over and above your statutory EPF.

**NPS** — employer NPS contribution as a percentage of basic (common in government and some private employers).

**Gratuity** — whether to include the employer gratuity component when computing your annual CTC-to-net bridge.

## Tax regime

Choose **old regime** or **new regime**. Arth computes estimated tax under your chosen regime.

Under the **old regime**, Arth applies the deductions you enter:
- **80C** — EPF employee contribution, ELSS, LIC premiums, PPF, etc. Enter the annual amount (max effective cap is ₹1.5 lakh).
- **80D** — health insurance premiums for self, family, and parents.
- **HRA** — computed automatically from your HRA percentage and metro/non-metro setting; you do not enter this manually.
- **Home loan interest** — the annual interest component of a home loan under section 24b (max ₹2 lakh for self-occupied).

Under the **new regime**, most deductions are not available. Arth applies the standard deduction and the basic regime slabs.

## Additional income

**Bonus** — enter the gross annual bonus amount. It is added to taxable income and reflected in the Yearly Plan as a one-time income item.

**Capital gains** — enter short-term and long-term capital gains separately. Arth uses the relevant tax rates (15% STCG on equity, 10% LTCG above ₹1 lakh threshold). These are not computed from your investment transactions — enter them from your broker's tax statement.

## Professional tax

State-level professional tax is subtracted from take-home. Arth has a built-in table for all Indian states; select your state and it applies automatically.

## What Arth does with the numbers

Once you save your income profile, every other screen that needs income pulls from it:

- **Yearly Plan** — shows your Gross Income, estimated Taxes, and In-Hand figure at the top of the Plan Summary card
- **Financial Health grade** — uses your in-hand income and actual saving transactions to compute your savings rate and the Savings factor score
- **Monthly Headroom** — subtracts all planned monthly commitments (savings target, bucket contributions, milestone amounts, EMIs) from your monthly in-hand
- **On-track signal** — compares actual savings so far against your savings rate target to project whether you will hit it by year-end

## Savings rate target

At the bottom of the Income Calculator, you set a **target savings rate** as a percentage of your in-hand monthly income. This is the benchmark Arth uses in the on-track signal and the Savings factor in the Financial Health grade. A common starting point is 20–30% of in-hand pay.

## Common situations

**"My actual take-home differs from what Arth computed."** Your employer may have specific breakdowns or perks (meal vouchers, car allowance, leave encashment) that Arth does not model. Switch to Direct monthly mode and enter the actual number from your bank statement.

**"I have two income sources."** The Income Calculator is for your primary income. Add the secondary source's annual amount to Bonus — or switch to Direct monthly mode and enter the combined monthly take-home.

**"Capital gains change every year."** Update the capital gains figure after each financial year's broker tax statement. The Yearly Plan will recalculate the surplus accordingly.

**"I'm self-employed — no fixed salary."** Use Direct monthly mode and enter a representative average monthly take-home. The Yearly Plan and grade work best with a stable figure; update it when your average changes significantly.

## Related

- See how income drives the yearly numbers: [Yearly Plan and budget](yearly-plan)
- How Arth grades your finances: [Financial Health grade explained](financial-health-grade)
- Track investment contributions: [Goals, milestones, and investment buckets](goals-milestones)
