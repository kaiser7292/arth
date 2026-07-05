/**
 * Financial Account Service
 *
 * Auto-discovers bank accounts and credit cards from SMS data.
 * Tracks credit limits, available balance, and dues per account.
 * Only stores last 4 digits — never full account numbers.
 */

import { getDatabase } from "@/database";
import { addCredit } from "@/services/account-credit";
import type { MonthlyTotal } from "@/services/expense-types";
import { bumpDataVersion } from "@/services/settings";
import { generateUUID } from "@/utils/uuid";
import type { ParsedSMS } from "./sms/bank-patterns";

export type AccountType = "savings" | "credit_card" | "loan" | "wallet" | "demat" | "pension";

export interface FinancialAccount {
  id: string;
  user_id: string;
  account_identifier: string;
  bank_name: string;
  account_type: AccountType;
  account_label: string | null;
  credit_limit: number | null;
  last_known_balance: number | null;
  last_balance_date: string | null;
  total_due: number | null;
  min_due: number | null;
  due_date: string | null;
  is_active: number;
  discovered_from_sms: number;
  fund_balance: number;
  account_number: string | null;
  /** Loose ref to pending_sms.id that supplied the current last_known_balance. */
  last_balance_sms_id: string | null;
  /**
   * v15.5: savings min-balance alert threshold. Default 0 = feature off
   * for this account. When > 0 and the computed closing balance drops
   * below, Home shows a dismissable alert. Non-savings accounts ignore
   * this field (enforced by detectBreaches in services/min-balance.ts).
   */
  min_balance: number;
  created_at: string;
  updated_at: string;
}

export interface PortfolioSnapshot {
  id: string;
  account_id: string;
  snapshot_date: string;
  portfolio_value: number;
  created_at: string;
  updated_at: string;
}

export interface DematAccountSummary {
  account: FinancialAccount;
  latestPortfolioValue: number | null;
  latestSnapshotDate: string | null;
  snapshotCount: number;
  /**
   * Latest fund (idle cash) value from demat_fund_snapshots. This is the
   * v14.5.0 replacement for reading account.fund_balance directly — the
   * scalar column is a deprecated legacy mirror.
   */
  latestFundValue: number;
}

/**
 * Infer the account type from the ParsedSMS context.
 * Uses parsed accountType if set, then credit limit heuristic,
 * then returns "savings" as last resort. null means truly unknown.
 */
function inferAccountType(parsed: ParsedSMS): "savings" | "credit_card" | "loan" | "wallet" | "pension" {
  if (parsed.accountType) return parsed.accountType;

  // Heuristic: if we have credit limit info, it's a credit card
  if (parsed.creditLimit || parsed.availableCreditLimit) return "credit_card";

  // Wallet platforms
  const walletBanks = ["Paytm", "Paytm Payments Bank"];
  if (walletBanks.includes(parsed.bank) && !parsed.cardLast4) return "wallet";

  return "savings";
}

/**
 * Infer account type from raw SMS body keywords.
 * Called when the bank pattern doesn't explicitly set accountType.
 * Returns null if the type cannot be determined (user classifies in review).
 */
export function inferAccountTypeFromKeywords(
  smsBody: string,
): "savings" | "credit_card" | "loan" | "wallet" | null {
  const body = smsBody.toUpperCase();

  // Credit card keywords
  if (/CREDIT\s*CARD|CC\s*NO|CARD\s+NO\.?\s*XX/i.test(body)) return "credit_card";
  if (/AVAIL\s*CR\s*LIMIT|AVAILABLE\s*CREDIT|CREDIT\s*LIMIT/i.test(body)) return "credit_card";
  if (/YOUR\s+.*CARD\s+(ENDING|XX)/i.test(body) && !/DEBIT/i.test(body)) return "credit_card";

  // Loan keywords
  if (/LOAN\s*A\/C|LOAN\s*ACCOUNT|EMI\s+FOR\s+LOAN|HOME\s+LOAN|PERSONAL\s+LOAN|CAR\s+LOAN/i.test(body)) return "loan";

  // Savings/current account keywords
  if (/A\/C\s*NO|ACC\s*(NO)?\.?\s*\d|AVL\s*BAL|AVAILABLE\s*BAL|AVAIL\s*BAL/i.test(body)) return "savings";
  if (/SAVINGS\s*A\/C|CURRENT\s*A\/C|SB\s*A\/C/i.test(body)) return "savings";

  // Wallet keywords
  if (/WALLET|PAYTM\s*BALANCE|FREECHARGE/i.test(body)) return "wallet";

  return null;
}

/**
 * Validate account type value.
 * Ensures only valid account types are stored in the database.
 */
export function isValidAccountType(type: string): type is AccountType {
  return ['savings', 'credit_card', 'loan', 'wallet', 'demat', 'pension'].includes(type);
}

/**
 * Get pension account summary.
 * Returns total balance, account count, and last contribution date for all pension accounts.
 */
export async function getPensionSummary(userId: string): Promise<{
  totalBalance: number;
  accountCount: number;
  lastContributionDate: string | null;
}> {
  const db = getDatabase();
  const accounts = await db.getAllAsync<FinancialAccount>(
    `SELECT * FROM financial_accounts WHERE user_id = ? AND account_type = 'pension' AND is_active = 1`,
    userId,
  );

  const totalBalance = accounts.reduce((sum, acc) => sum + (acc.last_known_balance ?? 0), 0);
  const accountCount = accounts.length;

  // Get the most recent balance date from any pension account
  const lastContributionDate = accounts
    .map((acc) => acc.last_balance_date)
    .filter((date): date is string => date !== null)
    .sort()
    .pop() ?? null;

  return {
    totalBalance,
    accountCount,
    lastContributionDate,
  };
}

/**
 * Discover or update a financial account from parsed SMS data.
 * Creates the account if it doesn't exist, updates balance/limit info if it does.
 * Returns the account ID.
 */
export async function discoverOrUpdateAccount(
  userId: string,
  parsed: ParsedSMS,
  pendingSmsId?: string,
): Promise<string | null> {
  if (!parsed.cardLast4) return null;

  const db = getDatabase();
  const accountType = inferAccountType(parsed);

  // Check if account already exists (including deactivated ones)
  const existing = await db.getFirstAsync<{ id: string; is_active: number }>(
    `SELECT id, is_active FROM financial_accounts
     WHERE user_id = ? AND account_identifier = ? AND bank_name = ? AND account_type = ?;`,
    userId,
    parsed.cardLast4,
    parsed.bank,
    accountType,
  );

  if (existing) {
    // Reactivate if previously deactivated
    if (!existing.is_active) {
      await db.runAsync(
        "UPDATE financial_accounts SET is_active = 1, updated_at = datetime('now') WHERE id = ?;",
        existing.id,
      );
    }
    // Update with any new info from this SMS
    await updateAccountFromSMS(existing.id, parsed, pendingSmsId);
    return existing.id;
  }

  // Create new account
  const id = generateUUID();
  await db.runAsync(
    `INSERT INTO financial_accounts (id, user_id, account_identifier, bank_name, account_type)
     VALUES (?, ?, ?, ?, ?);`,
    id,
    userId,
    parsed.cardLast4,
    parsed.bank,
    accountType,
  );

  // Update with any balance/limit info from this SMS
  await updateAccountFromSMS(id, parsed, pendingSmsId);

  await bumpDataVersion();
  return id;
}

