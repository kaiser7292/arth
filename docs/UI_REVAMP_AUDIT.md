# UI revamp audit: what still differs from the boards (18 Nov 2026)

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
| Add / edit transaction (TxnForm) | **Different** | Add form matches now (one card of picks, chips, footer). **Edit** still uses the older form on the transaction's page; the board says edit opens the same form filled in. Board's "Repeats · Groceries" chip (matching reminder) not added. Merchant sheet: board marks each merchant with its first letter in a coloured square; app uses one shop icon. |

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
| Account ledger | **Different** | Statement built, but the board labels carry counts and dates ("Money in · 2 credits", "Opening balance · 1 Nov", "Closing balance · today"); app has plain labels. **Missing: running balance on each row** (board shows the balance after every transaction). |
| Account settings | Mostly matches | Type is now a choice field. Board's "Open ledger ›" sits under the name in the hero; app has it as a row. Card details / FD / Portfolio / Balance sections use the older field styles inside the new section titles. |
| Accounts list | **Different** | **Missing: each account's balance or dues in its row** (board: "Your bank · ₹1,42,380", "Due ₹18,240 on 2 Dec", "Closed Jun 2026", "₹18.4L left"); app shows type · bank · digits · modes. **Missing: "Grouped by Type ▾ · sorted As listed ▾" pills** under the search. |

## Insights, Vault, Simulator, Investments

| Screen | Status | What's left |
|---|---|---|
| Insights | Matches | |
| Investments | Matches | |
| Projections | Mostly matches | Board hero "In 10 years · in today's money"; check wording. |
| Vault | Matches | "Lock now" left out (owner). |
| Vault entry | **Different** | Board: Edit pill, hero with "Linked to account …", fields with copy / reveal, and the note "Copied values clear from the clipboard after 30 seconds." App: older layout; the clipboard clearing works but the note and the linked line aren't shown. |
| Simulator list | Mostly matches | Board shows "Ends at" and "Lowest" as two figures per scenario; app shows today → end and a "lowest" line. |
| Scenario | **Different** | Board: hero balance on the end date with "Change date", chart, Available now / Money in / Money out tiles, a red "Key moment" strip, planned entries with "+ Add" and "Mark done". App: older layout (all functions there; no tiles). |

## Settings

| Screen | Status | What's left |
|---|---|---|
| Settings home | Matches | Search, Needs a look, group colours. |
| Categories | **Different** | Board: **each main category is its own card** with its icon, name, chips (Unavoidable, Inactive), **transaction count**, an **on/off switch** and a grey delete icon, and **its sub-categories as coloured pills** with a dashed "+ Sub-category" pill. App: one flat list, sub-categories as indented rows, an eye icon for active, a red bin, a "+" icon. Reorder mode is built. |
| Category editor | **Different** | Board: preview at the top (big icon + "Food › Groceries" chip, "How it looks in lists"), **icon grid inline** (12 + "All icons ›"), **colour swatches inline** + "Custom #", Unavoidable switch with its hint, footer **Delete (red outline) + Save category**. App: icon and colour open drawers; no preview; Delete is a text link under Save. |
| Payment modes | **Different** | Board: intro line, rows with **on/off switch**, inline editor card ("Editing · Card ··1093": name, type, Cancel / Save payment mode). App: list + separate editor screen (type is now a choice field). |
| Tags | **Different** | Board: rows with colour dot, name and **transaction count**; tap edits **in place** (name + colour swatches, Cancel / Save). App: older layout, no counts. |
| Budget configuration | **Different** | Board: month switcher, category rows with amount boxes, **total**, "Copy last month", and a **light footer Save**. App: older layout; Save is a button in the page; Copy only shows when the month is empty. |
| Merchants | **Different** | Board: **filter chips row** (All 312 · No category 14 · Several names 22), keyword-rules card, rows with tick / name / category / count, light bulk bar. App: toolbar filter sheet (same filters), no chips row. |
| Merchant detail | **Different** | Board: hero with initial, "46 transactions · ₹38,420 in total", Category row with "Change" and "Always, for new transactions", names list with counts and Separate. App: older layout, **no transaction count / total** in a hero. |
| Smart rules | **Different** | Board: rows with **priority number**, status, "When … / Then …" summary, applied count, Duplicate / Delete pills; Deleted section with Restore all / Delete forever. App: older row layout. |
| Smart rule editor | **Different** | Board: Applies to (Expenses / Credits / All) switch, Active, **priority stepper (− 2 +)**, **IF "When these match"** block, **DO "Then do this"** block, "Apply to past transactions" fold, light footer. App: older form. |
| Reminders | **Different** | Board: grouped rows with a **date badge** (day / month), name, frequency, amount; detail with Amount ₹, Ends, Repeats chips, **"Paid so far" history**, Stop reminder, Save. App: older list; detail has history. |
| Transaction messages | Mostly matches | Board's "Your name in messages" name chips with ✕ and "+ Add name" are a different input in the app. |
| Scan history | **Different** | Board: run cards (time, kind, counts, "18 new"), outcome rows, message view with parsed fields table and **"Teach this format"**. App: older layout; Teach-this lives elsewhere. |
| Update balances | **Different** | Board: intro line, Bank / wallets rows with the difference, **"Count the ₹1,620 in budget" switch per change**, Cards "owed now", **light footer "Save 1 change"**; Start date on its own screen. App: older layout. |
| Backup and data | **Different** | Board: **one screen** with the Back up card (password + confirm, Create encrypted backup, auto-backup every 12 / 24 / 48h), Restore card, and "Your data" links. App: Backup and Restore are a separate screen behind a row. |
| Import from Excel | Different | Board: Transactions / Hisaab switch, numbered steps, preview counts, light footer "Import 371 rows". App: older layout, same steps. |
| Security + Region | Different | Board: App lock card with "Lock when you leave Arth" options; Region rows with live samples. App: older layouts. |
| Notifications + Calendar sync | Different | Board: grouped switches; calendar card with "Sync now" and last synced. App: older layouts. |
| Customise | **Different** | Board: features switches, **Home cards with drag handles (⋮⋮)**, bottom tabs, "Tabs inside screens ›". App: older layout; card order uses arrows, not drag. |
| Fix my data | **Different** | Board: "Data health · 61 to fix · 2 areas all fixed" header, rows with counts and their fix, AI section with steps, "Last fixes · 14 Nov" with Undo all. App: older layout. |
| Clean up (+ duplicates, transfer review) | Different | Board: red warning, Date range chips, what-to-delete checkboxes, Delete selected; duplicate accounts and kept duplicates on the same page. App: separate screens, older layouts. |
| Recycle bin | **Different** | Board: Select in the header, search, sort chip ("Newest first ✕"), "3 items · ₹3,019", type tabs, **month drawers** ("Nov 2026 · 3 deleted · ₹3,019"), rows with Restore / Delete forever pills, footer Empty all / Restore all. App: toolbar and per-item buttons; Select added; no month drawers; Restore/Delete are round icon buttons. |
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
