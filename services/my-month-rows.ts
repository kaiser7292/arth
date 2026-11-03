import { getDatabase } from "@/database";
import type { AccountTransfer } from "@/services/account-transfer";
import { monthsBetween } from "@/services/cash-flow";
import { effectiveAmountSql } from "@/services/expense-effective-amount";
import type { Expense } from "@/services/expense-types";
import { MONEY_IN_FROM } from "@/services/money-in-sql";
import { LINKED_PART, NOT_PUT_AWAY, REAL_DEBIT } from "@/services/my-month";
import { TRANSFERS_TO_INVESTMENTS_FROM } from "@/services/reports/year-review";
import { getSalaryCreditIdsForMonth } from "@/services/salary-periods";
import { getMonthDateRange } from "@/utils/budget-helpers";

/**
 * The transactions behind each figure on My Month. Each list uses the same rules as the figure, and a
 * row's amount is the part that counts towards it (a partly linked payment shows only its spent part
 * under Spent), so the rows add up to the number that was tapped.
 */
export type MyMonthSection =
  | "income"
  | "other"
  | "moneyIn"
  | "in"
  | "repaid"
  | "spent"
  | "fd"
  | "sip"
  | "linked"
  | "transfers"
  | "saved"
  | "bills"
  | "people"
  | "out"
  | "left"
  | "budget";

export type MyMonthRow = { kind: "expense"; expense: Expense } | { kind: "transfer"; transfer: AccountTransfer };

export interface MyMonthGroup {
  title: string;
  total: number;
  rows: MyMonthRow[];
}

const expenses = (list: Expense[]): MyMonthRow[] => list.map((expense) => ({ kind: "expense", expense }));
const group = (title: string, rows: MyMonthRow[]): MyMonthGroup => ({
  title,
  rows,
  total: rows.reduce((s, r) => s + (r.kind === "expense" ? r.expense.amount : r.transfer.amount), 0),
});

