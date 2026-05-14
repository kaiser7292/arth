/**
 * Supported display currencies (v15.9.0).
 *
 * Cosmetic only — Artha does not convert between currencies or track
 * per-transaction currency. Switching here just swaps the symbol and the
 * default number-grouping. Historical amounts are rendered using whatever
 * currency the user has currently selected.
 *
 * True multi-currency (per-transaction currency column, FX conversion) is
 * deferred to v16.0.0 per CLAUDE.md.
 */

export type CurrencyCode =
  /** Render amounts as plain numbers, no currency symbol. */
  | "NONE"
  // South Asia
  | "INR" | "PKR" | "BDT" | "LKR" | "NPR"
  // North America
  | "USD" | "CAD" | "MXN"
  // Europe
  | "EUR" | "GBP" | "CHF" | "SEK" | "NOK" | "DKK" | "PLN"
  // Middle East
  | "AED" | "SAR" | "QAR"
  // East / Southeast Asia
  | "JPY" | "CNY" | "SGD" | "HKD" | "KRW" | "MYR" | "THB" | "IDR" | "PHP" | "VND"
  // Oceania
  | "AUD" | "NZD";

export interface CurrencyDef {
  code: CurrencyCode;
  /** Visible glyph — shown before the amount. */
  symbol: string;
  /** How many decimal places to render by default. Most are 2; JPY/KRW/VND/IDR are 0. */
  decimals: number;
  /** Default grouping when the user hasn't overridden it. */
  defaultGrouping: NumberGrouping;
  /** Full name for picker rows. */
  displayName: string;
}

/** Internal keys for grouping style. User-facing labels are "Indian" / "Western" / "None". */
export type NumberGrouping = "indian" | "western" | "none";

export const CURRENCIES: readonly CurrencyDef[] = [
  // None — plain numbers, no symbol.
  { code: "NONE", symbol: "",              decimals: 2, defaultGrouping: "indian",  displayName: "None (no symbol)" },
  // South Asia
  { code: "INR", symbol: "₹",      decimals: 2, defaultGrouping: "indian",  displayName: "Indian Rupee" },
  { code: "PKR", symbol: "₨",      decimals: 2, defaultGrouping: "indian",  displayName: "Pakistani Rupee" },
  { code: "BDT", symbol: "৳",      decimals: 2, defaultGrouping: "indian",  displayName: "Bangladeshi Taka" },
  { code: "LKR", symbol: "රු",     decimals: 2, defaultGrouping: "indian",  displayName: "Sri Lankan Rupee" },
  { code: "NPR", symbol: "रू",     decimals: 2, defaultGrouping: "indian",  displayName: "Nepalese Rupee" },
  // North America
  { code: "USD", symbol: "$",            decimals: 2, defaultGrouping: "western", displayName: "US Dollar" },
  { code: "CAD", symbol: "C$",           decimals: 2, defaultGrouping: "western", displayName: "Canadian Dollar" },
  { code: "MXN", symbol: "Mex$",         decimals: 2, defaultGrouping: "western", displayName: "Mexican Peso" },
  // Europe
  { code: "EUR", symbol: "€",      decimals: 2, defaultGrouping: "western", displayName: "Euro" },
  { code: "GBP", symbol: "£",      decimals: 2, defaultGrouping: "western", displayName: "British Pound" },
  { code: "CHF", symbol: "CHF",          decimals: 2, defaultGrouping: "western", displayName: "Swiss Franc" },
  { code: "SEK", symbol: "kr",           decimals: 2, defaultGrouping: "western", displayName: "Swedish Krona" },
  { code: "NOK", symbol: "kr",           decimals: 2, defaultGrouping: "western", displayName: "Norwegian Krone" },
  { code: "DKK", symbol: "kr",           decimals: 2, defaultGrouping: "western", displayName: "Danish Krone" },
  { code: "PLN", symbol: "zł",     decimals: 2, defaultGrouping: "western", displayName: "Polish Złoty" },
  // Middle East
  { code: "AED", symbol: "د.إ", decimals: 2, defaultGrouping: "western", displayName: "UAE Dirham" },
  { code: "SAR", symbol: "﷼",     decimals: 2, defaultGrouping: "western", displayName: "Saudi Riyal" },
  { code: "QAR", symbol: "﷼",     decimals: 2, defaultGrouping: "western", displayName: "Qatari Riyal" },
  // East / Southeast Asia
  { code: "JPY", symbol: "¥",      decimals: 0, defaultGrouping: "western", displayName: "Japanese Yen" },
  { code: "CNY", symbol: "¥",      decimals: 2, defaultGrouping: "western", displayName: "Chinese Yuan" },
  { code: "SGD", symbol: "S$",           decimals: 2, defaultGrouping: "western", displayName: "Singapore Dollar" },
  { code: "HKD", symbol: "HK$",          decimals: 2, defaultGrouping: "western", displayName: "Hong Kong Dollar" },
  { code: "KRW", symbol: "₩",      decimals: 0, defaultGrouping: "western", displayName: "South Korean Won" },
  { code: "MYR", symbol: "RM",           decimals: 2, defaultGrouping: "western", displayName: "Malaysian Ringgit" },
  { code: "THB", symbol: "฿",      decimals: 2, defaultGrouping: "western", displayName: "Thai Baht" },
  { code: "IDR", symbol: "Rp",           decimals: 0, defaultGrouping: "western", displayName: "Indonesian Rupiah" },
  { code: "PHP", symbol: "₱",      decimals: 2, defaultGrouping: "western", displayName: "Philippine Peso" },
  { code: "VND", symbol: "₫",      decimals: 0, defaultGrouping: "western", displayName: "Vietnamese Dong" },
  // Oceania
  { code: "AUD", symbol: "A$",           decimals: 2, defaultGrouping: "western", displayName: "Australian Dollar" },
  { code: "NZD", symbol: "NZ$",          decimals: 2, defaultGrouping: "western", displayName: "New Zealand Dollar" },
] as const;

const CURRENCY_BY_CODE: Readonly<Record<CurrencyCode, CurrencyDef>> = CURRENCIES.reduce(
  (acc, c) => ({ ...acc, [c.code]: c }),
  {} as Record<CurrencyCode, CurrencyDef>,
);

export function getCurrencyDef(code: CurrencyCode): CurrencyDef {
  return CURRENCY_BY_CODE[code] ?? CURRENCY_BY_CODE.INR;
}

export const DEFAULT_CURRENCY: CurrencyCode = "INR";

/** Pattern-first date format tokens. Strings are user-facing samples. */
export type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "DD-MMM-YYYY";

export const DATE_FORMATS: readonly DateFormat[] = [
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "YYYY-MM-DD",
  "DD-MMM-YYYY",
] as const;

export const DEFAULT_DATE_FORMAT: DateFormat = "DD/MM/YYYY";

export const DEFAULT_NUMBER_GROUPING: NumberGrouping = "indian";

/** User-facing labels for the grouping picker. */
export const NUMBER_GROUPING_LABELS: Record<NumberGrouping, string> = {
  indian: "Indian",
  western: "Western",
  none: "None (no separators)",
};
