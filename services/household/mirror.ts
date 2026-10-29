import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { permanentlyDeleteExpense } from "@/services/expense-crud";
import { generateUUID } from "@/utils/uuid";
import { autoFilePaidBills, followOwed, paidByMe, unlinkEntry } from "./paid-bills";
import { getMemberLinks } from "./shares";
import { bestCategoryMatch, categoryWords, getCategoryMap, getHouseholdCategories, getItems, getMembers } from "./store";
import { getTheirCategoryMap } from "./their-categories";
import type { Household, HouseholdItem } from "./types";

/**
 * What this phone writes by itself from what the others shared, so both phones tell the same story
 * (Together rework):
 *
 *   their shared bill, my part   → Hisaab: "credit" on them (they paid for me), and an expense for my
 *                                  share ("Paid by Aastha"), so my budget counts what I consumed
 *   their settle-up to me        → Hisaab: "settlement" on them (they paid me back)
 *   their bill that I paid       → Hisaab: "debit" on them (they owe me), filed against my own
 *     (paidBy = me)                transaction or account by paid-bills.ts
 *
 * The mirror image of each happens on their phone from what I share (my split's "debit" entries,
 * my settle-up's "debit"). Every row written here carries household_ref "<household>:<item>" and is
 * owned by this function: it's updated when the item changes and removed when the item goes.
 */

