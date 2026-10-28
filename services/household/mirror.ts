import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { permanentlyDeleteExpense } from "@/services/expense-crud";
import { generateUUID } from "@/utils/uuid";
import { getMemberLinks } from "./shares";
import { getCategoryMap, getHouseholdCategories, getItems, getMembers } from "./store";
import type { Household, HouseholdItem } from "./types";

/**
 * What this phone writes by itself from what the others shared, so both phones tell the same story
 * (Together rework):
 *
 *   their shared bill, my part   → Hisaab: "credit" on them (they paid for me), and an expense for my
 *                                  share ("Paid by Aastha"), so my budget counts what I consumed
 *   their settle-up to me        → Hisaab: "settlement" on them (they paid me back)
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
}

const extraOf = (i: HouseholdItem): Extra => {
  try {
    return i.payload_json ? (JSON.parse(i.payload_json) as Extra) : {};
  } catch {
    return {};
  }
};

/** Their category (a household category name, or their own) → one of mine. */
async function categoryResolver(h: Household, userId: string): Promise<(name: string | null) => string | null> {
  const db = getDatabase();
  const hcats = await getHouseholdCategories(h.id);
  const map = await getCategoryMap(h.id);
  const mine = await db.getAllAsync<{ id: string; name: string }>(
    "SELECT id, name FROM categories WHERE user_id = ? AND is_active = 1 ORDER BY sort_order;",
    userId,
  );
  return (name) => {
    if (!name) return null;
    const n = name.trim().toLowerCase();
    const hc = hcats.find((c) => c.name.trim().toLowerCase() === n);
    if (hc) {
      const local = [...map.entries()].find(([, v]) => v === hc.id)?.[0];
      if (local) return local;
    }
    return mine.find((c) => c.name.trim().toLowerCase() === n)?.id ?? null;
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
}

interface DesiredExpense {
  ref: string;
  amount: number;
  date: string;
  merchant: string | null;
  categoryName: string | null;
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
    if (i.kind === "tx") {
      const mine = round2(x.owes?.[h.my_member_id] ?? 0);
      if (mine <= 0) continue;
      const what = i.merchant || i.category_name || "Shared";
      entries.push({ ref: ref(h.id, i.id), personId, type: "credit", amount: mine, date, description: `${what}, your share`, merchant: i.merchant });
      expenses.push({ ref: ref(h.id, i.id), amount: mine, date, merchant: i.merchant, categoryName: i.category_name, description: `Paid by ${who}` });
    } else if (i.kind === "settle" && (x.amount ?? 0) > 0) {
      const amount = round2(x.amount as number);
      if (x.payee === h.my_member_id && x.payer === i.member_id) {
        // They paid me back.
        entries.push({ ref: ref(h.id, i.id), personId, type: "settlement", amount, date, description: `Settle-up from ${who}`, merchant: null });
      } else if (x.payer === h.my_member_id && x.payee === i.member_id) {
        // They recorded that I paid them.
        entries.push({ ref: ref(h.id, i.id), personId, type: "debit", amount, date, description: `Settle-up to ${who}`, merchant: null });
      }
    }
  }

  let changed = false;
  const like = `${h.id}:%`;

  // Hisaab entries
  const haveEntries = await db.getAllAsync<{ id: string; household_ref: string; hisaab_person_id: string; type: string; amount: number; date: string; description: string | null }>(
    "SELECT id, household_ref, hisaab_person_id, type, amount, date, description FROM hisaab_entries WHERE household_ref LIKE ?;",
    like,
  );
  const entryByRef = new Map(haveEntries.map((e) => [e.household_ref, e]));
  for (const d of entries) {
    const have = entryByRef.get(d.ref);
    if (!have) {
      await db.runAsync(
        `INSERT INTO hisaab_entries (id, hisaab_person_id, amount, description, date, type, merchant_name, settlement_source, household_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'created', ?, ?);`,
        generateUUID(),
        d.personId,
        d.amount,
        d.description,
        d.date,
        d.type,
        d.merchant,
        d.ref,
        new Date().toISOString(),
      );
      changed = true;
    } else if (have.amount !== d.amount || have.date !== d.date || have.type !== d.type || have.hisaab_person_id !== d.personId || have.description !== d.description) {
      await db.runAsync(
        "UPDATE hisaab_entries SET hisaab_person_id = ?, amount = ?, date = ?, type = ?, description = ?, updated_at = datetime('now') WHERE id = ?;",
        d.personId,
        d.amount,
        d.date,
        d.type,
        d.description,
        have.id,
      );
      changed = true;
    }
  }
  const wantEntry = new Set(entries.map((e) => e.ref));
  for (const e of haveEntries) {
    if (!wantEntry.has(e.household_ref)) {
      await db.runAsync("DELETE FROM hisaab_entries WHERE id = ?;", e.id);
      changed = true;
    }
  }

  // My share of their bills, in my budget
  const resolve = await categoryResolver(h, userId);
  const haveExpenses = await db.getAllAsync<{ id: string; household_ref: string; amount: number; date: string; merchant_name: string | null; description: string | null }>(
    "SELECT id, household_ref, amount, date, merchant_name, description FROM expenses WHERE household_ref LIKE ?;",
    like,
  );
  const expenseByRef = new Map(haveExpenses.map((e) => [e.household_ref, e]));
  for (const d of expenses) {
    const have = expenseByRef.get(d.ref);
    if (!have) {
      await db.runAsync(
        `INSERT INTO expenses (id, user_id, amount, description, category_id, date, source, status, nature, merchant_name, household_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'manual', 'approved', 'realized', ?, ?, datetime('now'), datetime('now'));`,
        generateUUID(),
        userId,
        d.amount,
        d.description,
        resolve(d.categoryName),
        d.date,
        d.merchant,
        d.ref,
      );
      changed = true;
    } else if (have.amount !== d.amount || have.date.slice(0, 10) !== d.date || have.merchant_name !== d.merchant || have.description !== d.description) {
      // The category is left as it is: you may have changed it.
      await db.runAsync(
        "UPDATE expenses SET amount = ?, date = ?, merchant_name = ?, description = ?, updated_at = datetime('now') WHERE id = ?;",
        d.amount,
        d.date,
        d.merchant,
        d.description,
        have.id,
      );
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
  return changed;
}
