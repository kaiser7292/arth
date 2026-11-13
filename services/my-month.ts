import { getDatabase } from "@/database";
import { computeUnseededBalance, getMonthBalanceSummary } from "@/services/account-balance";
import { getBudgetsForMonth } from "@/services/budget";
import { getCategories } from "@/services/category";
import { effectiveAmountSql } from "@/services/expense-effective-amount";
import { getActiveAccounts } from "@/services/financial-account";
import { invested, moneyIn, repaymentsIn } from "@/services/reports/year-review";
import { getMonthSalaryState, getSalaryForMonth } from "@/services/salary-periods";
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
  /** Salary counted for this month, which may have arrived in a neighbouring one (the salary setting). */
  salary: number;
  /** Salary that arrived during this month but counts for another. Shown so the bank still adds up. */
  salaryMovedOut: number;
  otherIncome: number;
  moneyIn: number;
  spent: number;
  categories: { categoryId: string | null; name: string; total: number }[];
  /** `section` is which list of transactions a line opens. */
  saved: { label: string; amount: number; section: "fd" | "sip" | "linked" | "transfers" }[];
  savedTotal: number;
  /** This month's salary hasn't come yet but isn't late: going over so far says nothing yet. */
  salaryDue: { date: string; amount: number } | null;
  /** This month's salary is past due, or just not tagged as salary. */
  salaryMissing: boolean;
  /** People: others' share of bills you paid this month, and repayments that reached an account. */
  people: { billsShare: number; repaid: number };
  /**
   * Balance adjustments (ledger "[Balance Adjustment ±]" entries on bank, wallet and card accounts):
   * money that moved without a transaction Arth saw. Counted in money in and out, never in a budget.
   * In = more in a bank or wallet, or less owed on a card; out = the other way.
   */
  adjustedIn: number;
  adjustedOut: number;
  leftOver: number;
  /** What the budget leaves over, on the month's total. Null when no budget is set for this month. */
  afterBudget: { budget: number; overspend: number; free: number } | null;
  /** Transactions dated this month still waiting for review, so not in these numbers. */
  waitingForReview: number;
}

/** Label of the money in / money out line for balance adjustments, shared by the screens. */
export const BALANCE_ADJUSTMENTS = "Balance adjustments";

/**
 * Balance adjustments that count in money in and out: ledger "[Balance Adjustment ±]" entries on
 * bank, wallet and card accounts (not pensions or investments, and not opening-balance fixes).
 * Takes user id, start date, end date; `e` is the entry, `fa` its account.
 */
export const BALANCE_ADJUSTMENTS_FROM = `FROM expenses e
       JOIN financial_accounts fa ON fa.id = e.account_id
       WHERE e.user_id = ? AND e.date >= ? AND e.date <= ?
         AND e.nature = 'ledger_adjustment' AND e.status = 'approved' AND e.deleted_at IS NULL
         AND e.description LIKE '[Balance Adjustment%'
         AND fa.account_type IN ('savings', 'bank', 'wallet', 'credit_card')`;

/** "+" raises the account's closing: more money in a bank or wallet (in), more owed on a card (out). */
export function isAdjustmentMoneyIn(description: string | null, accountType: string): boolean {
  const raises = !(description ?? "").includes(" -]");
  return accountType === "credit_card" ? !raises : raises;
}

export const REAL_DEBIT = `status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
  AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)`;
export const NOT_PUT_AWAY = `${REAL_DEBIT}
  AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = expenses.id)`;
/** What's left of a debit after the part linked to goals, which counts as saved instead. */
export const LINKED_PART = `COALESCE((SELECT SUM(l.contribution_amount) FROM expense_investment_links l WHERE l.expense_id = expenses.id), 0)`;

