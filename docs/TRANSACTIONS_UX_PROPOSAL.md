# Transactions UX — Learning from Niyo

**Version:** 1.1 | **Date:** November 2026 | **Status:** Ideas 1, 2 and 3a were built (c83d345) and then reverted at the owner's request on 16 Nov 2026; nothing from this proposal is in the app

---

## 1. Why this proposal

The owner uses the Niyo app and likes three things about it:

1. **A filter row you scroll sideways** — the filters sit in one line of pills above the list, and you swipe through them instead of opening a separate screen.
2. **Month totals in the all-transactions list** — scrolling down, each month has a heading that says what that month added up to.
3. **Drawers** — filters and transaction details slide up from the bottom as a sheet over the list, so you never lose your place.

This document compares each with what Arth does today and proposes what to adopt. It copies **patterns only**: no Niyo name, artwork, colours or wording goes into Arth.

---

## 2. What the public sources say about Niyo

Research was limited to public pages; nothing was signed in to.

| Source | What it shows |
|---|---|
| Google Play listing, "Niyo: Global cards for travel" (Nov 2026) | Feature list is about forex, cards, eSIM, travel. The store screenshots are marketing art; none shows the transactions screen. No review discusses the list or its filters. |
| Niyo help centre: "How do I track/view my transactions" (updated Mar 2025) | Transactions live in their own **Transactions tab** off the dashboard; a notification arrives for each one. |
| Niyo community: "Latest features and updates" (Sep 2024) | Transactions can carry a **custom tag** (e.g. "coffee"). |
| Niyo community: "Help us build: improving your transaction feed" (Feb 2026) | Niyo asked users to rank **search and filters**, spend analytics, **trip tagging** (group a trip's spends), **smart labels** (interest, tax collected) and **quick-tap "pills" for transaction type** as upcoming work. |

**Honest limit:** no public page describes the current filter row, month totals or detail drawer in detail; the Feb 2026 post suggests the pill row and filters shipped after it. So the descriptions of those three patterns below come from the **owner's own use of the app**, matched against how this pattern is commonly built in Indian banking apps. Before building, the owner can send 3–4 screenshots of their own Niyo transactions screen (with amounts blurred) to confirm the details — they must **not** be committed to the repo.

---

## 3. What Arth has today (Transactions tab)

`app/(tabs)/expenses.tsx`, top to bottom:

1. **Date range card** — a full-width button ("This Month") that expands an inline list of 11 presets (Today … All Time, Custom).
2. **`ListToolbar`** — search box (with voice and plain-English search) plus four square icon buttons: Filter, Sort, Group by. What's on shows underneath as small grey text "chips" with a ×, plus "Clear all" and "Save view".
3. **Nature tabs** (`SwipePager`) — All · Expenses · Committed · Credits · Transfers. Already a horizontal row you can swipe between.
4. **`FilterSummaryCard`** — total for the whole range, change vs. the previous period, breakdown by category/account/etc.
5. **List** — grouped by **day**, each day heading shows its net (e.g. "TUE, 4 NOV ………… −₹1,240"). Rows open the full-screen detail page `app/expense/[id].tsx` (a pushed screen, 3,600 lines).

Filters open `FullScreenFilter` — a full-screen modal with section names on the left (Category, Payment Mode, Account, Tags, Merchant, Smart Rule, Status, Refund status, Unavoidable/discretionary, Saved views) and options on the right, with Apply/Reset.

What already exists that this proposal reuses:
- `components/ui/FilterChip.tsx` — a pill for horizontal filter rows, used on 8 screens but **not** on the Transactions tab.
- `components/ui/Sheet.tsx` — a proper drag-to-dismiss bottom sheet; `SelectSheet` is built on it.
- Group by **Month** already exists (`utils/expense-grouping.ts`) with `GroupHeading` showing count and total — but choosing it **replaces** the day headings and loads up to 5,000 rows at once instead of paging.

---

## 4. Proposals

### Idea 1 — Quick-filter pill row (sideways scroll)

| | |
|---|---|
| **What Niyo does** | One line of pills under the search box; swipe sideways to reach more. Tapping a pill applies it at once; an active pill is filled/highlighted. Tapping a pill that has choices (e.g. a category) opens a small drawer to pick. |
| **What Arth does today** | Every filter is behind one funnel icon that opens a full-screen page. The date range is a separate large card above the toolbar. What's on is shown only as small grey text after the fact. |
| **Proposed change** | Add a horizontal pill row directly under the search box, replacing the big date card. Pills, left to right: **Date: This month ▾** · **Category ▾** · **Account ▾** · **Payment mode ▾** · **Needs review** (toggle, shows count) · **Refunded** (toggle) · **Tags ▾** · **All filters** (opens today's full-screen filter, which keeps the rarer filters: merchant, smart rule, discretionary, saved views). A pill with ▾ opens a bottom sheet (see Idea 3) with the choices; once set its label changes to what's chosen, e.g. "Food, Travel" or "2 accounts", and gains a small ×. Active pills move to the front of the row so you can see what's on without scrolling. The grey "what's on" text line goes away for this tab, because the pills now say it. Sort and Group-by icons stay where they are. |
| **Files** | `components/ui/FilterChip.tsx` (add optional ▾ caret, count badge, × to clear), new `components/ui/FilterPillRow.tsx` (horizontal `ScrollView`, active-first ordering), `app/(tabs)/expenses.tsx` (replace date card; wire pills to the existing filter state — no new filter logic), `components/ui/ListToolbar.tsx` (optional `pills` slot so other lists can adopt it later). |
| **Effort** | Medium — about 1.5–2 days. All filters and their state exist; this is a new way to reach them. |
| **Priority** | **P1** — biggest daily win; makes the most-used filters one tap instead of three. |

Notes: the pill row should not be inside the nature-tab pager, so it doesn't fight the sideways swipe between All/Expenses/Credits. The Sheet for a pill with a long list (accounts, categories) has a search box, same as `FullScreenFilter` today.

### Idea 2 — Month headings with month totals

| | |
|---|---|
| **What Niyo does** | In the all-transactions list, each month starts with a heading (e.g. "October 2026") and that month's total(s). Days or individual rows sit underneath. The heading stays pinned at the top while you scroll inside that month. |
| **What Arth does today** | Day headings with the day's net. A month total exists only if you switch Group by → Month (which hides the day headings and loads everything at once), or in the summary card for the whole range. With "Last 3 months" or "This financial year" there is no per-month total in the list. |
| **Proposed change** | When the range spans more than one month and grouping is **Date** (the default), add a **month band** above each month's first day: month name on the left, and on the right **Spent ₹X · Received ₹Y** (on the All tab), or just the one total on Expenses / Credits / Transfers. Day headings stay underneath as they are. The month band sticks to the top while you scroll through that month. Tapping the band opens that month's summary (the existing `MonthlySummaryPage` content) in a sheet. Within a single month ("This month") nothing changes — the summary card already gives the total. |
| **The one technical catch** | The list loads in pages, so the last loaded page might be half a month. The month total must therefore come from the database (one `GROUP BY` month query with the same filters), not from adding up the rows on screen — otherwise October would read too low until you scroll to its end. This is one new query in `services/expense-queries.ts`, run alongside the existing summary query. |
| **Files** | `services/expense-queries.ts` (new `getMonthTotals(userId, filters)`), `app/(tabs)/expenses.tsx` (insert month-band rows into `groupedExpenses`, `stickyHeaderIndices` on the list), new `components/ui/MonthBand.tsx` (or extend `GroupHeading` with a "band" style), plus a unit test for the totals query across a paged boundary. |
| **Effort** | Medium — about 1.5 days including tests. |
| **Priority** | **P1** — directly what the owner asked for; also helps Account Ledger later (see Idea 5). |

### Idea 3 — Drawers for filters and quick details

| | |
|---|---|
| **What Niyo does** | Filters and a transaction's details slide up as a sheet over the list; swipe down or tap outside to close and you are exactly where you were. |
| **What Arth does today** | Arth already has a good drag-to-dismiss `Sheet`, but the Transactions tab uses it only for sort/group pickers. Filters use a full-screen page; tapping a transaction pushes the full detail screen, and back returns you to the list (scroll position is usually kept, but the list reloads on focus). |
| **Proposed change — 3a: filter drawers** | Each ▾ pill from Idea 1 opens a `Sheet` with just that filter's choices (multi-select with ticks, search box for long lists, "Clear" and "Done" at the bottom). "All filters" keeps the full-screen page for power use. |
| **Proposed change — 3b: transaction quick-look drawer** | Tapping a row opens a **quick-look sheet** instead of the full page: amount and direction large at the top, merchant, date and time, account, category (tap to change in place), payment mode, tags, notes, and the original SMS in a collapsible block. Buttons along the bottom: **Edit**, **Split**, **Refund**, **Delete**, and **Open full details** (pushes today's `/expense/[id]` page for everything else: links, splits history, recurring rules, forecast match). Pending-review rows show **Approve / Reject** in the sheet so the review flow gets faster too. Long-press keeps opening bulk select as today. |
| **Files** | new `components/expense/TransactionQuickSheet.tsx` (reads the same data as `ExpenseHeroCard` / `ExpenseMetadata`, reuses them where possible), `app/(tabs)/expenses.tsx` (row tap → sheet), new `components/ui/MultiSelectSheet.tsx` (sibling of `SelectSheet`), the pill wiring from Idea 1. Settings switch "Open transactions in: Quick look / Full page" (MMKV key — must be registered in `SETTINGS_REGISTRY` per CLAUDE.md rule 8). |
| **Effort** | 3a: small (~1 day, alongside Idea 1). 3b: medium-large (~2.5–3 days) — the detail page is large, so the sheet deliberately shows only the common fields and hands off for the rest. |
| **Priority** | 3a **P1** (ships with Idea 1). 3b **P2** — valuable, but it's the riskiest piece; do it after the owner has lived with 1 and 2. |

### Idea 4 — Small polish borrowed from the same pattern

| Item | Niyo-style behaviour | Arth today → proposed | Files | Effort | Priority |
|---|---|---|---|---|---|
| 4a. Type pills instead of a second tab row | Transaction type is a quick-tap pill | Keep Arth's swipeable nature tabs (they already do this and support swiping the list itself). **No change** — noted so it isn't duplicated in the pill row. | — | — | — |
| 4b. Search suggestions | Search shows recent searches | Arth's search box is empty until you type. Show the last 5 searches and saved views as pills under the box while it is focused and empty. | `app/(tabs)/expenses.tsx`, MMKV key for recent searches (register in `SETTINGS_REGISTRY`, device-only) | Small (~0.5 day) | P3 |
| 4c. Trip / event grouping | Niyo is planning "trip tagging" | Arth already has **tags** and **Group by → Tag isn't offered**. Add "Tag" to Group by so a "Goa 2026" tag gives a per-trip total. | `utils/expense-grouping.ts`, `hooks/use-expense-grouping.ts` | Small (~0.5 day) | P3 |

### Idea 5 — Carry the same patterns to other lists (later)

Once the pieces exist, the same three can go to:
- **Account ledger** (`app/reconciliation/account-ledger.tsx`) — it's one month at a time via `PeriodNavigator`, so month bands don't apply, but the quick-look sheet (3b) and a small pill row (Debits / Credits / Transfers / Adjustments) would.
- **Budget → category drill-down** (`app/budget/transactions.tsx`) and Hisaab lists, which already use `ListToolbar` through `use-list-tools`.

Effort: ~0.5 day per screen once 1–3 are built. Priority **P3**; propose separately after the Transactions tab settles.

---

## 5. Summary and suggested order

| # | Change | Effort | Priority |
|---|---|---|---|
| 1 + 3a | Sideways filter pill row, each pill opening a filter drawer; date card folded into a pill | ~2.5 days | **P1** |
| 2 | Sticky month bands with month totals (from the database, not on-screen rows) | ~1.5 days | **P1** |
| 3b | Transaction quick-look drawer with "Open full details" | ~3 days | P2 |
| 4b, 4c | Recent searches; group by tag (trip totals) | ~1 day | P3 |
| 5 | Same patterns on ledger, budget drill-down, Hisaab | ~0.5 day each | P3 |

Suggested first release: **1 + 3a + 2** together, as one "Transactions refresh". Then 3b on its own after feedback.

## 6. What stays the same

- No database tables or columns change (one new read-only query). Backup/restore is unaffected.
- Every filter that exists today stays reachable (rare ones via "All filters"); saved views keep working.
- Nature tabs, swipe between them, bulk select, voice and plain-English search, the summary card.
- Design system: `FilterChip` styling and `Sheet` are the existing ones; NativeWind colours, section-label typography.

## 7. Questions for the owner

1. In the pill row, which 4–5 filters do you reach for most? (Proposed: date, category, account, payment mode, needs-review.)
2. On the All tab, should a month band show **Spent and Received**, or one **net** figure?
3. For the quick-look drawer: should tapping a transaction open the drawer by default, with the full page one tap away — or keep the full page as default and make the drawer a setting?
4. Can you share 3–4 screenshots of your Niyo transactions screen (amounts blurred) so the details can be matched before building? They will be used for reference only and not added to the repo.
