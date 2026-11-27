# Insights, streamlined, and numbers that fit

**Status:** proposal, Nov 2026. Nothing here is built.
**Already done (5.1.x, before this proposal):**
- Year over year and Year in review are out of Goals and live in Insights.
- The Financial health report opens from the Goals card.
- The yearly plan has a Year over year icon in its header.
- Goals' Analyse section is gone, and Income calculator is under Track.

---

## 1. What Insights has today

The Insights page (Home → Insights) shows, top to bottom:

1. **Your month**: a badge, a headline, pace against last month, three facts, and the month story.
2. **Worth a look**: insight cards (budget breaches, lifestyle creep, wins, small leaks, card use, idle cash).
3. **Explore**: ten rows.

| Explore row | What it is | Overlaps with |
|---|---|---|
| Forecast | Where this month will end, bills to come | The Your month pace chart; Projections (Home pager) |
| Money in and out | Income against spending, any period | Home Overview's money in/out; Budget → Monthly summary |
| Budget vs actual | Budget against spending, any period | The whole Budget tab |
| Compare | Any two periods side by side (includes a "YoY" preset) | Year over year; the Your month pace |
| Patterns | Regular payments Arth learned (bills) | Settings → Reminders; Merchants |
| Merchants | Where money goes, new and quiet merchants | Settings → Merchants; Patterns |
| Year over year | This FY against last | Compare's YoY preset |
| Year in review | The FY as a story | Spending personality report |
| Reports | Retirement readiness, Loan payoff, Spending personality | Goals → Loans; Goals → Milestones; the month badge |
| Export for AI | A file for your AI assistant | Settings → AI → Ask your AI assistant |

So ten doors lead to about six ideas, and three of them (Budget vs actual, Loan payoff, Retirement) belong to other tabs.

---

## 2. The proposal

### 2.1 Remove or move (redundant)

