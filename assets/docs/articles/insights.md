---
title: Insights and analytics
slug: insights
summary: Where spending patterns, YoY comparisons, pulse, forecast, and insight cards live, and what each one means.
tags: [insights, analytics, patterns, compare, forecast, lifestyle-creep, micro-leaks, merchants, spending-pulse, yoy]
contextKeys: [insights-home, insights-compare, insights-patterns, insights-merchants]
phrasings:
  - What are insights?
  - What does the insights screen show?
  - How do I open insights?
  - Where are insights in the app?
  - Spending pulse what is it
  - Lifestyle creep insight
  - Micro leaks insight
  - Budget breach insight
  - Savings win insight
  - What does this month vs last month mean?
  - Where is the forecast?
  - Compare two months
  - Year over year comparison
  - YoY comparison
  - Top merchants
  - Recurring patterns
  - Insight not available error
  - Why can't I tap the insight?
  - UI insight card
  - UI forecast card
  - UI spending pulse
  - UI insights screen
  - Home tab insights card
  - Compare values not clickable
  - Tap amount in compare
  - Drill down in compare
  - Compare not updating
  - Compare shows old values
  - Month so far card
  - Variable projected card
  - Insights explore section
---

The **Insights screen** is where Arth explains your spending patterns - not as a table of numbers, but as human-readable findings you can act on.

## Where to find it

**Home tab → Insights page** - swipe across from Overview, or tap **Insights** at the top. The **Insights & Analytics** card on Overview opens it too.

Insights is **not** a bottom tab - Arth has five tabs (Home / Transactions / Budget / Goals / Settings) and Insights lives under Home.

## What's on the Insights screen

Top to bottom:

- **Your month** - a badge for the month, one headline, your spending so far against last month by the same day (with a dotted line to where the month is likely to end - tap it for the forecast), and three small facts. Tap the card to play the month as a story.
- **Worth a look** - the top three findings for the current month. Tap one for its breakdown. **Not now** hides it for this month; **Don't show these** switches that kind off.
- **Explore** - **Money in and out** (what came in, what went out and the share you kept), **Compare**, **Where it goes** (merchants, regulars and bills), **Year in review** and **Ask your AI assistant**. Year over year is on the Yearly plan (the swap icon at the top).

Budget vs actual for 3 or 6 months or the year is on the **Budget tab**: switch Month · 3M · 6M · FY at the top and the page changes in place. Tap a month's row for its exact figures. The reports moved too - see [Reports](reports).

## The five insight types

Each insight card summarises a pattern Arth detected for the current month. What each one means and when it appears:

- **Budget breach** - a category has spent more than its cap. Example: "Food 35% over budget". Trigger: `category actual > category cap`.
- **Lifestyle creep** - this year's 3-month average is higher than last year's same 3-month average by **more than 15%**. Example: "Lifestyle creep +22% YoY". Formula: `(current 3mo total / same 3mo last year) − 1 > 0.15`.
- **Micro-leaks** - **₹3,000+ per month** spent across small transactions (under ₹500 each). Example: "Micro-leaks: ₹4,200 / month". Trigger: `sum(expenses where amount < 500) ≥ 3000`.
- **Savings win** - a category dropped **15%+ vs last month**. Example: "Travel down 40%". Formula: `(last month − this month) / last month ≥ 0.15`.
- **Category spike** - one category is unusually high this month (reserved - not yet shown).

## Severity

Each insight card is coloured by severity:

- **Critical** (red) - over 50% over budget.
- **Warning** (orange) - smaller breaches; lifestyle creep over 30%.
- **Info** (grey) - noticeable but not urgent.
- **Celebrate** (green) - savings wins.

## Tapping an insight

Every insight card opens a **drill-down detail** screen showing:

- Merchant-level breakdown for breaches and savings wins.
- Category-level breakdown for micro-leaks.
- Category-level YoY breakdown for lifestyle creep - which categories grew the most, with side-by-side bars and a "New this year" pill for categories that have zero last-year spend.
- Rows with multiple expenses open a filtered expense list. Rows with a single expense jump straight to the expense detail.

If a drill shows **"Insight not available"**, the underlying trigger has gone stale (e.g. your spending dropped and the breach is no longer valid). Pull down to refresh.

## Compare

**Insights screen → Compare.** Pick any two date ranges (presets: this month against last month by the same day - the default - This Week vs Last Week, This Month vs Last Month, Quarter vs Quarter, or Custom; for years, use **Year over year**), see breakdowns by category, merchant, and payment method. A calendar shows the period day by day (month by month for long ones), darker where more was spent: tap a day or month for its total, the biggest payment and its transactions.

Column headers show the date range with year (e.g., "May '26" / "Apr '26") so you always know which period each column represents.

Every amount value in the comparison is **tappable** - tap any number to see the exact expenses that make up that total. This works for the overall totals AND for each category/merchant/payment-method row. The drill-down total matches the compare total exactly (refunds are deducted, investment-linked expenses are excluded).

The merchant list shows the top 10 by default. Tap **"+N more merchants"** to expand and see them all.

The comparison **refreshes automatically** every time you return to the screen, so new expenses are always reflected.

## Where it goes

**Insights screen → Where it goes.** Two tabs:

- **Merchants** - where your money goes by place, with what's new and what's gone quiet.
- **Regulars** - the regular payments Arth has learned (same merchant, similar amount, similar cadence), with **bills and subscriptions** on top: what they usually cost a month, which **went up** (the latest payment is above its usual amount) and which **stopped?** (a monthly one that hasn't come this month, a few days past its usual day). Not the same as **Reminders**, which are bills you asked Arth to track.

## Common situations

**The Spending Pulse arrow is red - is that bad?** A red arrow pointing up means this month's total is higher than last month's. Tap **Compare** to see which categories drove the change.

**The forecast card keeps changing.** Expected - it updates with every new transaction. Early in the month, the daily-pace estimate is noisy. By mid-month it stabilises.

**Where are the insights for last month?** Insights are always current-month. For last month's story, use **Compare** or go to the **Budget tab** and scroll back with the period navigator.

## Related

- [Month-end projection](projection-math) - the forecast card's math, explained
- [Setting and tracking a budget](budget)
- [Fixing merchant names](merchant-aliases)
