/**
 * The one door to on-device AI (Gemini Nano through Android's AICore). Feature code never calls
 * the native module directly; it goes through here.
 *
 * - Android only, and only while Arth is on screen: Android refuses background calls, so this
 *   refuses them first with a clear reason instead of a vague native error.
 * - Every call has a timeout and never hangs a screen.
 * - Answers are text. Turning them into data, and deciding whether to trust them, is each task's
 *   job (services/ai/tasks/*), never the model's.
 *
 * Nothing leaves the phone: AICore runs the model locally.
 */

import { AppState, Platform } from "react-native";
import {
  checkNanoReason,
  checkNanoStatus,
  downloadNano,
  generateWithNano,
  isNanoModulePresent,
  warmupNano,
  type NanoAnswer,
  type NanoStatus,
} from "../../modules/arth-nano";

export type { NanoAnswer, NanoStatus };

export const NANO_TIMEOUT_MS = 8000;

export class NanoUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NanoUnavailableError";
  }
}

/** Phones with an on-device model Arth can ask: Gemini Nano on Android, Apple Intelligence on iPhone. */
const ON_DEVICE_OS = Platform.OS === "android" || Platform.OS === "ios";

/** What the on-device model is called on this phone, for anything shown to the person. */
export const ON_DEVICE_MODEL_NAME = Platform.OS === "ios" ? "Apple Intelligence" : "Gemini Nano";

export async function getNanoStatus(): Promise<NanoStatus> {
  if (!ON_DEVICE_OS || !isNanoModulePresent) return "unavailable";
  try {
    return await checkNanoStatus();
  } catch {
    return "unavailable";
  }
}

export { downloadNano, warmupNano };

/** Why on-device AI isn't ready on this iPhone, exactly (Settings shows it). */
export type OnDeviceReason =
  | "ready"
  | "not-in-build"
  | "built-without-sdk"
  | "ios-too-old"
  | "device-not-eligible"
  | "turned-off"
  | "getting-ready"
  | "unknown";

const REASONS: OnDeviceReason[] = ["ready", "not-in-build", "built-without-sdk", "ios-too-old", "device-not-eligible", "turned-off", "getting-ready", "unknown"];

/** iPhone only: the exact reason, or null on Android (its status says enough). Never throws. */
export async function getOnDeviceReason(): Promise<OnDeviceReason | null> {
  if (Platform.OS !== "ios") return null;
  if (!isNanoModulePresent) return "not-in-build";
  try {
    const r = await checkNanoReason();
    return r && (REASONS as string[]).includes(r) ? (r as OnDeviceReason) : "unknown";
  } catch {
    return "unknown";
  }
}

/** The reason in words, for Settings → AI and Settings → On-device AI. Pure. */
export function onDeviceReasonText(reason: OnDeviceReason): string {
  switch (reason) {
    case "ready":
      return "Apple Intelligence is ready.";
    case "not-in-build":
      return "This copy of Arth was built without the Apple Intelligence part. On the Mac, run npx expo prebuild --platform ios, then build again.";
    case "built-without-sdk":
      return "This copy of Arth was built with an Xcode older than 26, which can't include Apple Intelligence. Build it with Xcode 26 or later.";
    case "ios-too-old":
      return "Needs iOS 26 or later. Update the iPhone in Settings → General → Software Update.";
    case "device-not-eligible":
      return "This iPhone can't run Apple Intelligence (it needs an iPhone 15 Pro or later), so Arth works as before.";
    case "turned-off":
      return "Turn on Apple Intelligence in Settings → Apple Intelligence & Siri, and keep Siri on (Hey Siri or Press Side Button). The iPhone's language and Siri's must be ones Apple Intelligence supports.";
    case "getting-ready":
      return "The iPhone is still downloading Apple Intelligence. Keep it on Wi-Fi and charging, then check again later.";
    default:
      return "Apple didn't say why. Restart the iPhone and check again.";
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`No answer in ${Math.round(ms / 1000)} s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Settles when the model call in progress (if any) has finished. */
let lane: Promise<void> = Promise.resolve();

/** Ask the model one question. Throws NanoUnavailableError when it can't be asked right now. */
export async function askNano(
  prompt: string,
  opts: { maxOutputTokens?: number; temperature?: number; timeoutMs?: number } = {},
): Promise<NanoAnswer> {
  if (!ON_DEVICE_OS || !isNanoModulePresent) {
    throw new NanoUnavailableError("On-device AI isn't in this build.");
  }
  if (AppState.currentState !== "active") {
    throw new NanoUnavailableError("The phone only runs on-device AI while Arth is open.");
  }
  // One call at a time: the queue, onboarding's account and merchant questions and the lab can
  // all ask at once, and AICore refuses overlapping calls. The next call waits for the native call
  // to finish, not just for its timeout, so a slow answer never overlaps the next question.
  // The timeout counts from when this call starts, not while it waits its turn.
  const before = lane;
  let release: () => void = () => {};
  lane = new Promise<void>((resolve) => {
    release = resolve;
  });
  await before;
  const call = generateWithNano(prompt, opts.temperature ?? 0, opts.maxOutputTokens ?? 256);
  call.then(release, release);
  return withTimeout(call, opts.timeoutMs ?? NANO_TIMEOUT_MS);
}

/**
 * The first JSON object in a model answer. Forgiving about what surrounds it (code fences,
 * "Here is the JSON:", trailing text, curly quotes); null when there's no object to read.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  // The object ends at the brace that balances the first one (strings skipped).
  let depth = 0;
  let inString = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      const raw = cleaned.slice(start, i + 1).replace(/,\s*}/g, "}");
      try {
        const v: unknown = JSON.parse(raw);
        return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}
