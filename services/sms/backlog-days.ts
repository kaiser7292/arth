/**
 * How far back Arth looks at unread bank SMS — for the Unrecognised list and for what a new
 * template reads. A setting on the Smart SMS Templates screen. Kept in its own module so the
 * template service and the backlog reader can both use it without importing each other.
 */

import { bumpDataVersion } from "@/services/settings";
import { settingsStorage } from "@/services/storage";

const BACKLOG_DAYS_KEY = "template_backlog_days";
export const BACKLOG_DAY_OPTIONS = [30, 90, 180, 365] as const;
export const DEFAULT_BACKLOG_DAYS = 90;

export function getBacklogDays(): number {
  const v = settingsStorage.getNumber(BACKLOG_DAYS_KEY);
  return v && (BACKLOG_DAY_OPTIONS as readonly number[]).includes(v) ? v : DEFAULT_BACKLOG_DAYS;
}

export function setBacklogDays(days: number): void {
  if (!(BACKLOG_DAY_OPTIONS as readonly number[]).includes(days)) return;
  settingsStorage.set(BACKLOG_DAYS_KEY, days);
  bumpDataVersion();
}

/** Start of the look-back window, epoch ms. */
export function backlogSinceMs(days: number = getBacklogDays()): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}
