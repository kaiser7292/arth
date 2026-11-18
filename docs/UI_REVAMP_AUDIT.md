# UI revamp audit: what still differs from the boards (18 Nov 2026, updated the same day)

Compared each board on the "Arth filters" canvas with the screen as of 4.51.1. "Function" means the
control exists somewhere; "layout" means the screen looks the way the board does. Most misses are
layout: many Settings screens only got the token restyle (sizes, corners, colours), not the
board's structure. Sample data on the boards is ignored.

Legend: **Missing** = on the board, not in the app. **Different** = in the app, but not as the
board shows it. **Matches** = no real difference found.

## Transactions and adding one

| Screen | Status | What's left |
|---|---|---|
| Transactions list (Main) | Mostly matches | Rows now put the date on line two; the board shows only a meta line (category · mode · date) under the name. Board meta is plain text; app uses a coloured category chip. |
| Filter sheet (Filters) | Matches | Earlier rollout. |
| Add / edit transaction (TxnForm) | Mostly matches | Edit now uses the add form's layout (amount, date pill, one card of picks, note). Still open: the "Repeats" chip and merchant initials in the merchant sheet. |

## Goals

| Screen | Status | What's left |
|---|---|---|
| Goals tab | Matches | Year picker removed (owner). Health card has extra lines (monthly headroom, on-track line) not on the board. |
| Yearly plan | Different (owner's call) | Plan view removed; plan vs actual only, Inflow / Outflow. Board's grouped "Income / Outflow" rows with actual-so-far under each line are not built: the app shows Outflow as a statement and plan vs actual as separate rows. |
| Life Milestones | Matches | |
| Loan detail | Matches | |
| Add loan | Matches | Loan type now a choice field (owner). |
| Investment buckets / bucket detail | Matches | |
| Net worth | Mostly matches | Board rows are one line per kind with a sub-line (Banks and wallets); app adds expandable accounts under each. |
| Income calculator | Mostly matches | Salary tab shows "From CTC to in-hand · a year" as a statement that adds up. The toggles row and "Salary credit counts toward" picker keep the older form style. |

## Hisaab, Budget, ledger

| Screen | Status | What's left |
|---|---|---|
| Hisaab people | Matches | |
| Person ledger | Mostly matches | Board's month drawer shows "3 entries · +₹4,700" totals per month; app groups by day now (owner asked). |
| Settle | Matches | |
| Budget | Mostly matches | Board's Spending split card "Could save up to ₹X" with chips and Summary page "Top categories" with ↑↓ changes: not checked line by line; those pages only got the token pass. |
| Budget category drill-down | **Missing** | "By sub-category" split (open question 7). Board shows the first transactions and "See all"; app shows the full list. Hero line "₹900 over the ₹3,000 budget" not worded that way. |
| Account ledger | **Done** | Balance after each row; statement lines say how many and which day ("Opening balance · 1 Nov", "Money in · 2 credits", "Closing balance · today"). |
| Account settings | Mostly matches | Hero with the account and "Open ledger ›" under its name. Type is a choice field. Card details / FD / Portfolio / Balance sections keep older field styles. |
| Accounts list | **Done** | Each row shows its balance, what's owed on a card, what's left on a loan, or when it closed. "Grouped by … sorted …" pills under the search. Card due dates aren't shown (no due date is stored). |

## Insights, Vault, Simulator, Investments

| Screen | Status | What's left |
|---|---|---|
| Insights | Matches | |
| Investments | Matches | |
| Projections | Mostly matches | Board hero "In 10 years · in today's money"; check wording. |
| Vault | Matches | "Lock now" left out (owner). |
| Vault entry | **Done** | Hero with "Linked to account …", Edit in the header, clipboard note, Delete at the bottom. |
| Simulator list | Mostly matches | Board shows "Ends at" and "Lowest" as two figures per scenario; app shows today → end and a "lowest" line. |
| Scenario | Mostly matches | "Balance on [date]" with Change date, Available now / Money in / Money out tiles. Key moments and Mark done were already there. |

## Settings

| Screen | Status | What's left |
|---|---|---|
| Settings home | Matches | Search, Needs a look, group colours. |
| Categories | **Done** | One card per main category: icon, name, Unavoidable / Inactive chips, transaction count, on/off switch, grey delete; sub-categories as coloured pills with "+ Sub-category". Long-press a sub-category to turn it off or delete it. Reorder mode keeps the arrows. |
| Category editor | **Done** | Preview at the top, 12 icons and 8 colours on the page (All icons / More · Custom # open the full pickers), Unavoidable switch, light footer with Delete and Save. |
| Payment modes | **Done** | Intro line, one card, colour per kind, on/off switch, grey delete. Editing stays on its own screen (the board shows it in place). |
| Tags | **Done** | One card with counts; editing in place with Cancel / Save tag. |
| Budget configuration | **Done** | Total with unavoidable / flexible split, Copy last month always there, boxed amounts that turn amber and say "Changed from ₹X", light footer Save budgets. The Apply-to choice is still the system dialog. |
| Merchants | **Done** | All / No category / Several names chips with counts, keyword rules card at the top, rows with a category chip and counts. |
| Merchant detail | Mostly matches | Hero with initial, transactions and total spent. The sections below keep their older field styles. |
| Smart rules | **Done** | Priority badge, Active / Paused, When / Then, Used N×, Duplicate / Delete pills; deleted rules in one card with Restore all / Delete forever. |
| Smart rule editor | **Done** | Applies to switch, Active, priority stepper, IF / DO blocks, light footer. "Apply to past" is still its own card (not a fold). |
| Reminders | Mostly matches | Date leaf per row, amount on the right, grouped Overdue / Due soon / Upcoming. The detail page is unchanged. |
| Transaction messages | Mostly matches | Board's "Your name in messages" name chips with ✕ and "+ Add name" are a different input in the app. |
| Scan history | Mostly matches | Run cards say "N new" (or Nothing new); the message view says "Teach this format". Outcome rows keep their layout. |
| Update balances | **Done** | Short intro, cards "owed now", light footer "Save N changes". |
| Backup and data | **Done** | One screen: last backup and automatic backup status, Back up, Restore, then Your data links (import, reconcile, recycle bin, kept duplicates, clean up). |
| Import from Excel | Different | Not changed yet. |
| Security + Region | **Done** | App lock with an icon tile; "Lock when you leave Arth" as radio choices. Region is one card: each setting with a live sample and pills (currency and timezone open their pickers), plus Short amounts. |
| Notifications + Calendar sync | Mostly matches | Notifications grouped Money / Brokers / App. Calendar sync already had last synced and Sync now. |
| Customise | **Done** | Home cards reorder by dragging ⋮⋮ (titles move their group); screen readers can move them with swipe up / down. |
| Fix my data | Mostly matches | One health card: "N to fix", how many areas are all fixed, each issue with its count. The AI steps and Last fixes keep their layout. |
| Clean up (+ duplicates, transfer review) | Mostly matches | Red warning, Date range and What to delete in plain words. Duplicate accounts and transfer review stay separate screens. |
| Recycle bin | Mostly matches | Month drawers for deleted and rejected transactions, worded Restore. Type tabs are still the chip row; other sections keep round buttons. |
| Message templates | Different | Not changed yet. |
| Picture templates | Mostly matches | Already had the intro, kind and field chips. |

## Everywhere

- **Icons and colours:** applied on Settings home, section titles, account types, Hisaab, Vault. Boards use a coloured square per row in more places (merchant initials, smart rules, reminders, payment modes); those screens still use grey or no icons.
- **Not tested on a phone:** none of 4.51.0 / 4.51.1 has been installed on a device.
- **Open questions:** risk coverage placement, bucket Edit return, Budget summary fold, by-sub-category split.

## Suggested order

1. Accounts list (balances in rows, grouped/sorted pills) and Categories (cards, switches, sub-category pills, counts) + Category editor.
2. Account ledger running balance and statement labels.
3. Edit transaction opens the same form as add.
4. Payment modes, Tags, Budget configuration, Merchants, Merchant detail.
5. Smart rules + editor, Reminders, Update balances, Backup and data, Recycle bin.
6. Scenario, Vault entry, Income calculator Salary statement.
7. The rest of Settings (Scan history, Import, Security, Notifications, Customise, Fix my data, Clean up, templates).
