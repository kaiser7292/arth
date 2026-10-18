/**
 * Duplicate accounts - the same card or A/c recorded twice.
 *
 * Before 4.19, SMS detection could create a second account for the same digits: a savings A/c
 * mentioned alongside "credit card" became a new credit card, and "HDFC" vs "HDFC Bank" counted
 * as different banks. This finds accounts with the same last digits at the same bank (compared
 * loosely), lets the user pick which to keep, and merges the other into it - every transaction,
 * transfer, balance and link moves across, then the duplicate is removed.
 *
 * "Not the same" dismisses a pair for good: one bank can genuinely issue a savings A/c and a card
 * with the same last four digits.
 */

import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { bumpDataVersion } from "@/services/settings";
import { settingsStorage } from "@/services/storage";
import { getSmsScanAccountIds, setSmsScanAccountIds } from "@/services/sms/sms-permissions";

const DISMISSED_KEY = "duplicate_accounts_dismissed";

export interface DuplicateAccount {
  id: string;
  name: string;
  bank_name: string;
  account_type: string;
  account_identifier: string;
  /** True when the user added it; false when SMS detection created it. */
  addedByYou: boolean;
  created_at: string;
  txCount: number;
  last_known_balance: number | null;
  /** It owns a loan or investment record (a FD, a pension...). */
  hasProduct: boolean;
}

export interface DuplicateGroup {
  key: string;
  accounts: DuplicateAccount[];
  /** The suggested one to keep: added by you, else the oldest. */
  suggestedKeepId: string;
  /** Merging isn't possible when two of them each own a loan or investment record. */
  canMerge: boolean;
}

/** "HDFC Bank Ltd" -> "hdfc": compares bank names loosely. Same rule as account discovery. */
export function bankKey(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/\b(bank|ltd|limited|of|india|the)\b/g, "").replace(/[^a-z0-9]/g, "");
}

function sameBank(a: string, b: string): boolean {
  const x = bankKey(a);
  const y = bankKey(b);
  return x.length > 0 && y.length > 0 && (x === y || x.startsWith(y) || y.startsWith(x));
}

