import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { createPerson } from "@/services/hisaab";
import { newId } from "./crypto";
import { autoMapCategories, enqueue, getCategoryMap, getHouseholdCategories, getMembers, setHouseholdCategories } from "./store";
import { DEFAULT_HOUSEHOLD_CATEGORIES, type Household, type HouseholdMember } from "./types";

/**
 * Shared or personal, per transaction (Together rework). Design: docs/HOUSEHOLD_PHASE1_DESIGN.md,
 * "Shared transactions and Hisaab".
 *
 * One split, in one place (4.28.2). Splitting a bill with someone in the household is Arth's
 * ordinary split, made by hand on the transaction; it's a shared bill on both phones. Separately,
 * whether the household *sees* a transaction that isn't split:
 *
 *   default    my approved spend in a category that counts as household spending, made after I
 *              joined, is shown (not split) - unless I said "personal" for it
 *   my choice  household_expense_shares.shared: shown or personal. (split / my_pct are left over
 *              from 4.28, when this module also split bills; they're no longer read.)
 *
 * Nothing here adds or removes a split. In 4.28 it did, and a split removed by hand came straight
 * back on the next sync.
 */

export type SplitKind = "equal" | "payer_all" | "custom";

export interface ShareChoice {
  shared: boolean;
  split: SplitKind;
  myPct: number | null;
}

// ─── Member ↔ Hisaab person ───

/** member id → Hisaab person id, for this household. */
export async function getMemberLinks(householdId: string): Promise<Map<string, string>> {
  const rows = await getDatabase().getAllAsync<{ member_id: string; hisaab_person_id: string }>(
    `SELECT l.member_id, l.hisaab_person_id FROM household_member_links l
     JOIN hisaab_persons p ON p.id = l.hisaab_person_id AND p.is_active = 1
     WHERE l.household_id = ?;`,
    householdId,
  );
  return new Map(rows.map((r) => [r.member_id, r.hisaab_person_id]));
}

export async function linkMember(householdId: string, memberId: string, personId: string): Promise<void> {
  await getDatabase().runAsync(
    `INSERT INTO household_member_links (household_id, member_id, hisaab_person_id) VALUES (?, ?, ?)
     ON CONFLICT (household_id, member_id) DO UPDATE SET hisaab_person_id = excluded.hisaab_person_id;`,
    householdId,
    memberId,
    personId,
  );
}

export interface LinkSuggestion {
  member: HouseholdMember;
  person: { id: string; name: string };
}

/**
 * Members not linked to a Hisaab person yet. Where exactly one existing Hisaab person has the same
 * name, it's a question for the person ("Is your Hisaab 'Aastha' the same Aastha?"); otherwise a new
 * Hisaab person is created and linked straight away.
 */
export async function ensureMemberLinks(h: Household): Promise<LinkSuggestion[]> {
  const db = getDatabase();
  const links = await getMemberLinks(h.id);
  const suggestions: LinkSuggestion[] = [];
  for (const m of await getMembers(h.id)) {
    if (m.id === h.my_member_id || links.has(m.id)) continue;
    const same = await db.getAllAsync<{ id: string; name: string }>(
      `SELECT id, name FROM hisaab_persons WHERE is_active = 1 AND LOWER(TRIM(name)) = LOWER(TRIM(?))
         AND id NOT IN (SELECT hisaab_person_id FROM household_member_links);`,
      m.name,
    );
    if (same.length === 1) {
      suggestions.push({ member: m, person: same[0] });
    } else {
      const personId = await createPerson({ owner_user_id: DEFAULT_USER_ID, name: same.length ? `${m.name} (${h.name})` : m.name });
      await linkMember(h.id, m.id, personId);
    }
  }
  return suggestions;
}

/** "Keep separate": a new Hisaab person for this member. */
export async function linkMemberToNewPerson(h: Household, member: HouseholdMember): Promise<void> {
  const personId = await createPerson({ owner_user_id: DEFAULT_USER_ID, name: `${member.name} (${h.name})` });
  await linkMember(h.id, member.id, personId);
}

// ─── Choices ───

export async function getShareChoice(expenseId: string): Promise<ShareChoice | null> {
  const row = await getDatabase().getFirstAsync<{ shared: number; split: SplitKind; my_pct: number | null }>(
    "SELECT shared, split, my_pct FROM household_expense_shares WHERE expense_id = ?;",
    expenseId,
  );
  return row ? { shared: !!row.shared, split: row.split, myPct: row.my_pct } : null;
}

