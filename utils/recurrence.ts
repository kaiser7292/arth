/**
 * Pure date math for relative-frequency recurrence (weekly | monthly | quarterly |
 * yearly | last_day_of_month | nth_weekday). Extracted from services/recurring-rules.ts
 * so other engines (the simulator) can reuse the same tested cycle math instead of
 * carrying a second copy.
 */
import { todayIso } from "@/utils/date";
import type { RecurringFrequency } from "@/services/recurring-detector";

/** Returns the Nth occurrence of `weekday` in the given UTC month (0-indexed). ordinal -1 = last. */
export function nthWeekdayOfMonth(year: number, month: number, ordinal: number, weekday: number): string {
  if (ordinal === -1) {
    const last = new Date(Date.UTC(year, month + 1, 0));
    while (last.getUTCDay() !== weekday) last.setUTCDate(last.getUTCDate() - 1);
    return last.toISOString().slice(0, 10);
  }
  const first = new Date(Date.UTC(year, month, 1));
  let diff = weekday - first.getUTCDay();
  if (diff < 0) diff += 7;
  first.setUTCDate(first.getUTCDate() + diff + (ordinal - 1) * 7);
  if (first.getUTCMonth() !== month) {
    // Requested ordinal doesn't exist this month (e.g. 5th Monday) — use last.
    return nthWeekdayOfMonth(year, month, -1, weekday);
  }
  return first.toISOString().slice(0, 10);
}

/** Add one cycle of `frequency` to `iso` (YYYY-MM-DD). */
export function addCycle(iso: string, frequency: RecurringFrequency, repeatOrdinal?: number | null, repeatWeekday?: number | null): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (frequency === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  else if (frequency === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
  else if (frequency === "quarterly") date.setUTCMonth(date.getUTCMonth() + 3);
  else if (frequency === "yearly") date.setUTCFullYear(date.getUTCFullYear() + 1);
  else if (frequency === "last_day_of_month") {
    // Last day of the month following the current date's month.
    date.setUTCMonth(date.getUTCMonth() + 2, 0);
  } else if (frequency === "nth_weekday" && repeatOrdinal != null && repeatWeekday != null) {
    const nextMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    return nthWeekdayOfMonth(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), repeatOrdinal, repeatWeekday);
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Compute the first due date on/after today for a given start date and frequency.
 * If start_date is today or in the future, use it as-is. If start_date is in the
 * past, project forward to the first future cycle.
 */
export function firstNextDue(startDate: string, frequency: RecurringFrequency, repeatOrdinal?: number | null, repeatWeekday?: number | null): string {
  const today = todayIso();
  let due = startDate;
  while (due < today) due = addCycle(due, frequency, repeatOrdinal, repeatWeekday);
  return due;
}
