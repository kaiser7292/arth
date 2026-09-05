/**
 * SMS-to-Expense converter.
 * Takes a parsed SMS result and creates a pending expense record.
 *
 * The expense is created with:
 *  - source: 'sms_auto'
 *  - status: 'pending_review' (user must approve in review queue)
 *  - raw_source_text: the original SMS body (stored for reference)
 *
 * Security: Only last 4 digits of card/account stored.
 * Full SMS body is stored in raw_source_text for user reference
 * but never logged or transmitted.
 */

import { getDatabase } from "@/database";
import { autoPopulateAccountMode, findPaymentModeByType } from "@/services/account-master";
import { autoDetectTransfer, createTransfer } from "@/services/account-transfer";
import { findMatchingForecast, findRefundTarget } from "@/services/expense";
import { findMatchingRepaymentForecast, markRepaymentAsPaid } from "@/services/expense-forecasts";
import { discoverOrUpdateAccount, handlePaymentReceived, linkExpenseToAccount, updateAccountDues, updateNachInfo } from "@/services/financial-account";
import { cleanMerchantName, normalizeMerchantName } from "@/services/merchant-alias";
import { bumpDataVersion } from "@/services/settings";
import { categorizeByMerchant } from "@/services/smart-categorizer";
import { applyAllRules, stampApplication } from "@/services/smart-rules";
import { splitExistingExpense } from "@/services/expense-splits";
import type { SplitConfig } from "@/services/expense-types";
import { formatLocalDate } from "@/utils/fiscal-year";
import { logger } from "@/utils/logger";
import { generateUUID } from "@/utils/uuid";
import type { ParsedSMS } from "./bank-patterns";
import { markSmsFailed, markSmsIgnored, markSmsProcessed } from "./sms-parser";

export interface SmsExpenseResult {
  success: boolean;
  expenseId: string | null;
  isCredit: boolean;
  error: string | null;
  /** IDs of all smart rules that fired for this expense (in priority order). */
  appliedRuleIds?: string[] | null;
}

/**
 * Create a pending expense from a parsed SMS.
 *
 * @param userId - User ID
 * @param pendingSmsId - ID in the pending_sms table (for linking)
 * @param parsed - Structured data extracted from SMS
 * @param rawBody - Original SMS text
 */
