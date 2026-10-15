/**
 * Year in Review — one financial year, summed up for a swipeable story
 * (app/insights/year-review.tsx) and a shareable summary.
 *
 * Built only from existing data: spending uses the Budget tab's rule
 * (getSpendingRows), savings rate comes from the yearly plan when there is
 * one (getFinancialCockpit), net worth / debt / Hisaab at year end come from
 * services/net-worth-history.ts. docs/NET_WORTH_AND_YEAR_REVIEW_PROPOSAL.md, Part B.
 */

import { getDatabase } from "@/database";
import { getSpendingRows } from "@/services/analytics/spending-rows";
import { getFinancialCockpit } from "@/services/financial-cockpit";
import { getNetWorthHistory, prevMonth, type NetWorthPoint } from "@/services/net-worth-history";
import { bumpDataVersion, getFYStartMonth } from "@/services/settings";
import { settingsStorage } from "@/services/storage";
import { formatLocalDate, getCurrentFY, getFYLabel, getFYRange } from "@/utils/fiscal-year";

export interface YearReviewCategory {
  id: string | null;
  name: string;
  color: string;
  amount: number;
  /** Share of total spending, 0–100. */
  pct: number;
}

export interface YearReviewMerchant {
  name: string;
  amount: number;
  count: number;
}

export interface YearReviewChange {
  name: string;
  prev: number;
  curr: number;
  /** null when last year was 0. */
  changePct: number | null;
}

export interface YearReview {
  fyYear: number;
  fyLabel: string;
  startDate: string;
  /** FY end, or today for the FY in progress. */
  endDate: string;
  isComplete: boolean;
  totals: {
    spent: number;
    moneyIn: number;
    txCount: number;
    /** How many of txCount Arth picked up from SMS on its own. */
    smsCount: number;
  };
  savings: {
    ratePct: number;
    targetPct: number | null;
    saved: number;
    prevRatePct: number | null;
    /** "plan" = from the yearly plan's income; "flows" = money in − spent. */
    source: "plan" | "flows";
  } | null;
  netWorth: { start: number; end: number; change: number; points: { month: string; netWorth: number }[] } | null;
  categories: YearReviewCategory[];
  merchants: { bySpend: YearReviewMerchant[]; byVisits: YearReviewMerchant[] };
  months: { month: string; total: number }[];
  biggestMonth: { month: string; total: number } | null;
  quietestMonth: { month: string; total: number } | null;
  debt: { start: number; end: number; reduced: number } | null;
  invested: { amount: number; fdsOpened: number } | null;
  hisaab: { peopleSettled: number; settledAmount: number; netAtEnd: number } | null;
  vsLastYear: { spentPrev: number; spentChangePct: number | null; changes: YearReviewChange[] } | null;
}

const OTHER_COLOR = "#94A3B8";
const round2 = (n: number) => Math.round(n * 100) / 100;

function fyDates(fyYear: number, today: string) {
  const startMonth = getFYStartMonth();
  const range = getFYRange(fyYear, startMonth);
  const startDate = formatLocalDate(range.start);
  const fyEnd = formatLocalDate(range.end);
  const isComplete = fyEnd < today;
  return { startMonth, startDate, endDate: isComplete ? fyEnd : today, isComplete, fyEnd };
}

/** FYs that have any spending, newest first, always including the current one. */
export async function getReviewableFYs(userId: string): Promise<number[]> {
  const db = getDatabase();
  const startMonth = getFYStartMonth();
  const current = getCurrentFY(startMonth);
  const row = await db.getFirstAsync<{ first: string | null }>(
    `SELECT MIN(date) AS first FROM expenses WHERE user_id = ? AND deleted_at IS NULL AND status = 'approved';`,
    userId,
  );
  const firstFY = row?.first ? getCurrentFY(startMonth, new Date(row.first + "T00:00:00")) : current;
  const out: number[] = [];
  for (let fy = current; fy >= firstFY && out.length < 25; fy--) out.push(fy);
  return out;
}

