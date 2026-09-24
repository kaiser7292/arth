import type { BalanceSourceInfo } from "@/services/balance-source";
import { getBalanceSourceInfo } from "@/services/balance-source";
import type { FinancialAccount } from "@/services/financial-account";
import { getActiveAccounts } from "@/services/financial-account";
import { settingsStorage } from "@/services/storage";

/**
 * Month-end check: one card per bank / card / wallet account comparing Arth's balance with
 * the last balance your bank sent by SMS. Swipe "Looks right", or open the ledger to fix it.
 *
 * The check covers the month being closed: from the 28th it's this month, through the 7th it's
 * last month. Outside that window Home doesn't advertise it (the screen still works).
 *
 * Confirmations are device-local (MMKV) — per cycle month, so each month starts fresh.
 */

const CONFIRMED_PREFIX = "month_end_confirmed__";
const CHECKED_TYPES: FinancialAccount["account_type"][] = ["savings", "credit_card", "wallet"];
/** Differences under a rupee are rounding. */
const MATCH_TOLERANCE = 1;

export type MonthEndStatus = "match" | "differs" | "stale" | "no_sms";

export interface MonthEndItem {
  account: FinancialAccount;
  arthBalance: number | null;
  bankBalance: number | null;
  bankDate: string | null;
  status: MonthEndStatus;
  difference: number;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "YYYY-MM" the check is closing, for a given day. */
export function getCycleMonth(now: Date = new Date()): string {
  const d = new Date(now);
  if (d.getDate() <= 7) d.setMonth(d.getMonth() - 1, 1);
  return ymd(d).slice(0, 7);
}

/** True in the last days of a month and the first week of the next. */
export function isMonthEndWindow(now: Date = new Date()): boolean {
  return now.getDate() >= 28 || now.getDate() <= 7;
}

function loadConfirmed(cycle: string): Set<string> {
  try {
    const raw = settingsStorage.getString(CONFIRMED_PREFIX + cycle);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function confirmMonthEnd(accountId: string, cycle: string = getCycleMonth()): void {
  const set = loadConfirmed(cycle);
  set.add(accountId);
  settingsStorage.set(CONFIRMED_PREFIX + cycle, JSON.stringify([...set]));
}

export function unconfirmMonthEnd(accountId: string, cycle: string = getCycleMonth()): void {
  const set = loadConfirmed(cycle);
  set.delete(accountId);
  settingsStorage.set(CONFIRMED_PREFIX + cycle, JSON.stringify([...set]));
}

/** Pure: compare Arth's figure with the bank's. */
export function classifyBalance(info: Pick<BalanceSourceInfo, "calculatedBalance" | "autoDetectedBalance" | "isStale">): {
  status: MonthEndStatus;
  difference: number;
} {
  const { calculatedBalance: arth, autoDetectedBalance: bank } = info;
  if (bank == null || arth == null) return { status: "no_sms", difference: 0 };
  const difference = Math.round((arth - bank) * 100) / 100;
  if (info.isStale) return { status: "stale", difference };
  return { status: Math.abs(difference) < MATCH_TOLERANCE ? "match" : "differs", difference };
}

const STATUS_ORDER: Record<MonthEndStatus, number> = { differs: 0, stale: 1, no_sms: 2, match: 3 };

async function eligibleAccounts(userId: string, cycle: string): Promise<FinancialAccount[]> {
  const confirmed = loadConfirmed(cycle);
  const accounts = await getActiveAccounts(userId);
  return accounts.filter((a) => CHECKED_TYPES.includes(a.account_type) && !confirmed.has(a.id));
}

export async function getMonthEndItems(userId: string, cycle: string = getCycleMonth()): Promise<MonthEndItem[]> {
  const accounts = await eligibleAccounts(userId, cycle);
  const items: MonthEndItem[] = [];
  for (const account of accounts) {
    let info: BalanceSourceInfo | null = null;
    try {
      info = await getBalanceSourceInfo(account.id);
    } catch {
      // One account's ledger failing shouldn't hide the rest.
    }
    const { status, difference } = info ? classifyBalance(info) : { status: "no_sms" as const, difference: 0 };
    items.push({
      account,
      arthBalance: info?.calculatedBalance ?? null,
      bankBalance: info?.autoDetectedBalance ?? null,
      bankDate: info?.autoDetectedDate ?? null,
      status,
      difference,
    });
  }
  // Mismatches first — they're the ones worth your attention.
  return items.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

/** Cheap count for Home: accounts not yet confirmed this cycle (no balance lookups). */
export async function getMonthEndPendingCount(userId: string): Promise<number> {
  return (await eligibleAccounts(userId, getCycleMonth())).length;
}