/**
 * Manually create a financial account (not from SMS).
 * Sets discovered_from_sms = 0 to distinguish from auto-discovered accounts.
 *
 * If a deactivated account with the same identifier already exists (e.g. user
 * deleted it then re-adds), it is reactivated and updated rather than creating
 * a duplicate that would violate the unique index.
 */
export async function createManualAccount(params: {
  userId: string;
  bankName: string;
  accountType: AccountType;
  accountIdentifier: string;
  accountLabel?: string;
  initialBalance?: number;
  fundBalance?: number;
  accountNumber?: string;
}): Promise<string> {
  if (!isValidAccountType(params.accountType)) {
    throw new Error(`Invalid account type: ${params.accountType}`);
  }

  const db = getDatabase();

  const existing = await db.getFirstAsync<{ id: string; is_active: number }>(
    `SELECT id, is_active FROM financial_accounts
     WHERE user_id = ? AND account_identifier = ? AND bank_name = ? AND account_type = ?;`,
    params.userId,
    params.accountIdentifier,
    params.bankName,
    params.accountType,
  );

  if (existing) {
    if (existing.is_active) {
      throw new Error(
        `You already have an active ${params.bankName} account with this number. Check your existing accounts.`,
      );
    }
    // Reactivate the deactivated account and update its fields
    const today = new Date().toISOString().split("T")[0];
    await db.runAsync(
      `UPDATE financial_accounts
       SET is_active = 1, account_label = ?, last_known_balance = ?, last_balance_date = ?,
           fund_balance = ?, account_number = ?, updated_at = datetime('now')
       WHERE id = ?;`,
      params.accountLabel ?? null,
      params.initialBalance ?? null,
      params.initialBalance != null ? today : null,
      params.fundBalance ?? 0,
      params.accountNumber ?? null,
      existing.id,
    );
    await bumpDataVersion();
    return existing.id;
  }

  const id = generateUUID();
  const today = new Date().toISOString().split("T")[0];
  await db.runAsync(
    `INSERT INTO financial_accounts
       (id, user_id, account_identifier, bank_name, account_type, account_label, discovered_from_sms, last_known_balance, last_balance_date, fund_balance, account_number)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?);`,
    id,
    params.userId,
    params.accountIdentifier,
    params.bankName,
    params.accountType,
    params.accountLabel ?? null,
    params.initialBalance ?? null,
    params.initialBalance != null ? today : null,
    params.fundBalance ?? 0,
    params.accountNumber ?? null,
  );
  await bumpDataVersion();
  return id;
}

/**
 * Update account fields from parsed SMS (balance, credit limit, etc.).
 *
 * Balance writes are guarded by date: the incoming SMS's date must be >= the
 * stored last_balance_date. Out-of-order (older) SMS don't overwrite fresher
 * balance readings.
 *
 * When pendingSmsId is provided, it's stored on the account so the UI can
 * surface "this balance came from this SMS" transparency.
 */
export async function updateAccountFromSMS(
  accountId: string,
  parsed: ParsedSMS,
  pendingSmsId?: string,
): Promise<void> {
  const db = getDatabase();
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  const incomingDate = parsed.date ?? new Date().toISOString().split("T")[0];
  const balanceValue = parsed.availableBalance ?? parsed.availableCreditLimit ?? null;

  // Guard: only overwrite balance if incoming is at least as recent as stored.
  let shouldUpdateBalance = balanceValue != null;
  if (shouldUpdateBalance) {
    const existing = await db.getFirstAsync<{ last_balance_date: string | null }>(
      "SELECT last_balance_date FROM financial_accounts WHERE id = ?;",
      accountId,
    );
    if (existing?.last_balance_date && incomingDate < existing.last_balance_date) {
      shouldUpdateBalance = false; // out-of-order — skip
    }
  }

  if (shouldUpdateBalance && balanceValue != null) {
    updates.push("last_known_balance = ?");
    values.push(balanceValue);
    updates.push("last_balance_date = ?");
    values.push(incomingDate);
    if (pendingSmsId !== undefined) {
      updates.push("last_balance_sms_id = ?");
      values.push(pendingSmsId);
    }
  }

  if (parsed.creditLimit != null) {
    updates.push("credit_limit = ?");
    values.push(parsed.creditLimit);
  }

  if (updates.length === 0) return;

  updates.push("updated_at = datetime('now')");
  values.push(accountId);

  await db.runAsync(
    `UPDATE financial_accounts SET ${updates.join(", ")} WHERE id = ?;`,
    ...values,
  );
  await bumpDataVersion();
}

/**
 * Link an expense to a financial account.
 *
 * Matching rule (v15.11.3 loosened):
 *   1. If the SMS carried a last-4 digit code (`cardLast4`), match on
 *      `account_identifier`. Exact, unchanged.
 *   2. If the SMS carried a text nickname (`accountNickname`), match on
 *      EITHER `account_label` OR `bank_name` (case-insensitive). Either
 *      field can hold the "name" the user knows this account by — no
 *      longer requires both the template's bank_name to exactly match the
 *      wallet's bank_name, which was the v15.10.0–v15.11.2 bug that left
 *      wallets unlinked when the user typed different names in each place.
 *
 * Tiebreak across multiple candidates:
 *   - same-bank-name match preferred (when we have that signal)
 *   - wallet type preferred over bank/CC
 *   - account_label match preferred over bank_name match
 *   - active accounts preferred over deactivated
 *   - oldest account wins
 *
 * Returns the account ID if found and linked, null otherwise.
 * Never auto-creates a wallet account from a nickname match.
 */
