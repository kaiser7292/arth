import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { effectiveAmountSql } from "@/services/expense-effective-amount";
import { getComputedBalances } from "@/services/account-balance";
import { getSavingsTrend } from "@/services/savings-tracker";
import { getFYStartMonth } from "@/services/settings";
import { getCurrentFY } from "@/utils/fiscal-year";
import { toIsoDate } from "@/utils/date";
import { getPersonBalance, hisaabExcludeDeletedLinkSql } from "@/services/hisaab";
import { newId } from "./crypto";
import { getMemberLinks, sharedInfoFor } from "./shares";
import { refreshedGoalParts } from "./plans";
import {
  choicesOf,
  deleteItem,
  enqueue,
  getBalanceAccountIds,
  getCategoryMap,
  getHouseholdCategories,
  getItems,
  getMember,
  itemFromRow,
  updateHousehold,
  upsertItem,
} from "./store";
import type { Household, OpBody, SharedItem } from "./types";

/**
 * Works out what this phone shares with its household, compares it with what it already shared,
 * and queues the difference as ops. Design: docs/HOUSEHOLD_PHASE1_DESIGN.md §2.4 and §3.5.
 *
 * It recomputes from the database every time instead of hooking each place that writes an expense:
 * approving, editing, splitting, refunding, recategorising, deleting and restoring all show up the
 * same way, and nothing can be missed. 13 months of transactions is a few thousand rows at most.
 *
 * Shared, by the person's choices:
 *   household categories  each approved spend in a category mapped to a household category
 *   every transaction     each approved spend, personal ones too (not split)
 *   savings rate          per month, from the yearly plan, when there is one
 *   balances              the accounts ticked, current balance
 * Never: pending items, income, raw SMS, notes, account numbers.
 */

const MONTHS_SHARED = 13;
/** Items per op, to keep each op far under the relay's 64 KB. */
const ITEMS_PER_OP = 60;

const round2 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);

function firstShareDate(now: Date): string {
  return toIsoDate(new Date(now.getFullYear(), now.getMonth() - (MONTHS_SHARED - 1), 1));
}

interface SpendRow {
  id: string;
  date: string;
  category_id: string | null;
  category_name: string | null;
  merchant_name: string | null;
  description: string | null;
  transaction_time: string | null;
  gross: number;
  effective: number;
}

async function spendRows(userId: string, from: string): Promise<SpendRow[]> {
  return getDatabase().getAllAsync<SpendRow>(
    `SELECT e.id, e.date, e.category_id, c.name AS category_name, e.merchant_name, e.description, e.transaction_time,
            CASE WHEN e.split_original_amount > 0 THEN e.split_original_amount ELSE e.amount END AS gross,
            ${effectiveAmountSql("e")} AS effective
     FROM expenses e
     LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.user_id = ? AND e.status = 'approved' AND e.nature = 'realized' AND e.deleted_at IS NULL
       AND (e.reclassified_as_transfer IS NULL OR e.reclassified_as_transfer = 0)
       AND e.household_ref IS NULL
       AND e.date >= ?
       -- A bill someone else in the household recorded, filed here against what I paid: it's theirs
       -- to share, and it already is.
       AND NOT EXISTS (SELECT 1 FROM hisaab_entries hr WHERE hr.linked_expense_id = e.id AND hr.household_ref IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = e.id)
     ORDER BY e.date;`,
    userId,
    from,
  );
}

