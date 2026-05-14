---
title: Month-end projection — how we forecast your spend
slug: projection-math
summary: How Artha projects where you'll land at the end of the month on the Budget and Insights screens, and why the two screens show the same numbers.
tags: [projection, forecast, month-end, budget, insights, analytics, daily-pace, fixed, variable, confidence, spending]
contextKeys: [budget-home, insights-home, insights-forecast]
phrasings:
  - How is month-end projection calculated?
  - What does projected spend mean?
  - Why does the Budget tab show a different projected number?
  - Where does the daily pace come from?
  - How is the daily pace calculated?
  - What is fixed spend vs variable spend?
  - Why is there a confidence level on the forecast?
  - Why does the projection change every day?
  - Projected spend is too high
  - Why doesn't the forecast match my gut feel?
  - How accurate is the month-end projection?
  - Where does "days left" come from on the forecast card?
  - What is breathing room?
  - Projected savings vs projected deficit — what do they mean?
  - UI element month end projection
  - UI element projected spend
  - UI element daily pace
  - UI element fixed
  - UI element variable
  - UI element confidence
  - UI element days elapsed
  - UI element days left
  - Budget tab projection widget
  - Insights forecast card
  - Month So Far vs Projected — how do they relate?
---

Month-end projection answers one question: **"If I keep spending the way I've been spending, where will I land by the end of the month?"**

You see this number in two places — they use the same math and always show the same value.

## Where to find it

- **Budget tab → Month-End Projection** card (the widget with Fixed / Variable / Daily Pace / Confidence).
- **Insights screen → Forecast Breakdown** card at the top.

## The short version

Your projected total for the month is built from three pieces:

**Projected total = Fixed done + Fixed pending + Variable projected**

Where:

- **Fixed done** — predictable monthly costs you've already paid this month (rent, EMI, utility bills).
- **Fixed pending** — the same kind of costs, still due before month-end. Pulled from your **Reminders**.
- **Variable projected** — everything else, estimated by extrapolating your current pace to the end of the month.

Each piece is explained below, with a worked example.

## Fixed spend — two buckets

Fixed spend is anything predictable that repeats every month. Artha splits it into two buckets:

- **Fixed done** — the sum of fixed-category expenses **already paid** this month (in your expense list).
- **Fixed pending** — the sum of **active reminders** with a `next_due_date` falling in the current month that haven't been paid yet. Every active reminder counts exactly once.

**Example.** Today is 15 April. You've already paid rent (₹25,000) and your electricity bill (₹2,400). Your HDFC credit card bill is due on 28 April, set up as a reminder for ₹18,000.

- Fixed done = 25,000 + 2,400 = **₹27,400**
- Fixed pending = **₹18,000**
- Fixed total = **₹45,400**

## Variable spend — daily pace

Everything that isn't "fixed" is variable. Artha doesn't predict specific future variable transactions — it simply averages your current pace.

The math, step by step:

- **Variable so far** = sum of variable expenses this month, up to today.
- **Daily pace** = variable so far ÷ days elapsed.
- **Variable for rest of month** = daily pace × days left.
- **Variable projected** = variable so far + variable for rest of month.

**Example (continuing from above).** Today is 15 April — 15 days elapsed, 15 days left in April. Your variable spend so far is ₹30,000.

- Daily pace = 30,000 ÷ 15 = **₹2,000 / day**
- Variable for rest of month = 2,000 × 15 = **₹30,000**
- Variable projected = 30,000 + 30,000 = **₹60,000**

## Putting it all together

**Projected total = Fixed done + Fixed pending + Variable projected**

Continuing the example:

- Projected total = 27,400 + 18,000 + 60,000 = **₹1,05,400**

If your monthly budget is ₹1,10,000, your **breathing room** is +₹4,600 (projected savings). If it's ₹95,000, your breathing room is −₹10,400 (projected deficit).

## Confidence — how much to trust the projection

Artha labels every projection as **Low**, **Medium**, or **High** confidence:

- **Low** — first 7 days of the month, OR fewer than 5 variable transactions so far. Daily pace doesn't have enough signal yet.
- **Medium** — 8–15 days elapsed, OR under 15 transactions. Pace is reasonable but can still shift.
- **High** — 16+ days elapsed AND 15+ transactions. Pace is stable enough that the projection usually lands within ±10%.

The projection is shown even at low confidence — but that's your cue to not over-react to the number.

## Why the two screens always match

Both the Budget tab's projection widget and the Insights forecast card call the same engine (`getAnalyticsForecast`). Same inputs → same output. If you ever see them diverge, it's a bug — please report it.

## Common situations

**My projected spend shot up today.** You either paid a big fixed cost (rent, EMI, CC bill) or had a high-variable day that raised the daily pace. Refresh tomorrow — one spike rarely persists.

**Projection on day 1 of the month looks weird.** It is. On day 1, daily pace either doesn't exist (no variable spend yet) or is based on a single data point. Confidence will say **Low**. Give it a week.

**My reminders don't have the right amounts — does the projection use them?** Yes — fixed pending reads each reminder's amount. Keep reminders accurate so the projection isn't thrown off.

**I marked a reminder as paid. Is it still in fixed pending?** No — once a reminder is fulfilled (linked to a real expense), it moves into fixed done automatically.

**The projection says I'll save ₹5,000 but my gut says I'll overspend.** Your gut might be counting a one-off (a trip, a gift) that Artha can't know about. Projections assume the rest of the month looks like the days elapsed so far.

## Related

- [Setting and tracking a budget](budget)
- [Reminders for recurring payments](reminders)
