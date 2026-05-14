/**
 * Fiscal Year utilities.
 *
 * Default: Indian FY (April 1 – March 31).
 * The `startMonth` parameter (1–12) allows configuring for other jurisdictions:
 *   - 1 = Jan–Dec (US/UK)
 *   - 4 = Apr–Mar (India, default)
 *   - 7 = Jul–Jun (Australia)
 */

/**
 * Get the fiscal year number that contains the given date.
 *
 * The FY is named by the calendar year in which it starts.
 * E.g., with startMonth=4: June 2026 → FY 2026, Feb 2027 → FY 2026.
 */
export function getCurrentFY(
  startMonth: number = 4,
  date: Date = new Date(),
): number {
  const month = date.getMonth() + 1; // 1-based
  const year = date.getFullYear();

  if (startMonth === 1) {
    return year;
  }

  return month >= startMonth ? year : year - 1;
}

/**
 * Get the start and end dates for a given fiscal year.
 *
 * @param fyYear - The fiscal year (e.g., 2026 for FY 2026-27)
 * @param startMonth - Month the FY starts (1-12, default 4)
 * @returns { start: Date, end: Date } — start is inclusive, end is inclusive (last day of FY)
 */
export function getFYRange(
  fyYear: number,
  startMonth: number = 4,
): { start: Date; end: Date } {
  const start = new Date(fyYear, startMonth - 1, 1); // Month is 0-based in Date

  let endYear: number;
  let endMonth: number;

  if (startMonth === 1) {
    endYear = fyYear;
    endMonth = 12;
  } else {
    endYear = fyYear + 1;
    endMonth = startMonth - 1;
  }

  // Last day of the end month
  const end = new Date(endYear, endMonth, 0); // Day 0 = last day of previous month

  return { start, end };
}

/**
 * Get the display label for a fiscal year.
 *
 * Examples:
 *   startMonth=4, fyYear=2026 → "FY 2026-27"
 *   startMonth=1, fyYear=2026 → "FY 2026"
 *   startMonth=7, fyYear=2026 → "FY 2026-27"
 */
export function getFYLabel(fyYear: number, startMonth: number = 4): string {
  if (startMonth === 1) {
    return `FY ${fyYear}`;
  }

  const endYear = fyYear + 1;
  const shortEnd = String(endYear).slice(-2);
  return `FY ${fyYear}-${shortEnd}`;
}

/**
 * Get the fiscal month number (1-12) for a given date.
 *
 * E.g., with startMonth=4: April → FM 1, March → FM 12.
 */
export function getFiscalMonth(
  startMonth: number = 4,
  date: Date = new Date(),
): number {
  const month = date.getMonth() + 1; // 1-based
  const fm = month - startMonth + 1;
  return fm > 0 ? fm : fm + 12;
}

/**
 * Format a Date as "YYYY-MM-DD" in local time (avoids UTC shift from toISOString).
 */
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Get all month labels in fiscal year order.
 *
 * E.g., startMonth=4 → ["Apr", "May", ..., "Feb", "Mar"]
 */
export function getFYMonthLabels(startMonth: number = 4): string[] {
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  const labels: string[] = [];
  for (let i = 0; i < 12; i++) {
    const monthIndex = (startMonth - 1 + i) % 12;
    labels.push(monthNames[monthIndex]);
  }
  return labels;
}
