# Orphan dark: classes — need hand editing

The light half is a raw Tailwind literal (no CSS variable behind it, so it will not flip
with the colour scheme) or there is no light half at all. Removing the `dark:` class would
leave these rendering the light colour in dark mode.

## `dark:bg-surface-dark-alt` (2)

- `app\settings\category-edit.tsx:437` — `flex-1 px-3 py-2 rounded-lg border border-border-light dark:border-border-dark bg-white da`
- `app\settings\import-excel.tsx:293` — `rounded-lg border border-border-light dark:border-border-dark bg-white dark:bg-surface-dar`

## `dark:bg-surface-dark` (4)

- `app\settings\import-excel.tsx:254` — `bg-white dark:bg-surface-dark shadow-sm`
- `app\settings\import-excel.tsx:264` — `bg-white dark:bg-surface-dark shadow-sm`
- `app\settings\import-excel.tsx:334` — `px-2 py-1 rounded bg-surface-light-alt dark:bg-surface-dark mr-1.5 mb-1.5`
- `app\settings\sms-scan-runs.tsx:434` — `bg-surface-light-alt dark:bg-surface-dark rounded-lg p-2.5 mb-2`

## `dark:text-text-dark-secondary` (2)

- `app\settings\import-excel.tsx:336` — `text-xs text-text-primary dark:text-text-dark-secondary`
- `app\settings\import-excel.tsx:615` — `text-xs text-text-primary dark:text-text-dark-secondary`
