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
      // Prefer: latest paid/prepaid installment — use its closing_principal
      // (post-EMI value). The correction at that due_date keeps all paid rows
      // and regenerates the tail from closing_principal forward.
      let anchor = await db.getFirstAsync<{
        effective_date: string;
        outstanding: number;
      }>(
        `SELECT due_date as effective_date, closing_principal as outstanding
         FROM loan_schedule_entries
         WHERE loan_account_id = ? AND status IN ('paid','prepaid')
         ORDER BY installment_num DESC
         LIMIT 1;`,
        loan.id,
      );
      // Fallback: no paid rows — anchor at the day BEFORE installment 1 with
      // its opening_principal (the full disbursed amount). This means the
      // correction effective_date < every scheduled row's due_date, so the
      // entire schedule regenerates from outstanding = opening_principal.
      if (!anchor) {
        const first = await db.getFirstAsync<{
          due_date: string;
          opening_principal: number;
        }>(
          `SELECT due_date, opening_principal
           FROM loan_schedule_entries
           WHERE loan_account_id = ?
           ORDER BY installment_num ASC
           LIMIT 1;`,
          loan.id,
        );
        if (!first) {
          await db.runAsync(
            "UPDATE loan_accounts SET schedule_source = 'generated' WHERE id = ?;",
            loan.id,
          );
          continue;
        }
        // Anchor effective_date one day before due_date so the correction
        // applies before any installment, regenerating the full schedule.
        const dueDateMinus1 = new Date(first.due_date);
        dueDateMinus1.setDate(dueDateMinus1.getDate() - 1);
        anchor = {
          effective_date: dueDateMinus1.toISOString().split("T")[0],
          outstanding: first.opening_principal,
        };
      }
      const correctionId = `mig051-${loan.id}`;
      await db.runAsync(
        `INSERT OR IGNORE INTO loan_corrections (
          id, loan_account_id, effective_date, outstanding_principal,
          emi_amount, tenure_remaining_months, interest_rate_pa, reason
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 'Migrated from CSV-imported schedule');`,
        correctionId,
        loan.id,
        anchor.effective_date,
        anchor.outstanding,
        loan.emi_amount,
      );
      await db.runAsync(
        "UPDATE loan_accounts SET schedule_source = 'generated' WHERE id = ?;",
        loan.id,
      );
    }
  },
};
