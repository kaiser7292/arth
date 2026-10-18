/**
 * Export for AI Insights - a small, clean copy of the user's finances that an AI assistant can
 * read. See docs/AI_EXPORT_PROPOSAL.md.
 *
 * Two rules hold this file together:
 *
 *  1. ALLOW-LIST. Every field written is named here, one by one. Nothing is copied wholesale from
 *     a table, so a column added to the database later stays out until someone adds it on purpose.
 *     The password vault, SMS text, scan logs and credentials are never read at all.
 *     `AI_EXPORT_KEYS` is the full list of keys the file may contain; a test fails on any other.
 *
 *  2. THE APP'S OWN FIGURES. Totals come from the same service functions the screens use
 *     (balances, spending, budgets, loans, net worth), so an AI's answers match what Arth shows.
 *
 * The export only reads. It never writes to the database - which is why month balances are
 * chained here from the stored openings instead of through getMonthBalanceSummary (that one
 * creates and re-anchors rows as a side effect of being looked at).
 */

import { getDatabase } from "@/database";
import {
  computeClosing,
  getAccountAdjustmentNet,
  getAccountCreditsTotal,
  getAccountExpensesTotal,
  getEarliestAccountActivity,
} from "@/services/account-balance";
import { getTransfersInTotal, getTransfersOutTotal } from "@/services/account-transfer";
import { getBalanceSheetColumn, type BalanceSheetRow } from "@/services/balance-sheet";
import { getBudgetVsActual } from "@/services/budget";
import { getMonthlyExpenseTotals } from "@/services/expense-queries";
import {
  AI_REQUESTS,
  buildReplyInstructions,
  isFullSetup,
  shortRef,
  type AiRequestId,
} from "@/services/ai-reply-format";
import { getAllAccounts, type FinancialAccount } from "@/services/financial-account";
import { getEntriesByDateRangeAsc, getPersonsWithBalances } from "@/services/hisaab";
import { getLifeMilestones } from "@/services/life-milestone";
import { getCurrency } from "@/services/locale-preferences";
import {
  getCurrentEMIsByLoanId,
  getLoanOutstandingsByLoanId,
  getPrepaymentsByLoanIds,
  getSchedulesByLoanIds,
  listAllLoansWithBankName,
} from "@/services/loan-accounts";
import { getSalaryProfileByFY } from "@/services/salary-profile";
import { getSavingsSnapshot } from "@/services/savings-tracker";
import { listUnrecognisedSms, listUserTemplates } from "@/services/sms/user-sms-templates";
import { listMerchantRules } from "@/services/merchant-categories";
import { listRules } from "@/services/smart-rules";
import { getFYStartMonth } from "@/services/settings";
import { getAllActiveBuckets, getYearlyPlanByFY } from "@/services/yearly-plan";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { toIsoDate } from "@/utils/date";
import { getCurrentFY, getFYLabel, getFYRange } from "@/utils/fiscal-year";

// ─── Options ──────────────────────────────────────────────────────────────────

export interface AiExportSections {
  summary: boolean;
  transactions: boolean;
  accounts: boolean;
  budgets: boolean;
  loans: boolean;
  investments: boolean;
  netWorth: boolean;
  /** Free-text notes on transactions, transfers and hisaab entries. Off by default. */
  notes: boolean;
  /** Family ledger. Names other people, so off by default. */
  hisaab: boolean;
}

export interface AiExportOptions {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  /** YYYY-MM-DD, inclusive. */
  to: string;
  sections: AiExportSections;
  hidePeopleNames: boolean;
  hideMerchantNames: boolean;
  /**
   * Ask the assistant for changes, not only answers. Adds the request, the reply format, a
   * reference on every transaction, and the category and merchant lists the assistant needs.
   */
  suggest?: {
    request: AiRequestId;
    /** Also include entries still waiting in the review queue (used for first-time setup). */
    includeUnreviewed?: boolean;
    /** Also include bank messages Arth could not read, as received, so templates can be suggested. */
    includeUnreadMessages?: boolean;
  };
}

export const DEFAULT_AI_EXPORT_SECTIONS: AiExportSections = {
  summary: true,
  transactions: true,
  accounts: true,
  budgets: true,
  loans: true,
  investments: true,
  netWorth: true,
  notes: false,
  hisaab: false,
};

export type AiExportPeriodPreset = "this_fy" | "last_fy" | "last_12_months" | "all_time";

/** Turn a period chip into a date range. Never runs past today. */
export async function resolveAiExportPeriod(
  preset: AiExportPeriodPreset,
  userId: string,
  today: Date = new Date(),
): Promise<{ from: string; to: string }> {
  const todayIso = toIsoDate(today);
  const fyStart = getFYStartMonth();
  const fy = getCurrentFY(fyStart, today);

  if (preset === "this_fy") {
    return { from: toIsoDate(getFYRange(fy, fyStart).start), to: todayIso };
  }
  if (preset === "last_fy") {
    const { start, end } = getFYRange(fy - 1, fyStart);
    return { from: toIsoDate(start), to: toIsoDate(end) };
  }
  if (preset === "last_12_months") {
    return { from: toIsoDate(new Date(today.getFullYear(), today.getMonth() - 11, 1)), to: todayIso };
  }
  const row = await getDatabase().getFirstAsync<{ first: string | null }>(
    `SELECT MIN(date) as first FROM expenses
     WHERE user_id = ? AND status IN ('approved', 'pending_review') AND deleted_at IS NULL;`,
    userId,
  );
  return { from: row?.first ?? todayIso, to: todayIso };
}

