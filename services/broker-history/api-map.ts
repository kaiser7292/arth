import type { ParsedTrade } from "./types";

/**
 * API answers into trades. Pure. Fields are read carefully and rows that don't make sense are left
 * out, because a wrong trade is worse than a missing one: a gap gets flagged, a wrong number doesn't.
 */

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(str(v));
  return Number.isFinite(n) ? n : 0;
};
const sideOf = (v: unknown): "buy" | "sell" | null => {
  const s = str(v).toLowerCase();
  return s === "buy" || s === "bid" ? "buy" : s === "sell" || s === "ask" ? "sell" : null;
};
/** "2026-11-04 09:16:39" or "2026-11-04T09:16:39" into its date and time. */
const stamp = (v: unknown): { date: string | null; time: string | null } => {
  const m = str(v).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  return m ? { date: m[1], time: m[2] } : { date: str(v).match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null, time: null };
};

export function mapKiteTrades(rows: Row[], today: string): ParsedTrade[] {
  const out: ParsedTrade[] = [];
  for (const r of rows) {
    const side = sideOf(r.transaction_type);
    const quantity = num(r.quantity ?? r.filled);
    const price = num(r.average_price);
    const symbol = str(r.tradingsymbol);
    const tradeId = str(r.trade_id);
    if (!side || quantity <= 0 || price <= 0 || !symbol || !tradeId) continue;
    const { date, time } = stamp(r.fill_timestamp ?? r.exchange_timestamp);
    const exchange = str(r.exchange);
    out.push({
      segment: exchange === "NFO" || exchange === "BFO" || exchange === "CDS" || exchange === "MCX" ? "FO" : "EQ",
      symbol,
      isin: null,
      exchange: exchange || null,
      product: str(r.product) || null,
      side,
      quantity,
      price,
      tradeDate: date ?? today,
      tradeTime: time,
      orderId: str(r.order_id) || null,
      tradeId,
    });
  }
  return out;
}

/** Only completed orders with units allotted. On Kite a fund's trading symbol is its ISIN. */
export function mapKiteMfOrders(rows: Row[]): ParsedTrade[] {
  const out: ParsedTrade[] = [];
  for (const r of rows) {
    if (str(r.status).toUpperCase() !== "COMPLETE") continue;
    const side = sideOf(r.transaction_type);
    const quantity = num(r.quantity);
    const price = num(r.average_price);
    const { date } = stamp(r.exchange_timestamp ?? r.order_timestamp);
    const orderId = str(r.order_id);
    if (!side || quantity <= 0 || price <= 0 || !date || !orderId) continue;
    const isin = str(r.tradingsymbol);
    out.push({
      segment: "MF",
      symbol: str(r.fund) || isin,
      isin: isin.startsWith("IN") ? isin : null,
      exchange: null,
      product: null,
      side,
      quantity,
      price,
      tradeDate: date,
      tradeTime: null,
      orderId,
      // Zerodha's mutual fund tradebook uses the order number as the trade number.
      tradeId: orderId,
    });
  }
  return out;
}

export function mapAngelTrades(rows: Row[], today: string): ParsedTrade[] {
  const out: ParsedTrade[] = [];
  for (const r of rows) {
    const side = sideOf(r.transactiontype);
    const quantity = num(r.fillsize);
    const price = num(r.fillprice);
    const symbol = str(r.tradingsymbol);
    const tradeId = str(r.fillid);
    if (!side || quantity <= 0 || price <= 0 || !symbol || !tradeId) continue;
    const product = str(r.producttype).toUpperCase();
    const exchange = str(r.exchange);
    out.push({
      segment: exchange === "NFO" || exchange === "BFO" || exchange === "CDS" || exchange === "MCX" ? "FO" : "EQ",
      symbol,
      isin: null,
      exchange: exchange || null,
      product: product === "INTRADAY" ? "MIS" : "CNC",
      side,
      quantity,
      price,
      tradeDate: today,
      tradeTime: str(r.filltime) || null,
      orderId: str(r.orderid) || null,
      tradeId,
    });
  }
  return out;
}

/** ZebPay's time: a number of milliseconds, or an ISO date. */
function zebDate(v: unknown): { date: string | null; time: string | null } {
  const n = typeof v === "number" ? v : /^\d{12,}$/.test(str(v)) ? Number(v) : NaN;
  const d = Number.isFinite(n) ? new Date(n) : new Date(str(v));
  if (Number.isNaN(d.getTime())) return { date: null, time: null };
  const pad = (x: number) => String(x).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}

/** Each fill if ZebPay sent them; otherwise the order as one trade at its average price. INR pairs only. */
export function mapZebpayOrders(items: { order: Row; fills: Row[] | null }[]): ParsedTrade[] {
  const out: ParsedTrade[] = [];
  for (const { order, fills } of items) {
    const pair = str(order.symbol);
    const [coin, quote] = pair.split(/[-/]/);
    const side = sideOf(order.side);
    const orderId = str(order.orderId ?? order.id);
    if (!coin || quote !== "INR" || !side || !orderId) continue;
    const base = { segment: "CRYPTO" as const, symbol: coin, isin: null, exchange: "ZEBPAY", product: null, side, orderId };
    let added = 0;
    (fills ?? []).forEach((f, i) => {
      const quantity = num(f.amount ?? f.quantity ?? f.size ?? f.filled);
      const price = num(f.price);
      const { date, time } = zebDate(f.timestamp ?? f.createdAt ?? f.time ?? order.timestamp);
      if (quantity <= 0 || price <= 0 || !date) return;
      added++;
      out.push({ ...base, quantity, price, tradeDate: date, tradeTime: time, tradeId: str(f.tradeId ?? f.id ?? f.fillId) || `${orderId}-${i}` });
    });
    if (added > 0) continue;
    const quantity = num(order.filled);
    const price = num(order.average ?? order.avgPrice ?? order.price);
    const { date, time } = zebDate(order.timestamp ?? order.createdAt);
    if (quantity > 0 && price > 0 && date) out.push({ ...base, quantity, price, tradeDate: date, tradeTime: time, tradeId: orderId });
  }
  return out;
}

/** Holdings as instrument -> quantity, including what's still settling. */
export function holdingsMap(rows: Row[], symbolField: string, settlingField: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const key = str(r[symbolField]);
    if (key) out[key] = (out[key] ?? 0) + num(r.quantity) + num(r[settlingField]);
  }
  return out;
}
