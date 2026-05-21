---
title: Setting and tracking a budget
slug: budget
summary: Monthly caps per category with a progress bar. Refunds subtract from the actual.
tags: [budget, caps, monthly, spending, progress, categories, budget-tab, month-end, projection]
contextKeys: [budget-home, budget-edit]
phrasings:
  - How do I set a budget?
  - Monthly limit for a category
  - Budget is not showing up
  - Change my budget for next month
  - How does the progress bar work?
  - What if I overspend?
  - Track food budget
  - Is the budget per category or overall?
  - Reset budget every month
  - Does forecast count towards budget?
  - Does a refunded expense still count in my budget?
  - Set budgets for all categories at once
  - Budget tab
  - UI budget summary
  - UI budget progress bar
  - UI spending split
  - UI rolling surplus
  - What is rolling surplus?
  - Why is my budget red?
  - Budget shows over budget
  - Change budget cap for a category
---

Budgets are monthly caps per category. Arth tracks actual spend against each cap and shows a progress bar that turns red when you're over.

## Where to find it

**Budget tab** (bottom nav).

## Set a budget

1. Open the **Budget tab**.
2. You'll see every category with its current-month cap and actual. Categories you haven't budgeted show "Set budget".
3. Tap the category → enter the monthly amount → tap **Save**.

Do this for one category or all. The **overall** bar at the top is the sum.

## Set budgets in bulk

**Settings tab → Budget Config** lets you set or clear caps for every category in one screen. Useful when starting fresh.

## How the progress bar works

- **Green** — within cap.
- **Yellow** — 80%+ of cap used.
- **Red** — over cap.

Number shown is `actual / cap`. "Actual" is the sum of approved realized expenses in that category during the current month, **minus any refunds** linked to those expenses.

## Month boundaries

Budgets reset on the 1st of every calendar month. If your last cap for a category was ₹8,000, next month starts with ₹8,000 and ₹0 spent.

This is separate from your **fiscal year** (Settings tab → Fiscal Year) — FY drives yearly reports, salary calculations, and YoY comparisons, not monthly budgets.

## What counts against the budget

- **Approved realized expenses** in that category, dated in the current month → count.
- **Refunds** linked to those expenses → subtract. A ₹2,000 expense with a ₹500 refund counts as ₹1,500.
- **Forecast expenses** (predictions from reminders) → do NOT count until you mark them as paid.
- **Transfers between your own accounts** → do NOT count.
- **Split-tender legs** → each leg counts on whichever category it was tagged with. Your share is whatever leg you paid.
- **Hisaab splits** (you paid ₹1,000, friend owes ₹500) → only YOUR share (₹500) counts against your budget.

## Common situations

**"The budget says ₹0 spent but I paid yesterday."**
Likely in the Review Queue. Open **Home → Review Queue**, approve the expense, budget updates.

**"I over-spent. How do I carry the overage forward?"**
Arth doesn't auto-carry. Deliberately lower next month's cap by the overage amount if you want that behavior.

**"Does the forecast for rent show up?"**
Forecast rows have a "FORECAST" pill and are grey — they don't inflate actuals. When the real rent SMS arrives and you approve it (or tap "Realize" on the match), the forecast goes away and the real expense counts.

**"I refunded a big-ticket purchase. Why is my category still over budget?"**
If the refund hasn't been recorded yet, open the original expense → tap **Record a Refund** → pick the destination account → fill in the amount. The budget will update as soon as the refund is saved (approved). Refunds link to the original expense via the "Refund of" line in expense metadata.

## Related
- How categories are decided: [Categories and how they're decided](categories)
- When refunds change spend totals: [Recording refunds](refunds)
- Forecast vs reminder: [Reminders for recurring payments](reminders)
