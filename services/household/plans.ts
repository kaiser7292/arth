import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import { generateUUID } from "@/utils/uuid";
import { deleteItem, enqueue, getActiveHousehold, getHouseholdCategories, getItems, getMembers, upsertItem } from "./store";
import { requestSync } from "./sync";
import type { Household, HouseholdItem, HouseholdMember, SharedItem } from "./types";

/**
 * Planning together (Together rework, step 4): a household budget everyone agrees to, and shared
 * goals each person saves towards in their own way.
 *
 *   budget        a proposal: an amount per household category, and a note. Anyone proposes; it
 *                 starts once every other member has accepted it ("budget_ok"). Suggesting changes
 *                 is a new proposal that replaces the old one.
 *   goal          "Goa trip ₹1,50,000 by December", started by anyone
 *   goal_progress each person's own part of a goal: linked to one of their investment buckets (kept
 *                 up to date from it) or an amount they enter
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

const extra = <T,>(i: HouseholdItem): T => {
  try {
    return (i.payload_json ? JSON.parse(i.payload_json) : {}) as T;
  } catch {
    return {} as T;
  }
};

/** Saves one of my items here and queues it for the others (the publisher only sends changes). */
async function shareOwnItem(h: Household, item: SharedItem, localRef: string | null = null): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    await upsertItem(h.id, h.my_member_id, item, localRef);
    await enqueue(h.id, [{ kind: "items.upsert", items: [item] }]);
  });
  bumpDataVersion();
  requestSync(500);
}

async function retractOwnItem(h: Household, id: string): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    await deleteItem(h.id, h.my_member_id, id);
    await enqueue(h.id, [{ kind: "items.delete", ids: [id] }]);
  });
  bumpDataVersion();
  requestSync(500);
}

async function requireActive(): Promise<Household> {
  const h = await getActiveHousehold();
  if (!h) throw new Error("You're not in a household");
  return h;
}

// ─── Budget ───

export interface BudgetProposal {
  id: string;
  by: HouseholdMember;
  at: string;
  amounts: Record<string, number>;
  note: string | null;
  acceptedBy: string[];
  /** Others who still have to accept. */
  waitingFor: HouseholdMember[];
}

export interface BudgetLine {
  category: string;
  budget: number;
  spent: number;
}

export interface BudgetState {
  active: BudgetProposal | null;
  /** A newer proposal not everyone has accepted yet. */
  pending: BudgetProposal | null;
  lines: BudgetLine[];
  total: { budget: number; spent: number };
}

export async function getBudgetState(h: Household, month: string): Promise<BudgetState> {
  const items = await getItems(h.id);
  const members = await getMembers(h.id);
  const byId = new Map(members.map((m) => [m.id, m]));
  const oks = new Map<string, Set<string>>();
  for (const i of items.filter((x) => x.kind === "budget_ok")) {
    const id = extra<{ budgetId?: string }>(i).budgetId;
    if (!id) continue;
    oks.set(id, (oks.get(id) ?? new Set()).add(i.member_id));
  }
  const proposals: BudgetProposal[] = [];
  for (const i of items.filter((x) => x.kind === "budget")) {
    const by = byId.get(i.member_id);
    if (!by) continue;
    const x = extra<{ amounts?: Record<string, number>; note?: string }>(i);
    const accepted = [...(oks.get(i.id) ?? [])];
    const waitingFor = members.filter((m) => m.id !== by.id && !accepted.includes(m.id));
    proposals.push({ id: i.id, by, at: i.date ?? i.updated_at, amounts: x.amounts ?? {}, note: x.note ?? null, acceptedBy: accepted, waitingFor });
  }
  proposals.sort((a, b) => b.at.localeCompare(a.at));
  const active = proposals.find((p) => p.waitingFor.length === 0) ?? null;
  const newest = proposals[0] ?? null;
  const pending = newest && newest !== active && newest.waitingFor.length > 0 ? newest : null;

  // Spent together this month per household category: every shared bill, whoever paid.
  const spent = new Map<string, number>();
  for (const i of items.filter((x) => x.kind === "tx" && x.month === month)) {
    if (!extra<{ shared?: number }>(i).shared || !i.category_name) continue;
    spent.set(i.category_name, (spent.get(i.category_name) ?? 0) + (i.paid ?? 0));
  }
  const cats = (await getHouseholdCategories(h.id)).map((c) => c.name);
  const lines = active
    ? cats
        .filter((c) => (active.amounts[c] ?? 0) > 0 || (spent.get(c) ?? 0) > 0)
        .map((c) => ({ category: c, budget: active.amounts[c] ?? 0, spent: round2(spent.get(c) ?? 0) }))
    : [];
  return {
    active,
    pending,
    lines,
    total: { budget: lines.reduce((s, l) => s + l.budget, 0), spent: round2(lines.reduce((s, l) => s + l.spent, 0)) },
  };
}

