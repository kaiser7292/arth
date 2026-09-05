# Orphan dark: classes — need hand editing

The light half is a raw Tailwind literal (no CSS variable behind it, so it will not flip
with the colour scheme) or there is no light half at all. Removing the `dark:` class would
leave these rendering the light colour in dark mode.

## `dark:bg-surface-dark` (2)

- `components\ui\CalendarModal.tsx:563` — `flex-1 py-3 rounded-xl bg-surface-light-alt dark:bg-surface-dark items-center`
- `components\ui\PeriodNavigator.tsx:210` — `mx-4 mb-6 py-3 rounded-xl bg-surface-light-alt dark:bg-surface-dark items-center`

## `dark:bg-surface-dark-alt` (2)

- `components\ui\DateInput.tsx:57` — `flex-row items-center rounded-lg border px-3 py-3 bg-white dark:bg-surface-dark-alt`
- `components\ui\Input.tsx:60` — `rounded-lg border px-3 py-3 text-base text-text-primary dark:text-text-dark-primary bg-whi`