/** Which FY the April "your year is ready" card is about, or null outside its window (first 30 days of an FY). */
export function getReadyReviewFY(today: Date = new Date()): number | null {
  const startMonth = getFYStartMonth();
  const current = getCurrentFY(startMonth, today);
  const start = getFYRange(current, startMonth).start;
  const days = Math.floor((today.getTime() - start.getTime()) / 86_400_000);
  return days >= 0 && days < 30 ? current - 1 : null;
}

async function categoryNames(userId: string): Promise<Map<string, { name: string; color: string | null }>> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ id: string; name: string; color: string | null }>(
    `SELECT id, name, color FROM categories WHERE user_id = ?;`,
    userId,
  );
  return new Map(rows.map((r) => [r.id, { name: r.name, color: r.color }]));
}

/** Credits that are real money in: not refunds, not your own transfers, not credit-card payments. */
async function moneyIn(userId: string, startDate: string, endDate: string): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(e.amount), 0) AS total
     FROM expenses e
     LEFT JOIN financial_accounts fa ON fa.id = e.account_id
     WHERE e.user_id = ? AND e.date >= ? AND e.date <= ?
       AND e.nature = 'credit' AND e.status = 'approved' AND e.deleted_at IS NULL
       AND (e.reclassified_as_transfer IS NULL OR e.reclassified_as_transfer = 0)
       AND e.refund_of_expense_id IS NULL
       AND COALESCE(e.credit_kind, '') <> 'refund'
       AND COALESCE(e.money_event, '') NOT IN ('self_transfer', 'fd_closure')
       AND COALESCE(fa.account_type, '') <> 'credit_card';`,
    userId, startDate, endDate,
  );
  return row?.total ?? 0;
}

async function invested(userId: string, startDate: string, endDate: string): Promise<{ amount: number; fdsOpened: number }> {
  const db = getDatabase();
  const [links, transfers, fds] = await Promise.all([
    db.getFirstAsync<{ total: number | null }>(
      `SELECT COALESCE(SUM(COALESCE(l.contribution_amount, e.amount)), 0) AS total
       FROM expense_investment_links l
       JOIN expenses e ON e.id = l.expense_id
       WHERE e.user_id = ? AND e.deleted_at IS NULL AND e.status = 'approved'
         AND e.date >= ? AND e.date <= ?;`,
      userId, startDate, endDate,
    ),
    // Money moved from a bank/wallet into a demat or investment account (FDs included).
    db.getFirstAsync<{ total: number | null }>(
      `SELECT COALESCE(SUM(t.amount), 0) AS total
       FROM account_transfers t
       JOIN financial_accounts dst ON dst.id = t.to_account_id
       JOIN financial_accounts src ON src.id = t.from_account_id
       WHERE dst.user_id = ? AND t.deleted_at IS NULL AND t.date >= ? AND t.date <= ?
         AND dst.account_type IN ('demat', 'investment', 'pension')
         AND src.account_type NOT IN ('demat', 'investment', 'pension');`,
      userId, startDate, endDate,
    ),
    db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM investment_products p
       JOIN financial_accounts fa ON fa.id = p.financial_account_id
       WHERE fa.user_id = ? AND p.valuation = 'contract'
         AND p.start_date >= ? AND p.start_date <= ?;`,
      userId, startDate, endDate,
    ),
  ]);
  return { amount: (links?.total ?? 0) + (transfers?.total ?? 0), fdsOpened: fds?.n ?? 0 };
}

async function hisaabSettlements(userId: string, startDate: string, endDate: string) {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ people: number; total: number | null }>(
    `SELECT COUNT(DISTINCT e.hisaab_person_id) AS people, COALESCE(SUM(e.amount), 0) AS total
     FROM hisaab_entries e
     JOIN hisaab_persons p ON p.id = e.hisaab_person_id
     WHERE p.owner_user_id = ? AND e.type = 'settlement' AND e.date >= ? AND e.date <= ?;`,
    userId, startDate, endDate,
  );
  return { peopleSettled: row?.people ?? 0, settledAmount: row?.total ?? 0 };
}

interface SpendSummary {
  total: number;
  count: number;
  smsCount: number;
  byCategory: Map<string, number>;
  byMerchant: Map<string, { name: string; amount: number; count: number }>;
  byMonth: Map<string, number>;
}

