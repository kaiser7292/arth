import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import type {
  EventType,
  Household,
  HouseholdCategory,
  HouseholdEvent,
  HouseholdItem,
  HouseholdMember,
  MemberPublic,
  OpBody,
  SharedItem,
  SharingChoices,
} from "./types";

/**
 * Household tables (migration 086). Plain reads and writes; the rules live in sync.ts / apply.ts /
 * publisher.ts.
 */

// ─── Household ───

/** The household this phone is in (Phase 1: one at a time), active or not. */
export async function getHousehold(): Promise<Household | null> {
  return getDatabase().getFirstAsync<Household>(
    "SELECT * FROM households ORDER BY (status = 'active') DESC, created_at DESC LIMIT 1;",
  );
}

export async function getActiveHousehold(): Promise<Household | null> {
  return getDatabase().getFirstAsync<Household>(
    "SELECT * FROM households WHERE status = 'active' ORDER BY created_at DESC LIMIT 1;",
  );
}

export async function insertHousehold(h: Pick<Household, "id" | "name" | "my_member_id" | "role" | "relay_url">): Promise<void> {
  await getDatabase().runAsync(
    `INSERT INTO households (id, name, my_member_id, role, relay_url, joined_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'));`,
    h.id,
    h.name,
    h.my_member_id,
    h.role,
    h.relay_url,
  );
}

type HouseholdPatch = Partial<
  Pick<
    Household,
    | "name"
    | "status"
    | "key_version"
    | "needs_snapshot"
    | "next_seq"
    | "last_device_id"
    | "left_at"
    | "last_sync_at"
    | "last_sync_error"
    | "share_household_categories"
    | "share_other_totals"
    | "share_all_transactions"
    | "share_savings_rate"
    | "share_balances"
  >
>;

export async function updateHousehold(id: string, patch: HouseholdPatch): Promise<void> {
  const keys = Object.keys(patch) as (keyof HouseholdPatch)[];
  if (keys.length === 0) return;
  await getDatabase().runAsync(
    `UPDATE households SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?;`,
    ...keys.map((k) => patch[k] as string | number | null),
    id,
  );
}

export function choicesOf(h: Household): SharingChoices {
  return {
    householdCategories: !!h.share_household_categories,
    otherTotals: !!h.share_other_totals,
    allTransactions: !!h.share_all_transactions,
    savingsRate: !!h.share_savings_rate,
    balances: !!h.share_balances,
  };
}

/** Removes the household and everything under it from this phone (leave / removed / closed). */
export async function deleteHouseholdData(id: string): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    for (const table of [
      "household_events",
      "household_expense_shares",
      "household_member_links",
      "household_their_categories",
      "household_cursors",
      "household_outbox",
      "household_items",
      "household_balance_accounts",
      "household_category_map",
      "household_categories",
      "household_members",
    ]) {
      await db.runAsync(`DELETE FROM ${table} WHERE household_id = ?;`, id);
    }
    await db.runAsync("DELETE FROM households WHERE id = ?;", id);
  });
}

// ─── Members ───

export async function getMembers(householdId: string, includeRemoved = false): Promise<HouseholdMember[]> {
  return getDatabase().getAllAsync<HouseholdMember>(
    `SELECT * FROM household_members WHERE household_id = ? ${includeRemoved ? "" : "AND removed_at IS NULL"}
     ORDER BY joined_at, id;`,
    householdId,
  );
}

export async function getMember(householdId: string, memberId: string): Promise<HouseholdMember | null> {
  return getDatabase().getFirstAsync<HouseholdMember>(
    "SELECT * FROM household_members WHERE household_id = ? AND id = ?;",
    householdId,
    memberId,
  );
}

/** Adds a member, or brings back one who left and was approved again. Keys come only from here. */
export async function upsertMember(householdId: string, m: MemberPublic): Promise<void> {
  await getDatabase().runAsync(
    `INSERT INTO household_members (household_id, id, name, colour, box_public, sign_public, role, joined_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (household_id, id) DO UPDATE SET
       name = excluded.name, colour = excluded.colour, box_public = excluded.box_public,
       sign_public = excluded.sign_public, role = excluded.role, removed_at = NULL;`,
    householdId,
    m.id,
    m.name,
    m.colour,
    m.boxPublic,
    m.signPublic,
    m.role,
  );
}

export async function updateMemberProfile(householdId: string, memberId: string, name: string, colour: string | null): Promise<void> {
  await getDatabase().runAsync(
    "UPDATE household_members SET name = ?, colour = COALESCE(?, colour) WHERE household_id = ? AND id = ?;",
    name,
    colour,
    householdId,
    memberId,
  );
}

