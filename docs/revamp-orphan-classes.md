# Orphan dark: classes — need hand editing

The light half is a raw Tailwind literal (no CSS variable behind it, so it will not flip
with the colour scheme) or there is no light half at all. Removing the `dark:` class would
leave these rendering the light colour in dark mode.

## `dark:bg-surface-dark` (1)

- `components\home\pages\ReviewQueuePage.tsx:701` — `flex-row items-center justify-between px-4 py-2.5 bg-surface-light-alt dark:bg-surface-dar`
