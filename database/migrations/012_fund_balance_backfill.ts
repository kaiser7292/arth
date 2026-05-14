import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 012: Backfill demat_fund_snapshots from legacy fund_balance.
 *
 * v14.5.0 makes `demat_fund_snapshots` the single source of truth for idle
 * cash on demat accounts — `financial_accounts.fund_balance` is deprecated.
 * Migration 009 already created a today-snapshot for any demat account that
 * had a non-zero fund_balance at the time, but that was ~2 weeks ago: any
 * user who edited their fund_balance scalar *since* then has a more recent
 * value in the scalar than in the snapshots table.
 *
 * This migration catches that drift: for every demat account whose scalar
 * fund_balance differs from the latest snapshot value (or has no snapshot),
 * insert a "today" snapshot equal to the scalar. INSERT OR IGNORE on the
 * UNIQUE(account_id, snapshot_date) means a prior today-snapshot is not
 * overwritten — that's fine; users who added snapshots today already have
 * the right data.
 */
export default {
  version: 12,
  name: "fund_balance_backfill",
  up: async (db: SQLiteDatabase) => {
    const today = new Date().toISOString().slice(0, 10);
    await db.runAsync(
      `INSERT OR IGNORE INTO demat_fund_snapshots (id, account_id, snapshot_date, fund_value)
       SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' ||
              lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' ||
              lower(hex(randomblob(6))),
              fa.id, ?, fa.fund_balance
       FROM financial_accounts fa
       WHERE fa.account_type = 'demat'
         AND fa.is_active = 1
         AND fa.fund_balance != 0
         AND NOT EXISTS (
           SELECT 1 FROM demat_fund_snapshots s
           WHERE s.account_id = fa.id
             AND s.fund_value = fa.fund_balance
             AND s.snapshot_date = (
               SELECT MAX(snapshot_date) FROM demat_fund_snapshots
               WHERE account_id = fa.id
             )
         );`,
      today,
    );
  },
};
