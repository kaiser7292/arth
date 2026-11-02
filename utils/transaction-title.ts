/**
 * What a transaction is called in a list: its description, else its merchant, else its category.
 * `fallback` is for a row with none of them (usually its type).
 */
export function transactionTitle(
  t: { description?: string | null; merchant_name?: string | null },
  categoryName?: string | null,
  fallback: string = "Transaction",
): string {
  return t.description?.trim() || t.merchant_name?.trim() || categoryName?.trim() || fallback;
}
