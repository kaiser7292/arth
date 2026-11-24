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

export async function getNanoStatus(): Promise<NanoStatus> {
  if (Platform.OS !== "android" || !isNanoModulePresent) return "unavailable";
  try {
    return await checkNanoStatus();
  } catch {
    return "unavailable";
  }
}

export { downloadNano, warmupNano };

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
  if (Platform.OS !== "android" || !isNanoModulePresent) {
    throw new NanoUnavailableError("On-device AI isn't in this build.");
  }
  if (AppState.currentState !== "active") {
    throw new NanoUnavailableError("Android only runs on-device AI while Arth is open.");
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
