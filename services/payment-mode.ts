import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { DEFAULT_PAYMENT_MODES } from "@/database/defaults/payment-modes";
import { bumpDataVersion } from "@/services/settings";

export type PaymentModeType =
  | "credit_card"
  | "debit_card"
  | "upi"
  | "cash"
  | "wallet"
  | "bank_transfer";

export interface PaymentMode {
  id: string;
  user_id: string;
  name: string;
  type: PaymentModeType;
  is_active: number;
}

export interface CreatePaymentModeInput {
  user_id: string;
  name: string;
  type: PaymentModeType;
}

export interface UpdatePaymentModeInput {
  name?: string;
  type?: PaymentModeType;
  is_active?: number;
}

/**
 * Get all active payment modes for a user.
 */
export async function getPaymentModes(userId: string): Promise<PaymentMode[]> {
  const db = getDatabase();
  return db.getAllAsync<PaymentMode>(
    "SELECT * FROM payment_modes WHERE user_id = ? AND is_active = 1 ORDER BY name ASC;",
    userId,
  );
}

/**
 * Get all payment modes for a user (including inactive).
 */
export async function getAllPaymentModes(
  userId: string,
): Promise<PaymentMode[]> {
  const db = getDatabase();
  return db.getAllAsync<PaymentMode>(
    "SELECT * FROM payment_modes WHERE user_id = ? ORDER BY name ASC;",
    userId,
  );
}

/**
 * Get a single payment mode by ID.
 */
export async function getPaymentModeById(
  id: string,
): Promise<PaymentMode | null> {
  const db = getDatabase();
  return db.getFirstAsync<PaymentMode>(
    "SELECT * FROM payment_modes WHERE id = ?;",
    id,
  );
}

/**
 * Create a new payment mode. Returns the new ID.
 */
export async function createPaymentMode(
  input: CreatePaymentModeInput,
): Promise<string> {
  const db = getDatabase();
  const id = generateUUID();

  await db.runAsync(
    "INSERT INTO payment_modes (id, user_id, name, type) VALUES (?, ?, ?, ?);",
    id,
    input.user_id,
    input.name,
    input.type,
  );

  bumpDataVersion();
  return id;
}

/**
 * Update a payment mode by ID.
 */
export async function updatePaymentMode(
  id: string,
  input: UpdatePaymentModeInput,
): Promise<void> {
  const db = getDatabase();

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.name !== undefined) {
    fields.push("name = ?");
    values.push(input.name);
  }
  if (input.type !== undefined) {
    fields.push("type = ?");
    values.push(input.type);
  }
  if (input.is_active !== undefined) {
    fields.push("is_active = ?");
    values.push(input.is_active);
  }

  if (fields.length === 0) return;

  values.push(id);
  await db.runAsync(
    `UPDATE payment_modes SET ${fields.join(", ")} WHERE id = ?;`,
    ...values,
  );
  bumpDataVersion();
}

/**
 * Soft-delete a payment mode (set is_active = 0).
 * Returns the count of expenses linked to this payment mode.
 */
export async function deletePaymentMode(id: string): Promise<number> {
  const db = getDatabase();

  const countRow = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM expenses WHERE payment_mode_id = ? AND deleted_at IS NULL;",
    id,
  );
  const linkedExpenses = countRow?.count ?? 0;

  await db.runAsync(
    "UPDATE payment_modes SET is_active = 0 WHERE id = ?;",
    id,
  );

  bumpDataVersion();
  return linkedExpenses;
}

/**
 * Get all inactive (soft-deleted) payment modes for the recycle bin.
 */
export async function getInactivePaymentModes(userId: string): Promise<PaymentMode[]> {
  const db = getDatabase();
  return db.getAllAsync<PaymentMode>(
    "SELECT * FROM payment_modes WHERE user_id = ? AND is_active = 0 ORDER BY name ASC;",
    userId,
  );
}

/**
 * Restore a soft-deleted payment mode (set is_active = 1).
 */
export async function restorePaymentMode(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync("UPDATE payment_modes SET is_active = 1 WHERE id = ?;", id);
  bumpDataVersion();
}

/**
 * Restore all inactive payment modes for a user.
 */
export async function restoreAllPaymentModes(userId: string): Promise<number> {
  const db = getDatabase();
  const result = await db.runAsync(
    "UPDATE payment_modes SET is_active = 1 WHERE user_id = ? AND is_active = 0;",
    userId,
  );
  if (result.changes > 0) bumpDataVersion();
  return result.changes;
}

/**
 * Hard-delete all inactive payment modes for a user (where no expenses are linked).
 */
export async function purgeAllInactivePaymentModes(userId: string): Promise<number> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT pm.id FROM payment_modes pm
     WHERE pm.user_id = ? AND pm.is_active = 0
       AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.payment_mode_id = pm.id AND e.deleted_at IS NULL);`,
    userId,
  );
  let deleted = 0;
  for (const row of rows) {
    const ok = await hardDeletePaymentMode(row.id);
    if (ok) deleted++;
  }
  return deleted;
}

/**
 * Get the count of non-deleted expenses linked to a payment mode.
 */
export async function getPaymentModeExpenseCount(id: string): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM expenses WHERE payment_mode_id = ? AND deleted_at IS NULL;",
    id,
  );
  return row?.count ?? 0;
}

/**
 * Hard-delete a payment mode permanently.
 * Only allowed when no expenses are linked. Returns true if deleted.
 *
 * FK references cleared:
 *   account_payment_modes.payment_mode_id (NOT NULL → delete rows)
 */
export async function hardDeletePaymentMode(id: string): Promise<boolean> {
  const db = getDatabase();

  const count = await getPaymentModeExpenseCount(id);
  if (count > 0) return false;

  // Delete junction rows linking this payment mode to accounts
  await db.runAsync("DELETE FROM account_payment_modes WHERE payment_mode_id = ?;", id);

  await db.runAsync("DELETE FROM payment_modes WHERE id = ?;", id);
  bumpDataVersion();
  return true;
}

/**
 * Seed default payment modes for a user.
 * Only seeds if the user has no payment modes yet.
 */
export async function seedDefaultPaymentModes(
  userId: string,
): Promise<number> {
  const db = getDatabase();

  const existing = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM payment_modes WHERE user_id = ?;",
    userId,
  );

  if ((existing?.count ?? 0) > 0) {
    return 0;
  }

  await db.withTransactionAsync(async () => {
    for (const pm of DEFAULT_PAYMENT_MODES) {
      const id = generateUUID();
      await db.runAsync(
        "INSERT INTO payment_modes (id, user_id, name, type) VALUES (?, ?, ?, ?);",
        id,
        userId,
        pm.name,
        pm.type,
      );
    }
  });

  return DEFAULT_PAYMENT_MODES.length;
}

/** Display labels for payment mode types */
export const PAYMENT_MODE_TYPE_LABELS: Record<PaymentModeType, string> = {
  credit_card: "Credit Card",
  debit_card: "Debit Card",
  upi: "UPI",
  cash: "Cash",
  wallet: "Wallet",
  bank_transfer: "Bank Account",
};
