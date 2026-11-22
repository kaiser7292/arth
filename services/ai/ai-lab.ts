import { getDatabase } from "@/database";
import { settingsStorage } from "@/services/storage";

/**
 * The On-device AI lab is hidden like Android's developer options: tap Version in Settings 7
 * times to show it, and "Hide this screen" in the lab hides it again. Device-only.
 */
const UNLOCKED_KEY = "ai_lab_unlocked";
export const TAPS_TO_UNLOCK = 7;

export function isAiLabUnlocked(): boolean {
  return settingsStorage.getBoolean(UNLOCKED_KEY) === true;
}

export function setAiLabUnlocked(on: boolean): void {
  if (on) settingsStorage.set(UNLOCKED_KEY, true);
  else settingsStorage.delete(UNLOCKED_KEY);
}

export interface LabMessage {
  id: string;
  address: string;
  body: string;
  sms_date: number;
}

/**
 * Messages Arth couldn't read (no pattern, no template, no transaction made) between two times,
 * newest first. Same rows as Settings → Unrecognised messages, but any date range, not just the
 * look-back window.
 */
const WHERE = `status IN ('pending', 'failed') AND expense_id IS NULL AND sms_date >= ? AND sms_date <= ?`;

export async function listLabMessages(sinceMs: number, untilMs: number, limit: number): Promise<LabMessage[]> {
  return getDatabase().getAllAsync<LabMessage>(
    `SELECT id, address, body, sms_date FROM pending_sms WHERE ${WHERE} ORDER BY sms_date DESC LIMIT ?;`,
    sinceMs,
    untilMs,
    limit,
  );
}

export async function countLabMessages(sinceMs: number, untilMs: number): Promise<number> {
  const row = await getDatabase().getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM pending_sms WHERE ${WHERE};`,
    sinceMs,
    untilMs,
  );
  return row?.n ?? 0;
}
