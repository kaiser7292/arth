export interface ExpenseValidationErrors {
  amount?: string;
  description?: string;
  date?: string;
  category_id?: string;
  account_id?: string;
}

export interface ExpenseFormData {
  amount: string;
  description: string;
  category_id: string | null;
  payment_mode_id: string | null;
  account_id?: string | null;
  date: string;
  is_right_spend: boolean;
}

/**
 * Parse and validate the amount string.
 * Returns the numeric value (rounded to 2 decimals) or null if invalid.
 * Rejects zero and negative amounts (transaction guard: positive amounts only).
 */
export function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const num = Number(trimmed);
  if (isNaN(num) || !isFinite(num)) return null;
  if (num === 0) return null;
  if (num < 0) return null; // Transaction guard: reject negative amounts
  return Math.round(num * 100) / 100;
}

/**
 * Validate expense form data.
 * Returns an object with field-level error messages, or null if valid.
 */
export function validateExpense(
  data: ExpenseFormData,
): ExpenseValidationErrors | null {
  const errors: ExpenseValidationErrors = {};

  const amount = parseAmount(data.amount);
  if (amount === null) {
    errors.amount = "Enter a valid non-zero amount";
  }

  if (!data.date || data.date.trim() === "") {
    errors.date = "Date is required";
  } else {
    const dm = data.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dm) {
      errors.date = "Use format YYYY-MM-DD";
    } else {
      const [, , ms, ds] = dm;
      const m = Number(ms), d = Number(ds);
      const daysInMonth = new Date(Number(dm[1]), m, 0).getDate();
      if (m < 1 || m > 12) errors.date = "Invalid month";
      else if (d < 1 || d > daysInMonth) errors.date = "Invalid day";
      else {
        // Transaction guard: reject future dates
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expenseDate = new Date(data.date);
        expenseDate.setHours(0, 0, 0, 0);
        if (expenseDate > today) {
          errors.date = "Date cannot be in the future";
        }
      }
    }
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * Format a date as YYYY-MM-DD for storage.
 */
export function formatDateForStorage(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Format a date string (YYYY-MM-DD) for display.
 * Returns "Today", "Yesterday", or the user's preferred date format.
 */
export function formatDateForDisplay(dateStr: string): string {
  const today = formatDateForStorage(new Date());
  if (dateStr === today) return "Today";

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateStr === formatDateForStorage(yesterday)) return "Yesterday";

  // Honor user's date-format preference (v15.9.0).
  // Dynamic import avoids a circular reference if format.ts grows more deps.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { formatDate } = require("./date");
  return formatDate(dateStr);
}

/**
 * Format amount for display with currency symbol.
 * @deprecated Import from `@/utils/format` instead.
 */
export { formatAmount } from "./format";
