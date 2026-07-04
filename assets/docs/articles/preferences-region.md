---
title: Region - currency, date format, number format, fiscal year
slug: preferences-region
summary: Pick the currency symbol, number grouping (Indian lakh vs Western), date format, and fiscal-year start month. All display-only - no FX conversion.
tags: [region, currency, locale, preferences, format, number, date, fiscal-year, indian, lakh, western, display]
contextKeys: [settings-preferences, settings-region, onboarding]
phrasings:
  - How do I change the currency?
  - Change the number format
  - Indian lakh format
  - Western million format
  - How do I change the date format?
  - DD MM YYYY vs MM DD YYYY
  - USD EUR GBP currency
  - Set fiscal year start month
  - April March fiscal year India
  - Rupee symbol wrong
  - Dollar sign Arth
  - UI region screen
  - UI currency picker
  - Preferences card
  - Locale settings
---

Arth has one locale / preferences screen that controls all display formatting: currency symbol, number grouping, date format, and fiscal-year start month.

> This is **display-only**. Changing your currency to USD does not convert existing ₹ amounts - it just changes the symbol shown everywhere. Per-transaction currency and FX conversion are not supported (see "What's not supported" below).

## Where to find it

**Settings tab → Preferences → Region.**

Also asked during onboarding - the three format pickers appear after you pick your theme.

## What you can change

### Currency

30 common currencies plus "None (no symbol)". Searchable by code, name, or symbol. Covers:

- **South Asia** - INR, PKR, BDT, LKR, NPR
- **North America** - USD, CAD, MXN
- **Europe** - EUR, GBP, CHF, SEK, NOK, DKK, PLN
- **Middle East** - AED, SAR, QAR
- **East / Southeast Asia** - JPY, CNY, SGD, HKD, KRW, MYR, THB, IDR, PHP, VND
- **Oceania** - AUD, NZD

Picking a currency also seeds its default number format (INR → Indian grouping, USD → Western, etc.) - you can override afterwards.

### Number format

- **Indian** - 1,23,456 (lakh grouping: last three digits, then groups of two)
- **Western** - 123,456 (three-digit grouping)
- **None** - 123456 (no separators)

Each row shows a live sample so you see exactly what the app will look like.

### Date format

- **DD/MM/YYYY** - 15/01/2026
- **MM/DD/YYYY** - 01/15/2026
- **YYYY-MM-DD** - 2026-01-15
- **DD-MMM-YYYY** - 15-Jan-2026

Affects every date the app shows (ledger rows, expense detail, exports). "Today" / "Yesterday" shortcuts are unchanged - they're language, not format.

### Fiscal Year

The month your financial year starts. Default **April** (India). Supported values: any calendar month. Drives:

- Yearly plan calculations
- Year-over-year comparisons
- Rolling-surplus math on the Budget tab
- Salary FY isolation

## What's not supported

**Multi-currency per transaction with FX conversion.** Every transaction is stored in a single currency; the Region screen only changes the symbol used for display. This is a deliberate simplification - true FX-converted history needs per-transaction currency tracking and historical exchange rates, which is a planned future change, not a locale pref.

If you have actual foreign-currency transactions, log them as INR-equivalent at the time of spending (or use the destination currency and ignore FX). There is no built-in conversion.

## Preferences are device-local

Like the biometric lock, region preferences are stored on your device only and are **not** part of backup files. After restoring a backup on a new device, you'll re-pick your region.

This mirrors how a fresh install asks during onboarding.

## Common situations

**"I want ₹ and Indian format on the sample but US dates."**
That's fine - each picker is independent. Set currency = INR, number = Indian, date = MM/DD/YYYY. Save.

**"After picking EUR, my ₹ amounts now show as €."**
Expected. Amounts are stored as raw numbers; the symbol is pure formatting. If you want amounts to actually be EUR-value, you'd need to re-enter them.

**"Hisaab exports have weird date formatting."**
Exports honor the date format you picked in Preferences. If you see old formatting, make sure the app is up to date.

**"The 'Rupees' symbol looks odd on exports."**
Some PDF readers render ₹ inconsistently. If your recipient can't read ₹, try "Rs" as the effective display - pick "None (no symbol)" and the exports show just the number.

## Related

- Why April is the default FY start: [Fiscal year and yearly plans](fiscal-year)
- How the budget rolling surplus uses the FY: [Budgets in depth](budget)
