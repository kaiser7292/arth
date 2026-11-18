# UI revamp plan (Nov 2026)

Builds the screens the owner approved on the "Arth filters" design canvas. The canvas uses sample
data only; nothing here or in `docs/` holds real financial data.

The transactions rollout (PRs #8 and #9, v4.50.0) already moved the transaction lists, filter
sheet, month drawers, sub-categories and the shared parts onto the design tokens. This plan covers
everything else.

## Rules every screen follows

From the canvas notes "rules" and "forms", plus the owner's comments on the boards:

- **Tokens only** (`constants/design-tokens.js`): type `text-label` (12) · `text-meta` (13) ·
  `text-body` (15) · `text-heading` (17) · `text-title` (22) · `text-hero` (36); corners
  `rounded-control` (10) · `rounded-card` (16) · `rounded-sheet` (20) · `rounded-pill`;
  `theme.alpha()` for tints; `useTheme()` for raw colours. Each finished screen is added to
  `__tests__/unit/design-tokens-usage.test.ts` so it can't drift back.
- **Shared parts** from `components/ui`: SectionTitle (icon in a tinted 32 px square + heading +
  hint), FieldRow (label left, value right, 48 px), MoneyChip, ActionRow (up to 4 round buttons,
  last is More), Segmented (2–4 choices), Chip, RadioRow / CheckRow, SearchField, SwipePager.
- **Headers:** the title plus at most two icon buttons. Labelled buttons go in a row below.
- **Inputs:** labels sit above inputs. Unit words go in the label ("Tenure, in months"); only a
  1–2 character unit sits inside the input (₹, %, mo).
- **No wrapping** inside buttons or chips (one line, ellipsis).
- **Pinned footers and bulk bars are light:** card background, top border. Never dark.
- **Sums are statements that add up** (opening + in − out = closing), not a row of chips.
- **Money colours:** spending is ink; green for money in; purple for moved; red only for
  over-budget, overdue or destructive.
- **Progress bars only when a target exists.**
- **Forms:** grouped cards, each with a SectionTitle; required groups open, optional groups are
  folded rows that say what they hold ("Optional · 3 fields"); pill footer with Cancel + one verb
  ("Save loan"); edit opens the same screen filled in, with Delete in More.

**Nothing is removed.** If a screen has a control the board doesn't show, it stays (folded or in
More) and is listed under "Questions for the owner" below. The only removals allowed are exact
duplicates, and each one is named in the commit and here.

## Screens, in build order

Each group is one or more commits (`feat(scope): …`), each passing `npm run typecheck` and
`npx jest`. "Must keep" is copied from the canvas notes and is the acceptance list.

### 1. Goals (boards: Goals, YearlyPlan, Milestones, LoanDetail, LoanForm, Buckets, BucketDetail, NetWorth, IncomeCalc)

Files: `app/(tabs)/goals.tsx`, `app/goals/yearly-plan.tsx`, `app/goals/milestones.tsx`,
`app/goals/milestone-detail.tsx`, `app/loans/[id].tsx`, `app/loans/add.tsx`,
`app/loans/[id]/prepayment.tsx`, `app/loans/[id]/correction.tsx`, `app/goals/loans.tsx`,
`app/goals/investment-buckets.tsx`, `app/goals/investment-detail.tsx`,
`app/goals/balance-sheet.tsx`, `app/goals/salary-calculator.tsx`, plus the Goals drill-ins
(`health-grade`, `advisory-detail`, `risk-coverage`, `yoy-comparison`, `capital-gains-reference`)
restyled without layout changes.

Must keep:
- Goals tab: every link stays (health grade, advisory detail, risk coverage, buckets, milestones,
  loans, balance sheet, yearly plan, year over year, income calculator, year in review).
  Financial-health guards stay.
- Yearly plan: Edit plan → budget configuration; links to buckets, milestones, each loan and Add
  loan, income calculator; draft state; plan vs actual.
- Milestones: tap → detail; long-press actions.
- Loan detail: prepayment, correction, foreclosure quote, edit, delete, full schedule; each EMI
  opens its transaction.
- Add loan: every field stays. Optional groups are only folded, never removed.
- Buckets list: buckets per financial year, annual and total target, contributed so far, linked
  milestone, target date (with 'date has passed'), Add bucket, edit, delete. Copy last year's
  plan: copy as is, or copy with a hike (per bucket, or 'Set all hike %'), then Apply and save.
- Bucket detail: contributed vs target, average monthly contribution, months to complete,
  projected completion, monthly history, add / edit contribution, reset contributions, delete;
  each contribution opens its source expense or transfer, and the account ledger.
