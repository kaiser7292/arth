---
title: The Recycle Bin - restore or permanently delete
slug: recycle-bin
summary: Soft-deleted expenses, credits, transfers, and hisaab people live here for 30 days. Restore, permanently delete, or let them auto-purge.
tags: [recycle-bin, trash, deleted, restore, undelete, purge, soft-delete, rejected, undo]
contextKeys: [settings-recycle-bin, settings-backup]
phrasings:
  - Where do deleted expenses go?
  - Restore a deleted expense
  - Undelete something
  - Accidentally deleted an expense
  - Permanently delete expenses
  - Empty the recycle bin
  - How long before deleted items are gone?
  - 30 days auto-purge
  - Restore a rejected SMS
  - Bring back a deactivated person
  - Is delete undo-able?
  - UI recycle bin
  - Recycle bin filters
  - Recurring filter recycle bin
  - Where can I find previous deletes?
---

Deleting in Arth is a **two-stage** process. A first delete moves the item to the Recycle Bin (soft delete). Everything in the Recycle Bin can be restored. After 30 days, items are auto-purged (permanent deletion). You can also purge manually earlier.

## Where to find it

**Settings tab → Backup & Storage → Recycle Bin.**

## What shows up here

- **Expenses** - anything you deleted from the Transactions tab or expense detail.
- **Credits** - deleted incoming-money rows (salary, refunds, settlements).
- **Transfers** - deleted inter-account transfers.
- **Hisaab people** - deactivated persons (soft-delete). Their entries stay linked until the person is purged.
- **Rejected review-queue items** - auto-detected SMS expenses you rejected. These count as "deleted" for the queue but live in Recycle Bin → **Rejected** tab.
- **Recurring** - deleted auto-detected recurring patterns (not reminder rules - those are different). Useful for cleanup after wrong auto-detection.

## Filter tabs

Top of the screen has filter chips:

- **All** - everything in the bin.
- **Expenses / Credits / Transfers / People** - by type.
- **Rejected** - items rejected from the review queue.
- **Recurring** - deleted auto-detected recurring patterns.

## Actions per item

Tap any row in the list to see its actions. There are two per item:

- **Restore** - puts the item back where it came from. All linked relationships are rebuilt:
  - Restoring a **split expense** restores all its legs together (split-tender).
  - Restoring a **hisaab person** re-activates their ledger; past entries re-link correctly.
  - Restoring a **transfer that had demat side-effects** (categorised as fund or portfolio) restores those side-effects too - bucket totals, contribution rows, milestones.
  - Restoring an **expense that fulfilled a reminder** re-links the fulfillment; the reminder's next-due advances back.
- **Permanently Delete** - removes the row and all its inbound references (hisaab entries pointing at the credit, reminder fulfillments, purchase-group stamps, etc.). **Irreversible.**

## Bulk actions

Top-right menu on the screen:

- **Restore All** (on each filter tab) - restores everything currently visible on that tab.
- **Empty All** - permanently deletes everything in the bin. Asks for a confirm, then wipes.

## Auto-purge

Anything older than **30 days** is auto-purged on app launch. You don't have to do anything - it's housekeeping. The 30 days are counted from the `deleted_at` timestamp, not the original transaction date.

If you want to purge sooner, use **Empty All** or individual Permanently Delete.

## What's NOT in the recycle bin

Some things are deleted hard, without a recycle-bin stop:

- **Budgets** - deleted budgets are permanent. Be careful.
- **Accounts** - deleted accounts are permanent. Their linked expenses survive but lose the account link. Prefer **Deactivate** over Delete.
- **Smart rules** - deleted smart rules are permanent. Their stamped `applied_rule_id` on past expenses remains (for audit) but the rule itself is gone.
- **Reminder rules** - stopping a reminder doesn't soft-delete it (it becomes inactive). Restarting is a matter of re-tapping **Set reminder** on the source expense.

## Common situations

**I accidentally deleted my rent expense.** Recycle Bin → Expenses → find it → **Restore**. Its fulfillment link to the Reminder (if any) comes back automatically.

**I rejected an SMS in Review Queue but actually wanted to keep it.** Recycle Bin → Rejected → find it → **Approve** (same as tapping Approve in the Review Queue).

**I deleted a hisaab person by mistake. Are their entries gone?** The person record is soft-deleted; their entries live on but are orphaned from the UI. Restore the person from Recycle Bin → People and all the entries re-appear in their ledger.

**Empty All permanently deleted everything and now my reminders are broken.** Deleting an expense that was the **source** of a reminder auto-stops the reminder (the reminder is attached to the source expense). If you want the reminders back, restore the source expense from Recycle Bin BEFORE emptying. Once it's hard-deleted, the chain is gone.

**I can't restore something - the Restore button is greyed out.** Usually means a required parent was permanently deleted. Example: restoring an account-transfer after the source account was hard-deleted. Fix: restore the account first, then the transfer.

## Related

- [The review queue](review-queue)
- [Hisaab - shared accounts](hisaab)
