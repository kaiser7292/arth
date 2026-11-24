/**
 * Consolidated formatting utilities.
 * Replaces duplicate formatAmount() implementations across the codebase.
 *
 * As of v15.9.0: formatAmount / formatNumber read user preferences from
 * services/locale-preferences (currency, grouping). formatCompact still
 * returns the lakh/thousand compact form \u2014 it's only used for labels &
 * sublabels, not primary values.
 */

import { getCurrency, getNumberGrouping, getReportAmountStyle, getShortAmountStyle, type ShortAmountStyle } from "@/services/locale-preferences";
import { isAmountsHidden } from "@/services/privacy-mode";
import { getCurrencyDef, type CurrencyCode, type NumberGrouping } from "@/constants/currencies";

/** Fixed-width placeholder — deliberately doesn't scale with the real value's length, so it can't leak magnitude. */
const AMOUNT_MASK = "••••";

/**
 * Apply a grouping style to a positive numeric string (integer part only).
 * The decimal part (if any) should be appended by the caller after this.
 */
function applyGrouping(intPart: string, grouping: NumberGrouping): string {
  if (grouping === "none") return intPart;
  if (grouping === "western") {
    return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  // Indian: 2-digit secondary, 3-digit primary. e.g. 1,23,45,678.
  if (intPart.length <= 3) return intPart;
  const lastThree = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + lastThree;
}

function formatPositiveAmount(abs: number, decimals: number, grouping: NumberGrouping): string {
  const fixed = abs.toFixed(decimals);
  if (decimals === 0) return applyGrouping(fixed, grouping);
  const [intPart, decPart] = fixed.split(".");
  const grouped = applyGrouping(intPart, grouping);
  // Whole amounts drop the ".00" noise ("1,234"); otherwise show every decimal place, so
  // amounts read as money ("9,148.20", not "9,148.2").
  return /^0+$/.test(decPart) ? grouped : `${grouped}.${decPart}`;
}

/**
 * Format an amount using the user's locale preferences (currency symbol +
 * grouping). Callers pass just the number; pass a currency override only
 * for ad-hoc cases where the user's preference should NOT apply.
 */
export function formatAmount(amount: number, currencyOverride?: CurrencyCode): string {
  const code = currencyOverride ?? getCurrency();
  if (isAmountsHidden()) {
    const def = getCurrencyDef(code);
    return code === "NONE" || !def.symbol ? AMOUNT_MASK : `${def.symbol}${AMOUNT_MASK}`;
  }
  const grouping = getNumberGrouping();
  const def = getCurrencyDef(code);
  const abs = Math.abs(amount);
  const body = formatPositiveAmount(abs, def.decimals, grouping);
  // Suppress the minus sign when the formatted body rounds to zero (e.g. -0,
  // or a tiny floating-point residual like -0.0001 that toFixed(0) renders as "0").
  const isZeroDisplay = !body.replace(/[0,.]/g, "");
  const sign = amount < 0 && !isZeroDisplay ? "-" : "";
  if (code === "NONE" || !def.symbol) return `${sign}${body}`;
  return `${sign}${def.symbol}${body}`;
}

const SHORT_STEPS: Record<ShortAmountStyle, { at: number; suffix: string }[]> = {
  lakh: [
    { at: 1e7, suffix: "Cr" },
    { at: 1e5, suffix: "L" },
    { at: 1e3, suffix: "K" },
  ],
  million: [
    { at: 1e9, suffix: "B" },
    { at: 1e6, suffix: "M" },
    { at: 1e3, suffix: "K" },
  ],
};

/** The short body of an amount, without a symbol: "14.9K", "2.3L", "1.2Cr" or "1.2M". */
export function shortAmountBody(abs: number, style: ShortAmountStyle): string {
  for (const step of SHORT_STEPS[style]) {
    if (abs >= step.at) return (abs / step.at).toFixed(1) + step.suffix;
  }
  return String(Math.round(abs));
}

/**
 * Compact format for sublabels/messaging (Rule: never for primary amounts). Lakh and crore or
 * million and billion, as chosen in Settings → Region ("Short amounts"). No currency symbol.
 */
export function formatCompact(n: number): string {
  if (isAmountsHidden()) return AMOUNT_MASK;
  const body = shortAmountBody(Math.abs(n), getShortAmountStyle());
  const sign = n < 0 && /[1-9]/.test(body) ? "-" : "";
  return `${sign}${body}`;
}

/** A short amount with the currency symbol: "₹14.9K". For dense places like month headings. */
export function formatShortAmount(n: number): string {
  const code = getCurrency();
  const def = getCurrencyDef(code);
  if (isAmountsHidden()) return code === "NONE" || !def.symbol ? AMOUNT_MASK : `${def.symbol}${AMOUNT_MASK}`;
  const body = shortAmountBody(Math.abs(n), getShortAmountStyle());
  const sign = n < 0 && /[1-9]/.test(body) ? "-" : "";
  return code === "NONE" || !def.symbol ? `${sign}${body}` : `${sign}${def.symbol}${body}`;
}

/**
 * A report figure, short to two places: "₹24.92L", "₹1.26Cr", "₹65.43K" ("₹3L", not "₹3.00L").
 * Under a thousand it is whole rupees. Report screens print it only when the user picked short
 * report numbers (Settings → Region); see components/ui/ReportAmount.
 */
export function formatReportShort(n: number): string {
  const code = getCurrency();
  const def = getCurrencyDef(code);
  const symbol = code === "NONE" || !def.symbol ? "" : def.symbol;
  if (isAmountsHidden()) return symbol + AMOUNT_MASK;
  const abs = Math.abs(n);
  let body = String(Math.round(abs));
  for (const step of SHORT_STEPS[getShortAmountStyle()]) {
    if (abs >= step.at) {
      body = (abs / step.at).toFixed(2).replace(/.?0+$/, "") + step.suffix;
      break;
    }
  }
  const sign = n < 0 && /[1-9]/.test(body) ? "-" : "";
  return sign + symbol + body;
}

/** A report figure as the user chose to see them: in full, or short (formatReportShort). */
export function formatReportAmount(n: number): string {
  return getReportAmountStyle() === "short" ? formatReportShort(n) : formatAmount(n);
}

/**
 * Format number with user's grouping preference, no currency symbol. Used
 * by exports (PDF/Excel hisaab statements) where the column header already
 * implies currency.
 */
export function formatNumber(amount: number): string {
  if (isAmountsHidden()) return AMOUNT_MASK;
  const grouping = getNumberGrouping();
  const abs = Math.abs(amount);
  const decimals = abs % 1 !== 0 ? 2 : 0;
  const body = formatPositiveAmount(abs, decimals, grouping);
  const isZeroDisplay = !body.replace(/[0,.]/g, "");
  const sign = amount < 0 && !isZeroDisplay ? "-" : "";
  return `${sign}${body}`;
}

/**
 * Preview formatter \u2014 used by the Settings/Region picker to render a live
 * sample in a chosen currency + grouping, independent of what the user has
 * actually saved. Doesn't read MMKV.
 */
export function formatAmountPreview(
  amount: number,
  currency: CurrencyCode,
  grouping: NumberGrouping,
): string {
  const def = getCurrencyDef(currency);
  const body = formatPositiveAmount(Math.abs(amount), def.decimals, grouping);
  const isZeroDisplay = !body.replace(/[0,.]/g, "");
  const sign = amount < 0 && !isZeroDisplay ? "-" : "";
  if (currency === "NONE" || !def.symbol) return `${sign}${body}`;
  return `${sign}${def.symbol}${body}`;
}

/**
 * Strip internal direction markers (e.g. "[Balance Adjustment +]") from a
 * description and return a user-friendly label. If no reason was given,
 * returns a bare "Adjustment" rather than the internal default.
 */
export function formatAdjustmentDescription(raw: string | null | undefined): string {
  if (!raw) return "Adjustment";
  // Markers: [Balance Adjustment +] / [Balance Adjustment -] / [Opening Adjustment +/-]
  const markerMatch = raw.match(/^\[(Balance|Opening) Adjustment\s*([+-])\]\s*(.*)$/);
  if (!markerMatch) return raw;
  const rest = markerMatch[3].trim();
  // Filter out legacy defaults so they render as the generic label
  if (!rest || rest.toLowerCase() === "balance adjustment") return "Adjustment";
  return rest;
}
