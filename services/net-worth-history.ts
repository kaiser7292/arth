/**
 * Net Worth Over Time — one point per month-end, built from the ledger.
 *
 * Nothing is stored: every point is recomputed from transactions, opening
 * balances, demat snapshots, loan schedules and Hisaab entries, so correcting
 * an old transaction corrects the history too (docs/NET_WORTH_AND_YEAR_REVIEW_PROPOSAL.md).
 *
 * Why not call getBalanceSheetColumn once per month: that function only has a
 * value for a month whose account_month_balances row exists (rows are created
 * lazily when a ledger is opened), skips accounts closed today even for months
 * they were open, and only counts a demat snapshot inside the column's FY. All
 * three create fake drops in a trend line. Here the whole range is loaded in a
 * handful of batched queries and each account's balance is chained month by
 * month in JS with the same closing formula (computeClosing).
 *
 * Per account, the chain is anchored by:
 *  A. its opening-balance rows — mirrors getOrCreateMonthBalance: a manual
 *     override row is taken as-is, any other row is re-anchored to the
 *     previous month's closing, a missing row carries the closing forward;
 *  B. (pension / FD, no rows) opening 0 at the first activity, as
 *     computeUnseededBalance does;
 *  C. (no rows, has an SMS balance) last_known_balance in the month of
 *     last_balance_date, chained backwards and forwards through the flows.
 * An account with none of these is left out, as the Balance Sheet does.
 */

import { getDatabase } from "@/database";
import { computeClosing } from "@/services/account-balance";
import { V15_FLAGS } from "@/services/feature-flags";
import { getLoanOutstandingsByFAForDates } from "@/services/loan-accounts";
import {
  batchInvestmentProducts,
  isDematLikeAccount,
  isPensionLikeAccount,
  type InvestmentProduct,
} from "@/services/investment-accounts";
import { getDataVersion } from "@/services/settings";
import { formatLocalDate } from "@/utils/fiscal-year";

/** How the change between two points splits up. Always sums to the net worth change. */
export interface NetWorthChange {
  /** Bank, wallet, FD and pension balances, less card dues, plus money moved into market investments. */
  saved: number;
  /** Market value change of demat / market investments, net of money moved in or out. */
  marketGains: number;
  /** Fall in loan outstanding (negative = new borrowing). */
  loansPaidDown: number;
  /** Hisaab, and market accounts whose value first appears or disappears in the period. */
  other: number;
}

export interface NetWorthPoint {
  /** "YYYY-MM". */
  month: string;
  /** Month-end date, or today for the current month. */
  asOfDate: string;
  /** Bank, wallet, FD and pension. */
  savings: number;
  /** Demat portfolio + idle fund, and market-valued investments. */
  market: number;
  /** Credit card dues. */
  cards: number;
  /** Loan outstanding. */
  loans: number;
  /** Hisaab: people owe me − I owe. */
  hisaab: number;
  /**
   * The Balance Sheet's sections, so the chart groups things the same way:
   * Liquid Cash (bank, wallet, FDs), Investments (market + pension), Receivables (people owe
   * you) | Credit (= cards), Debt (= loans), Payables (you owe people).
   */
  liquidCash: number;
  investments: number;
  receivables: number;
  payables: number;
  netWorth: number;
  /** True when part of the value is a carried-forward or best-guess figure. */
  estimated: boolean;
  /** Change from the previous point, split up. Zero for the first point. */
  change: NetWorthChange;
}

export interface NetWorthHistory {
  points: NetWorthPoint[];
}

const MAX_MONTHS = 120;
/** A demat snapshot older than this at a month-end makes the point "estimated". */
const STALE_SNAPSHOT_DAYS = 45;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

interface AccountRow {
  id: string;
  account_type: string;
  last_known_balance: number | null;
  last_balance_date: string | null;
  created_at: string | null;
  closed_at: string | null;
}

interface Flows {
  expenses: number;
  credits: number;
  tOut: number;
  tIn: number;
  adj: number;
}

type FlowMap = Map<string, Map<string, Flows>>; // accountId → month → flows

/** Date (exclusive) from which an account no longer counts, or null if it still does. */
function endDateFor(a: AccountRow, product: InvestmentProduct | undefined): string | null {
  if (a.closed_at) return a.closed_at.slice(0, 10);
  // An FD marked matured/closed while its account stays open: its money is
  // back in the bank from the maturity date on (the Balance Sheet drops it
  // entirely today - see withoutFinishedInvestments).
  if (product && (product.status === "matured" || product.status === "closed")) {
    return (product.maturity_date ?? product.updated_at ?? "").slice(0, 10) || null;
  }
  return null;
}