export async function linkExpenseToAccount(
  userId: string,
  expenseId: string,
  cardLast4: string | null,
  bank: string,
  accountNickname?: string | null,
): Promise<string | null> {
  const db = getDatabase();
  let account: { id: string } | null = null;

  // Path 1: digit match (cardLast4). Also loosened in v15.11.3 — bank_name
  // is no longer a strict filter. Prevents SMS auto-detection from failing
  // when the user renamed their bank (e.g. "HDFC Bank" → "HDFC").
  if (cardLast4) {
    account = (await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM financial_accounts
        WHERE user_id = ?
          AND is_active = 1
          AND account_identifier = ?
        ORDER BY
          CASE WHEN LOWER(TRIM(bank_name)) = LOWER(?) THEN 0 ELSE 1 END,
          created_at ASC
        LIMIT 1;`,
      userId,
      cardLast4,
      bank,
    )) ?? null;
  }

  // Path 2: nickname match. Matches against EITHER account_label OR
  // bank_name so users don't have to keep both fields in sync.
  if (!account && accountNickname && accountNickname.trim().length > 0) {
    const nickname = accountNickname.trim();
    account = (await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM financial_accounts
        WHERE user_id = ?
          AND is_active = 1
          AND (
            (account_label IS NOT NULL AND LOWER(TRIM(account_label)) = LOWER(?))
            OR
            LOWER(TRIM(bank_name)) = LOWER(?)
          )
        ORDER BY
          CASE WHEN LOWER(TRIM(bank_name)) = LOWER(?) THEN 0 ELSE 1 END,
          CASE WHEN account_type = 'wallet' THEN 0 ELSE 1 END,
          CASE WHEN account_label IS NOT NULL AND LOWER(TRIM(account_label)) = LOWER(?) THEN 0 ELSE 1 END,
          created_at ASC
        LIMIT 1;`,
      userId,
      nickname,
      nickname,
      bank,
      nickname,
    )) ?? null;
  }

  if (!account) return null;

  await db.runAsync(
    `UPDATE expenses SET account_id = ? WHERE id = ?;`,
    account.id,
    expenseId,
  );

  await bumpDataVersion();
  return account.id;
}

/**
 * Get all active financial accounts for a user.
 */
export async function getAccountById(accountId: string): Promise<FinancialAccount | null> {
  const db = getDatabase();
  return db.getFirstAsync<FinancialAccount>(
    `SELECT * FROM financial_accounts WHERE id = ?;`,
    accountId,
  );
}

export async function getActiveAccounts(userId: string): Promise<FinancialAccount[]> {
  const db = getDatabase();
  return db.getAllAsync<FinancialAccount>(
    `SELECT * FROM financial_accounts WHERE user_id = ? AND is_active = 1 ORDER BY bank_name, account_type;`,
    userId,
  );
}

/**
 * Update financial fields on an account (manual edit from Account Master).
 * Supports credit_limit for CC and last_known_balance for savings/all types.
 * When credit_limit changes on a credit card, it syncs to all sibling cards
 * from the same bank (shared credit limit pool).
 */
export async function updateAccountFinancials(
  accountId: string,
  fields: {
    credit_limit?: number | null;
    last_known_balance?: number | null;
    /** v15.5: savings min-balance alert threshold. 0 = feature off. */
    min_balance?: number;
  },
): Promise<void> {
  const db = getDatabase();
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (fields.credit_limit !== undefined) {
    updates.push("credit_limit = ?");
    values.push(fields.credit_limit);
  }
  if (fields.last_known_balance !== undefined) {
    updates.push("last_known_balance = ?");
    values.push(fields.last_known_balance);
    updates.push("last_balance_date = ?");
    values.push(new Date().toISOString().split("T")[0]);
  }
  if (fields.min_balance !== undefined) {
    updates.push("min_balance = ?");
    values.push(Math.max(0, fields.min_balance));
  }

  if (updates.length === 0) return;

  updates.push("updated_at = datetime('now')");
  values.push(accountId);

  await db.runAsync(
    `UPDATE financial_accounts SET ${updates.join(", ")} WHERE id = ?;`,
    ...values,
  );

  // Sync credit_limit to sibling CC cards from the same bank (shared pool)
  if (fields.credit_limit !== undefined) {
    const acct = await db.getFirstAsync<{ bank_name: string; user_id: string; account_type: string }>(
      "SELECT bank_name, user_id, account_type FROM financial_accounts WHERE id = ?;",
      accountId,
    );
    if (acct && acct.account_type === "credit_card") {
      await db.runAsync(
        `UPDATE financial_accounts
         SET credit_limit = ?, updated_at = datetime('now')
         WHERE user_id = ? AND bank_name = ? AND account_type = 'credit_card'
           AND id != ? AND is_active = 1;`,
        fields.credit_limit,
        acct.user_id,
        acct.bank_name,
        accountId,
      );
    }
  }

  await bumpDataVersion();
}

/**
 * Get total expenses per CC account for the current month.
 * Used for reconciliation: credit_limit - available should ≈ this total.
 */
export async function getCcExpenseTotals(
  userId: string,
  monthStart: string,
  monthEnd: string,
): Promise<Record<string, number>> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ account_id: string; total: number }>(
    `SELECT account_id, SUM(COALESCE(split_original_amount, amount)) as total FROM expenses
     WHERE user_id = ? AND account_id IS NOT NULL AND deleted_at IS NULL
       AND nature = 'realized' AND status = 'approved'
       AND date >= ? AND date <= ?
     GROUP BY account_id;`,
    userId,
    monthStart,
    monthEnd,
  );
  const map: Record<string, number> = {};
  for (const row of rows) {
    map[row.account_id] = row.total;
  }
  return map;
}

/**
 * Latest "staleness-relevant" activity date per account for a month range.
 * Used by the credit-cards and bank-accounts screens to flag the auto-detected
 * balance as stale when an SMS-parsed purchase or any credit happened after
 * the last balance SMS.
 *
 * Hybrid rule (matches getBalanceSourceInfo):
 *  - SMS-parsed realized expenses (source='sms_auto') — main bug case
 *  - Any credit (sms_auto or manual) — catches credits without balance
 * Includes both 'approved' and 'pending_review': a freshly parsed SMS sitting
 * in the review queue is still evidence that the balance is out of date.
 * Excludes manual realized expenses (user knowledge, not a missing SMS).
 */
export async function getAccountLatestStaleCheckDates(
  userId: string,
  monthStart: string,
  monthEnd: string,
): Promise<Record<string, string>> {
  const db = getDatabase();
  const map: Record<string, string> = {};

  // Signal 1: latest SMS-parsed debit or any credit dated in the range.
  const expenseRows = await db.getAllAsync<{ account_id: string; latest: string }>(
    `SELECT account_id, MAX(date) as latest FROM expenses
     WHERE user_id = ? AND account_id IS NOT NULL AND deleted_at IS NULL
       AND status IN ('approved', 'pending_review')
       AND date >= ? AND date <= ?
       AND (
         (source = 'sms_auto' AND nature = 'realized')
         OR nature = 'credit'
       )
     GROUP BY account_id;`,
    userId,
    monthStart,
    monthEnd,
  );
  for (const row of expenseRows) {
    if (row.latest) map[row.account_id] = row.latest;
  }

  // Signal 2: latest transfer in or out of the account. Some CC payment-
  // received SMS flows (e.g. "Payment of INR X received towards your CC")
  // reclassify the savings debit as a transfer instead of creating a
  // credit row — so without this, the CC's auto-detected balance stays
  // "fresh" even though a payment posted after the last balance SMS.
  const transferRows = await db.getAllAsync<{ account_id: string; latest: string }>(
    `SELECT account_id, MAX(date) as latest FROM (
       SELECT to_account_id AS account_id, date FROM account_transfers
        WHERE to_account_id IS NOT NULL AND deleted_at IS NULL
          AND date >= ? AND date <= ?
       UNION ALL
       SELECT from_account_id AS account_id, date FROM account_transfers
        WHERE from_account_id IS NOT NULL AND deleted_at IS NULL
          AND date >= ? AND date <= ?
     )
     GROUP BY account_id;`,
    monthStart,
    monthEnd,
    monthStart,
    monthEnd,
  );
  for (const row of transferRows) {
    if (!row.latest) continue;
    const prev = map[row.account_id];
    if (!prev || row.latest > prev) map[row.account_id] = row.latest;
  }

  return map;
}