/** Everything this phone should be sharing right now, given the household's settings. */
export async function desiredItems(h: Household, userId: string = DEFAULT_USER_ID, now: Date = new Date()): Promise<{
  items: SharedItem[];
  localRefs: Map<string, string>;
}> {
  const choices = choicesOf(h);
  const items: SharedItem[] = [];
  const localRefs = new Map<string, string>(); // item id → expense / account id

  // Keep each expense's share id stable across runs, so edits update instead of re-adding.
  const mine = await getItems(h.id, h.my_member_id);
  const idByRef = new Map(mine.filter((r) => r.local_ref).map((r) => [r.local_ref as string, r.id]));
  const txId = (ref: string) => idByRef.get(ref) ?? newId();

  const from = firstShareDate(now);
  const rows = await spendRows(userId, from);

  // Shared transactions always go in full (that's what sharing one means), with who owes what;
  // the rest go in full only with "every transaction". (Monthly totals of personal spending were
  // dropped in 4.28.2: nobody could tell what they were for. Old "total" items are deleted below
  // like anything else this phone no longer shares.)
  const shared = await sharedInfoFor(h, rows.map((r) => r.id));
  const map = await getCategoryMap(h.id);
  const hcats = new Map((await getHouseholdCategories(h.id)).map((c) => [c.id, c.name]));
  for (const r of rows) {
    const info = shared.get(r.id);
    const hcatName = r.category_id ? hcats.get(map.get(r.category_id) ?? "") : undefined;
    if (info || choices.allTransactions) {
      const id = txId(r.id);
      localRefs.set(id, r.id);
      items.push({
        id,
        kind: "tx",
        month: r.date.slice(0, 7),
        date: r.date.slice(0, 10),
        paid: round2(r.gross),
        myShare: round2(r.effective),
        category: info ? (hcatName ?? r.category_name ?? "Uncategorized") : (r.category_name ?? "Uncategorized"),
        merchant: r.merchant_name,
        // A shared bill carries what the others need to record their share of it in full.
        extra: info
          ? {
              shared: 1,
              split: info.split,
              owes: info.owes,
              // Set when another member paid it (my split says so): the bill is theirs, I owe them.
              ...(info.paidBy ? { paidBy: info.paidBy } : {}),
              description: r.description?.trim() || null,
              time: r.transaction_time ?? null,
              // Their own category too, in case the household one doesn't match anything on the other phone.
              ownCategory: r.category_name ?? null,
            }
          : undefined,
      });
    }
  }

  // Settle-ups I recorded stay shared while their Hisaab entry exists.
  for (const s of mine.filter((r) => r.kind === "settle")) {
    const alive = s.local_ref
      ? await getDatabase().getFirstAsync<{ id: string }>("SELECT id FROM hisaab_entries WHERE id = ?;", s.local_ref)
      : null;
    if (alive) {
      items.push(itemFromRow(s));
      localRefs.set(s.id, s.local_ref as string);
    }
  }

  // Budgets, acceptances and goals I made stay as they are; my goal parts follow their bucket.
  for (const p of mine.filter((r) => r.kind === "budget" || r.kind === "budget_ok" || r.kind === "goal")) {
    items.push(itemFromRow(p));
  }
  for (const p of await refreshedGoalParts(h, mine)) {
    items.push(p);
    const ref = mine.find((r) => r.id === p.id)?.local_ref;
    if (ref) localRefs.set(p.id, ref);
  }

  // My whole Hisaab with each member, so their side of it matches: settle-ups, entries made by
  // hand, the opening balance, and splits older than the shared window. Left out: entries the
  // shared transactions above already carry (their "owes"), settle-ups shared as "settle" items,
  // and rows Together wrote from their side (household_ref) - those came from them.
  const covered = new Set(items.filter((i) => i.kind === "tx" && i.extra?.owes).map((i) => localRefs.get(i.id)).filter(Boolean) as string[]);
  const settleEntries = new Set(mine.filter((r) => r.kind === "settle" && r.local_ref).map((r) => r.local_ref as string));
  const ledgerIdByEntry = new Map(mine.filter((r) => r.kind === "ledger" && r.local_ref).map((r) => [r.local_ref as string, r.id]));
  for (const [memberId, personId] of await getMemberLinks(h.id)) {
    const person = await getDatabase().getFirstAsync<{ initial_balance: number; created_at: string }>(
      "SELECT initial_balance, created_at FROM hisaab_persons WHERE id = ?;",
      personId,
    );
    if (person && Math.abs(person.initial_balance ?? 0) > 0.005) {
      items.push({
        id: `opening:${memberId}`,
        kind: "ledger",
        date: person.created_at.slice(0, 10),
        extra: { to: memberId, type: person.initial_balance > 0 ? "debit" : "credit", amount: round2(Math.abs(person.initial_balance)), description: "Opening balance" },
      });
    }
    // With what the entry was for, so the other phone shows more than an amount.
    const entries = await getDatabase().getAllAsync<{
      id: string;
      type: string;
      amount: number;
      date: string;
      description: string | null;
      linked_expense_id: string | null;
      merchant: string | null;
      category: string | null;
    }>(
      `SELECT e.id, e.type, e.amount, e.date, e.description, e.linked_expense_id,
              COALESCE(x.merchant_name, e.merchant_name) AS merchant, COALESCE(xc.name, ec.name) AS category
       FROM hisaab_entries e
       LEFT JOIN expenses x ON x.id = e.linked_expense_id
       LEFT JOIN categories xc ON xc.id = x.category_id
       LEFT JOIN categories ec ON ec.id = e.category_id
       WHERE e.hisaab_person_id = ? AND e.household_ref IS NULL AND ${hisaabExcludeDeletedLinkSql("e")};`,
      personId,
    );
    for (const e of entries) {
      if (settleEntries.has(e.id)) continue;
      if ((e.type === "debit" || e.type === "credit") && e.linked_expense_id && covered.has(e.linked_expense_id)) continue;
      const id = ledgerIdByEntry.get(e.id) ?? `ledger:${newId()}`;
      localRefs.set(id, e.id);
      items.push({
        id,
        kind: "ledger",
        date: e.date.slice(0, 10),
        month: e.date.slice(0, 7),
        extra: {
          to: memberId,
          type: e.type,
          amount: round2(e.amount),
          description: e.description ?? null,
          ...(e.merchant ? { merchant: e.merchant } : {}),
          ...(e.category ? { category: e.category } : {}),
        },
      });
    }
    // My balance with them, so their phone can show whether both agree.
    items.push({ id: `net:${memberId}`, kind: "net", extra: { balance: round2(await getPersonBalance(personId)) } });
  }

  if (choices.savingsRate) {
    const startMonth = getFYStartMonth();
    const fy = getCurrentFY(startMonth, now);
    for (const year of [fy - 1, fy]) {
      const trend = await getSavingsTrend(userId, year).catch(() => null);
      for (const m of trend ?? []) {
        if (!m.income) continue;
        const cal = ((startMonth - 1 + m.fiscalMonth - 1) % 12) + 1;
        const calYear = year + (startMonth - 1 + m.fiscalMonth - 1 >= 12 ? 1 : 0);
        const month = `${calYear}-${String(cal).padStart(2, "0")}`;
        if (month < from.slice(0, 7)) continue;
        items.push({ id: `savings:${month}`, kind: "savings", month, extra: { rate: Math.round(m.savingsRatePct) } });
      }
    }
  }

  if (choices.balances) {
    const ids = await getBalanceAccountIds(h.id);
    if (ids.length) {
      const balances = await getComputedBalances(ids).catch(() => ({}) as Record<string, number | null>);
      // A label or bank name only: never the account number.
      const accounts = await getDatabase().getAllAsync<{ id: string; name: string; account_type: string }>(
        `SELECT id, COALESCE(NULLIF(account_label, ''), bank_name) AS name, account_type
         FROM financial_accounts WHERE id IN (${ids.map(() => "?").join(",")});`,
        ...ids,
      );
      for (const a of accounts) {
        const bal = balances[a.id];
        if (bal == null) continue;
        const id = `balance:${a.id}`;
        localRefs.set(id, a.id);
        items.push({ id, kind: "balance", paid: round2(bal), extra: { label: a.name, type: a.account_type, asOf: toIsoDate(now) } });
      }
    }
  }

  return { items, localRefs };
}