async function writeChoice(householdId: string, expenseId: string, c: ShareChoice): Promise<void> {
  await getDatabase().runAsync(
    `INSERT INTO household_expense_shares (expense_id, household_id, shared, split, my_pct, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (expense_id) DO UPDATE SET shared = excluded.shared, split = excluded.split,
       my_pct = excluded.my_pct, updated_at = excluded.updated_at;`,
    expenseId,
    householdId,
    c.shared ? 1 : 0,
    c.split,
    c.myPct,
  );
}

/** Whether spends in this category are shared by default (mapped to a household category marked so). */
export async function isHouseholdCategory(h: Household, categoryId: string | null): Promise<boolean> {
  if (!categoryId) return false;
  const map = await getCategoryMap(h.id);
  const id = map.get(categoryId);
  return !!id && (await getHouseholdCategories(h.id)).some((c) => c.id === id && !!c.shared_default);
}

const catKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Keeps the household's list holding all of Arth's default categories (so everyone's defaults map
 * by name), adding any missing as not shared by default. Only the phone of whoever started the
 * household changes the list; everyone maps their own categories onto it.
 */
export async function ensureHouseholdCategories(h: Household, userId: string = DEFAULT_USER_ID): Promise<boolean> {
  let changed = false;
  if (h.role === "creator") {
    const have = await getHouseholdCategories(h.id);
    const missing = DEFAULT_HOUSEHOLD_CATEGORIES.filter((n) => !have.some((c) => catKey(c.name) === catKey(n)));
    if (missing.length) {
      const list = [
        ...have.map((c) => ({ id: c.id, name: c.name, shared: !!c.shared_default })),
        ...missing.map((n) => ({ id: newId(), name: n, shared: false })),
      ];
      await setHouseholdCategories(h.id, list);
      await enqueue(h.id, [{ kind: "household.categories", categories: list }]);
      changed = true;
    }
  }
  await autoMapCategories(h.id, userId);
  return changed;
}

/**
 * What the "Shared with Home" switch shows for a transaction, before or after approval: the choice
 * made for it, or the default.
 */
export async function effectiveChoice(h: Household, expenseId: string, categoryId: string | null): Promise<ShareChoice> {
  const made = await getShareChoice(expenseId);
  if (made) return made;
  return { shared: h.share_household_categories ? await isHouseholdCategory(h, categoryId) : false, split: "equal", myPct: null };
}

/**
 * Records whether the household sees this transaction (Catch Up, the transaction screen). Only that:
 * splitting is done with Arth's ordinary split, in one place, and a choice here never adds or removes
 * one (in 4.28 both did, and each undid the other on the next sync).
 */
export async function setShareChoice(h: Household, expenseId: string, c: ShareChoice): Promise<void> {
  await writeChoice(h.id, expenseId, c);
}

/** Run by every sync: forgets choices for transactions that no longer exist. Never splits anything. */
export async function applyPendingShares(_h: Household, _userId: string = DEFAULT_USER_ID): Promise<number> {
  await getDatabase().runAsync("DELETE FROM household_expense_shares WHERE expense_id NOT IN (SELECT id FROM expenses);");
  return 0;
}

/**
 * How each of my transactions is shared: who owes what. Normally I paid and the others owe me
 * (their "debit" entries). When my split says another member paid ("Sourav paid, I owe him"), the
 * bill goes out as theirs - paidBy - with what I owe, so their phone can file it against the account
 * it came from. Rows Together wrote from someone else's side (household_ref) never count: those
 * came from them.
 */
