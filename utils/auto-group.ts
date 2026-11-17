import { resolveDatePreset, type DatePreset } from "@/services/saved-filter-views";

export type AutoGroup = "date" | "month" | "year";

const DAY_PRESETS: ReadonlySet<DatePreset> = new Set(["today", "last_7_days", "last_30_days"]);
const MONTH_PRESETS: ReadonlySet<DatePreset> = new Set([
  "this_month",
  "last_month",
  "last_3_months",
  "last_12_months",
  "this_quarter",
  "this_fy",
  "last_fy",
]);

/** Calendar months a range touches, counting both ends: Nov 2025 – Nov 2026 is 13. */
function monthsTouched(start: string, end: string): number {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

function daysBetween(start: string, end: string): number {
  return Math.round((new Date(end + "T00:00:00").getTime() - new Date(start + "T00:00:00").getTime()) / 86400000) + 1;
}

/**
 * How the Transactions list groups itself when the owner hasn't picked a grouping: by day for a
 * range in days, by month for one in months, by year past twelve months (or all time).
 *
 *   today, last 7 / 30 days                      -> day
 *   this / last month, last 3 / 12 months,
 *   this quarter, this / last FY                 -> month
 *   all time                                     -> year
 *   a custom range: up to 31 days -> day, up to 12 months -> month, longer -> year
 */
export function autoGroupFor(preset: DatePreset, customStart = "", customEnd = ""): AutoGroup {
  if (DAY_PRESETS.has(preset)) return "date";
  if (MONTH_PRESETS.has(preset)) return "month";
  if (preset === "all") return "year";
  const { start, end } = resolveDatePreset(preset, customStart, customEnd);
  if (!start || !end) return "year";
  if (daysBetween(start, end) <= 31) return "date";
  return monthsTouched(start, end) > 12 ? "year" : "month";
}
