/**
 * SMS Parser Service — orchestrates parsing raw SMS into structured data
 * and storing results in the pending_sms table.
 *
 * Flow:
 *  1. Receive RawSMS[] from sms-reader
 *  2. Parse each through bank-patterns
 *  3. Store parsed results in pending_sms table
 *  4. Return summary of what was found
 */

import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { parseBankSMS, inferPaymentMode, extractTime } from "./bank-patterns";
import type { ParsedSMS } from "./bank-patterns";
import type { RawSMS } from "./sms-reader";
import { inferAccountTypeFromKeywords } from "@/services/financial-account";
import { bumpDataVersion } from "@/services/settings";
import { harvestReminderHintFromParsed } from "@/services/public-data/reminder-hints";
import { tryTemplateMatch } from "@/services/public-data/sms-template-matcher";
import { V15_FLAGS } from "@/services/feature-flags";
import { isBankSender, looksLikeTransaction } from "./bank-senders";
import { hasSenderScopedUserTemplate } from "./user-sms-templates";
import { resolveBankFromSender } from "@/services/public-data/lookup";
import { logger } from "@/utils/logger";

export interface ParseResult {
  /** Number of SMS successfully parsed */
  parsed: number;
  /** Number of SMS skipped (OTP, reminders, etc.) */
  skipped: number;
  /** Number of SMS that didn't match any pattern */
  unrecognized: number;
  /** Number of SMS already processed (duplicate) */
  duplicates: number;
  /** Errors encountered */
  errors: string[];
  /** The parsed items ready for review */
  items: ParsedItem[];
}

export interface ParsedItem {
  pendingSmsId: string;
  parsed: ParsedSMS;
  rawBody: string;
  smsDate: number;
  /** v15.13.0: Source of the parse (hardcoded pattern vs template) */
  parseSource: "hardcoded" | "template" | "unrecognized" | "skipped";
}

/**
 * Parse a batch of raw SMS messages.
 * Stores each in pending_sms, skipping duplicates.
 * Returns a summary of results.
 */