// ─── Output shape ─────────────────────────────────────────────────────────────

/**
 * Every key the export file is allowed to contain, at any depth. Adding a field to the export
 * means adding its key here too - the allow-list test compares the two.
 */
export const AI_EXPORT_KEYS = [
  // top level
  "guide", "generated_on", "period", "currency", "monthly_summary", "financial_years", "accounts",
  "transfers", "transactions", "budgets", "loans", "investments", "net_worth", "hisaab",
  // shared
  "from", "to", "month", "date", "amount", "name", "type", "note",
  // monthly_summary
  "spending", "income", "refunds", "invested", "loan_payments",
  // financial_years
  "financial_year", "income_so_far", "saved", "savings_rate_pct", "target_savings_rate_pct",
  // accounts
  "id", "bank", "last4", "credit_limit", "closed", "balances", "opening", "closing",
  // transactions
  "kind", "income_type", "category", "merchant", "account", "mode", "tags", "full_amount",
  // budgets
  "total_budget", "total_spent", "by_category", "no_budget_set", "by_month", "budget", "spent",
  // loans
  "lender", "loan_type", "amount_borrowed", "interest_rate_pct", "interest_type", "tenure_months",
  "emi", "first_emi_date", "last_emi_date", "outstanding", "status", "closed_on", "prepayments",
  "effect",
  // investments
  "buckets", "annual_target", "contributed", "contributions", "bucket", "goals", "target_amount",
  "target_date", "completed",
  // net worth
  "as_of", "assets", "liabilities", "total_assets", "total_liabilities",
  // hisaab
  "people", "balance", "entries", "person",
  // only when the user asks for suggestions
  "request", "reply_instructions", "categories", "merchants", "unread_messages", "ref", "reviewed",
  "sender", "text", "similar",
  // what's already set up (sent with every suggestion request)
  "current_setup", "monthly_income", "pay_day", "expected_bonus", "savings_target_pct",
  "monthly_budgets", "investment_buckets", "merchant_rules", "smart_rules", "message_templates",
  "accounts_set_up", "active",
] as const;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined };
type JsonObject = { [key: string]: Json | undefined };

export interface AiExportResult {
  data: JsonObject;
  counts: { transactions: number; accounts: number; months: number; unreadMessages: number };
  /** Sections that were asked for but failed to build, in plain words. The rest is still exported. */
  skipped: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const r2 = (n: number | null | undefined): number => Math.round((n ?? 0) * 100) / 100;

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthsBetween(fromMonth: string, toMonth: string): string[] {
  const out: string[] = [];
  for (let cur = fromMonth; cur <= toMonth; cur = nextMonth(cur)) out.push(cur);
  return out;
}

/** Only ever the last four characters - a full account number never reaches the file. */
function last4(identifier: string | null | undefined): string | null {
  const s = String(identifier ?? "").replace(/\s+/g, "");
  return s ? s.slice(-4) : null;
}

/** Short ids (a1, a2, ...) so the file carries no database ids. */
class AccountRefs {
  private readonly refs = new Map<string, string>();
  private readonly byId: Map<string, FinancialAccount>;
  readonly used: FinancialAccount[] = [];

  constructor(accounts: FinancialAccount[]) {
    this.byId = new Map(accounts.map((a) => [a.id, a]));
    // Live accounts first so they get the low numbers; removed ones join only if a row names them.
    for (const a of accounts) if (a.is_active) this.ref(a.id);
  }

  ref(accountId: string | null | undefined): string | null {
    if (!accountId) return null;
    const known = this.refs.get(accountId);
    if (known) return known;
    const account = this.byId.get(accountId);
    if (!account) return null;
    const ref = `a${this.refs.size + 1}`;
    this.refs.set(accountId, ref);
    this.used.push(account);
    return ref;
  }