- Net worth: the balance sheet opens with Today only. '+' adds the end of the previous financial
  year, then the one before ('No earlier financial year with data' when there isn't one); ✕ hides
  a year again; short ₹L values when more than one column. Kept: net worth over time with All /
  Liquid cash / Investments / Debt; change this FY (saved, markets, loans paid off, new loans,
  everything else) as a statement that adds up; every balance-sheet row opens its accounts (bank
  accounts, wallets, FDs, demat, pension, credit cards, account ledger, Hisaab people); 'Hisaab in
  Net Worth' picker; Try again on load errors.
- Income calculator: financial year, Copy last year (as is / with hike), Salaried or Business /
  freelance, monthly in-hand and the regime that wins. Salary checks (compare recent salary
  credits, Use as my in-hand, See credits, Dismiss). Tabs Salary / Deductions / Other / Tax (and
  Business for business mode) with every field listed on the canvas note "Every control · Income
  calculator". Save draft, Save salary data.

### 2. Hisaab (boards: HisaabPeople, HisaabLedger, SettleSheet)

Files: `app/hisaab/persons.tsx`, `app/hisaab/ledger.tsx` (+ its settle / add-person sheets).

Must keep:
- People: tap → ledger; long-press actions; add person keeps name, phone, email, opening balance,
  notes. All / Owe you / You owe as a Segmented switch.
- Ledger: every entry still opens its linked expense; settle still asks for the account and can
  jump to that account's ledger; export (format picker); long-press edit / delete; record lent or
  borrowed.

### 3. Budget (boards: Budget, BudgetCategory)

Files: `app/(tabs)/budget.tsx`, `components/budget/SpendingSplitPage.tsx`,
`components/budget/MonthlySummaryPage.tsx`, `app/budget/[categoryId].tsx`.

Must keep: Overview keeps every number: total spent, left to spend, days elapsed / left, daily
pace, daily rate, avg per day, projected spend with confidence, annual budget, fixed vs variable,
loan EMIs (→ Loans), the review-queue nudge and the Budget Summary sheet. Numbers beyond the three
tiles sit in a 'More numbers' fold. Each category → its drill-down → its transactions. Spending
split → transactions and loans. Summary → transactions and Classify. Tabs stay on SwipePager.

### 4. Account ledger + account settings (boards: LedgerLink, AccountSettings, AccountsList)

Files: `app/reconciliation/account-ledger.tsx`, `app/settings/account-detail.tsx`,
`app/settings/account-master.tsx`, `app/settings/account-add.tsx`.

Must keep:
- Ledger: add credit / transfer / adjust balance, the FAB date rule, convert, refund / hisaab /
  linked-expense jumps, vault link, reconciliation, free month navigation, running balance.
  Header balance as a statement (opening + in − out − transfers = closing). New: the account name
  and gear open Account settings.
- Accounts list: search; sort (as listed, name A–Z, bank A–Z, type) and group (type, bank) with
  collapsible groups; Open / Closed badge; 'recorded twice' banner → merge duplicates; 'counted as
  spending' banner → transfer review; Ignored section with Track again; loans open loan details;
  + Account (add screen keeps name, number, nickname, demat portfolio value and date, idle cash).
- Account settings: nickname; type picker; card limit, due date, total and minimum due; FD
  principal, rate, maturity, corrected maturity amount, bucket, mark matured; demat holdings, idle
  cash, total, snapshots; open loan details; starting month and balance, month-by-month opening
  override, remove adjustment; minimum balance alert; UPI IDs add / remove; linked payment modes;
  Save; Close / Reopen; Ignore messages; Remove. New: Open ledger.

### 5. Insights, Vault, Simulator, Investments (boards: Insights, Vault, VaultEntry, Simulator, Scenario, Investments, Projections)

Files: `app/insights/*` (index lives in a component; to be traced), `app/vault/*`,
`app/simulator/*`, `app/investments/*`.

Must keep:
- Insights: cash flow, budget vs actual, compare, forecast, merchants, patterns, reports, export
  for AI, filtered lists, insight detail, my-month summary and rows, set-a-budget prompt, pull to
  refresh.
- Vault: add, edit, every field type (card, UPI, MPIN, TPIN, TOTP, statement passwords), reveal,
  copy with the 30-second clipboard clear, link to an account, open from the ledger.
- Simulator: projections, duplicate (upcoming entries or full setup), rename, delete, change
  horizon, include hisaab, resolve stale entries, mark done / later, link transactions, entry
  editor, open the account ledger.
- Investments: the stacked chart (drag to see value and change on that date); periods 5D, 1M, 6M,
  YTD, 1Y, 5Y, Max; 'since <date>' when history starts inside the period. Tap a band or legend row
  → that type's accounts; tap an account → demat snapshots, pension accounts, or account settings.
  Upcoming maturities with interest. All / Fixed deposits / Market / Pension tabs synced with the
  legend, with closed and matured accounts. Total value, market value, contributions, period. Sync
  and its review screen, 'Zerodha needs login', Add investment and Add FD. Projections: monthly
  SIP, yearly step-up (by % or ₹), assumed return, inflation, one-time amounts, add / edit /
  remove your extra investment.

### 6. Add / edit transaction (board: TxnForm)

Files: `app/expense/add.tsx` and its pickers in `components/expense/`.

Must keep: the full "Every control · Add / edit transaction" note (pickers as one searchable sheet
with recents, groups, counts and '+ Add'; merchant fills category, account and mode marked 'From
merchant'; type Spent / Received / Transfer with Refund under Received and its links; amount; date
chips, calendar and the start-date warning; split tender; split with a person; tags; note;
unavoidable; recurring prefill; save verb follows the type).

### 7. Settings (boards: Settings, CategoriesList, CategoryEdit, PaymentModes, Tags, BudgetConfig, Merchants, MerchantDetail, SmartRules, SmartRuleEdit, Reminders, TxnMessages, ScanRuns, UpdateBalances, BackupData, ImportExcel, SecurityRegion, NotifyCalendar, Customise, FixMyData, CleanUp, RecycleBin, SmsTemplates, PictureTemplates)

Files: `app/(tabs)/settings.tsx` and `app/settings/*` (one commit per part, as on the canvas).
Must-keep lists: the canvas notes "Nothing lost · Settings home" and "Every control · …" parts 2–7,
copied in full into each commit's description as it is built.

### 8. Restyle only (not mocked)

Same parts, no layout or behaviour change; listed for the owner to review: Zerodha / Angel One /
Zebpay connection screens, Household, AI setup / lab / suggestions, Voice, Help, Privacy,
Licences, iPhone messages, SMS disclosure.

## Exact duplicates removed

- Goals tab: the setup dots in the old FY strip (they repeated the setup card under them). "Month X of 12" moved into the Financial health hint.
- Bucket detail: the round + button (the "+ Contribution" chip, and the "Add contribution" row when there is no history yet, open the same form).
- Net worth: the separate "Net worth · Today" card (the trend card shows the same figure); it still shows when there is no history yet.
- Hisaab ledger: the round + button (the new Lent action opens the same form).
- Budget: the ✕ on each Overview widget card (the apps button's switches do the same).

## Questions for the owner

Anything listed here is kept as it is until answered.

8. ~~Vault Lock now~~ Answered: not needed.
9. ~~Split person and credit kind pickers~~ Answered: move them. Done in 1ef4f9c.

1. ~~Goals tab, FY picker~~ Added in bdbc0f3, then removed at the owner's request: the Goals tab stays on the current year.
2. ~~Net worth type switch~~ Added in bdbc0f3, then removed at the owner's request (no type selection on the chart).
3. ~~Settle "I paid them"~~ Answered: build it, and paying back counts as spending. Done in bdbc0f3 + 869096c: an approved expense (on the account it came from, if picked) linked to a You paid entry.
4. **Goals tab, risk coverage and year in review.** Not on the board; both kept (Track and Analyse lists). Confirm that's where they belong.
6. **Budget summary fold.** The Budget summary card could be folded shut from its own header before; it is now always open (it can still be hidden from the apps button). OK?
7. **Budget drill-down, "By sub-category".** The board shows a by-sub-category split on a category's page. That breakdown doesn't exist yet; it's new work (sum the month by sub-category). Build it?
5. **Bucket detail Edit.** "Edit" opens the bucket's form on the buckets list; after saving you land on the list, not back on the detail. Fine, or should it come back to the detail?

## Progress

Each commit passed `npm run typecheck` and `npx jest` (2,938 tests). Not checked on a device.

| Group | Status | Commits |
|---|---|---|
| 1. Goals | Done: Goals tab, Yearly plan, Milestones (+ form), Loan detail, Add loan, Buckets (+ form), Bucket detail, Net worth, Income calculator; drill-ins and loan sub-screens restyled | 19ee715, a71e2aa, d487774, 12694eb, 324df07, f9526a9 |
| 2. Hisaab | Done: People (+ form), Person ledger, Settle | e81d846 |
| 3. Budget | Done: Overview (hero, tiles, More numbers fold, categories), drill-down Edit budget pill; Spending split and Summary restyled | 7f42110 |
| 4. Account ledger + settings | Done: ledger statement + name/gear link, Open ledger, Accounts list, Account settings sections | fb87863, 29dd4eb |
| 5. Insights, Vault, Simulator, Investments | Done: tokens, labelled add buttons, Vault kind chips + note, Simulator lowest balance + Safe tag; Insights and Investments already matched | 943d5a4, 6c6359a, 2a868b2 |
| 6. Add / edit transaction | Done: searchable picker sheets (merchant, category, account, payment mode) with recents, groups, counts, + Add; a merchant fills its usual category / account / mode marked From merchant | d1dc972 |
| 7. Settings | Done: home search + Needs a look, Categories Reorder mode, Recycle bin Select; every control the notes list checked present; all screens on the tokens | 9a2d8bb, d32748b, 387e2fb, 93654de |
| 8. Restyle only | Done: on the tokens, layout unchanged; for the owner to review: Zerodha / Angel One / Zebpay connections, Household, AI setup / lab / suggestions, Voice, Help, Privacy, Licences, iPhone messages, SMS disclosure | 9a2d8bb, 93654de |

Shared parts added on the way: `components/ui/LinkRow.tsx` (LinkRow, StatTile, GroupLabel, HeaderPill, Statement, UnderlineTabs), `components/ui/FormParts.tsx` (FormGroup, FoldGroup, FormFooter), Input `prefix` / `suffix`, FAB `label`. `scripts/codemod-revamp-tokens.js` does the mechanical token move (text and corner classes, hex alpha, legacy colours); multi-line template strings need a hand fix.
