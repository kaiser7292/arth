/**
 * Voice in plain words (docs/ON_DEVICE_AI_PHASE2_PROPOSAL.md, job 6a): when the voice parser
 * (utils/voice-parser.ts) leaves the merchant, category or payment mode empty, on-device AI reads
 * the sentence with the person's own category and payment-mode names.
 *
 * Checked like everything else: the merchant's words must be in what was said; the category and
 * mode must be names from the person's lists; an amount only if it's a number they said. It fills
 * the Add screen; nothing is saved until they tap Save.
 */

import { askNano, extractJsonObject } from "../nano";

export const VOICE_TIMEOUT_MS = 3000;

export interface VoiceReading {
  amount: number | null;
  merchant: string | null;
  category: string | null;
  mode: string | null;
}

export function buildVoicePrompt(said: string, categories: string[], modes: string[]): string {
  return [
    "Someone said how they spent money. Reply with one JSON object and nothing else.",
    '"amount": the number spent. "merchant": who was paid, as said.',
    `"category": one of: ${categories.join(" | ")}.`,
    `"mode": one of: ${modes.join(" | ")}.`,
    "Leave out anything not said.",
    "",
    `Said: ${said.replace(/\s+/g, " ").trim().slice(0, 300)}`,
    "",
    "JSON:",
  ].join("\n");
}

const pick = (v: unknown, names: string[]): string | null => {
  if (typeof v !== "string") return null;
  return names.find((n) => n.toLowerCase() === v.trim().toLowerCase()) ?? null;
};

/** Read and check the answer. Pure. */
export function checkVoiceAnswer(answer: string, said: string, categories: string[], modes: string[]): VoiceReading {
  const out: VoiceReading = { amount: null, merchant: null, category: null, mode: null };
  const obj = extractJsonObject(answer);
  if (!obj) return out;
  const n = Number(String(obj.amount ?? "").replace(/[,₹\s]/g, ""));
  const spokenNumbers = (said.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((x) => Number(x.replace(/,/g, "")));
  if (Number.isFinite(n) && n > 0 && spokenNumbers.some((m) => Math.abs(m - n) < 0.005)) out.amount = n;
  if (typeof obj.merchant === "string" && obj.merchant.trim()) {
    const words = obj.merchant.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
    const hay = said.toLowerCase();
    if (words.length > 0 && words.every((w) => hay.includes(w))) out.merchant = obj.merchant.trim().slice(0, 60);
  }
  out.category = pick(obj.category, categories);
  out.mode = pick(obj.mode, modes);
  return out;
}

/** Ask the model; null when it can't answer in time. */
export async function readVoiceWithNano(said: string, categories: string[], modes: string[]): Promise<VoiceReading | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), VOICE_TIMEOUT_MS);
  });
  try {
    const answer = await Promise.race([askNano(buildVoicePrompt(said, categories, modes), { maxOutputTokens: 60, timeoutMs: VOICE_TIMEOUT_MS }), deadline]);
    return answer ? checkVoiceAnswer(answer.text, said, categories, modes) : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
