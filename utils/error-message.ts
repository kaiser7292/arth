/**
 * Extract a user-friendly message from an unknown error value.
 * Translates common SQLite/technical errors into plain English.
 * Falls back to a default message if the error doesn't contain one.
 */
export function getErrorMessage(error: unknown, fallback = "Please try again."): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!raw) return fallback;
  return humanizeError(raw);
}

/**
 * Format an error for user-facing display.
 * Pattern: "Couldn't [action]. [reason]"
 */
export function formatError(action: string, error: unknown): string {
  const reason = getErrorMessage(error);
  return `Couldn't ${action.toLowerCase()}. ${reason}`;
}

function humanizeError(msg: string): string {
  const lower = msg.toLowerCase();

  if (lower.includes("unique constraint failed") || lower.includes("unique_constraint")) {
    if (lower.includes("financial_accounts")) {
      return "This account already exists. Check your recycle bin or existing accounts.";
    }
    if (lower.includes("yearly_plans")) {
      return "A yearly plan for this financial year already exists.";
    }
    if (lower.includes("recurring_expense_rules")) {
      return "This expense already has a reminder set up.";
    }
    return "This record already exists. You may have a duplicate entry.";
  }

  if (lower.includes("foreign key constraint failed")) {
    return "This item is linked to other records. Remove those links first, or try again later.";
  }

  if (lower.includes("not null constraint failed")) {
    return "A required field is missing. Please fill in all required fields.";
  }

  if (lower.includes("database is locked") || lower.includes("database_locked")) {
    return "Artha is busy processing something else. Please wait a moment and try again.";
  }

  if (lower.includes("disk i/o error") || lower.includes("disk_io")) {
    return "Couldn't save to your device. Please check your storage space and try again.";
  }

  if (lower.includes("no such table") || lower.includes("no such column")) {
    return "Something went wrong with your app data. Try restarting the app.";
  }

  if (lower.includes("sms permission") || lower.includes("permission")) {
    return "Artha doesn't have the required permission. Please check your device settings.";
  }

  return msg;
}
