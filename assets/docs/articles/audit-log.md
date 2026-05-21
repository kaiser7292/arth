---
title: Audit Log — see every action taken
slug: audit-log
summary: A single timeline of every action on detected and manual records — approved, rejected, deleted, marked as transfer, marked as settlement, reclassified by a rule, and more. Filter by source, action, type, or date range.
tags: [audit, log, history, review, decisions, actions, detected, manual, trail, sms, retrospective]
contextKeys: [settings-audit-log]
phrasings:
  - What's the audit log?
  - See past decisions
  - History of actions
  - Show me what I approved last week
  - What SMS did I reject?
  - Retrospective on detected expenses
  - Undo log
  - What happened to my data?
  - Where did this credit go?
  - Show deleted expenses
  - Why is my data different than I remember?
  - UI audit log screen
---

The Audit Log is a read-only timeline of every action you've taken on records in Arth — both the ones Arth auto-detected from SMS and the ones you entered manually. Designed for retrospective cleanup and for answering "wait, what happened to that ₹50,000 credit last Thursday?"

## Where to find it

**Settings tab → Automation → Audit Log.**

## What counts as an "action"

- **Approved** — you approved an SMS-auto-detected item in the review queue.
- **Rejected** — you rejected an SMS item, or dismissed an expense forecast.
- **Created** — you manually added an expense, credit, or transfer.
- **Deleted** — you deleted a record (soft delete — still in Recycle Bin until purged).
- **Marked as Transfer** — you reclassified an expense or credit as an inter-account transfer.
- **Marked as CC Bill** — you paid a CC repayment forecast, or reclassified an incoming credit on a credit card.
- **Marked as Settlement** — you linked an incoming credit to a hisaab person as a settlement.
- **Linked to Reminder** — an expense was matched to a recurring reminder.
- **Reclassified by Rule** — a smart rule auto-categorized an expense.
- **Refunded** — you recorded a refund against an earlier expense.

Each row shows the action in a coloured pill, a short description, the amount, the source (SMS / manual), the object type (expense / credit / transfer / hisaab / forecast), and the date. Tappable rows open the underlying record.

## Filters

At the top of the screen you can scope by:

- **Date range** — 7 days / 30 days / 90 days / this year / all time. Defaults to 30 days.
- **Source** — SMS (bank auto-detection) vs Manual (you typed it in). Multi-select.
- **Type** — Expenses, Credits, Transfers, Hisaab settlements, Forecasts. Multi-select.
- **Action** — any of the actions above. Multi-select.
- **Search** — free-text against merchant name, description, and account label.

The filter panel is collapsed by default; tap "Add filters" to expand. Tap "Clear" to reset everything.

## Common things you can do with it

**"I want to review all SMS I rejected last month to make sure I didn't drop anything important."**
Date: 30 days → Source: SMS → Action: Rejected. Scan the list, tap any to inspect.

**"Which credits did I convert to transfers? Were those the right calls?"**
Source: SMS → Action: Marked as Transfer. Tap each to see the underlying transfer in the account ledger.

**"What happened to my ₹50,000 settlement credit last week?"**
Type: Credit + Hisaab → last 7 days. Tap the entry to deep-link to the person's hisaab ledger.

**"Did smart rules stomp anything they shouldn't have?"**
Action: Reclassified by Rule. Scan the list, edit any miscategorized ones. You can also open the originating smart rule from Settings tab → Automation → Smart Rules and tighten its matcher.

## What it's NOT

- Not a detailed edit history — Arth doesn't version fields per edit. It just tracks the "current action state" of each record.
- Not a time-stamped event stream — the "when" is the record's `updated_at`, not when you tapped the button.
- Not a hard-delete restorer — once a record is past 30 days in the Recycle Bin it's gone from the audit log too.
- Not a bulk-action tool — it's read-only. To undo something, open the record and take the opposite action.

## Tips

- **If the log feels empty**, widen the date range. Default is 30 days.
- **If an action doesn't show up as expected**, check whether the record is in the Recycle Bin — soft-deleted rows show up as "Deleted" entries here.
- **Rows are capped at 500** per view to keep it fast. If you hit the cap, narrow the date range.

## Related

- See the trash: [Recycle Bin](recycle-bin)
- How SMS becomes an expense in the first place: [How SMS detection works](sms-detection)
- Rules that auto-categorize: [Smart Rules](smart-rules)