export async function parseSmsBatch(
  userId: string,
  messages: RawSMS[],
): Promise<ParseResult> {
  const db = getDatabase();
  const result: ParseResult = {
    parsed: 0,
    skipped: 0,
    unrecognized: 0,
    duplicates: 0,
    errors: [],
    items: [],
  };

  for (const sms of messages) {
    try {
      // Check if already processed (by Android SMS _id)
      const existing = await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM pending_sms WHERE sms_id = ?;",
        sms._id,
      );

      if (existing) {
        result.duplicates++;
        continue;
      }

      // Parse the SMS body
      let parsed = parseBankSMS(sms.body);
      let parseSource: "hardcoded" | "template" | "unrecognized" | "skipped" = "hardcoded";

      // v15 Phase 2 template fallback: if hardcoded BANK_PATTERNS missed, try
      // the DB-backed templates (system-seeded + user-authored).
      //
      // v15.7.0: Gate widened. Previously required isBankSender(). Now also
      // runs when the sender resolves to a bank via sms_sender_registry (which
      // user templates populate on save), OR when the body looks transactional
      // by keyword density. This lets user-authored templates actually catch
      // SMS from banks whose sender codes aren't in the hardcoded list.
      if (!parsed && V15_FLAGS.v15_sms_template_fallback) {
        const hardcodedBank = isBankSender(sms.address);
        let registeredBank: string | null = null;
        if (!hardcodedBank) {
          try {
            registeredBank = await resolveBankFromSender(sms.address);
          } catch {
            // Non-fatal — registry lookup is a hint.
          }
        }
        // v15.11.1: if a user template explicitly claims this sender,
        // bypass the "looksLikeTransaction" keyword gate. Wallet SMSes
        // (TataNeu NeuCoins, Amazon Pay Rewards, etc.) often lack the
        // bank-style keywords the heuristic checks for; the user's
        // decision to author a template IS the signal.
        const userClaimsSender = await hasSenderScopedUserTemplate(sms.address);
        const shouldTry =
          hardcodedBank ||
          registeredBank != null ||
          looksLikeTransaction(sms.body) ||
          userClaimsSender;
        if (shouldTry) {
          try {
            parsed = await tryTemplateMatch(sms.body, sms.address);
            if (parsed) {
              parseSource = "template";
            }
          } catch (e) {
            logger.warn("Template fallback failed (non-fatal):", e);
          }
        }
      }

      // v15.7.0: unparsed SMS that LOOK transactional are now persisted so
      // the user can see them in "Browse unrecognised SMS" and teach a
      // template. Heuristic: known bank sender OR body looks transactional.
      // This keeps promotional/OTP noise out while exposing everything that
      // might have been an expense.
      //
      // v15.11.1: also persist when a user template claims the sender —
      // the user should still see their wallet SMSes in the unrecognised
      // browser if the template (somehow) didn't match so they can debug.
      if (!parsed) {
        parseSource = "unrecognized";
        result.unrecognized++;
        const userClaimsSender = await hasSenderScopedUserTemplate(sms.address);
        const looksTransactional =
          isBankSender(sms.address) ||
          looksLikeTransaction(sms.body) ||
          userClaimsSender;
        if (looksTransactional) {
          try {
            const id = generateUUID();
            await db.runAsync(
              `INSERT INTO pending_sms (id, user_id, sms_id, address, body, sms_date, status, error_message)
               VALUES (?, ?, ?, ?, ?, ?, 'failed', 'unrecognised');`,
              id,
              userId,
              sms._id,
              sms.address,
              sms.body,
              sms.date,
            );
          } catch (e) {
            // If the insert itself fails, nothing to show the user — just log.
            logger.warn("Failed to persist unrecognised SMS (non-fatal):", e);
          }
        }
        continue;
      }

      // Enrich account type with keyword-based detection from raw SMS body
      // This overrides the pattern's accountType if keywords give a more specific answer
      if (!parsed.accountType || parsed.accountType === "savings") {
        const keywordType = inferAccountTypeFromKeywords(sms.body);
        if (keywordType) {
          parsed.accountType = keywordType;
        }
      }

      // Detect UPI P2M/P2A subtype from raw SMS body
      if (
        (parsed.type === "upi_debit" || parsed.type === "upi_credit" || parsed.type === "debit") &&
        !parsed.upiSubtype
      ) {
        const upiMatch = sms.body.match(/UPI\/(P2[MA])\//i);
        if (upiMatch) {
          parsed.upiSubtype = upiMatch[1].toUpperCase() === "P2M" ? "p2m" : "p2a";
        }
      }

      // V4: Infer payment mode from parsed data + raw SMS body
      if (!parsed.paymentMode) {
        parsed.paymentMode = inferPaymentMode(parsed, sms.body);
      }

      // V4: Extract transaction time from raw SMS body
      if (!parsed.transactionTime) {
        parsed.transactionTime = extractTime(sms.body);
      }

      if (parsed.skip) {
        parseSource = "skipped";
        result.skipped++;
        // Still store it as "ignored" for audit trail
        const id = generateUUID();
        await db.runAsync(
          `INSERT INTO pending_sms (id, user_id, sms_id, address, body, sms_date, status)
           VALUES (?, ?, ?, ?, ?, ?, 'ignored');`,
          id,
          userId,
          sms._id,
          sms.address,
          sms.body,
          sms.date,
        );
        continue;
      }

      // Store as pending
      const id = generateUUID();
      await db.runAsync(
        `INSERT INTO pending_sms (id, user_id, sms_id, address, body, sms_date, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending');`,
        id,
        userId,
        sms._id,
        sms.address,
        sms.body,
        sms.date,
      );

      // v15: stage reminder-type parses into reminder_suggestions alongside
      // the existing forecast-expense path. No-op for non-reminder parses
      // and when the flag is off. Additive only.
      await harvestReminderHintFromParsed(parsed, sms.body).catch((e) =>
        logger.warn("Reminder-hint harvest failed (non-fatal):", e),
      );

      result.parsed++;
      result.items.push({
        pendingSmsId: id,
        parsed,
        rawBody: sms.body,
        smsDate: sms.date,
        parseSource,
      });
    } catch (e) {
      result.errors.push(
        `SMS ${sms._id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (result.parsed > 0 || result.skipped > 0) await bumpDataVersion();
  return result;
}

/**
 * Get all pending SMS entries that haven't been converted to expenses yet.
 */
export async function getPendingSmsEntries(userId: string): Promise<
  Array<{
    id: string;
    sms_id: string;
    address: string;
    body: string;
    sms_date: number;
    status: string;
    created_at: string;
  }>
> {
  const db = getDatabase();
  return db.getAllAsync(
    `SELECT id, sms_id, address, body, sms_date, status, created_at
     FROM pending_sms
     WHERE user_id = ? AND status = 'pending'
     ORDER BY sms_date DESC;`,
    userId,
  );
}

/**
 * Get all pending_sms records (all statuses) for diagnostics / recycle bin.
 */
export async function getAllSmsRecords(userId: string): Promise<
  Array<{
    id: string;
    sms_id: string;
    address: string;
    body: string;
    sms_date: number;
    status: string;
    expense_id: string | null;
    created_at: string;
  }>
> {
  const db = getDatabase();
  return db.getAllAsync(
    `SELECT id, sms_id, address, body, sms_date, status, expense_id, created_at
     FROM pending_sms
     WHERE user_id = ?
     ORDER BY sms_date DESC;`,
    userId,
  );
}

/**
 * Get count of pending SMS entries.
 */
export async function getPendingSmsCount(userId: string): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM pending_sms WHERE user_id = ? AND status = 'pending';",
    userId,
  );
  return row?.count ?? 0;
}

/**
 * Mark a pending SMS entry as processed (linked to an expense).
 */
export async function markSmsProcessed(
  pendingSmsId: string,
  expenseId: string | null,
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE pending_sms
     SET status = 'processed', expense_id = ?, processed_at = datetime('now')
     WHERE id = ?;`,
    expenseId,
    pendingSmsId,
  );
  await bumpDataVersion();
}

/**
 * Mark a pending SMS entry as ignored (credit, balance inquiry, etc.).
 */
export async function markSmsIgnored(pendingSmsId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE pending_sms
     SET status = 'ignored', processed_at = datetime('now')
     WHERE id = ?;`,
    pendingSmsId,
  );
  await bumpDataVersion();
}

/**
 * Mark a pending SMS entry as failed.
 */
export async function markSmsFailed(
  pendingSmsId: string,
  errorMessage: string,
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE pending_sms
     SET status = 'failed', error_message = ?, processed_at = datetime('now')
     WHERE id = ?;`,
    errorMessage,
    pendingSmsId,
  );
  await bumpDataVersion();
}

/**
 * Delete a pending_sms record.
 * Removes the dedup block so a future scan can re-detect the same SMS.
 * If the SMS produced an expense/credit row, that linked row is also hard-deleted
 * (including any inbound FKs from hisaab_entries). Callers should have warned
 * the user about this cascade before invoking.
 */
export async function deleteSmsRecord(id: string): Promise<void> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ expense_id: string | null }>(
    "SELECT expense_id FROM pending_sms WHERE id = ?;",
    id,
  );
  const linkedExpenseId = row?.expense_id ?? null;

  if (linkedExpenseId) {
    await db.runAsync(
      "UPDATE hisaab_entries SET linked_expense_id = NULL WHERE linked_expense_id = ?;",
      linkedExpenseId,
    );
    await db.runAsync(
      "UPDATE hisaab_entries SET linked_account_credit_id = NULL WHERE linked_account_credit_id = ?;",
      linkedExpenseId,
    );
    await db.runAsync(
      "UPDATE expenses SET matched_forecast_id = NULL WHERE matched_forecast_id = ?;",
      linkedExpenseId,
    );
  }
  await db.runAsync("DELETE FROM pending_sms WHERE id = ?;", id);
  if (linkedExpenseId) {
    await db.runAsync("DELETE FROM expenses WHERE id = ?;", linkedExpenseId);
  }
  await bumpDataVersion();
}

