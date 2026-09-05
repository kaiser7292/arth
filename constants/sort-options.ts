import type { SelectOption } from "@/components/ui/SelectSheet";

/**
 * How a list of expenses can be ordered.
 *
 * Declared here because three screens - budget transactions, the budget category drill-down and
 * the insights filtered list - each had their own private copy of this union AND an identical
 * options array beneath it. Three copies of a list the user is meant to recognise is how the
 * labels drift apart.
 */
export type ExpenseSortBy =
  | "date_desc"
  | "date_asc"
  | "amount_desc"
  | "amount_asc"
  | "name_asc";

export const EXPENSE_SORT_OPTIONS: SelectOption<ExpenseSortBy>[] = [
  { value: "date_desc", label: "Date (newest first)", icon: "calendar-outline" },
  { value: "date_asc", label: "Date (oldest first)", icon: "calendar-outline" },
  { value: "amount_desc", label: "Amount (highest first)", icon: "trending-down-outline" },
  { value: "amount_asc", label: "Amount (lowest first)", icon: "trending-up-outline" },
  { value: "name_asc", label: "Alphabetical (A–Z)", icon: "text-outline" },
];
