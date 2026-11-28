/**
 * Locale preferences — cosmetic only (v15.9.0).
 *
 * Three user-configurable display settings, all MMKV-backed and part of
 * backup:
 *   - currency: swaps the symbol prefixed to every amount
 *   - numberGrouping: swaps grouping (1,23,456 vs 123,456)
 *   - dateFormat: swaps date rendering pattern
 *
 * Reads are cached per-process to avoid an MMKV round-trip on every
 * formatAmount/formatDate call. Writes invalidate the cache.
 */

import {
    CURRENCIES,
    DEFAULT_CURRENCY,
    DEFAULT_DATE_FORMAT,
    DEFAULT_NUMBER_GROUPING,
    getCurrencyDef,
    type CurrencyCode,
    type DateFormat,
    type NumberGrouping,
} from "@/constants/currencies";
import { settingsStorage } from "./storage";

const KEYS = {
  CURRENCY: "locale_currency",
  NUMBER_GROUPING: "locale_number_grouping",
  DATE_FORMAT: "locale_date_format",
  TIMEZONE: "locale_timezone",
  SHORT_AMOUNTS: "locale_short_amounts",
  REPORT_AMOUNTS: "locale_report_amounts",
  DECIMALS: "locale_decimals",
} as const;

export const LOCALE_PREFERENCES_KEYS = [
  KEYS.CURRENCY,
  KEYS.NUMBER_GROUPING,
  KEYS.DATE_FORMAT,
  KEYS.TIMEZONE,
  KEYS.SHORT_AMOUNTS,
  KEYS.REPORT_AMOUNTS,
  KEYS.DECIMALS,
] as const;

/**
 * How short amounts read ("₹14.9K"): lakh and crore (K, L, Cr) or million and billion (K, M, B).
 * Owner, Nov 2026. Until chosen it follows the number format: Indian grouping gives lakh.
 */
export type ShortAmountStyle = "lakh" | "million";

interface LocalePreferences {
  currency: CurrencyCode;
  numberGrouping: NumberGrouping;
  shortAmounts: ShortAmountStyle;
  dateFormat: DateFormat;
  timezone: string;
}

let cache: LocalePreferences | null = null;

function isCurrencyCode(v: string): v is CurrencyCode {
  return CURRENCIES.some((c) => c.code === v);
}

function isNumberGrouping(v: string): v is NumberGrouping {
  return v === "indian" || v === "western" || v === "none";
}

function isDateFormat(v: string): v is DateFormat {
  return v === "DD/MM/YYYY" || v === "MM/DD/YYYY" || v === "YYYY-MM-DD" || v === "DD-MMM-YYYY";
}

function readFromStorage(): LocalePreferences {
  const currencyRaw = settingsStorage.getString(KEYS.CURRENCY);
  const groupingRaw = settingsStorage.getString(KEYS.NUMBER_GROUPING);
  const dateRaw = settingsStorage.getString(KEYS.DATE_FORMAT);
  const timezoneRaw = settingsStorage.getString(KEYS.TIMEZONE);
  const shortRaw = settingsStorage.getString(KEYS.SHORT_AMOUNTS);

  const currency = currencyRaw && isCurrencyCode(currencyRaw) ? currencyRaw : DEFAULT_CURRENCY;
  const numberGrouping = groupingRaw && isNumberGrouping(groupingRaw) ? groupingRaw : getCurrencyDef(currency).defaultGrouping;
  return {
    currency,
    numberGrouping,
    shortAmounts: shortRaw === "lakh" || shortRaw === "million" ? shortRaw : numberGrouping === "indian" ? "lakh" : "million",
    dateFormat: dateRaw && isDateFormat(dateRaw) ? dateRaw : DEFAULT_DATE_FORMAT,
    timezone: timezoneRaw || Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export function getLocalePreferences(): LocalePreferences {
  if (!cache) cache = readFromStorage();
  return cache;
}

export function getCurrency(): CurrencyCode {
  return getLocalePreferences().currency;
}

export function getNumberGrouping(): NumberGrouping {
  return getLocalePreferences().numberGrouping;
}

export function getShortAmountStyle(): ShortAmountStyle {
  return getLocalePreferences().shortAmounts;
}

export function setShortAmountStyle(style: ShortAmountStyle): void {
  settingsStorage.set(KEYS.SHORT_AMOUNTS, style);
  cache = null;
}

/**
 * How the reports (Insights → Reports) print amounts: in full ("₹24,92,209.10") or short
 * ("₹24.92L", tap it for the full figure). Owner, Nov 2026: full until chosen, so nothing changes
 * unless asked. Short exists for the crore-sized numbers a full figure can't fit.
 */
export type ReportAmountStyle = "full" | "short";

export function getReportAmountStyle(): ReportAmountStyle {
  return settingsStorage.getString(KEYS.REPORT_AMOUNTS) === "short" ? "short" : "full";
}

export function setReportAmountStyle(style: ReportAmountStyle): void {
  settingsStorage.set(KEYS.REPORT_AMOUNTS, style);
}

/**
 * Decimals in shown amounts (Settings → Region): "show" keeps them ("₹1,59,017.45"), "round" shows
 * whole amounts ("₹1,59,017"). Display only: nothing stored changes, and the places that must
 * match a bank (ledger balances, Update balances) stay exact via formatExactAmount. Owner, Nov 2026:
 * existing users keep "show" until they choose; new installs start on "round" (startRoundOff).
 */
export type DecimalsStyle = "show" | "round";

export function getDecimalsStyle(): DecimalsStyle {
  return settingsStorage.getString(KEYS.DECIMALS) === "round" ? "round" : "show";
}

export function setDecimalsStyle(style: DecimalsStyle): void {
  settingsStorage.set(KEYS.DECIMALS, style);
}

/** A fresh install starts on whole amounts; anyone who already chose keeps their choice. */
export function startRoundOff(): void {
  if (settingsStorage.getString(KEYS.DECIMALS) == null) settingsStorage.set(KEYS.DECIMALS, "round");
}

export function getDateFormat(): DateFormat {
  return getLocalePreferences().dateFormat;
}

export function getTimezone(): string {
  return getLocalePreferences().timezone;
}

/**
 * Set currency. Also resets number-grouping to the currency's default so
 * a user picking USD doesn't stay on the South-Asian grouping by accident
 * (they can override afterwards if they want).
 */
export function setCurrency(code: CurrencyCode): void {
  settingsStorage.set(KEYS.CURRENCY, code);
  settingsStorage.set(KEYS.NUMBER_GROUPING, getCurrencyDef(code).defaultGrouping);
  cache = null;
}

export function setNumberGrouping(grouping: NumberGrouping): void {
  settingsStorage.set(KEYS.NUMBER_GROUPING, grouping);
  cache = null;
}

export function setDateFormat(format: DateFormat): void {
  settingsStorage.set(KEYS.DATE_FORMAT, format);
  cache = null;
}

export function setTimezone(timezone: string): void {
  settingsStorage.set(KEYS.TIMEZONE, timezone);
  cache = null;
}

/** Used by backup/restore to rehydrate. */
export function resetLocaleCache(): void {
  cache = null;
}

export { DEFAULT_CURRENCY, DEFAULT_DATE_FORMAT, DEFAULT_NUMBER_GROUPING };
