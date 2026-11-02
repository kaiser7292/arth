import { getDatabase } from "@/database";
import { computeUnseededBalance, getMonthBalanceSummary } from "@/services/account-balance";
import { getBudgetsForMonth } from "@/services/budget";
import { getCategories } from "@/services/category";
import { effectiveAmountSql } from "@/services/expense-effective-amount";
import { getActiveAccounts } from "@/services/financial-account";
import { getFlag } from "@/services/feature-flags";
import { getHisaabSummary } from "@/services/hisaab";
import { getStatement } from "@/services/household/statement";
import { invested, moneyIn, repaymentsIn, salaryIn } from "@/services/reports/year-review";
import { getMonthDateRange } from "@/utils/budget-helpers";

/**
 * The month in one place: what came in, what was spent, what was put away and what's left. Uses the
 * same "real money in" and "invested" rules as Year in Review.
 *
 * Money put away isn't spending, so a fixed deposit or SIP counts once, under saved. That includes
 * ones Arth has spotted but nobody has set up yet (money_event still on the debit). Loan payments
 * stay in spent: unlike a deposit, that money isn't coming back as savings.
 *
 * Money with people isn't income or spending. On a bill you paid, spent is your share, so the rest
 * is shown as money out to them; a repayment is shown as money back, not income. Both count towards
 * what's left, because both really moved. A bill someone else paid ("Paid by …") moved nothing yet,
 * so only your share counts, as spent.
 */
export interface MyMonth {
  salary: number;
  otherIncome: number;
  moneyIn: number;
  spent: number;
  categories: { categoryId: string | null; name: string; total: number }[];
  saved: { label: string; amount: number }[];
  savedTotal: number;
  /** People: others' share of bills you paid this month, and repayments that reached an account. */
  people: { billsShare: number; repaid: number };
  leftOver: number;
  /** What the budget leaves over. Null when no budget is set for this month. */
  afterBudget: { setAside: number; free: number } | null;
  /** Transactions dated this month still waiting for review, so not in these numbers. */
  waitingForReview: number;
}

const NOT_PUT_AWAY = `status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
  AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
  AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id)`;

