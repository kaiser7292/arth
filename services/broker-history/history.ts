import { DEFAULT_USER_ID } from "@/constants/app";
import { getDatabase } from "@/database";
import { todayIso } from "@/utils/local-date";
import { calculateGains, fyOf, holdingDifferences, missingWeekdays, quarterOf, salesToTaxInput, type GainsTaxInput, type TradeRow } from "./compute";
import { HISTORY_BROKER_NAMES, type AssetClass, type GainCategory, type HistoryBroker } from "./types";

/** What the History tab and the Income Calculator show: a broker's report first, calculated figures after it. */

export type GainSource = "report" | "calculated";

export interface HistorySale {
  /** Null for a calculated sale: there's no saved row to correct. */
  id: string | null;
  source: GainSource;
  broker: string;
  symbol: string;
  isin: string | null;
  quantity: number;
  buyDate: string | null;
  sellDate: string;
  buyValue: number;
  sellValue: number;
  taxable: number;
  charges: number;
  stt: number;
  category: GainCategory;
  assetClass: AssetClass;
  checkReason: string | null;
}

export interface CaptureStatus {
  broker: HistoryBroker;
  brokerName: string;
  firstDate: string;
  lastCapturedAt: string;
  savedToday: boolean;
  missingDays: string[];
  /** Instruments whose holdings don't add up between the last two saves. */
  differences: string[];
}

export interface PeriodTotals {
  shortTerm: number;
  longTerm: number;
  crypto: number;
  /** Intraday, F&O, currency, commodity and buybacks: shown, but not capital gains. */
  otherIncome: number;
}

