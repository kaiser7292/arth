/** Where a record came from. Zerodha is "kite" and Groww has no API connection, only its files. */
export type HistoryBroker = "kite" | "angel" | "zebpay" | "groww" | "other";
export type ApiBroker = "kite" | "angel" | "zebpay";

export const HISTORY_BROKER_NAMES: Record<HistoryBroker, string> = {
  kite: "Zerodha",
  angel: "Angel One",
  zebpay: "Zebpay",
  groww: "Groww",
  other: "Other broker",
};

/**
 * intraday, fno, currency and commodity are business income rather than capital gains, and buyback
 * has its own tax treatment: those are shown, but not put into the capital gains calculation.
 */
export type GainCategory = "short_term" | "long_term" | "intraday" | "fno" | "currency" | "commodity" | "buyback" | "crypto";
export type AssetClass = "equity" | "debt" | "gold" | "crypto";

export interface ParsedGain {
  symbol: string;
  isin: string | null;
  quantity: number;
  buyDate: string | null;
  sellDate: string;
  buyValue: number;
  sellValue: number;
  /** The broker's own taxable figure. Whether it's before or after charges differs: see gainsBasis. */
  taxable: number;
  charges: number;
  stt: number;
  category: GainCategory;
  assetClass: AssetClass;
  /** Why this row needs the user's eye: a ₹0 cost, or a class Arth can't be sure of. */
  checkReason: string | null;
}

export interface ParsedTrade {
  segment: "EQ" | "MF" | "FO" | "CRYPTO";
  symbol: string;
  isin: string | null;
  exchange: string | null;
  product: string | null;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  tradeDate: string;
  tradeTime: string | null;
  orderId: string | null;
  tradeId: string | null;
}

export interface ParsedMoneyMove {
  date: string;
  direction: "in" | "out";
  amount: number;
  reference: string | null;
  narration: string | null;
}

export type ReportKind = "gains" | "tradebook" | "ledger";

export interface ParsedReport {
  broker: HistoryBroker;
  kind: ReportKind;
  /** What the preview calls this file: "Zerodha Tax P&L". */
  label: string;
  periodFrom: string;
  periodTo: string;
  gains: ParsedGain[];
  trades: ParsedTrade[];
  moves: ParsedMoneyMove[];
  chargesTotal: number | null;
  /** How this broker's taxable figure treats charges, in plain words. */
  gainsBasis: string | null;
  warnings: string[];
}

/** A recognised file there's nothing to import from, or one that isn't a broker report at all. */
export type ParseOutcome =
  | { status: "ok"; report: ParsedReport }
  | { status: "not_needed"; message: string }
  | { status: "unknown" };

/** One sheet's rows, as read from the file. Blank rows are already gone. */
export type SheetRows = unknown[][];
export type Workbook = Record<string, SheetRows>;