/**
 * Get a summary of all accounts: total balance, total credit available, total dues.
 */
export async function getAccountSummary(userId: string): Promise<{
  totalBalance: number;
  totalCreditAvailable: number;
  totalDues: number;
  accountCount: number;
}> {
  const db = getDatabase();

  const savingsSum = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(last_known_balance) as total FROM financial_accounts
     WHERE user_id = ? AND is_active = 1 AND account_type = 'savings';`,
    userId,
  );

  const creditSum = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(last_known_balance) as total FROM financial_accounts
     WHERE user_id = ? AND is_active = 1 AND account_type = 'credit_card';`,
    userId,
  );

  const duesSum = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(total_due) as total FROM financial_accounts
     WHERE user_id = ? AND is_active = 1 AND total_due > 0;`,
    userId,
  );

  const countRow = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM financial_accounts WHERE user_id = ? AND is_active = 1;`,
    userId,
  );

  return {
    totalBalance: savingsSum?.total ?? 0,
    totalCreditAvailable: creditSum?.total ?? 0,
    totalDues: duesSum?.total ?? 0,
    accountCount: countRow?.count ?? 0,
  };
}

/**
 * Get expenses linked to a specific account.
 */
export async function getAccountExpenses(
  accountId: string,
  limit = 50,
): Promise<Array<{ id: string; amount: number; description: string | null; date: string }>> {
  const db = getDatabase();
  return db.getAllAsync(
    `SELECT id, amount, description, date FROM expenses
     WHERE account_id = ? AND status != 'rejected' AND deleted_at IS NULL
     ORDER BY date DESC LIMIT ?;`,
    accountId,
    limit,
  );
}

/**
 * Update the account type (savings, credit_card, loan, wallet).
 * Clears type-specific fields that don't apply to the new type.
 */
export async function updateAccountType(
  accountId: string,
  newType: AccountType,
): Promise<void> {
  if (!isValidAccountType(newType)) {
    throw new Error(`Invalid account type: ${newType}`);
  }
  
  const db = getDatabase();

  // Clear fields that don't apply to the new type
  const clearFields: string[] = [];
  if (newType !== "credit_card") {
    clearFields.push("credit_limit = NULL", "total_due = NULL", "min_due = NULL", "due_date = NULL");
  }
  if (newType !== "demat") {
    clearFields.push("fund_balance = 0", "account_number = NULL");
  }

  const sets = [`account_type = ?`, ...clearFields, `updated_at = datetime('now')`];
  await db.runAsync(
    `UPDATE financial_accounts SET ${sets.join(", ")} WHERE id = ?;`,
    newType,
    accountId,
  );
  await bumpDataVersion();
}

/**
 * Deactivate (hide) a financial account.
 */
export async function deactivateAccount(accountId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE financial_accounts SET is_active = 0, updated_at = datetime('now') WHERE id = ?;`,
    accountId,
  );
  await bumpDataVersion();
}

/**
 * Get all accounts (both active and inactive) for transfer display fallback.
 */
export async function getAllAccounts(userId: string): Promise<FinancialAccount[]> {
  const db = getDatabase();
  return db.getAllAsync<FinancialAccount>(
    "SELECT * FROM financial_accounts WHERE user_id = ? ORDER BY bank_name, account_type;",
    userId,
  );
}

/**
 * Get all inactive (soft-deleted) accounts for the recycle bin.
 */
export async function getInactiveAccounts(userId: string): Promise<FinancialAccount[]> {
  const db = getDatabase();
  return db.getAllAsync<FinancialAccount>(
    "SELECT * FROM financial_accounts WHERE user_id = ? AND is_active = 0 ORDER BY bank_name ASC;",
    userId,
  );
}

/**
 * Restore a deactivated financial account.
 */
export async function restoreAccount(accountId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "UPDATE financial_accounts SET is_active = 1, updated_at = datetime('now') WHERE id = ?;",
    accountId,
  );
  await bumpDataVersion();
}

/**
 * Restore all deactivated accounts for a user.
 */
export async function restoreAllAccounts(userId: string): Promise<number> {
  const db = getDatabase();
  const result = await db.runAsync(
    "UPDATE financial_accounts SET is_active = 1, updated_at = datetime('now') WHERE user_id = ? AND is_active = 0;",
    userId,
  );
  if (result.changes > 0) await bumpDataVersion();
  return result.changes;
}

/**
 * Permanently delete an inactive financial account and all its related data.
 * Only works on deactivated accounts (is_active = 0).
 */
export async function hardDeleteAccount(accountId: string): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    // Delete related data
    await db.runAsync("DELETE FROM account_credits WHERE account_id = ?;", accountId);
    await db.runAsync("DELETE FROM account_month_balances WHERE account_id = ?;", accountId);
    await db.runAsync("DELETE FROM account_payment_modes WHERE account_id = ?;", accountId);
    await db.runAsync("DELETE FROM demat_portfolio_snapshots WHERE account_id = ?;", accountId);
    // Unlink expenses (don't delete them)
    await db.runAsync("UPDATE expenses SET account_id = NULL WHERE account_id = ?;", accountId);
    // Unlink recurring transactions
    await db.runAsync("UPDATE recurring_transactions SET account_id = NULL WHERE account_id = ?;", accountId);
    // Delete the account
    await db.runAsync("DELETE FROM financial_accounts WHERE id = ? AND is_active = 0;", accountId);
  });
  bumpDataVersion();
}

/**
 * Permanently delete all inactive accounts for a user.
 */
export async function purgeAllInactiveAccounts(userId: string): Promise<number> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM financial_accounts WHERE user_id = ? AND is_active = 0;",
    userId,
  );
  for (const row of rows) {
    await hardDeleteAccount(row.id);
  }
  return rows.length;
}

/**
 * Set a user-friendly nickname for an account.
 */
export async function renameAccount(accountId: string, label: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE financial_accounts SET account_label = ?, updated_at = datetime('now') WHERE id = ?;`,
    label,
    accountId,
  );
  await bumpDataVersion();
}

/**
 * Update account dues from a due/reminder SMS.
 */
