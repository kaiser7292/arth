/**
 * A date as `YYYY-MM-DD` in the phone's own timezone. `toISOString()` gives the UTC date, which in
 * India is still yesterday until 5:30am. No imports, so anything can use it.
 */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today in the phone's own timezone. */
export function todayIso(): string {
  return isoDate(new Date());
}
