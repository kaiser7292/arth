/**
 * Timezone utility functions for converting UTC datetimes to user's timezone.
 */

import { getTimezone } from "@/services/locale-preferences";

/**
 * Format a UTC ISO string in the user's timezone.
 * @param isoString - UTC ISO string (e.g., "2024-05-11T14:30:00Z")
 * @param options - Intl.DateTimeFormatOptions
 * @returns Formatted datetime string in user's timezone
 */
export function formatDateTimeInTimezone(
  isoString: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const timezone = getTimezone();
  const date = new Date(isoString);

  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };

  return date.toLocaleString("en-IN", { ...defaultOptions, ...options, timeZone: timezone });
}

/**
 * Format a UTC ISO string as time only in the user's timezone.
 * @param isoString - UTC ISO string
 * @returns Formatted time string in user's timezone (e.g., "2:30 PM")
 */
export function formatTimeInTimezone(isoString: string): string {
  const timezone = getTimezone();
  const date = new Date(isoString);

  return date.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  });
}

/**
 * Format a UTC ISO string as date only in the user's timezone.
 * Note: For date-only fields, this is typically not needed since dates
 * are stored without time component. This is for datetime fields.
 * @param isoString - UTC ISO string
 * @returns Formatted date string in user's timezone (e.g., "11 May 2024")
 */
export function formatDateInTimezone(isoString: string): string {
  const timezone = getTimezone();
  const date = new Date(isoString);

  return date.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  });
}

/**
 * Format a timestamp (milliseconds) in the user's timezone.
 * @param timestamp - Unix timestamp in milliseconds
 * @param options - Intl.DateTimeFormatOptions
 * @returns Formatted datetime string in user's timezone
 */
export function formatTimestampInTimezone(
  timestamp: number,
  options?: Intl.DateTimeFormatOptions,
): string {
  const timezone = getTimezone();
  const date = new Date(timestamp);

  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };

  return date.toLocaleString("en-IN", { ...defaultOptions, ...options, timeZone: timezone });
}
