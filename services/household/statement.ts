import { getBalances, type Balance } from "./settle";
import { getActiveHousehold, getItems, getMembers } from "./store";
import type { Household, HouseholdItem, HouseholdMember } from "./types";

/**
 * The Together statement (Together rework): one list of the household's shared transactions, from
 * everyone, with what each means between me and the payer - "you owe ₹1,150", "owes you ₹930".
 */

export interface StatementRow {
  id: string;
  member: HouseholdMember;
  date: string;
  merchant: string | null;
  category: string | null;
  paid: number;
  /** From my side. */
  relation: { kind: "you_owe" | "owes_you" | "shared" | "personal" | "settle"; amount: number; with?: string };
  split: string | null;
  /** My own transaction: its expense, to open it. */
  expenseId: string | null;
}

export interface Statement {
  household: Household;
  members: HouseholdMember[];
  month: string;
  rows: StatementRow[];
  /** Personal spending shared only as monthly totals. */
  totalsOnly: { member: HouseholdMember; category: string; amount: number }[];
  together: number;
  byMember: { member: HouseholdMember; paid: number }[];
  balances: Balance[];
}

const extraOf = (i: HouseholdItem): { owes?: Record<string, number>; split?: string; shared?: number; payer?: string; payee?: string; amount?: number } => {
  try {
    return i.payload_json ? JSON.parse(i.payload_json) : {};
  } catch {
    return {};
  }
};

export async function getStatement(month: string): Promise<Statement | null> {
  const h = await getActiveHousehold();
  if (!h) return null;
  const everyone = await getMembers(h.id, true);
  const byId = new Map(everyone.map((m) => [m.id, m]));
  const items = (await getItems(h.id)).filter((i) => i.month === month);
  const me = h.my_member_id;

  const rows: StatementRow[] = [];
  const totalsOnly: Statement["totalsOnly"] = [];
  const paidBy = new Map<string, number>();
  for (const i of items) {
    const member = byId.get(i.member_id);
    if (!member) continue;
    const x = extraOf(i);
    if (i.kind === "tx") {
      const paid = i.paid ?? 0;
      let relation: StatementRow["relation"];
      if (!x.shared) relation = { kind: "personal", amount: 0 };
      else if (i.member_id === me) {
        const owed = Object.entries(x.owes ?? {});
        const sum = owed.reduce((s, [, v]) => s + v, 0);
        relation =
          sum > 0
            ? { kind: "owes_you", amount: sum, with: owed.length === 1 ? byId.get(owed[0][0])?.name : `${owed.length} people` }
            : { kind: "shared", amount: 0 };
      } else {
        const mine = x.owes?.[me] ?? 0;
        relation = mine > 0 ? { kind: "you_owe", amount: mine, with: member.name } : { kind: "shared", amount: 0 };
      }
      if (x.shared) paidBy.set(i.member_id, (paidBy.get(i.member_id) ?? 0) + paid);
      rows.push({
        id: i.id,
        member,
        date: (i.date ?? "").slice(0, 10),
        merchant: i.merchant,
        category: i.category_name,
        paid,
        relation,
        split: (x.split as string) ?? null,
        expenseId: i.member_id === me ? i.local_ref : null,
      });
    } else if (i.kind === "settle") {
      const payer = byId.get(x.payer ?? "");
      const payee = byId.get(x.payee ?? "");
      if (!payer || !payee) continue;
      rows.push({
        id: i.id,
        member: payer,
        date: (i.date ?? "").slice(0, 10),
        merchant: `Settle-up to ${payee.id === me ? "you" : payee.name}`,
        category: null,
        paid: x.amount ?? i.paid ?? 0,
        relation: { kind: "settle", amount: x.amount ?? 0 },
        split: null,
        expenseId: null,
      });
    } else if (i.kind === "total") {
      totalsOnly.push({ member, category: i.category_name ?? "Other", amount: i.my_share ?? 0 });
    }
  }
  rows.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : b.date.localeCompare(a.date)));
  const members = everyone.filter((m) => !m.removed_at);
  return {
    household: h,
    members,
    month,
    rows,
    totalsOnly,
    together: [...paidBy.values()].reduce((s, v) => s + v, 0),
    byMember: members.map((m) => ({ member: m, paid: paidBy.get(m.id) ?? 0 })),
    balances: await getBalances(h),
  };
}