export async function setMemberSettings(householdId: string, memberId: string, choices: SharingChoices): Promise<void> {
  await getDatabase().runAsync(
    "UPDATE household_members SET settings_json = ? WHERE household_id = ? AND id = ?;",
    JSON.stringify(choices),
    householdId,
    memberId,
  );
}

export async function markMemberRemoved(householdId: string, memberId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "UPDATE household_members SET removed_at = datetime('now') WHERE household_id = ? AND id = ?;",
    householdId,
    memberId,
  );
  await db.runAsync("DELETE FROM household_items WHERE household_id = ? AND member_id = ?;", householdId, memberId);
}

export const toMemberPublic = (m: HouseholdMember): MemberPublic => ({
  id: m.id,
  name: m.name,
  colour: m.colour,
  boxPublic: m.box_public,
  signPublic: m.sign_public,
  role: m.role,
});

// ─── Categories ───

export async function getHouseholdCategories(householdId: string): Promise<HouseholdCategory[]> {
  return getDatabase().getAllAsync<HouseholdCategory>(
    "SELECT * FROM household_categories WHERE household_id = ? ORDER BY sort_order, name;",
    householdId,
  );
}

/** shared: shared by default (omitted = yes, as households before migration 088 behaved). */
export async function setHouseholdCategories(householdId: string, list: { id: string; name: string; shared?: boolean }[]): Promise<void> {
  const db = getDatabase();
  await db.runAsync("DELETE FROM household_categories WHERE household_id = ?;", householdId);
  for (let i = 0; i < list.length; i++) {
    await db.runAsync(
      "INSERT INTO household_categories (household_id, id, name, sort_order, shared_default) VALUES (?, ?, ?, ?, ?);",
      householdId,
      list[i].id,
      list[i].name,
      i,
      list[i].shared === false ? 0 : 1,
    );
  }
  // A mapping to a household category that no longer exists means "not shared in full".
  await db.runAsync(
    `DELETE FROM household_category_map WHERE household_id = ?
       AND household_category_id NOT IN (SELECT id FROM household_categories WHERE household_id = ?);`,
    householdId,
    householdId,
  );
}

/** local category id → household category id */
export async function getCategoryMap(householdId: string): Promise<Map<string, string>> {
  const rows = await getDatabase().getAllAsync<{ local_category_id: string; household_category_id: string }>(
    "SELECT local_category_id, household_category_id FROM household_category_map WHERE household_id = ?;",
    householdId,
  );
  return new Map(rows.map((r) => [r.local_category_id, r.household_category_id]));
}

export async function setCategoryMapping(householdId: string, localCategoryId: string, householdCategoryId: string | null): Promise<void> {
  const db = getDatabase();
  if (householdCategoryId) {
    await db.runAsync(
      `INSERT INTO household_category_map (household_id, local_category_id, household_category_id) VALUES (?, ?, ?)
       ON CONFLICT (household_id, local_category_id) DO UPDATE SET household_category_id = excluded.household_category_id;`,
      householdId,
      localCategoryId,
      householdCategoryId,
    );
  } else {
    await db.runAsync(
      "DELETE FROM household_category_map WHERE household_id = ? AND local_category_id = ?;",
      householdId,
      localCategoryId,
    );
  }
}

/**
 * Maps my categories onto the household's by name, for any category not mapped yet ("Grocery" →
 * Groceries, "Rent & maintenance" → Rent). Never changes a mapping the person chose.
 */
// "out" too: "Dining out" is food, not "Travel & Going Out".
const STOP_WORDS = new Set(["and", "the", "of", "for", "other", "misc", "general", "my", "out"]);

/** "Groceries & Supplies" → ["grocery", "supply"]: lower-case words, singular, no filler words. */
export function categoryWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .map((w) => w.replace(/ies$/, "y").replace(/s$/, ""));
}

/** Words that mean the same kind of spending, for categories named differently on two phones. */
const SYNONYMS: string[][] = [
  ["grocery", "supply", "supermarket", "kirana", "vegetable", "fruit", "provision", "daily", "milk", "household"],
  ["rent", "utility", "electricity", "water", "gas", "internet", "wifi", "broadband", "bill", "maintenance", "society", "maid", "help", "home", "house"],
  ["food", "dining", "restaurant", "eating", "meal", "swiggy", "zomato", "cafe", "snack", "takeaway"],
  ["car", "vehicle", "fuel", "petrol", "diesel", "transport", "commute", "cab", "taxi", "auto", "parking", "toll", "bike"],
  ["health", "medicine", "medical", "pharmacy", "doctor", "hospital", "clinic", "wellness", "fitness", "gym"],
  ["travel", "going", "out", "trip", "vacation", "holiday", "movie", "entertainment", "outing", "flight", "hotel"],
  ["subscription", "ott", "netflix", "streaming", "membership", "app", "recharge", "mobile", "phone"],
  ["shopping", "gift", "clothe", "clothing", "apparel", "fashion", "electronic", "amazon", "flipkart"],
  ["family", "kid", "child", "school", "education", "parent", "baby", "pet"],
  ["insurance", "premium", "policy"],
  ["emi", "loan", "credit"],
];

