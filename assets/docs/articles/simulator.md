---
title: Cash-flow Simulator - plan your cash flow
slug: simulator
summary: Layer planned outgoings and incomings onto today's balances to see where you'll land on any future date. Multiple scenarios, auto-seeded from reminders, hisaab-aware, never touches your real data.
tags: [simulator, what-if, cash-flow, plan, projection, forecast, scenarios, horizon, trajectory, planning, hisaab]
contextKeys: [simulator-home, simulator-detail, home-explore-tools]
phrasings:
  - What is the cash-flow simulator?
  - Plan my outgoings for next month
  - Can I afford this
  - Cash flow simulation
  - Project my account balances
  - How will my balance look at end of month
  - Plan a big purchase
  - Simulate a scenario
  - Add planned outgoing
  - Add planned incoming
  - What-if analysis
  - Predict net worth
  - Check if I can afford a laptop
  - Simulate salary income
  - Multiple scenarios plan
  - Include hisaab in simulator
  - Plan collect from hisaab person
  - Plan pay back to hisaab person
  - UI simulator
  - UI what-if
  - Home Explore & Tools card
---

The **Cash-flow Simulator** is the one Arth screen that looks forward. Everywhere else you see what already happened (or what's realized right now). Here you say what you *expect* to happen, and Arth rolls the math forward: a projected balance at horizon, per-account breakdowns, key moments, and warnings.

> Nothing you type here is written to your real ledger. Simulator entries are 100% isolated. Delete a scenario any time - zero side-effects on your real data.

## Where to find it

**Home tab → Explore & Tools → Cash-flow Simulator.**

Also searchable in the help center as "plan", "simulate", "what-if", "project", or "hisaab in simulator".

## Scenarios

A **scenario** is a named what-if plan. You create them on demand - there is no forced default. Examples:

- **"This month"** - baseline + your active reminders + CC bills.
- **"With Goa trip"** - baseline + a ₹40,000 Booking.com entry.
- **"Tight month"** - no dining out, skip Netflix, simulate a missed bonus.
- **"Laptop in June"** - add a ₹1,20,000 outgoing to plan the dip.

Each scenario has its own horizon date and its own list of planned entries. They don't affect each other.

### Create a scenario

1. Simulator home → tap **+ New scenario** (the primary button on empty state; on a populated home, tap the **New scenario** action at the top of the list).
2. Enter a name and pick a horizon date.
3. Optionally start fresh or copy planned entries from an existing scenario (all upcoming entries + hisaab inclusions get duplicated).
4. Tap **Create**.

The new scenario opens immediately, pre-seeded (on fresh creates) with active reminders and open CC forecasts that fall inside the horizon.

### Active vs archived vs deleted

- **Active** - editable, contributes to the projection.
- **Archived** - read-only past plans. Auto-archive 90 days after horizon; hard-deleted 180 days after archive.
- **Delete** - permanent, from the three-dot menu on the detail screen or the card actions on the list. Entries + hisaab inclusions cascade away. No recycle bin for scenarios. Any real transactions are untouched.

## Planned entries

Every planned entry has a **kind**. There are four:

- **Outgoing** (money out) - a planned expense: rent, bill, subscription, one-off purchase.
- **Incoming** (money in) - expected income: salary, bonus, a refund coming your way.
- **Collect from hisaab** (money in) - someone who owes you via hisaab is paying you back. Tagged with the person.
- **Pay back to hisaab** (money out) - you're settling money you owe a hisaab person. Tagged with the person.

Fields:

- **Amount** *(required)* - must be positive.
- **Date** *(required)* - any date up to the horizon.
- **Account** *(optional)* - if set, that account is the one affected. If absent, the entry is unattributed (counts toward net worth but not per-account impact).
- **Category** *(outgoings only, not for hisaab)*.
- **Merchant / description** *(optional)*.
- **Hisaab person** *(required for collect / payback only)*.

### Add an entry

1. Open a scenario.
2. Tap the floating **+** button.
3. Pick a kind (Outgoing / Incoming / Collect / Pay back).
4. Amount, date, account. If hisaab, pick the person.
5. **Save**.

Tap a row to edit. Trash icon on each row for one-tap delete. Long-press for Duplicate + Remove.

### How entries are grouped

The planned list segregates by direction:

- **Outgoing** (red arrow, total shown as −₹X) - with sub-groups Today / Tomorrow / This week / Later.
- **Incoming** (green arrow, total shown as +₹X) - same sub-groups.

Hisaab entries appear under their direction (Collect → Incoming; Pay back → Outgoing) with a sublabel like "Collect from Manoj".

### Auto-seeded entries

When you create or open a scenario, Arth pre-fills with:

- Every **active recurring reminder** due before the horizon.
- Every **open credit-card repayment forecast** due before the horizon.

Tap **Menu → Re-seed from reminders** any time to re-pull. Already-added entries aren't duplicated.

## The overview

Top of the scenario detail screen:

- **Projected balance at horizon** - big number on top. Below it, delta pill showing net change.
- **Starting balance drawer** (collapsed by default) - expands into two clearly-labelled sections:
  - **Money available** - savings + wallets + any overpaid credit cards (bank owes you) + positive-balance hisaab inclusions (people who owe you).
  - **Money owed** - credit-card utilized + negative-balance hisaab inclusions (people you owe).
  - **Include hisaab balances** launcher - tap to pick which hisaab people to add in, with % or ₹ control per person.
  - **Net starting balance** row at the bottom reconciles the two sides.
- **By Account** (post-projection breakdown) - current → projected for every account the simulation actually touches, grouped the same way (Money available / Money owed).
- **Warnings strip** - sibling card below the hero, only when issues exist. Sentence-form messages:
  - "Savings drops below minimum on 22 May"
  - "HDFC CC crosses credit limit on 18 May"
  - "Wallet goes overdrawn on 5 June"
- **Key moments** - for each affected account, the most important date in the horizon: the day it hits its lowest (non-CC) or highest utilized (CC). Hidden when no material movement.

## Hisaab in the simulator

Hisaab balances don't automatically count toward your simulator starting balance - they're person-to-person owings, not accounts. But when you know someone is going to pay you back (or you're going to settle an owed amount) before horizon, you can opt them in:

1. Expand **Starting balance · Today**.
2. Tap **Include hisaab balances**.
3. For each person:
   - Toggle the row on.
   - Type a **percentage** (0–100 %) OR a **rupee amount**. The two inputs are linked - changing one updates the other. Capped at the person's current balance.
4. Tap **Save**.

Positive-balance people (they owe you) lift the Money available side. Negative-balance people (you owe them) lift the Money owed side.

Each inclusion is **per-scenario** - including Manoj in "With Goa trip" doesn't affect "Tight month".

Inclusions are included in the backup and restore cleanly. If a hisaab person is deleted, their inclusion is automatically removed from the scenario.

### Collect / Pay-back planned entries

Separately from inclusions, you can **plan** specific cash-flow events tied to a hisaab person:

- **Collect from hisaab** - "Manoj's paying me ₹15,000 on the 18th, landing in HDFC savings."
- **Pay back to hisaab** - "I'm paying Raj ₹8,000 back on the 22nd, from ICICI savings."

These show up inside the Incoming / Outgoing lists with the sublabel "Collect from Manoj" / "Pay back to Raj". They affect the projected balance like any other entry.

**Difference from inclusions:** an inclusion sits in the starting balance (money I already consider in play). A planned hisaab entry is a cash-flow event at a specific date. Use both together - include 50 % of Manoj's ₹30,000 in your starting balance (you'll count on ₹15,000 being realized eventually) AND add a "Collect from Manoj · ₹10,000 · 18 May" planned entry (a specific payment you're expecting that day).

## How the simulator stays alive

- **Baseline re-pivots every time you open it.** Current realized balances are read fresh from the ledger on every mount. If a new SMS arrives between opens, the simulator starts from the new balance automatically.
- **Entries self-reconcile.** When a planned entry's date has passed:
  - If a matching real transaction exists (same account, date within ±3 days, **exact amount to the paise**) → the entry auto-links and moves to "Already happened".
  - If nothing matches → the entry moves to **Stale** and appears in a dedicated card. You resolve via three actions:
    - **It happened · Link** - pick the real transaction from the recent ledger; the entry marks as fulfilled.
    - **Reschedule** - pick a new future date; the entry re-enters the simulation.
    - **Remove** - discard.
- **Retention.** Non-default scenarios auto-archive 90 days after horizon; delete 180 days after archive. Entries in fulfilled / dismissed state purge 30 days after horizon.

## Common situations

**Can I afford a ₹1,00,000 purchase next Saturday?** Open or create a scenario. Add a planned outgoing for that amount, that date, the account you'll pay from. Check the new projected balance and whether any warning fires.

**I planned rent on the 1st but I'm paying late on the 10th.** The planned entry shows as stale on the 2nd. Tap it → **Reschedule** → pick the 10th.

**I planned Netflix but I'll skip this month.** Stale → **Remove**.

**An SMS landed that matches my planned rent but the simulator still shows it as upcoming.** Check account + date + amount. The match window is ±3 days; amount must match exactly to the paise. A ₹1,000 planned entry won't match a ₹997 real expense. Tap **It happened · Link** to match manually if the amounts don't line up.

**I'm expecting Manoj to pay me back ₹30,000 before horizon.** Two ways:
- **Simpler:** Expand Starting balance → Include hisaab balances → tick Manoj, keep 100 % / ₹30,000. Your money-available rises by ₹30,000.
- **Date-specific:** Add a "Collect from hisaab · Manoj · ₹30,000 · 18 May" planned entry. The projection dips until 18 May then lifts.

**I deleted a scenario by mistake.** Scenario deletion is permanent - no recycle bin. Any real transactions, hisaab balances, and reminder rules are untouched. Recreate and re-add.

## What's intentionally NOT in the simulator

- **Multi-currency.** Uses your device's single display currency. True FX conversion is a future item.
- **Market movement.** Demat portfolio holds constant at today's snapshot. Stock / MF price movement is out of scope.
- **Budget changes.** You can see the simulated spend vs budget, but you can't edit budgets from the simulator.
- **Salary auto-detection.** The simulator doesn't scan your SMS history for recurring credits. Add them manually, or set them up as reminders so they auto-seed.
- **Fuzzy amount matching.** The amount must match exactly to the paise. A different amount means a different transaction.
- **Cross-device sync.** Like everything in Arth - local-first, no cloud.

## Backups

Scenarios, entries, and hisaab inclusions are all included in the encrypted backup. Restore on a new device brings them along. Retention rules run locally on each device.

## Related

- [Reminders for recurring payments](reminders) - reminders auto-seed the simulator.
- [Hisaab - track money with people](hisaab) - the source of hisaab inclusions + Collect / Pay-back entries.
- [Privacy and offline-first](privacy-offline) - why the simulator is fully local.