const ref = (hh: string, itemId: string) => `${hh}:${itemId}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface Extra {
  owes?: Record<string, number>;
  payer?: string;
  payee?: string;
  amount?: number;
  split?: string;
  to?: string;
  type?: string;
  description?: string | null;
  merchant?: string | null;
  category?: string | null;
  paidBy?: string;
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

/** Their category (a household category name, or their own) → one of mine. */
async function categoryResolver(h: Household, userId: string): Promise<(...names: (string | null | undefined)[]) => string | null> {
  const db = getDatabase();
  const hcats = await getHouseholdCategories(h.id);
  const map = await getCategoryMap(h.id);
  const mine = await db.getAllAsync<{ id: string; name: string }>(
    "SELECT id, name FROM categories WHERE user_id = ? AND is_active = 1 ORDER BY sort_order;",
    userId,
  );
  // Loose: same name, a word in common, or the same kind of spending.
  const byName = (name: string) => bestCategoryMatch(name, mine)?.id ?? null;
  const key = (s: string) => categoryWords(s).join("");
  const theirs = await getTheirCategoryMap(h.id);
  return (...names) => {
    // My own choice for their category comes first ("Pets" → my "Family").
    for (const name of names) {
      const chosen = name ? theirs.get(name.toLowerCase()) : undefined;
      if (chosen && mine.some((c) => c.id === chosen)) return chosen;
    }
    for (const name of names) {
      if (!name) continue;
      const hc = hcats.find((c) => key(c.name) === key(name));
      if (hc) {
        const local = [...map.entries()].find(([, v]) => v === hc.id)?.[0];
        if (local) return local;
      }
      const found = byName(name);
      if (found) return found;
    }
    return null;
  };
}

interface DesiredEntry {
  ref: string;
  personId: string;
  type: "credit" | "debit" | "settlement";
  amount: number;
  date: string;
  description: string;
  merchant: string | null;
  categoryName: string | null;
}

interface DesiredExpense {
  ref: string;
  /** My share. */
  amount: number;
  /** The whole bill they paid: stored as the split's original amount, so Arth shows it as split. */
  bill: number;
  date: string;
  time: string;
  merchant: string | null;
  categoryName: string | null;
  ownCategory: string | null;
  description: string;
}

/** Brings the rows this phone keeps from the others' shared items in line with those items. */
export async function reconcileMirrors(h: Household, userId: string = DEFAULT_USER_ID): Promise<boolean> {
  const db = getDatabase();
  const links = await getMemberLinks(h.id);
  const names = new Map((await getMembers(h.id, true)).map((m) => [m.id, m.name]));
  const items = (await getItems(h.id)).filter((i) => i.member_id !== h.my_member_id);

  const entries: DesiredEntry[] = [];
  const expenses: DesiredExpense[] = [];
  for (const i of items) {
    const personId = links.get(i.member_id);
    if (!personId) continue; // not linked to a Hisaab person yet
    const x = extraOf(i);
    const who = names.get(i.member_id) ?? "them";
    const date = (i.date ?? i.updated_at).slice(0, 10);
    const paid = paidByMe(h, i);
    if (paid) {
      // Their bill, but the money was mine: they owe me their part. No "Paid by" expense - the
      // spend is on my account already, or I'll say which (paid-bills.ts).
      const what = i.merchant || i.category_name || "Shared";
      entries.push({ ref: ref(h.id, i.id), personId, type: "debit", amount: paid.owed, date, description: what, merchant: i.merchant, categoryName: i.category_name });
    } else if (i.kind === "tx" && x.paidBy) {
      continue; // paid by a third member: between those two
    } else if (i.kind === "tx") {
      const mine = round2(x.owes?.[h.my_member_id] ?? 0);
      if (mine <= 0) continue;
      const what = i.merchant || i.category_name || "Shared";
      // The ledger is already theirs and shows the amount: the description is just what it was for.
      entries.push({ ref: ref(h.id, i.id), personId, type: "credit", amount: mine, date, description: what, merchant: i.merchant, categoryName: i.category_name });
      const bill = round2(i.paid ?? mine);
      const note = typeof x.description === "string" && x.description.trim() ? x.description.trim() : null;
      expenses.push({
        ref: ref(h.id, i.id),
        amount: mine,
        bill: Math.max(bill, mine),
        date,
        time: typeof x.time === "string" && /^\d{2}:\d{2}/.test(x.time) ? x.time : "00:00:00",
        merchant: i.merchant,
        categoryName: i.category_name,
        ownCategory: typeof x.ownCategory === "string" ? x.ownCategory : null,
        description: note ? `${note} · paid by ${who}` : `Paid by ${who}`,
      });
    } else if (i.kind === "ledger" && x.to === h.my_member_id && (x.amount ?? 0) > 0) {
      // Their Hisaab with me, turned round: what they lent me I borrowed, and so on.
      //   their debit (they gave / I owe them)      → my credit
      //   their credit (I gave / they owe me)       → my debit
      //   their settlement (I paid them back)       → my debit
      const type = x.type === "debit" ? "credit" : "debit";
      const what = x.description?.trim() || x.merchant?.trim() || (x.type === "settlement" ? "Settle-up" : x.category?.trim() || "Entry");
      entries.push({
        ref: ref(h.id, i.id),
        personId,
        type,
        amount: round2(x.amount as number),
        date,
        description: what,
        merchant: x.merchant ?? null,
        categoryName: x.category ?? null,
      });
    } else if (i.kind === "settle" && (x.amount ?? 0) > 0) {
      const amount = round2(x.amount as number);
      if (x.payee === h.my_member_id && x.payer === i.member_id) {
        // They paid me back.
        entries.push({ ref: ref(h.id, i.id), personId, type: "settlement", amount, date, description: "Settle-up", merchant: null, categoryName: null });
      } else if (x.payer === h.my_member_id && x.payee === i.member_id) {
        // They recorded that I paid them.
        entries.push({ ref: ref(h.id, i.id), personId, type: "debit", amount, date, description: "Settle-up", merchant: null, categoryName: null });
      }
    }
  }

  let changed = false;
  const like = `${h.id}:%`;
  const resolve = await categoryResolver(h, userId);

  // Hisaab entries
  const haveEntries = await db.getAllAsync<{
    id: string;
    household_ref: string;
    hisaab_person_id: string;
    type: string;
    amount: number;
    date: string;
    description: string | null;
    merchant_name: string | null;
    category_id: string | null;
  }>(
    "SELECT id, household_ref, hisaab_person_id, type, amount, date, description, merchant_name, category_id FROM hisaab_entries WHERE household_ref LIKE ?;",
    like,
  );
  const entryByRef = new Map(haveEntries.map((e) => [e.household_ref, e]));
  for (const d of entries) {
    const have = entryByRef.get(d.ref);
    if (!have) {
      await db.runAsync(
        `INSERT INTO hisaab_entries (id, hisaab_person_id, amount, description, date, type, merchant_name, category_id, settlement_source, household_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?);`,
        generateUUID(),
        d.personId,
        d.amount,
        d.description,
        d.date,
        d.type,
        d.merchant,
        d.categoryName ? resolve(d.categoryName) : null,
        d.ref,
        new Date().toISOString(),
      );
      changed = true;
    } else if (
      have.amount !== d.amount ||
      have.date !== d.date ||
      have.type !== d.type ||
      have.hisaab_person_id !== d.personId ||
      have.description !== d.description ||
      have.merchant_name !== d.merchant ||
      (!have.category_id && !!d.categoryName && !!resolve(d.categoryName))
    ) {
      // The category is filled in when it had none; one you changed is left alone.
      await db.runAsync(
        `UPDATE hisaab_entries SET hisaab_person_id = ?, amount = ?, date = ?, type = ?, description = ?, merchant_name = ?,
           category_id = COALESCE(category_id, ?), updated_at = datetime('now') WHERE id = ?;`,
        d.personId,
        d.amount,
        d.date,
        d.type,
        d.description,
        d.merchant,
        d.categoryName ? resolve(d.categoryName) : null,
        have.id,
      );
      if (have.type !== d.type) await unlinkEntry(have.id);
      else if (have.amount !== d.amount) await followOwed(have.id, d.amount);
      changed = true;
    }
  }
  const wantEntry = new Set(entries.map((e) => e.ref));
  for (const e of haveEntries) {
    if (!wantEntry.has(e.household_ref)) {
      await unlinkEntry(e.id);
      await db.runAsync("DELETE FROM hisaab_entries WHERE id = ?;", e.id);
      changed = true;
    }
  }

  // My share of their bills, in my budget
  const haveExpenses = await db.getAllAsync<{
    id: string;
    household_ref: string;
    amount: number;
    split_original_amount: number | null;
    category_id: string | null;
    date: string;
    transaction_time: string | null;
    merchant_name: string | null;
    description: string | null;
  }>(
    "SELECT id, household_ref, amount, split_original_amount, category_id, date, transaction_time, merchant_name, description FROM expenses WHERE household_ref LIKE ?;",
    like,
  );
  const expenseByRef = new Map(haveExpenses.map((e) => [e.household_ref, e]));
  for (const d of expenses) {
    const have = expenseByRef.get(d.ref);
    if (!have) {
      await db.runAsync(
        `INSERT INTO expenses (id, user_id, amount, split_original_amount, split_pct, description, category_id, date, transaction_time,
           source, status, nature, merchant_name, household_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'approved', 'realized', ?, ?, datetime('now'), datetime('now'));`,
        generateUUID(),
        userId,
        d.amount,
        d.bill > d.amount ? d.bill : null,
        d.bill > d.amount ? Math.round((d.amount / d.bill) * 100) : null,
        d.description,
        resolve(d.categoryName, d.ownCategory),
        d.date,
        d.time,
        d.merchant,
        d.ref,
      );
      changed = true;
    } else if (
      have.amount !== d.amount ||
      (have.split_original_amount ?? have.amount) !== d.bill ||
      have.date.slice(0, 10) !== d.date ||
      (have.transaction_time ?? "00:00:00") !== d.time ||
      have.merchant_name !== d.merchant ||
      have.description !== d.description
    ) {
      // The category is left as it is: you may have changed it.
      await db.runAsync(
        `UPDATE expenses SET amount = ?, split_original_amount = ?, split_pct = ?, date = ?, transaction_time = ?, merchant_name = ?,
           description = ?, updated_at = datetime('now') WHERE id = ?;`,
        d.amount,
        d.bill > d.amount ? d.bill : null,
        d.bill > d.amount ? Math.round((d.amount / d.bill) * 100) : null,
        d.date,
        d.time,
        d.merchant,
        d.description,
        have.id,
      );
      changed = true;
    }
  }
  // Category: fill it in when it had none, and follow my choice for their category when I make one
  // ("map Pets to Family" re-files the bills that already came in). Otherwise leave yours alone.
  const chosen = await getTheirCategoryMap(h.id);
  for (const d of expenses) {
    const have = expenseByRef.get(d.ref);
    if (!have) continue;
    const explicit = [d.categoryName, d.ownCategory].some((n) => !!n && chosen.has(n.toLowerCase()));
    if (have.category_id && !explicit) continue;
    const want = resolve(d.categoryName, d.ownCategory);
    if (want && want !== have.category_id) {
      await db.runAsync("UPDATE expenses SET category_id = ?, updated_at = datetime('now') WHERE id = ?;", want, have.id);
      changed = true;
    }
  }

  const wantExpense = new Set(expenses.map((e) => e.ref));
  for (const e of haveExpenses) {
    if (!wantExpense.has(e.household_ref)) {
      await permanentlyDeleteExpense(e.id);
      changed = true;
    }
  }

  // Bills they say I paid: file each against my own transaction when it can only be one.
  if ((await autoFilePaidBills(h, userId)) > 0) changed = true;
  return changed;
}