export async function getMyMonth(userId: string, month: string): Promise<MyMonth> {
  const db = getDatabase();
  const { startDate, endDate } = getMonthDateRange(month);
  const amount = effectiveAmountSql("expenses");

  const [allIn, repaid, salary, put, byCategory, spotted, waiting, categories, others, adjusted] = await Promise.all([
    moneyIn(userId, startDate, endDate),
    repaymentsIn(userId, startDate, endDate),
    getSalaryForMonth(userId, month),
    invested(userId, startDate, endDate),
    db.getAllAsync<{ category_id: string | null; total: number }>(
      `SELECT category_id, SUM(MAX(0, ${amount} - ${LINKED_PART})) AS total FROM expenses
       WHERE user_id = ? AND date >= ? AND date <= ? AND ${REAL_DEBIT}
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
    db.getAllAsync<{ amount: number; description: string | null; account_type: string }>(
      `SELECT e.amount, e.description, fa.account_type ${BALANCE_ADJUSTMENTS_FROM};`,
      userId, startDate, endDate,
    ),
  ]);
  let adjustedIn = 0;
  let adjustedOut = 0;
  for (const a of adjusted) {
    if (isAdjustmentMoneyIn(a.description, a.account_type)) adjustedIn += a.amount;
    else adjustedOut += a.amount;
  }
  const otherIncome = Math.max(0, allIn - salary.arrived);
  const totalIn = otherIncome + salary.counted;
  const billsShare = others?.total ?? 0;
  const peopleNet = repaid - billsShare;
  const budgets = await getBudgetsForMonth(userId, month);
  // Only colours the wording, so it can't be allowed to stop the month loading.
  const salaryState = await getMonthSalaryState(userId, month).catch(() => null);

  const names = new Map(categories.map((c) => [c.id, c.name]));
  const spentRows = byCategory
    .filter((r) => r.total >= 0.005)
    .map((r) => ({
      categoryId: r.category_id,
      name: r.category_id ? (names.get(r.category_id) ?? "Other") : "Uncategorized",
      total: r.total,
    }));
  const spent = spentRows.reduce((s, r) => s + r.total, 0);

  const eventTotal = (event: string) => spotted.find((r) => r.money_event === event)?.total ?? 0;
  const saved = [
    { label: "Fixed deposits", amount: eventTotal("fd_open"), section: "fd" as const },
    { label: "SIPs", amount: eventTotal("sip"), section: "sip" as const },
    { label: "Linked to goals", amount: put.linked, section: "linked" as const },
    { label: "Moved to investment accounts", amount: put.transfers, section: "transfers" as const },
  ].filter((s) => s.amount > 0);
  const savedTotal = saved.reduce((s, r) => s + r.amount, 0);

  return {
    salary: salary.counted,
    salaryMovedOut: Math.max(0, salary.arrived - salary.counted),
    otherIncome,
    moneyIn: totalIn + adjustedIn,
    spent,
    categories: spentRows,
    saved,
    savedTotal,
    salaryDue: salaryState?.state === "due" ? { date: salaryState.date, amount: salaryState.amount } : null,
    salaryMissing: salaryState?.state === "missing",
    people: { billsShare, repaid },
    adjustedIn,
    adjustedOut,
    leftOver: totalIn + adjustedIn + peopleNet - spent - savedTotal - adjustedOut,
    afterBudget: budgetLeaves(totalIn + adjustedIn - adjustedOut + peopleNet, savedTotal, spent, budgets),
    waitingForReview: waiting?.n ?? 0,
  };
}

/**
 * What's free after the budget, on totals only: the whole budget is held back, and if spending has
 * passed the whole budget, the overspend is too. Categories don't come into it, so being over in one
 * and under in another nets out.
 */
function budgetLeaves(available: number, savedTotal: number, spent: number, budgets: { amount: number }[]): MyMonth["afterBudget"] {
  if (budgets.length === 0) return null;
  const budget = budgets.reduce((s, b) => s + b.amount, 0);
  const overspend = Math.max(0, spent - budget);
  return { budget, overspend, free: available - budget - overspend - savedTotal };
}

export interface MonthAccount {
  id: string;
  name: string;
  balance: number;
  type: "savings" | "wallet";
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
        return { id: a.id, name: a.account_label || `${a.bank_name} ••••${a.account_identifier}`, balance, type: a.account_type as MonthAccount["type"] };
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((r): r is MonthAccount => r !== null);
}
