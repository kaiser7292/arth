/**
 * Consolidated date utilities.
 *
 * v15.9.0: adds locale-aware formatDate() / formatDateWith() / formatMonthLabel()
 * that honor the user's date-format preference. Storage format is always
 * ISO `YYYY-MM-DD` — these helpers only affect display.
 */

import { getDateFormat } from "@/services/locale-preferences";
import type { DateFormat } from "@/constants/currencies";

/** Get the last day of a month given "YYYY-MM" string. Returns "YYYY-MM-DD". */
export function getLastDayOfMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
}

/** Convert a `Date` → ISO `YYYY-MM-DD` string (local time). */
export function toIsoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Format a date as "5 Jan 2026" (en-IN). Legacy helper — retained for
 * backwards compatibility. New code should prefer `formatDate()` which
 * honors the user's date-format preference.
 */
export function formatDisplayDate(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input + "T00:00:00") : input;
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseIso(iso: string): { y: number; m: number; d: number } | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return { y, m: mo, d };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Render an ISO date (YYYY-MM-DD) in a specific format. Used by the
 * Settings/Region picker to show a live sample — does NOT read preferences.
 */
export function formatDateWith(iso: string, format: DateFormat): string {
  const parts = parseIso(iso);
  if (!parts) return iso;
  const { y, m, d } = parts;
  switch (format) {
    case "DD/MM/YYYY":
      return `${pad2(d)}/${pad2(m)}/${y}`;
    case "MM/DD/YYYY":
      return `${pad2(m)}/${pad2(d)}/${y}`;
    case "YYYY-MM-DD":
      return `${y}-${pad2(m)}-${pad2(d)}`;
    case "DD-MMM-YYYY":
      return `${pad2(d)}-${MONTH_SHORT[m - 1]}-${y}`;
  }
}

/** Render an ISO date using the user's preference. Empty-safe. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return formatDateWith(iso, getDateFormat());
}

export { todayIso } from "@/utils/local-date";

/** Add N days to a YYYY-MM-DD. Returns a YYYY-MM-DD in local time. */
export function addDays(iso: string, days: number): string {
  const parts = parseIso(iso);
  if (!parts) return iso;
  const d = new Date(parts.y, parts.m - 1, parts.d + days);
  return toIsoDate(d);
}

/**
 * Add N calendar months to a YYYY-MM-DD, clamping the day to the target
 * month's last day when it doesn't have one (e.g. 31 Jan + 1 month → 28/29
 * Feb, not the JS Date default of rolling over into March). Used by the
 * simulator's "copy with updated dates" scenario duplication, where dates
 * shift by a constant month-delta rather than by cycle-frequency math.
 */
export function addMonthsClamped(iso: string, months: number): string {
  const parts = parseIso(iso);
  if (!parts) return iso;
  const targetMonthIndex = parts.m - 1 + months; // 0-based, can be negative or >11
  const year = parts.y + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12; // 0-11
  const lastDayOfTargetMonth = new Date(year, month + 1, 0).getDate();
  const day = Math.min(parts.d, lastDayOfTargetMonth);
  return toIsoDate(new Date(year, month, day));
}

/** Day difference b − a in whole days (local wall clock, DST-safe via Date math). */
export function daysBetween(a: string, b: string): number {
  const da = parseIso(a);
  const db = parseIso(b);
  if (!da || !db) return 0;
  const ta = new Date(da.y, da.m - 1, da.d).getTime();
  const tb = new Date(db.y, db.m - 1, db.d).getTime();
  return Math.round((tb - ta) / 86_400_000);
}

/**
 * Month label — "Jan 2026" / "January 2026". Independent of the date-format
 * preference (month-year labels are the same in every common format).
 */
export function formatMonthLabel(monthStr: string, style: "short" | "long" = "short"): string {
  const m = monthStr.match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthStr;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const names = style === "long" ? MONTH_LONG : MONTH_SHORT;
  return `${names[mo - 1]} ${y}`;
}

/** "5:12 pm" for a moment. */
export function formatClockTime(d: Date): string {
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).toLowerCase();
}

/**
 * A moment (ISO timestamp) as "today, 5:12 pm", "yesterday, 5:12 pm" or "3 Nov, 5:12 pm" (with the
 * year when it isn't this one). "" if it isn't a date.
 */
export function formatRelativeDateTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dayOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayOf(now) - dayOf(d)) / 86_400_000);
  const day =
    days === 0
      ? "today"
      : days === 1
        ? "yesterday"
        : `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`}`;
  return `${day}, ${formatClockTime(d)}`;
}

/**
 * A database timestamp as a moment. SQLite's datetime('now') is UTC with a space and no zone
 * ("2026-11-05 11:42:10"), which Date would read as local time.
 */
export function parseSqliteUtc(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * A dated value's "as of": "5 Nov 2026, 5:12 pm" when it was saved on that day (a sync, or a value
 * typed in on the day), else just "5 Nov 2026" - a value typed in later for a past day has no time
 * of its own.
 */
export function formatAsOf(date: string, savedAt: string | null | undefined): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = `${d} ${MONTH_SHORT[m - 1]} ${y}`;
  const saved = parseSqliteUtc(savedAt);
  if (!saved) return day;
  const sameDay = saved.getFullYear() === y && saved.getMonth() === m - 1 && saved.getDate() === d;
  return sameDay ? `${day}, ${formatClockTime(saved)}` : day;
}
