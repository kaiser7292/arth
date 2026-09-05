# Orphan dark: classes — need hand editing

The light half is a raw Tailwind literal (no CSS variable behind it, so it will not flip
with the colour scheme) or there is no light half at all. Removing the `dark:` class would
leave these rendering the light colour in dark mode.

## `dark:bg-surface-dark` (1)

- `app\insights\budget-vs-actual.tsx:738` — `py-3 rounded-xl bg-surface-light-alt dark:bg-surface-dark items-center`

## `dark:bg-surface-dark-alt` (5)

- `components\goals\salary-helpers.tsx:33` — `bg-white dark:bg-surface-dark-alt`
- `components\goals\salary-helpers.tsx:75` — `flex-row items-center justify-between rounded-lg border border-border-light dark:border-bo`
- `components\goals\salary-helpers.tsx:87` — `mt-1 rounded-lg border border-border-light dark:border-border-dark bg-white dark:bg-surfac`
- `components\goals\TaxBreakdown.tsx:31` — `bg-white dark:bg-surface-dark-alt`
- `components\goals\TaxBreakdown.tsx:50` — `bg-white dark:bg-surface-dark-alt`