export async function sharedInfoFor(
  h: Household,
  expenseIds: string[],
): Promise<Map<string, { split: SplitKind; owes: Record<string, number>; paidBy?: string }>> {
  const out = new Map<string, { split: SplitKind; owes: Record<string, number>; paidBy?: string }>();
  if (expenseIds.length === 0) return out;
  const db = getDatabase();
  const links = await getMemberLinks(h.id);
  const memberByPerson = new Map([...links.entries()].map(([m, p]) => [p, m]));
  const ph = expenseIds.map(() => "?").join(",");
  const choices = await db.getAllAsync<{ expense_id: string; shared: number; split: SplitKind }>(
    `SELECT expense_id, shared, split FROM household_expense_shares WHERE expense_id IN (${ph});`,
    ...expenseIds,
  );
  const choiceById = new Map(choices.map((c) => [c.expense_id, c]));
  if (memberByPerson.size) {
    const entries = await db.getAllAsync<{ linked_expense_id: string; hisaab_person_id: string; amount: number }>(
      `SELECT linked_expense_id, hisaab_person_id, amount FROM hisaab_entries
       WHERE type = 'debit' AND household_ref IS NULL AND linked_expense_id IN (${ph})
         AND hisaab_person_id IN (${[...memberByPerson.keys()].map(() => "?").join(",")});`,
      ...expenseIds,
      ...memberByPerson.keys(),
    );
    for (const en of entries) {
      const memberId = memberByPerson.get(en.hisaab_person_id);
      if (!memberId) continue;
      const cur = out.get(en.linked_expense_id) ?? { split: (choiceById.get(en.linked_expense_id)?.split ?? "equal") as SplitKind, owes: {} };
      cur.owes[memberId] = Math.round(((cur.owes[memberId] ?? 0) + en.amount) * 100) / 100;
      out.set(en.linked_expense_id, cur);
    }
    // Paid by someone else in the household: one "credit" entry on my bill.
    const paidByOthers = await db.getAllAsync<{ linked_expense_id: string; hisaab_person_id: string; amount: number }>(
      `SELECT linked_expense_id, hisaab_person_id, amount FROM hisaab_entries
       WHERE type = 'credit' AND household_ref IS NULL AND linked_expense_id IN (${ph})
         AND hisaab_person_id IN (${[...memberByPerson.keys()].map(() => "?").join(",")});`,
      ...expenseIds,
      ...memberByPerson.keys(),
    );
    for (const en of paidByOthers) {
      const memberId = memberByPerson.get(en.hisaab_person_id);
      if (!memberId || out.has(en.linked_expense_id) || en.amount <= 0) continue;
      out.set(en.linked_expense_id, { split: "custom", owes: { [h.my_member_id]: Math.round(en.amount * 100) / 100 }, paidBy: memberId });
    }
  }
  // Split with a member: always shared (it's a shared bill, and it's in both Hisaabs). Otherwise my
  // choice, or by default a spend in a household category since I joined - shown, not split.
  const visibleByDefault = new Set<string>();
  if (h.share_household_categories) {
    const map = await getCategoryMap(h.id);
    const sharedIds = new Set((await getHouseholdCategories(h.id)).filter((c) => c.shared_default).map((c) => c.id));
    const since = (h.joined_at ?? h.created_at).slice(0, 10);
    const rows = await db.getAllAsync<{ id: string; category_id: string | null; date: string }>(
      `SELECT id, category_id, date FROM expenses WHERE id IN (${ph});`,
      ...expenseIds,
    );
    for (const r of rows) {
      const hc = r.category_id ? map.get(r.category_id) : undefined;
      if (hc && sharedIds.has(hc) && r.date.slice(0, 10) >= since) visibleByDefault.add(r.id);
    }
  }
  for (const id of expenseIds) {
    if (out.has(id)) continue;
    const c = choiceById.get(id);
    if (c ? !!c.shared : visibleByDefault.has(id)) out.set(id, { split: "payer_all", owes: {} });
  }
  return out;
}

/**
 * This transaction's split with a household member, said in words: another member paid it ("Sourav
 * paid · you owe him ₹3,737"), another member recorded it as paid by me ("Aastha owes you ₹3,737"),
 * or I split it with them. Null when it isn't split with anyone in the household.
 */
export async function fixedSplitNote(h: Household, expenseId: string): Promise<string | null> {
  const links = await getMemberLinks(h.id);
  if (links.size === 0) return null;
  const nameByPerson = new Map<string, string>();
  for (const m of await getMembers(h.id)) {
    const p = links.get(m.id);
    if (p) nameByPerson.set(p, m.name);
  }
  const rows = await getDatabase().getAllAsync<{ type: string; amount: number; household_ref: string | null; hisaab_person_id: string }>(
    "SELECT type, amount, household_ref, hisaab_person_id FROM hisaab_entries WHERE linked_expense_id = ?;",
    expenseId,
  );
  for (const r of rows) {
    const who = nameByPerson.get(r.hisaab_person_id);
    if (!who) continue;
    const amount = `₹${Math.round(r.amount).toLocaleString("en-IN")}`;
    if (r.household_ref) return `${who} recorded this bill as paid by you. ${who} owes you ${amount}, on both phones.`;
    if (r.type === "credit") return `${who} paid this. You owe ${who} ${amount}, and it shows as ${who}'s bill to the household.`;
    if (r.type === "debit") return `Split with ${who}: ${who} owes you ${amount}, on both phones. Change or remove it from the split above.`;
  }
  return null;
}

/** Leaving / removed: the splits stay (they're real money between people); only the links go. */
export async function detachHouseholdLinks(householdId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync("DELETE FROM household_expense_shares WHERE household_id = ?;", householdId);
  await db.runAsync("DELETE FROM household_member_links WHERE household_id = ?;", householdId);
  await db.runAsync("UPDATE hisaab_entries SET household_ref = NULL WHERE household_ref LIKE ?;", `${householdId}:%`);
  await db.runAsync("UPDATE expenses SET household_ref = NULL WHERE household_ref LIKE ?;", `${householdId}:%`);
}
