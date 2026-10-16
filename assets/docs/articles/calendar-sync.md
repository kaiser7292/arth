---
title: Calendar sync
slug: calendar-sync
summary: Put upcoming bills, card dues, EMIs, reminders and FD maturities into your phone's calendar - one way, no server.
tags: [calendar, calendar sync, google calendar, bills, dues, EMI, reminders, FD maturity, events, alerts]
contextKeys: [calendar-sync, settings-calendar]
phrasings:
  - Add bills to my calendar
  - Sync dues to Google Calendar
  - Show EMIs in calendar
  - Calendar sync not working
  - Events disappeared from calendar
  - Which calendar does Arth use?
  - Arth calendar not showing
  - Hide amounts in calendar events
  - Remove Arth events from my calendar
  - Calendar permission
---

**Calendar sync** puts your upcoming money dates into a calendar on your phone, so they show up next to everything else in your day. Each one is an all-day entry at the top of its day, marked "free", so it reads like a task and doesn't block out time or make you look busy. Each has two alerts, at 9:00 the morning before and 9:00 on the day (how the second one behaves depends on your calendar app).

## Turn it on

1. **Settings tab → Preferences & Security → Calendar sync.**
2. Turn on **Sync to calendar**. Android asks for calendar permission - allow it.
3. Choose a calendar:
   - **Arth (this phone only)** - a separate calendar that never leaves the phone. It shows in any calendar app on this phone.
   - **One of your own calendars**, such as your Google calendar. Android's own Google sync then copies the events to your other devices.

## What gets added

Pick any of these:

- **Dues & card bills** - forecasted payments and credit card bills.
- **Loan EMIs** - scheduled instalments on active loans.
- **Reminders** - your recurring payment reminders.
- **FD maturities** - when a fixed deposit matures.

Arth adds events for the **next 90 days**. Dues that are already overdue aren't added, because an alert for a past date can't go off.

**The name** comes from the description you gave the bill or reminder ("Flat maintenance"). If it has no description, Arth uses the merchant.

**The details** inside each entry say what it is, the merchant (when the name doesn't already say), the category and account where Arth knows them, how often a reminder repeats, and the amount (unless you've hidden amounts). The last line is a short reference like [arth:due:…]: it's how Arth recognises its own entries, so leave it in. Mark things paid in Arth; the entry updates on the next sync.

**Show amounts** - when on, events read like "Arth · HDFC card bill · ₹12,400" and the details include the amount. Turn it off and neither shows it.

Arth can't add these as Google Tasks: tasks belong to Google's own service, and Arth never signs in to Google or sends it anything.

## When it syncs

Arth updates the calendar when you open the app, during its background checks, and whenever you tap **Sync now**. Events are updated in place - paid bills are removed, changed dates move - so you don't get duplicates.

The screen shows what the last sync did, for example "3 events in Personal: 2 bills & dues, 1 EMI", or the error if it failed.

## Privacy

Sync is **one way**: Arth writes to the calendar and never reads your other events. Arth doesn't talk to Google or any server. If you choose a Google calendar, it's Android that uploads the events to your Google account, like any other event you create. Choose **Arth (this phone only)** to keep them on the phone.

## Turn it off

Turn off **Sync to calendar**. Arth removes the upcoming events it added.

## Common situations

**"Nothing was added."** You may have no bills, EMIs, reminders or FD maturities in the next 90 days - the screen says so. Also check that at least one type is switched on.

**"Permission needed."** Calendar permission is off. Turn it on in Android settings → Apps → Arth → Permissions.

**"The chosen calendar isn't available any more."** The account behind it was removed from the phone. Pick another calendar.

**"I edited an event in my calendar and it changed back."** Arth owns the events it adds and overwrites them on the next sync. Mark a bill paid, or change a reminder, in Arth instead.

**"I restored a backup on a new phone."** Calendar settings stay on each phone. Turn sync on again on the new phone.

## Related

- [Reminders for recurring payments](reminders)
- [Loans and EMI tracking](loans)
- [Investments and fixed deposits](investments)
- [Notifications and the home screen widget](notifications)
