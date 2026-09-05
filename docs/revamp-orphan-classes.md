# Orphan dark: classes — need hand editing

The light half is a raw Tailwind literal (no CSS variable behind it, so it will not flip
with the colour scheme) or there is no light half at all. Removing the `dark:` class would
leave these rendering the light colour in dark mode.

## `dark:bg-surface-dark-alt` (14)

- `app\expense\add.tsx:569` — `flex-row items-center rounded-lg border border-border-light dark:border-border-dark bg-whi`
- `components\expense\ExpenseFormFields.tsx:50` — `mt-2 rounded-lg border border-border-light dark:border-border-dark bg-white dark:bg-surfac`
- `components\expense\ExpenseFormFields.tsx:146` — `border-border-light dark:border-border-dark bg-white dark:bg-surface-dark-alt`
- `components\expense\ExpenseFormFields.tsx:192` — `flex-row items-center rounded-lg border border-dashed border-border-light dark:border-bord`
- `components\expense\ExpenseFormFields.tsx:245` — `flex-1 mx-2 py-2 px-4 rounded-lg border border-border-light dark:border-border-dark bg-whi`
- `components\expense\ExpenseFormFields.tsx:351` — `border-border-light dark:border-border-dark bg-white dark:bg-surface-dark-alt`
- `components\expense\ExpenseFormFields.tsx:439` — `border-border-light dark:border-border-dark bg-white dark:bg-surface-dark-alt`
- `components\expense\ExpenseFormFields.tsx:527` — `flex-row items-center rounded-lg border border-border-light dark:border-border-dark bg-whi`
- `components\expense\ExpenseFormFields.tsx:558` — `mt-1 rounded-lg border border-border-light dark:border-border-dark bg-white dark:bg-surfac`
- `components\expense\ExpenseFormFields.tsx:604` — `flex-row items-center justify-between rounded-lg border border-border-light dark:border-bo`
- `components\expense\ForecastMatchCard.tsx:26` — `mx-4 my-2 rounded-xl bg-white dark:bg-surface-dark-alt border border-border-light dark:bor`
- `components\expense\MultiSplitSheet.tsx:203` — `bg-white dark:bg-surface-dark-alt rounded-t-3xl px-5 pt-3`
- `components\expense\ReviewQueueItem.tsx:58` — `flex-row items-center px-4 py-3.5 bg-white dark:bg-surface-dark-alt border-b border-border`
- `components\expense\SplitSheet.tsx:193` — `bg-white dark:bg-surface-dark-alt rounded-t-3xl px-5 pt-3`

## `dark:bg-surface-dark` (11)

- `app\expense\review-queue.tsx:785` — `flex-row items-center justify-between px-4 py-2.5 bg-surface-light-alt dark:bg-surface-dar`
- `components\expense\MultiSplitSheet.tsx:227` — `w-10 h-10 rounded-full bg-surface-light-alt dark:bg-surface-dark items-center justify-cent`
- `components\expense\MultiSplitSheet.tsx:361` — `bg-surface-light-alt dark:bg-surface-dark rounded-2xl p-4 gap-2 mt-1`
- `components\expense\SplitSheet.tsx:254` — `w-10 h-10 rounded-full bg-surface-light-alt dark:bg-surface-dark items-center justify-cent`
- `components\expense\SplitSheet.tsx:301` — `w-9 h-9 rounded-lg bg-surface-light-alt dark:bg-surface-dark items-center justify-center m`
- `components\expense\SplitSheet.tsx:346` — `w-10 h-10 rounded-full bg-surface-light-alt dark:bg-surface-dark items-center justify-cent`
- `components\expense\SplitSheet.tsx:426` — `bg-surface-light-alt dark:bg-surface-dark`
- `components\expense\SplitSheet.tsx:462` — `bg-surface-light-alt dark:bg-surface-dark rounded-2xl p-4 gap-3`
- `components\expense\SplitSheet.tsx:512` — `flex-1 items-center py-2 rounded-lg bg-surface-light-alt dark:bg-surface-dark`
- `components\expense\SplitSheet.tsx:520` — `flex-1 items-center py-2 rounded-lg bg-surface-light-alt dark:bg-surface-dark`
- `components\expense\SplitSheet.tsx:528` — `flex-1 items-center py-2 rounded-lg bg-surface-light-alt dark:bg-surface-dark`
