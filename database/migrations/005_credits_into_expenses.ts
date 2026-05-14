import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 005: Unify credits into the expenses table.
 *
 * Changes:
 *   1. Copy all rows from account_credits into expenses with nature='credit'.
 *      Preserves id for FK compatibility (hisaab_entries.linked_account_credit_id
 *      points at account_credits.id; after copy those same ids exist in expenses).
 *   2. Flip refund rows from nature='realized' to nature='credit'.
 *      A refund row is identified by refund_of_expense_id IS NOT NULL.
 *   3. Repoint hisaab_entries.linked_expense_id to reference the new credit rows
 *      that used to live in account_credits.
 *
 * Not dropped in this migration:
 *   - account_credits table (kept for safety; dropped in a later migration once
 *     the new flow is verified stable on-device).
 *   - hisaab_entries.linked_account_credit_id column (same reason).
 *
 * Idempotency: the INSERT uses OR IGNORE so re-running is safe if the migration
 * tracker got out of sync.
 */
export default {
  version: 5,
  name: "005_credits_into_expenses",
  up: async (db: SQLiteDatabase) => {
    // 1. Copy account_credits into expenses with nature='credit'.
    //    Preserve id so hisaab FKs remain valid.
    //    status='approved' because these are already applied to historical balances.
    //    currency defaults to INR (matches expenses table default).
    await db.execAsync(`
      INSERT OR IGNORE INTO expenses (
        id, user_id, amount, currency, description,
        date, source, status, nature,
        account_id, deleted_at, created_at, updated_at,
        transaction_time
      )
      SELECT
        id, user_id, amount, 'INR', description,
        date,
        CASE WHEN source = 'sms_auto' THEN 'sms_auto' ELSE 'manual' END,
        'approved',
        'credit',
        account_id, deleted_at, created_at, updated_at,
        '00:00:00'
      FROM account_credits;
    `);

    // 2. Flip refund rows to nature='credit'.
    //    Refund rows currently have nature='realized' + refund_of_expense_id set.
    //    After this, balance math reads refunds via nature='credit' branch.
    await db.execAsync(`
      UPDATE expenses
      SET nature = 'credit', updated_at = datetime('now')
      WHERE refund_of_expense_id IS NOT NULL AND nature = 'realized';
    `);

    // 3. Repoint hisaab FKs. linked_account_credit_id points at account_credits.id;
    //    those ids now also exist in expenses. Move the reference to linked_expense_id.
    //    Only move where linked_expense_id is still NULL to avoid clobbering real expense links.
    await db.execAsync(`
      UPDATE hisaab_entries
      SET linked_expense_id = linked_account_credit_id,
          updated_at = datetime('now')
      WHERE linked_account_credit_id IS NOT NULL
        AND linked_expense_id IS NULL;
    `);
  },
};