  name(accountId: string | null | undefined): string | null {
    const account = accountId ? this.byId.get(accountId) : undefined;
    return account ? account.account_label || account.bank_name : null;
  }
}

// ─── Balances (read-only chain) ───────────────────────────────────────────────

/**
 * Opening and closing balance for each month from `fromMonth` to `toMonth`.
 *
 * Same arithmetic as the account ledger:
 *  - Seeded account (has stored openings): start at the earliest stored opening and carry each
 *    month's closing into the next month's opening. A month the user set by hand keeps its
 *    stored opening.
 *  - Unseeded account: start at 0 in the first month with any activity (computeUnseededBalance).
 *
 * Months before the chain starts have no known balance and are left out.
 */
async function chainMonthBalances(
  account: FinancialAccount,
  fromMonth: string,
  toMonth: string,
): Promise<JsonObject[]> {
  const stored = await getDatabase().getAllAsync<{
    month: string;
    opening_balance: number;
    is_manual_override: number;
  }>(
    `SELECT month, opening_balance, is_manual_override FROM account_month_balances
     WHERE account_id = ? ORDER BY month ASC;`,
    account.id,
  );
  const seeded = stored.length > 0;

  let start: string;
  if (seeded) {
    start = stored[0].month;
  } else {
    const earliest = await getEarliestAccountActivity(account.id);
    if (!earliest) return [];
    start = earliest.substring(0, 7);
  }

  const storedByMonth = new Map(stored.map((s) => [s.month, s]));
  // The unseeded path in the app uses the plain balance formula for every account type.
  const isCC = seeded && account.account_type === "credit_card";
  const out: JsonObject[] = [];
  let prevClosing: number | null = null;

  for (let cur = start; cur <= toMonth; cur = nextMonth(cur)) {
    const row = storedByMonth.get(cur);
    const opening: number =
      row && (row.is_manual_override === 1 || prevClosing === null)
        ? row.opening_balance
        : prevClosing ?? 0;

    const { startDate, endDate } = getMonthDateRange(cur);
    const [expenses, credits, transfersOut, transfersIn, adjustmentNet] = await Promise.all([
      getAccountExpensesTotal(account.id, startDate, endDate),
      getAccountCreditsTotal(account.id, startDate, endDate),
      getTransfersOutTotal(account.id, startDate, endDate),
      getTransfersInTotal(account.id, startDate, endDate),
      getAccountAdjustmentNet(account.id, startDate, endDate),
    ]);
    const closing = computeClosing({ opening, expenses, credits, transfersOut, transfersIn, adjustmentNet, isCC });

    if (cur >= fromMonth) out.push({ month: cur, opening: r2(opening), closing: r2(closing) });
    prevClosing = closing;
  }
  return out;
}

// ─── Sections ─────────────────────────────────────────────────────────────────

interface TxnRow {
  id: string;
  date: string;
  amount: number;
  nature: string;
  category_id: string | null;
  payment_mode_id: string | null;
  account_id: string | null;
  merchant_name: string | null;
  description: string | null;
  split_original_amount: number | null;
  refund_of_expense_id: string | null;
  credit_kind: string | null;
  status: string;
}

type TxnKind = "spend" | "investment" | "loan_payment" | "income" | "refund";

/**
 * Approved, not deleted, real money in or out. Transfers between own accounts are separate.
 * `includeUnreviewed` adds entries still in the review queue (first-time setup only).
 */
async function loadTransactions(userId: string, from: string, to: string, includeUnreviewed = false) {
  const db = getDatabase();
  const rows = await db.getAllAsync<TxnRow>(
    `SELECT id, date, amount, nature, category_id, payment_mode_id, account_id, merchant_name,
            description, split_original_amount, refund_of_expense_id, credit_kind, status
     FROM expenses
     WHERE user_id = ? AND status IN (${includeUnreviewed ? "'approved', 'pending_review'" : "'approved'"})
       AND deleted_at IS NULL
       AND nature IN ('realized', 'credit')
       AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
       AND date >= ? AND date <= ?
     ORDER BY date ASC, created_at ASC;`,
    userId, from, to,
  );

  const [categories, modes, tagRows, investmentLinks, loanLinks] = await Promise.all([
    db.getAllAsync<{ id: string; name: string }>("SELECT id, name FROM categories WHERE user_id = ?;", userId),
    db.getAllAsync<{ id: string; name: string }>("SELECT id, name FROM payment_modes WHERE user_id = ?;", userId),
    db.getAllAsync<{ expense_id: string; name: string }>(
      `SELECT et.expense_id, t.name FROM expense_tags et
       JOIN tags t ON t.id = et.tag_id
       JOIN expenses e ON e.id = et.expense_id
       WHERE e.user_id = ? AND e.date >= ? AND e.date <= ?;`,
      userId, from, to,
    ),
    db.getAllAsync<{ expense_id: string }>("SELECT DISTINCT expense_id FROM expense_investment_links;"),
    db.getAllAsync<{ expense_id: string }>("SELECT DISTINCT expense_id FROM expense_loan_links;"),
  ]);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const modeName = new Map(modes.map((m) => [m.id, m.name]));
  const tagsByExpense = new Map<string, string[]>();
  for (const t of tagRows) {
    const list = tagsByExpense.get(t.expense_id) ?? [];
    list.push(t.name);
    tagsByExpense.set(t.expense_id, list);
  }
  const invested = new Set(investmentLinks.map((l) => l.expense_id));
  const loanPaid = new Set(loanLinks.map((l) => l.expense_id));

  const kindOf = (r: TxnRow): TxnKind => {
    if (r.nature === "credit") {
      return r.refund_of_expense_id || r.credit_kind === "refund" ? "refund" : "income";
    }
    if (invested.has(r.id)) return "investment";
    if (loanPaid.has(r.id)) return "loan_payment";
    return "spend";
  };

  return { rows, kindOf, categoryName, modeName, tagsByExpense };
}

async function buildLoans(userId: string, asOf: string): Promise<JsonObject[]> {
  const loans = await listAllLoansWithBankName(userId);
  if (loans.length === 0) return [];
  const ids = loans.map((l) => l.id);
  const [outstanding, emis, schedules, prepayments] = await Promise.all([
    getLoanOutstandingsByLoanId(userId, asOf),
    getCurrentEMIsByLoanId(userId, asOf),
    getSchedulesByLoanIds(ids),
    getPrepaymentsByLoanIds(ids),
  ]);
  return loans.map((l) => {
    const schedule = schedules.get(l.id) ?? [];
    return {
      lender: l.bank_name,
      loan_type: l.loan_type,
      status: l.status,
      amount_borrowed: r2(l.principal_disbursed),
      interest_rate_pct: l.interest_rate_pa,
      interest_type: l.interest_type,
      tenure_months: l.tenure_months,
      emi: r2(emis.get(l.id) ?? l.emi_amount),
      first_emi_date: l.emi_start_date,
      last_emi_date: schedule.length > 0 ? schedule[schedule.length - 1].due_date : null,
      outstanding: r2(outstanding.get(l.id)),
      closed_on: l.closed_date,
      prepayments: (prepayments.get(l.id) ?? []).map((p) => ({
        date: p.prepayment_date,
        amount: r2(p.amount),
        effect: p.strategy,
      })),
    };
  });
}

async function buildInvestments(userId: string, from: string, to: string): Promise<JsonObject> {
  const [buckets, milestones, contributions] = await Promise.all([
    getAllActiveBuckets(userId),
    getLifeMilestones(userId),
    getDatabase().getAllAsync<{ date: string; amount: number; name: string }>(
      `SELECT c.date, c.amount, b.name FROM investment_contributions c
       JOIN investment_buckets b ON b.id = c.investment_bucket_id
       WHERE b.user_id = ? AND c.status = 'approved' AND c.date >= ? AND c.date <= ?
       ORDER BY c.date ASC;`,
      userId, from, to,
    ),
  ]);
  return {
    buckets: buckets.map((b) => ({
      name: b.name,
      type: b.bucket_type,
      financial_year: b.financial_year,
      annual_target: r2(b.annual_target),
      contributed: r2(b.current_contributed),
    })),
    contributions: contributions.map((c) => ({ date: c.date, bucket: c.name, amount: r2(c.amount) })),
    goals: milestones.map((m) => ({
      name: m.name,
      target_amount: r2(m.target_amount),
      saved: r2(m.current_saved),
      target_date: m.target_date,
      completed: m.is_completed === 1,
    })),
  };
}

async function buildNetWorth(
  userId: string,
  from: string,
  to: string,
  isToday: boolean,
  refs: AccountRefs,
): Promise<JsonObject> {
  const column = await getBalanceSheetColumn(userId, to, "", isToday, isToday ? null : from);
  // Account rows are renamed from our own account list, so the app's on-screen label (which can
  // carry the whole account identifier) never reaches the file.
  const toRows = (rows: BalanceSheetRow[]): JsonObject[] =>
    rows.flatMap((row) => [
      { name: refs.name(row.accountId) ?? row.label, type: row.group, amount: r2(row.amount) },
      ...toRows(row.children ?? []),
    ]);
  return {
    as_of: column.asOfDate,
    assets: toRows(column.assets),
    liabilities: toRows(column.liabilities),
    total_assets: r2(column.totalAssets),
    total_liabilities: r2(column.totalLiabilities),
    net_worth: r2(column.netWorth),
  };
}

async function buildHisaab(
  userId: string,
  from: string,
  to: string,
  hideNames: boolean,
  withNotes: boolean,
): Promise<JsonObject> {
  const persons = await getPersonsWithBalances(userId);
  const label = new Map(persons.map((p, i) => [p.id, hideNames ? `Person ${i + 1}` : p.name]));
  const entries: JsonObject[] = [];
  for (const p of persons) {
    for (const e of await getEntriesByDateRangeAsc(p.id, from, to)) {
      entries.push({
        date: e.date,
        person: label.get(p.id) ?? null,
        type: e.type,
        amount: r2(e.amount),
        ...(withNotes ? { note: e.description || null } : {}),
      });
    }
  }
  entries.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return {
    people: persons.map((p) => ({ name: label.get(p.id) ?? null, balance: r2(p.balance) })),
    entries,
  };
}

// ─── Sections added when the user asks for suggestions ────────────────────────

const MAX_MERCHANTS = 300;
const MAX_MESSAGE_FORMATS = 40;
const EXAMPLES_PER_FORMAT = 2;
const ONE_TIME_CODE = /\b(otp|one[\s-]?time\s+(password|passcode|pin)|verification\s+code|do\s+not\s+share)\b/i;

/** Merchants by number of entries, each with the category most of its entries sit in. */
function buildMerchants(txns: Awaited<ReturnType<typeof loadTransactions>>): JsonObject[] {
  const byMerchant = new Map<string, { name: string; entries: number; amount: number; cats: Map<string, number> }>();
  for (const r of txns.rows) {
    if (!r.merchant_name || txns.kindOf(r) !== "spend") continue;
    const key = r.merchant_name.trim().toLowerCase();
    const m = byMerchant.get(key) ?? { name: r.merchant_name.trim(), entries: 0, amount: 0, cats: new Map() };
    m.entries += 1;
    m.amount += r.amount;
    const cat = (r.category_id && txns.categoryName.get(r.category_id)) || "";
    m.cats.set(cat, (m.cats.get(cat) ?? 0) + 1);
    byMerchant.set(key, m);
  }
  return [...byMerchant.values()]
    .sort((a, b) => b.entries - a.entries || b.amount - a.amount)
    .slice(0, MAX_MERCHANTS)
    .map((m) => ({
      merchant: m.name,
      entries: m.entries,
      amount: r2(m.amount),
      category: [...m.cats.entries()].sort((a, b) => b[1] - a[1])[0][0] || null,
    }));
}

/**
 * Bank messages Arth could not read, as received: up to two examples of each format, so an
 * assistant can tell the fixed wording from the parts that change. One-time codes are left out.
 * Reads only `pending_sms`; never the scan logs.
 */
async function buildUnreadMessages(): Promise<JsonObject[]> {
  const rows = await listUnrecognisedSms(2000);
  const formats = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.body || ONE_TIME_CODE.test(row.body)) continue;
    const sender = row.address.toUpperCase().match(/[A-Z]{4,}/)?.[0] ?? row.address.toUpperCase();
    // Same sender and same opening words (numbers aside) = same format.
    const opening = row.body.replace(/\d+/g, "0").toLowerCase().split(/\s+/).slice(0, 4).join(" ");
    const key = `${sender}|${opening}`;
    formats.set(key, [...(formats.get(key) ?? []), row]);
  }
  return [...formats.values()]
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_MESSAGE_FORMATS)
    .flatMap((group) =>
      group.slice(0, EXAMPLES_PER_FORMAT).map((row) => ({
        id: shortRef("s", row.id),
        sender: row.address,
        text: row.body,
        similar: group.length,
      })),
    );
}