/** Suggested amounts: the average shared spend per household category over the last 3 months. */
export async function suggestBudget(h: Household, month: string): Promise<Record<string, number>> {
  const [y, m] = month.split("-").map(Number);
  const months = [1, 2, 3].map((k) => {
    const d = new Date(y, m - 1 - k, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const items = (await getItems(h.id)).filter((i) => i.kind === "tx" && months.includes(i.month ?? ""));
  const out: Record<string, number> = {};
  for (const c of await getHouseholdCategories(h.id)) {
    const sum = items.filter((i) => i.category_name === c.name && extra<{ shared?: number }>(i).shared).reduce((s, i) => s + (i.paid ?? 0), 0);
    out[c.name] = sum > 0 ? Math.round(sum / 3 / 100) * 100 : 0;
  }
  return out;
}

export async function proposeBudget(amounts: Record<string, number>, note: string | null): Promise<void> {
  const h = await requireActive();
  const clean = Object.fromEntries(Object.entries(amounts).filter(([, v]) => v > 0).map(([k, v]) => [k.slice(0, 40), Math.round(v)]));
  const today = new Date().toISOString();
  await shareOwnItem(h, { id: `budget:${generateUUID()}`, kind: "budget", date: today, extra: { amounts: clean, note: note?.trim().slice(0, 140) || null } });
}

export async function acceptBudget(budgetId: string): Promise<void> {
  const h = await requireActive();
  await shareOwnItem(h, { id: `budget_ok:${budgetId}`, kind: "budget_ok", date: new Date().toISOString(), extra: { budgetId } });
}

// ─── Goals ───

export interface Goal {
  id: string;
  name: string;
  target: number;
  by: string | null;
  startedBy: HouseholdMember | null;
  parts: { member: HouseholdMember; amount: number; bucketName: string | null }[];
  total: number;
  /** Per month from now to reach it by the date, or null without a date. */
  perMonthNeeded: number | null;
  /** My own part: linked bucket, or null for an entered amount. */
  myBucketId: string | null;
}

export async function getGoals(h: Household): Promise<Goal[]> {
  const items = await getItems(h.id);
  const members = await getMembers(h.id);
  const byId = new Map(members.map((m) => [m.id, m]));
  const out: Goal[] = [];
  for (const g of items.filter((i) => i.kind === "goal")) {
    const x = extra<{ name?: string; target?: number; by?: string; closed?: number }>(g);
    if (x.closed) continue;
    const parts: Goal["parts"] = [];
    let myBucketId: string | null = null;
    for (const p of items.filter((i) => i.kind === "goal_progress" && extra<{ goalId?: string }>(i).goalId === g.id)) {
      const member = byId.get(p.member_id);
      if (!member) continue;
      const px = extra<{ amount?: number; bucket?: string | null }>(p);
      parts.push({ member, amount: px.amount ?? 0, bucketName: px.bucket ?? null });
      if (p.member_id === h.my_member_id) myBucketId = p.local_ref;
    }
    const target = x.target ?? 0;
    const total = round2(parts.reduce((s, p) => s + p.amount, 0));
    let perMonthNeeded: number | null = null;
    if (x.by) {
      const now = new Date();
      const end = new Date(`${x.by}T00:00:00`);
      const months = Math.max(1, (end.getFullYear() - now.getFullYear()) * 12 + end.getMonth() - now.getMonth());
      perMonthNeeded = Math.max(0, Math.round((target - total) / months));
    }
    out.push({ id: g.id, name: x.name ?? "Goal", target, by: x.by ?? null, startedBy: byId.get(g.member_id) ?? null, parts, total, perMonthNeeded, myBucketId });
  }
  return out;
}

export async function createGoal(name: string, target: number, by: string | null): Promise<string> {
  const h = await requireActive();
  const id = `goal:${generateUUID()}`;
  await shareOwnItem(h, { id, kind: "goal", date: new Date().toISOString(), extra: { name: name.trim().slice(0, 40) || "Goal", target: Math.round(target), by } });
  return id;
}

/** My part of a goal: one of my investment buckets (kept up to date from it), or an amount. */
export async function setMyGoalPart(goalId: string, part: { bucketId: string } | { amount: number }): Promise<void> {
  const h = await requireActive();
  let amount: number;
  let bucket: string | null = null;
  let localRef: string | null = null;
  if ("bucketId" in part) {
    const b = await getDatabase().getFirstAsync<{ name: string; current_contributed: number }>(
      "SELECT name, current_contributed FROM investment_buckets WHERE id = ?;",
      part.bucketId,
    );
    if (!b) throw new Error("That bucket no longer exists");
    amount = b.current_contributed ?? 0;
    bucket = b.name;
    localRef = part.bucketId;
  } else {
    amount = Math.max(0, part.amount);
  }
  // One part per person: the id carries the member, or two people's parts would collide.
  await shareOwnItem(h, { id: `gp:${goalId}:${h.my_member_id}`, kind: "goal_progress", date: new Date().toISOString(), extra: { goalId, amount: round2(amount), bucket } }, localRef);
}

/** Whoever started a goal can end it (reached, or no longer wanted). */
export async function closeGoal(goalId: string): Promise<void> {
  const h = await requireActive();
  const g = (await getItems(h.id, h.my_member_id)).find((i) => i.id === goalId);
  if (!g) throw new Error("Only whoever started a goal can close it");
  await shareOwnItem(h, { id: g.id, kind: "goal", date: g.date, extra: { ...extra<object>(g), closed: 1 } });
}

/** For the publisher: my goal parts linked to a bucket, with today's amount. */
export async function refreshedGoalParts(h: Household, mine: HouseholdItem[]): Promise<SharedItem[]> {
  const out: SharedItem[] = [];
  for (const p of mine.filter((i) => i.kind === "goal_progress")) {
    const x = extra<{ goalId?: string; amount?: number; bucket?: string | null }>(p);
    if (p.local_ref) {
      const b = await getDatabase().getFirstAsync<{ name: string; current_contributed: number }>(
        "SELECT name, current_contributed FROM investment_buckets WHERE id = ?;",
        p.local_ref,
      );
      if (b) {
        out.push({ id: p.id, kind: "goal_progress", date: p.date, extra: { goalId: x.goalId, amount: round2(b.current_contributed ?? 0), bucket: b.name } });
        continue;
      }
    }
    out.push({ id: p.id, kind: "goal_progress", date: p.date, extra: { goalId: x.goalId, amount: x.amount ?? 0, bucket: x.bucket ?? null } });
  }
  return out;
}

export { retractOwnItem };