export async function updateAccountDues(
  accountId: string,
  totalDue: number | null,
  minDue: number | null,
  dueDate: string | null,
): Promise<void> {
  const db = getDatabase();
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (totalDue != null) {
    updates.push("total_due = ?");
    values.push(totalDue);
  }
  if (minDue != null) {
    updates.push("min_due = ?");
    values.push(minDue);
  }
  if (dueDate != null) {
    updates.push("due_date = ?");
    values.push(dueDate);
  }

  if (updates.length === 0) return;

  updates.push("updated_at = datetime('now')");
  values.push(accountId);

  await db.runAsync(
    `UPDATE financial_accounts SET ${updates.join(", ")} WHERE id = ?;`,
    ...values,
  );
  await bumpDataVersion();
}

/**
 * Handle a credit card payment received SMS.
 * Reduces outstanding dues. Available limit is NOT written directly — the
 * ledger (expenses with nature='credit') is the source of truth for available
 * limit computation. Callers that need the payment reflected in the ledger
 * must also write a nature='credit' row (see sms/sms-to-expense.ts).
 */
export async function handlePaymentReceived(
  accountId: string,
  parsed: ParsedSMS,
): Promise<void> {
  if (!parsed.amount) return;
  const db = getDatabase();
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  // Reduce total_due by payment amount
  const account = await db.getFirstAsync<{ total_due: number | null }>(
    "SELECT total_due FROM financial_accounts WHERE id = ?;",
    accountId,
  );
  if (account?.total_due != null) {
    const newDue = Math.max(0, account.total_due - parsed.amount);
    updates.push("total_due = ?");
    values.push(newDue);
    // If fully paid, clear min_due and due_date
    if (newDue === 0) {
      updates.push("min_due = ?");
      values.push(null);
      updates.push("due_date = ?");
      values.push(null);
    }
  }

  if (updates.length === 0) return;

  updates.push("updated_at = datetime('now')");
  values.push(accountId);

  await db.runAsync(
    `UPDATE financial_accounts SET ${updates.join(", ")} WHERE id = ?;`,
    ...values,
  );
  await bumpDataVersion();
}

/**
 * Handle a credit SMS (money received into savings, UPI credit, etc.).
 * Stores the credit in the account_credits table so the monthly ledger
 * includes it in the balance calculation (opening - expenses + credits = closing).
 * Also updates account balance info via discoverOrUpdateAccount (already called by caller).
 */
export async function handleCreditReceived(
  accountId: string,
  userId: string,
  parsed: ParsedSMS,
): Promise<void> {
  if (!parsed.amount) return;

  // Build description from parsed SMS data
  const parts: string[] = [];
  if (parsed.merchant) parts.push(parsed.merchant);
  if (parsed.bank && parsed.cardLast4) {
    parts.push(`via ${parsed.bank} ****${parsed.cardLast4}`);
  } else if (parsed.bank) {
    parts.push(`via ${parsed.bank}`);
  }
  if (parsed.type === "upi_credit") parts.push("(UPI Credit)");
  else parts.push("(Credit)");
  const description = parts.join(" ") || "SMS credit";

  const date = parsed.date ?? new Date().toISOString().split("T")[0];

  await addCredit({
    accountId,
    userId,
    amount: parsed.amount,
    description,
    date,
    source: "sms_auto",
  });
}

/**
 * Apply a CC bill payment: decrease total_due.
 * Available limit is NOT written directly — it's derived from the ledger
 * (opening + credits − expenses). Callers that want the payment to appear
 * in the CC ledger must either create a transfer (from a savings account)
 * or a nature='credit' expense row. See markRepaymentPaid /
 * markForecastPaidExternally in expense-forecasts.ts for the two call sites.
 *
 * Only applies to credit_card accounts — no-op for other types.
 */
export async function applyCcPayment(
  accountId: string,
  paymentAmount: number,
): Promise<void> {
  const db = getDatabase();
  const account = await db.getFirstAsync<{
    account_type: string;
    total_due: number | null;
  }>(
    "SELECT account_type, total_due FROM financial_accounts WHERE id = ?;",
    accountId,
  );
  if (!account || account.account_type !== "credit_card") return;

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (account.total_due != null) {
    const newDue = Math.max(0, account.total_due - paymentAmount);
    updates.push("total_due = ?");
    values.push(newDue);
    if (newDue === 0) {
      updates.push("min_due = NULL");
      updates.push("due_date = NULL");
    }
  }

  if (updates.length === 0) return;

  updates.push("updated_at = datetime('now')");
  values.push(accountId);

  await db.runAsync(
    `UPDATE financial_accounts SET ${updates.join(", ")} WHERE id = ?;`,
    ...values,
  );
  await bumpDataVersion();
}

/**
 * Clear dues (total_due, min_due, due_date) on a credit card account.
 * Used when the user dismisses a stale/incorrect overdue indicator.
 */
export async function clearCcDues(accountId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE financial_accounts SET total_due = NULL, min_due = NULL, due_date = NULL, updated_at = datetime('now') WHERE id = ?;`,
    accountId,
  );
  await bumpDataVersion();
}

/**
 * Update NACH mandate info on an account.
 */
export async function updateNachInfo(
  accountId: string,
  merchant: string,
  amount: number,
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE financial_accounts
     SET has_nach_mandate = 1, nach_merchant = ?, nach_amount = ?, updated_at = datetime('now')
     WHERE id = ?;`,
    merchant,
    amount,
    accountId,
  );
  await bumpDataVersion();
}

/**
 * Get all accounts with upcoming dues, sorted by due date ascending.
 */
export async function getUpcomingDues(
  userId: string,
): Promise<FinancialAccount[]> {
  const db = getDatabase();
  return db.getAllAsync<FinancialAccount>(
    `SELECT * FROM financial_accounts
     WHERE user_id = ? AND is_active = 1 AND total_due > 0 AND due_date IS NOT NULL
     ORDER BY due_date ASC;`,
    userId,
  );
}

// ---------------------------------------------------------------------------
// Demat — Portfolio Snapshots
// ---------------------------------------------------------------------------

/**
 * Update fund balance (idle cash) on a demat account.
 *
 * v14.5.0: now creates/updates a fund snapshot for today rather than writing
 * the legacy `financial_accounts.fund_balance` scalar. Snapshots are the
 * single source of truth; the scalar is read-never and write-never now.
 */
export async function updateFundBalance(
  accountId: string,
  amount: number,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await addOrUpdateFundSnapshot(accountId, today, amount);
}

/**
 * Add or update a portfolio snapshot for a demat account.
 * Uses UNIQUE(account_id, snapshot_date) — updates if same date exists.
 */