async function summariseSpending(userId: string, startDate: string, endDate: string): Promise<SpendSummary> {
  const rows = await getSpendingRows(userId, startDate, endDate);
  const s: SpendSummary = { total: 0, count: 0, smsCount: 0, byCategory: new Map(), byMerchant: new Map(), byMonth: new Map() };
  for (const r of rows) {
    const amt = r.amount;
    s.total += amt;
    s.count += 1;
    if (r.source === "sms_auto") s.smsCount += 1;
    const cat = r.category_id ?? "";
    s.byCategory.set(cat, (s.byCategory.get(cat) ?? 0) + amt);
    const m = r.date.slice(0, 7);
    s.byMonth.set(m, (s.byMonth.get(m) ?? 0) + amt);
    const name = (r.merchant_name ?? r.raw_merchant_name ?? "").trim();
    if (name) {
      const key = name.toLowerCase();
      const cur = s.byMerchant.get(key) ?? { name, amount: 0, count: 0 };
      cur.amount += amt;
      cur.count += 1;
      s.byMerchant.set(key, cur);
    }
  }
  return s;
}

function pointAt(points: NetWorthPoint[], month: string): NetWorthPoint | undefined {
  // The latest point at or before `month`.
  let found: NetWorthPoint | undefined;
  for (const p of points) {
    if (p.month <= month) found = p;
    else break;
  }
  return found;
}

