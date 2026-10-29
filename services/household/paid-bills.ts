import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { bumpDataVersion } from "@/services/settings";
import { settingsStorage } from "@/services/storage";
import { generateUUID } from "@/utils/uuid";
import { getMemberLinks } from "./shares";
import { bestCategoryMatch, getItems, getMembers } from "./store";
import type { Household, HouseholdItem } from "./types";

/**
 * Bills someone else in the household recorded as paid by me ("Aastha used my card at Nykaa, she
 * owes me ₹3,737"). Their phone sends the bill with paidBy = me; mirror.ts writes my Hisaab entry
 * (she owes me). This module ties that entry to the money that actually left my account:
 *
 *   matched    my own transaction for the same amount around the same date (usually the bank SMS)
 *              becomes a split with her: the account keeps the whole bill, my budget only my share
 *   added      no transaction yet: I pick the account and Arth adds it, split the same way
 *   skipped    paid in a way I don't track: it stays a Hisaab entry
 *
 * The link is the entry's linked_expense_id plus the expense's split fields, so it travels through
 * backup like any split. When the bill changes on their side the split follows; when it goes away
 * the split is taken off again and the transaction is mine in full.
 */

const SKIPPED_KEY = "household_paid_bills_skipped";
const AUTO_DAYS = 3;
const PICK_DAYS = 10;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PaidBill {
  ref: string;
  entryId: string;
  linkedExpenseId: string | null;
  memberId: string;
  personId: string;
  from: string;
  bill: number;
  owed: number;
  date: string;
  time: string | null;
  merchant: string | null;
  category: string | null;
  ownCategory: string | null;
  note: string | null;
}

export interface PaidBillCandidate {
  id: string;
  amount: number;
  date: string;
  merchant: string | null;
  description: string | null;
  account: string | null;
}

interface Extra {
  owes?: Record<string, number>;
  paidBy?: string;
  description?: string | null;
  time?: string | null;
  ownCategory?: string | null;
}

const extraOf = (i: HouseholdItem): Extra => {
  try {
    return i.payload_json ? (JSON.parse(i.payload_json) as Extra) : {};
  } catch {
    return {};
  }
};

/** The bill an item describes, when another member says I paid it. */
export function paidByMe(
  h: Household,
  i: HouseholdItem,
): { owed: number; extra: Extra } | null {
  if (i.kind !== "tx" || i.member_id === h.my_member_id) return null;
  const x = extraOf(i);
  if (x.paidBy !== h.my_member_id) return null;
  const owed = round2(x.owes?.[i.member_id] ?? 0);
  return owed > 0 ? { owed, extra: x } : null;
}

function skipped(): Set<string> {
  try {
    return new Set(
      JSON.parse(settingsStorage.getString(SKIPPED_KEY) ?? "[]") as string[],
    );
  } catch {
    return new Set();
  }
}

