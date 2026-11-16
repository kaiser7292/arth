# Transactions design system — plan

Status (2026-11-16): **steps 1-15 built** on branch `claude/txn-design-system-488495`, approved by
the owner ("Yes, start building"). Step 16, sub-categories, waits for the owner's OK on the
database change. See "What was built" at the end for where it differs from the plan.

Sources: the "Arth filters" canvas (icon rail, section title plus hint, Cancel + Apply) and the
follow-up study (code audit, design-system parts, light-theme mockups of the list, filter sheet,
detail page and sub-category picker). Base commit: `30d7a42` (month drawers + 20/80 filter sheet).

## Why it reads as crude

The structure is already right. The styling under it is not on the system: each file picks its own
text sizes, corners, chips and colours instead of the tokens in `constants/design-tokens.js`.

Counted on this branch (off-scale = `text-xs/sm/base/lg/xl/2xl/3xl` or inline `fontSize`;
off-token corner = `rounded-sm/md/lg/xl/2xl` or inline `borderRadius`):

| File | Off-scale text | Off-token corners | `useColorScheme` | hex + "14" alpha |
|---|---|---|---|---|
| `app/expense/[id].tsx` | 138 | 46 | 2 | 4 |
| `components/expense/catch-up/CatchUpCardView.tsx` | 33 | 6 | – | 2 |
| `components/expense/ExpenseFormFields.tsx` | 27 | 14 | 7 | 2 |
| `components/expense/LoanPaymentPickerSheet.tsx` | 26 | 9 | 7 | – |
| `components/home/pages/ReviewQueuePage.tsx` | 22 | 6 | 2 | 2 |
| `components/expense/RecurringRuleSheet.tsx` | 19 | 6 | 2 | 3 |
| `components/expense/MarkAsFDSheet.tsx` | 17 | 7 | 2 | 4 |
| `components/expense/SplitEditSheet.tsx` | 17 | 3 | 2 | – |
| `app/expense/add.tsx` | 16 | 7 | 2 | – |
| `app/expense/just-arrived.tsx` | 15 | 1 | – | – |
| `components/expense/InvestmentWithdrawalSheet.tsx` | 15 | 2 | – | – |
| `components/expense/TransactionFilterSheet.tsx` | 14 | 10 | – | – |
| `app/(tabs)/expenses.tsx` | 12 | 4 | 2 | – |
| `app/transfer/[id].tsx` | 12 | – | 2 | – |
| `components/expense/SplitCard.tsx` | 12 | – | – | – |
| everything else in `components/expense/` | ~150 | ~45 | many | ~20 |

Plus five private part copies inside the filter sheet (`Chip`, `RadioRow`, `CheckRow`,
`Segmented`, `SearchBox`), two filter sheets that look different (`TransactionFilterSheet` for the
Transactions tab, `FullScreenFilter` for every other list), and three ways to draw a badge.

---

## 1. The parts

All new parts live in `components/ui/` and are exported from `components/ui/index.ts`. Their shape
(padding, label size, radius) is a recipe in `COMPONENTS` in `constants/design-tokens.js`, so a
change is one line.

