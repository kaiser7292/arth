/**
 * Hand-off between Catch Up and its merchant page (app/expense/catch-up-merchant.tsx).
 *
 * The picker used to be a bottom sheet; typing in a sheet fights the keyboard, so - like the other
 * keyboard-heavy pickers - it's a full page now. Catch Up sets the request before pushing the page,
 * the page sets the result before going back, and Catch Up consumes it on focus. Module state:
 * only one picker is ever open.
 */
export interface MerchantPickRequest {
  expenseId: string;
  /** "Paid to" for spending, "Received from" for credits. */
  title: string;
  value: string | null;
  /** Past merchants, for suggestions. */
  merchantNames: string[];
}

let request: MerchantPickRequest | null = null;
let result: { expenseId: string; name: string } | null = null;

export function setMerchantPickRequest(r: MerchantPickRequest): void {
  request = r;
  result = null;
}

export function getMerchantPickRequest(): MerchantPickRequest | null {
  return request;
}

export function setMerchantPickResult(expenseId: string, name: string): void {
  result = { expenseId, name };
}

/** The picked merchant, once - null if the page was closed without saving. */
export function consumeMerchantPickResult(): { expenseId: string; name: string } | null {
  const r = result;
  result = null;
  request = null;
  return r;
}
