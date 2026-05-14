/**
 * Consolidated formatting utilities.
 * Replaces duplicate formatAmount() implementations across the codebase.
 *
 * As of v15.9.0: formatAmount / formatNumber read user preferences from
 * services/locale-preferences (currency, grouping). formatCompact still
 * returns the lakh/thousand compact form \u2014 it's only used for labels &
 * sublabels, not primary values.
 */

import { getCurrency, getNumberGrouping } from "@/services/locale-preferences";
import { getCurrencyDef, type CurrencyCode, type NumberGrouping } from "@/constants/currencies";

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
  // Trim trailing zeros from decimal to avoid "1,234.00" noise \u2014 keep max 2 sig digits.
  const trimmed = decPart.replace(/0+$/, "");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

/**
 * Format an amount using the user's locale preferences (currency symbol +
 * grouping). Callers pass just the number; pass a currency override only
 * for ad-hoc cases where the user's preference should NOT apply.
 */
export function formatAmount(amount: number, currencyOverride?: CurrencyCode): string {
  const code = currencyOverride ?? getCurrency();
  const grouping = getNumberGrouping();
  const def = getCurrencyDef(code);
  const sign = amount < 0 ? "-" : "";
  const body = formatPositiveAmount(Math.abs(amount), def.decimals, grouping);
  if (code === "NONE" || !def.symbol) return `${sign}${body}`;
  return `${sign}${def.symbol}${body}`;
}

/**
 * Compact format for sublabels/messaging (Rule: never for primary amounts).
 * Uses lakh/thousand abbreviations regardless of user locale \u2014 the compact
 * form is about density, not locale.
 */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 100000) return `${sign}${(abs / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K`;
  return `${sign}${Math.round(abs)}`;
}

/**
 * Format number with user's grouping preference, no currency symbol. Used
 * by exports (PDF/Excel hisaab statements) where the column header already
 * implies currency.
 */
export function formatNumber(amount: number): string {
  const grouping = getNumberGrouping();
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  // Exports typically use 2 decimals when non-integer, else none.
  const decimals = abs % 1 !== 0 ? 2 : 0;
  return `${sign}${formatPositiveAmount(abs, decimals, grouping)}`;
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
  const sign = amount < 0 ? "-" : "";
  const body = formatPositiveAmount(Math.abs(amount), def.decimals, grouping);
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