// ─── Guide (read by the AI, not by the user) ──────────────────────────────────

function buildGuide(has: (key: string) => boolean, fyStartMonth: number): string[] {
  const monthName = new Date(2000, fyStartMonth - 1, 1).toLocaleString("en-US", { month: "long" });
  const lines = [
    "This file is a personal finance export from the Arth app, made by the user so an AI assistant can analyse their money. It is a partial copy: only the sections listed below are present, and only for the stated period.",
    "All amounts are in the user's home currency (see `currency`) and are positive numbers; the field or `kind` tells you the direction. Dates are YYYY-MM-DD and months are YYYY-MM.",
    `The user's financial year starts in ${monthName}.`,
  ];
  if (has("transactions")) {
    lines.push(
      "`transactions` holds the user's entries, one per row, every row with the same fields (null means not applicable). `kind` is one of: spend (ordinary spending), investment (money put into an investment, not spending), loan_payment (an EMI or prepayment, not ordinary spending), income (money received; `income_type` says salary, interest and so on when known), refund (money returned for an earlier spend). For a spend shared with someone else, `amount` is the user's own share and `full_amount` is what actually left the account.",
    );
  }
  if (has("monthly_summary")) {
    lines.push(
      "`monthly_summary.spending` is Arth's own monthly spending figure: refunds are already taken off, and investments and moves between the user's own accounts are not counted. Use it instead of adding up transactions yourself. `income`, `refunds`, `invested` and `loan_payments` are simple totals of the transactions of that kind.",
    );
  }
  if (has("financial_years")) {
    lines.push(
      "`financial_years` is the savings picture Arth shows the user: `income_so_far` comes from the salary the user planned for the year (not from bank credits), and `saved` is that income minus spending.",
    );
  }
  if (has("accounts")) {
    lines.push(
      "`accounts` lists the user's accounts; transactions and transfers refer to them by `id`. `balances` gives opening and closing balance per month. For a credit_card account the balance is the amount owed (higher is worse); for every other type it is money the user has. `transfers` are moves between the user's own accounts (including credit card bill payments) - they are neither spending nor income.",
    );
  }
  if (has("budgets")) {
    lines.push("`budgets` compares the budget the user set with what they spent, over the whole period and month by month.");
  }
  if (has("loans")) lines.push("`loans.outstanding` is the principal still owed at the end of the period; `emi` is the current monthly instalment.");
  if (has("investments")) {
    lines.push("`investments.buckets` are yearly investment targets and how much has gone in; `goals` are long-term savings goals.");
  }
  if (has("net_worth")) lines.push("`net_worth` is assets minus liabilities on the `as_of` date, as shown on Arth's balance sheet.");
  if (has("hisaab")) {
    lines.push(
      "`hisaab` is money lent to and borrowed from friends and family. A positive `balance` means that person owes the user. Entry type debit raises what they owe; credit and settlement lower it.",
    );
  }
  if (has("merchants")) {
    lines.push(
      "`categories` is the user's full category list. `merchants` lists the merchants they spend at, with the number of entries, the total, and the category most of those entries are in now (null means none).",
    );
  }
  if (has("unread_messages")) {
    lines.push(
      "`unread_messages` are bank messages Arth could not read, exactly as received. `similar` is how many messages share that format; up to two examples of each format are given.",
    );
  }
  if (has("current_setup")) {
    lines.push(
      "`current_setup` is what the user has ALREADY set up in Arth: take-home income per month, pay day, expected bonus and savings target for the current financial year (null or 0 means not set yet), this month's budgets per category, investment buckets, goals, merchant rules they made (merchant -> category), Smart Rules, message templates (by sender) and their accounts. Build on it: do not suggest anything that already exists, keep their category names and structure, and only suggest a change to something already set when the data shows it is wrong or out of date - say why when you do.",
    );
  }
  if (has("request")) {
    lines.push("`request` is what the user wants from you now. `reply_instructions` is the exact format to answer in.");
  }
  lines.push(
    "Anything not in this file (passwords, full account numbers, deleted entries) was left out on purpose. If a question needs data that is not here, say so instead of guessing.",
  );
  return lines;
}

