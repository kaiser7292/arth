import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 020: Three partial indexes to speed up filters surfaced in v15.8.0.
 *
 * 1. `idx_expenses_user_rightspend` — backs the new Avoidability filter
 *    (`is_right_spend = 0 | 1`). Without this, a user with a long history
 *    filtering "Avoidable" over "All Time" forces a user/date-indexed scan
 *    with in-memory filter. Partial-on-live (`deleted_at IS NULL`) keeps
 *    the index tiny.
 *
 * 2. `idx_expenses_refund_live` — backs the new Refund-status subquery:
 *    `id IN (SELECT refund_of_expense_id FROM expenses WHERE refund_of_expense_id
 *    IS NOT NULL AND nature='credit' AND deleted_at IS NULL)`. The existing
 *    `idx_expenses_refund_link` covered the column alone; this covers the
 *    full filter predicate including the live-row check.
 *
 * 3. `idx_account_transfers_live_date` — backs hot WHERE patterns in
 *    `financial-account.ts` / `account-balance.ts` that filter
 *    `deleted_at IS NULL AND date >= ?`. Partial-on-live keeps it cheap.
 */
export default {
  version: 20,
  name: "expense_filter_indexes",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_expenses_user_rightspend
        ON expenses(user_id, is_right_spend)
        WHERE deleted_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_expenses_refund_live
        ON expenses(refund_of_expense_id, deleted_at)
        WHERE refund_of_expense_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_account_transfers_live_date
        ON account_transfers(date)
        WHERE deleted_at IS NULL;
    `);
  },
};