async function loadFlows(ids: string[], lastMonth: string): Promise<FlowMap> {
  const map: FlowMap = new Map();
  if (ids.length === 0) return map;
  const db = getDatabase();
  const ph = ids.map(() => "?").join(",");
  const end = monthEnd(lastMonth);

  // Same filters as batchBalanceSheetClosings in services/balance-sheet.ts.
  const [exp, cred, tOut, tIn, adj] = await Promise.all([
    db.getAllAsync<{ account_id: string; m: string; total: number }>(
      `SELECT account_id, substr(date, 1, 7) AS m, COALESCE(SUM(COALESCE(split_original_amount, amount)), 0) AS total
       FROM expenses
       WHERE account_id IN (${ph}) AND deleted_at IS NULL
         AND nature = 'realized' AND status = 'approved'
         AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
         AND date <= ?
       GROUP BY account_id, m;`,
      ...ids, end,
    ),
    db.getAllAsync<{ account_id: string; m: string; total: number }>(
      `SELECT account_id, substr(date, 1, 7) AS m, COALESCE(SUM(amount), 0) AS total
       FROM expenses
       WHERE account_id IN (${ph}) AND deleted_at IS NULL
         AND nature = 'credit' AND status = 'approved'
         AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
         AND date <= ?
       GROUP BY account_id, m;`,
      ...ids, end,
    ),
    db.getAllAsync<{ account_id: string; m: string; total: number }>(
      `SELECT from_account_id AS account_id, substr(date, 1, 7) AS m, COALESCE(SUM(amount), 0) AS total
       FROM account_transfers
       WHERE from_account_id IN (${ph}) AND deleted_at IS NULL AND date <= ?
       GROUP BY from_account_id, m;`,
      ...ids, end,
    ),
    db.getAllAsync<{ account_id: string; m: string; total: number }>(
      `SELECT to_account_id AS account_id, substr(date, 1, 7) AS m, COALESCE(SUM(amount), 0) AS total
       FROM account_transfers
       WHERE to_account_id IN (${ph}) AND deleted_at IS NULL AND date <= ?
       GROUP BY to_account_id, m;`,
      ...ids, end,
    ),
    db.getAllAsync<{ account_id: string; m: string; total: number }>(
      `SELECT account_id, substr(date, 1, 7) AS m,
              COALESCE(SUM(CASE WHEN description LIKE '% -]' THEN -amount ELSE amount END), 0) AS total
       FROM expenses
       WHERE account_id IN (${ph}) AND deleted_at IS NULL
         AND nature = 'ledger_adjustment' AND status = 'approved'
         AND date <= ?
       GROUP BY account_id, m;`,
      ...ids, end,
    ),
  ]);

  const put = (rows: { account_id: string; m: string; total: number }[], key: keyof Flows) => {
    for (const r of rows) {
      let byMonth = map.get(r.account_id);
      if (!byMonth) map.set(r.account_id, (byMonth = new Map()));
      let f = byMonth.get(r.m);
      if (!f) byMonth.set(r.m, (f = { expenses: 0, credits: 0, tOut: 0, tIn: 0, adj: 0 }));
      f[key] += r.total;
    }
  };
  put(exp, "expenses");
  put(cred, "credits");
  put(tOut, "tOut");
  put(tIn, "tIn");
  put(adj, "adj");
  return map;
}

interface ChainResult {
  /** month → closing balance. Months with no value are absent. */
  closing: Map<string, number>;
  /** months whose value is a best guess. */
  estimated: Set<string>;
}

/**
 * Month-end closing balances for one balance-chain account over [firstMonth, lastMonth].
 * Exported for tests.
 */