export async function addOrUpdateSnapshot(
  accountId: string,
  date: string,
  value: number,
): Promise<void> {
  const db = getDatabase();
  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM demat_portfolio_snapshots
     WHERE account_id = ? AND snapshot_date = ?;`,
    accountId,
    date,
  );

  if (existing) {
    await db.runAsync(
      `UPDATE demat_portfolio_snapshots
       SET portfolio_value = ?, updated_at = datetime('now')
       WHERE id = ?;`,
      value,
      existing.id,
    );
  } else {
    const id = generateUUID();
    await db.runAsync(
      `INSERT INTO demat_portfolio_snapshots (id, account_id, snapshot_date, portfolio_value)
       VALUES (?, ?, ?, ?);`,
      id,
      accountId,
      date,
      value,
    );
  }
  await bumpDataVersion();
}

/**
 * Delete a portfolio snapshot by ID.
 */
export async function deleteSnapshot(snapshotId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `DELETE FROM demat_portfolio_snapshots WHERE id = ?;`,
    snapshotId,
  );
  await bumpDataVersion();
}

/**
 * Get all snapshots for a demat account, most recent first.
 */
export async function getSnapshots(
  accountId: string,
  limit = 100,
): Promise<PortfolioSnapshot[]> {
  const db = getDatabase();
  return db.getAllAsync<PortfolioSnapshot>(
    `SELECT * FROM demat_portfolio_snapshots
     WHERE account_id = ?
     ORDER BY snapshot_date DESC
     LIMIT ?;`,
    accountId,
    limit,
  );
}

/**
 * Get the most recent snapshot for a demat account.
 */
export async function getLatestSnapshot(
  accountId: string,
): Promise<PortfolioSnapshot | null> {
  const db = getDatabase();
  return db.getFirstAsync<PortfolioSnapshot>(
    `SELECT * FROM demat_portfolio_snapshots
     WHERE account_id = ?
     ORDER BY snapshot_date DESC
     LIMIT 1;`,
    accountId,
  );
}

/**
 * Monthly portfolio trend for a single demat account.
 * For each of the last N months, picks the latest snapshot in that month.
 */
export async function getMonthlyPortfolioTrend(
  accountId: string,
  monthCount = 6,
): Promise<MonthlyTotal[]> {
  const db = getDatabase();
  const months = getLastNMonths(monthCount);

  const rows = await db.getAllAsync<{ month: string; value: number }>(
    `SELECT substr(snapshot_date, 1, 7) AS month,
            portfolio_value AS value
     FROM demat_portfolio_snapshots
     WHERE account_id = ?
       AND snapshot_date = (
         SELECT MAX(s2.snapshot_date)
         FROM demat_portfolio_snapshots s2
         WHERE s2.account_id = demat_portfolio_snapshots.account_id
           AND substr(s2.snapshot_date, 1, 7) = substr(demat_portfolio_snapshots.snapshot_date, 1, 7)
       )
     ORDER BY snapshot_date ASC;`,
    accountId,
  );

  const monthMap = new Map(rows.map((r) => [r.month, r.value]));
  return months.map((m) => ({ month: m, total: monthMap.get(m) ?? 0 }));
}

/**
 * Aggregate monthly portfolio trend across ALL active demat accounts.
 * For each month, sums the latest snapshot value from each account.
 */
export async function getAggregatePortfolioTrend(
  userId: string,
  monthCount = 6,
): Promise<MonthlyTotal[]> {
  const db = getDatabase();
  const months = getLastNMonths(monthCount);

  const rows = await db.getAllAsync<{ month: string; total: number }>(
    `SELECT substr(s.snapshot_date, 1, 7) AS month,
            SUM(s.portfolio_value) AS total
     FROM demat_portfolio_snapshots s
     INNER JOIN financial_accounts fa ON fa.id = s.account_id
     WHERE fa.user_id = ? AND fa.is_active = 1 AND fa.account_type = 'demat'
       AND s.snapshot_date = (
         SELECT MAX(s2.snapshot_date)
         FROM demat_portfolio_snapshots s2
         WHERE s2.account_id = s.account_id
           AND substr(s2.snapshot_date, 1, 7) = substr(s.snapshot_date, 1, 7)
       )
     GROUP BY substr(s.snapshot_date, 1, 7)
     ORDER BY month ASC;`,
    userId,
  );

  const monthMap = new Map(rows.map((r) => [r.month, r.total]));
  return months.map((m) => ({ month: m, total: monthMap.get(m) ?? 0 }));
}

// ---------------------------------------------------------------------------
// Demat — Fund Snapshots (history of idle cash, mirrors portfolio snapshots)
// ---------------------------------------------------------------------------

export interface FundSnapshot {
  id: string;
  account_id: string;
  snapshot_date: string;
  fund_value: number;
  created_at: string;
  updated_at: string;
}

/**
 * Add or update a fund snapshot. UNIQUE(account_id, snapshot_date) upserts.
 *
 * `demat_fund_snapshots` is the single source of truth for fund balance as
 * of v14.5.0 — the legacy `financial_accounts.fund_balance` scalar column is
 * no longer written (and all readers have been migrated to read from
 * snapshots via {@link getCurrentFundBalance} or {@link getFundAsOf}).
 */
export async function addOrUpdateFundSnapshot(
  accountId: string,
  date: string,
  value: number,
): Promise<void> {
  const db = getDatabase();
  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM demat_fund_snapshots
     WHERE account_id = ? AND snapshot_date = ?;`,
    accountId,
    date,
  );
  if (existing) {
    await db.runAsync(
      `UPDATE demat_fund_snapshots
       SET fund_value = ?, updated_at = datetime('now')
       WHERE id = ?;`,
      value,
      existing.id,
    );
  } else {
    await db.runAsync(
      `INSERT INTO demat_fund_snapshots (id, account_id, snapshot_date, fund_value)
       VALUES (?, ?, ?, ?);`,
      generateUUID(),
      accountId,
      date,
      value,
    );
  }
  await bumpDataVersion();
}

export async function deleteFundSnapshot(snapshotId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(`DELETE FROM demat_fund_snapshots WHERE id = ?;`, snapshotId);
  await bumpDataVersion();
}

export async function getLatestFundSnapshot(accountId: string): Promise<FundSnapshot | null> {
  const db = getDatabase();
  return db.getFirstAsync<FundSnapshot>(
    `SELECT * FROM demat_fund_snapshots
     WHERE account_id = ?
     ORDER BY snapshot_date DESC
     LIMIT 1;`,
    accountId,
  );
}

export async function getPortfolioSnapshotsForMonth(
  accountId: string,
  yearMonth: string,
): Promise<PortfolioSnapshot[]> {
  const db = getDatabase();
  const [y, m] = yearMonth.split("-").map(Number);
  const monthStart = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
  return db.getAllAsync<PortfolioSnapshot>(
    `SELECT * FROM demat_portfolio_snapshots
     WHERE account_id = ? AND snapshot_date >= ? AND snapshot_date <= ?
     ORDER BY snapshot_date DESC;`,
    accountId, monthStart, monthEnd,
  );
}

export async function getFundSnapshotsForMonth(
  accountId: string,
  yearMonth: string,
): Promise<FundSnapshot[]> {
  const db = getDatabase();
  const [y, m] = yearMonth.split("-").map(Number);
  const monthStart = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
  return db.getAllAsync<FundSnapshot>(
    `SELECT * FROM demat_fund_snapshots
     WHERE account_id = ? AND snapshot_date >= ? AND snapshot_date <= ?
     ORDER BY snapshot_date DESC;`,
    accountId, monthStart, monthEnd,
  );
}