/**
 * How well two category names match, loosely: 3 same words, 2 a word in common (or one the start
 * of the other, 4+ letters), 1 words that mean the same kind of spending, 0 no match.
 */
export function categoryMatchScore(a: string, b: string): number {
  const wa = categoryWords(a);
  const wb = categoryWords(b);
  if (!wa.length || !wb.length) return 0;
  if (wa.join("") === wb.join("")) return 3;
  const close = (x: string, y: string) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)));
  if (wa.some((x) => wb.some((y) => close(x, y)))) return 2;
  const groups = (ws: string[]) => new Set(SYNONYMS.flatMap((g, i) => (ws.some((w) => g.some((s) => close(w, s))) ? [i] : [])));
  const ga = groups(wa);
  return [...groups(wb)].some((g) => ga.has(g)) ? 1 : 0;
}

/** The best match for a name among candidates (ties: the first), or undefined. */
export function bestCategoryMatch<T extends { name: string }>(name: string, candidates: T[]): T | undefined {
  let best: T | undefined;
  let bestScore = 0;
  for (const c of candidates) {
    const s = categoryMatchScore(name, c.name);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

export async function autoMapCategories(householdId: string, userId: string): Promise<void> {
  const db = getDatabase();
  const hcats = await getHouseholdCategories(householdId);
  const mine = await db.getAllAsync<{ id: string; name: string }>(
    "SELECT id, name FROM categories WHERE user_id = ? AND is_active = 1;",
    userId,
  );
  const map = await getCategoryMap(householdId);
  for (const c of mine) {
    if (map.has(c.id)) continue;
    // Loose on purpose: same name, a word in common, or the same kind of spending
    // ("Groceries" → Grocery & Supplies, "Electricity" → Rent & Utilities, "Petrol" → Car & Vehicles).
    const hit = bestCategoryMatch(c.name, hcats);
    if (hit) await setCategoryMapping(householdId, c.id, hit.id);
  }
}

export async function getBalanceAccountIds(householdId: string): Promise<string[]> {
  const rows = await getDatabase().getAllAsync<{ account_id: string }>(
    "SELECT account_id FROM household_balance_accounts WHERE household_id = ?;",
    householdId,
  );
  return rows.map((r) => r.account_id);
}

export async function setBalanceAccounts(householdId: string, accountIds: string[]): Promise<void> {
  const db = getDatabase();
  await db.runAsync("DELETE FROM household_balance_accounts WHERE household_id = ?;", householdId);
  for (const id of accountIds) {
    await db.runAsync("INSERT INTO household_balance_accounts (household_id, account_id) VALUES (?, ?);", householdId, id);
  }
}

// ─── Items ───

export async function getItems(householdId: string, memberId?: string): Promise<HouseholdItem[]> {
  return memberId
    ? getDatabase().getAllAsync<HouseholdItem>(
        "SELECT * FROM household_items WHERE household_id = ? AND member_id = ?;",
        householdId,
        memberId,
      )
    : getDatabase().getAllAsync<HouseholdItem>("SELECT * FROM household_items WHERE household_id = ?;", householdId);
}

export async function upsertItem(householdId: string, memberId: string, item: SharedItem, localRef: string | null = null): Promise<void> {
  await getDatabase().runAsync(
    `INSERT INTO household_items
       (household_id, id, member_id, kind, month, date, paid, my_share, category_name, merchant, payload_json, local_ref, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (household_id, id) DO UPDATE SET
       kind = excluded.kind, month = excluded.month, date = excluded.date, paid = excluded.paid,
       my_share = excluded.my_share, category_name = excluded.category_name, merchant = excluded.merchant,
       payload_json = excluded.payload_json, local_ref = COALESCE(excluded.local_ref, household_items.local_ref),
       updated_at = excluded.updated_at
     WHERE household_items.member_id = excluded.member_id;`,
    householdId,
    item.id,
    memberId,
    item.kind,
    item.month ?? null,
    item.date ?? null,
    item.paid ?? null,
    item.myShare ?? null,
    item.category ?? null,
    item.merchant ?? null,
    item.extra ? JSON.stringify(item.extra) : null,
    localRef,
  );
}

/** Deletes one item - only the author's own (`memberId`), so nobody can delete someone else's. */
export async function deleteItem(householdId: string, memberId: string, id: string): Promise<void> {
  await getDatabase().runAsync(
    "DELETE FROM household_items WHERE household_id = ? AND member_id = ? AND id = ?;",
    householdId,
    memberId,
    id,
  );
}

export async function deleteMemberItems(householdId: string, memberId: string): Promise<void> {
  await getDatabase().runAsync(
    "DELETE FROM household_items WHERE household_id = ? AND member_id = ?;",
    householdId,
    memberId,
  );
}

export function itemFromRow(r: HouseholdItem): SharedItem {
  return {
    id: r.id,
    kind: r.kind,
    month: r.month,
    date: r.date,
    paid: r.paid,
    myShare: r.my_share,
    category: r.category_name,
    merchant: r.merchant,
    extra: r.payload_json ? (JSON.parse(r.payload_json) as SharedItem["extra"]) : undefined,
  };
}

// ─── Outbox ───

/** Queues ops for sending, numbering them in order. Returns the seqs used. */
export async function enqueue(householdId: string, bodies: OpBody[]): Promise<number[]> {
  if (bodies.length === 0) return [];
  const db = getDatabase();
  const seqs: number[] = [];
  const row = await db.getFirstAsync<{ next_seq: number }>("SELECT next_seq FROM households WHERE id = ?;", householdId);
  if (!row) throw new Error("Household not found");
  let seq = row.next_seq;
  for (const body of bodies) {
    await db.runAsync(
      "INSERT INTO household_outbox (household_id, seq, op_json) VALUES (?, ?, ?);",
      householdId,
      seq,
      JSON.stringify(body),
    );
    seqs.push(seq++);
  }
  await db.runAsync("UPDATE households SET next_seq = ? WHERE id = ?;", seq, householdId);
  return seqs;
}

export async function getUnsent(householdId: string, limit = 200): Promise<{ seq: number; op_json: string; created_at: string }[]> {
  return getDatabase().getAllAsync(
    "SELECT seq, op_json, created_at FROM household_outbox WHERE household_id = ? AND sent_at IS NULL ORDER BY seq LIMIT ?;",
    householdId,
    limit,
  );
}

export async function markSent(householdId: string, seq: number): Promise<void> {
  const db = getDatabase();
  await db.runAsync("UPDATE household_outbox SET sent_at = datetime('now') WHERE household_id = ? AND seq = ?;", householdId, seq);
}

/** Sent ops are only kept a few days, for troubleshooting. */
export async function pruneOutbox(householdId: string): Promise<void> {
  await getDatabase().runAsync(
    "DELETE FROM household_outbox WHERE household_id = ? AND sent_at IS NOT NULL AND sent_at < datetime('now', '-7 days');",
    householdId,
  );
}

/** Renumbers unsent ops to start at `from` (after a restore found the relay already past them). */
export async function renumberUnsent(householdId: string, from: number): Promise<void> {
  const db = getDatabase();
  const unsent = await getUnsent(householdId, 100000);
  await db.runAsync("DELETE FROM household_outbox WHERE household_id = ? AND sent_at IS NULL;", householdId);
  let seq = from;
  for (const r of unsent) {
    await db.runAsync(
      "INSERT INTO household_outbox (household_id, seq, op_json, created_at) VALUES (?, ?, ?, ?);",
      householdId,
      seq++,
      r.op_json,
      r.created_at,
    );
  }
  await db.runAsync("UPDATE households SET next_seq = ? WHERE id = ?;", seq, householdId);
}

// ─── Cursors ───

export async function getCursors(householdId: string): Promise<Record<string, number>> {
  const rows = await getDatabase().getAllAsync<{ member_id: string; last_seq: number }>(
    "SELECT member_id, last_seq FROM household_cursors WHERE household_id = ?;",
    householdId,
  );
  return Object.fromEntries(rows.map((r) => [r.member_id, r.last_seq]));
}

export async function setCursor(householdId: string, memberId: string, seq: number): Promise<void> {
  await getDatabase().runAsync(
    `INSERT INTO household_cursors (household_id, member_id, last_seq) VALUES (?, ?, ?)
     ON CONFLICT (household_id, member_id) DO UPDATE SET last_seq = excluded.last_seq;`,
    householdId,
    memberId,
    seq,
  );
}

// ─── Events (activity feed) ───

export async function addEvent(householdId: string, memberId: string | null, type: EventType, payload?: object): Promise<void> {
  await getDatabase().runAsync(
    "INSERT INTO household_events (id, household_id, member_id, type, payload_json) VALUES (?, ?, ?, ?, ?);",
    generateUUID(),
    householdId,
    memberId,
    type,
    payload ? JSON.stringify(payload) : null,
  );
}

export async function getEvents(householdId: string, limit = 50): Promise<HouseholdEvent[]> {
  return getDatabase().getAllAsync<HouseholdEvent>(
    "SELECT * FROM household_events WHERE household_id = ? ORDER BY at DESC, rowid DESC LIMIT ?;",
    householdId,
    limit,
  );
}
