/**
 * The date a new credit or transfer starts on when it's added from an account's ledger: today if
 * today is in the month being viewed, otherwise that month's first day.
 *
 * Without this, adding a credit while looking at a past month dated it today, so it landed in
 * this month: the balance changed somewhere else and no row appeared in the month on screen.
 * See CLAUDE.md, "Manual credit / transfer from FAB". All dates are YYYY-MM-DD.
 */
export function defaultEntryDate(today: string, monthStart: string, monthEnd: string): string {
  return today >= monthStart && today <= monthEnd ? today : monthStart;
}
