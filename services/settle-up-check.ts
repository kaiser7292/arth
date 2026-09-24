import type { HisaabPersonWithBalance } from "@/services/hisaab";
import { getPersonsWithBalances, recordSettlement } from "@/services/hisaab";
import { settingsStorage } from "@/services/storage";
import { formatAmount } from "@/utils/format";

/**
 * Hisaab settle-up: one card per person who owes you, with Remind (share sheet — WhatsApp or
 * anything else) or Mark settled.
 *
 * "Last reminded" is device-local (MMKV). It only affects the Home count — people reminded in
 * the last REMIND_QUIET_DAYS don't nag you again — the deck itself always lists everyone owing.
 */

export const REMIND_QUIET_DAYS = 7;
/** Below a rupee is rounding noise, not money owed. */
const MIN_BALANCE = 1;
const REMINDED_PREFIX = "hisaab_reminded__";

export function getLastReminded(personId: string): number | null {
  return settingsStorage.getNumber(REMINDED_PREFIX + personId) ?? null;
}

export function markReminded(personId: string): void {
  settingsStorage.set(REMINDED_PREFIX + personId, Date.now());
}

export async function getPeopleWhoOweYou(userId: string): Promise<HisaabPersonWithBalance[]> {
  const people = await getPersonsWithBalances(userId);
  return people.filter((p) => p.balance >= MIN_BALANCE).sort((a, b) => b.balance - a.balance);
}

/** People owing you who haven't been reminded recently — the Home count. */
export function needsNudge(personId: string, now: number): boolean {
  const last = getLastReminded(personId);
  return last == null || now - last > REMIND_QUIET_DAYS * 86400000;
}

export function reminderMessage(name: string, balance: number, lastEntryDate: string | null): string {
  const firstName = name.trim().split(/\s+/)[0] || name;
  const since = lastEntryDate ? ` (last entry ${lastEntryDate})` : "";
  return `Hi ${firstName}, a quick reminder about ${formatAmount(balance)} pending on our hisaab${since}. Thanks!`;
}

/** Full settlement of the current balance, not linked to any account. */
export async function markSettled(person: HisaabPersonWithBalance): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  await recordSettlement(person.id, Math.round(person.balance * 100) / 100, today, "Settled up");
}
