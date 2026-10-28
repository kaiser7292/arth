import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { effectiveAmountSql } from "@/services/expense-effective-amount";
import { getComputedBalances } from "@/services/account-balance";
import { getSavingsTrend } from "@/services/savings-tracker";
import { getFYStartMonth } from "@/services/settings";
import { getCurrentFY } from "@/utils/fiscal-year";
import { toIsoDate } from "@/utils/date";
import { newId } from "./crypto";
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
 *   totals of the rest    per month, per own category, one total
 *   every transaction     each approved spend (replaces the two above)
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
  gross: number;
  effective: number;
}

async function spendRows(userId: string, from: string): Promise<SpendRow[]> {
  return getDatabase().getAllAsync<SpendRow>(
    `SELECT e.id, e.date, e.category_id, c.name AS category_name, e.merchant_name,
            CASE WHEN e.split_original_amount > 0 THEN e.split_original_amount ELSE e.amount END AS gross,
            ${effectiveAmountSql("e")} AS effective
     FROM expenses e
     LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.user_id = ? AND e.status = 'approved' AND e.nature = 'realized' AND e.deleted_at IS NULL
       AND (e.reclassified_as_transfer IS NULL OR e.reclassified_as_transfer = 0)
       AND e.date >= ?
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
  const rows = choices.allTransactions || choices.householdCategories || choices.otherTotals ? await spendRows(userId, from) : [];

  if (choices.allTransactions) {
    for (const r of rows) {
      const id = txId(r.id);
      localRefs.set(id, r.id);
      items.push({
        id,
        kind: "tx",
        month: r.date.slice(0, 7),
        date: r.date.slice(0, 10),
        paid: round2(r.gross),
        myShare: round2(r.effective),
        category: r.category_name ?? "Uncategorized",
        merchant: r.merchant_name,
      });
    }
  } else {
    const map = choices.householdCategories ? await getCategoryMap(h.id) : new Map<string, string>();
    const hcats = new Map((await getHouseholdCategories(h.id)).map((c) => [c.id, c.name]));
    const totals = new Map<string, { month: string; name: string; sum: number }>();
    for (const r of rows) {
      const hcatName = r.category_id ? hcats.get(map.get(r.category_id) ?? "") : undefined;
      if (hcatName) {
        const id = txId(r.id);
        localRefs.set(id, r.id);
        items.push({
          id,
          kind: "tx",
          month: r.date.slice(0, 7),
          date: r.date.slice(0, 10),
          paid: round2(r.gross),
          myShare: round2(r.effective),
          category: hcatName,
          merchant: r.merchant_name,
        });
      } else if (choices.otherTotals) {
        const month = r.date.slice(0, 7);
        const name = r.category_name ?? "Uncategorized";
        const key = `total:${month}:${r.category_id ?? "none"}`;
        const t = totals.get(key) ?? { month, name, sum: 0 };
        t.sum += r.effective;
        totals.set(key, t);
      }
    }
    for (const [id, t] of totals) {
      if (t.sum <= 0) continue;
      items.push({ id, kind: "total", month: t.month, myShare: round2(t.sum), category: t.name });
    }
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
      const accounts = await getDatabase().getAllAsync<{ id: string; name: string; account_type: string }>(
        `SELECT id, name, account_type FROM financial_accounts WHERE id IN (${ids.map(() => "?").join(",")});`,
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
