# Settings Rethink + Analyse / Year-over-Year Revamp — Proposal

**Status:** Proposal — awaiting owner approval. No code written (except moving AI Assisted Setup into Automation, done in 54bd865).
**Date:** 2026-10-16

---

## Part A — Settings

### What's wrong today
`app/(tabs)/settings.tsx` is one 1,000-line page:
- **~35 rows in 7 cards.**
- **Three full forms built into the page itself:** SMS Detection (scan range, unrecognised messages, scan history), Duplicate Detection, and the Data Cleanup wizard.
- **Groups that don't match how you think.** For example:
  - "Data Management" mixes setup (Categories, Accounts), money planning (Budget Configuration) and one-off tools (Import, Reconcile).
  - "Automation" mixes SMS reading, rules, merchant naming, reminders, voice and the Audit Log.
- **No status anywhere.** You can't see whether a broker is connected, when you last backed up, or whether app lock is on, without opening each item.

### Proposed: 7 doors and a search box
The Settings tab becomes a short page. Each row opens its own page and shows a **live status line**.

| Row | Status line example | Opens a page with |
|---|---|---|
| 🔍 **Search settings** | — | Type "budget", "backup", "SMS"… and jump straight to the setting |
| ⚠ **Needs attention** *(only when something does)* | "Backup is 12 days old · 4 unread bank messages · Kite needs reconnecting" | Each item opens its fix |
| **Accounts & money** | "9 accounts · 14 categories" | Accounts, Payment modes, Categories, Tags, Budgets |
| **Bank SMS & automation** | "Last scan 2h ago · 6 rules" | SMS reading (scan, look-back, unrecognised, scan history), Smart SMS Templates, Smart Rules, Merchant categories & names, Your name in bank SMS, Duplicate detection, Reminders, Voice input, AI Assisted Setup |
| **Brokers** | "Kite connected · Angel One not set up" | Zerodha, Angel One, ZebPay |
| **Your data** | "Last backup 2 days ago" | Backup & restore, Import from Excel, Reconcile statements, Recycle bin, Clean up data, Audit log |
| **Look & feel** | "Dark · ₹ · FY Apr–Mar" | Theme, Home cards, Region, Notifications, Calendar sync |
| **Security & privacy** | "App lock on" | App lock, What Arth reads and stores, Privacy policy |
| **Help & about** | "Arth 4.17.3" | Help Center, Terms, Open-source licences |

- **Inline forms move to their own pages.** Nothing is lost; the Settings tab just stops being a scroll of forms.
- **Search** covers every setting by name and by common words ("password" → Vault, "export" → Backup).
- **Same screens behind the rows.** Existing setting screens stay as they are; only the way into them changes, so it's low risk.

---

## Part B — Analyse section and Year-over-Year

### What's wrong today
1. **Needs a yearly plan for both years.** Without one it just says "Not enough data". Most people won't have plans for two years, so most people never see it.
2. **Unfair comparison.** It compares *last year in full* with *this year so far*. In October, "Expenses" always looks like it has fallen by about half.
3. **Fixed to two years.** Only this FY against last FY.
4. **Hard to read.** A stack of planned/actual number cards, with no chart and no "so what".
5. **Stuck loader bug.** It has the same bug I just fixed in Yearly Plan (leave mid-load, come back, endless spinner), and it recalculates on every visit.

### Proposed Year-over-Year screen
- **Works from your real data**, with or without a yearly plan. "Planned" figures appear only for a year that has a plan.
- **Fair by default:** this year so far against *the same months last year*, with a "Full years" switch for past years.
- **Pick any two years** (e.g. FY 24-25 vs FY 25-26).
- **Top: one sentence**, e.g. "You're spending 8% less and saving 6 points more than this time last year."
- **Six tiles**, each showing both years and the change: Money in, Spent, Saved (and savings rate), Invested, Loans repaid, Net worth change.
- **Month-by-month chart:** cumulative spending this year against last year on the same months, with drag-to-read like the other charts.
- **Biggest movers:** the categories that went up or down the most, each tapping through to its transactions.
- **Fast reopening:** it only recalculates when your data changes, using the same rule as Balance Sheet and Yearly Plan.

### Proposed Analyse section (Goals tab)
Rows become small live tiles instead of plain links:
- **Year over Year:** "Spending ▼8% vs last year"
- **Year in Review:** "FY 25-26 is ready" (new home for it here, as well as in Reports)
- **Income Calculator:** "Take-home ₹1.42L/month"

---

## Decisions for you
1. Settings: go with the 7 groups above, or would you group anything differently?
2. Settings: is the "Needs attention" row wanted, or should Settings stay purely settings?
3. Year-over-Year: OK to show it without a yearly plan, with plan figures appearing only where a plan exists?
4. Order: Year-over-Year first (smaller), then Settings?
