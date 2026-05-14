/**
 * Extract a user-friendly message from an unknown error value.
 * Falls back to a default message if the error doesn't contain one.
 */
export function getErrorMessage(error: unknown, fallback = "Please try again."): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return fallback;
}

/**
 * Format an error for user-facing display.
 * Pattern: "[action] failed: [reason]"
 */
export function formatError(action: string, error: unknown): string {
  const reason = getErrorMessage(error);
  return `${action} failed: ${reason}`;
}