export function chainAccount(params: {
  isCC: boolean;
  usesZeroStart: boolean;
  anchors: Map<string, { opening: number; override: boolean }>;
  flows: Map<string, Flows> | undefined;
  lastKnownBalance: number | null;
  lastBalanceMonth: string | null;
  createdMonth: string | null;
  lastMonth: string;
}): ChainResult {
  const { isCC, anchors, flows, lastMonth } = params;
  const closing = new Map<string, number>();
  const estimated = new Set<string>();
  const f = (m: string): Flows => flows?.get(m) ?? { expenses: 0, credits: 0, tOut: 0, tIn: 0, adj: 0 };
  const close = (opening: number, m: string) => {
    const x = f(m);
    return computeClosing({
      opening, expenses: x.expenses, credits: x.credits,
      transfersOut: x.tOut, transfersIn: x.tIn, adjustmentNet: x.adj, isCC,
    });
  };
  const activityMonths = flows ? [...flows.keys()].sort() : [];
  const firstActivity = activityMonths[0] ?? null;

  // A. Opening-balance rows.
  if (anchors.size > 0) {
    const start = [...anchors.keys()].sort()[0];
    let prev: number | null = null;
    for (let m = start; m <= lastMonth; m = nextMonth(m)) {
      const row = anchors.get(m);
      let opening: number | null;
      if (row) opening = row.override || prev == null ? row.opening : prev;
      else opening = prev;
      if (opening == null) continue; // before the first row
      prev = round2(close(opening, m));
      closing.set(m, prev);
    }
    return { closing, estimated };
  }

  // B. Pension / FD with activity: opening 0 at the first activity month.
  if (params.usesZeroStart && firstActivity) {
    let prev = 0;
    for (let m = firstActivity; m <= lastMonth; m = nextMonth(m)) {
      prev = round2(close(prev, m));
      closing.set(m, prev);
    }
    return { closing, estimated };
  }

  // C. SMS balance as the anchor, chained both ways.
  if (params.lastKnownBalance != null) {
    const anchorMonth = params.lastBalanceMonth ?? lastMonth;
    const candidates = [anchorMonth, firstActivity, params.createdMonth].filter((x): x is string => !!x);
    const start = candidates.sort()[0];
    closing.set(anchorMonth, round2(params.lastKnownBalance));
    // Forward from the anchor.
    let prev = params.lastKnownBalance;
    for (let m = nextMonth(anchorMonth); m <= lastMonth; m = nextMonth(m)) {
      prev = round2(close(prev, m));
      closing.set(m, prev);
    }
    // Backward: closing(m) = opening(m+1) = closing(m+1) − that month's net flow.
    let after = params.lastKnownBalance;
    for (let m = prevMonth(anchorMonth); m >= start; m = prevMonth(m)) {
      const netFlowNext = close(0, nextMonth(m));
      after = round2(after - netFlowNext);
      closing.set(m, after);
      if (!firstActivity || m < firstActivity) estimated.add(m);
    }
    return { closing, estimated };
  }

  return { closing, estimated };
}

/** Latest value on or before `date` from an ascending list of [date, value]. */
function valueAsOf(list: [string, number][] | undefined, date: string): [string, number] | null {
  if (!list) return null;
  let found: [string, number] | null = null;
  for (const entry of list) {
    if (entry[0] <= date) found = entry;
    else break;
  }
  return found;
}

/**
 * Build the month-by-month net worth series up to today.
 * `today` is injectable for tests.
 */