/**
 * Look up the expense linked to an SMS record (if any), including amount and
 * account name. Used by delete-SMS dialogs to warn users about cascade.
 */
export async function getSmsLinkedExpenseInfo(smsId: string): Promise<{
  amount: number;
  nature: string;
  accountLabel: string | null;
} | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{
    amount: number;
    nature: string;
    account_label: string | null;
    bank_name: string | null;
    account_identifier: string | null;
  }>(
    `SELECT e.amount, e.nature, a.account_label, a.bank_name, a.account_identifier
     FROM pending_sms p
     JOIN expenses e ON e.id = p.expense_id
     LEFT JOIN financial_accounts a ON a.id = e.account_id
     WHERE p.id = ?;`,
    smsId,
  );
  if (!row) return null;
  const accountLabel =
    row.account_label ||
    (row.bank_name && row.account_identifier
      ? `${row.bank_name} ****${row.account_identifier}`
      : row.bank_name) ||
    null;
  return { amount: row.amount, nature: row.nature, accountLabel };
}

/**
 * Delete all pending_sms records for a user.
 * Removes all dedup blocks so a future scan can re-detect SMS. Also hard-deletes
 * any expenses/credits that were created from these SMS (clears their inbound
 * hisaab FKs first). Callers should warn the user about the cascade.
 */
export async function deleteAllSmsRecords(userId: string): Promise<number> {
  const db = getDatabase();
  const linkedRows = await db.getAllAsync<{ expense_id: string }>(
    "SELECT expense_id FROM pending_sms WHERE user_id = ? AND expense_id IS NOT NULL;",
    userId,
  );
  for (const { expense_id } of linkedRows) {
    await db.runAsync(
      "UPDATE hisaab_entries SET linked_expense_id = NULL WHERE linked_expense_id = ?;",
      expense_id,
    );
    await db.runAsync(
      "UPDATE hisaab_entries SET linked_account_credit_id = NULL WHERE linked_account_credit_id = ?;",
      expense_id,
    );
    await db.runAsync(
      "UPDATE expenses SET matched_forecast_id = NULL WHERE matched_forecast_id = ?;",
      expense_id,
    );
  }
  const result = await db.runAsync("DELETE FROM pending_sms WHERE user_id = ?;", userId);
  for (const { expense_id } of linkedRows) {
    await db.runAsync("DELETE FROM expenses WHERE id = ?;", expense_id);
  }
  if (result.changes > 0) await bumpDataVersion();
  return result.changes;
}

/**
 * Clear only unrecognised SMS records (those that never became expenses).
 * Safe to call — doesn't delete any linked expenses or credits.
 */
export async function clearUnrecognisedSms(userId: string): Promise<number> {
  const db = getDatabase();
  const result = await db.runAsync(
    "DELETE FROM pending_sms WHERE user_id = ? AND expense_id IS NULL;",
    userId,
  );
  return result.changes;
}