function dismissed(): Set<string> {
  try {
    return new Set(JSON.parse(settingsStorage.getString(DISMISSED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** A stable key for a set of accounts, independent of order. */
function groupKey(ids: string[]): string {
  return [...ids].sort().join("+");
}

export function dismissDuplicateGroup(key: string): void {
  const set = dismissed();
  set.add(key);
  settingsStorage.set(DISMISSED_KEY, JSON.stringify([...set]));
  bumpDataVersion();
}

export async function findDuplicateAccounts(userId: string = DEFAULT_USER_ID): Promise<DuplicateGroup[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    bank_name: string;
    account_type: string;
    account_identifier: string;
    account_label: string | null;
    discovered_from_sms: number | null;
    created_at: string;
    last_known_balance: number | null;
    tx: number;
    products: number;
  }>(
    `SELECT fa.id, fa.bank_name, fa.account_type, fa.account_identifier, fa.account_label,
            fa.discovered_from_sms, fa.created_at, fa.last_known_balance,
            (SELECT COUNT(*) FROM expenses e WHERE e.account_id = fa.id AND e.deleted_at IS NULL) AS tx,
            (SELECT COUNT(*) FROM loan_accounts la WHERE la.financial_account_id = fa.id)
              + (SELECT COUNT(*) FROM investment_products ip WHERE ip.financial_account_id = fa.id) AS products
     FROM financial_accounts fa
     WHERE fa.user_id = ? AND fa.is_active = 1 AND fa.closed_at IS NULL
       AND fa.account_identifier IS NOT NULL AND LENGTH(TRIM(fa.account_identifier)) >= 3
     ORDER BY fa.created_at ASC;`,
    userId,
  );

  // Same digits first, then the same bank (loosely) within those.
  const byDigits = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.account_identifier.trim();
    byDigits.set(k, [...(byDigits.get(k) ?? []), r]);
  }
  const skip = dismissed();
  const groups: DuplicateGroup[] = [];
  for (const same of byDigits.values()) {
    if (same.length < 2) continue;
    const used = new Set<string>();
    for (const r of same) {
      if (used.has(r.id)) continue;
      const members = same.filter((o) => !used.has(o.id) && sameBank(o.bank_name, r.bank_name));
      if (members.length < 2) continue;
      members.forEach((m) => used.add(m.id));
      const key = groupKey(members.map((m) => m.id));
      if (skip.has(key)) continue;
      const accounts: DuplicateAccount[] = members.map((m) => ({
        id: m.id,
        name: m.account_label || m.bank_name,
        bank_name: m.bank_name,
        account_type: m.account_type,
        account_identifier: m.account_identifier,
        addedByYou: m.discovered_from_sms === 0,
        created_at: m.created_at,
        txCount: m.tx,
        last_known_balance: m.last_known_balance,
        hasProduct: m.products > 0,
      }));
      const keep = accounts.find((a) => a.addedByYou) ?? accounts[0];
      groups.push({ key, accounts, suggestedKeepId: keep.id, canMerge: accounts.filter((a) => a.hasProduct).length <= 1 });
    }
  }
  return groups;
}

/**
 * Move everything that points at `dropId` onto `keepId`, then remove `dropId`. One transaction:
 * either all of it happens or none of it does.
 */
export async function mergeAccounts(keepId: string, dropId: string): Promise<void> {
  if (keepId === dropId) return;
  const db = getDatabase();
  const products = await db.getFirstAsync<{ keep_n: number; drop_n: number }>(
    `SELECT
       (SELECT COUNT(*) FROM loan_accounts WHERE financial_account_id = ?) + (SELECT COUNT(*) FROM investment_products WHERE financial_account_id = ?) AS keep_n,
       (SELECT COUNT(*) FROM loan_accounts WHERE financial_account_id = ?) + (SELECT COUNT(*) FROM investment_products WHERE financial_account_id = ?) AS drop_n;`,
    keepId, keepId, dropId, dropId,
  );
  if ((products?.keep_n ?? 0) > 0 && (products?.drop_n ?? 0) > 0) {
    throw new Error("Both accounts have a loan or investment attached, so they can't be merged automatically.");
  }

  await db.withTransactionAsync(async () => {
    const move = async (table: string, column: string) => {
      await db.runAsync(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?;`, keepId, dropId);
    };
    // Plain references.
    await move("expenses", "account_id");
    await move("expenses", "paid_from_account_id");
    await move("account_credits", "account_id");
    await move("recurring_transactions", "account_id");
    await move("smart_rules", "match_account_id");
    await move("simulation_entries", "account_id");
    await move("simulation_entries", "from_account_id");
    await move("simulation_entries", "to_account_id");
    await move("vault_entries", "linked_account_id");
    await move("reconciliation_sessions", "account_id");
    await move("investment_products", "source_account_id");
    await move("loan_accounts", "financial_account_id");
    await move("investment_products", "financial_account_id");

    // Transfers: between the two they become money moving within one account - remove those.
    await db.runAsync(
      `UPDATE account_transfers SET deleted_at = datetime('now')
       WHERE deleted_at IS NULL AND ((from_account_id = ? AND to_account_id = ?) OR (from_account_id = ? AND to_account_id = ?));`,
      keepId, dropId, dropId, keepId,
    );
    await move("account_transfers", "from_account_id");
    await move("account_transfers", "to_account_id");

    // One row per account per month / day / mode: the kept account's own rows win.
    await db.runAsync(
      `UPDATE account_month_balances SET account_id = ?
       WHERE account_id = ? AND month NOT IN (SELECT month FROM account_month_balances WHERE account_id = ?);`,
      keepId, dropId, keepId,
    );
    await db.runAsync(`DELETE FROM account_month_balances WHERE account_id = ?;`, dropId);
    for (const table of ["demat_portfolio_snapshots", "demat_fund_snapshots"]) {
      await db.runAsync(
        `UPDATE ${table} SET account_id = ?
         WHERE account_id = ? AND snapshot_date NOT IN (SELECT snapshot_date FROM ${table} WHERE account_id = ?);`,
        keepId, dropId, keepId,
      );
      await db.runAsync(`DELETE FROM ${table} WHERE account_id = ?;`, dropId);
    }
    await db.runAsync(
      `INSERT OR IGNORE INTO account_payment_modes (id, account_id, payment_mode_id)
       SELECT id || '-m', ?, payment_mode_id FROM account_payment_modes WHERE account_id = ?;`,
      keepId, dropId,
    );
    await db.runAsync(`DELETE FROM account_payment_modes WHERE account_id = ?;`, dropId);

    // Lists of account ids kept as JSON.
    const profiles = await db.getAllAsync<{ id: string; business_receipt_account_ids: string | null }>(
      `SELECT id, business_receipt_account_ids FROM salary_profiles WHERE business_receipt_account_ids LIKE ?;`,
      `%${dropId}%`,
    );
    for (const p of profiles) {
      try {
        const ids = (JSON.parse(p.business_receipt_account_ids ?? "[]") as string[]).map((x) => (x === dropId ? keepId : x));
        await db.runAsync(`UPDATE salary_profiles SET business_receipt_account_ids = ? WHERE id = ?;`, JSON.stringify([...new Set(ids)]), p.id);
      } catch {
        // Not a list - leave it.
      }
    }

    // Fill what the kept account is missing from the duplicate, then remove the duplicate.
    await db.runAsync(
      `UPDATE financial_accounts SET
         account_label = COALESCE(account_label, (SELECT account_label FROM financial_accounts WHERE id = ?)),
         credit_limit = COALESCE(credit_limit, (SELECT credit_limit FROM financial_accounts WHERE id = ?)),
         min_balance = COALESCE(min_balance, (SELECT min_balance FROM financial_accounts WHERE id = ?)),
         updated_at = datetime('now')
       WHERE id = ?;`,
      dropId, dropId, dropId, keepId,
    );
    const newer = await db.getFirstAsync<{ last_known_balance: number | null; last_balance_date: string | null }>(
      `SELECT d.last_known_balance, d.last_balance_date FROM financial_accounts d, financial_accounts k
       WHERE d.id = ? AND k.id = ? AND d.last_balance_date IS NOT NULL
         AND (k.last_balance_date IS NULL OR d.last_balance_date > k.last_balance_date);`,
      dropId, keepId,
    );
    if (newer) {
      await db.runAsync(
        `UPDATE financial_accounts SET last_known_balance = ?, last_balance_date = ? WHERE id = ?;`,
        newer.last_known_balance, newer.last_balance_date, keepId,
      );
    }
    await db.runAsync(`DELETE FROM financial_accounts WHERE id = ?;`, dropId);
  });

  // The SMS scan's account filter (device setting) may name the duplicate.
  const scanIds = getSmsScanAccountIds();
  if (scanIds.includes(dropId)) setSmsScanAccountIds([...new Set(scanIds.map((x) => (x === dropId ? keepId : x)))]);

  bumpDataVersion();
}
