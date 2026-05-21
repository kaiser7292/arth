---
title: The review queue
slug: review-queue
summary: One place to approve, reject, or clean up auto-detected expenses, forecasts, duplicates, and uncategorized items.
tags: [review, sms, pending, approve, forecast, duplicates, uncategorized]
contextKeys: [review-queue, home]
phrasings:
  - What is the review queue?
  - Where are my auto-detected expenses?
  - Why don't SMS expenses show in my list right away?
  - How do I approve pending expenses?
  - Reject an SMS that isn't a real expense
  - Batch approve auto-detected expenses
  - Resolve duplicates
  - Dismiss overdue forecasts
  - Assign a category to many expenses at once
  - What does "matched forecast" mean?
  - Record a refund already captured
---

The review queue is the single screen where you clean up anything Arth couldn't act on automatically — auto-detected expenses waiting for your OK, forecasts that look like they already happened, possible duplicates, and expenses with no category yet.

## Where to find it

1. Open the **Home** tab.
2. Tap the **Review Queue** card near the top. When there are items to review, the card shows a count; when you're caught up, it shows a green tick and no count.

You can also open it from:
- **Home** → the "pending" chip inside the month-spend ring
- **Settings tab** → "SMS Detection" section → "Review now"
- **Settings tab** → "Possible Duplicates" panel → opens the queue filtered to Duplicates
- **Budget tab** → "Uncategorized" card → opens the queue filtered to Uncategorized

> Note: the review queue is **not** on the Transactions tab. Approved expenses go straight into Expenses; pending items live here until you act on them.

## What the screen shows

- **Summary banner** (blue) — total count of items to review.
- **Filter chips** row — "All", "Auto-Detected", "Matches", "Overdue", "Upcoming", "Duplicates", "Uncategorized". Each chip shows the count for that section. Tap a chip to narrow the list to that section only.
- **Refresh button** (top-right, ⟲) — scans SMS again and refreshes the list.
- **"How reviews work" chip** — opens this article.
- **List** — grouped by section when "All" is active; flat list when a single filter chip is active.

## Each section, what it means, what to do

### Auto-Detected
SMS entries Arth parsed into an expense or a credit. They are NOT in your ledger yet.
- **Green tick** (per row) → approve. The expense enters your budget, category totals, and account balance.
- **Red cross** (per row) → reject. The row is kept in the recycle bin for 30 days but does not count anywhere.
- **Approve All / Reject All** buttons at the top of this section.
- Tap a row to edit merchant, amount, category, account, or payment mode **before** approving.

### Matches
Arth noticed an auto-detected expense that looks like an existing forecast (same merchant, similar amount, near the due date). Three options per match:
- **Realize** — the forecast is replaced by the realized expense. Use when the forecast predicted this exact payment.
- **Already captured** — you already logged this manually. Drops the auto-detected copy.
- **Both different** — they are separate transactions. Keeps both.

### Overdue
Forecasts whose due date has passed and no matching expense was found.
- **Dismiss N Overdue** button rejects all overdue forecasts in one tap — use this at month-end to clear stale predictions.
- Or tap each one individually and approve (to log it as a real expense) or reject (didn't happen).

### Upcoming
Forecasts due today or later. These just sit here so you know what's coming. No action required unless you want to cancel one.

### Duplicates
Two or more expenses that look like the same transaction (same amount + same merchant or card, dates within a few days).
- **Keep oldest, reject others** → the first-created row stays; the rest go to the recycle bin.
- **Keep both** → marks this group as "not a duplicate" so it never re-appears.
- **Resolve All N Groups** button at the top applies "keep oldest" to every group.

### Uncategorized
Realized, approved expenses that never got a category.
- **Long-press or tap the checkbox** to select rows. Use **Select All** if everything goes into the same bucket.
- Tap **Assign Category to N Expense(s)** at the bottom to batch-categorize. After three picks for the same merchant, Arth learns the pattern and future expenses come in pre-categorized.

## Common situations

**"I approved a wrong SMS by mistake."**
Open **Settings tab → Backup & Storage → Recycle Bin → Rejected**, find it, tap **Approve** — it returns as a normal expense. If the expense was approved and you want to revert: open it from the Transactions tab and tap **Delete**; it moves to the recycle bin.

**"I want auto-detection but not auto-approval."**
That's the default. Auto-approval is not offered — every first touch is manual so you catch parser mistakes.

**"The review queue keeps showing forecasts I already paid."**
If the payment came via SMS, let the "Matches" section handle it (tap "Realize"). If you paid manually, approve the forecast anyway — the amount enters the ledger and the forecast clears.

**"I have 200+ uncategorized from an excel import."**
Use **Filter chip: Uncategorized** → **Select All** → pick the most common category. Repeat a few times with subsets. Arth does not bulk-categorize by merchant yet, but smart rules (Settings tab → Automation → Smart Rules) can auto-categorize future imports.

## Related
- Read about auto-categorization and how Arth learns: [Categories and how they're decided](categories)
- Set up automatic rules for recurring patterns: [Auto-categorize with smart rules](smart-rules)
- Understand duplicate detection: [Duplicate expenses](duplicate-detection)
- How SMS parsing works on-device: [How SMS detection works](sms-detection)