export async function getSnapshotCountForAccount(accountId: string): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM demat_portfolio_snapshots WHERE account_id = ?;`,
    accountId,
  );
  return row?.count ?? 0;
}

export async function getFundSnapshots(
  accountId: string,
  limit = 100,
): Promise<FundSnapshot[]> {
  const db = getDatabase();
  return db.getAllAsync<FundSnapshot>(
    `SELECT * FROM demat_fund_snapshots
     WHERE account_id = ?
     ORDER BY snapshot_date DESC
     LIMIT ?;`,
    accountId,
    limit,
  );
}

/**
 * Resolve the fund value "as of" a given date: latest snapshot on-or-before
 * that date. Falls back to financial_accounts.fund_balance when no snapshot
 * history exists.
 */
export async function getFundAsOf(
  accountId: string,
  date: string,
): Promise<number> {
  const db = getDatabase();
  const snap = await db.getFirstAsync<{ fund_value: number }>(
    `SELECT fund_value FROM demat_fund_snapshots
     WHERE account_id = ? AND snapshot_date <= ?
     ORDER BY snapshot_date DESC LIMIT 1;`,
    accountId,
    date,
  );
  if (snap) return snap.fund_value;
  const acct = await db.getFirstAsync<{ fund_balance: number }>(
    `SELECT fund_balance FROM financial_accounts WHERE id = ?;`,
    accountId,
  );
  return acct?.fund_balance ?? 0;
}

/**
 * Current idle-cash (fund) balance for a demat account.
 *
 * Source of truth is `demat_fund_snapshots` — returns the value on the most
 * recent snapshot date, regardless of how far in the past that is. Returns 0
 * for accounts that have never had a snapshot.
 *
 * Prefer this over reading `financial_accounts.fund_balance` directly; the
 * scalar column is a legacy mirror being phased out (migration 012 backfilled
 * a snapshot for any account that had a non-zero scalar but no snapshot).
 */
export async function getCurrentFundBalance(accountId: string): Promise<number> {
  const db = getDatabase();
  const snap = await db.getFirstAsync<{ fund_value: number }>(
    `SELECT fund_value FROM demat_fund_snapshots
     WHERE account_id = ?
     ORDER BY snapshot_date DESC LIMIT 1;`,
    accountId,
  );
  return snap?.fund_value ?? 0;
}

/**
 * Batched version of {@link getCurrentFundBalance} — one query for N accounts.
 * Returns a Map keyed by account_id; accounts with no snapshot history are
 * absent from the map (caller should default to 0).
 */
export async function getCurrentFundBalances(
  accountIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (accountIds.length === 0) return result;
  const db = getDatabase();
  const placeholders = accountIds.map(() => "?").join(",");
  const rows = await db.getAllAsync<{ account_id: string; fund_value: number }>(
    `SELECT s.account_id, s.fund_value
     FROM demat_fund_snapshots s
     WHERE s.account_id IN (${placeholders})
       AND s.snapshot_date = (
         SELECT MAX(snapshot_date) FROM demat_fund_snapshots
         WHERE account_id = s.account_id
       );`,
    ...accountIds,
  );
  for (const r of rows) result.set(r.account_id, r.fund_value);
  return result;
}

// ---------------------------------------------------------------------------
// Demat — Weekly Net Worth Trend (portfolio + fund combined per week)
// ---------------------------------------------------------------------------

export interface WeeklyTotal {
  weekStart: string; // "YYYY-MM-DD", the Sunday that starts the week
  total: number;
}

/** Get the Sunday that starts the ISO-like week containing this date. */
function getSundayStart(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - out.getDay()); // getDay(): Sunday = 0
  return out;
}

function formatYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Last N week-start dates (Sundays), oldest first. */
function getLastNWeeks(count: number, offsetWeeks = 0): string[] {
  const weeks: string[] = [];
  const today = new Date();
  const thisSunday = getSundayStart(today);
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(thisSunday);
    d.setDate(d.getDate() - (i + offsetWeeks) * 7);
    weeks.push(formatYMD(d));
  }
  return weeks;
}

/**
 * Weekly net-worth trend (portfolio + fund) for a single demat account.
 * For each of the last N weeks, takes the latest snapshot value on-or-before
 * the end of that week (Saturday). Missing weeks carry the prior value forward
 * so the line is continuous instead of dropping to 0.
 */
export async function getWeeklyNetWorthTrend(
  accountId: string,
  weekCount = 12,
  offsetWeeks = 0,
): Promise<WeeklyTotal[]> {
  const weeks = getLastNWeeks(weekCount, offsetWeeks);
  const db = getDatabase();

  // Perf (v14.8.0): fire all 2×weekCount queries in parallel rather than
  // a for-await loop — 12 weeks goes from 24 serial round-trips to 2
  // parallel batches. For a user with 4 demat accounts × 12 weeks the old
  // aggregate path issued 96 serial queries; now it's 2 batches × 4 accounts.
  const weekEnds = weeks.map((weekStart) => {
    const sunday = new Date(weekStart);
    const saturday = new Date(sunday);
    saturday.setDate(saturday.getDate() + 6);
    return formatYMD(saturday);
  });

  const [portRows, fundRows] = await Promise.all([
    Promise.all(
      weekEnds.map((weekEnd) =>
        db.getFirstAsync<{ v: number }>(
          `SELECT portfolio_value AS v FROM demat_portfolio_snapshots
           WHERE account_id = ? AND snapshot_date <= ?
           ORDER BY snapshot_date DESC LIMIT 1;`,
          accountId,
          weekEnd,
        ),
      ),
    ),
    Promise.all(
      weekEnds.map((weekEnd) =>
        db.getFirstAsync<{ v: number }>(
          `SELECT fund_value AS v FROM demat_fund_snapshots
           WHERE account_id = ? AND snapshot_date <= ?
           ORDER BY snapshot_date DESC LIMIT 1;`,
          accountId,
          weekEnd,
        ),
      ),
    ),
  ]);

  return weeks.map((weekStart, i) => ({
    weekStart,
    total: (portRows[i]?.v ?? 0) + (fundRows[i]?.v ?? 0),
  }));
}

/**
 * Aggregate weekly net-worth trend across every active demat account.
 * Each week sums the latest-on-or-before portfolio + fund for each account.
 */
export async function getAggregateWeeklyNetWorthTrend(
  userId: string,
  weekCount = 12,
  offsetWeeks = 0,
): Promise<WeeklyTotal[]> {
  const db = getDatabase();
  const accounts = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM financial_accounts
     WHERE user_id = ? AND is_active = 1 AND account_type = 'demat';`,
    userId,
  );
  if (accounts.length === 0) {
    return getLastNWeeks(weekCount, offsetWeeks).map((w) => ({ weekStart: w, total: 0 }));
  }

  const perAccount = await Promise.all(
    accounts.map((a) => getWeeklyNetWorthTrend(a.id, weekCount, offsetWeeks)),
  );

  const weeks = getLastNWeeks(weekCount);
  return weeks.map((weekStart, i) => ({
    weekStart,
    total: perAccount.reduce((sum, series) => sum + series[i].total, 0),
  }));
}

