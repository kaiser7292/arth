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
