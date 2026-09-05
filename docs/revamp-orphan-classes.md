# Orphan dark: classes — need hand editing

The light half is a raw Tailwind literal (no CSS variable behind it, so it will not flip
with the colour scheme) or there is no light half at all. Removing the `dark:` class would
leave these rendering the light colour in dark mode.

## `dark:bg-surface-dark-alt` (31)

- `app\budget\spending-split.tsx:125` — `mx-4 mt-3 mb-2 p-4 rounded-lg bg-white dark:bg-surface-dark-alt border border-border items`
- `app\budget\spending-split.tsx:151` — `mx-4 mb-2 p-4 rounded-lg bg-white dark:bg-surface-dark-alt border border-border`
- `app\budget\spending-split.tsx:258` — `mx-4 mb-2 p-4 rounded-lg bg-white dark:bg-surface-dark-alt border border-border`
- `app\budget\spending-split.tsx:285` — `mx-4 mb-4 p-4 rounded-lg bg-white dark:bg-surface-dark-alt border border-border`
- `app\expense\add.tsx:569` — `flex-row items-center rounded-lg border border-border bg-white dark:bg-surface-dark-alt px`
- `app\settings\category-edit.tsx:437` — `flex-1 px-3 py-2 rounded-lg border border-border bg-white dark:bg-surface-dark-alt text-fo`
- `app\settings\import-excel.tsx:293` — `rounded-lg border border-border bg-white dark:bg-surface-dark-alt p-4 mb-4`
- `components\budget\SpendingSplitPage.tsx:111` — `mx-4 mt-3 mb-2 p-4 rounded-lg bg-white dark:bg-surface-dark-alt border border-border items`
- `components\budget\SpendingSplitPage.tsx:127` — `mx-4 mb-2 p-4 rounded-lg bg-white dark:bg-surface-dark-alt border border-border`
- `components\budget\SpendingSplitPage.tsx:202` — `mx-4 mb-2 p-4 rounded-lg bg-white dark:bg-surface-dark-alt border border-border`
- `components\budget\SpendingSplitPage.tsx:221` — `mx-4 mb-4 p-4 rounded-lg bg-white dark:bg-surface-dark-alt border border-border`
- `components\expense\ExpenseFormFields.tsx:50` — `mt-2 rounded-lg border border-border bg-white dark:bg-surface-dark-alt overflow-hidden`
- `components\expense\ExpenseFormFields.tsx:146` — `border-border bg-white dark:bg-surface-dark-alt`
- `components\expense\ExpenseFormFields.tsx:192` — `flex-row items-center rounded-lg border border-dashed border-border bg-white dark:bg-surfa`
- `components\expense\ExpenseFormFields.tsx:245` — `flex-1 mx-2 py-2 px-4 rounded-lg border border-border bg-white dark:bg-surface-dark-alt it`
- `components\expense\ExpenseFormFields.tsx:351` — `border-border bg-white dark:bg-surface-dark-alt`
- `components\expense\ExpenseFormFields.tsx:439` — `border-border bg-white dark:bg-surface-dark-alt`
- `components\expense\ExpenseFormFields.tsx:527` — `flex-row items-center rounded-lg border border-border bg-white dark:bg-surface-dark-alt ov`
- `components\expense\ExpenseFormFields.tsx:558` — `mt-1 rounded-lg border border-border bg-white dark:bg-surface-dark-alt overflow-hidden max`
- `components\expense\ExpenseFormFields.tsx:604` — `flex-row items-center justify-between rounded-lg border border-border bg-white dark:bg-sur`
- `components\expense\ForecastMatchCard.tsx:26` — `mx-4 my-2 rounded-xl bg-white dark:bg-surface-dark-alt border border-border overflow-hidde`
- `components\expense\MultiSplitSheet.tsx:203` — `bg-white dark:bg-surface-dark-alt rounded-t-3xl px-5 pt-3`
- `components\expense\ReviewQueueItem.tsx:58` — `flex-row items-center px-4 py-3.5 bg-white dark:bg-surface-dark-alt border-b border-border`
- `components\expense\SplitSheet.tsx:193` — `bg-white dark:bg-surface-dark-alt rounded-t-3xl px-5 pt-3`
- `components\goals\salary-helpers.tsx:33` — `bg-white dark:bg-surface-dark-alt`
- `components\goals\salary-helpers.tsx:75` — `flex-row items-center justify-between rounded-lg border border-border bg-white dark:bg-sur`
- `components\goals\salary-helpers.tsx:87` — `mt-1 rounded-lg border border-border bg-white dark:bg-surface-dark-alt max-h-48`
- `components\goals\TaxBreakdown.tsx:31` — `bg-white dark:bg-surface-dark-alt`
- `components\goals\TaxBreakdown.tsx:50` — `bg-white dark:bg-surface-dark-alt`
- `components\ui\DateInput.tsx:57` — `flex-row items-center rounded-lg border px-3 py-3 bg-white dark:bg-surface-dark-alt`
- `components\ui\Input.tsx:60` — `rounded-lg border px-3 py-3 text-base text-foreground bg-white dark:bg-surface-dark-alt`

