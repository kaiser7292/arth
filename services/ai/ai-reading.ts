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

/** The build can do on-device AI at all (flag on, Android or iPhone, module present). */
export function aiReadingBuilt(): boolean {
  return getFlag("ai_nano") && (Platform.OS === "android" || Platform.OS === "ios") && isNanoModulePresent;
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

// ─── Per-job switches (Settings → On-device AI) ──────────────────────────────

/** The jobs on-device AI does besides reading messages, each with its own switch. */
export const AI_JOBS = [
  { key: "picture", label: "Pictures Arth can't read", note: "Reads the amount or merchant a payment picture's reader missed" },
  { key: "category", label: "Categories for new merchants", note: "Suggests one of your categories in Catch Up" },
  { key: "template", label: "Learn message formats", note: "After two approved AI reads, offers to read that format by itself" },
  { key: "merchant_merge", label: "Same place, different names", note: "Suggests merging merchant names that are one place" },
  { key: "context", label: "What a payment was", note: "Spots autopays, SIPs, EMIs and card bills" },
  { key: "month_note", label: "Your month headline", note: "A catchy line about your month at the top of Insights" },
  { key: "voice", label: "Voice and search in plain words", note: "Fills in what you say, and turns searches into filters" },
] as const;
export type AiJobKey = (typeof AI_JOBS)[number]["key"];

const JOBS_OFF_KEY = "ai_jobs_off";

function jobsOff(): Set<string> {
  try {
    const raw = settingsStorage.getString(JOBS_OFF_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** On-device AI is on, and this job hasn't been switched off. */
export function isAiJobOn(key: AiJobKey): boolean {
  return isAiReadingOn() && !jobsOff().has(key);
}

export function isAiJobSwitchOn(key: AiJobKey): boolean {
  return !jobsOff().has(key);
}

export function setAiJobSwitch(key: AiJobKey, on: boolean): void {
  const off = jobsOff();
  if (on) off.delete(key);
  else off.add(key);
  settingsStorage.set(JOBS_OFF_KEY, JSON.stringify([...off]));
  bumpDataVersion();
}