/** Every bill others say I paid, with the Hisaab entry mirror.ts wrote for it. */
export async function getPaidBills(h: Household): Promise<PaidBill[]> {
  const links = await getMemberLinks(h.id);
  const names = new Map(
    (await getMembers(h.id, true)).map((m) => [m.id, m.name]),
  );
  const entries = await getDatabase().getAllAsync<{
    id: string;
    household_ref: string;
    linked_expense_id: string | null;
  }>(
    "SELECT id, household_ref, linked_expense_id FROM hisaab_entries WHERE household_ref LIKE ?;",
    `${h.id}:%`,
  );
  const entryByRef = new Map(entries.map((e) => [e.household_ref, e]));
  const out: PaidBill[] = [];
  for (const i of await getItems(h.id)) {
    const p = paidByMe(h, i);
    if (!p) continue;
    const ref = `${h.id}:${i.id}`;
    const entry = entryByRef.get(ref);
    const personId = links.get(i.member_id);
    if (!entry || !personId) continue;
    out.push({
      ref,
      entryId: entry.id,
      linkedExpenseId: entry.linked_expense_id,
      memberId: i.member_id,
      personId,
      from: names.get(i.member_id) ?? "Someone",
      bill: round2(Math.max(i.paid ?? p.owed, p.owed)),
      owed: p.owed,
      date: (i.date ?? i.updated_at).slice(0, 10),
      time: typeof p.extra.time === "string" ? p.extra.time : null,
      merchant: i.merchant,
      category: i.category_name,
      ownCategory:
        typeof p.extra.ownCategory === "string" ? p.extra.ownCategory : null,
      note:
        typeof p.extra.description === "string" && p.extra.description.trim()
          ? p.extra.description.trim()
          : null,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Bills still waiting for me to say where the money came from. */
export async function getUnfiledPaidBills(h: Household): Promise<PaidBill[]> {
  const skip = skipped();
  return (await getPaidBills(h)).filter(
    (b) => !b.linkedExpenseId && !skip.has(b.ref),
  );
}

/** My transactions that could be this bill: the same amount, unsplit, near the date. */
export async function candidatesFor(
  bill: PaidBill,
  days: number = PICK_DAYS,
  userId: string = DEFAULT_USER_ID,
): Promise<PaidBillCandidate[]> {
  return getDatabase().getAllAsync<PaidBillCandidate>(
    `SELECT e.id, e.amount, e.date, e.merchant_name AS merchant, e.description,
            COALESCE(a.account_label, a.bank_name || ' ' || a.account_identifier) AS account
     FROM expenses e
     LEFT JOIN financial_accounts a ON a.id = e.account_id
     WHERE e.user_id = ? AND e.status = 'approved' AND e.nature = 'realized' AND e.deleted_at IS NULL
       AND e.household_ref IS NULL
       AND e.split_original_amount IS NULL AND e.split_hisaab_entry_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM expense_splits s WHERE s.expense_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM hisaab_entries he WHERE he.linked_expense_id = e.id)
       AND ABS(e.amount - ?) < 0.5
       AND date(e.date) BETWEEN date(?, ?) AND date(?, ?)
     ORDER BY ABS(julianday(date(e.date)) - julianday(?)), e.date DESC
     LIMIT 20;`,
    userId,
    bill.bill,
    bill.date,
    `-${days} days`,
    bill.date,
    `+${days} days`,
    bill.date,
  );
}

const words = (s: string | null | undefined) =>
  new Set(
    (s ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4),
  );

/**
 * The one transaction this bill must be, or null when it's not clear: the only candidate within a
 * few days, or among several, the only one whose merchant shares a word with the bill's.
 */
function clearMatch(
  bill: PaidBill,
  candidates: PaidBillCandidate[],
): PaidBillCandidate | null {
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0 || !bill.merchant) return null;
  const want = words(bill.merchant);
  const named = candidates.filter((c) =>
    [...words(c.merchant)].some((w) => want.has(w)),
  );
  return named.length === 1 ? named[0] : null;
}

/** Split my transaction with the member: the bill stays whole on the account, I keep my share. */
async function linkExpense(bill: PaidBill, expenseId: string): Promise<void> {
  const db = getDatabase();
  const e = await db.getFirstAsync<{
    amount: number;
    split_original_amount: number | null;
    category_id: string | null;
  }>(
    "SELECT amount, split_original_amount, category_id FROM expenses WHERE id = ?;",
    expenseId,
  );
  if (!e) return;
  const whole = e.split_original_amount ?? e.amount;
  const owed = Math.min(bill.owed, whole);
  const mine = round2(whole - owed);
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE expenses SET amount = ?, split_original_amount = ?, split_person_id = ?, split_pct = ?, split_hisaab_entry_id = ?,
         split_mode = 'exact', split_exact_amount = ?, updated_at = datetime('now') WHERE id = ?;`,
      mine,
      whole,
      bill.personId,
      whole > 0 ? Math.round((mine / whole) * 100) : 0,
      bill.entryId,
      owed,
      expenseId,
    );
    await db.runAsync(
      "UPDATE hisaab_entries SET linked_expense_id = ?, category_id = COALESCE(category_id, ?), updated_at = datetime('now') WHERE id = ?;",
      expenseId,
      e.category_id,
      bill.entryId,
    );
  });
}

/** I paid it with this transaction. */
export async function fileWithExpense(
  bill: PaidBill,
  expenseId: string,
): Promise<void> {
  await linkExpense(bill, expenseId);
  bumpDataVersion();
}

/** I paid it from this account, and there's no transaction for it yet: add one. */
export async function fileToAccount(
  bill: PaidBill,
  accountId: string,
  userId: string = DEFAULT_USER_ID,
): Promise<string> {
  const db = getDatabase();
  const mine = await db.getAllAsync<{ id: string; name: string }>(
    "SELECT id, name FROM categories WHERE user_id = ? AND is_active = 1 ORDER BY sort_order;",
    userId,
  );
  const category =
    (bill.category ? bestCategoryMatch(bill.category, mine)?.id : undefined) ??
    (bill.ownCategory
      ? bestCategoryMatch(bill.ownCategory, mine)?.id
      : undefined) ??
    null;
  const id = generateUUID();
  await db.runAsync(
    `INSERT INTO expenses (id, user_id, account_id, amount, description, category_id, date, transaction_time,
       source, status, nature, merchant_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'approved', 'realized', ?, datetime('now'), datetime('now'));`,
    id,
    userId,
    accountId,
    bill.bill,
    bill.note ?? `Paid for ${bill.from}`,
    category,
    bill.date,
    bill.time && /^\d{2}:\d{2}/.test(bill.time) ? bill.time : "00:00:00",
    bill.merchant,
  );
  await linkExpense(bill, id);
  bumpDataVersion();
  return id;
}

/** Paid in a way I don't track (cash I don't log, someone else's card): keep it in Hisaab only. */
export function skipPaidBill(bill: PaidBill): void {
  const s = skipped();
  s.add(bill.ref);
  settingsStorage.set(SKIPPED_KEY, JSON.stringify([...s]));
  bumpDataVersion();
}

/** The entry is going away (they deleted or changed the bill): my transaction is mine in full again. */
export async function unlinkEntry(entryId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE expenses SET amount = split_original_amount, split_original_amount = NULL, split_person_id = NULL, split_pct = NULL,
       split_hisaab_entry_id = NULL, split_mode = NULL, split_exact_amount = NULL, updated_at = datetime('now')
     WHERE split_hisaab_entry_id = ? AND split_original_amount IS NOT NULL;`,
    entryId,
  );
  await db.runAsync(
    "UPDATE hisaab_entries SET linked_expense_id = NULL WHERE id = ?;",
    entryId,
  );
}

/** What they say I'm owed changed: the split on my transaction follows. */
export async function followOwed(entryId: string, owed: number): Promise<void> {
  const db = getDatabase();
  const e = await db.getFirstAsync<{
    id: string;
    split_original_amount: number;
  }>(
    "SELECT id, split_original_amount FROM expenses WHERE split_hisaab_entry_id = ? AND split_original_amount IS NOT NULL;",
    entryId,
  );
  if (!e) return;
  const whole = e.split_original_amount;
  const o = Math.min(owed, whole);
  const mine = round2(whole - o);
  await db.runAsync(
    "UPDATE expenses SET amount = ?, split_exact_amount = ?, split_pct = ?, updated_at = datetime('now') WHERE id = ?;",
    mine,
    o,
    whole > 0 ? Math.round((mine / whole) * 100) : 0,
    e.id,
  );
}

/** Files every bill that can only be one of my transactions. Returns how many it filed. */
export async function autoFilePaidBills(
  h: Household,
  userId: string = DEFAULT_USER_ID,
): Promise<number> {
  let n = 0;
  for (const bill of await getUnfiledPaidBills(h)) {
    const match = clearMatch(
      bill,
      await candidatesFor(bill, AUTO_DAYS, userId),
    );
    if (!match) continue;
    await linkExpense(bill, match.id);
    n++;
  }
  return n;
}