## `dark:bg-surface-dark` (19)

- `app\expense\review-queue.tsx:785` — `flex-row items-center justify-between px-4 py-2.5 bg-card dark:bg-surface-dark`
- `app\insights\budget-vs-actual.tsx:738` — `py-3 rounded-xl bg-card dark:bg-surface-dark items-center`
- `app\settings\import-excel.tsx:254` — `bg-white dark:bg-surface-dark shadow-sm`
- `app\settings\import-excel.tsx:264` — `bg-white dark:bg-surface-dark shadow-sm`
- `app\settings\import-excel.tsx:334` — `px-2 py-1 rounded bg-card dark:bg-surface-dark mr-1.5 mb-1.5`
- `app\settings\sms-scan-runs.tsx:434` — `bg-card dark:bg-surface-dark rounded-lg p-2.5 mb-2`
- `components\expense\MultiSplitSheet.tsx:227` — `w-10 h-10 rounded-full bg-card dark:bg-surface-dark items-center justify-center mr-3`
- `components\expense\MultiSplitSheet.tsx:361` — `bg-card dark:bg-surface-dark rounded-2xl p-4 gap-2 mt-1`
- `components\expense\SplitSheet.tsx:254` — `w-10 h-10 rounded-full bg-card dark:bg-surface-dark items-center justify-center mr-3`
- `components\expense\SplitSheet.tsx:301` — `w-9 h-9 rounded-lg bg-card dark:bg-surface-dark items-center justify-center mr-3`
- `components\expense\SplitSheet.tsx:346` — `w-10 h-10 rounded-full bg-card dark:bg-surface-dark items-center justify-center mr-3`
- `components\expense\SplitSheet.tsx:426` — `bg-card dark:bg-surface-dark`
- `components\expense\SplitSheet.tsx:462` — `bg-card dark:bg-surface-dark rounded-2xl p-4 gap-3`
- `components\expense\SplitSheet.tsx:512` — `flex-1 items-center py-2 rounded-lg bg-card dark:bg-surface-dark`
- `components\expense\SplitSheet.tsx:520` — `flex-1 items-center py-2 rounded-lg bg-card dark:bg-surface-dark`
- `components\expense\SplitSheet.tsx:528` — `flex-1 items-center py-2 rounded-lg bg-card dark:bg-surface-dark`
- `components\home\pages\ReviewQueuePage.tsx:701` — `flex-row items-center justify-between px-4 py-2.5 bg-card dark:bg-surface-dark`
- `components\ui\CalendarModal.tsx:563` — `flex-1 py-3 rounded-xl bg-card dark:bg-surface-dark items-center`
- `components\ui\PeriodNavigator.tsx:210` — `mx-4 mb-6 py-3 rounded-xl bg-card dark:bg-surface-dark items-center`

## `dark:text-text-dark-secondary` (2)

- `app\settings\import-excel.tsx:336` — `text-xs text-foreground dark:text-text-dark-secondary`
- `app\settings\import-excel.tsx:615` — `text-xs text-foreground dark:text-text-dark-secondary`