export async function computeNetWorthHistory(
  userId: string,
  today: string = formatLocalDate(new Date()),
): Promise<NetWorthHistory> {
  const db = getDatabase();
  const currentMonth = today.slice(0, 7);

  const accounts = await db.getAllAsync<AccountRow>(
    `SELECT id, account_type, last_known_balance, last_balance_date, created_at, closed_at
     FROM financial_accounts
     WHERE user_id = ? AND is_active = 1;`,
    userId,
  );
  const products = await batchInvestmentProducts(
    accounts.filter((a) => a.account_type === "investment").map((a) => a.id),
  );

  const chainAccounts = accounts.filter((a) => {
    const p = products.get(a.id);
    return (
      a.account_type === "savings" || a.account_type === "wallet" || a.account_type === "credit_card" ||
      isPensionLikeAccount(a, p) || (a.account_type === "investment" && p?.valuation === "contract")
    );
  });
  const marketAccounts = accounts.filter((a) => isDematLikeAccount(a, products.get(a.id)));
  const loanAccounts = accounts.filter((a) => a.account_type === "loan");
  const endDates = new Map(accounts.map((a) => [a.id, endDateFor(a, products.get(a.id))]));
  const counts = (accountId: string, asOf: string) => {
    const end = endDates.get(accountId);
    return end == null || asOf < end;
  };

  // ── Loads ──
  const chainIds = chainAccounts.map((a) => a.id);
  const marketIds = marketAccounts.map((a) => a.id);
  const chainPh = chainIds.map(() => "?").join(",");
  const marketPh = marketIds.map(() => "?").join(",");

  const [flows, anchorRows, portfolioRows, fundRows, marketTransfers, hisaabRows] = await Promise.all([
    loadFlows(chainIds, currentMonth),
    chainIds.length === 0
      ? Promise.resolve([])
      : db.getAllAsync<{ account_id: string; month: string; opening_balance: number; is_manual_override: number | null }>(
          `SELECT account_id, month, opening_balance, is_manual_override
           FROM account_month_balances WHERE account_id IN (${chainPh}) AND month <= ?;`,
          ...chainIds, currentMonth,
        ),
    marketIds.length === 0
      ? Promise.resolve([])
      : db.getAllAsync<{ account_id: string; d: string; v: number }>(
          `SELECT account_id, snapshot_date AS d, portfolio_value AS v FROM demat_portfolio_snapshots
           WHERE account_id IN (${marketPh}) AND snapshot_date <= ? ORDER BY snapshot_date ASC;`,
          ...marketIds, today,
        ),
    marketIds.length === 0
      ? Promise.resolve([])
      : db.getAllAsync<{ account_id: string; d: string; v: number }>(
          `SELECT account_id, snapshot_date AS d, fund_value AS v FROM demat_fund_snapshots
           WHERE account_id IN (${marketPh}) AND snapshot_date <= ? ORDER BY snapshot_date ASC;`,
          ...marketIds, today,
        ),
    marketIds.length === 0
      ? Promise.resolve([])
      : db.getAllAsync<{ from_account_id: string; to_account_id: string; m: string; total: number }>(
          `SELECT from_account_id, to_account_id, substr(date, 1, 7) AS m, SUM(amount) AS total
           FROM account_transfers
           WHERE deleted_at IS NULL AND date <= ?
             AND (from_account_id IN (${marketPh}) OR to_account_id IN (${marketPh}))
           GROUP BY from_account_id, to_account_id, m;`,
          today, ...marketIds, ...marketIds,
        ),
    // Hisaab balance per person per month. initial_balance counts from the
    // month the person was added.
    db.getAllAsync<{ id: string; initial_balance: number | null; created_at: string | null; m: string | null; net: number | null }>(
      `SELECT p.id, p.initial_balance, p.created_at, substr(e.date, 1, 7) AS m,
              SUM(CASE WHEN e.type = 'debit' THEN e.amount
                       WHEN e.type IN ('credit', 'settlement') THEN -e.amount ELSE 0 END) AS net
       FROM hisaab_persons p
       LEFT JOIN hisaab_entries e ON p.id = e.hisaab_person_id
         AND e.date <= ?
         AND (e.linked_expense_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM expenses x WHERE x.id = e.linked_expense_id AND x.deleted_at IS NOT NULL
         ))
       WHERE p.owner_user_id = ? AND p.is_active = 1
         AND COALESCE(p.exclude_from_net_worth, 0) = 0
       GROUP BY p.id, m;`,
      today, userId,
    ),
  ]);

  // ── Balance-chain accounts ──
  const anchorsByAccount = new Map<string, Map<string, { opening: number; override: boolean }>>();
  for (const r of anchorRows) {
    let m = anchorsByAccount.get(r.account_id);
    if (!m) anchorsByAccount.set(r.account_id, (m = new Map()));
    m.set(r.month, { opening: r.opening_balance, override: r.is_manual_override === 1 });
  }

  // Earliest month with anything at all — the series starts there.
  const startCandidates: string[] = [];
  const chains = new Map<string, ChainResult>();
  for (const a of chainAccounts) {
    const p = products.get(a.id);
    const anchors = anchorsByAccount.get(a.id) ?? new Map();
    const accFlows = flows.get(a.id);
    const chain = chainAccount({
      isCC: a.account_type === "credit_card",
      usesZeroStart: isPensionLikeAccount(a, p) || a.account_type === "investment",
      anchors,
      flows: accFlows,
      lastKnownBalance: a.last_known_balance,
      lastBalanceMonth: a.last_balance_date ? a.last_balance_date.slice(0, 7) : null,
      createdMonth: a.created_at ? a.created_at.slice(0, 7) : null,
      lastMonth: currentMonth,
    });
    chains.set(a.id, chain);
    const first = [...chain.closing.keys()].sort()[0];
    if (first) startCandidates.push(first);
  }

  // ── Market accounts ──
  const portfolio = new Map<string, [string, number][]>();
  const fund = new Map<string, [string, number][]>();
  for (const r of portfolioRows) {
    if (!portfolio.has(r.account_id)) portfolio.set(r.account_id, []);
    portfolio.get(r.account_id)!.push([r.d, r.v]);
  }
  for (const r of fundRows) {
    if (!fund.has(r.account_id)) fund.set(r.account_id, []);
    fund.get(r.account_id)!.push([r.d, r.v]);
  }
  for (const list of [...portfolio.values(), ...fund.values()]) startCandidates.push(list[0][0].slice(0, 7));

  const marketSet = new Set(marketIds);
  const inflow = new Map<string, Map<string, number>>(); // accountId → month → net money in
  for (const r of marketTransfers) {
    // A transfer between two market accounts moves value without changing the total — skip it.
    if (marketSet.has(r.from_account_id) && marketSet.has(r.to_account_id)) continue;
    const acct = marketSet.has(r.to_account_id) ? r.to_account_id : r.from_account_id;
    const sign = marketSet.has(r.to_account_id) ? 1 : -1;
    let m = inflow.get(acct);
    if (!m) inflow.set(acct, (m = new Map()));
    m.set(r.m, (m.get(r.m) ?? 0) + sign * r.total);
  }

  // ── Hisaab ──
  const hisaabPersons = new Map<string, { initial: number; createdMonth: string | null; byMonth: Map<string, number> }>();
  for (const r of hisaabRows) {
    let p = hisaabPersons.get(r.id);
    if (!p) {
      p = { initial: r.initial_balance ?? 0, createdMonth: r.created_at ? r.created_at.slice(0, 7) : null, byMonth: new Map() };
      hisaabPersons.set(r.id, p);
    }
    if (r.m && r.net) {
      p.byMonth.set(r.m, (p.byMonth.get(r.m) ?? 0) + r.net);
      startCandidates.push(r.m);
    }
  }

  if (startCandidates.length === 0) return { points: [] };
  let startMonth = startCandidates.sort()[0];
  // Cap the series length.
  let capped = currentMonth;
  for (let i = 1; i < MAX_MONTHS; i++) capped = prevMonth(capped);
  if (startMonth < capped) startMonth = capped;

  const months: string[] = [];
  for (let m = startMonth; m <= currentMonth; m = nextMonth(m)) months.push(m);

  const loanByMonth = new Map<string, Map<string, number>>();
  if (loanAccounts.length > 0 && V15_FLAGS.v17_loans_v1) {
    const dates = months.map((m) => (m === currentMonth ? today : monthEnd(m)));
    const results = await getLoanOutstandingsByFAForDates(userId, dates);
    months.forEach((m, i) => loanByMonth.set(m, results.get(dates[i]) ?? new Map()));
  }

  // ── Assemble ──
  const points: NetWorthPoint[] = [];
  const hisaabRunning = new Map<string, number>();
  let prevMarketValues = new Map<string, number>();

  for (const m of months) {
    const asOf = m === currentMonth ? today : monthEnd(m);
    let estimated = false;

    let savings = 0;
    let pension = 0;
    let cards = 0;
    for (const a of chainAccounts) {
      if (!counts(a.id, asOf)) continue;
      const chain = chains.get(a.id)!;
      const v = chain.closing.get(m);
      if (v == null) continue;
      if (chain.estimated.has(m)) estimated = true;
      if (a.account_type === "credit_card") cards += Math.max(0, v);
      else {
        savings += v;
        if (isPensionLikeAccount(a, products.get(a.id))) pension += v;
      }
    }

    let market = 0;
    const marketValues = new Map<string, number>();
    for (const a of marketAccounts) {
      if (!counts(a.id, asOf)) continue;
      const pv = valueAsOf(portfolio.get(a.id), asOf);
      const fv = valueAsOf(fund.get(a.id), asOf);
      if (!pv && !fv) continue;
      const latest = [pv?.[0], fv?.[0]].filter((x): x is string => !!x).sort().pop()!;
      if (daysBetween(latest, asOf) > STALE_SNAPSHOT_DAYS) estimated = true;
      const v = (pv?.[1] ?? 0) + (fv?.[1] ?? 0);
      marketValues.set(a.id, v);
      market += v;
    }

    let loans = 0;
    const amortized = loanByMonth.get(m);
    for (const a of loanAccounts) {
      if (!counts(a.id, asOf)) continue;
      const v = amortized?.get(a.id);
      if (v !== undefined) {
        loans += Math.max(0, v);
      } else if (a.last_known_balance != null && a.last_known_balance > 0) {
        // Legacy loan without a schedule: only today's balance is known.
        const created = a.created_at ? a.created_at.slice(0, 7) : startMonth;
        if (m >= created) {
          loans += a.last_known_balance;
          if (m !== currentMonth) estimated = true;
        }
      }
    }

    let owed = 0;
    let owe = 0;
    for (const [id, p] of hisaabPersons) {
      let bal = hisaabRunning.get(id) ?? 0;
      const initialMonth = p.createdMonth != null && p.createdMonth > startMonth ? p.createdMonth : startMonth;
      if (m === initialMonth) bal += p.initial;
      if (m === startMonth) {
        // Fold in entries from before the (possibly capped) start.
        for (const [em, net] of p.byMonth) if (em < m) bal += net;
      }
      bal += p.byMonth.get(m) ?? 0;
      hisaabRunning.set(id, bal);
      if (bal > 0) owed += bal;
      else if (bal < 0) owe += -bal;
    }
    const hisaab = owed - owe;

    const netWorth = round2(savings + market - cards - loans + hisaab);
    const prev = points[points.length - 1];
    const change: NetWorthChange = { saved: 0, marketGains: 0, loansPaidDown: 0, other: 0 };
    if (prev) {
      let totalInflow = 0;
      let marketGains = 0;
      for (const a of marketAccounts) {
        const flowIn = inflow.get(a.id)?.get(m) ?? 0;
        totalInflow += flowIn;
        const before = prevMarketValues.get(a.id);
        const after = marketValues.get(a.id);
        // An account whose value first appears (or disappears) this month lands in "other".
        if (before != null && after != null) marketGains += after - before - flowIn;
      }
      change.saved = round2(savings - prev.savings - (cards - prev.cards) + totalInflow);
      change.marketGains = round2(marketGains);
      change.loansPaidDown = round2(prev.loans - loans);
      // Remainder, so the four always add up exactly.
      change.other = round2(netWorth - prev.netWorth - change.saved - change.marketGains - change.loansPaidDown);
    }

    points.push({
      month: m,
      asOfDate: asOf,
      savings: round2(savings),
      market: round2(market),
      cards: round2(cards),
      loans: round2(loans),
      hisaab: round2(hisaab),
      liquidCash: round2(savings - pension),
      investments: round2(market + pension),
      receivables: round2(owed),
      payables: round2(owe),
      netWorth,
      estimated,
      change,
    });
    prevMarketValues = marketValues;
  }

  // Drop leading all-zero months.
  const firstReal = points.findIndex((p) => p.savings || p.market || p.cards || p.loans || p.receivables || p.payables);
  if (firstReal === -1) return { points: [] };
  const trimmed = points.slice(firstReal);
  trimmed[0] = { ...trimmed[0], change: { saved: 0, marketGains: 0, loansPaidDown: 0, other: 0 } };
  return { points: trimmed };
}

