/**
 * Account Master Data Service (V4)
 *
 * Manages the account ↔ payment mode junction table.
 * One account can have multiple payment modes:
 *   HDFC Savings → [Debit Card, UPI, Net Banking]
 *   ICICI Credit Card → [Credit Card]
 *
 * Auto-populated by SMS parser when new combos are detected.
 * Users can also manually add/remove links via the master data screen.
 */

import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import type { FinancialAccount } from "./financial-account";
import { bumpDataVersion } from "@/services/settings";

export interface PaymentMode {
  id: string;
  user_id: string;
  name: string;
  type: "credit_card" | "debit_card" | "upi" | "cash" | "wallet" | "bank_transfer";
  is_active: number;
}

export interface AccountPaymentModeLink {
  id: string;
  account_id: string;
  payment_mode_id: string;
  first_seen_date: string;
  created_at: string;
}

export interface AccountWithModes {
  account: FinancialAccount;
  linkedModes: PaymentMode[];
}

/**
 * Get a single account with all its linked payment modes.
 */
export async function getAccountWithModes(accountId: string): Promise<AccountWithModes | null> {
  const db = getDatabase();

  const account = await db.getFirstAsync<FinancialAccount>(
    "SELECT * FROM financial_accounts WHERE id = ?;",
    accountId,
  );

  if (!account) return null;

  const modes = await db.getAllAsync<PaymentMode>(
    `SELECT pm.* FROM payment_modes pm
     INNER JOIN account_payment_modes apm ON apm.payment_mode_id = pm.id
     WHERE apm.account_id = ?
     ORDER BY pm.name;`,
    accountId,
  );

  return { account, linkedModes: modes };
}

/**
 * Get all accounts with their linked payment modes for the master data screen.
 * Batched: one account query + one JOIN query grouped client-side.
 */
export async function getAllAccountsWithModes(userId: string): Promise<AccountWithModes[]> {
  const db = getDatabase();

  const accounts = await db.getAllAsync<FinancialAccount>(
    `SELECT * FROM financial_accounts
     WHERE user_id = ? AND is_active = 1
     ORDER BY bank_name, account_identifier;`,
    userId,
  );

  if (accounts.length === 0) return [];

  const placeholders = accounts.map(() => "?").join(",");
  const accountIds = accounts.map((a) => a.id);

  const modeRows = await db.getAllAsync<PaymentMode & { account_id: string }>(
    `SELECT pm.*, apm.account_id FROM payment_modes pm
     INNER JOIN account_payment_modes apm ON apm.payment_mode_id = pm.id
     WHERE apm.account_id IN (${placeholders})
     ORDER BY pm.name;`,
    ...accountIds,
  );

  const modesByAccount = new Map<string, PaymentMode[]>();
  for (const row of modeRows) {
    const { account_id, ...mode } = row;
    const existing = modesByAccount.get(account_id);
    if (existing) existing.push(mode);
    else modesByAccount.set(account_id, [mode]);
  }

  return accounts.map((account) => ({
    account,
    linkedModes: modesByAccount.get(account.id) ?? [],
  }));
}

/**
 * Manually link a payment mode to an account.
 * Idempotent — does nothing if the link already exists.
 */
export async function addPaymentModeToAccount(
  accountId: string,
  paymentModeId: string,
): Promise<void> {
  const db = getDatabase();

  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM account_payment_modes WHERE account_id = ? AND payment_mode_id = ?;",
    accountId,
    paymentModeId,
  );

  if (existing) return;

  await db.runAsync(
    `INSERT INTO account_payment_modes (id, account_id, payment_mode_id)
     VALUES (?, ?, ?);`,
    generateUUID(),
    accountId,
    paymentModeId,
  );
  bumpDataVersion();
}

/**
 * Remove a payment mode link from an account.
 */
export async function removePaymentModeFromAccount(
  accountId: string,
  paymentModeId: string,
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "DELETE FROM account_payment_modes WHERE account_id = ? AND payment_mode_id = ?;",
    accountId,
    paymentModeId,
  );
  bumpDataVersion();
}

/**
 * Auto-populate account-mode link from SMS detection.
 * Called by sms-to-expense when a new account+mode combo is detected.
 * Idempotent — safe to call multiple times for the same combo.
 */
export async function autoPopulateAccountMode(
  accountId: string,
  paymentModeId: string,
): Promise<void> {
  await addPaymentModeToAccount(accountId, paymentModeId);
}

/**
 * Get payment modes linked to a specific account.
 * Used by expense add/edit for filtering the mode dropdown.
 */
export async function getLinkedModesForAccount(accountId: string): Promise<PaymentMode[]> {
  const db = getDatabase();
  return db.getAllAsync<PaymentMode>(
    `SELECT pm.* FROM payment_modes pm
     INNER JOIN account_payment_modes apm ON apm.payment_mode_id = pm.id
     WHERE apm.account_id = ?
     ORDER BY pm.name;`,
    accountId,
  );
}

/**
 * Update the user-friendly label for an account.
 * e.g., "ICICI Bank ****3001" → "ICICI Amazon Pay CC"
 */
export async function updateAccountLabel(
  accountId: string,
  label: string | null,
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "UPDATE financial_accounts SET account_label = ?, updated_at = datetime('now') WHERE id = ?;",
    label,
    accountId,
  );
  bumpDataVersion();
}

/**
 * Get all payment modes for a user (for the mode selection dropdown).
 */
export async function getAllPaymentModes(userId: string): Promise<PaymentMode[]> {
  const db = getDatabase();
  return db.getAllAsync<PaymentMode>(
    "SELECT * FROM payment_modes WHERE user_id = ? AND is_active = 1 ORDER BY name;",
    userId,
  );
}

/**
 * Find a payment mode by its type for a user.
 * Used by SMS pipeline to resolve parsed.paymentMode → payment_mode_id.
 */
export async function findPaymentModeByType(
  userId: string,
  modeType: string,
): Promise<PaymentMode | null> {
  const db = getDatabase();

  // Map inferPaymentMode output to payment_modes.type values
  const typeMapping: Record<string, string> = {
    credit_card: "credit_card",
    debit_card: "debit_card",
    upi: "upi",
    net_banking: "bank_transfer",
    wallet: "wallet",
    auto_debit: "bank_transfer",
  };

  const dbType = typeMapping[modeType] ?? modeType;

  return db.getFirstAsync<PaymentMode>(
    "SELECT * FROM payment_modes WHERE user_id = ? AND type = ? AND is_active = 1 LIMIT 1;",
    userId,
    dbType,
  );
}
