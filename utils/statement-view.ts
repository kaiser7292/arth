import { NOT_SET } from "@/services/expense-types";
import type { StatementRow } from "@/services/household/statement";
import { matchesSearch } from "@/utils/amount-search";

/** Who owes the payer what on a shared bill, for reading: "You" for me, biggest share first. */
export function statementShares(
  owes: Record<string, number> | undefined,
  nameById: (id: string) => string | undefined,
  me: string | null,
): { name: string; amount: number }[] {
  return Object.entries(owes ?? {})
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => ({ name: id === me ? "You" : (nameById(id) ?? "Someone"), amount }))
    .sort((a, b) => b.amount - a.amount);
}

export type StatementKind = StatementRow["relation"]["kind"];
export type StatementGroupBy = "category" | "member" | "merchant";

export interface StatementFilters {
  members: string[];
  categories: string[];
  merchants: string[];
  kinds: StatementKind[];
  query: string;
}

/** Each filter is any-of its choices; an empty one lets everything through. */
export function filterStatementRows(rows: StatementRow[], f: StatementFilters): StatementRow[] {
  return rows.filter((r) => {
    const isSettle = r.relation.kind === "settle";
    return (
      (f.members.length === 0 || f.members.includes(r.member.id)) &&
      // A settle-up has no category or merchant to be missing, so "No category" doesn't catch it.
      (f.categories.length === 0 || (!isSettle && f.categories.includes(r.category ?? NOT_SET))) &&
      (f.merchants.length === 0 || (!isSettle && f.merchants.includes(r.merchant ?? NOT_SET))) &&
      (f.kinds.length === 0 || f.kinds.includes(r.relation.kind)) &&
      matchesSearch(f.query, [r.merchant, r.category, r.member.name], [r.paid])
    );
  });
}

/** What was spent: a settle-up moves money between people, it isn't spending. */
export function statementTotal(rows: StatementRow[]): number {
  return rows.reduce((sum, r) => (r.relation.kind === "settle" ? sum : sum + r.paid), 0);
}

/** The same shape as the Transactions summary, biggest first. */
export function summarizeStatement(rows: StatementRow[], groupBy: StatementGroupBy) {
  const groups = new Map<string | null, { key: string | null; total: number; count: number }>();
  for (const r of rows) {
    if (r.relation.kind === "settle") continue;
    const key = groupBy === "member" ? r.member.id : groupBy === "category" ? r.category : r.merchant;
    const g = groups.get(key) ?? { key, total: 0, count: 0 };
    g.total += r.paid;
    g.count += 1;
    groups.set(key, g);
  }
  return {
    total: statementTotal(rows),
    count: rows.length,
    groupBy,
    groups: [...groups.values()].sort((a, b) => b.total - a.total),
  };
}

export type StatementListRow =
  | { type: "day"; date: string; total: number }
  | { type: "row"; row: StatementRow };

/** Rows (newest first) with a heading and that day's total before each day. */
export function withDayHeadings(rows: StatementRow[]): StatementListRow[] {
  const out: StatementListRow[] = [];
  let day: Extract<StatementListRow, { type: "day" }> | null = null;
  for (const row of rows) {
    if (!day || day.date !== row.date) {
      day = { type: "day", date: row.date, total: 0 };
      out.push(day);
    }
    if (row.relation.kind !== "settle") day.total += row.paid;
    out.push({ type: "row", row });
  }
  return out;
}
