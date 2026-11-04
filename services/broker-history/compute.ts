import type { AssetClass, GainCategory } from "./types";
import { classifyInstrument } from "./parse";

/**
 * Gains worked out from trades, for periods no broker report covers yet. Pure.
 *
 * Sales are matched first in, first out for each instrument. Shares bought and sold the same day are
 * netted first: that's intraday, and must not touch older lots (the known trap in tradebook importers,
 * where an intraday sale gets booked against shares bought years ago).
 */

export interface TradeRow {
  segment: string;
  symbol: string;
  isin: string | null;
  side: string;
  quantity: number;
  price: number;
  trade_date: string;
  trade_time: string | null;
}

export interface CalculatedSale {
  symbol: string;
  isin: string | null;
  quantity: number;
  buyDate: string | null;
  sellDate: string;
  buyValue: number;
  sellValue: number;
  taxable: number;
  category: GainCategory;
  assetClass: AssetClass;
}

export interface CalculatedGains {
  sales: CalculatedSale[];
  /** Sales with no buy on record (held since before Arth's records begin), which can't be worked out. */
  unmatched: { symbol: string; quantity: number; date: string }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 1e-9;

export function calculateGains(trades: TradeRow[], crypto = false): CalculatedGains {
  const byInstrument = new Map<string, TradeRow[]>();
  for (const t of trades) {
    // Mutual funds aren't calculated here: they're a separate line, and redemptions are rare enough
    // that a report should state them.
    if (t.segment === "MF" || t.segment === "FO") continue;
    const key = t.isin || t.symbol;
    byInstrument.set(key, [...(byInstrument.get(key) ?? []), t]);
  }
  const sales: CalculatedSale[] = [];
  const unmatched: CalculatedGains["unmatched"] = [];

  for (const rows of byInstrument.values()) {
    const name = rows[0].symbol;
    const isin = rows[0].isin;
    const assetClass: AssetClass = crypto ? "crypto" : classifyInstrument(name, isin).assetClass;
    const lots: { date: string; quantity: number; price: number }[] = [];
    const dates = [...new Set(rows.map((r) => r.trade_date))].sort();

    for (const date of dates) {
      const day = rows.filter((r) => r.trade_date === date);
      const dayBuys = day.filter((r) => r.side === "buy");
      const daySells = day.filter((r) => r.side === "sell");
      const value = (list: TradeRow[]) => list.reduce((s, r) => s + r.quantity * r.price, 0);
      const quantity = (list: TradeRow[]) => list.reduce((s, r) => s + r.quantity, 0);
      const boughtQty = quantity(dayBuys);
      const soldQty = quantity(daySells);
      const avgBuy = boughtQty > 0 ? value(dayBuys) / boughtQty : 0;
      const avgSell = soldQty > 0 ? value(daySells) / soldQty : 0;

      // Crypto has no intraday: every sale is a transfer of a virtual digital asset, so bought-first order holds.
      const netted = crypto ? 0 : Math.min(boughtQty, soldQty);
      if (netted > EPS) {
        sales.push({
          symbol: name,
          isin,
          quantity: netted,
          buyDate: date,
          sellDate: date,
          buyValue: round2(netted * avgBuy),
          sellValue: round2(netted * avgSell),
          taxable: round2(netted * (avgSell - avgBuy)),
          category: "intraday",
          assetClass,
        });
      }

      if (boughtQty - netted > EPS) lots.push({ date, quantity: boughtQty - netted, price: avgBuy });

      let left = soldQty - netted;
      while (left > EPS && lots.length > 0) {
        const lot = lots[0];
        const take = Math.min(lot.quantity, left);
        const held = Math.round((Date.parse(date) - Date.parse(lot.date)) / 86400000);
        sales.push({
          symbol: name,
          isin,
          quantity: take,
          buyDate: lot.date,
          sellDate: date,
          buyValue: round2(take * lot.price),
          sellValue: round2(take * avgSell),
          taxable: round2(take * (avgSell - lot.price)),
          category: crypto ? "crypto" : held > 365 ? "long_term" : "short_term",
          assetClass,
        });
        lot.quantity -= take;
        left -= take;
        if (lot.quantity <= EPS) lots.shift();
      }
      if (left > EPS) unmatched.push({ symbol: name, quantity: left, date });
    }
  }
  return { sales, unmatched };
}

/** Weekdays with no save between the first save and today (exchange holidays can't be told apart, hence "may be missing"). */
export function missingWeekdays(saved: string[], today: string): string[] {
  if (saved.length === 0) return [];
  const have = new Set(saved);
  const out: string[] = [];
  const first = [...saved].sort()[0];
  const cursor = new Date(`${first}T00:00:00Z`);
  const end = new Date(`${today}T00:00:00Z`);
  for (cursor.setUTCDate(cursor.getUTCDate() + 1); cursor < end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.getUTCDay();
    const iso = cursor.toISOString().slice(0, 10);
    if (day !== 0 && day !== 6 && !have.has(iso)) out.push(iso);
  }
  return out;
}

/**
 * Instruments whose holdings don't add up between two saves: holdings then, plus the trades saved
 * since, should equal holdings now. A gap means a missed trade, a bonus or split, or a transfer.
 */
export function holdingDifferences(
  before: Record<string, number>,
  after: Record<string, number>,
  tradesBetween: { key: string; side: string; quantity: number }[],
): string[] {
  const expected: Record<string, number> = { ...before };
  for (const t of tradesBetween) expected[t.key] = (expected[t.key] ?? 0) + (t.side === "buy" ? t.quantity : -t.quantity);
  const keys = new Set([...Object.keys(expected), ...Object.keys(after)]);
  return [...keys].filter((k) => Math.abs((expected[k] ?? 0) - (after[k] ?? 0)) > 1e-6);
}

export interface SaleForTax {
  taxable: number;
  sellValue: number;
  category: GainCategory;
  assetClass: AssetClass;
}

export interface GainsTaxInput {
  equity_stcg: number;
  equity_ltcg: number;
  debt: number;
  gold: number;
  crypto: number;
  /** Crypto exchanges deduct 1% TDS on sale. */
  cryptoTds: number;
}

/**
 * Sales into the capital gains calculation. Losses set off the way the tax rules allow: a short-term
 * loss against any gain, a long-term loss only against long-term, crypto not at all. Intraday, F&O and
 * buybacks aren't capital gains, so they stay out.
 */
export function salesToTaxInput(sales: SaleForTax[]): GainsTaxInput {
  let eqShort = 0;
  let eqLong = 0;
  let debt = 0;
  let gold = 0;
  let crypto = 0;
  let cryptoProceeds = 0;
  for (const s of sales) {
    if (s.category === "crypto" || s.assetClass === "crypto") {
      crypto += Math.max(s.taxable, 0);
      cryptoProceeds += s.sellValue;
    } else if (s.category !== "short_term" && s.category !== "long_term") {
      continue;
    } else if (s.assetClass === "gold") {
      if (s.category === "long_term") gold += s.taxable;
      else debt += s.taxable;
    } else if (s.assetClass === "debt") {
      debt += s.taxable;
    } else if (s.category === "long_term") {
      eqLong += s.taxable;
    } else {
      eqShort += s.taxable;
    }
  }
  if (eqLong < 0) eqLong = 0;
  if (eqShort < 0) {
    eqLong = Math.max(eqLong + eqShort, 0);
    eqShort = 0;
  }
  return {
    equity_stcg: round2(eqShort),
    equity_ltcg: round2(eqLong),
    debt: round2(Math.max(debt, 0)),
    gold: round2(Math.max(gold, 0)),
    crypto: round2(crypto),
    cryptoTds: round2(cryptoProceeds * 0.01),
  };
}

/** April-March year of a date, as its starting year. */
export function fyOf(date: string): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return m >= 4 ? y : y - 1;
}

/** Quarter of the financial year: 1 is April-June. */
export function quarterOf(date: string): 1 | 2 | 3 | 4 {
  const m = Number(date.slice(5, 7));
  return m <= 3 ? 4 : m <= 6 ? 1 : m <= 9 ? 2 : 3;
}