export interface AccountHistory {
  fy: number;
  sales: HistorySale[];
  totals: PeriodTotals;
  byQuarter: Record<1 | 2 | 3 | 4, number>;
  /** "report": every figure from a broker report. "calculated": at least one worked out from trades. "none": nothing yet. */
  source: "report" | "calculated" | "none";
  coveredUntil: string | null;
  unmatched: { symbol: string; quantity: number; date: string }[];
  needsCheck: number;
  gainsBasis: string | null;
  chargesTotal: number | null;
  money: {
    added: number;
    withdrawn: number;
    byQuarter: Record<1 | 2 | 3 | 4, { added: number; withdrawn: number }>;
    /** Statement entries with no matching transfer in Arth. */
    unmatched: number;
    hasRecords: boolean;
    /** Some of it comes from a broker statement. Where no statement covers, it's what Arth detected. */
    fromStatement: boolean;
  };
  /** Funds are often paid straight from the bank, so they never pass through the broker's ledger. */
  mutualFunds: { bought: number; sold: number };
  captures: CaptureStatus[];
  /** FYs with any record, newest first, so the year picker can stop at them. */
  brokers: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const emptyQuarters = () => ({ 1: 0, 2: 0, 3: 0, 4: 0 });
const fyRange = (fy: number) => ({ from: `${fy}-04-01`, to: `${fy + 1}-03-31` });

export const CAPITAL_GAIN_CATEGORIES: GainCategory[] = ["short_term", "long_term", "crypto"];

export const GAINS_BASIS: Partial<Record<HistoryBroker, string>> = {
  kite: "Zerodha's figures are before charges.",
  angel: "Angel One's figures are after charges, but before STT.",
  groww: "Groww's figures are before charges.",
};

/** Same instrument, whichever way it's been written: files carry ISINs, the APIs mostly don't. */
function normaliseTrades(rows: TradeRow[]): TradeRow[] {
  const clean = (s: string) => s.toUpperCase().replace(/-(EQ|BE|BZ|XT)$/, "").replace(/\$$/, "").trim();
  const isinOf = new Map<string, string>();
  for (const r of rows) if (r.isin) isinOf.set(clean(r.symbol), r.isin);
  return rows.map((r) => ({ ...r, isin: r.isin ?? isinOf.get(clean(r.symbol)) ?? null, symbol: clean(r.symbol) === clean(r.symbol) && !r.isin ? clean(r.symbol) : r.symbol }));
}

export async function getAccountHistory(accountId: string, fy: number, today: string = todayIso()): Promise<AccountHistory> {
  const db = getDatabase();
  const { from, to } = fyRange(fy);

  const [gainRows, imports, tradeRows, moveRows, captureRows, transfers] = await Promise.all([
    db.getAllAsync<{
      id: string; broker: string; symbol: string; isin: string | null; quantity: number; buy_date: string | null; sell_date: string;
      buy_value: number; sell_value: number; taxable: number; charges: number; stt: number; category: GainCategory; asset_class: AssetClass;
      check_reason: string | null; cost_override: number | null; class_override: AssetClass | null;
    }>(`SELECT * FROM broker_gains WHERE account_id = ? AND sell_date >= ? AND sell_date <= ? ORDER BY sell_date DESC;`, accountId, from, to),
    db.getAllAsync<{ broker: string; kind: string; period_from: string; period_to: string; charges_total: number | null }>(
      `SELECT broker, kind, period_from, period_to, charges_total FROM broker_report_imports WHERE account_id = ?;`,
      accountId,
    ),
    // Every trade, not just this year's: a sale this year may match a buy from years ago.
    db.getAllAsync<TradeRow & { broker: string }>(
      `SELECT broker, segment, symbol, isin, side, quantity, price, trade_date, trade_time FROM broker_trades WHERE account_id = ? ORDER BY trade_date, trade_time;`,
      accountId,
    ),
    db.getAllAsync<{ move_date: string; direction: string; amount: number; source: string }>(
      `SELECT move_date, direction, amount, source FROM broker_money_moves WHERE account_id = ? AND move_date >= ? AND move_date <= ?;`,
      accountId,
      from,
      to,
    ),
    db.getAllAsync<{ broker: HistoryBroker; capture_date: string; captured_at: string; holdings_json: string | null }>(
      `SELECT broker, capture_date, captured_at, holdings_json FROM broker_capture_days WHERE account_id = ? ORDER BY capture_date;`,
      accountId,
    ),
    db.getAllAsync<{ date: string; amount: number; from_account_id: string }>(
      `SELECT date, amount, from_account_id FROM account_transfers
        WHERE (from_account_id = ? OR to_account_id = ?) AND from_account_id != to_account_id
          AND deleted_at IS NULL AND date >= date(?, '-5 day') AND date <= date(?, '+5 day');`,
      accountId,
      accountId,
      from,
      to,
    ),
  ]);

  // ── Sales ──
  const reportSales: HistorySale[] = gainRows.map((g) => {
    const cost = g.cost_override;
    const corrected = cost != null;
    return {
      id: g.id,
      source: "report",
      broker: g.broker,
      symbol: g.symbol,
      isin: g.isin,
      quantity: g.quantity,
      buyDate: g.buy_date,
      sellDate: g.sell_date,
      buyValue: corrected ? cost : g.buy_value,
      sellValue: g.sell_value,
      taxable: corrected ? round2(g.taxable + g.buy_value - cost) : g.taxable,
      charges: g.charges,
      stt: g.stt,
      category: g.category,
      assetClass: g.class_override ?? g.asset_class,
      // Answered, so it stops asking. A ₹0 cost stays asked until there's a cost.
      checkReason: /₹0 cost/.test(g.check_reason ?? "") ? (corrected ? null : g.check_reason) : g.class_override ? null : g.check_reason,
    };
  });

  const gainImports = imports.filter((i) => i.kind === "gains" && i.period_from <= to && i.period_to >= from);
  const coveredUntil = gainImports.map((i) => i.period_to).sort().pop() ?? null;

  const eq = tradeRows.filter((t) => t.broker !== "zebpay");
  const crypto = tradeRows.filter((t) => t.broker === "zebpay");
  const normal = calculateGains(normaliseTrades(eq));
  const coins = calculateGains(crypto, true);
  const brokerOf = eq[0]?.broker ?? crypto[0]?.broker ?? "other";
  const inPeriod = (date: string) => date >= from && date <= to && (!coveredUntil || date > coveredUntil);
  const calculated: HistorySale[] = [...normal.sales, ...coins.sales]
    .filter((s) => inPeriod(s.sellDate))
    .map((s) => ({ ...s, id: null, source: "calculated" as const, broker: crypto.length && !eq.length ? "zebpay" : brokerOf, charges: 0, stt: 0, checkReason: null }));
  const unmatched = [...normal.unmatched, ...coins.unmatched].filter((u) => inPeriod(u.date));

  const sales = [...reportSales, ...calculated].sort((a, b) => b.sellDate.localeCompare(a.sellDate));
  const totals: PeriodTotals = { shortTerm: 0, longTerm: 0, crypto: 0, otherIncome: 0 };
  const byQuarter = emptyQuarters();
  for (const s of sales) {
    if (s.category === "short_term") totals.shortTerm += s.taxable;
    else if (s.category === "long_term") totals.longTerm += s.taxable;
    else if (s.category === "crypto") totals.crypto += s.taxable;
    else totals.otherIncome += s.taxable;
    byQuarter[quarterOf(s.sellDate)] += s.taxable;
  }
  (Object.keys(totals) as (keyof PeriodTotals)[]).forEach((k) => (totals[k] = round2(totals[k])));
  ([1, 2, 3, 4] as const).forEach((q) => (byQuarter[q] = round2(byQuarter[q])));

  // ── Money in and out ──
  const moneyQuarters = { 1: { added: 0, withdrawn: 0 }, 2: { added: 0, withdrawn: 0 }, 3: { added: 0, withdrawn: 0 }, 4: { added: 0, withdrawn: 0 } };
  let added = 0;
  let withdrawn = 0;
  let unmatchedMoves = 0;
  const ledgerImports = imports.filter((i) => i.kind === "ledger");
  const hasStatement = (date: string) => ledgerImports.some((i) => i.period_from <= date && i.period_to >= date);
  const count = (date: string, isIn: boolean, amount: number) => {
    const q = quarterOf(date);
    if (isIn) {
      added += amount;
      moneyQuarters[q].added += amount;
    } else {
      withdrawn += amount;
      moneyQuarters[q].withdrawn += amount;
    }
  };
  // A statement is the record for its period. Everywhere else it's the transfers Arth detected, plus
  // anything the daily saves noted that no transfer explains.
  for (const m of moveRows) {
    const mine = transfers.some((t) => {
      const days = Math.abs(Date.parse(t.date) - Date.parse(m.move_date)) / 86400000;
      const isOut = t.from_account_id === accountId;
      return days <= 3 && Math.abs(t.amount - m.amount) <= 1 && isOut === (m.direction === "out");
    });
    if (m.source === "file") {
      count(m.move_date, m.direction === "in", m.amount);
      if (!mine) unmatchedMoves++;
    } else if (!mine && !hasStatement(m.move_date)) {
      count(m.move_date, m.direction === "in", m.amount);
    }
  }
  let detectedCount = 0;
  for (const t of transfers) {
    if (t.date < from || t.date > to || hasStatement(t.date)) continue;
    detectedCount++;
    count(t.date, t.from_account_id !== accountId, t.amount);
  }
  ([1, 2, 3, 4] as const).forEach((q) => {
    moneyQuarters[q].added = round2(moneyQuarters[q].added);
    moneyQuarters[q].withdrawn = round2(moneyQuarters[q].withdrawn);
  });

  // ── Mutual funds ──
  const mf = tradeRows.filter((t) => t.segment === "MF" && t.trade_date >= from && t.trade_date <= to);
  const mfValue = (side: string) => round2(mf.filter((t) => t.side === side).reduce((s, t) => s + t.quantity * t.price, 0));

  // ── Daily saves ──
  const captures: CaptureStatus[] = [];
  for (const broker of [...new Set(captureRows.map((c) => c.broker))]) {
    const days = captureRows.filter((c) => c.broker === broker);
    const last = days[days.length - 1];
    let differences: string[] = [];
    const prev = days[days.length - 2];
    if (prev?.holdings_json && last.holdings_json) {
      try {
        const between = tradeRows
          .filter((t) => t.broker === broker && t.segment === "EQ" && t.trade_date >= prev.capture_date && t.trade_date < last.capture_date)
          .map((t) => ({ key: t.symbol, side: t.side, quantity: t.quantity }));
        differences = holdingDifferences(JSON.parse(prev.holdings_json), JSON.parse(last.holdings_json), between);
      } catch {
        differences = [];
      }
    }
    captures.push({
      broker,
      brokerName: HISTORY_BROKER_NAMES[broker] ?? broker,
      firstDate: days[0].capture_date,
      lastCapturedAt: last.captured_at,
      savedToday: last.capture_date === today,
      missingDays: broker === "zebpay" ? [] : missingWeekdays(days.map((d) => d.capture_date), today),
      differences,
    });
  }

  const brokers = [...new Set([...gainRows.map((g) => g.broker), ...tradeRows.map((t) => t.broker), ...imports.map((i) => i.broker), ...captureRows.map((c) => c.broker)])];
  const reportBroker = gainImports[0]?.broker as HistoryBroker | undefined;

  return {
    fy,
    sales,
    totals,
    byQuarter,
    source: calculated.length > 0 || unmatched.length > 0 ? "calculated" : reportSales.length > 0 || gainImports.length > 0 ? "report" : "none",
    coveredUntil,
    unmatched,
    needsCheck: reportSales.filter((s) => s.checkReason).length,
    gainsBasis: reportBroker ? GAINS_BASIS[reportBroker] ?? null : null,
    chargesTotal: gainImports.length ? round2(gainImports.reduce((s, i) => s + (i.charges_total ?? 0), 0)) : null,
    money: {
      added: round2(added),
      withdrawn: round2(withdrawn),
      byQuarter: moneyQuarters,
      unmatched: unmatchedMoves,
      hasRecords: moveRows.length > 0 || detectedCount > 0,
      fromStatement: moveRows.some((m) => m.source === "file"),
    },
    mutualFunds: { bought: mfValue("buy"), sold: mfValue("sell") },
    captures,
    brokers,
  };
}

// ─── With broker records off ────────────────────────────────────────────────

export interface DetectedMoney {
  added: number;
  withdrawn: number;
  byQuarter: Record<1 | 2 | 3 | 4, { added: number; withdrawn: number }>;
  count: number;
}

/** Money in and out from the transfers Arth detected for this account. Nothing from any broker. */
export async function getDetectedMoney(accountId: string, fy: number): Promise<DetectedMoney> {
  const { from, to } = fyRange(fy);
  const rows = await getDatabase().getAllAsync<{ date: string; amount: number; from_account_id: string; to_account_id: string }>(
    `SELECT date, amount, from_account_id, to_account_id FROM account_transfers
      WHERE (from_account_id = ? OR to_account_id = ?) AND from_account_id != to_account_id
        AND deleted_at IS NULL AND date >= ? AND date <= ?;`,
    accountId,
    accountId,
    from,
    to,
  );
  const out: DetectedMoney = {
    added: 0,
    withdrawn: 0,
    byQuarter: { 1: { added: 0, withdrawn: 0 }, 2: { added: 0, withdrawn: 0 }, 3: { added: 0, withdrawn: 0 }, 4: { added: 0, withdrawn: 0 } },
    count: rows.length,
  };
  for (const r of rows) {
    const q = quarterOf(r.date);
    if (r.to_account_id === accountId) {
      out.added += r.amount;
      out.byQuarter[q].added += r.amount;
    } else {
      out.withdrawn += r.amount;
      out.byQuarter[q].withdrawn += r.amount;
    }
  }
  out.added = round2(out.added);
  out.withdrawn = round2(out.withdrawn);
  ([1, 2, 3, 4] as const).forEach((q) => {
    out.byQuarter[q].added = round2(out.byQuarter[q].added);
    out.byQuarter[q].withdrawn = round2(out.byQuarter[q].withdrawn);
  });
  return out;
}

// ─── Income Calculator ──────────────────────────────────────────────────────

export interface GainsLine {
  accountId: string;
  name: string;
  source: "report" | "calculated";
  shortTerm: number;
  longTerm: number;
  crypto: number;
  otherIncome: number;
  needsCheck: number;
  unmatched: number;
}

export interface YearGains {
  lines: GainsLine[];
  input: GainsTaxInput;
  /** Any figure still worked out from trades, rather than stated by a broker. */
  hasCalculated: boolean;
}

export async function getYearGains(fy: number, userId: string = DEFAULT_USER_ID): Promise<YearGains> {
  const db = getDatabase();
  const accounts = await db.getAllAsync<{ id: string; account_label: string | null; bank_name: string }>(
    `SELECT DISTINCT fa.id, fa.account_label, fa.bank_name FROM financial_accounts fa
      WHERE fa.user_id = ? AND (
        fa.id IN (SELECT account_id FROM broker_gains)
        OR fa.id IN (SELECT account_id FROM broker_trades)
      );`,
    userId,
  );
  const lines: GainsLine[] = [];
  const allSales: HistorySale[] = [];
  for (const a of accounts) {
    const h = await getAccountHistory(a.id, fy);
    if (h.sales.length === 0 && h.unmatched.length === 0) continue;
    allSales.push(...h.sales);
    lines.push({
      accountId: a.id,
      name: a.account_label || a.bank_name,
      source: h.source === "calculated" ? "calculated" : "report",
      shortTerm: h.totals.shortTerm,
      longTerm: h.totals.longTerm,
      crypto: h.totals.crypto,
      otherIncome: h.totals.otherIncome,
      needsCheck: h.needsCheck,
      unmatched: h.unmatched.length,
    });
  }
  return {
    lines,
    input: salesToTaxInput(allSales),
    hasCalculated: lines.some((l) => l.source === "calculated"),
  };
}

export { fyOf };
