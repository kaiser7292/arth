/**
 * Loan EMI reminder helpers (v17.6.0, Change 3).
 *
 * The SMS → loan linking itself lives inline in `services/sms/sms-to-expense.ts`
 * inside the forecast-creation path — matching an emi_reminder to an active
 * loan by (bank_name, account last-4) stamps the reminder onto the loan and
 * skips creating a generic forecast expense.
 *
 * This file exposes a single helper the loan detail screen uses to clear
 * a stamped reminder when the user dismisses the banner (after acting on it).
 */

import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";

export async function clearEmiReminderOnLoan(loanId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE loan_accounts
        SET last_sms_reminder_at = NULL,
            last_sms_reminder_due_date = NULL,
            last_sms_reminder_amount = NULL,
            updated_at = datetime('now')
      WHERE id = ?;`,
    loanId,
  );
  bumpDataVersion();
}
