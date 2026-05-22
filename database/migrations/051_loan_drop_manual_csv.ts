import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 051: Retire `schedule_source = 'manual_csv'`.
 *
 * The CSV import flow was the wrong abstraction — once a manual_csv schedule
 * existed, the engine no-op'd and prepayments couldn't be reconciled with
 * the user's uploaded rows. Replaced by the rate-aware correction event
 * (migration 050), which lets the user record any divergence from the
 * computed schedule as a single point-in-time correction.
 *
 * Migration strategy:
 *   - For each loan with schedule_source = 'manual_csv':
 *     - Find the latest paid/prepaid installment (or fall back to the first
 *       unpaid one).
 *     - Synthesize a loan_correction at that installment's due_date with
 *       outstanding = closing_principal of that row, emi = loan's current
 *       emi_amount.
 *     - Flip schedule_source to 'generated'. App-level rebuild on next
 *       focus/load will regenerate the tail from the correction.
 *
 * Idempotent — only acts on loans currently flagged manual_csv.
 */
export default {
  version: 51,
  name: "loan_drop_manual_csv",
  up: async (db: SQLiteDatabase) => {
    const loans = await db.getAllAsync<{ id: string; emi_amount: number }>(
      "SELECT id, emi_amount FROM loan_accounts WHERE schedule_source = 'manual_csv';",
    );
    for (const loan of loans) {
      // Anchor: latest paid/prepaid installment, else first scheduled.
      const anchor = await db.getFirstAsync<{
        due_date: string;
        closing_principal: number;
        opening_principal: number;
      }>(
        `SELECT due_date, closing_principal, opening_principal
         FROM loan_schedule_entries
         WHERE loan_account_id = ?
         ORDER BY
           CASE WHEN status IN ('paid','prepaid') THEN 0 ELSE 1 END ASC,
           installment_num DESC
         LIMIT 1;`,
        loan.id,
      );
      if (!anchor) {
        // No schedule rows at all — just flip the flag, no correction needed.
        await db.runAsync(
          "UPDATE loan_accounts SET schedule_source = 'generated' WHERE id = ?;",
          loan.id,
        );
        continue;
      }
      const correctionId = `mig051-${loan.id}`;
      await db.runAsync(
        `INSERT OR IGNORE INTO loan_corrections (
          id, loan_account_id, effective_date, outstanding_principal,
          emi_amount, tenure_remaining_months, interest_rate_pa, reason
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 'Migrated from CSV-imported schedule');`,
        correctionId,
        loan.id,
        anchor.due_date,
        anchor.closing_principal,
        loan.emi_amount,
      );
      await db.runAsync(
        "UPDATE loan_accounts SET schedule_source = 'generated' WHERE id = ?;",
        loan.id,
      );
    }
  },
};
