/**
 * Ask Arth, the reply in natural words (docs/SPEED_AND_VOICE_PROPOSAL.md §2.3, step 3): code works out
 * the answer (services/ask-arth.ts); on-device AI may word it like an assistant would.
 *
 * Checked sentence by sentence like the Your month headline (month-note.ts sentenceHolds): every
 * amount and name must be in the facts, "more" or "less" only when the facts say so. Anything that
 * doesn't hold up is dropped and the code's own sentence stays.
 */
import { askNano } from "../nano";
import { sentenceHolds } from "./month-note";
import type { AskAnswer } from "@/services/ask-arth";

export const REPLY_TIMEOUT_MS = 5000;

/** What the model may say: the code's sentence, its figures and the top of its list. Pure. */
export function replyFacts(answer: AskAnswer): string[] {
  return [
    answer.sentence,
    ...answer.figures.map((f) => `${f.label}: ${f.value}`),
    ...(answer.list ?? []).slice(0, 5).map((l) => `${l.label}: ${l.value}`),
  ];
}

export function buildReplyPrompt(question: string, facts: string[]): string {
  return [
    "You are Arth, a friendly money assistant on the person's phone. They asked a question; the facts below are the worked-out answer.",
    "Reply to them in one or two short sentences, as \"you\", like a helpful assistant would.",
    "Use only numbers and names written in the facts, exactly as written. Don't add advice, guesses or emoji.",
    "",
    `Question: ${question.replace(/\s+/g, " ").trim().slice(0, 200)}`,
    "Facts:",
    ...facts.map((f) => `- ${f}`),
    "",
    "Reply:",
  ].join("\n");
}

/** Read and check the reply. Null when any sentence doesn't hold up. Pure. */
export function checkReply(answer: string, facts: string[]): string | null {
  const reply = answer
    .replace(/^\s*(?:reply|arth)\s*:\s*/i, "")
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!reply || reply.length > 320) return null;
  const sentences = reply.match(/[^.!?]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (sentences.length === 0 || sentences.length > 3) return null;
  // The facts say "Oct"; a natural reply says "October": the full names count as written.
  const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const joined = facts.join("\n");
  const months = FULL.filter((m) => new RegExp(`\\b${m.slice(0, 3)}\\b`).test(joined));
  const hay = `${joined}\n${months.join(" ")}`;
  return sentences.every((s) => sentenceHolds(s, hay)) ? reply : null;
}

/** Ask the model to word the reply; null when it can't, in time, or the reply doesn't check out. */
export async function wordReplyWithNano(question: string, answer: AskAnswer): Promise<string | null> {
  const facts = replyFacts(answer);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), REPLY_TIMEOUT_MS);
  });
  try {
    const out = await Promise.race([askNano(buildReplyPrompt(question, facts), { maxOutputTokens: 120, temperature: 0.3, timeoutMs: REPLY_TIMEOUT_MS }), deadline]);
    return out ? checkReply(out.text, facts) : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
