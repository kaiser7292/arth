import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { getFlag } from "@/services/feature-flags";
import type { ParsedSMS, TransactionType } from "@/services/sms/bank-patterns";

/**
 * Staging surface for SMS that match a reminder-type pattern (Standing
 * Instruction pre-notices, EMI pre-notices, amount-due reminders, UPI
 * mandates). v14.7.0 pivoted away from auto-creating forecast expenses
 * from variable-amount reminders; this staging table collects the
 * reminder signals so a future UI can offer to create v14.7.0
 * recurring_expense_rules from them.
 *
 * Decoupling rationale: no FK from reminder_suggestions to
 * recurring_expense_rules keeps v15 from depending on v14.7.0 schema,
 * so either side can evolve without a cross-migration.
 *
 * Additive design: harvestFromParsed() runs ALONGSIDE the existing
 * sms-to-expense forecast path, not instead of it. Today a SI reminder
 * still creates a forecast expense AND a suggestion row. A later
 * release can remove the forecast path once the reminder rule flow is
 * proven.
 */

export interface ReminderSuggestionFields {
  /** Amount in INR. May be null if the template is a mandate-state change. */
  amount?: number;
  /** Merchant / biller name from the SMS. */
  merchant?: string;
  /** Account last-4 or short ID. */
  account_identifier?: string;
  /** ISO date (YYYY-MM-DD) the obligation is due. */
  due_date?: string;
  /** Optional mandate/standing-instruction reference. */
  mandate_ref?: string;
  /** Template-specific type: `standing_instruction`, `emi`, `bill_due`,
   * `auto_debit`, `mandate_created`, `mandate_revoked`. */
  reminder_kind?: string;
}

export interface ReminderSuggestionRow {
  id: string;
  matched_pattern_id: string;
  sms_body: string;
  extracted_fields_json: string;
  seen_at: string;
  resolved: number;
}

/**
 * Insert one reminder-hint match into the staging table. Idempotent on
 * (pattern_id, due_date, merchant, account) so the same upcoming SMS
 * re-scanned later doesn't duplicate.
 */
export async function recordReminderSuggestion(
  patternId: string,
  smsBody: string,
  fields: ReminderSuggestionFields,
): Promise<void> {
  const db = getDatabase();

  if (fields.due_date && (fields.merchant || fields.account_identifier)) {
    const existing = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM reminder_suggestions
       WHERE matched_pattern_id = ?
         AND resolved = 0
         AND json_extract(extracted_fields_json, '$.due_date') = ?
         AND COALESCE(json_extract(extracted_fields_json, '$.merchant'), '')
             = COALESCE(?, '')
         AND COALESCE(json_extract(extracted_fields_json, '$.account_identifier'), '')
             = COALESCE(?, '');`,
      patternId,
      fields.due_date,
      fields.merchant ?? null,
      fields.account_identifier ?? null,
    );
    if (existing) return;
  }

  await db.runAsync(
    `INSERT INTO reminder_suggestions
     (id, matched_pattern_id, sms_body, extracted_fields_json)
     VALUES (?, ?, ?, ?);`,
    generateUUID(),
    patternId,
    smsBody,
    JSON.stringify(fields),
  );
}

export async function getUnresolvedReminderSuggestions(): Promise<ReminderSuggestionRow[]> {
  const db = getDatabase();
  return await db.getAllAsync<ReminderSuggestionRow>(
    "SELECT * FROM reminder_suggestions WHERE resolved = 0 ORDER BY seen_at DESC;",
  );
}

export async function markReminderSuggestionResolved(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "UPDATE reminder_suggestions SET resolved = 1 WHERE id = ?;",
    id,
  );
}

/**
 * Maps bank-patterns TransactionType to the staging reminder_kind. Returns
 * null for transaction types that aren't reminders — the caller will
 * short-circuit on null without any DB work.
 */
function toReminderKind(type: TransactionType): string | null {
  switch (type) {
    case "standing_instruction_reminder":
      return "standing_instruction";
    case "emi_reminder":
      return "emi";
    case "amount_due_reminder":
      return "bill_due";
    default:
      return null;
  }
}

/**
 * Harvest a reminder-hint suggestion from a ParsedSMS whose `type` is a
 * reminder variant. No-op for non-reminder parses and when the
 * `v15_reminder_hint_harvest` flag is off. Safe to call on every parsed
 * SMS — cheap when it's not a reminder.
 *
 * Idempotency: `recordReminderSuggestion` dedups by
 * (pattern_id, due_date, merchant, account_identifier), so parsing the
 * same SMS twice never produces two suggestions.
 */
export async function harvestReminderHintFromParsed(
  parsed: ParsedSMS,
  rawBody: string,
): Promise<void> {
  if (!getFlag("v15_reminder_hint_harvest")) return;

  const kind = toReminderKind(parsed.type);
  if (!kind) return;
  if (!parsed.dueDate) return;

  const patternId = `bank-pattern:${parsed.type}`;
  await recordReminderSuggestion(patternId, rawBody, {
    amount: parsed.amount,
    merchant: parsed.merchant ?? undefined,
    account_identifier: parsed.cardLast4 ?? undefined,
    due_date: parsed.dueDate,
    reminder_kind: kind,
  });
}
