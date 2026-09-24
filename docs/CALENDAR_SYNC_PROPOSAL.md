# Calendar Sync — Proposal

**Status:** Approved 2026-09-24, implemented in the same change.
**Owner:** Sourav

## Goal

See Arth's upcoming money dates (card bills, dues, EMIs, reminders, FD maturities) in the
calendar you already look at, with a reminder the day before, without Arth talking to any
server.

## How it works

Android keeps one shared calendar store on the phone (`CalendarContract`). Every calendar app
reads and writes it. When you're signed into Google, Android's own Google sync mirrors your
Google calendars into that store and uploads any change made to them.

Arth writes events into that store with `expo-calendar`. It never calls Google, never sees a
Google password, and needs no server. Whether an event leaves the phone depends only on
**which calendar you pick**:

| You pick | Where events show up | Leaves the phone? |
|---|---|---|
| One of your **Google** calendars (e.g. your Gmail address) | Google Calendar on phone, laptop, everywhere | Yes, via Android's Google sync |
| **"Arth (this phone only)"** — a calendar Arth creates | Any calendar app on this phone | No |

### Correction to the earlier explanation

I said earlier that Arth could create its own "Arth" calendar *under your Google account* and
have it sync. **That isn't possible.** Android only lets an account's own sync service create
calendars that sync to that account's server. A calendar an app creates is always local to the
phone. (The library would let us fake a Google-account calendar, but Google's sync wouldn't
upload it and may delete it.)

So to see events on your laptop, pick your Google calendar. To keep money out of Google
entirely, pick "Arth (this phone only)".

## What goes in

Only things with a date in the **next 90 days**:

| Kind | Source | Title example |
|---|---|---|
| Dues & card bills | Forecasts (`expenses.nature='forecast'`, `due_date`), incl. repayment forecasts | `Arth · HDFC card bill · ₹42,310` |
| Loan EMIs | `loan_schedule_entries` with `status='scheduled'` | `Arth · Home loan EMI · ₹38,500` |
| Reminders | `recurring_expense_rules.next_due_date` (active) | `Arth · Netflix · ₹649` |
| FD maturities | `investment_products` (active) `maturity_date` | `Arth · SBI FD matures` |

Each kind can be switched off separately.

**Event shape:** 9:00–9:30 AM on the date, in your local time, with alerts **the day before at
9 AM** and **on the day at 9 AM**. These are timed events rather than all-day ones. Android
stores all-day events in UTC, which pushes them onto the wrong day for IST users unless handled
very carefully.

**Amounts:** a "Show amounts" switch, **on** by default. If you sync to a Google calendar, the
amounts are stored by Google. Turn this off to show only "HDFC card bill".

Notes on every event say it was added by Arth, and to mark it paid in Arth rather than editing
it. The notes also carry a hidden tag (`[arth:due:…]`) so Arth can find its own events again.

## Keeping it in sync

- **One-way:** Arth → calendar. Edits you make to an Arth event in your calendar are
  overwritten on the next sync. A deleted event is re-created while the due still exists.
- **When a due is paid, rejected, or deleted** in Arth, its future event is removed.
- **Past events are left alone** so your calendar keeps a history. Arth just stops tracking them.
- **When it runs:** on app open, when you leave the app, after the background SMS check, and
  from "Sync now". It runs at most once every 15 minutes, except "Sync now".
- **If the event list is lost** (reinstall, restore to a new phone): Arth scans the chosen
  calendar for its tagged events and adopts them, so you don't get duplicates.

## Where state lives

The map from "Arth item" to "calendar event id" is **device-local (MMKV)**, not a database
table. Event ids belong to this phone's calendar store and mean nothing on another phone, so
backing them up would restore dead ids. This matches other device-local prefs (home cards,
biometric lock). No migration and no backup change.

## Turning it off

"Sync to calendar" off → Arth deletes the future events it created and forgets the map. It
does not delete the "Arth (this phone only)" calendar itself. You can remove that from your
calendar app.

## Screens

**Settings → Calendar sync**
- Sync to calendar (switch; asks for calendar permission the first time)
- Calendar: your writable calendars grouped by account, plus "Arth (this phone only)"
- What to add: Dues & card bills · Loan EMIs · Reminders · FD maturities
- Show amounts
- Sync now, and "Last synced 5 min ago · 14 events"

## Not in scope (for now)

- Reading your calendar (e.g. tagging a trip's spending from a "Goa trip" event).
- Two-way sync (marking something paid from the calendar).
- iOS.

## Files

- `services/calendar-sync.ts`: collect items, plan (pure, tested), apply, prefs
- `app/settings/calendar-sync.tsx`: settings screen
- `__tests__/unit/calendar-sync.test.ts`
- `app.json`: `expo-calendar` plugin (READ/WRITE_CALENDAR permissions)
