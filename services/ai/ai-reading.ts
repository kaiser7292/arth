/**
 * The on-device AI switch: whether Gemini Nano reads the messages Arth's patterns and templates
 * can't (and helps during onboarding).
 *
 * Three things have to be true: the `ai_nano` build flag, the person's own switch (Settings →
 * On-device AI, on unless they turned it off), and a build that has the native module (Android).
 * Whether this phone can actually run the model is a separate, slower question (getNanoStatus):
 * phones without Gemini Nano simply never get an answer, and their queued messages stay as
 * "Unrecognised", exactly as before.
 */

import { Platform } from "react-native";
import { getFlag } from "@/services/feature-flags";
import { bumpDataVersion } from "@/services/settings";
import { settingsStorage } from "@/services/storage";
import { isNanoModulePresent } from "../../modules/arth-nano";

const ENABLED_KEY = "ai_nano_enabled";

/** The build can do on-device AI at all (flag on, Android, module present). */
export function aiReadingBuilt(): boolean {
  return getFlag("ai_nano") && Platform.OS === "android" && isNanoModulePresent;
}

/** The person's switch. On until they turn it off. */
export function isAiReadingSwitchOn(): boolean {
  return settingsStorage.getBoolean(ENABLED_KEY) !== false;
}

export function setAiReadingSwitch(on: boolean): void {
  settingsStorage.set(ENABLED_KEY, on);
  bumpDataVersion();
}

/** Built and switched on: new unrecognised messages are queued for the AI. */
export function isAiReadingOn(): boolean {
  return aiReadingBuilt() && isAiReadingSwitchOn();
}
