# Orphan dark: classes — need hand editing

The light half is a raw Tailwind literal (no CSS variable behind it, so it will not flip
with the colour scheme) or there is no light half at all. Removing the `dark:` class would
leave these rendering the light colour in dark mode.

## `dark:bg-surface-dark-alt` (8)

- `app\budget\spending-split.tsx:125` — `mx-4 mt-3 mb-2 p-4 rounded-lg bg-white dark:bg-surface-dark-alt border border-border-light`
- `app\budget\spending-split.tsx:151` — `mx-4 mb-2 p-4 rounded-lg bg-white dark:bg-surface-dark-alt border border-border-light dark`
- `app\budget\spending-split.tsx:258` — `mx-4 mb-2 p-4 rounded-lg bg-white dark:bg-surface-dark-alt border border-border-light dark`
- `app\budget\spending-split.tsx:285` — `mx-4 mb-4 p-4 rounded-lg bg-white dark:bg-surface-dark-alt border border-border-light dark`
- `components\budget\SpendingSplitPage.tsx:111` — `mx-4 mt-3 mb-2 p-4 rounded-lg bg-white dark:bg-surface-dark-alt border border-border-light`
- `components\budget\SpendingSplitPage.tsx:127` — `mx-4 mb-2 p-4 rounded-lg bg-white dark:bg-surface-dark-alt border border-border-light dark`
- `components\budget\SpendingSplitPage.tsx:202` — `mx-4 mb-2 p-4 rounded-lg bg-white dark:bg-surface-dark-alt border border-border-light dark`
- `components\budget\SpendingSplitPage.tsx:221` — `mx-4 mb-4 p-4 rounded-lg bg-white dark:bg-surface-dark-alt border border-border-light dark`
