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

The **Insights screen** is where Arth explains your spending patterns — not as a table of numbers, but as human-readable findings you can act on.

## Where to find it

**Home tab → Insights card** (the big "View your insights" row). Tap to open the Insights screen.

Insights is **not** a bottom tab — Arth has five tabs (Home / Transactions / Budget / Goals / Settings) and Insights lives under Home.

## What's on the Insights screen

Top to bottom:

- **Forecast card** — month-end projection with fixed / variable / daily pace / confidence. Same math as the Budget tab's Month-End Projection widget. See [Month-end projection](projection-math).
- **Insight cards** — up to five severity-ranked findings for the current month. Each is tappable and opens a drill-down breakdown.
- **Spending Pulse** — this month's total vs last month's total, with an arrow showing the change. Tap **Compare** to open a detailed compare screen.
- **Explore quick actions** — shortcuts to Compare, Forecast, Patterns, and Merchants pages.

## The five insight types

Each insight card summarises a pattern Arth detected for the current month. What each one means and when it appears:

- **Budget breach** — a category has spent more than its cap. Example: "Food 35% over budget". Trigger: `category actual > category cap`.
- **Lifestyle creep** — this year's 3-month average is higher than last year's same 3-month average by **more than 15%**. Example: "Lifestyle creep +22% YoY". Formula: `(current 3mo total / same 3mo last year) − 1 > 0.15`.
- **Micro-leaks** — **₹3,000+ per month** spent across small transactions (under ₹500 each). Example: "Micro-leaks: ₹4,200 / month". Trigger: `sum(expenses where amount < 500) ≥ 3000`.
- **Savings win** — a category dropped **15%+ vs last month**. Example: "Travel down 40%". Formula: `(last month − this month) / last month ≥ 0.15`.
- **Category spike** — one category is unusually high this month (reserved — not yet shown).

## Severity

Each insight card is coloured by severity:

- **Critical** (red) — over 50% over budget.
- **Warning** (orange) — smaller breaches; lifestyle creep over 30%.
- **Info** (grey) — noticeable but not urgent.
- **Celebrate** (green) — savings wins.

## Tapping an insight

Every insight card opens a **drill-down detail** screen showing:

- Merchant-level breakdown for breaches and savings wins.
- Category-level breakdown for micro-leaks.
- Category-level YoY breakdown for lifestyle creep — which categories grew the most, with side-by-side bars and a "New this year" pill for categories that have zero last-year spend.
- Rows with multiple expenses open a filtered expense list. Rows with a single expense jump straight to the expense detail.

If a drill shows **"Insight not available"**, the underlying trigger has gone stale (e.g. your spending dropped and the breach is no longer valid). Pull down to refresh.

## Compare

**Insights screen → Compare.** Pick any two date ranges (presets: This Week vs Last Week, This Month vs Last Month, Quarter vs Quarter, Year-over-Year, or Custom), see breakdowns by category, merchant, and payment method.

Column headers show the date range with year (e.g., "May '26" / "Apr '26") so you always know which period each column represents.

Every amount value in the comparison is **tappable** — tap any number to see the exact expenses that make up that total. This works for the overall totals AND for each category/merchant/payment-method row. The drill-down total matches the compare total exactly (refunds are deducted, investment-linked expenses are excluded).

The merchant list shows the top 10 by default. Tap **"+N more merchants"** to expand and see them all.

The comparison **refreshes automatically** every time you return to the screen, so new expenses are always reflected.

## Patterns

**Insights screen → Patterns.** Shows **recurring merchants** Arth has detected automatically (same merchant, similar amount, similar cadence). These are subscription-shaped patterns. Not the same as user-set **Reminders** — Reminders are explicit bills you asked Arth to track.

## Merchants

**Insights screen → Merchants.** Top 20 merchants by spend this month, with transaction count and last-transaction date.

## Common situations

**The Spending Pulse arrow is red — is that bad?** A red arrow pointing up means this month's total is higher than last month's. Tap **Compare** to see which categories drove the change.

**The forecast card keeps changing.** Expected — it updates with every new transaction. Early in the month, the daily-pace estimate is noisy. By mid-month it stabilises.

**Where are the insights for last month?** Insights are always current-month. For last month's story, use **Compare** or go to the **Budget tab** and scroll back with the period navigator.

## Related

- [Month-end projection](projection-math) — the forecast card's math, explained
- [Setting and tracking a budget](budget)
- [Fixing merchant names](merchant-aliases)
