---
title: Notifications and the home screen widget
slug: notifications
summary: Approve or reject new bank transactions straight from a notification, get a daily digest of dues, and keep an Arth widget on your home screen.
tags: [notifications, alerts, approve from notification, new transactions, daily digest, dues, overdue, backup notification, widget, home screen widget, app lock]
contextKeys: [notifications, settings-notifications, widget]
phrasings:
  - How do I turn on notifications?
  - Approve a transaction from the notification
  - Notification for every bank SMS
  - Stop transaction notifications
  - Why doesn't the notification show the amount?
  - Daily digest notification
  - Reminder for bills due
  - Overdue payment notification
  - Backup completed notification
  - Add Arth widget to home screen
  - Home screen widget
  - N to catch up widget
  - Notifications are late
---

Arth can tell you about new transactions and upcoming dues without you opening the app. All notifications are created on your phone - there's no server sending them.

## Choose your notifications

**Settings tab → Preferences & Security → Notifications.** Turn on any of these:

- **New Transactions** - Arth checks your bank SMS in the background (about every 30 minutes) and notifies you about anything new, with **Approve** and **Reject** buttons.
- **Upcoming Dues** - a daily digest at **9:10 AM** for payments due within 2 days.
- **Overdue Payments** - a daily digest at 9:10 AM when payments are overdue.
- **Auto Backup** - tells you when a scheduled backup has been saved. See [Backup and restore](backup-restore).

If Android's notification permission is off, Arth asks you to turn it on in your phone's settings.

## Approve or reject from the notification

A new-transaction notification reads like "₹1,240 at Swiggy". Tap **Approve** or **Reject** and it's done - the app doesn't open.

- Up to 3 new items each get their own notification.
- More than that arrive as one "N new transactions" notification. Tap it to open [Catch Up](catch-up).

Background checks run roughly every 30 minutes, but Android decides the exact timing and may wait longer when your battery is low. [SMS detection](sms-detection) must be on.

### With app lock on

If you use [app lock](biometric-lock), notifications show **no amount, no merchant and no buttons**. Otherwise anyone holding your locked phone could read your spending or approve items. Tap the notification and unlock Arth to review.

## Home screen widget

Add the Arth widget from your phone's widget picker (long-press the home screen → Widgets → Arth). It shows:

- how many items are waiting - "12 to catch up" - or **All caught up**, and
- how much you've spent this month.

Tap it to open [Catch Up](catch-up). The count includes pending bank transactions and items that need a category; possible duplicates are only shown inside the app. The widget refreshes about every 30 minutes and whenever you use Arth.

If [Hide amounts](home-cards) is on, the widget hides the spent figure too.

## Common situations

**"I don't get new-transaction notifications."** Check that **New Transactions** and SMS detection are both on, that Android allows Arth's notifications, and that battery optimisation isn't stopping Arth from running in the background.

**"The digest didn't come at 9:10."** Android may delay scheduled alerts on battery saver. Opening Arth reschedules the digest.

**"The widget says Open Arth to load."** Open the app once so the widget can read your data.

## Related

- [Catch Up - review one card at a time](catch-up)
- [The review queue](review-queue)
- [Calendar sync](calendar-sync)
- [Locking the app with Face/Fingerprint](biometric-lock)