export async function createExpenseFromSms(
  userId: string,
  pendingSmsId: string,
  parsed: ParsedSMS,
  rawBody: string,
  smsDate?: number,
): Promise<SmsExpenseResult> {
  // Don't create expenses for skipped SMS or balance inquiries.
  // For balance_inquiry, still update the account's last_known_balance /
  // credit_limit so the app reflects the most recent bank-reported balance
  // even though no expense is created.
  const IGNORED_TYPES = ["balance_inquiry"] as const;
  if (parsed.skip || (IGNORED_TYPES as readonly string[]).includes(parsed.type)) {
    if (parsed.type === "balance_inquiry") {
      await discoverOrUpdateAccount(userId, parsed, pendingSmsId);
    }
    await markSmsIgnored(pendingSmsId);
    return { success: true, expenseId: null, isCredit: false, error: null };
  }

  // Credit SMS — create a pending_review credit expense.
  // Account is NOT created here; it's resolved (or created) only if the user
  // approves the credit in the review queue. If an account already exists for
  // this (bank, cardLast4), link it immediately so the user sees the context.
  if (parsed.type === "credit" || parsed.type === "upi_credit") {
    if (!parsed.amount) {
      await markSmsIgnored(pendingSmsId);
      return { success: true, expenseId: null, isCredit: true, error: null };
    }

    const db = getDatabase();
    const expenseId = generateUUID();
    const date = parsed.date ?? (smsDate ? formatLocalDate(new Date(smsDate)) : formatLocalDate(new Date()));
    const transactionTime = parsed.transactionTime ?? "00:00:00";
    const now = new Date().toISOString(); // Local time in ISO format

    await db.runAsync(
      `INSERT INTO expenses (id, user_id, amount, currency, description, merchant_name, raw_merchant_name, date, transaction_time, nature, source, status, raw_source_text, created_at)
       VALUES (?, ?, ?, 'INR', ?, ?, ?, ?, ?, 'credit', 'sms_auto', 'pending_review', ?, ?);`,
      expenseId,
      userId,
      parsed.amount,
      null,
      parsed.merchant ?? null,
      parsed.merchant ?? null,
      date,
      transactionTime,
      rawBody,
      now,
    );
    // Best-effort link to an existing account (no creation).
    await linkExpenseToAccount(userId, expenseId, parsed.cardLast4, parsed.bank, parsed.accountNickname);
    await markSmsProcessed(pendingSmsId, expenseId);
    await bumpDataVersion();
    return { success: true, expenseId, isCredit: true, error: null };
  }

  // NACH bounce — flag but don't create an expense
  if (parsed.type === "nach_bounce") {
    await discoverOrUpdateAccount(userId, parsed, pendingSmsId);
    await markSmsProcessed(pendingSmsId, null);
    return { success: true, expenseId: null, isCredit: false, error: null };
  }

  // Payment received (CC bill payment).
  //
  // Matching ladder (most-specific → most-generic):
  //  1. Open repayment FORECAST on this CC, amount within ±0.5%
  //     → if a matching savings debit exists too, execute markRepaymentAsPaid
  //       (transfer + dues) and we're done.
  //     → if no matching savings debit, create a pending_review credit linked
  //       to the forecast (matched_forecast_id). User picks source account in
  //       the review queue, which then triggers markRepaymentAsPaid.
  //  2. No forecast match → look for a recent savings debit with the same
  //     amount (existing behavior) → reclassify it as a transfer.
  //  3. No signal at all → land as pending_review credit so the user can
  //     approve/reject and supply a source account manually. (Previously we
  //     auto-approved, which was too aggressive — user couldn't review.)
  if (parsed.type === "payment_received") {
    if (!parsed.amount) {
      await markSmsIgnored(pendingSmsId);
      return { success: true, expenseId: null, isCredit: false, error: null };
    }

    const db = getDatabase();
    const date = parsed.date ?? (smsDate ? formatLocalDate(new Date(smsDate)) : formatLocalDate(new Date()));
    const transactionTime = parsed.transactionTime ?? "00:00:00";

    // Resolve/create the CC account (authoritative for the ledger side).
    const ccAccountId = await discoverOrUpdateAccount(userId, parsed, pendingSmsId);
    if (ccAccountId) {
      await handlePaymentReceived(ccAccountId, parsed);
    }

    // Step 1: check for a matching repayment forecast on this CC (±0.5%).
    const forecastMatch = ccAccountId
      ? await findMatchingRepaymentForecast(userId, ccAccountId, parsed.amount, date)
      : null;

    // Step 2: look for a recent savings debit with the same amount (±0.5%)
    // that could be the other side of this payment.
    const tolerance = Math.max(parsed.amount * 0.005, 0.01);
    const minAmount = parsed.amount - tolerance;
    const maxAmount = parsed.amount + tolerance;
    const savingsMatch = await db.getFirstAsync<{ id: string; account_id: string }>(
      `SELECT e.id, e.account_id FROM expenses e
       INNER JOIN financial_accounts fa ON fa.id = e.account_id
       WHERE fa.user_id = ? AND fa.is_active = 1
         AND fa.account_type = 'savings'
         AND e.nature = 'realized' AND e.status IN ('approved','pending_review')
         AND e.deleted_at IS NULL
         AND e.amount >= ? AND e.amount <= ?
         AND e.date >= date(?, '-2 day')
         AND e.date <= date(?, '+2 day')
       ORDER BY ABS(e.amount - ?) ASC, ABS(julianday(e.date) - julianday(?)) ASC
       LIMIT 1;`,
      userId,
      minAmount,
      maxAmount,
      date,
      date,
      parsed.amount,
      date,
    );

    // Case A: forecast found + source account known → run the Pay flow.
    if (forecastMatch && savingsMatch && ccAccountId) {
      try {
        await markRepaymentAsPaid(forecastMatch.id, savingsMatch.account_id);
        // Soft-delete the realized savings debit; the transfer now represents
        // that movement correctly.
        await db.runAsync(
          `UPDATE expenses SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?;`,
          savingsMatch.id,
        );
        await markSmsProcessed(pendingSmsId, null);
        await bumpDataVersion();
        return { success: true, expenseId: forecastMatch.id, isCredit: true, error: null };
      } catch {
        // Fall through to Case B if the pay flow failed.
      }
    }

    // Case B: forecast matched but no source account in SMS → create a
    // pending_review credit linked to the forecast so the user picks the
    // source account in the review queue.
    // Case C: no forecast matched but savings debit matched → reclassify
    // the savings debit as a transfer (existing behavior, widened tolerance).
    // Case D: neither matched → pending_review credit, user approves manually.

    const parts: string[] = [];
    if (parsed.bank) parts.push(parsed.bank);
    parts.push("(CC Bill Payment)");
    const description = parts.join(" ") || "Credit card bill payment";

    if (!forecastMatch && savingsMatch && ccAccountId) {
      // Case C: clean transfer flow — no review queue, SMS is authoritative.
      const transferId = await createTransfer({
        userId,
        fromAccountId: savingsMatch.account_id,
        toAccountId: ccAccountId,
        amount: parsed.amount,
        description: `CC bill payment — ${parsed.bank ?? ""}`.trim(),
        date,
        linkedExpenseId: savingsMatch.id,
        source: "sms_auto",
      });
      await db.runAsync(
        `UPDATE expenses SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?;`,
        savingsMatch.id,
      );
      await markSmsProcessed(pendingSmsId, null);
      await bumpDataVersion();
      return { success: true, expenseId: transferId, isCredit: true, error: null };
    }

    // Case B or D: land as pending_review credit on the CC ledger. The
    // review queue shows these under Auto-Detected; if matched_forecast_id
    // is set the approval UI can route through markRepaymentAsPaid with an
    // account picker.
    const expenseId = generateUUID();
    const now = new Date().toISOString(); // Local time in ISO format
    await db.runAsync(
      `INSERT INTO expenses (id, user_id, amount, currency, description, merchant_name, raw_merchant_name, account_id, date, transaction_time, nature, source, status, raw_source_text, matched_forecast_id, created_at)
       VALUES (?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, 'credit', 'sms_auto', 'pending_review', ?, ?, ?);`,
      expenseId,
      userId,
      parsed.amount,
      description,
      parsed.merchant ?? "CC Bill Payment",
      parsed.merchant ?? null,
      ccAccountId ?? null,
      date,
      transactionTime,
      rawBody,
      forecastMatch?.id ?? null,
      now,
    );
    if (!ccAccountId) {
      await linkExpenseToAccount(userId, expenseId, parsed.cardLast4, parsed.bank, parsed.accountNickname);
    }

    await markSmsProcessed(pendingSmsId, expenseId);
    await bumpDataVersion();
    return { success: true, expenseId, isCredit: true, error: null };
  }

  // Derive fallback date from SMS metadata timestamp (or today if unavailable)
  const fallbackDate = smsDate
    ? formatLocalDate(new Date(smsDate))
    : formatLocalDate(new Date());

  const REALIZED_TYPES = ["debit", "standing_instruction", "nach_debit", "upi_debit"] as const;
  const REFUND_TYPE = "refund";
  const FORECAST_TYPES = ["standing_instruction_reminder", "emi_reminder", "amount_due_reminder"] as const;

  const isRealized = (REALIZED_TYPES as readonly string[]).includes(parsed.type);
  const isRefund = parsed.type === REFUND_TYPE;
  const isForecast = (FORECAST_TYPES as readonly string[]).includes(parsed.type);

  if (!isRealized && !isRefund && !isForecast) {
    return { success: true, expenseId: null, isCredit: false, error: null };
  }

  try {
    const db = getDatabase();

    // Normalize merchant name: strip prefixes, apply user aliases
    const rawMerchantName = parsed.merchant ? cleanMerchantName(parsed.merchant) : null;
    const normalizedMerchant = await normalizeMerchantName(userId, parsed.merchant);
    const parsedWithNormalizedMerchant = { ...parsed, merchant: normalizedMerchant };
    const description = buildDescription(parsedWithNormalizedMerchant);

    // Smart categorization: auto-assign category from merchant name
    const categorization = await categorizeByMerchant(userId, normalizedMerchant);
    let categoryId: string | null = categorization.categoryId;

    // Discover or update the financial account from this SMS
    const accountId = await discoverOrUpdateAccount(userId, parsed, pendingSmsId);

    // V4: Resolve payment mode from parsed SMS detection
    let paymentModeId: string | null = null;
    if (parsed.paymentMode) {
      const mode = await findPaymentModeByType(userId, parsed.paymentMode);
      if (mode) {
        paymentModeId = mode.id;
        // Auto-populate account ↔ payment mode link table
        if (accountId) {
          await autoPopulateAccountMode(accountId, mode.id);
        }
      }
    }
    // Override with the template's default payment mode when a user template matched.
    // User-set preference wins over whatever the parser auto-detected.
    if (parsed._matchedTemplateId) {
      try {
        const row = await db.getFirstAsync<{ default_payment_mode_id: string | null }>(
          `SELECT default_payment_mode_id FROM sms_template_patterns WHERE id = ?;`,
          parsed._matchedTemplateId,
        );
        if (row?.default_payment_mode_id) {
          paymentModeId = row.default_payment_mode_id;
          if (accountId) {
            await autoPopulateAccountMode(accountId, paymentModeId);
          }
        }
      } catch {
        // Non-fatal — payment mode is optional
      }
    }

    // V4: Transaction time from SMS (defaults to 00:00:00 for formats without time)
    const transactionTime = parsed.transactionTime ?? "00:00:00";

    // For NACH debits, also update NACH mandate info on the account
    if (parsed.type === "nach_debit" && accountId && parsed.merchant) {
      await updateNachInfo(accountId, parsed.merchant, parsed.amount);
    }

    // For refund SMS, create a realized expense and try to link to original
    if (isRefund) {
      const date = parsed.date ?? fallbackDate;
      const expenseId = generateUUID();

      // Try to find the original expense this refund relates to
      const originalExpense = await findRefundTarget(
        userId,
        parsed.amount,
        parsed.cardLast4,
        date,
      );
      const now = new Date().toISOString(); // Local time in ISO format

      await db.runAsync(
        `INSERT INTO expenses (id, user_id, amount, currency, description, merchant_name, raw_merchant_name, category_id, payment_mode_id, date, transaction_time, nature, source, status, raw_source_text, refund_of_expense_id, created_at)
         VALUES (?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, 'credit', 'sms_auto', 'pending_review', ?, ?, ?);`,
        expenseId,
        userId,
        parsed.amount,
        description,
        normalizedMerchant ?? null,
        rawMerchantName,
        categoryId,
        paymentModeId,
        date,
        transactionTime,
        rawBody,
        originalExpense?.id ?? null,
        now,
      );
      await linkExpenseToAccount(userId, expenseId, parsed.cardLast4, parsed.bank, parsed.accountNickname);
      await markSmsProcessed(pendingSmsId, expenseId);
      await bumpDataVersion();
      return { success: true, expenseId, isCredit: false, error: null };
    }

    // For realized transactions, check if a matching forecast exists
    if (isRealized) {
      const date = parsed.date ?? fallbackDate;

      // Discover the account first so we can use account_id for matching
      const matchAccountId = accountId ?? null;
      const matchResult = await findMatchingForecast(
        userId,
        parsed.amount,
        matchAccountId,
        date,
        normalizedMerchant ?? parsed.merchant ?? null,
      );

      // v15.2: apply smart rules before insert. Rule can:
      //   - fill category / payment mode when auto-categorizer didn't
      //   - promote status to 'approved' when action_mark_auto is 1
      //   - stamp applied_rule_id for audit
      let ruleAppliedRuleId: string | null = null;
      let ruleAppliedRuleIdsJson: string | null = null;
      let matchedRuleIds: string[] = [];
      let status: "pending_review" | "approved" = "pending_review";
      let ruleSplitPersonId: string | null = null;
      let ruleSplitMode: string | null = null;
      let ruleSplitPaidBy: string | null = null;
      let ruleSplitPercentage: number | null = null;
      let ruleSplitExactAmount: number | null = null;
      try {
        const allRules = await applyAllRules({
          amount: parsed.amount,
          merchant: normalizedMerchant ?? parsed.merchant ?? null,
          raw_merchant: rawMerchantName,
          description,
          category_id: categoryId,
          account_id: accountId ?? null,
          payment_mode_id: paymentModeId ?? null,
          sms_body: rawBody,
        });
        if (allRules) {
          const { application: ruleApp, ruleIds } = allRules;
          if (ruleApp.category_id) categoryId = ruleApp.category_id;
          if (ruleApp.payment_mode) paymentModeId = ruleApp.payment_mode;
          if (ruleApp.mark_auto) status = "approved";
          ruleSplitPersonId = ruleApp.split_person_id;
          ruleSplitMode = ruleApp.split_mode;
          ruleSplitPaidBy = ruleApp.split_paid_by;
          ruleSplitPercentage = ruleApp.split_percentage;
          ruleSplitExactAmount = ruleApp.split_exact_amount;
          matchedRuleIds = ruleIds;
          ruleAppliedRuleId = ruleIds[ruleIds.length - 1];
          ruleAppliedRuleIdsJson = JSON.stringify(ruleIds);
        }
      } catch (e) {
        logger.warn("Smart rule application failed in SMS realize path (non-fatal):", e);
      }

      // Create the realized expense — always create, never auto-realize forecasts
      const expenseId = generateUUID();
      const now = new Date().toISOString(); // Local time in ISO format
      await db.runAsync(
        `INSERT INTO expenses (id, user_id, amount, currency, description, merchant_name, raw_merchant_name, category_id, payment_mode_id, date, transaction_time, nature, source, status, raw_source_text, matched_forecast_id, applied_rule_id, applied_rule_ids, created_at)
         VALUES (?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, 'realized', 'sms_auto', ?, ?, ?, ?, ?, ?);`,
        expenseId,
        userId,
        parsed.amount,
        null,
        normalizedMerchant ?? null,
        rawMerchantName,
        categoryId,
        paymentModeId,
        date,
        transactionTime,
        status,
        rawBody,
        matchResult ? matchResult.forecast.id : null,
        ruleAppliedRuleId,
        ruleAppliedRuleIdsJson,
        now,
      );
      for (const ruleId of matchedRuleIds) {
        stampApplication(ruleId).catch(() => {});
      }
      // Link expense to its financial account
      await linkExpenseToAccount(userId, expenseId, parsed.cardLast4, parsed.bank, parsed.accountNickname);

      // Apply split from rule (if any). Uses skipAutoApprove so the expense
      // stays in pending_review for the user to confirm in the review queue.
      if (ruleSplitPersonId) {
        try {
          const splitConfig: SplitConfig = {
            paidBy: (ruleSplitPaidBy as SplitConfig["paidBy"]) ?? "me",
            splitMode: (ruleSplitMode as SplitConfig["splitMode"]) ?? "equal",
            personId: ruleSplitPersonId,
            ...(ruleSplitPercentage != null ? { percentage: ruleSplitPercentage } : {}),
            ...(ruleSplitExactAmount != null ? { exactAmount: ruleSplitExactAmount } : {}),
          };
          await splitExistingExpense(expenseId, splitConfig, { skipAutoApprove: true });
        } catch (e) {
          logger.warn("Smart rule split application failed in SMS path (non-fatal):", e);
        }
      }

      // Check if this savings debit might be a self-transfer (IMPS P2A or net banking)
      if (accountId && (parsed.paymentMode === "net_banking" || parsed.upiSubtype === "p2a")) {
        const destAccountId = await autoDetectTransfer(userId, accountId, parsed.amount, date);
        if (destAccountId) {
          await createTransfer({
            userId,
            fromAccountId: accountId,
            toAccountId: destAccountId,
            amount: parsed.amount,
            description: `Self transfer — ${parsed.bank}`,
            date,
            linkedExpenseId: expenseId,
            source: "sms_auto",
          });
          await db.runAsync(
            `UPDATE expenses SET deleted_at = datetime('now') WHERE id = ?;`,
            expenseId,
          );
        }
      }

      await markSmsProcessed(pendingSmsId, expenseId);
      await bumpDataVersion();
      return { success: true, expenseId, isCredit: false, error: null, appliedRuleIds: matchedRuleIds.length > 0 ? matchedRuleIds : null };
    }

    // v17.6.0 — if this is an EMI reminder AND we can match it to a known
    // loan by (bank_name, last-4 digits), stamp the loan's reminder columns
    // and skip creating a generic forecast expense. The loan detail banner
    // surfaces the reminder inside the loan page itself.
    if (parsed.type === "emi_reminder" && parsed.cardLast4 && parsed.dueDate) {
      const acctDigits = parsed.cardLast4.replace(/\D/g, "");
      if (acctDigits.length >= 3) {
        // Find a loan whose FA matches this user + bank + identifier ends with
        // the SMS's last-4 digits. Bank match is loose (same normalized prefix)
        // to survive user-friendly bank names (e.g. "Axis" vs "Axis Bank").
        const loan = await db.getFirstAsync<{ id: string }>(
          `SELECT la.id FROM loan_accounts la
            JOIN financial_accounts fa ON fa.id = la.financial_account_id
           WHERE fa.user_id = ?
             AND fa.is_active = 1
             AND la.status = 'active'
             AND LOWER(TRIM(fa.bank_name)) = LOWER(TRIM(?))
             AND (
               fa.account_identifier = ?
               OR fa.account_identifier LIKE '%' || ?
             )
           ORDER BY la.created_at DESC
           LIMIT 1;`,
          userId,
          parsed.bank,
          acctDigits,
          acctDigits,
        );
        if (loan) {
          const nowIso = new Date().toISOString();
          await db.runAsync(
            `UPDATE loan_accounts
                SET last_sms_reminder_at = ?,
                    last_sms_reminder_due_date = ?,
                    last_sms_reminder_amount = ?,
                    updated_at = datetime('now')
              WHERE id = ?;`,
            nowIso,
            parsed.dueDate,
            parsed.amount,
            loan.id,
          );
          // No forecast expense created — the loan's own amortization
          // schedule already holds the upcoming EMI. Mark the SMS processed.
          await markSmsProcessed(pendingSmsId, null);
          await bumpDataVersion();
          return { success: true, expenseId: null, isCredit: false, error: null };
        }
      }
    }

    // Forecast: create a forecast expense with due_date
    const expenseId = generateUUID();
    const today = new Date().toISOString().split("T")[0];
    const now = new Date().toISOString(); // Local time in ISO format

    const forecastType =
      parsed.type === "amount_due_reminder" && parsed.accountType === "credit_card"
        ? "repayment"
        : "expense";

    await db.runAsync(
      `INSERT INTO expenses (id, user_id, amount, currency, description, merchant_name, raw_merchant_name, category_id, payment_mode_id, date, transaction_time, nature, due_date, source, status, raw_source_text, forecast_type, created_at)
       VALUES (?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, 'forecast', ?, 'sms_auto', 'pending_review', ?, ?, ?);`,
      expenseId,
      userId,
      parsed.amount,
      description,
      normalizedMerchant ?? null,
      rawMerchantName,
      categoryId,
      paymentModeId,
      today,
      transactionTime,
      parsed.dueDate,
      rawBody,
      forecastType,
      now,
    );
    // Link forecast expense to its financial account
    await linkExpenseToAccount(userId, expenseId, parsed.cardLast4, parsed.bank, parsed.accountNickname);

    // For CC due reminders, also update the account's dues info
    if (parsed.type === "amount_due_reminder" && accountId && parsed.dueDate) {
      await updateAccountDues(accountId, parsed.amount, parsed.minDue ?? null, parsed.dueDate);
    }

    await markSmsProcessed(pendingSmsId, expenseId);
    await bumpDataVersion();
    return { success: true, expenseId, isCredit: false, error: null };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    await markSmsFailed(pendingSmsId, errorMsg);
    return { success: false, expenseId: null, isCredit: false, error: errorMsg };
  }
}

