# Net Worth Over Time + Year in Review — Proposal

**Status:** Proposal — awaiting owner approval. No code written.
**Date:** 2026-10-15
**Build order:** Part A (Net Worth Over Time) first. Part B (Year in Review) uses A's numbers for its "net worth this year" card.

---

## 0. Facts this proposal is built on

Checked in code on 2026-10-15:

1. `getBalanceSheetColumn(userId, asOfDate, …)` in `services/balance-sheet.ts` already computes total assets, liabilities and net worth **for any date**: bank, wallet, pension, FD, demat/market investments, credit cards, loans and Hisaab owed/owes. The Balance Sheet screen uses it for FY-end columns plus "Today". **So most of the data for a net worth history already exists. It just isn't shown as a trend.**
2. **Two gaps make it wrong for history as-is:**
   - `loadAccounts` skips closed accounts (`closed_at IS NULL`). A savings account you closed in July 2026 would vanish from *every* past month, so your history would show a fake drop.
   - Demat/market values come from snapshots. For a historic column only snapshots inside `[minDate, asOfDate]` count, so a month with no snapshot shows the account as missing (another fake drop).
3. Charts already in the app: `TrendLineChart`, `StackedAreaChart`, `TrendBarChart`, `DonutChart` (all `react-native-svg`). `SwipePager` exists for swipeable pages.
4. Sharing: `expo-sharing` and `expo-print` (PDF) are installed. **Nothing can turn a screen into an image yet.** That needs `react-native-view-shot`, a new native library.
5. Existing pieces Year in Review can reuse: savings rate (Goals → Financial Health), merchant analysis (`insights/merchants`), category breakdown, YoY comparison, loan engine (principal paid), investment bucket contributions, Hisaab settlements.

---

## Part A — Net Worth Over Time

### What you see
On **Goals → Balance Sheet**, a new card at the top:

```
NET WORTH                         ₹ 38.4 L
▲ ₹ 3.2 L since 1 Apr (FY 26-27)

   [ line chart: one point per month-end ]
   6M · 1Y · 3Y · All

   Saved from income      + ₹ 2.6 L
   Market gains           + ₹ 0.9 L
   Loans paid down        + ₹ 0.4 L   (liability fell)
   Other                  − ₹ 0.7 L
```

- Tap a point on the chart → that month's full balance sheet (it opens the existing column view for that date).
- Optional second view: stacked area chart of **Assets vs Liabilities** (toggle).
- The Goals tab's Balance Sheet row also shows a small "▲ ₹3.2L this FY" line next to the net worth.

### How it's computed — no new table
One `getBalanceSheetColumn` call per month-end (the last day of each month, plus today). So:
- **Always consistent** with the Balance Sheet screen. Fix an old transaction and the history corrects itself.
- **Nothing new in backup/restore**, because nothing is stored.

Speed: each column is ~5 batched queries. 12 months ≈ 60 queries, 36 months ≈ 180. That's fine if we load it after the screen appears (same pattern as Goals' balance sheet). The result is cached in memory and keyed by `dataVersion`, so it recomputes only after something changes.

*Alternative (not recommended):* store a monthly `net_worth_snapshots` row. That freezes history at the time of capture, so later corrections never show. It also needs a migration + TABLE_SCHEMAS + BACKUP_TABLES entry.

