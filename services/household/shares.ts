import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { createPerson } from "@/services/hisaab";
import { getExpenseById } from "@/services/expense-queries";
import { removeSplit, splitExistingExpense } from "@/services/expense-splits";
import { applyMultiSplit, removeMultiSplit } from "@/services/expense-multi-split";
import { getCategoryMap, getHouseholdCategories, getMembers } from "./store";
import type { Household, HouseholdMember } from "./types";

/**
 * Shared or personal, per transaction (Together rework). Design: docs/HOUSEHOLD_PHASE1_DESIGN.md,
 * "Shared transactions and Hisaab".
 *
 * A shared transaction is split with the others in the household using Arth's ordinary split: the
 * same expense_splits / hisaab entries a split by hand makes. So budgets count my share, Insights
 * show others' share, and my Hisaab with each member is right without anything new.
 *
 *   default    my approved spend in a category that counts as household spending, made after I
 *              joined, is shared and split equally - unless I said "personal" for it
 *   my choice  household_expense_shares: shared or personal, and the split ("equal", "payer_all" =
 *              I pay all and it's just shown to the household, "custom" = my_pct is my share)
 *
 * Splits this module applies are marked by a choice row (shared = 1), so turning one personal again
 * removes that split; a split made by hand (no row) is left alone.
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

/** Whether this category counts as household spending (mapped to a household category). */
export async function isHouseholdCategory(h: Household, categoryId: string | null): Promise<boolean> {
  if (!categoryId) return false;
  const map = await getCategoryMap(h.id);
  const id = map.get(categoryId);
  return !!id && (await getHouseholdCategories(h.id)).some((c) => c.id === id);
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
 * Records the choice (from Catch Up or the transaction screen) and, for an approved transaction,
 * applies or removes the split right away.
 */
export async function setShareChoice(h: Household, expenseId: string, c: ShareChoice): Promise<void> {
  await writeChoice(h.id, expenseId, c);
  const e = await getExpenseById(expenseId);
  if (e?.status === "approved") await applyChoice(h, expenseId, c);
}

/** The others in the household this phone can split with (members linked to a Hisaab person). */
async function splitTargets(h: Household): Promise<{ memberId: string; personId: string }[] | null> {
  const others = (await getMembers(h.id)).filter((m) => m.id !== h.my_member_id);
  if (others.length === 0) return null;
  const links = await getMemberLinks(h.id);
  const out = others.map((m) => ({ memberId: m.id, personId: links.get(m.id) ?? "" }));
  // Everyone must be linked first, or the split would leave someone out.
  return out.every((o) => o.personId) ? out : null;
}

async function householdSplitPersons(expenseId: string, personIds: string[]): Promise<boolean> {
  if (personIds.length === 0) return false;
  const row = await getDatabase().getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM hisaab_entries WHERE linked_expense_id = ? AND type = 'debit'
       AND hisaab_person_id IN (${personIds.map(() => "?").join(",")});`,
    expenseId,
    ...personIds,
  );
  return (row?.n ?? 0) > 0;
}

/** Applies a choice to an approved expense: split it with the household, or take that split away. */
async function applyChoice(h: Household, expenseId: string, c: ShareChoice): Promise<void> {
  const e = await getExpenseById(expenseId);
  if (!e || e.status !== "approved" || e.nature !== "realized" || e.deleted_at) return;
  const targets = await splitTargets(h);
  const personIds = targets?.map((t) => t.personId) ?? [];
  const alreadyHousehold = await householdSplitPersons(expenseId, personIds);

  const wantSplit = c.shared && c.split !== "payer_all";
  if (!wantSplit) {
    if (alreadyHousehold) {
      if (e.split_hisaab_entry_id) await removeSplit(expenseId);
      else await removeMultiSplit(expenseId);
    }
    return;
  }
  if (!targets) return;
  // A split made by hand with someone outside the household: leave it.
  if ((e.split_hisaab_entry_id || e.split_original_amount) && !alreadyHousehold) return;

  const total = e.split_original_amount ?? e.amount;
  const myPct = c.split === "custom" && c.myPct != null ? Math.max(0, Math.min(100, c.myPct)) : 100 / (targets.length + 1);
  if (targets.length === 1) {
    await splitExistingExpense(
      expenseId,
      c.split === "custom"
        ? { paidBy: "me", splitMode: "percentage", personId: targets[0].personId, percentage: Math.round((100 - myPct) * 100) / 100 }
        : { paidBy: "me", splitMode: "equal", personId: targets[0].personId },
      { skipAutoApprove: true },
    );
  } else {
    const each = Math.round(((total * (100 - myPct)) / 100 / targets.length) * 100) / 100;
    await applyMultiSplit(expenseId, {
      feeAbsorbed: true,
      splits: targets.map((t) => ({ personId: t.personId, description: e.description ?? e.merchant_name ?? "Shared", amount: each })),
    });
  }
}

/**
 * Applies the default and any choices not applied yet: run by every sync, before anything goes
 * out, so a transaction approved anywhere (Catch Up, bulk, edit) is shared the same way.
 */
export async function applyPendingShares(h: Household, userId: string = DEFAULT_USER_ID): Promise<number> {
  const db = getDatabase();
  const targets = await splitTargets(h);
  if (!targets) return 0;
  // Forget choices for expenses that no longer exist.
  await db.runAsync("DELETE FROM household_expense_shares WHERE expense_id NOT IN (SELECT id FROM expenses);");

  const since = (h.joined_at ?? h.created_at).slice(0, 10);
  const map = await getCategoryMap(h.id);
  const householdCats = [...new Set(map.keys())];
  const personIds = targets.map((t) => t.personId);
  const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");

  // Candidates: approved spends with a choice to share, or (by default) in a household category
  // since joining, that aren't split with the household yet and have no other split.
  const rows = await db.getAllAsync<{ id: string; choice_shared: number | null }>(
    `SELECT e.id, s.shared AS choice_shared FROM expenses e
     LEFT JOIN household_expense_shares s ON s.expense_id = e.id
     WHERE e.user_id = ? AND e.status = 'approved' AND e.nature = 'realized' AND e.deleted_at IS NULL
       AND e.household_ref IS NULL
       AND (e.reclassified_as_transfer IS NULL OR e.reclassified_as_transfer = 0)
       AND e.split_original_amount IS NULL
       AND NOT EXISTS (SELECT 1 FROM expense_splits x WHERE x.expense_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM hisaab_entries he WHERE he.linked_expense_id = e.id AND he.type = 'debit'
                       AND he.hisaab_person_id IN (${ph(personIds.length)}))
       AND (
         (s.shared = 1 AND s.split != 'payer_all')
         OR (s.expense_id IS NULL AND ? = 1 AND e.date >= ?
             AND e.category_id IN (${householdCats.length ? ph(householdCats.length) : "NULL"}))
       )
     LIMIT 200;`,
    userId,
    ...personIds,
    h.share_household_categories ? 1 : 0,
    since,
    ...householdCats,
  );
  for (const r of rows) {
    const choice: ShareChoice = r.choice_shared != null ? ((await getShareChoice(r.id)) as ShareChoice) : { shared: true, split: "equal", myPct: null };
    if (r.choice_shared == null) await writeChoice(h.id, r.id, choice);
    await applyChoice(h, r.id, choice);
  }
  return rows.length;
}

/**
 * For my transaction: is it shared, and what does each other member owe for it. Shared = split with
 * household members (by Together or by hand), or marked shared with "I pay all".
 */
export async function sharedInfoFor(h: Household, expenseIds: string[]): Promise<Map<string, { split: SplitKind; owes: Record<string, number> }>> {
  const out = new Map<string, { split: SplitKind; owes: Record<string, number> }>();
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
       WHERE type = 'debit' AND linked_expense_id IN (${ph})
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
  }
  for (const c of choices) {
    if (c.shared && c.split === "payer_all" && !out.has(c.expense_id)) out.set(c.expense_id, { split: "payer_all", owes: {} });
  }
  return out;
}

/** Leaving / removed: the splits stay (they're real money between people); only the links go. */
export async function detachHouseholdLinks(householdId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync("DELETE FROM household_expense_shares WHERE household_id = ?;", householdId);
  await db.runAsync("DELETE FROM household_member_links WHERE household_id = ?;", householdId);
  await db.runAsync("UPDATE hisaab_entries SET household_ref = NULL WHERE household_ref LIKE ?;", `${householdId}:%`);
  await db.runAsync("UPDATE expenses SET household_ref = NULL WHERE household_ref LIKE ?;", `${householdId}:%`);
}
