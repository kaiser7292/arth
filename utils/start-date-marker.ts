/**
 * The deleted_at value of a row hidden by the start date (services/start-date.ts).
 *
 * Every query that reads transactions already skips rows with a deleted_at, so one value hides them
 * everywhere, transfers included. Being far in the future, it also never reaches the recycle bin's
 * 30-day clear-out. Anything that treats deleted_at as "the user deleted this" has to tell the two
 * apart: the bin must not list, restore or empty these rows, and a Hisaab entry must not disappear
 * because its expense is before the start date.
 */
export const START_DATE_HIDDEN = "9999-12-31T00:00:00.000Z";

/** Rows the user deleted, which is what the recycle bin holds. */
export const IN_RECYCLE_BIN = `deleted_at IS NOT NULL AND deleted_at <> '${START_DATE_HIDDEN}'`;