/**
 * Build a human-readable description from parsed SMS data.
 * Format: "merchant via Bank (Type)". Masked account digits deliberately
 * excluded — account context is carried by account_id and showing "****1234"
 * in the description duplicates what the linked account already labels.
 */
function buildDescription(parsed: ParsedSMS): string {
  const parts: string[] = [];

  if (parsed.merchant) {
    parts.push(parsed.merchant);
  }

  if (parsed.bank) {
    parts.push(`via ${parsed.bank}`);
  }

  if (parsed.type === "standing_instruction") {
    parts.push("(Standing Instruction)");
  } else if (parsed.type === "standing_instruction_reminder") {
    parts.push("(Upcoming SI)");
  } else if (parsed.type === "emi_reminder") {
    parts.push("(EMI Due)");
  } else if (parsed.type === "amount_due_reminder") {
    parts.push("(Amount Due)");
  } else if (parsed.type === "refund") {
    parts.push("(Refund)");
  } else if (parsed.type === "nach_debit") {
    parts.push("(NACH Auto-Debit)");
  } else if (parsed.upiSubtype === "p2a") {
    parts.push("(UPI Transfer)");
  } else if (parsed.upiSubtype === "p2m") {
    parts.push("(UPI Payment)");
  }

  return parts.join(" ") || "Bank transaction";
}

/**
 * Process a batch of parsed items — creates pending expenses for each.
 * Returns the count of expenses created.
 */
export async function processParseResults(
  userId: string,
  items: Array<{
    pendingSmsId: string;
    parsed: ParsedSMS;
    rawBody: string;
    smsDate?: number;
  }>,
): Promise<{
  created: number;
  credits: number;
  skipped: number;
  errors: string[];
  itemResults: Array<{ pendingSmsId: string; appliedRuleIds: string[] | null }>;
}> {
  let created = 0;
  let credits = 0;
  let skipped = 0;
  const errors: string[] = [];
  const itemResults: Array<{ pendingSmsId: string; appliedRuleIds: string[] | null }> = [];

  for (const item of items) {
    const result = await createExpenseFromSms(
      userId,
      item.pendingSmsId,
      item.parsed,
      item.rawBody,
      item.smsDate,
    );

    itemResults.push({ pendingSmsId: item.pendingSmsId, appliedRuleIds: result.appliedRuleIds ?? null });

    if (result.error) {
      errors.push(result.error);
    } else if (result.expenseId) {
      created++;
    } else if (result.isCredit) {
      credits++;
    } else {
      skipped++;
    }
  }

  return { created, credits, skipped, errors, itemResults };
}
