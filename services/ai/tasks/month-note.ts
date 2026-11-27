/**
 * The month's headline, in words (docs/ON_DEVICE_AI_PHASE2_PROPOSAL.md, job 7).
 *
 * Code finds the facts (services/month-story.ts: storyFacts). The model only writes one short,
 * catchy headline from them. It's kept only if every number in it is a number in the facts and
 * every name is a name in the facts; otherwise the plain headline shows. Written once per change
 * of facts, kept in ai_jobs under the month.
 */

import { askNano } from "../nano";
import { aiSuggestions, putAiJobResult } from "../jobs";

/** Every number written in a text ("₹2,400", "40%", "1,23,456.50", "₹6.2K"), as numbers. Pure. */
export function numbersOf(text: string): number[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((s) => Number(s.replace(/,/g, ""))).filter((n) => Number.isFinite(n));
}

/** Names: capitalised words of 3+ letters that aren't the first word of the sentence. */
function namesOf(text: string): string[] {
  return text
    .split(/\s+/)
    .slice(1)
    .map((w) => w.replace(/[^A-Za-z0-9&'-]/g, "").replace(/'s$/, ""))
    .filter((w) => /^[A-Z][A-Za-z0-9&'-]{2,}$/.test(w));
}

/** Every number with its unit ("6.2K" → 6.2 k, "40%" → 40 %, "1,200" → 1200 ""). Pure. */
export function amountsOf(text: string): { n: number; unit: string }[] {
  const out: { n: number; unit: string }[] = [];
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k|l|lakh|lakhs|cr|crore|crores|m|b|%)?(?![a-z])/gi)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const u = (m[2] ?? "").toLowerCase();
    out.push({ n, unit: u.startsWith("lakh") ? "l" : u.startsWith("cr") ? "cr" : u });
  }
  return out;
}

const UP_WORDS = /\b(?:more|ahead|over|higher|above|up|rose|jumped)\b/i;
const DOWN_WORDS = /\b(?:less|under|behind|lower|below|down|fell|dropped|saved)\b/i;
const UP_FACT = /\b(?:more|up)\b/i;
const DOWN_FACT = /\b(?:less|down)\b/i;

/**
 * A sentence is kept only if every number (with its unit: 84K is not 84L) and every name comes
 * from the facts, and it doesn't turn "less" into "more": a direction the facts never state is
 * dropped. Pure.
 */
export function sentenceHolds(sentence: string, facts: string): boolean {
  if (!sentence.trim() || sentence.length > 220) return false;
  const factAmts = amountsOf(facts);
  const near = (a: { n: number; unit: string }) => factAmts.some((m) => m.unit === a.unit && (Math.abs(m.n - a.n) < 0.005 || (m.n >= 1000 && Math.abs(Math.round(m.n) - a.n) < 1)));
  if (!amountsOf(sentence).every(near)) return false;
  if (UP_WORDS.test(sentence) && !UP_FACT.test(facts)) return false;
  if (DOWN_WORDS.test(sentence) && !DOWN_FACT.test(facts)) return false;
  const hay = facts.toLowerCase();
  return namesOf(sentence).every((w) => hay.includes(w.toLowerCase()));
}

export function buildHeadlinePrompt(facts: string[]): string {
  return [
    "Write one short, catchy, playful headline about this person's month of spending, speaking to them as \"you\".",
    "Pick the one or two most interesting facts. At most 14 words. Use only numbers and names written in the facts,",
    "written exactly as they appear. No advice, no emoji, no quotes. Reply with the headline only.",
    "",
    ...facts.map((f) => `- ${f}`),
    "",
    "Headline:",
  ].join("\n");
}

/** Read and check the answer. Pure. Null when it doesn't hold up. */
export function checkHeadline(answer: string, facts: string[]): string | null {
  const line = answer
    .trim()
    .split("\n")[0]
    .replace(/^headline:\s*/i, "")
    .replace(/^["'“”*\s]+|["'“”*\s]+$/g, "")
    .trim();
  if (line.length < 12 || line.length > 120) return null;
  if (line.split(/\s+/).length > 18) return null;
  return sentenceHolds(line, facts.join("\n")) ? line : null;
}

/** A short fingerprint of the facts, so the headline is rewritten when they change. Pure. */
export function factsKey(facts: string[]): string {
  return `h1|${facts.join("|")}`;
}

/**
 * What was saved for exactly these facts: `{ headline }` (null when the model's line failed the
 * check, so it isn't asked again), or undefined when nothing was asked yet.
 */
export async function savedHeadline(month: string, facts: string[]): Promise<{ headline: string | null } | undefined> {
  const saved = (await aiSuggestions<{ key?: unknown; headline?: unknown }>("month_note", [month]).catch(() => new Map())).get(month);
  // Older saves (three sentences per month) have another shape and key: they're simply not used.
  if (!saved || saved.key !== factsKey(facts)) return undefined;
  return { headline: typeof saved.headline === "string" ? saved.headline : null };
}

/** Ask the model for a headline and save it if it holds up (null is saved too: not asked again). */
export async function writeHeadline(month: string, facts: string[]): Promise<string | null> {
  const answer = await askNano(buildHeadlinePrompt(facts), { maxOutputTokens: 48, timeoutMs: 10000 });
  const headline = checkHeadline(answer.text, facts);
  await putAiJobResult("month_note", month, { key: factsKey(facts), headline });
  return headline;
}
