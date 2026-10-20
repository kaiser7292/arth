/**
 * Accounts found in transaction messages that the user doesn't want Arth to track (an old card, a
 * family member's account whose messages reach this phone), and where each found account came from.
 *
 * Ignoring isn't the same as closing: SMS discovery would bring a closed account straight back
 * with its next message. So the bank and digits are remembered (MMKV "ignored_accounts") and the
 * scan drops their messages before they become transactions. The account is hidden and its
 * message-made transactions go to the recycle bin; "Keep" undoes all three.
 */

import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { bumpDataVersion } from "@/services/settings";
import { settingsStorage } from "@/services/storage";
import { bankKey } from "@/services/account-duplicates";

const KEY = "ignored_accounts";

interface Ignored {
  accountId: string;
  bank: string;
  digits: string;
  /** When it was ignored; the transactions it hid carry this deleted_at, so Keep restores exactly those. */
  at: string;
}

function read(): Ignored[] {
  try {
    return JSON.parse(settingsStorage.getString(KEY) ?? "[]") as Ignored[];
  } catch {
    return [];
  }
}

function write(list: Ignored[]): void {
  settingsStorage.set(KEY, JSON.stringify(list));
}

function sameDigits(a: string, b: string): boolean {
  const x = a.replace(/\D/g, "");
  const y = b.replace(/\D/g, "");
  const n = Math.min(4, x.length, y.length);
  return n >= 3 && x.slice(-n) === y.slice(-n);
}

/** Is a message about an ignored account? Same bank (loosely) and the same last 3-4 digits. */
export function isIgnoredAccount(bank: string | null | undefined, digits: string | null | undefined): boolean {
  if (!digits) return false;
  const list = read();
  if (list.length === 0) return false;
  const k = bankKey(bank);
  return list.some((i) => sameDigits(i.digits, digits) && (!k || !bankKey(i.bank) || bankKey(i.bank) === k || k.startsWith(bankKey(i.bank)) || bankKey(i.bank).startsWith(k)));
}

export function getIgnoredAccountIds(): Set<string> {
  return new Set(read().map((i) => i.accountId));
}

export async function ignoreAccount(accountId: string): Promise<void> {
  const db = getDatabase();
  const acc = await db.getFirstAsync<{ bank_name: string; account_identifier: string | null }>(
    `SELECT bank_name, account_identifier FROM financial_accounts WHERE id = ?;`,
    accountId,
  );
  if (!acc?.account_identifier) return;
  const at = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE financial_accounts SET is_active = 0, updated_at = datetime('now') WHERE id = ?;`, accountId);
    await db.runAsync(
      `UPDATE expenses SET deleted_at = ? WHERE account_id = ? AND source = 'sms_auto' AND deleted_at IS NULL;`,
      at,
      accountId,
    );
  });
  write([...read().filter((i) => i.accountId !== accountId), { accountId, bank: acc.bank_name, digits: acc.account_identifier, at }]);
  bumpDataVersion();
}

/** Undo ignoreAccount: the account comes back with the transactions it hid. */
export async function keepAccount(accountId: string): Promise<void> {
  const entry = read().find((i) => i.accountId === accountId);
  const db = getDatabase();
  await db.runAsync(`UPDATE financial_accounts SET is_active = 1, updated_at = datetime('now') WHERE id = ?;`, accountId);
  if (entry) {
    await db.runAsync(`UPDATE expenses SET deleted_at = NULL WHERE account_id = ? AND deleted_at = ?;`, accountId, entry.at);
  }
  write(read().filter((i) => i.accountId !== accountId));
  bumpDataVersion();
}

export interface AccountOrigin {
  /** Messages that mention this account and became transactions. */
  messages: number;
  first: string | null;
  last: string | null;
  sender: string | null;
  /** The earliest such message, as received. */
  sample: string | null;
}

/** Where an account Arth found came from: which messages, from whom, over what dates. */
export async function getAccountOrigin(accountId: string, userId: string = DEFAULT_USER_ID): Promise<AccountOrigin> {
  const db = getDatabase();
  const stats = await db.getFirstAsync<{ n: number; first: string | null; last: string | null }>(
    `SELECT COUNT(*) AS n, MIN(date) AS first, MAX(date) AS last FROM expenses
      WHERE user_id = ? AND account_id = ? AND raw_source_text IS NOT NULL;`,
    userId,
    accountId,
  );
  const sample = await db.getFirstAsync<{ id: string; raw_source_text: string }>(
    `SELECT id, raw_source_text FROM expenses
      WHERE user_id = ? AND account_id = ? AND raw_source_text IS NOT NULL
      ORDER BY date ASC LIMIT 1;`,
    userId,
    accountId,
  );
  const sms = sample
    ? await db.getFirstAsync<{ address: string | null }>(`SELECT address FROM pending_sms WHERE expense_id = ? LIMIT 1;`, sample.id)
    : null;
  return {
    messages: stats?.n ?? 0,
    first: stats?.first ?? null,
    last: stats?.last ?? null,
    sender: sms?.address ?? null,
    sample: sample?.raw_source_text ?? null,
  };
}