/** Sum the per-month changes after `fromIndex` up to and including `toIndex`. */
export function changeBetween(points: NetWorthPoint[], fromIndex: number, toIndex: number): NetWorthChange {
  const total: NetWorthChange = { saved: 0, marketGains: 0, loansPaidDown: 0, other: 0 };
  for (let i = fromIndex + 1; i <= toIndex; i++) {
    const c = points[i].change;
    total.saved += c.saved;
    total.marketGains += c.marketGains;
    total.loansPaidDown += c.loansPaidDown;
    total.other += c.other;
  }
  return {
    saved: round2(total.saved),
    marketGains: round2(total.marketGains),
    loansPaidDown: round2(total.loansPaidDown),
    other: round2(total.other),
  };
}

// ── Cache: recompute only after data changes or the day rolls over ──

let cache: { key: string; value: Promise<NetWorthHistory> } | null = null;
/** The last history that finished computing, for screens to show at once while a newer one loads. */
let lastResolved: NetWorthHistory | null = null;

export function peekNetWorthHistory(): NetWorthHistory | null {
  return lastResolved;
}

export function getNetWorthHistory(userId: string): Promise<NetWorthHistory> {
  const today = formatLocalDate(new Date());
  const key = `${userId}|${getDataVersion()}|${today}`;
  if (cache?.key === key) return cache.value;
  const value = computeNetWorthHistory(userId, today);
  cache = { key, value };
  value.then((h) => {
    lastResolved = h;
  }, () => {});
  value.catch(() => {
    if (cache?.value === value) cache = null;
  });
  return value;
}