export async function getMyMonth(userId: string, month: string): Promise<MyMonth> {
  const db = getDatabase();
  const { startDate, endDate } = getMonthDateRange(month);
  const amount = effectiveAmountSql("expenses");

  const [allIn, repaid, salary, put, byCategory, spotted, waiting, categories, others] = await Promise.all([
    moneyIn(userId, startDate, endDate),
    repaymentsIn(userId, startDate, endDate),
    salaryIn(userId, startDate, endDate),
    invested(userId, startDate, endDate),
    db.getAllAsync<{ category_id: string | null; total: number }>(
      `SELECT category_id, SUM(${amount}) AS total FROM expenses
       WHERE user_id = ? AND date >= ? AND date <= ? AND ${NOT_PUT_AWAY}
         AND COALESCE(money_event, '') NOT IN ('fd_open', 'sip', 'self_transfer')
       GROUP BY category_id ORDER BY total DESC;`,
      userId, startDate, endDate,
    ),
    db.getAllAsync<{ money_event: string; total: number }>(
      `SELECT money_event, SUM(${amount}) AS total FROM expenses
       WHERE user_id = ? AND date >= ? AND date <= ? AND ${NOT_PUT_AWAY}
         AND money_event IN ('fd_open', 'sip')
       GROUP BY money_event;`,
      userId, startDate, endDate,
    ),
    db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM expenses
       WHERE user_id = ? AND date >= ? AND date <= ? AND status = 'pending_review'
         AND nature IN ('realized', 'credit') AND deleted_at IS NULL;`,
      userId, startDate, endDate,
    ),
    getCategories(userId),
    db.getFirstAsync<{ total: number | null }>(
      `SELECT SUM(split_original_amount - amount) AS total FROM expenses
       WHERE user_id = ? AND date >= ? AND date <= ? AND ${NOT_PUT_AWAY}
         AND household_ref IS NULL AND split_original_amount > amount;`,
      userId, startDate, endDate,
    ),
  ]);
  const totalIn = Math.max(0, allIn - repaid);
  const billsShare = others?.total ?? 0;
  const peopleNet = repaid - billsShare;
  const budgets = await getBudgetsForMonth(userId, month);

  const names = new Map(categories.map((c) => [c.id, c.name]));
  const spentRows = byCategory
    .filter((r) => r.total > 0)
    .map((r) => ({
      categoryId: r.category_id,
      name: r.category_id ? (names.get(r.category_id) ?? "Other") : "Uncategorized",
      total: r.total,
    }));
  const spent = spentRows.reduce((s, r) => s + r.total, 0);

  const eventTotal = (event: string) => spotted.find((r) => r.money_event === event)?.total ?? 0;
  const saved = [
    { label: "Fixed deposits", amount: eventTotal("fd_open") },
    { label: "SIPs", amount: eventTotal("sip") },
    { label: "Linked to goals", amount: put.linked },
    { label: "Moved to investment accounts", amount: put.transfers },
  ].filter((s) => s.amount > 0);
  const savedTotal = saved.reduce((s, r) => s + r.amount, 0);

  return {
    salary,
    otherIncome: Math.max(0, totalIn - salary),
    moneyIn: totalIn,
    spent,
    categories: spentRows,
    saved,
    savedTotal,
    people: { billsShare, repaid },
    leftOver: totalIn + peopleNet - spent - savedTotal,
    afterBudget: budgetLeaves(totalIn + peopleNet, savedTotal, budgets, spentRows),
    waitingForReview: waiting?.n ?? 0,
  };
}

/**
 * What's free after the budget. Each category holds back its budget, or what's been spent if that's
 * more: money already overspent isn't free, and neither is spending with no budget against it.
 */
function budgetLeaves(
  available: number,
  savedTotal: number,
  budgets: { category_id: string; amount: number }[],
  spentRows: { categoryId: string | null; total: number }[],
): MyMonth["afterBudget"] {
  if (budgets.length === 0) return null;
  const held = new Map<string | null, number>();
  for (const b of budgets) held.set(b.category_id, b.amount);
  for (const r of spentRows) held.set(r.categoryId, Math.max(held.get(r.categoryId) ?? 0, r.total));
  const setAside = [...held.values()].reduce((s, v) => s + v, 0);
  return { setAside, free: available - setAside - savedTotal };
}

export interface MonthAccount {
  id: string;
  name: string;
  balance: number;
}

/**
 * Bank and wallet balances at the end of the month, worked out the way the accounts screens do. Only
 * for the full page: each account is its own query, so it stays off Home. An account that can't be
 * worked out is left out rather than losing the rest.
 */
export async function getMonthAccounts(userId: string, month: string): Promise<MonthAccount[]> {
  const accounts = (await getActiveAccounts(userId)).filter((a) => a.account_type === "savings" || a.account_type === "wallet");
  const rows = await Promise.all(
    accounts.map(async (a) => {
      try {
        const summary = await getMonthBalanceSummary(a.id, month);
        const balance = summary ? summary.closing_balance : (await computeUnseededBalance(a.id, month)).closing;
        return { id: a.id, name: a.account_label || `${a.bank_name} ••••${a.account_identifier}`, balance };
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((r): r is MonthAccount => r !== null);
}

/**
 * Where you stand with people right now, and the household's shared total for the month. For reading
 * only, none of it is in the sums above. Each part fails alone, so the page still shows the rest.
 */
export async function getMonthPeople(userId: string, month: string): Promise<{ owedToYou: number; youOwe: number; together: number | null }> {
  const [hisaab, statement] = await Promise.all([
    getHisaabSummary(userId).catch(() => null),
    getFlag("household") ? getStatement(month).catch(() => null) : Promise.resolve(null),
  ]);
  return { owedToYou: hisaab?.totalOwedToYou ?? 0, youOwe: hisaab?.totalYouOwe ?? 0, together: statement?.together ?? null };
}
