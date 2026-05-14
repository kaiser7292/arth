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
} as const;

export const LOCALE_PREFERENCES_KEYS = [
  KEYS.CURRENCY,
  KEYS.NUMBER_GROUPING,
  KEYS.DATE_FORMAT,
  KEYS.TIMEZONE,
] as const;

interface LocalePreferences {
  currency: CurrencyCode;
  numberGrouping: NumberGrouping;
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

  const currency = currencyRaw && isCurrencyCode(currencyRaw) ? currencyRaw : DEFAULT_CURRENCY;
  return {
    currency,
    numberGrouping:
      groupingRaw && isNumberGrouping(groupingRaw)
        ? groupingRaw
        : getCurrencyDef(currency).defaultGrouping,
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