/**
 * All snapshots within a single month for a demat account (portfolio + fund).
 * Each snapshot date becomes a data point on the chart.
 */
export async function getSnapshotsForMonth(
  accountId: string,
  yearMonth: string,
): Promise<MonthlyTotal[]> {
  const db = getDatabase();
  const [y, m] = yearMonth.split("-").map(Number);
  const monthStart = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;

  const portRows = await db.getAllAsync<{ snapshot_date: string; portfolio_value: number }>(
    `SELECT snapshot_date, portfolio_value FROM demat_portfolio_snapshots
     WHERE account_id = ? AND snapshot_date >= ? AND snapshot_date <= ?
     ORDER BY snapshot_date ASC;`,
    accountId, monthStart, monthEnd,
  );

  const fundRows = await db.getAllAsync<{ snapshot_date: string; fund_value: number }>(
    `SELECT snapshot_date, fund_value FROM demat_fund_snapshots
     WHERE account_id = ? AND snapshot_date >= ? AND snapshot_date <= ?
     ORDER BY snapshot_date ASC;`,
    accountId, monthStart, monthEnd,
  );

  const fundMap = new Map(fundRows.map((r) => [r.snapshot_date, r.fund_value]));
  const allDates = new Set([...portRows.map((r) => r.snapshot_date), ...fundRows.map((r) => r.snapshot_date)]);
  const sortedDates = [...allDates].sort();

  const portMap = new Map(portRows.map((r) => [r.snapshot_date, r.portfolio_value]));

  let lastPort = 0;
  let lastFund = 0;
  return sortedDates.map((date) => {
    if (portMap.has(date)) lastPort = portMap.get(date)!;
    if (fundMap.has(date)) lastFund = fundMap.get(date)!;
    return { month: date, total: lastPort + lastFund };
  });
}

/**
 * Aggregate snapshots within a month across all active demat accounts.
 */
export async function getAggregateSnapshotsForMonth(
  userId: string,
  yearMonth: string,
): Promise<MonthlyTotal[]> {
  const db = getDatabase();
  const accounts = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM financial_accounts
     WHERE user_id = ? AND is_active = 1 AND account_type = 'demat';`,
    userId,
  );
  if (accounts.length === 0) return [];

  const perAccount = await Promise.all(
    accounts.map((a) => getSnapshotsForMonth(a.id, yearMonth)),
  );

  const allDates = new Set(perAccount.flatMap((s) => s.map((d) => d.month)));
  const sortedDates = [...allDates].sort();

  return sortedDates.map((date) => ({
    month: date,
    total: perAccount.reduce((sum, series) => {
      const point = series.find((d) => d.month === date);
      if (point) return sum + point.total;
      const lastBefore = [...series].reverse().find((d) => d.month <= date);
      return sum + (lastBefore?.total ?? 0);
    }, 0),
  }));
}

/**
 * Summary across all demat accounts for the home screen card.
 *
 * Fund total reads from the latest row per account in demat_fund_snapshots
 * (the single source of truth as of v14.5.0). Portfolio same pattern —
 * already the behavior, unchanged here.
 */
export async function getDematSummary(
  userId: string,
): Promise<{ totalPortfolio: number; totalFund: number; accountCount: number }> {
  const db = getDatabase();

  const accounts = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM financial_accounts
     WHERE user_id = ? AND is_active = 1 AND account_type = 'demat';`,
    userId,
  );

  if (accounts.length === 0) {
    return { totalPortfolio: 0, totalFund: 0, accountCount: 0 };
  }

  const ids = accounts.map((a) => a.id);
  const placeholdersFund = ids.map(() => "?").join(",");
  const fundRow = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(s.fund_value) AS total
     FROM demat_fund_snapshots s
     WHERE s.account_id IN (${placeholdersFund})
       AND s.snapshot_date = (
         SELECT MAX(snapshot_date) FROM demat_fund_snapshots
         WHERE account_id = s.account_id
       );`,
    ...ids,
  );
  const totalFund = fundRow?.total ?? 0;

  // Portfolio total — latest snapshot per account, in one query.
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(s.portfolio_value) AS total
     FROM demat_portfolio_snapshots s
     WHERE s.account_id IN (${placeholdersFund})
       AND s.snapshot_date = (
         SELECT MAX(snapshot_date) FROM demat_portfolio_snapshots
         WHERE account_id = s.account_id
       );`,
    ...ids,
  );

  return {
    totalPortfolio: row?.total ?? 0,
    totalFund,
    accountCount: accounts.length,
  };
}

/**
 * All active demat accounts with their latest snapshot info.
 * Used by Account Master and demat-portfolio breakdown page.
 */
export async function getDematAccountsWithSummary(
  userId: string,
): Promise<DematAccountSummary[]> {
  const db = getDatabase();

  const accounts = await db.getAllAsync<FinancialAccount>(
    `SELECT * FROM financial_accounts
     WHERE user_id = ? AND is_active = 1 AND account_type = 'demat'
     ORDER BY bank_name ASC;`,
    userId,
  );

  if (accounts.length === 0) return [];

  const placeholders = accounts.map(() => "?").join(",");
  const ids = accounts.map((a) => a.id);

  // Batched: latest portfolio snapshot + count + latest fund snapshot — 3 parallel queries.
  const [latestRows, countRows, fundMap] = await Promise.all([
    db.getAllAsync<{
      account_id: string;
      portfolio_value: number;
      snapshot_date: string;
    }>(
      `SELECT s.account_id, s.portfolio_value, s.snapshot_date
       FROM demat_portfolio_snapshots s
       WHERE s.account_id IN (${placeholders})
         AND s.snapshot_date = (
           SELECT MAX(snapshot_date) FROM demat_portfolio_snapshots
           WHERE account_id = s.account_id
         );`,
      ...ids,
    ),
    db.getAllAsync<{ account_id: string; cnt: number }>(
      `SELECT account_id, COUNT(*) AS cnt
       FROM demat_portfolio_snapshots
       WHERE account_id IN (${placeholders})
       GROUP BY account_id;`,
      ...ids,
    ),
    getCurrentFundBalances(ids),
  ]);

  const latestMap = new Map(latestRows.map((r) => [r.account_id, r]));
  const countMap = new Map(countRows.map((r) => [r.account_id, r.cnt]));

  return accounts.map((account) => {
    const latest = latestMap.get(account.id);
    return {
      account,
      latestPortfolioValue: latest?.portfolio_value ?? null,
      latestSnapshotDate: latest?.snapshot_date ?? null,
      snapshotCount: countMap.get(account.id) ?? 0,
      latestFundValue: fundMap.get(account.id) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate array of last N month keys (YYYY-MM), oldest first. */
function getLastNMonths(count: number, offsetMonths = 0): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i - offsetMonths, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}