// ─── File layout ──────────────────────────────────────────────────────────────

const NL = String.fromCharCode(10);

/**
 * Standard JSON, laid out with one record per line.
 *
 * Why this shape (see docs/AI_EXPORT_PROPOSAL.md, "File format"): JSON is the one format every
 * assistant both accepts as an upload and can load with code, and in published comparisons it
 * reads at least as accurately as the alternatives, while CSV reads worst and cannot hold the
 * nested sections. One row per line with the same fields in every row is what the assistants'
 * own guidance asks for, and it costs a fraction of fully indented JSON.
 */
export function formatAiExportJson(data: unknown): string {
  const format = (value: unknown, indent: string): string => {
    const inner = `${indent}  `;
    if (Array.isArray(value)) {
      if (value.length === 0) return "[]";
      return `[${NL}${value.map((item) => inner + JSON.stringify(item)).join(`,${NL}`)}${NL}${indent}]`;
    }
    if (value !== null && typeof value === "object") {
      const entries = Object.entries(value).filter(([, v]) => v !== undefined);
      if (entries.length === 0) return "{}";
      const lines = entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`);
      return `{${NL}${lines.join(`,${NL}`)}${NL}${indent}}`;
    }
    return JSON.stringify(value);
  };
  return format(data, "");
}

// ─── Build ────────────────────────────────────────────────────────────────────

export async function buildAiExport(
  userId: string,
  options: AiExportOptions,
  today: Date = new Date(),
): Promise<AiExportResult> {
  const { sections } = options;
  const todayIso = toIsoDate(today);
  const from = options.from;
  const to = options.to > todayIso ? todayIso : options.to;
  if (from > to) throw new Error("The start date is after the end date.");

  const fromMonth = from.substring(0, 7);
  const toMonth = to.substring(0, 7);
  const months = monthsBetween(fromMonth, toMonth);
  const fyStart = getFYStartMonth();

  const skipped: string[] = [];
  /** One section failing must not lose the rest of the file. */
  const attempt = async <T,>(label: string, build: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await build();
    } catch {
      skipped.push(label);
      return undefined;
    }
  };

  const refs = new AccountRefs(await getAllAccounts(userId));

  // Transactions are loaded whenever either section needs them; the summary totals come from them.
  const txns =
    sections.transactions || sections.summary
      ? await attempt("Transactions", () =>
          loadTransactions(userId, from, to, Boolean(options.suggest?.includeUnreviewed)),
        )
      : undefined;
  const suggest = options.suggest;

  let transactions: JsonObject[] | undefined;
  if (sections.transactions && txns) {
    transactions = txns.rows.map((r) => {
      const kind = txns.kindOf(r);
      const tags = txns.tagsByExpense.get(r.id);
      const shared = r.split_original_amount != null && Math.abs(r.split_original_amount - r.amount) >= 0.01;
      // Every row carries the same keys (null when there is nothing to say), so the list reads
      // as a table - for an AI reading it directly and for one loading it with code.
      return {
        ...(suggest ? { ref: shortRef("t", r.id) } : {}),
        ...(suggest?.includeUnreviewed ? { reviewed: r.status === "approved" } : {}),
        date: r.date,
        amount: r2(r.amount),
        kind,
        income_type: kind === "income" ? r.credit_kind || null : null,
        full_amount: shared ? r2(r.split_original_amount) : null,
        category: (r.category_id && txns.categoryName.get(r.category_id)) || null,
        ...(options.hideMerchantNames ? {} : { merchant: r.merchant_name || null }),
        ...(sections.accounts ? { account: refs.ref(r.account_id) } : {}),
        mode: (r.payment_mode_id && txns.modeName.get(r.payment_mode_id)) || null,
        tags: tags ?? [],
        ...(sections.notes ? { note: r.description || null } : {}),
      };
    });
  }

  let monthlySummary: JsonObject[] | undefined;
  let financialYears: JsonObject[] | undefined;
  if (sections.summary) {
    monthlySummary = await attempt("Monthly summary", async () => {
      const spending = await getMonthlyExpenseTotals(userId, from, to);
      const sums = new Map<string, Record<TxnKind, number>>();
      for (const r of txns?.rows ?? []) {
        if (r.status !== "approved") continue; // the summary is what the app shows: approved only
        const month = r.date.substring(0, 7);
        const bucket = sums.get(month) ?? { spend: 0, investment: 0, loan_payment: 0, income: 0, refund: 0 };
        bucket[txns!.kindOf(r)] += r.amount;
        sums.set(month, bucket);
      }
      return months.map((month) => ({
        month,
        spending: r2(spending.get(month)),
        income: r2(sums.get(month)?.income),
        refunds: r2(sums.get(month)?.refund),
        invested: r2(sums.get(month)?.investment),
        loan_payments: r2(sums.get(month)?.loan_payment),
      }));
    });

    financialYears = await attempt("Savings rate", async () => {
      const out: JsonObject[] = [];
      const firstFY = getCurrentFY(fyStart, new Date(`${from}T00:00:00`));
      const lastFY = getCurrentFY(fyStart, new Date(`${to}T00:00:00`));
      for (let fy = firstFY; fy <= lastFY; fy++) {
        const snapshot = await getSavingsSnapshot(userId, fy);
        if (!snapshot) continue; // no yearly plan for that year, so Arth shows no savings rate either
        out.push({
          financial_year: getFYLabel(fy, fyStart),
          income_so_far: r2(snapshot.incomeReceived),
          spending: r2(snapshot.totalExpenses),
          saved: r2(snapshot.actualSaved),
          savings_rate_pct: r2(snapshot.actualSavingsRatePct),
          target_savings_rate_pct: r2(snapshot.targetSavingsRatePct),
        });
      }
      return out;
    });
  }

  let transfers: JsonObject[] | undefined;
  if (sections.accounts) {
    transfers = await attempt("Transfers", async () => {
      const rows = await getDatabase().getAllAsync<{
        date: string;
        amount: number;
        from_account_id: string | null;
        to_account_id: string | null;
        description: string | null;
      }>(
        `SELECT date, amount, from_account_id, to_account_id, description FROM account_transfers
         WHERE user_id = ? AND deleted_at IS NULL AND date >= ? AND date <= ?
         ORDER BY date ASC;`,
        userId, from, to,
      );
      return rows.map((t) => ({
        date: t.date,
        amount: r2(t.amount),
        from: refs.ref(t.from_account_id),
        to: refs.ref(t.to_account_id),
        ...(sections.notes ? { note: t.description || null } : {}),
      }));
    });
  }

  const budgets = sections.budgets
    ? await attempt("Budgets", async () => {
        const b = await getBudgetVsActual(userId, fromMonth, toMonth, from, to);
        return {
          total_budget: r2(b.totalBudget),
          total_spent: r2(b.totalActual),
          by_category: b.rows.map((row) => ({
            category: row.categoryName,
            budget: r2(row.totalBudget),
            spent: r2(row.totalActual),
          })),
          no_budget_set: b.unbudgetedRows.map((row) => ({ category: row.categoryName, spent: r2(row.totalActual) })),
          by_month: b.monthly.map((m) => ({ month: m.month, budget: r2(m.budget), spent: r2(m.actual) })),
        };
      })
    : undefined;

  const loans = sections.loans ? await attempt("Loans", () => buildLoans(userId, to)) : undefined;
  const investments = sections.investments
    ? await attempt("Investments and goals", () => buildInvestments(userId, from, to))
    : undefined;
  const netWorth = sections.netWorth
    ? await attempt("Net worth", () => buildNetWorth(userId, from, to, to === todayIso, refs))
    : undefined;
  const hisaab = sections.hisaab
    ? await attempt("Hisaab", () => buildHisaab(userId, from, to, options.hidePeopleNames, sections.notes))
    : undefined;

  // Built last: by now every account a transaction or transfer points at has its short id.
  let accounts: JsonObject[] | undefined;
  if (sections.accounts) {
    accounts = await attempt("Accounts and balances", async () => {
      const out: JsonObject[] = [];
      for (const a of refs.used) {
        out.push({
          id: refs.ref(a.id),
          name: refs.name(a.id),
          bank: a.bank_name,
          type: a.account_type,
          last4: last4(a.account_identifier),
          credit_limit: a.account_type === "credit_card" && a.credit_limit ? r2(a.credit_limit) : null,
          closed: Boolean(a.closed_at || !a.is_active),
          balances: await chainMonthBalances(a, fromMonth, toMonth),
        });
      }
      return out;
    });
  }

  // What an assistant needs to suggest changes, on top of the data itself.
  let categories: string[] | undefined;
  let merchants: JsonObject[] | undefined;
  let unreadMessages: JsonObject[] | undefined;
  if (suggest) {
    categories = await attempt("Categories", async () =>
      (
        await getDatabase().getAllAsync<{ name: string }>(
          "SELECT name FROM categories WHERE user_id = ? AND is_active = 1 ORDER BY sort_order ASC;",
          userId,
        )
      ).map((c) => c.name),
    );
    if (txns && !options.hideMerchantNames) merchants = buildMerchants(txns);
    if (suggest.includeUnreadMessages) {
      unreadMessages = await attempt("Unread bank messages", buildUnreadMessages);
    }
  }

  // What is already set up in Arth - sent with EVERY suggestion request, so the assistant builds
  // on the user's setup instead of suggesting from scratch: income and plan, budgets, buckets,
  // goals, merchant rules the user made, Smart Rules, message templates, and accounts.
  let currentSetup: JsonObject | undefined;
  if (suggest) {
    currentSetup = await attempt("Current setup", async () => {
      const db = getDatabase();
      const fy = getCurrentFY(fyStart, today);
      const month = todayIso.slice(0, 7);
      const [profile, plan, budgetRows, buckets, milestones, ruleRows, smartRules, templates, accts] = await Promise.all([
        getSalaryProfileByFY(userId, String(fy)),
        getYearlyPlanByFY(userId, String(fy)),
        db.getAllAsync<{ category: string; amount: number }>(
          `SELECT c.name AS category, b.amount FROM budgets b JOIN categories c ON c.id = b.category_id
           WHERE b.user_id = ? AND b.month = ? AND b.amount > 0 ORDER BY b.amount DESC;`,
          userId,
          month,
        ),
        getAllActiveBuckets(userId),
        getLifeMilestones(userId),
        listMerchantRules(userId),
        listRules(),
        listUserTemplates(),
        getAllAccounts(userId),
      ]);
      return {
        financial_year: getFYLabel(fy, fyStart),
        monthly_income: profile?.computed_monthly_in_hand ? r2(profile.computed_monthly_in_hand) : null,
        pay_day: profile?.salary_credit_day ?? null,
        expected_bonus: r2(profile?.expected_bonus),
        savings_target_pct: r2(plan?.savings_rate_target_pct),
        monthly_budgets: budgetRows.map((b) => ({ category: b.category, budget: r2(b.amount) })),
        investment_buckets: buckets.map((bk) => ({
          name: bk.name,
          annual_target: r2(bk.annual_target),
          contributed: r2(bk.current_contributed),
        })),
        goals: milestones
          .filter((m) => !m.is_completed)
          .map((m) => ({ name: m.name, target_amount: r2(m.target_amount), target_date: m.target_date ?? null })),
        // Only the rules the user made or changed - the built-in list is large and generic.
        merchant_rules: ruleRows
          .filter((mr) => mr.source !== "builtin" && mr.isActive)
          .map((mr) => ({ merchant: mr.keyword, category: mr.categoryName })),
        smart_rules: smartRules.map((sr) => ({ name: sr.name, active: sr.is_active === 1 })),
        message_templates: templates.map((t) => ({ sender: t.sender_pattern ?? t.bank_name, type: t.tx_type })),
        accounts_set_up: accts
          .filter((ac) => !ac.closed_at && ac.is_active === 1)
          .map((ac) => ({ bank: ac.account_label || ac.bank_name, type: ac.account_type, last4: ac.account_identifier ? String(ac.account_identifier).slice(-4) : null })),
      };
    });
  }

  const body: JsonObject = {
    generated_on: todayIso,
    period: { from, to },
    currency: getCurrency(),
    current_setup: currentSetup,
    monthly_summary: monthlySummary,
    financial_years: financialYears && financialYears.length > 0 ? financialYears : undefined,
    net_worth: netWorth,
    budgets,
    loans,
    investments,
    accounts,
    hisaab,
    categories,
    merchants,
    unread_messages: unreadMessages && unreadMessages.length > 0 ? unreadMessages : undefined,
    transfers,
    transactions,
  };

  // `guide` goes first so an AI reads it before the data; the ready-made totals come next and
  // the long row lists last, so the figures survive if an assistant only reads part of the file.
  const asked: JsonObject = suggest
    ? {
        request: AI_REQUESTS.find((r) => r.id === suggest.request)?.prompt,
        reply_instructions: buildReplyInstructions({
          unreadMessages: body.unread_messages !== undefined,
          unreviewed: Boolean(suggest.includeUnreviewed),
          fullSetup: isFullSetup(suggest.request),
        }),
      }
    : {};
  const has = (key: string) => body[key] !== undefined || asked[key] !== undefined;
  const data: JsonObject = { guide: buildGuide(has, fyStart), ...asked, ...body };

  return {
    data,
    counts: {
      transactions: transactions?.length ?? 0,
      accounts: accounts?.length ?? 0,
      months: months.length,
      unreadMessages: unreadMessages?.length ?? 0,
    },
    skipped,
  };
}
