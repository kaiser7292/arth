/**
 * From a read screenshot (read-receipt.ts) to what the Add screen needs: which of the user's
 * accounts it names, and whether it's already in Arth.
 */

import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import type { AccountHint, ReceiptGuess } from "@/services/receipt/read-receipt";

export interface OwnAccount {
  id: string;
  bank_name: string;
  account_label: string | null;
  account_identifier: string | null;
  account_type: string;
}

const bankKey = (name: string | null | undefined) =>
  (name ?? "").toLowerCase().replace(/\b(bank|ltd|limited|of|india|the)\b/g, "").replace(/[^a-z0-9]/g, "");

/** Last 3 or 4 digits agree (banks shorten the same number differently). */
function sameDigits(a: string | null, b: string | null): boolean {
  const x = (a ?? "").replace(/\D/g, "");
  const y = (b ?? "").replace(/\D/g, "");
  const n = Math.min(4, x.length, y.length);
  return n >= 3 && x.slice(-n) === y.slice(-n);
}

/**
 * The user's account a hint names: digits first (with the bank when given), then a wallet by the
 * app's name ("Gift Cards" in Amazon Pay -> the Amazon Pay wallet), then a bank with only one
 * account. Null when it isn't clear - never a guess between two.
 */
export function matchAccount(hint: AccountHint | null, accounts: OwnAccount[], app: string | null): OwnAccount | null {
  if (!hint) return null;
  const hintBank = bankKey(hint.label);
  const bankOk = (a: OwnAccount) => {
    const k = bankKey(a.bank_name);
    return !hintBank || !k || k === hintBank || k.startsWith(hintBank) || hintBank.startsWith(k);
  };
  if (hint.last4) {
    const byDigits = accounts.filter((a) => sameDigits(a.account_identifier, hint.last4));
    const both = byDigits.filter(bankOk);
    if (both.length === 1) return both[0];
    if (byDigits.length === 1) return byDigits[0];
    return null;
  }
  if (hint.wallet) {
    const appKey = bankKey(app ?? "");
    const wallets = accounts.filter((a) => a.account_type === "wallet");
    const named = wallets.filter((w) => {
      const k = bankKey(`${w.bank_name} ${w.account_label ?? ""}`);
      return (appKey && k.includes(appKey)) || (hintBank && k.includes(hintBank));
    });
    if (named.length === 1) return named[0];
    return wallets.length === 1 ? wallets[0] : null;
  }
  const sameBank = accounts.filter((a) => a.account_type !== "wallet" && bankOk(a) && hintBank);
  return sameBank.length === 1 ? sameBank[0] : null;
}

export async function getOwnAccounts(userId: string = DEFAULT_USER_ID): Promise<OwnAccount[]> {
  return getDatabase().getAllAsync<OwnAccount>(
    `SELECT id, bank_name, account_label, account_identifier, account_type FROM financial_accounts
      WHERE user_id = ? AND is_active = 1 AND closed_at IS NULL;`,
    userId,
  );
}

export interface PossibleDuplicate {
  id: string;
  merchant: string | null;
  amount: number;
  date: string;
}

/**
 * A transaction already in Arth that's probably this one: the same amount (to the paisa), within a
 * day, money the same way, on the same account when known. The bank's SMS often got there first.
 */
export async function findPossibleDuplicate(guess: ReceiptGuess, accountId: string | null, userId: string = DEFAULT_USER_ID): Promise<PossibleDuplicate | null> {
  if (!guess.amount || !guess.date) return null;
  const nature = guess.kind === "credit" ? "credit" : "realized";
  const row = await getDatabase().getFirstAsync<{ id: string; merchant_name: string | null; amount: number; date: string }>(
    `SELECT id, merchant_name, amount, date FROM expenses
      WHERE user_id = ? AND deleted_at IS NULL AND nature = ? AND ABS(amount - ?) < 0.01
        AND date >= date(?, '-1 day') AND date <= date(?, '+1 day')
        ${accountId ? "AND (account_id = ? OR account_id IS NULL)" : ""}
      ORDER BY ABS(julianday(date) - julianday(?)) LIMIT 1;`,
    ...(accountId
      ? [userId, nature, guess.amount, guess.date, guess.date, accountId, guess.date]
      : [userId, nature, guess.amount, guess.date, guess.date, guess.date]),
  );
  return row ? { id: row.id, merchant: row.merchant_name, amount: row.amount, date: row.date } : null;
}

/** A transfer already recorded between these accounts for this amount and day. */
export async function findPossibleDuplicateTransfer(amount: number, date: string, fromId: string, toId: string, userId: string = DEFAULT_USER_ID): Promise<boolean> {
  const row = await getDatabase().getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM account_transfers
      WHERE user_id = ? AND deleted_at IS NULL AND from_account_id = ? AND to_account_id = ? AND ABS(amount - ?) < 0.01
        AND date >= date(?, '-1 day') AND date <= date(?, '+1 day');`,
    userId,
    fromId,
    toId,
    amount,
    date,
    date,
  );
  return (row?.n ?? 0) > 0;
}