### Fixes needed in `services/balance-sheet.ts`
1. **Closed accounts:** include an account in a column if it was open on that date (`closed_at IS NULL OR closed_at > asOfDate`). The Balance Sheet's "Today" column behaves exactly as now.
2. **Demat/market gaps:** for history, carry the latest snapshot on or before the date forward, even from an earlier month. Mark it `isFallback` so the chart can show that point as "estimated" (hollow dot). If no snapshot exists *before* the date at all, the account is left out, same as today.
3. Start the chart at the **first month you have any activity**, not before (so there's no long flat zero line).

The current FY-column behaviour of the Balance Sheet screen stays untouched. The new behaviour sits behind a new parameter (e.g. `mode: "history"`).

### The "where did it come from" split
| Line | Computation |
|---|---|
| Market gains | Change in demat/market value − net money moved into those accounts (transfers in − withdrawals) |
| Loans paid down | Fall in loan liabilities over the period |
| Saved from income | Change in bank + wallet + FD + pension balances, net of money moved to investments |
| Other | Whatever's left (Hisaab, credit card utilisation swings, rounding) |

The lines always add up exactly to the net worth change. If the market line can't be computed reliably for an account (no snapshots), the change goes into "Other" with a small note.

### Files
- `services/balance-sheet.ts` — history mode (fixes 1–2)
- `services/net-worth-history.ts` — **new**: month-end series + change breakdown + cache
- `components/goals/NetWorthTrendCard.tsx` — **new**
- `app/goals/balance-sheet.tsx` — add the card; tapping a point opens that date's column
- `app/(tabs)/goals.tsx` — "▲ this FY" line on the Balance Sheet row
- Tests: series over a closed account, demat carry-forward, the breakdown summing exactly

**No database change.**

---

## Part B — Year in Review (your financial year, wrapped)

### What you see
A full-screen, swipeable story of one financial year (Apr–Mar), one card per page:

1. **Your FY 25-26** — total spent, total received, number of transactions (and how many Arth caught from SMS automatically)
2. **You saved X%** — savings rate vs your target, vs last year
3. **Net worth** — start → end of year, mini chart *(from Part A)*
4. **Where it went** — top 5 categories, donut
5. **Your favourite places** — top 5 merchants by spend + most visits ("Swiggy, 142 orders")
6. **Biggest & quietest month** — bar chart across 12 months
7. **Debt down** — loan principal paid this year, EMIs on time
8. **Invested** — contributions to investment buckets, FDs opened
9. **Hisaab** — settled with N people, net owed at year end
10. **vs last year** — 3 biggest changes (e.g. "Dining out ▲ 38%")
11. **Share** — share any card or the whole summary

Cards with no data are skipped (e.g. no loans → no "Debt down" card).

### Where it lives
- **Insights → Reports → Year in Review**, with a FY picker (any past FY, plus the current FY "so far").
- **Home card from 1 April for 30 days:** "Your FY 25-26 in review is ready". It can be dismissed (MMKV key, added to `SETTINGS_REGISTRY`).
- Optionally a reminder notification on 2 April (uses the existing notifications setup; off by default).

### Sharing — privacy first
- **"Hide amounts" is ON by default** when sharing: ₹ figures become percentages, ranks and trends ("Saved 31% of income", "Top category: Groceries"). You switch it off to share real numbers.
- Two ways to share (owner decision below):
  - **Image** (Instagram/WhatsApp-friendly). Needs `react-native-view-shot`: a new native library, so an R8 keep-rule check and a release-build test on the Pixel before shipping.
  - **PDF** using `expo-print`, which is already installed and used by the other reports. No new library, but less fun to share.

### Files
- `services/reports/year-review.ts` — **new**: one function that builds all card data for a FY (reuses the analytics, merchants, loan, bucket and Hisaab services; net worth from Part A)
- `app/insights/year-review.tsx` — **new**: `SwipePager` story
- `components/year-review/*` — **new**: one component per card
- `app/insights/reports.tsx` — add the entry
- Home card + MMKV dismissal key (+ `SETTINGS_REGISTRY` entry)
- Tests: card data for a sample FY, empty-card skipping, hide-amounts output never contains a ₹ figure

**No database change.**

---

## Decisions for you

1. **Net worth history:** compute it live from your transactions (recommended), or freeze a monthly snapshot?
2. **Year in Review sharing:** image (needs a new library + Pixel test), PDF only, or both?
3. **Home card on 1 April:** yes / no?
4. **Bank fees card in Year in Review:** only possible if we also build idea #2 (Hidden bank charges). Skip it for now?

## Rough size
- Part A: medium. Most of the work is the two history fixes and the breakdown math.
- Part B: medium-large. The data comes from existing services; the work is the 10 card designs.
- Suggested: ship A as one release, B as the next.