const sameItem = (a: SharedItem, b: SharedItem) =>
  JSON.stringify([a.kind, a.month ?? null, a.date ?? null, a.paid ?? null, a.myShare ?? null, a.category ?? null, a.merchant ?? null, a.extra ?? null]) ===
  JSON.stringify([b.kind, b.month ?? null, b.date ?? null, b.paid ?? null, b.myShare ?? null, b.category ?? null, b.merchant ?? null, b.extra ?? null]);

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Brings what the household has from this phone up to date. With needs_snapshot set (just joined,
 * settings changed, someone new joined, or someone asked) it re-sends everything, wrapped in
 * snapshot.begin / snapshot.end so the others replace this member's items wholesale.
 * Returns how many ops it queued.
 */
export async function publish(h: Household, userId: string = DEFAULT_USER_ID, now: Date = new Date()): Promise<number> {
  const { items, localRefs } = await desiredItems(h, userId, now);
  const current = await getItems(h.id, h.my_member_id);
  const currentById = new Map(current.map((r) => [r.id, itemFromRow(r)]));
  const bodies: OpBody[] = [];
  const db = getDatabase();

  if (h.needs_snapshot) {
    const me = await getMember(h.id, h.my_member_id);
    if (me) bodies.push({ kind: "member.profile", name: me.name, colour: me.colour });
    bodies.push({ kind: "member.settings", choices: choicesOf(h) });
    bodies.push({ kind: "snapshot.begin" });
    for (const part of chunk(items, ITEMS_PER_OP)) bodies.push({ kind: "items.upsert", items: part });
    bodies.push({ kind: "snapshot.end" });
    await db.withTransactionAsync(async () => {
      await db.runAsync("DELETE FROM household_items WHERE household_id = ? AND member_id = ?;", h.id, h.my_member_id);
      for (const it of items) await upsertItem(h.id, h.my_member_id, it, localRefs.get(it.id) ?? null);
      await enqueue(h.id, bodies);
      await updateHousehold(h.id, { needs_snapshot: 0 });
    });
    return bodies.length;
  }

  const changed = items.filter((it) => {
    const prev = currentById.get(it.id);
    return !prev || !sameItem(prev, it);
  });
  const desiredIds = new Set(items.map((i) => i.id));
  const gone = current.filter((r) => !desiredIds.has(r.id)).map((r) => r.id);
  if (changed.length === 0 && gone.length === 0) return 0;

  for (const part of chunk(changed, ITEMS_PER_OP)) bodies.push({ kind: "items.upsert", items: part });
  for (const part of chunk(gone, ITEMS_PER_OP * 4)) bodies.push({ kind: "items.delete", ids: part });
  await db.withTransactionAsync(async () => {
    for (const it of changed) await upsertItem(h.id, h.my_member_id, it, localRefs.get(it.id) ?? null);
    for (const id of gone) await deleteItem(h.id, h.my_member_id, id);
    await enqueue(h.id, bodies);
  });
  return bodies.length;
}

/** "Others will see" on the sharing screen: this month, with the given choices, nothing sent. */
export async function previewThisMonth(
  h: Household,
  userId: string = DEFAULT_USER_ID,
  now: Date = new Date(),
): Promise<{ category: string; amount: number; detail: "each" | "total" }[]> {
  const { items } = await desiredItems(h, userId, now);
  const month = toIsoDate(now).slice(0, 7);
  const byCat = new Map<string, { amount: number; detail: "each" | "total" }>();
  for (const it of items) {
    if (it.month !== month || (it.kind !== "tx" && it.kind !== "total") || !it.category) continue;
    const prev = byCat.get(it.category) ?? { amount: 0, detail: it.kind === "tx" ? ("each" as const) : ("total" as const) };
    prev.amount += it.myShare ?? 0;
    byCat.set(it.category, prev);
  }
  return [...byCat.entries()]
    .map(([category, v]) => ({ category, amount: Math.round(v.amount), detail: v.detail }))
    .sort((a, b) => b.amount - a.amount);
}
