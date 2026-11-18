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
| Income calculator | **Different** | Tabs built. Board's Salary tab shows "From CTC to in-hand" as a statement with each step; app keeps the older breakdown cards. Board's toggles row (EPF, gratuity inside CTC) and "Salary credit counts toward" picker are in the old form style. |

## Hisaab, Budget, ledger

| Screen | Status | What's left |
|---|---|---|
| Hisaab people | Matches | |
| Person ledger | Mostly matches | Board's month drawer shows "3 entries · +₹4,700" totals per month; app groups by day now (owner asked). |
| Settle | Matches | |
| Budget | Mostly matches | Board's Spending split card "Could save up to ₹X" with chips and Summary page "Top categories" with ↑↓ changes: not checked line by line; those pages only got the token pass. |
| Budget category drill-down | **Missing** | "By sub-category" split (open question 7). Board shows the first transactions and "See all"; app shows the full list. Hero line "₹900 over the ₹3,000 budget" not worded that way. |
| Account ledger | **Done** | Balance after each row; statement lines say how many and which day ("Opening balance · 1 Nov", "Money in · 2 credits", "Closing balance · today"). |
| Account settings | Mostly matches | Type is now a choice field. Board's "Open ledger ›" sits under the name in the hero; app has it as a row. Card details / FD / Portfolio / Balance sections use the older field styles inside the new section titles. |
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
| Scan history | **Different** | Board: run cards (time, kind, counts, "18 new"), outcome rows, message view with parsed fields table and **"Teach this format"**. App: older layout; Teach-this lives elsewhere. |
| Update balances | **Done** | Short intro, cards "owed now", light footer "Save N changes". |
| Backup and data | **Different** | Board: **one screen** with the Back up card (password + confirm, Create encrypted backup, auto-backup every 12 / 24 / 48h), Restore card, and "Your data" links. App: Backup and Restore are a separate screen behind a row. |
| Import from Excel | Different | Board: Transactions / Hisaab switch, numbered steps, preview counts, light footer "Import 371 rows". App: older layout, same steps. |
| Security + Region | Different | Board: App lock card with "Lock when you leave Arth" options; Region rows with live samples. App: older layouts. |
| Notifications + Calendar sync | Different | Board: grouped switches; calendar card with "Sync now" and last synced. App: older layouts. |
| Customise | **Different** | Board: features switches, **Home cards with drag handles (⋮⋮)**, bottom tabs, "Tabs inside screens ›". App: older layout; card order uses arrows, not drag. |
| Fix my data | **Different** | Board: "Data health · 61 to fix · 2 areas all fixed" header, rows with counts and their fix, AI section with steps, "Last fixes · 14 Nov" with Undo all. App: older layout. |
| Clean up (+ duplicates, transfer review) | Different | Board: red warning, Date range chips, what-to-delete checkboxes, Delete selected; duplicate accounts and kept duplicates on the same page. App: separate screens, older layouts. |
| Recycle bin | Mostly matches | Month drawers for deleted and rejected transactions, worded Restore. Type tabs are still the chip row; other sections keep round buttons. |
| Message templates | Different | Board: list → tag → confirm with step tabs; tag screen "Tap a word, then say what it is"; confirm "What Arth read" with Looks right / Needs change. App: same steps, older layouts. |
| Picture templates | Different | Board: intro line, list with kind tags, detail with "Fields it reads". App: older layout. |

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