| Part | What it is | Replaces |
|---|---|---|
| `Chip` | One chip, five variants: `choice` (off / on), `category` (icon + the category's tint), `add` (dashed, "+ Add category"), `status` (small, sentence case), `removable` (on + ✕, for applied-filter chips). 36 px tall for `choice`, 24–28 px for in-row variants, `rounded-pill`, `text-meta`. | Filter sheet's private `Chip`, `FilterChip` (kept as a thin wrapper so its 9 callers don't change), hand-made row badges, `TagPicker` pills |
| `RadioRow`, `CheckRow` | 44 px rows with a radio / checkbox, label, optional sub-line and colour dot | Filter sheet private copies; `FullScreenFilter`'s own rows |
| `Segmented` | 2–4 option switch, `rounded-control` | Filter sheet private copy; ad-hoc toggles in add/edit (Spent / Received / Transfer, Needed / Optional) |
| `SearchField` (extended) | Gains `size="lg"` (44 px, `text-body`, `rounded-control`) and keeps the amount-search placeholder default | Filter sheet `SearchBox`, the Transactions tab's inline search box styling |
| `SectionTitle` | Icon in a 32 px tinted square + title on `text-heading` + hint on `text-meta`, optional right-hand action | Filter sheet section titles, edit-form group labels, detail-page card titles. `SectionHeader` (the small uppercase one) stays for screen sections and moves onto `text-label` |
| `ActionRow` | Up to four round icon buttons with labels under them, last one "More" | The ~20 stacked action rows on the detail page |
| `MoneyChip` | Amount in a pill with a direction arrow and a money tone | Month-drawer totals, `FilterSummaryCard` totals |
| `FieldRow` | Label left / value right row inside a card, tappable when editable | `ExpenseMetadata` rows, detail summary rows |

### Token changes (`constants/design-tokens.js`)

- **Type scale only**: `text-label` … `text-hero`. No `text-xs/sm/base/lg/xl/3xl`, no inline `fontSize`.
  Mapping used in the clean-up: `xs → label`, `sm → meta` (or `body` where it is a row title),
  `base → body`, `lg → heading`, `xl/2xl → title`, `3xl → display`, detail amount → `hero`.
- **Raise `label` from 11 px to 12 px** (line height 14 → 16). Every rail label, badge and
  section label gets it. Checked against the dense screens in `npm run preview` before shipping,
  because the 2025 `text-xs` bump caused row wrapping; 1 px on the smallest step only is the safe end.
- **Radius tokens only**: `rounded-control` (10) / `rounded-card` (16) / `rounded-sheet` (20) /
  `rounded-pill`. Inline `borderRadius` only where a value must be a number (animated styles), and
  then read from `RADIUS`.
- **Colour**: `theme.alpha(role, a)` only, never `hex + "14"`. `useTheme()` only; the leftover
  `useColorScheme().colors` reads in these files go.
- **Money tones** (new `MONEY` block, read by `MoneyChip`, rows, hero):
  | Tone | Colour | Used for |
  |---|---|---|
  | `out` | foreground ink on a neutral fill | spending — normal, so not red |
  | `in` | `success` | credits, refunds, money in |
  | `moved` | `DATA.transfer` (purple) | transfers between own accounts |
  | `over` | `danger` | over budget, failures — the only place red is used for money |
- New recipes in `COMPONENTS`: `chip.*` per variant, `radioRow`, `checkRow`, `segmented`,
  `sectionTitle`, `actionRow`, `moneyChip`, `fieldRow`, `rail` (filter-sheet rail item).

---

## 2. Screen inventory

Legend for the parts columns: **FS** = the shared filter sheet with icon rail, **MD** = month
drawers, **Row** = the transaction row, **Chip** = shared chips, **ST** = section title with icon.
"Restyle" means the screen keeps its own layout but its text/corners/colours move onto tokens.

### 2a. Lists that show transactions

| Screen | FS | MD | Row | Chip | ST | What stays as it is |
|---|---|---|---|---|---|---|
| `app/(tabs)/expenses.tsx` (Transactions tab) | ✓ (already) | ✓ (already) | ✓ | ✓ applied-filter chips | ✓ | Nature tabs + `SwipePager`, voice/plain-English search, saved views, bulk select, Group-by cap note |
| `app/budget/transactions.tsx` | ✓ | ✓ when grouped by month | ✓ | ✓ | ✓ | Its budget header card |
| `app/budget/[categoryId].tsx` | ✓ | ✓ when grouped by month | ✓ | ✓ | ✓ | Category budget hero, `ListCapNote` |
| `app/insights/filtered.tsx` | ✓ | ✓ when grouped by month | ✓ | ✓ | ✓ | The insight's explanation header |
| `app/summary/my-month-rows.tsx` | ✓ | – (one month) | ✓ | ✓ | ✓ | – |
| `app/together/transactions.tsx` | ✓ | ✓ | ✓ | ✓ | ✓ | `FilterSummaryCard`, household split labels |
| `app/reconciliation/account-ledger.tsx` | ✓ | – (one month, `PeriodNavigator`) | ✓ (ledger variant: running balance kept) | ✓ | ✓ | Balance header, FAB menu (Add credit / transfer / Adjust balance), the unbounded navigator, the FAB date rule |
| `app/hisaab/ledger.tsx` | ✓ | – | Restyle (hisaab entries are not expenses) | ✓ | ✓ | Person balance header, settle flow |
| `app/settings/recycle-bin.tsx` | ✓ | – | ✓ (with "Deleted 3 days ago" line + Restore) | ✓ | ✓ | Restore / delete-forever actions, 30-day note |
| `components/home/pages/ReviewQueuePage.tsx` + `app/expense/review-queue.tsx` | ✓ | – | ✓ (review variant: approve/reject swipe kept) | ✓ | ✓ | `SwipeableRow`, duplicate groups (`DuplicateGroupCard`), bulk approve |
| `app/loans/[id].tsx` (linked payments list) | – | – | ✓ | – | ✓ | Schedule table |
| `app/settings/smart-rules/applications/[id].tsx` | – | – | ✓ | – | – | – |
| `app/settings/audit-log.tsx` | ✓ (moves off `FullScreenFilter` look) | ✓ by month | Restyle: audit row (icon, what changed, when) using `Chip status` for the action | ✓ | ✓ | Every existing filter (table, action, date), the per-entry before/after detail |

### 2b. Other lists with the toolbar (get the shared filter sheet + chips, keep their own rows)

Because `hooks/use-list-tools.tsx` opens `FullScreenFilter`, restyling **`FullScreenFilter` onto the
same parts as the Transactions sheet** (icon rail, `SectionTitle`, `CheckRow`/`RadioRow`, `Button`
footer) carries the look to all of these in one change, with no per-screen edits:

`app/hisaab/persons.tsx`, `app/settings/account-master.tsx`, `app/settings/merchants.tsx`,
`app/settings/merchant-categories.tsx`, `app/settings/recurring-rules.tsx`,
`app/settings/smart-rules/index.tsx`, `app/settings/sms-scan-runs.tsx`,
`components/home/pages/VaultPage.tsx`, `components/portfolio/PortfolioList.tsx`.

Their rows are not transactions (merchants, rules, people, holdings), so they keep their rows and
only move text/corners to tokens where they use the shared parts.

`app/settings/categories.tsx` has no toolbar today; it gets `SectionTitle` and the category chips,
and is where sub-categories are managed (section 6).

Screens that import `ListToolbar` only indirectly (`goals`, `insights/*` reports, `demat`,
`simulator`, home summaries) are out of scope: they do not list transactions.

### 2c. Add, edit and detail — every kind of transaction

| Screen / part | Change |
|---|---|
| `app/expense/add.tsx` | Groups the form as **What / Where / Source**, each under a `SectionTitle`. `Segmented` for Spent / Received / Transfer. Category field becomes a `Chip category` that opens the grouped picker. Amount on `text-display`, money tone by kind. Buttons via `Button`. |
| `components/expense/ExpenseFormFields.tsx` | The shared fields move onto `Chip`, `Segmented`, `FieldRow`; 27 text + 14 radius fixes; `useTheme` only. Also used by `app/simulator/[id]/entry.tsx` (gets the look for free). |
| `components/expense/TransactionFormParts.tsx` | Same parts; this is where What / Where / Source groups are defined once, so add and edit cannot drift. |
| `app/expense/[id].tsx` (detail **and** edit) | Section 4 below. Edit mode uses the same What / Where / Source groups as add. |
| `ExpenseHeroCard.tsx` | Icon, name, amount on `text-hero` (money tone), one meta line (date · time · source). Status badges leave the hero; at most one shows, under it. |
| `ExpenseMetadata.tsx` | Becomes the folded **Source** card (SMS text, sender, detection time, applied rule). |
| Credit add / edit | Same screen as expenses (`add.tsx` with `type=credit` / `refund`, `[id].tsx` with `nature='credit'`): gets everything above; "Type" (credit kind) is a `Chip` group instead of a category. |
| Transfer add | `add.tsx` with `type=transfer`: What = amount + note; Where = From / To account rows with the `moved` tone. |
| Transfer detail `app/transfer/[id].tsx` | Same hero + What / Where cards + `ActionRow` (Edit, Delete, Undo transfer). 12 text fixes. |
| Ledger adjustment (inline form in `account-ledger.tsx`, "Adjust balance") | Moves into a `Sheet` with `SectionTitle`, `Input`, `Button` — same content, same "dated today" rule. Adjustment rows in the ledger use the Row with a neutral "Adjustment" status chip. |
| Add credit from the ledger FAB (`account-ledger.tsx` inline credit form) | Same sheet treatment. **Keeps the CLAUDE.md date rule**: default date is today if today is in the viewed month, else the first day of the viewed month. A test pins this. |
| `app/expense/catch-up.tsx` + `components/expense/catch-up/*` | Card uses the hero recipe and category chips; description bar on the keyboard kept as is (just shipped in `b5e7b82`). 33 text fixes in `CatchUpCardView`. |
| `app/expense/just-arrived.tsx` | Row + chips + `SectionTitle`; 15 text fixes. |
| `ReviewQueueItem.tsx` | Row (review variant) + approve / reject kept on swipe and buttons. |
| Every `components/expense/*Sheet.tsx` | Restyle onto tokens and `SectionTitle` / `RadioRow` / `Button` (they are opened from the "More" sheet, so they must match it). |

---

## 3. Features that must survive

Each item says where it lives today and how the new design keeps it. A short regression test is
added where one does not exist (marked *test*).

| Feature | Lives in | How it is kept |
|---|---|---|
| Amount search (`>5000`, `450 to 500`, `under 500`, `450`) | `utils/amount-search.ts` | Search logic untouched; only the box is restyled. Existing unit tests stay. |
| Placeholder hinting it ("Search, or try >5000") | `SearchField` default, tab search box | Kept as the `SearchField` default; the Transactions tab passes the same text. |
| Plain-English search ("food last month") and voice search | `app/(tabs)/expenses.tsx` (voice button, cancel, parse on submit) | Same handlers; mic button sits inside the new `SearchField size="lg"` via a `right` slot. |
| Group-by 5,000-row cap note | `ListCapNote` in `ListToolbar.tsx` | Component kept, restyled onto `text-meta`; still rendered by the same three screens. |
| Saved filter views: apply, default view (star), delete | `TransactionFilterSheet` "Views" rail item, `services/saved-filter-views.ts` | Views stay a rail section; star and delete stay on each row (`RadioRow` with trailing actions). Default view still applies on open. |
| Sort and group-by | Filter sheet rail (Sort, Group), `use-group-by.ts` (remembered per screen) | Same rail sections; `RadioRow`s. Remembered per screen as now. |
| Bulk select via long-press | `BulkActionBar`, row `onLongPress` | Row keeps `onLongPress` and the selected state (tinted background + check); `BulkActionBar` restyled only. |
| Swipe actions | `SwipeableRow` (review queue) | Row renders inside `SwipeableRow` unchanged. |
| Nature tabs with swipe (All / Expenses / Credits / Transfers) | `SwipePager` in the tab | Kept; tab strip restyled (underline, `text-body`). |
| `FilterSummaryCard` (totals for the filtered set) | `components/expense/FilterSummaryCard.tsx` | Kept; totals move to `MoneyChip` tones. |
| Pending-review badges | Row badge, hero badge, filter "Needs review" | The one status chip on the row; "Needs review" has priority over other statuses. Rail keeps its count. |
| Refund strike-through (full) and partial-refund amount | `ExpenseListItem` (`classifyRefund`) | Logic untouched; full = struck amount + "Refunded" status chip; partial = remaining amount with the original struck small beside it. *test* |
| Split notes ("Your share of ₹X") and split badge | Row + detail split card | Row line 2 shows "Split · your share" in the meta text when split; detail keeps `SplitCard`. |
| Money-event tags (FD, SIP, transfer, withdrawal) | `MoneyEventPanel`, `money-event-meta.ts` | Status chip on the row ("FD deposit"); detail keeps `MoneyEventPanel` as a linked card under the hero. |
| Add-credit / transfer default date rule | `account-ledger.tsx` FAB | Kept verbatim when the form moves into a sheet. *test* |
| Recycle-bin restore | `app/settings/recycle-bin.tsx` | Row variant with Restore / Delete forever; same service calls. |
| Month drawers: open/closed state and per-month in/out totals | `MonthDrawer.tsx`, `utils/month-drawers.ts` | Kept; totals become `MoneyChip` (out = neutral). |
| Applied-filter chips with ✕ under the search | Transactions tab | `Chip removable`. |
| Filter count badge on the funnel button | `ListToolbar` `ToolButton` | Kept, on `text-label`. |
| Amount presets in the filter sheet and min/max boxes | `TransactionFilterSheet` `AMOUNT_PRESETS`, `AmountBox` | Kept; presets become `Chip choice`; hint says "or type >5000 in search". |
| Long-list cap in filter sections (60 options + search) | `LIST_CAP` in the sheet | Kept. |
| Load-failed banner + retry | `LoadFailedBanner` | Kept, restyled. |
| Forecast rows and forecast actions (mark paid, paid externally, realise, delete) | `ForecastActionBar`, detail page | Kept; forecasts get the "Forecast" status chip and their actions in the primary row (section 4). |
| Split-tender siblings ("one of 3 payments") | Detail section 1b | Kept as a linked card in **Where**. |
| Together / household sharing | Detail, `together/transactions.tsx` | Kept as a linked card; row line 2 shows the household tag. |
| Smart-rule-applied badge (tap to open the rule) and "apply a rule" | Detail | Moves into the **Source** card as a tappable `FieldRow`. |
| Fulfilled-reminder badge + Undo | Detail | Linked card under **Where** with Undo. |
| Recurring-reminder suggestion banner | Detail | Kept as an `AlertBanner` below the action row. |
| SMS transaction time (read-only) | Edit form | Kept read-only in **Source**. |
| Date shift (move to previous/next day) | `handleDateShift` in detail | Kept in edit, on the date field. |
| Hardware back closing sheets first | Sheets | Unchanged (`Sheet` handles it). |
| Data-version refresh (`useDataRefresh`) and preload consumers | Screens | No change to data loading; this is a visual change. |

The "Show N transactions" Apply label adds one count query (same SQL as the list with
`COUNT(*)`, debounced 250 ms); if it fails the button falls back to "Apply".

---

## 4. Actions on a transaction — rethought

### Today

The detail page (`app/expense/[id].tsx`) stacks up to ~20 action rows and banners below the cards,
each with its own style, and which ones appear depends on nature, account type, money event and
status. Inventory:

| # | Action | Applies to | Opens |
|---|---|---|---|
| 1 | Edit | all | inline edit mode |
| 2 | Delete (to recycle bin) | all | confirm |
| 3 | Approve / Reject | pending review | inline (`handleApprove/Reject`) |
| 4 | Categorize / change category | expenses | category picker |
| 5 | Credit type | credits | type picker |
| 6 | Tags | all | `TagPicker` |
| 7 | Note | all | edit field |
| 8 | Split with a person (hisaab split) | expenses (not credits, not household share) | `SplitEditSheet` |
| 9 | Split tender (pay with several accounts) | expenses, edit mode | inline |
| 10 | Record a refund | expenses not fully refunded | `RefundTargetSheet` → add credit |
| 11 | Tag as refund of… (link credit to expense) | credits | `RefundExpensePickerSheet` |
| 12 | Undo refund link | refunds | inline |
| 13 | Mark as transfer (debit) | realized savings debits | `AccountPickerSheet` |
| 14 | Mark as transfer (credit) | SMS credits | `AccountPickerSheet` |
| 15 | Undo transfer | transfers | inline |
| 16 | Mark as fixed deposit | realized savings debits | `MarkAsFDSheet` |
| 17 | FD matured / closed | credits | `InvestmentWithdrawalSheet` |
| 18 | Money back from an investment | credits | `InvestmentWithdrawalSheet` |
| 19 | Mark as investment (bucket) | realized non-credit | `InvestmentBucketPickerSheet` |
| 20 | Demat transfer target | demat transfers | `DematTransferTargetSheet` |
| 21 | Mark as loan payment (EMI / prepayment) | realized non-credit | `LoanPaymentPickerSheet` |
| 22 | Mark as hisaab settlement | credits, non-CC | `HisaabSettlementPickerSheet` |
| 23 | Set / stop reminder (recurring rule) | realized expenses | `RecurringRuleSheet` |
| 24 | Apply a smart rule | all | rule picker sheet |
| 25 | Duplicate (new transaction pre-filled) | all | `add.tsx?copyFromExpenseId` |
| 26 | Forecast: mark paid / paid externally / realise / delete / repayment paid | forecasts | inline + account picker |
| 27 | Link expense (from home) | home card | `LinkExpenseSheet` |
| 28 | Dismiss duplicate | review queue | `DuplicateGroupCard` |
| 29 | Bulk: category, type, mode, account, merchant, date | list selection | `BulkActionBar` |
| 30 | Unlink investment / loan / settlement | linked items | inline |

### Proposed

**Primary row** — four round buttons under the hero (`ActionRow`), chosen by state so the most
likely next step is always one tap:

| State | Button 1 | Button 2 | Button 3 | Button 4 |
|---|---|---|---|---|
| Pending review | **Approve** | Reject | Edit | More |
| Forecast | **Mark paid** | Paid elsewhere | Edit | More |
| Expense (realized) | Edit | Split | Refund | More |
| Credit | Edit | Link refund | Mark as transfer | More |
| Transfer | Edit | Undo transfer | – | More |

**More sheet** — one `Sheet` with `SectionTitle` groups, each item a `ListRow` with icon, label and a
one-line "what this does". Only items that apply are shown:

- **Organise**: Category / Type, Tags, Note, Apply a smart rule, Set reminder (or Stop reminder)
- **Money moved**: Mark as transfer, Mark as fixed deposit, FD matured / closed, Money back from an investment, Demat target
- **Link it to**: Investment bucket, Loan payment, Hisaab settlement, Refund of…, Split with a person, Split tender
- **Copy and remove**: Duplicate, Delete

Edit stays a full mode (same What / Where / Source groups as add), not a sheet.

### What each action leaves behind

One rule for all: **the hero shows one status chip; the result of a link shows as a linked card
in the right group; reversible actions show an undo toast for 5 s; the list row shows the status
chip or a meta word.**

| Action | Detail view after | Edit screen after | List row after | Undo |
|---|---|---|---|---|
| Approve | Status chip gone; action row switches to the realized set | normal | "Needs review" chip gone | toast "Approved · Undo" |
| Reject | Leaves the page, row hidden | – | gone (shown under "Rejected" filter) | toast |
| Edit / save | Updated cards | – | updated | – |
| Delete | Leaves the page | – | gone (in recycle bin) | toast "Moved to recycle bin · Undo" |
| Category / type / tags / note | Value in **What** | same field | category chip / tags | – (just change it) |
| Split with a person | "Split with Asha · your share ₹600" card in **What**, tap to edit | Split field in **What** | "Split · your share" in meta, amount = share | Remove in the card |
| Split tender | "1 of 3 payments" card in **Where** listing siblings | Split-tender editor in **Where** | meta "1 of 3" | Remove from group |
| Record a refund | "Refunds" card: each refund credit, remaining amount | read-only | Refunded / partial display | Undo per refund in the card |
| Link as refund (credit) | Status chip "Refund"; "Refund of: Book store" linked card | read-only | status chip "Refund" | Unlink in the card |
| Mark as transfer | Status chip "Transfer"; "Moved to Savings ··4821" card in **Where** | Where shows From / To | `moved` tone amount, meta "to Savings" | toast + Undo transfer in primary row |
| Mark as fixed deposit | Status chip "FD deposit"; FD details card | read-only | chip "FD deposit" | Undo in card |
| FD matured / money back | Status chip "FD closed" / "Investment return"; card | read-only | chip | Undo in card |
| Investment bucket | "Invested in: Retirement" linked card | read-only | chip "Investment" | Unlink in card |
| Loan payment | "EMI for Home loan · Nov" linked card | read-only | chip "Loan EMI" | Unlink in card |
| Hisaab settlement | "Settled with Ravi" linked card | read-only | chip "Settlement" | Unlink in card |
| Set reminder | "Repeats monthly · next 16 Dec" card in **Source** | – | small repeat icon in meta | Stop reminder in card |
| Apply smart rule | "Rule: Swiggy → Food" row in **Source** | – | category updated | toast Undo |
| Duplicate | Opens add, pre-filled | – | new row | – |
| Forecast mark paid / realise | Becomes realized; status chip gone | – | normal row | toast |
| Dismiss duplicate (queue) | – | – | duplicate group gone | toast |
| Bulk actions | – | – | rows updated, selection cleared, full reload (CLAUDE.md lesson 5) | toast |

Status chip priority when several apply: Needs review › Forecast › Refunded / Partly refunded ›
Transfer › money event › Split.

---

## 5. Specific screen designs

- **Filter sheet** (both `TransactionFilterSheet` and `FullScreenFilter`, sharing a new
  `FilterRail` + `FilterSheetFrame`): rail labels 12 px, up to two lines, centred; count badge on
  `text-label`; section title = `SectionTitle` with the rail icon + hint ("Choose a range · 1 on");
  footer = Cancel (`Button` outline, pill) + Apply (`Button` primary, pill, "Show 24 transactions").
- **Month drawers**: money-out `MoneyChip` neutral, in = success; corners `rounded-card`; month
  label `text-body` bold, count `text-meta`; red only when a month is over its budget.
- **Row** (`ExpenseListItem`): line 1 = name (`text-body` semibold) + amount (money tone, tabular);
  line 2 = category chip · paid-by · account (`text-meta`). Date dropped when the list is grouped by
  date (shown otherwise). At most one status chip, sentence case. Untagged = dashed
  "+ Add category" chip that opens the grouped picker in place and saves on tap. Icon tile tinted
  with `theme.alpha`.
- **Detail** (`app/expense/[id].tsx`): hero → primary `ActionRow` → banners (suggestions) →
  **What** (category, tags, note, split) → **Where** (account, paid by, reference, transfer / tender
  / linked cards) → **Source** (folded: SMS text, sender, times, rule, reminder). Edit uses the same
  three groups. The 3,600-line file is split while doing this: hero/actions, the three cards and the
  More sheet become components in `components/expense/detail/`.

---

## 6. Sub-categories (built last, own commit, **asks the owner before the migration**)

- **Data**: `categories.parent_id TEXT NULL REFERENCES categories(id)`. One level only (a child
  cannot have children). Existing categories stay top-level, so nothing changes until the owner
  adds a sub-category.
- **Database Changes Checklist** (CLAUDE.md), all in one commit:
  1. `database/migrations/095_category_parent.ts` — `ALTER TABLE categories ADD COLUMN parent_id`
     with a `PRAGMA table_info` guard; index on `parent_id`.
  2. Register in `database/migrations/index.ts`.
  3. Add `parent_id` to `TABLE_SCHEMAS.categories`.
  4. `categories` is already in `BACKUP_TABLES` — confirm; restore order keeps parents before
     children (or FKs off, which restore already does).
  5. Cascades: deleting a parent asks "move its sub-categories up, or delete them too";
     `data-cleanup.ts`, category delete service; expenses on a deleted child move to the parent.
  6. Mock category objects in tests gain `parent_id: null`.
  7. Every `SELECT … FROM categories` that lists columns gets `parent_id` where needed.
  8. No new MMKV keys expected; if one is added (e.g. "show sub-categories"), it goes into
     `SETTINGS_REGISTRY`.
  Guard tests (`backup-coverage`, `settings-backup-coverage`) must pass.
- **Budgets**: a child's spend rolls up into the parent's budget; budget screens show children
  as indented rows under the parent; a child can have its own budget later (not in this step).
- **Picker** (`components/expense/catch-up/CategoryPickerSheet.tsx`, reused by the row's
  "+ Add category", add/edit and bulk): search box; "Used for this merchant before" (from past
  expenses with the same merchant, top 3); each parent as a `SectionTitle`-style heading ("use
  whole") with its children as `Chip category`; "+ New" dashed chip per parent; saves on tap.
- **Display**: "Food › Groceries" in the detail and edit; the row's chip shows the child name with
  the parent's icon and tint.
- **Settings**: `app/settings/categories.tsx` lets the owner add a sub-category under a parent and
  move one between parents.

---

## 7. Build order (one commit per step, each passing `npm run typecheck` and `npx jest`)

1. `feat(design-tokens)`: label 12 px, `MONEY` tones, new `COMPONENTS` recipes; `SectionHeader`,
   `Badge sm` onto the new label.
2. `feat(ui)`: `Chip`, `RadioRow`, `CheckRow`, `Segmented`, `SectionTitle`, `ActionRow`,
   `MoneyChip`, `FieldRow`; `SearchField size="lg"`; `FilterChip` becomes a wrapper. Unit tests for
   each. Added to the `preview/` gallery.
3. `feat(filters)`: `TransactionFilterSheet` uses the shared parts (private copies deleted), rail
   and footer changes, "Show N transactions" count query.
4. `feat(filters)`: `FullScreenFilter` onto the same frame → every `useListTools` screen.
5. `feat(transactions)`: `MonthDrawer` + `FilterSummaryCard` money tones.
6. `feat(transactions)`: `ExpenseListItem` row redesign + "+ Add category" in place.
7. `feat(transactions)`: Transactions tab clean-up (search box, tabs, applied chips).
8. `feat(transactions)`: budget, insights, summary, together, recycle bin, review queue, ledger rows.
9. `feat(audit-log)`: audit log rows and drawers.
10. `feat(expense-detail)`: hero, `ActionRow`, More sheet, What / Where / Source cards; file split.
11. `feat(expense-form)`: add / edit / credit / transfer on the same groups; `ExpenseFormFields`,
    `TransactionFormParts`.
12. `feat(transfer)`, `feat(ledger)`: transfer detail; adjustment and add-credit sheets (date rule test).
13. `feat(catch-up)`: catch-up, just-arrived, review item.
14. `feat(expense-sheets)`: every `*Sheet.tsx` onto tokens.
15. `docs(design-system)`: rewrite `.context/DESIGN_SYSTEM.md` from `design-tokens.js`.
16. **Stop — owner OK** → `feat(categories)`: sub-categories (section 6).

A guard test (`__tests__/unit/design-tokens-usage.test.ts`) scans the transaction files listed in
section 2 and fails on `text-xs/sm/…`, `rounded-lg/…`, inline `fontSize`, and `+ "14"` hex alpha,
so the clean-up can't regress.

## Not in scope

Version bumps, releases, pushes. Non-transaction screens beyond what the shared filter sheet
carries for free. iOS-specific styling.

---

## What was built, and where it differs from the plan

Built as planned: tokens (label 12px, `MONEY`, recipes), the shared parts, both filter sheets on one
frame with "Show N", month drawers and filtered total in money tones, the new row with in-place
"Add category" (Transactions tab), the list toolbar, every transaction list, the audit log (day
drawers on the shared `DrawerHeader`), the detail page (hero, `ActionRow`, More sheet, What /
Where / Source), add and edit on the same groups, transfer detail, ledger forms as sheets, catch-up,
just-arrived and every expense sheet on the tokens, the guard test, and the rewritten
`.context/DESIGN_SYSTEM.md`.

Differences:

- **Forecast primary row** is Edit, Delete, More, not Mark paid / Paid elsewhere. The forecast's own
  `ForecastActionBar` card stays, because its options depend on the forecast type (loan repayment
  picks an account, others don't) and duplicating that logic in the row risked getting one wrong.
- **Detail header**: Apply rule / Edit / Delete icons became one "More" button; all three are in the
  action row or More sheet.
- **"Add category" in place** is wired on the Transactions tab. Other lists show the row's category
  chip but open the detail page on tap, as before.
- **Filter-sheet counts** on lists whose screen owns a filter (a loaded date range) say "Apply"
  when that filter changes, since the list can't count rows it hasn't loaded.
- **Not touched**: `app/loans/[id].tsx` and `app/simulator/[id]/entry.tsx` (they only reuse a shared
  part; their own styling passes colours down to children and is a separate clean-up).
- **Approve / categorise undo toasts** were not added; approve and reject behave as before.
