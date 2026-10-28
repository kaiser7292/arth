import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getPersonBalance } from "@/services/hisaab";
import { bumpDataVersion } from "@/services/settings";
import { generateUUID } from "@/utils/uuid";
import { getMemberLinks } from "./shares";
import { addEvent, enqueue, getActiveHousehold, getItems, getMembers, upsertItem } from "./store";
import { requestSync } from "./sync";
import type { Household } from "./types";

/**
 * Settling up between household members (Together rework). Either side can record a settle-up,
 * in either direction ("I paid Aastha", "Aastha paid me"). It goes into my Hisaab with them now and
 * is shared as a "settle" item, from which their phone writes the matching Hisaab entry
 * (mirror.ts), so both ledgers move together.
 *
 * Paying back isn't spending: when I pick the bank payment I made, it's marked as a transfer so it
 * doesn't count twice (once as my share of the bills, again as the payment).
 */

export interface Balance {
  memberId: string;
  name: string;
  personId: string;
  /** From my side: positive = they owe me, negative = I owe them. */
  amount: number;
  /** What their phone says (their "net" item, flipped), when they've shared it. */
  theirs: number | null;
}

/** My balance with each other member, from the linked Hisaab, and whether their phone agrees. */
export async function getBalances(h: Household): Promise<Balance[]> {
  const links = await getMemberLinks(h.id);
  const members = (await getMembers(h.id)).filter((m) => m.id !== h.my_member_id);
  const items = await getItems(h.id);
  const out: Balance[] = [];
  for (const m of members) {
    const personId = links.get(m.id);
    if (!personId) continue;
    const net = items.find((i) => i.member_id === m.id && i.kind === "net" && i.id === `net:${h.my_member_id}`);
    let theirs: number | null = null;
    if (net?.payload_json) {
      const v = (JSON.parse(net.payload_json) as { balance?: number }).balance;
      // "+ 0" turns -0 into 0, so a settled balance never reads "−₹0".
      if (typeof v === "number") theirs = Math.round(-v * 100) / 100 + 0;
    }
    out.push({ memberId: m.id, name: m.name, personId, amount: Math.round((await getPersonBalance(personId)) * 100) / 100, theirs });
  }
  return out;
}

export interface SettleUpInput {
  memberId: string;
  amount: number;
  date: string;
  /** "me" = I paid them; "them" = they paid me. */
  paidBy: "me" | "them";
  /** The bank payment I made, to keep it out of spending. */
  paymentExpenseId?: string | null;
}

export async function recordSettleUp(input: SettleUpInput): Promise<void> {
  const h = await getActiveHousehold();
  if (!h) throw new Error("You're not in a household");
  const personId = (await getMemberLinks(h.id)).get(input.memberId);
  if (!personId) throw new Error("Link this person to your Hisaab first");
  const amount = Math.round(input.amount * 100) / 100;
  if (!(amount > 0)) throw new Error("Enter an amount");
  const member = (await getMembers(h.id)).find((m) => m.id === input.memberId);
  const db = getDatabase();
  const entryId = generateUUID();
  const itemId = `settle:${generateUUID()}`;
  const payer = input.paidBy === "me" ? h.my_member_id : input.memberId;
  const payee = input.paidBy === "me" ? input.memberId : h.my_member_id;

  await db.withTransactionAsync(async () => {
    // I paid them → "debit" (I gave money); they paid me → "settlement" (they paid me back).
    await db.runAsync(
      `INSERT INTO hisaab_entries (id, hisaab_person_id, amount, description, date, type, settlement_source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'created', ?);`,
      entryId,
      personId,
      amount,
      input.paidBy === "me" ? `Settle-up to ${member?.name ?? "them"}` : `Settle-up from ${member?.name ?? "them"}`,
      input.date,
      input.paidBy === "me" ? "debit" : "settlement",
      new Date().toISOString(),
    );
    if (input.paidBy === "me" && input.paymentExpenseId) {
      await db.runAsync(
        "UPDATE expenses SET reclassified_as_transfer = 1, money_event = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ?;",
        input.paymentExpenseId,
        DEFAULT_USER_ID,
      );
    }
    const item = { id: itemId, kind: "settle" as const, date: input.date, month: input.date.slice(0, 7), paid: amount, extra: { payer, payee, amount } };
    await upsertItem(h.id, h.my_member_id, item, entryId);
    // Queued here: the publisher only sends changes, and to it this item is already "mine".
    await enqueue(h.id, [{ kind: "items.upsert", items: [item] }]);
    await addEvent(h.id, payer === h.my_member_id ? h.my_member_id : input.memberId, "settled", { amount, to: payee });
  });
  bumpDataVersion();
  requestSync(500);
}

/** My recent bank payments that could be the settle-up (similar amount, last 10 days). */
export async function settleUpCandidates(amount: number, today: string): Promise<{ id: string; amount: number; date: string; merchant: string | null }[]> {
  return getDatabase().getAllAsync(
    `SELECT id, amount, date, merchant_name AS merchant FROM expenses
     WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
       AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0) AND household_ref IS NULL
       AND split_original_amount IS NULL
       AND date >= date(?, '-10 days') AND date <= date(?, '+1 day')
       AND amount BETWEEN ? AND ?
     ORDER BY ABS(amount - ?), date DESC LIMIT 8;`,
    DEFAULT_USER_ID,
    today,
    today,
    amount * 0.8,
    amount * 1.2,
    amount,
  );
}
