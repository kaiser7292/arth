/**
 * The user's own UPI IDs, linked to the account they pay from / receive into
 * (financial_accounts.upi_ids, a JSON array - migration 084). An account can have several (one per
 * UPI app); an ID belongs to one account, so linking it to another moves it. A payment picture that
 * shows the user's UPI ID then picks the right account (services/receipt/receipt-to-transaction.ts).
 */

import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { bumpDataVersion } from "@/services/settings";

const VPA = /^[a-z0-9][a-z0-9._-]{1,60}@[a-z][a-z0-9.]{1,30}$/;

/** "Name@OkICICI " -> "name@okicici"; null when it isn't a UPI ID. */
export function normaliseUpiId(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  return VPA.test(v) ? v : null;
}

/** The stored column, read safely: anything malformed reads as no IDs. */
export function parseUpiIds(stored: string | null | undefined): string[] {
  if (!stored) return [];
  try {
    const list = JSON.parse(stored);
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string" && !!normaliseUpiId(v)) : [];
  } catch {
    return [];
  }
}

export async function getUpiIds(accountId: string): Promise<string[]> {
  const row = await getDatabase().getFirstAsync<{ upi_ids: string | null }>(
    `SELECT upi_ids FROM financial_accounts WHERE id = ?;`,
    accountId,
  );
  return parseUpiIds(row?.upi_ids);
}

async function write(accountId: string, ids: string[]): Promise<void> {
  await getDatabase().runAsync(
    `UPDATE financial_accounts SET upi_ids = ?, updated_at = datetime('now') WHERE id = ?;`,
    ids.length ? JSON.stringify(ids) : null,
    accountId,
  );
}

/** Link a UPI ID to an account, taking it off any other account it was on. */
export async function addUpiId(accountId: string, raw: string, userId: string = DEFAULT_USER_ID): Promise<string> {
  const id = normaliseUpiId(raw);
  if (!id) throw new Error("That doesn't look like a UPI ID (like name@okicici).");
  const db = getDatabase();
  const rows = await db.getAllAsync<{ id: string; upi_ids: string | null }>(
    `SELECT id, upi_ids FROM financial_accounts WHERE user_id = ? AND upi_ids IS NOT NULL;`,
    userId,
  );
  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      if (r.id === accountId) continue;
      const ids = parseUpiIds(r.upi_ids);
      if (ids.includes(id)) await write(r.id, ids.filter((x) => x !== id));
    }
    const mine = parseUpiIds(rows.find((r) => r.id === accountId)?.upi_ids);
    if (!mine.includes(id)) await write(accountId, [...mine, id]);
  });
  await bumpDataVersion();
  return id;
}

export async function removeUpiId(accountId: string, id: string): Promise<void> {
  const ids = await getUpiIds(accountId);
  await write(accountId, ids.filter((x) => x !== id));
  await bumpDataVersion();
}

/** Both lists, the kept account's first - for merging two accounts into one. */
export function mergeUpiIds(keep: string | null | undefined, drop: string | null | undefined): string | null {
  const ids = [...new Set([...parseUpiIds(keep), ...parseUpiIds(drop)])];
  return ids.length ? JSON.stringify(ids) : null;
}
