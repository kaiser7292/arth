---
title: Duplicate expenses
slug: duplicate-detection
summary: When two SMS land for the same transaction, Artha groups them and lets you resolve the group in one tap.
tags: [duplicates, merge, sms, cleanup, review]
contextKeys: [duplicates-list, settings-duplicates, review-queue]
phrasings:
  - Why do I have the same expense twice?
  - Same transaction appears twice
  - Duplicate SMS
  - Merge duplicate expenses
  - My bank sent two SMS for one payment
  - Credit card bill showing twice
  - How does Artha detect duplicates?
  - Dismiss a duplicate group
  - Restore a dismissed duplicate
  - Where are my duplicates listed?
---

Banks often send more than one SMS for the same transaction — one from the card issuer, another from the merchant network, or one for "amount due" and another for the actual debit. Artha groups these so you can approve the real one and reject the rest in a single step.

## Where to find duplicates

- **Home → Review Queue → Duplicates filter chip.**
- **Settings tab → Duplicate Detection panel** — shows "X groups pending" when there are any.
- **Settings tab → Backup & Storage → Dismissed Duplicate Groups** — groups you previously marked "Keep both" live here and can be restored.

## How Artha detects duplicates

Two expenses are grouped when **all four** match:
- **Same account** (or same card)
- **Amount within ±1% and ≤ ₹5 difference**
- **Dates within 3 days of each other**
- **Merchant name similar** (normalized — "SWIGGY", "Swiggy Food", "PYU*SWIGGY" are treated as one)

Split-tender legs are intentionally excluded — legs of the same purchase are NOT flagged as duplicates.

Refunds (credits pointing at an expense) are excluded too — a ₹500 debit and a ₹500 refund aren't duplicates.

## Resolve a duplicate group

Open **Review Queue → Duplicates**. Each group shows its members with the oldest-created row at top.

**Per group:**
- **Keep oldest, reject others** — the first-created row stays; the rest go to the recycle bin (recoverable for 30 days).
- **Keep both** — marks the group as "not a duplicate". It won't be flagged again even if rescanned.
- Tap any individual row to open it; you can also tap **Reject** on just one.

**Bulk action:**
- **Resolve All N Groups** button at the top — applies "keep oldest" to every group at once.

## Undo

- "Keep both" mistake → **Settings tab → Backup & Storage → Dismissed Duplicate Groups** → tap a group → **Restore**. It re-enters the duplicates review.
- Rejected the wrong one → **Settings tab → Backup & Storage → Recycle Bin → Rejected** → tap the expense → **Approve**.

## Common situations

**"My credit card bill generated two SMS — one from the card and one from the merchant."**
This is the classic duplicate. Keep oldest, reject the other. The kept one enters your budget.

**"I transferred via UPI and got two SMS — one from my bank and one from the UPI app."**
Same thing. Usually the bank SMS is more accurate (has the right merchant name). Tap that one to edit, then reject the UPI app's SMS.

**"A duplicate pair doesn't show up here."**
Check the four match conditions. If the dates are 4+ days apart or amounts differ by more than ₹5, Artha won't auto-group. Log a manual delete instead.

**"Scanned the same SMS twice."**
Artha deduplicates incoming SMS before creating expenses (same sender + same body + same timestamp = one row). If you see actual exact-copies, it's more likely two SMS with near-identical text from different providers — that's what duplicate detection handles.

**"I paid a refund, and now the refund shows up as duplicate of the original."**
Refunds (credits with `refund_of_expense_id`) are explicitly excluded from duplicate detection. If you're still seeing this, the refund row may not have been linked — open the refund expense and check its "Refund of" row.

## Related
- SMS parsing rules: [How SMS detection works](sms-detection)
- Merchant-name variants: [Fixing merchant names](merchant-aliases)
- Restoring rejected expenses: [Recycle bin](recycle-bin)