| Item | Do | Why |
|---|---|---|
| **Budget vs actual** | Move into the **Budget tab** as a period switcher (This month · 3M · 6M · FY) on its first page | It's the Budget tab's job. Today the same question has two homes with different layouts. |
| **Forecast** row | Remove the row. Its number goes onto the **Your month** pace chart as a dotted line to month end ("likely ₹1.3L by 30 Nov"), and tapping it opens the Forecast screen | It's the same story as the pace chart, told twice |
| **Compare → YoY preset** | Remove the preset, which points to Year over year | Year over year is the better screen: it has income and savings rate too |
| **Patterns** + **Merchants** | Merge into one screen, **Where it goes**, with two tabs: *Merchants* and *Regulars* (today's Patterns) | Both answer "where does my money go"; one is by place, the other by habit |
| **Reports** hub | Dissolve it (below) | It holds three unrelated reports |
| → Loan payoff strategy | Into **Goals → Loans & debt** as a "Payoff plan" section | Your loans live there |
| → Retirement readiness | Into **Goals → Plan** as a third tile next to Investments and Milestones. Optional: it gets its own switch in Settings → Customise Arth | It's a plan, and it already uses milestones and risk cover |
| → Spending personality | Into **Year in review** as one slide ("Your spending personality"), and drop the report | The month badge and Year in review now do this job, better |
| **Export for AI** row | Rename it **Ask your AI assistant**. It opens Settings → AI's request screen with "Ask about my money" picked | One door for the assistant, same as the AI hub |

### 2.2 Improve what stays

- **Worth a look**
  - Show at most 3.
  - Each card gets **Not now** (hides it for this month) and **Don't show these** (switches that kind off).
  - Budget breaches add sub-categories into their parent, like the Budget tab does. Today a sub-category over budget can show here but not on the Budget tab, and the card's "budgets over" count can differ from the list.
- **Money in and out**
  - Gains the savings rate for the period: "Kept 22% of what came in".
  - The Budget tab's Monthly summary links here instead of repeating it.
- **Year over year**
  - Opens on "same months as last year" by default, so a half-finished year isn't compared with a whole one. The data for this already exists (`getYoY(..., "same-period")`).
- **Compare**
  - Defaults to *this month so far against last month by the same day*, matching the Your month card. Today it compares a part month with a full one.

### 2.3 Add (something better)

1. **Bills and subscriptions** (inside Where it goes → Regulars). Each regular payment gets its usual amount and next date. Two new flags:
   - **"Went up"**: the same merchant now charges more than its usual amount (a price rise or a plan change).
   - **"Stopped?"**: a regular hasn't come this cycle.

   Patterns already learns these payments, so this is a better view of data Arth already has.
2. **A spending calendar** on the month story's "biggest day" slide and in Compare: a grid of the month's days shaded by spend. You can see weekends, salary week and quiet streaks at a glance.
3. **"Ask about your money"** at the top of Insights. A search box that takes plain words ("food last 3 months", "Swiggy this year") and opens the matching filtered list. It reuses the on-device search reader from 5.0.0. Without on-device AI it falls back to the patterns Transactions search already understands.

### 2.4 The Insights page after

```
Insights
┌ Your month ─────────────────────────────┐
│ badge · headline · pace + forecast line │
│ three facts · budgets over · story ▶    │
└─────────────────────────────────────────┘
[ Ask about your money…               🔍 ]
Worth a look · 3
  …
Explore
  Money in and out      income, spending, savings rate
  Compare               any two periods
  Year over year        this year against last
  Where it goes         merchants · regulars · bills
  Year in review        your year as a story
  Ask your AI assistant a file for ChatGPT, Gemini or Claude
```

Explore goes from ten rows to six, and the Reports hub goes away. Nothing is lost: everything moved has a home that fits it better.

---

## 3. Numbers that fit

### 3.1 The problem

Amounts like ₹10,77,767.27 and ₹1,59,017.45 break across lines in narrow spaces (the Budget vs actual header and its month rows in the screenshot). The causes:

1. **Paise everywhere.** Summary screens show two decimals that add nothing to a yearly total.
2. **Three equal columns** for three big numbers on a phone, even though one of them is the main figure.
3. **The amount squeezed beside a bar**, so a 12-character figure gets about 110 px.
4. **Nothing stops a number from wrapping.** A number should shrink or shorten, never break.

### 3.2 A Round off setting (Settings → Region)

A new row:

**Paise:** `Show` · `Round off`, with a sample: "₹1,59,017.45 → ₹1,59,017".

- **Round off** rounds to the rupee everywhere amounts are *shown*: lists, cards, charts, reports, Insights.
- Amounts stay exact where exactness matters, whatever the setting:
  - typing or editing an amount
  - the transaction detail screen
  - Update balances and the ledger's opening/closing balance (so they can be matched against the bank)
  - backups and exports (CSV, PDF tables)
- Nothing stored changes. It's display only.
- How: `formatAmount` reads the setting (one place, 760+ callers get it at once). A new `formatExactAmount` is used in the handful of exact places above. The setting goes in `SETTINGS_REGISTRY` as backed up.
- Default: **Round off** for new installs. Existing users keep **Show**, so nothing changes under them without asking.

### 3.3 One way to show an amount: `<Amount>`

A single component used wherever an amount stands alone:

- **One line, always:** `numberOfLines={1}`, tabular digits.
- **Shrink before shortening:** it may shrink down to 85% of its size to fit.
- **Then shorten:** if it still doesn't fit, it switches to the short form (₹10.8L), and tapping it shows the full figure in a small bubble.
- Respects Hide amounts and the currency, as `formatAmount` does.

The existing Region row **Report numbers (Full / Short, tap for full)** becomes **Tight spaces (Full / Short, tap for full)** and applies to every `<Amount>`, not only reports.

### 3.4 Layout rules for screens with several amounts

1. **One hero, the rest below.** A header with three figures shows the main one large on its own line, and the others smaller in a row underneath:

   ```
   Spent this FY
   ₹10,77,767                         114% of budget
   Budget ₹9,43,484 · Over by ₹1,34,283
   ███████████████████████████████████████▌
   ```

2. **The amount on the label line, the bar below it.** Never beside the bar:

   ```
   May                    ₹1.59L of ₹1.05L   152%
   ██████████████████████████████████████ (red)
   ```

   In month rows and category rows the short form is fine: the percentage carries the meaning, and a tap opens the full figures.

3. **Columns get the short form** once a row has more than two amounts (Compare, Year over year, Balance sheet).
4. **Right-align amounts** in lists, so digits line up.

### 3.5 Where to apply first

These screens have three or more amounts per row or header:
- Budget vs actual (moving to Budget)
- Money in and out
- Compare
- Year over year
- Net worth / Balance sheet
- Reports
- the ledger summary card

A guard test like `design-tokens-usage` can stop a raw `formatAmount` inside a `<Text>` that has no `numberOfLines` on these screens.

---

## 4. Order of work

1. **Round off setting + `<Amount>`.** Small, and visible on every screen at once.
2. **Layout rules on the screens in §3.5.** Budget vs actual comes first, since it moves to the Budget tab anyway.
3. **Explore trimmed:** the moves in §2.1.
4. **Improvements** (§2.2).
5. **New things** (§2.3), one per release.

## 5. Questions for you

1. **Budget vs actual into the Budget tab:** as a period switcher on the first page (proposed), or as a fourth swipe page?
2. **Round off default** for new installs: Round off (proposed) or Show?
3. **Retirement readiness:** a Goals → Plan tile (proposed), or keep it in Insights?
