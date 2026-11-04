import type {
  AssetClass,
  GainCategory,
  HistoryBroker,
  ParsedGain,
  ParsedMoneyMove,
  ParsedReport,
  ParsedTrade,
  ParseOutcome,
  ReportKind,
  SheetRows,
  Workbook,
} from "./types";

/**
 * Reads broker report files. Pure: rows in, records out, so every format is tested with invented rows.
 *
 * Everything is found by its label, never its position: rows shift between two downloads of the same
 * report, and sections come and go with what the user traded.
 */

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const text = (v: unknown) => String(v ?? "").trim();
const round2 = (n: number) => Math.round(n * 100) / 100;

export function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (y: number, m: number, d: number) =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;

/** A date in any form the reports use: 2026-07-02, 05/05/2026, 16-04-2026 11:03 AM, 07 Oct 2025, or an Excel day number. */
export function parseDate(v: unknown): string | null {
  if (typeof v === "number") {
    // Excel's day count. The range keeps a stray quantity from reading as a date.
    if (v < 30000 || v > 80000) return null;
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const s = text(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{4})/);
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase());
    if (month >= 0) return iso(+m[3], month + 1, +m[1]);
  }
  return null;
}

/** The time in a date-time cell, as HH:MM:SS. */
export function parseTimeOf(v: unknown): string | null {
  const m = text(v).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?/i);
  if (!m) return null;
  let h = +m[1];
  const ap = m[4]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`;
}

/** Column positions by label, from a header row. */
type Columns = Record<string, number>;
const columnsOf = (row: unknown[]): Columns => {
  const out: Columns = {};
  row.forEach((c, i) => {
    const k = norm(c);
    if (k && out[k] === undefined) out[k] = i;
  });
  return out;
};

const isHeader = (row: unknown[], labels: string[]) => {
  const cols = columnsOf(row);
  return labels.every((l) => cols[l] !== undefined);
};

function findHeader(rows: SheetRows, labels: string[], from = 0): number {
  for (let i = from; i < rows.length; i++) if (isHeader(rows[i], labels)) return i;
  return -1;
}

/** The value beside a label anywhere in the sheet's first rows: "Client ID | X". */
function labelled(rows: SheetRows, label: string): unknown {
  const key = norm(label);
  for (const r of rows.slice(0, 60)) {
    for (let i = 0; i < r.length - 1; i++) if (norm(r[i]) === key) return r[i + 1];
  }
  return undefined;
}

/** Sold on an exchange but not taxed as shares, going by the name. Worth the user's eye, not a certainty. */
const BOND = /\b(NCD|BOND|BONDS|SGB|DEBENTURE)\b|\d+(?:\.\d+)?%/i;
const GOLD_SILVER = /GOLD|SILVER/i;
const OVERSEAS = /MAFANG|MON100|MAHKTECH|HANGSENG|NASDAQ|N100|MASPTOP|S&P ?500|US ?TECH/i;

/**
 * Funds carry an INF ISIN, shares INE. Gold and overseas names only count on funds, so a company
 * called Goldiam stays a share.
 */
export function classifyInstrument(name: string, isin: string | null = null): { assetClass: AssetClass; checkReason: string | null } {
  if (BOND.test(name)) return { assetClass: "debt", checkReason: "Looks like a bond, which isn't taxed like shares" };
  const fund = !isin || isin.startsWith("INF");
  if (fund && GOLD_SILVER.test(name)) return { assetClass: "gold", checkReason: "Looks like a gold or silver fund, which isn't taxed like shares" };
  if (fund && OVERSEAS.test(name)) return { assetClass: "debt", checkReason: "Looks like an overseas fund, which isn't taxed like Indian shares" };
  return { assetClass: "equity", checkReason: null };
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** A capital gains row, with the checks every broker's rows get. */
function capitalGain(g: Omit<ParsedGain, "assetClass" | "checkReason">, classifyAs?: string): ParsedGain {
  const { assetClass, checkReason } = classifyInstrument(classifyAs ?? g.symbol, g.isin);
  const noCost = g.buyValue <= 0 && g.sellValue > 0;
  return {
    ...g,
    assetClass,
    checkReason: noCost ? "Shows ₹0 cost, often because the shares moved in from another broker" : checkReason,
  };
}

/** Business income: no asset class question to ask. */
const businessGain = (g: Omit<ParsedGain, "assetClass" | "checkReason">): ParsedGain => ({ ...g, assetClass: "equity", checkReason: null });

function report(
  broker: HistoryBroker,
  kind: ReportKind,
  label: string,
  period: { from: string | null; to: string | null },
  dates: string[],
  parts: { gains?: ParsedGain[]; trades?: ParsedTrade[]; moves?: ParsedMoneyMove[]; chargesTotal?: number | null; gainsBasis?: string | null; warnings?: string[] },
): ParsedReport | null {
  const sorted = [...dates].sort();
  const from = period.from ?? sorted[0];
  const to = period.to ?? sorted[sorted.length - 1];
  if (!from || !to) return null;
  return {
    broker,
    kind,
    label,
    periodFrom: from,
    periodTo: to,
    gains: parts.gains ?? [],
    trades: parts.trades ?? [],
    moves: parts.moves ?? [],
    chargesTotal: parts.chargesTotal ?? null,
    gainsBasis: parts.gainsBasis ?? null,
    warnings: parts.warnings ?? [],
  };
}

function periodInText(s: string): { from: string | null; to: string | null } {
  const found = [...s.matchAll(/\d{4}-\d{2}-\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}/g)].map((m) => parseDate(m[0]));
  return { from: found[0] ?? null, to: found[1] ?? null };
}

// ─── Zerodha ────────────────────────────────────────────────────────────────

function zerodhaCategory(section: string, entry: string | null, exit: string): GainCategory | null {
  const s = section.toLowerCase();
  if (s.includes("intraday")) return "intraday";
  if (s.includes("buyback")) return "buyback";
  if (s.includes("f&o")) return "fno";
  if (s.includes("currency")) return "currency";
  if (s.includes("commodity")) return "commodity";
  if (s.includes("short")) return "short_term";
  if (s.includes("long")) return "long_term";
  if (s.includes("mutual") || s.includes("equity")) {
    return entry && daysBetween(entry, exit) > 365 ? "long_term" : "short_term";
  }
  return null;
}

function parseZerodhaTaxPnl(wb: Workbook): ParsedReport | null {
  const name = Object.keys(wb).find((n) => /^tradewise exits/i.test(n));
  if (!name) return null;
  const rows = wb[name];
  const gains: ParsedGain[] = [];
  let section = "";
  let cols: Columns | null = null;
  for (const r of rows) {
    if (isHeader(r, ["symbol", "entrydate", "exitdate"])) {
      cols = columnsOf(r);
      continue;
    }
    const cells = r.filter((c) => text(c) !== "");
    if (cells.length === 1) {
      section = text(cells[0]);
      cols = null;
      continue;
    }
    if (!cols) continue;
    const exit = parseDate(r[cols.exitdate]);
    if (!exit) continue;
    const entry = parseDate(r[cols.entrydate]);
    const category = zerodhaCategory(section, entry, exit);
    if (!category) continue;
    const buyValue = num(r[cols.buyvalue]);
    const row = {
      symbol: text(r[cols.symbol]),
      isin: text(r[cols.isin]) || null,
      quantity: num(r[cols.quantity]),
      buyDate: entry,
      sellDate: exit,
      buyValue,
      sellValue: num(r[cols.sellvalue]),
      taxable: num(r[cols.taxableprofit] ?? cols.profit),
      stt: num(r[cols.stt]),
      charges: ["brokerage", "exchangetransactioncharges", "ipft", "sebicharges", "cgst", "sgst", "igst", "stampduty"].reduce((s, k) => s + num(r[cols![k]]), 0),
      category,
    };
    gains.push(category === "short_term" || category === "long_term" ? capitalGain(row) : businessGain(row));
  }
  const period = periodInText(rows.map((r) => text(r[0])).find((s) => /^tradewise exits from/i.test(s)) ?? "");
  return report("kite", "gains", "Zerodha Tax P&L", period, gains.map((g) => g.sellDate), {
    gains,
    chargesTotal: round2(gains.reduce((s, g) => s + g.charges + g.stt, 0)),
    gainsBasis: "Zerodha's figures are before charges.",
  });
}

const ZERODHA_TRADEBOOK = ["symbol", "tradedate", "tradetype", "quantity", "price"];

function parseZerodhaTradebook(wb: Workbook): ParsedReport | null {
  for (const rows of Object.values(wb)) {
    const h = findHeader(rows, ZERODHA_TRADEBOOK);
    if (h < 0) continue;
    const c = columnsOf(rows[h]);
    const trades: ParsedTrade[] = [];
    for (const r of rows.slice(h + 1)) {
      const date = parseDate(r[c.tradedate]);
      const side = norm(r[c.tradetype]);
      if (!date || (side !== "buy" && side !== "sell")) continue;
      const segment = text(r[c.segment]).toUpperCase();
      trades.push({
        segment: segment === "MF" ? "MF" : segment === "FO" || segment === "F&O" ? "FO" : "EQ",
        symbol: text(r[c.symbol]),
        isin: text(r[c.isin]) || null,
        exchange: text(r[c.exchange]) || null,
        product: null,
        side,
        quantity: num(r[c.quantity]),
        price: num(r[c.price]),
        tradeDate: date,
        tradeTime: parseTimeOf(r[c.orderexecutiontime]),
        orderId: text(r[c.orderid]) || null,
        tradeId: text(r[c.tradeid]) || null,
      });
    }
    const isMf = trades.length > 0 && trades.every((t) => t.segment === "MF");
    return report("kite", "tradebook", isMf ? "Zerodha mutual fund tradebook" : "Zerodha tradebook", { from: null, to: null }, trades.map((t) => t.tradeDate), { trades });
  }
  return null;
}

function parseZerodhaLedger(wb: Workbook): ParsedReport | null {
  for (const rows of Object.values(wb)) {
    const h = findHeader(rows, ["particulars", "postingdate", "vouchertype", "debit", "credit"]);
    if (h < 0) continue;
    const c = columnsOf(rows[h]);
    const moves: ParsedMoneyMove[] = [];
    const dates: string[] = [];
    for (const r of rows.slice(h + 1)) {
      const date = parseDate(r[c.postingdate]);
      if (!date) continue;
      dates.push(date);
      // The voucher type, not the wording: Zerodha words a payout several ways.
      const voucher = norm(r[c.vouchertype]);
      const narration = text(r[c.particulars]);
      const reference = narration.match(/reference number\s+(\S+)/i)?.[1] ?? null;
      if (voucher === "bankreceipts" && num(r[c.credit]) > 0) moves.push({ date, direction: "in", amount: num(r[c.credit]), reference, narration });
      if (voucher === "bankpayments" && num(r[c.debit]) > 0) moves.push({ date, direction: "out", amount: num(r[c.debit]), reference, narration });
    }
    return report("kite", "ledger", "Zerodha ledger", { from: null, to: null }, dates, { moves });
  }
  return null;
}

// ─── Angel One ──────────────────────────────────────────────────────────────

const toFromDate = (rows: SheetRows) => {
  const from = parseDate(labelled(rows, "From Date"));
  const to = parseDate(labelled(rows, "To Date"));
  const downloaded = parseDate(labelled(rows, "Date Of Download"));
  // Angel's report can say a "To Date" a year ahead. It can't cover past the day it was downloaded.
  return { from, to: to && downloaded && to > downloaded ? downloaded : to ?? downloaded };
};

function parseAngelTaxPnl(wb: Workbook): ParsedReport | null {
  const equity = wb["Equity+Bonds+SGB Trade Details"];
  if (!equity) return null;
  const gains: ParsedGain[] = [];
  const warnings: string[] = [];
  let section = "";
  let cols: Columns | null = null;
  for (const r of equity) {
    const cells = r.filter((c) => text(c) !== "");
    if (cells.length === 1) {
      section = norm(cells[0]);
      cols = null;
      continue;
    }
    if (norm(r[0]) === "isin") {
      cols = columnsOf(r);
      continue;
    }
    if (!cols || !/^IN[A-Z0-9]{10}$/.test(text(r[0]))) continue;
    const base = { isin: text(r[cols.isin]), symbol: text(r[cols.scripname]), quantity: num(r[cols.qty]) };
    const money = {
      buyValue: num(r[cols.buyvalue]),
      sellValue: num(r[cols.sellvalue]),
      charges: num(r[cols.chargesandstatutorylevies]),
      stt: num(r[cols.stt]),
    };
    if (section.startsWith("intraday")) {
      const date = parseDate(r[cols.transactiondate]);
      if (date) gains.push(businessGain({ ...base, ...money, buyDate: date, sellDate: date, taxable: num(r[cols.taxablepl]), category: "intraday" }));
    } else if (section.startsWith("delivery")) {
      const sell = parseDate(r[cols.selldate]);
      if (!sell) continue;
      const long = text(r[cols.longtermtaxableincome]) !== "";
      gains.push(
        capitalGain(
          { ...base, ...money, buyDate: parseDate(r[cols.buydate]), sellDate: sell, taxable: num(r[long ? cols.longtermtaxableincome : cols.shorttermtaxableincome]), category: long ? "long_term" : "short_term" },
          `${base.symbol} ${text(r[cols.typeofinstrument]).replace(/equity\/corporate bonds/i, "")}`,
        ),
      );
    } else if (section.startsWith("buyback")) {
      const sell = parseDate(r[cols.buybackdate]);
      if (sell) {
        gains.push(
          businessGain({
            ...base,
            buyDate: parseDate(r[cols.buydate]),
            sellDate: sell,
            buyValue: money.buyValue,
            sellValue: num(r[cols.buybackvalue]),
            charges: money.charges,
            stt: money.stt,
            taxable: num(r[cols.longtermtaxableincome]) + num(r[cols.shorttermtaxableincome]),
            category: "buyback",
          }),
        );
      }
    } else if (section.startsWith("transfer")) {
      warnings.push(`${base.symbol} was transferred out. Transfers aren't sales, so it isn't counted.`);
    }
  }
  const fno = wb["Derivatives Trade Details"] ?? [];
  let fnoCols: Columns | null = null;
  for (const r of fno) {
    if (isHeader(r, ["symbolname", "buydate", "selldate"])) {
      fnoCols = columnsOf(r);
      continue;
    }
    if (!fnoCols) continue;
    const sell = parseDate(r[fnoCols.selldate]);
    if (!sell) continue;
    gains.push(
      businessGain({
        symbol: text(r[fnoCols.symbolname]),
        isin: null,
        quantity: num(r[fnoCols.qty]),
        buyDate: parseDate(r[fnoCols.buydate]),
        sellDate: sell,
        buyValue: num(r[fnoCols.buyvalue]),
        sellValue: num(r[fnoCols.sellvalue]),
        charges: num(r[fnoCols.totalchargesandstatutorylevies]),
        stt: num(r[fnoCols.stt]),
        taxable: num(r[fnoCols.taxablepl]),
        category: "fno",
      }),
    );
  }
  return report("angel", "gains", "Angel One Tax P&L", toFromDate(wb.Summary ?? []), gains.map((g) => g.sellDate), {
    gains,
    warnings,
    chargesTotal: round2(gains.reduce((s, g) => s + g.charges + g.stt, 0)),
    gainsBasis: "Angel One's figures are after charges, but before STT.",
  });
}

const ANGEL_FUNDS_IN = /funds?\s*added|pay-?in/i;
const ANGEL_FUNDS_OUT = /quarterly settlement|settlement of funds|funds?\s*(withdraw|paid out|payout)|withdrawal|pay-?out/i;

function parseAngelLedger(wb: Workbook): ParsedReport | null {
  const rows = wb["Broking Ledger"];
  if (!rows) return null;
  const h = findHeader(rows, ["transaction", "date", "voucher", "debit", "credit"]);
  if (h < 0) return null;
  const c = columnsOf(rows[h]);
  const moves: ParsedMoneyMove[] = [];
  const dates: string[] = [];
  for (const r of rows.slice(h + 1)) {
    const date = parseDate(r[c.date]);
    if (!date) continue;
    dates.push(date);
    const narration = text(r[c.transaction]);
    const reference = text(r[c.voucher]) || null;
    if (ANGEL_FUNDS_IN.test(narration) && num(r[c.credit]) > 0) moves.push({ date, direction: "in", amount: num(r[c.credit]), reference, narration });
    else if (ANGEL_FUNDS_OUT.test(narration) && num(r[c.debit]) > 0) moves.push({ date, direction: "out", amount: num(r[c.debit]), reference, narration });
  }
  return report("angel", "ledger", "Angel One ledger", { from: parseDate(labelled(rows, "StartDate")), to: parseDate(labelled(rows, "EndDate")) }, dates, { moves });
}

function parseAngelTrades(wb: Workbook): ParsedReport | null {
  const rows = wb.TradesAndCharges;
  if (!rows) return null;
  const h = findHeader(rows, ["scripcontract", "buysell", "quantity", "tradeid", "date"]);
  if (h < 0) return null;
  const c = columnsOf(rows[h]);
  const trades: ParsedTrade[] = [];
  for (const r of rows.slice(h + 1)) {
    const date = parseDate(r[c.date]);
    const side = norm(r[c.buysell]);
    if (!date || (side !== "buy" && side !== "sell")) continue;
    trades.push({
      segment: /deriv|fno|f&o/i.test(text(r[c.segment])) ? "FO" : "EQ",
      symbol: text(r[c.scripcontract]),
      isin: null,
      exchange: text(r[c.exchange]) || null,
      product: /intraday/i.test(text(r[c.ordertype])) ? "MIS" : "CNC",
      side,
      quantity: num(r[c.quantity]),
      price: num(r[side === "buy" ? c.buyprice : c.sellprice]),
      tradeDate: date,
      tradeTime: null,
      orderId: text(r[c.orderid]) || null,
      tradeId: text(r[c.tradeid]) || null,
    });
  }
  return report("angel", "tradebook", "Angel One trade history", { from: parseDate(labelled(rows, "StartDate")), to: null }, trades.map((t) => t.tradeDate), { trades });
}

// ─── Groww ──────────────────────────────────────────────────────────────────

const GROWW_PNL = ["stockname", "isin", "buydate", "selldate", "realisedpl"];

function parseGrowwStocksPnl(wb: Workbook, fileName: string): ParsedReport | null {
  const rows = wb["Trade Level"];
  if (!rows) return null;
  const h = findHeader(rows, GROWW_PNL);
  if (h < 0) return null;
  const c = columnsOf(rows[h]);
  const gains: ParsedGain[] = [];
  for (const r of rows.slice(h + 1)) {
    // Realised rows end where the unrealised ones begin, under a header of nearly the same shape.
    if (norm(r[0]) === "unrealisedtrades") break;
    const sell = parseDate(r[c.selldate]);
    if (!sell) continue;
    const buy = parseDate(r[c.buydate]);
    const base = {
      symbol: text(r[c.stockname]),
      isin: text(r[c.isin]) || null,
      quantity: num(r[c.quantity]),
      buyDate: buy,
      sellDate: sell,
      buyValue: num(r[c.buyvalue]),
      sellValue: num(r[c.sellvalue]),
      taxable: num(r[c.realisedpl]),
      charges: 0,
      stt: 0,
    };
    // Groww marks intraday trades, but leaves short and long term to the dates.
    if (/intraday/i.test(text(r[c.remark]))) gains.push(businessGain({ ...base, category: "intraday" }));
    else gains.push(capitalGain({ ...base, category: buy && daysBetween(buy, sell) > 365 ? "long_term" : "short_term" }));
  }
  const period = periodInText(rows.slice(0, h).map((r) => text(r[0])).find((s) => /statement/i.test(s)) ?? "");
  const fromName = periodInText(fileName);
  return report("groww", "gains", "Groww stocks P&L", { from: period.from ?? fromName.from, to: period.to ?? fromName.to }, gains.map((g) => g.sellDate), {
    gains,
    chargesTotal: labelled(rows, "Total") !== undefined ? num(labelled(rows, "Total")) : null,
    gainsBasis: "Groww's figures are before charges.",
  });
}

function parseGrowwFno(wb: Workbook, fileName: string): ParsedReport | null {
  const rows = wb["Trade Level"];
  if (!rows || findHeader(rows, ["scripname", "buydate", "selldate", "realizedpl"]) < 0) return null;
  const gains: ParsedGain[] = [];
  let c: Columns | null = null;
  for (const r of rows) {
    if (isHeader(r, ["scripname", "buydate", "selldate"])) {
      c = columnsOf(r);
      continue;
    }
    if (!c) continue;
    const sell = parseDate(r[c.selldate]);
    if (!sell) continue;
    gains.push(
      businessGain({
        symbol: text(r[c.scripname]),
        isin: null,
        quantity: num(r[c.quantity]),
        buyDate: parseDate(r[c.buydate]),
        sellDate: sell,
        buyValue: num(r[c.buyvalue]),
        sellValue: num(r[c.sellvalue]),
        taxable: num(r[c.realizedpl]),
        charges: 0,
        stt: 0,
        category: "fno",
      }),
    );
  }
  const fromName = periodInText(fileName);
  return report("groww", "gains", "Groww F&O P&L", fromName, gains.map((g) => g.sellDate), {
    gains,
    chargesTotal: labelled(rows, "Total") !== undefined ? num(rows.filter((r) => norm(r[0]) === "total").pop()?.[1]) : null,
    gainsBasis: "Groww's figures are before charges.",
  });
}

function parseGrowwOrders(wb: Workbook): ParsedReport | null {
  for (const rows of Object.values(wb)) {
    const h = findHeader(rows, ["stockname", "symbol", "type", "quantity", "value", "executiondateandtime"]);
    if (h < 0) continue;
    const c = columnsOf(rows[h]);
    const trades: ParsedTrade[] = [];
    for (const r of rows.slice(h + 1)) {
      const date = parseDate(r[c.executiondateandtime]);
      const side = norm(r[c.type]);
      const quantity = num(r[c.quantity]);
      if (!date || quantity <= 0 || (side !== "buy" && side !== "sell")) continue;
      if (norm(r[c.orderstatus]) !== "executed") continue;
      trades.push({
        segment: "EQ",
        symbol: text(r[c.symbol]).replace(/\$$/, "") || text(r[c.stockname]),
        isin: text(r[c.isin]) || null,
        exchange: text(r[c.exchange]) || null,
        product: null,
        side,
        quantity,
        price: num(r[c.value]) / quantity,
        tradeDate: date,
        tradeTime: parseTimeOf(r[c.executiondateandtime]),
        orderId: text(r[c.exchangeorderid]) || null,
        tradeId: null,
      });
    }
    return report("groww", "tradebook", "Groww order history", { from: null, to: null }, trades.map((t) => t.tradeDate), {
      trades,
      warnings: ["Groww lists whole orders, not each trade, so prices are the order's average."],
    });
  }
  return null;
}

function parseGrowwBalance(wb: Workbook, fileName: string): ParsedReport | null {
  for (const rows of Object.values(wb)) {
    const h = findHeader(rows, ["transactiondate", "segmenttype", "voucherno", "debitrs", "creditrs"]);
    if (h < 0) continue;
    const c = columnsOf(rows[h]);
    const moves: ParsedMoneyMove[] = [];
    const dates: string[] = [];
    for (const r of rows.slice(h + 1)) {
      const date = parseDate(r[c.transactiondate]);
      if (!date) continue;
      dates.push(date);
      // DEP and WTD vouchers, not the segment: a deposit can be UPI, net banking or anything else.
      const voucher = text(r[c.voucherno]);
      const segment = text(r[c.segmenttype]);
      if (/^DEP/i.test(voucher) && num(r[c.creditrs]) > 0) moves.push({ date, direction: "in", amount: num(r[c.creditrs]), reference: voucher, narration: segment });
      if (/^WTD/i.test(voucher) && num(r[c.debitrs]) > 0) moves.push({ date, direction: "out", amount: num(r[c.debitrs]), reference: voucher, narration: segment });
    }
    const title = rows.slice(0, h).map((r) => text(r[0])).find((s) => /statement/i.test(s)) ?? "";
    const period = periodInText(title);
    const fromName = periodInText(fileName);
    return report("groww", "ledger", "Groww balance statement", { from: period.from ?? fromName.from, to: period.to ?? fromName.to }, dates, { moves });
  }
  return null;
}

// ─── Reports worth saying no to ─────────────────────────────────────────────

function notNeeded(wb: Workbook): string | null {
  const names = Object.keys(wb);
  const firstRows = Object.values(wb).flatMap((rows) => rows.slice(0, 6)).map((r) => text(r[0]).toLowerCase());
  if (firstRows.some((s) => s.startsWith("p&l statement for")) && names.some((n) => ["Equity", "Mutual Funds"].includes(n))) {
    return "This Zerodha P&L report has no sale dates. Import the Tax P&L instead: Console > Reports > Tax P&L.";
  }
  if (names.includes("Equity P&L") && names.includes("F&O P&L")) {
    return "This Angel One P&L report has no sale dates. Import the Tax P&L instead.";
  }
  if (names.includes("Fund Holdings") || names.includes("Transaction History") && firstRows.includes("angel one")) {
    return "This is an Angel One mutual fund statement. Arth doesn't read it yet, and it isn't needed for your share gains.";
  }
  return null;
}

// ─── Entry point ────────────────────────────────────────────────────────────

/** Work out what a file is from its contents, whatever it's been named. */
export function parseBrokerFile(wb: Workbook, fileName: string): ParseOutcome {
  const parsers: (() => ParsedReport | null)[] = [
    () => parseZerodhaTaxPnl(wb),
    () => parseZerodhaTradebook(wb),
    () => parseZerodhaLedger(wb),
    () => parseAngelTaxPnl(wb),
    () => parseAngelLedger(wb),
    () => parseAngelTrades(wb),
    () => parseGrowwStocksPnl(wb, fileName),
    () => parseGrowwFno(wb, fileName),
    () => parseGrowwOrders(wb),
    () => parseGrowwBalance(wb, fileName),
  ];
  for (const parse of parsers) {
    const parsed = parse();
    if (parsed) return { status: "ok", report: parsed };
  }
  const message = notNeeded(wb);
  return message ? { status: "not_needed", message } : { status: "unknown" };
}

// ─── A file Arth doesn't know: the user says which column is which ──────────

export interface GenericColumns {
  symbol: number;
  side: number;
  quantity: number;
  price: number;
  date: number;
}

/** The likeliest table in an unknown file: the first row with at least four text labels and rows beneath it. */
export function findTable(wb: Workbook): { sheet: string; headerRow: number; columns: string[] } | null {
  for (const [sheet, rows] of Object.entries(wb)) {
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const labels = rows[i].filter((c) => typeof c === "string" && /[a-z]/i.test(c));
      if (labels.length >= 4 && rows.length > i + 1) return { sheet, headerRow: i, columns: rows[i].map(text) };
    }
  }
  return null;
}

const GUESSES: Record<keyof GenericColumns, RegExp> = {
  symbol: /symbol|scrip|stock|instrument|security|name/i,
  side: /buy.?\/?.?sell|\bb\/s\b|side|type|transaction/i,
  quantity: /qty|quantity|units/i,
  price: /price|rate|nav/i,
  date: /date|time/i,
};

export function guessColumns(columns: string[]): Partial<GenericColumns> {
  const out: Partial<GenericColumns> = {};
  for (const key of Object.keys(GUESSES) as (keyof GenericColumns)[]) {
    const i = columns.findIndex((c) => GUESSES[key].test(c));
    if (i >= 0) out[key] = i;
  }
  return out;
}

/** Trades from an unknown file, once the user has matched its columns. Rows that don't read are counted, not guessed at. */
export function parseGenericTrades(rows: SheetRows, headerRow: number, c: GenericColumns): { report: ParsedReport | null; skipped: number } {
  const trades: ParsedTrade[] = [];
  let skipped = 0;
  for (const r of rows.slice(headerRow + 1)) {
    const date = parseDate(r[c.date]);
    const s = norm(r[c.side]);
    const side = s === "buy" || s === "b" || s === "bought" ? "buy" : s === "sell" || s === "s" || s === "sold" ? "sell" : null;
    const quantity = Math.abs(num(r[c.quantity]));
    const price = num(r[c.price]);
    const symbol = text(r[c.symbol]);
    if (!date || !side || !symbol || quantity <= 0 || price <= 0) {
      skipped++;
      continue;
    }
    trades.push({ segment: "EQ", symbol, isin: null, exchange: null, product: null, side, quantity, price, tradeDate: date, tradeTime: parseTimeOf(r[c.date]), orderId: null, tradeId: null });
  }
  return { report: report("other", "tradebook", "Tradebook", { from: null, to: null }, trades.map((t) => t.tradeDate), { trades }), skipped };
}