export async function getMyMonthGroups(
  userId: string,
  month: string,
  section: MyMonthSection,
  categoryId?: string | null,
): Promise<MyMonthGroup[]> {
  const db = getDatabase();
  const { startDate, endDate } = getMonthDateRange(month);
  const range = [userId, startDate, endDate] as const;
  const amount = effectiveAmountSql("expenses");

  const income = async () => {
    const ids = await getSalaryCreditIdsForMonth(userId, month);
    if (ids.length === 0) return group("Income", []);
    const rows = await db.getAllAsync<Expense>(
      `SELECT * FROM expenses WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY date DESC;`,
      ...ids,
    );
    return group("Income", expenses(rows));
  };
  const other = async () =>
    group(
      "Other money in",
      expenses(
        await db.getAllAsync<Expense>(
          `SELECT e.* ${MONEY_IN_FROM}
             AND COALESCE(e.credit_kind, '') <> 'salary'
             AND NOT EXISTS (SELECT 1 FROM hisaab_entries h WHERE h.linked_expense_id = e.id AND h.type = 'settlement')
           ORDER BY e.date DESC;`,
          ...range,
        ),
      ),
    );
  const repaid = async () =>
    group(
      "Repaid to you",
      expenses(
        await db.getAllAsync<Expense>(
          `SELECT e.* ${MONEY_IN_FROM}
             AND EXISTS (SELECT 1 FROM hisaab_entries h WHERE h.linked_expense_id = e.id AND h.type = 'settlement')
           ORDER BY e.date DESC;`,
          ...range,
        ),
      ),
    );
  const spent = async (only?: string | null) => {
    const rows = await db.getAllAsync<Expense>(
      `SELECT *, MAX(0, ${amount} - ${LINKED_PART}) AS amount FROM expenses
       WHERE user_id = ? AND date >= ? AND date <= ? AND ${REAL_DEBIT}
         AND COALESCE(money_event, '') NOT IN ('fd_open', 'sip', 'self_transfer')
       ORDER BY date DESC;`,
      ...range,
    );
    const kept = rows
      .filter((r) => r.amount > 0)
      .filter((r) => only === undefined || (r.category_id ?? null) === only);
    return group("Spent", expenses(kept));
  };
  const spotted = async (event: "fd_open" | "sip", title: string) =>
    group(
      title,
      expenses(
        await db.getAllAsync<Expense>(
          `SELECT *, ${amount} AS amount FROM expenses
           WHERE user_id = ? AND date >= ? AND date <= ? AND ${NOT_PUT_AWAY} AND money_event = ?
           ORDER BY date DESC;`,
          ...range,
          event,
        ),
      ),
    );
  const fd = () => spotted("fd_open", "Fixed deposits");
  const sip = () => spotted("sip", "SIPs");
  const linked = async () =>
    group(
      "Linked to goals",
      expenses(
        await db.getAllAsync<Expense>(
          `SELECT e.*, SUM(COALESCE(l.contribution_amount, e.amount)) AS amount
           FROM expense_investment_links l
           JOIN expenses e ON e.id = l.expense_id
           WHERE e.user_id = ? AND e.deleted_at IS NULL AND e.status = 'approved' AND e.date >= ? AND e.date <= ?
           GROUP BY e.id ORDER BY e.date DESC;`,
          ...range,
        ),
      ),
    );
  const transfers = async () => {
    const rows = await db.getAllAsync<AccountTransfer>(`SELECT t.* ${TRANSFERS_TO_INVESTMENTS_FROM} ORDER BY t.date DESC;`, ...range);
    return group("Moved to investment accounts", rows.map((transfer) => ({ kind: "transfer" as const, transfer })));
  };
  const bills = async () =>
    group(
      "Others' share of bills you paid",
      expenses(
        await db.getAllAsync<Expense>(
          `SELECT *, split_original_amount - amount AS amount FROM expenses
           WHERE user_id = ? AND date >= ? AND date <= ? AND ${NOT_PUT_AWAY}
             AND household_ref IS NULL AND split_original_amount > amount
           ORDER BY date DESC;`,
          ...range,
        ),
      ),
    );
  const saved = () => Promise.all([fd(), sip(), linked(), transfers()]);
  const moneyIn = () => Promise.all([income(), other()]);
  const all = async () => [...(await moneyIn()), await repaid()];
  const out = async () => [await spent(), ...(await saved()), await bills()];

  const pick = async (): Promise<MyMonthGroup[]> => {
    switch (section) {
      case "income":
        return [await income()];
      case "other":
        return [await other()];
      case "moneyIn":
        return moneyIn();
      case "in":
        return all();
      case "repaid":
        return [await repaid()];
      case "spent":
        return [await spent(categoryId === undefined ? undefined : categoryId)];
      case "fd":
        return [await fd()];
      case "sip":
        return [await sip()];
      case "linked":
        return [await linked()];
      case "transfers":
        return [await transfers()];
      case "saved":
        return saved();
      case "bills":
        return [await bills()];
      case "people":
        return [await bills(), await repaid()];
      case "out":
        return out();
      case "left":
        return [...(await all()), ...(await out())];
      case "budget":
        // Budget's own rule (getExpenseTotal): fixed deposits and SIPs not yet set up still count.
        return [
          group(
            "Spent against budget",
            expenses(
              await db.getAllAsync<Expense>(
                `SELECT *, ${amount} AS amount FROM expenses
                 WHERE user_id = ? AND date >= ? AND date <= ? AND ${NOT_PUT_AWAY}
                 ORDER BY date DESC;`,
                ...range,
              ),
            ),
          ),
        ];
    }
  };

  return (await pick()).filter((g) => g.rows.length > 0);
}

/** The same lists across a run of months, with each list's rows and total put together. */
export async function getMyMonthRangeGroups(
  userId: string,
  startMonth: string,
  endMonth: string,
  section: MyMonthSection,
  categoryId?: string | null,
): Promise<MyMonthGroup[]> {
  const merged = new Map<string, MyMonthGroup>();
  // Newest month first, so the rows read newest first as they do within a month.
  for (const month of monthsBetween(startMonth, endMonth).reverse()) {
    for (const g of await getMyMonthGroups(userId, month, section, categoryId)) {
      const seen = merged.get(g.title);
      if (seen) {
        seen.rows.push(...g.rows);
        seen.total += g.total;
      } else {
        merged.set(g.title, { ...g, rows: [...g.rows] });
      }
    }
  }
  return [...merged.values()];
}