export async function buildYearReview(
  userId: string,
  fyYear: number,
  today: string = formatLocalDate(new Date()),
): Promise<YearReview> {
  const { startMonth, startDate, endDate, isComplete } = fyDates(fyYear, today);
  const prev = fyDates(fyYear - 1, today);

  const [spend, prevSpend, cats, inTotal, inv, settle, history] = await Promise.all([
    summariseSpending(userId, startDate, endDate),
    summariseSpending(userId, prev.startDate, prev.endDate),
    categoryNames(userId),
    moneyIn(userId, startDate, endDate),
    invested(userId, startDate, endDate),
    hisaabSettlements(userId, startDate, endDate),
    getNetWorthHistory(userId).catch(() => ({ points: [] as NetWorthPoint[] })),
  ]);

  // ── Savings rate ──
  let savings: YearReview["savings"] = null;
  try {
    const [cockpit, prevCockpit] = await Promise.all([
      getFinancialCockpit(userId, String(fyYear)),
      getFinancialCockpit(userId, String(fyYear - 1)),
    ]);
    if (cockpit && cockpit.waterfall.incomeReceivedYTD > 0) {
      savings = {
        ratePct: round2(cockpit.savings.actualRatePct),
        targetPct: cockpit.savings.targetRatePct > 0 ? cockpit.savings.targetRatePct : null,
        saved: cockpit.savings.totalSaved,
        prevRatePct: prevCockpit && prevCockpit.waterfall.incomeReceivedYTD > 0 ? round2(prevCockpit.savings.actualRatePct) : null,
        source: "plan",
      };
    }
  } catch {
    // No yearly plan for this FY - fall back to money in vs spent below.
  }
  if (!savings && inTotal > 0) {
    const prevIn = await moneyIn(userId, prev.startDate, prev.endDate);
    savings = {
      ratePct: round2(((inTotal - spend.total) / inTotal) * 100),
      targetPct: null,
      saved: round2(inTotal - spend.total),
      prevRatePct: prevIn > 0 ? round2(((prevIn - prevSpend.total) / prevIn) * 100) : null,
      source: "flows",
    };
  }

  // ── Categories (top 5 + the rest) ──
  const catList = [...spend.byCategory.entries()]
    .map(([id, amount]) => {
      const c = id ? cats.get(id) : undefined;
      return { id: id || null, name: c?.name ?? "Uncategorised", color: c?.color ?? OTHER_COLOR, amount };
    })
    .sort((a, b) => b.amount - a.amount);
  const top = catList.slice(0, 5);
  const rest = catList.slice(5).reduce((s, c) => s + c.amount, 0);
  if (rest > 0) top.push({ id: null, name: "Everything else", color: OTHER_COLOR, amount: rest });
  const categories = top.map((c) => ({
    ...c,
    amount: round2(c.amount),
    pct: spend.total > 0 ? round2((c.amount / spend.total) * 100) : 0,
  }));

  // ── Merchants ──
  const merchantList = [...spend.byMerchant.values()].map((m) => ({ ...m, amount: round2(m.amount) }));
  const bySpend = [...merchantList].sort((a, b) => b.amount - a.amount).slice(0, 5);
  const byVisits = [...merchantList].filter((m) => m.count >= 2).sort((a, b) => b.count - a.count).slice(0, 3);

  // ── Months ──
  const months: { month: string; total: number }[] = [];
  for (let m = startDate.slice(0, 7); m <= endDate.slice(0, 7); ) {
    months.push({ month: m, total: round2(spend.byMonth.get(m) ?? 0) });
    const [y, mo] = m.split("-").map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  // The month in progress isn't a fair "quietest" - leave it out.
  const fullMonths = months.filter((m) => m.total > 0 && (isComplete || m.month < today.slice(0, 7)));
  const biggestMonth = fullMonths.length ? fullMonths.reduce((a, b) => (b.total > a.total ? b : a)) : null;
  const quietestMonth = fullMonths.length >= 2 ? fullMonths.reduce((a, b) => (b.total < a.total ? b : a)) : null;

  // ── Net worth, debt, Hisaab at year end ──
  const points = history.points;
  const baseMonth = prevMonth(startDate.slice(0, 7));
  const endPoint = pointAt(points, endDate.slice(0, 7));
  const basePoint = pointAt(points, baseMonth) ?? points.find((p) => p.month >= startDate.slice(0, 7));
  let netWorth: YearReview["netWorth"] = null;
  let debt: YearReview["debt"] = null;
  if (endPoint && basePoint && endPoint !== basePoint) {
    netWorth = {
      start: basePoint.netWorth,
      end: endPoint.netWorth,
      change: round2(endPoint.netWorth - basePoint.netWorth),
      points: points
        .filter((p) => p.month >= basePoint.month && p.month <= endPoint.month)
        .map((p) => ({ month: p.month, netWorth: p.netWorth })),
    };
    if (basePoint.loans > 0 || endPoint.loans > 0) {
      debt = { start: basePoint.loans, end: endPoint.loans, reduced: round2(basePoint.loans - endPoint.loans) };
    }
  }
  const hisaab =
    settle.peopleSettled > 0 || (endPoint && endPoint.hisaab !== 0)
      ? { ...settle, settledAmount: round2(settle.settledAmount), netAtEnd: endPoint?.hisaab ?? 0 }
      : null;

  // ── vs last year (same share of the year, so a part-year isn't compared with a full one) ──
  let vsLastYear: YearReview["vsLastYear"] = null;
  if (prevSpend.total > 0) {
    let prevComparable = prevSpend;
    if (!isComplete) {
      const [y, m, d] = endDate.split("-").map(Number);
      const sameDayLastYear = formatLocalDate(new Date(y - 1, m - 1, d));
      prevComparable = await summariseSpending(userId, prev.startDate, sameDayLastYear);
    }
    const ids = new Set([...spend.byCategory.keys(), ...prevComparable.byCategory.keys()]);
    const changes: YearReviewChange[] = [];
    for (const id of ids) {
      const curr = spend.byCategory.get(id) ?? 0;
      const before = prevComparable.byCategory.get(id) ?? 0;
      changes.push({
        name: id ? cats.get(id)?.name ?? "Uncategorised" : "Uncategorised",
        prev: round2(before),
        curr: round2(curr),
        changePct: before > 0 ? round2(((curr - before) / before) * 100) : null,
      });
    }
    changes.sort((a, b) => Math.abs(b.curr - b.prev) - Math.abs(a.curr - a.prev));
    vsLastYear = {
      spentPrev: round2(prevComparable.total),
      spentChangePct: prevComparable.total > 0 ? round2(((spend.total - prevComparable.total) / prevComparable.total) * 100) : null,
      changes: changes.slice(0, 3),
    };
  }

  return {
    fyYear,
    fyLabel: getFYLabel(fyYear, startMonth),
    startDate,
    endDate,
    isComplete,
    totals: {
      spent: round2(spend.total),
      moneyIn: round2(inTotal),
      txCount: spend.count,
      smsCount: spend.smsCount,
    },
    savings,
    netWorth,
    categories,
    merchants: { bySpend, byVisits },
    months,
    biggestMonth,
    quietestMonth,
    debt,
    invested: inv.amount > 0 || inv.fdsOpened > 0 ? { amount: round2(inv.amount), fdsOpened: inv.fdsOpened } : null,
    hisaab,
    vsLastYear,
  };
}

// ── Sharing ──

export interface ShareLine {
  label: string;
  value: string;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return `${SHORT_MONTHS[mo - 1]} ${y}`;
};
const pct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n)}%`;

/**
 * The headline lines for the shared image and PDF. With `hideAmounts` no line
 * carries a money figure - only percentages, counts, names and months - so a
 * shared review never gives away what you earn, spend or own.
 */
export function buildShareLines(
  r: YearReview,
  hideAmounts: boolean,
  fmt: (n: number) => string,
): ShareLine[] {
  const lines: ShareLine[] = [];
  lines.push(
    hideAmounts
      ? { label: "Transactions tracked", value: String(r.totals.txCount) }
      : { label: "Spent", value: fmt(r.totals.spent) },
  );
  if (r.savings) {
    lines.push({
      label: r.savings.source === "plan" ? "Savings rate" : "Kept of money in",
      value: `${Math.round(r.savings.ratePct)}%`,
    });
  }
  if (r.netWorth) {
    if (!hideAmounts) lines.push({ label: "Net worth change", value: `${r.netWorth.change >= 0 ? "+" : ""}${fmt(r.netWorth.change)}` });
    else if (r.netWorth.start > 0) lines.push({ label: "Net worth", value: pct((r.netWorth.change / r.netWorth.start) * 100) });
  }
  const topCat = r.categories.find((c) => c.id !== null || c.name !== "Everything else");
  if (topCat) {
    lines.push({
      label: "Top category",
      value: hideAmounts ? `${topCat.name} · ${Math.round(topCat.pct)}%` : `${topCat.name} · ${fmt(topCat.amount)}`,
    });
  }
  const fav = r.merchants.byVisits[0];
  if (fav) lines.push({ label: "Most visited", value: `${fav.name} · ${fav.count} times` });
  if (r.biggestMonth) {
    lines.push({
      label: "Biggest month",
      value: hideAmounts ? monthName(r.biggestMonth.month) : `${monthName(r.biggestMonth.month)} · ${fmt(r.biggestMonth.total)}`,
    });
  }
  if (r.debt && r.debt.reduced !== 0) {
    if (!hideAmounts) lines.push({ label: r.debt.reduced > 0 ? "Debt paid down" : "New debt", value: fmt(Math.abs(r.debt.reduced)) });
    else if (r.debt.start > 0) lines.push({ label: "Debt", value: pct((-r.debt.reduced / r.debt.start) * 100) });
  }
  if (r.invested) {
    if (!hideAmounts && r.invested.amount > 0) lines.push({ label: "Invested", value: fmt(r.invested.amount) });
    else if (r.invested.fdsOpened > 0) lines.push({ label: "FDs opened", value: String(r.invested.fdsOpened) });
  }
  if (r.vsLastYear?.spentChangePct != null) {
    lines.push({ label: "Spending vs last year", value: pct(r.vsLastYear.spentChangePct) });
  }
  return lines;
}

// ── "Your year is ready" card on Home ──

const REVIEW_CARD_DISMISSED_KEY = "year_review_card_dismissed_fy";

/** The FY the Home card should offer, or null when it's outside its window or was dismissed. */
export function getHomeReviewCardFY(today: Date = new Date()): number | null {
  const fy = getReadyReviewFY(today);
  if (fy == null) return null;
  return settingsStorage.getNumber(REVIEW_CARD_DISMISSED_KEY) === fy ? null : fy;
}

export function dismissHomeReviewCard(fy: number): void {
  settingsStorage.set(REVIEW_CARD_DISMISSED_KEY, fy);
  bumpDataVersion();
}
