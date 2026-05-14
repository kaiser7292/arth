---
title: Reconciling a ledger
slug: reconciliation
summary: Match Artha's running balance against your bank statement and fix the first date where they diverge.
tags: [reconciliation, ledger, balance, audit, mismatch, statement]
contextKeys: [account-ledger, reconciliation, settings-reconciliation]
phrasings:
  - My bank balance doesn't match Artha
  - Reconcile an account
  - Running balance is off
  - Find missing transactions
  - Why does the ledger not tally?
  - Statement vs Artha
  - Check account ledger
  - Auto-detected balance is stale
  - How does the ledger compute balance?
  - Why is the credit card utilized wrong?
---

Every account has a ledger view — a running balance starting from an opening figure and applying expenses, credits, and transfers in date order. When your bank's number differs from Artha's, reconciliation is how you find and fix the gap.

## Where to find the ledger

Four paths:
- **Home tab → Account card → tap**.
- **Settings tab → Master Data → Accounts → tap an account → View Ledger**.
- **Settings tab → Master Data → Accounts → [Bank Accounts / Credit Cards / Wallets / Demat]** → tap any account → opens the ledger.
- **Transactions tab → tap an expense → Account → View Ledger**.

## How the running balance is computed

Artha never "stores" a balance — it computes it per month:

**Savings / Wallet / Loan:**
```
closing = opening − expenses + credits − transfers_out + transfers_in ± adjustments
```

**Credit card:**
```
closing (= utilized) = opening + expenses − credits + transfers_out − transfers_in ± adjustments
available = credit_limit − closing
```

For a credit card, the **Balance Source Card** on account-detail shows:
- **Calculated** — authoritative (ledger math above). For pools, it's `sharedLimit − Σ utilized`.
- **Auto-detected** — whatever the latest SMS reported as available credit.

The two should match. If they don't, either an SMS wasn't parsed, or a charge/payment happened outside the app.

## Reconcile step-by-step

1. Open the account's ledger.
2. Scroll to the earliest date where your bank statement and Artha's running balance **agree** — that's your baseline.
3. Scroll forward from there; the first row where they disagree is where to focus.
4. Possible causes:
   - **Missing expense** — an SMS never arrived or was rejected. Add it: **+ Add Entry** on the ledger.
   - **Missing credit** — a refund or salary credit that didn't come through SMS. Add it the same way.
   - **Duplicate** — one transaction entered twice. Delete the extra.
   - **Wrong direction** — an expense that should be a transfer (money moved to your own other account). Edit the expense → **Mark as Transfer**.
   - **Wrong amount** — edit the row.
   - **Wrong date** — edit the date; the running balance will recompute.
5. Repeat until the ledger matches for the current month.

## Set / change the opening balance

1. Open the ledger → top of the month.
2. Tap **Edit Opening Balance**.
3. Enter the figure from your bank statement for that month-start.
4. Save. The ledger recomputes forward from there.

## Balance adjustments (nuclear option)

If the mismatch is unresolvable (bank charges you can't identify, legacy transactions, etc.), use a **Balance Adjustment**:

1. Account detail → **Adjust Balance**.
2. Pick direction (+ raise / − lower).
3. Enter the gap amount and a note.
4. Save.

This creates a ledger-adjustment row (visible in the ledger tagged "[Balance Adjustment]"). It doesn't affect budget; it keeps the ledger honest.

## Tappable rows on the ledger

- **Expense rows** — tap to open the expense detail.
- **Credit rows** — tap to edit, OR if the credit is a hisaab settlement, tap the **HISAAB · [person]** pill to jump straight to that person's hisaab ledger. Credits with a settlement link show the pill and the chevron.
- **Transfer rows** — if the transfer was reclassified from a bank SMS (e.g. "Mark as CC Bill Payment" on a detected credit), tap to open the **Source SMS** viewer. Shows the full original SMS body + sender ID so you can audit what triggered the transfer. A blue "SMS" pill indicates a transfer has this trace.
- **Plain manual transfers** — no chevron, no tap action. Delete only.

## Common situations

**"Bank says I have ₹X, Artha shows ₹Y. Where do I look?"**
Check the **Balance Source Card** on the account-detail screen. If it says "stale" or shows a mismatch warning, Artha's calculated number is authoritative — a purchase or refund happened after the last balance SMS. Reconcile by scrolling the ledger for the missing row.

**"Credit card utilized keeps changing."**
The card's utilized changes every time you log an expense or credit on it. That's correct behavior — the "stored" utilized (in the SMS) is a point-in-time snapshot; the ledger utilized is live.

**"My auto-detected balance is marked stale but nothing happened on the card."**
Check if a **transfer** was recorded on the card after the last balance SMS (payments often flow as transfers from savings). Settings tab → Master Data → Accounts → Credit Cards → tap the card → check recent transfer rows. Any transfer on the card after the last balance SMS flags the balance as stale — that's intentional.

**"Is there a history of adjustments?"**
Yes — Settings tab → Master Data → Accounts → scroll any account type's summary; the "Drift" column shows your total adjustments for the current month.

## Related
- How pool (shared-limit) credit cards are handled: [Accounts and balances](accounts)
- Why SMS and ledger can disagree: [How SMS detection works](sms-detection)
- Restoring a mistakenly-deleted expense: [Recycle bin](recycle-bin)
