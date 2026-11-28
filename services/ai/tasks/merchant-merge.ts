/**
 * Same place, different names (docs/ON_DEVICE_AI_PHASE2_PROPOSAL.md, job 2).
 *
 * Code finds the candidates; the model only judges them:
 *  - names close but below the auto-merge bar (merchantFuzzyScore 0.5-0.75)
 *  - names sharing a first word ("Swiggy", "Swiggy Instamart")
 *  - names paid to the same UPI ID in their messages
 * Up to PAIRS_PER_DAY new pairs a day go to the model: same / different / unsure. Only "same"
 * becomes a "Same place?" card in Settings → Merchants. Merging is the merchant screen's own merge;
 * "Not the same" is kept, so the pair is never asked again.
 */

import { getDatabase } from "@/database";
import { settingsStorage } from "@/services/storage";
import { DEFAULT_USER_ID } from "@/constants/app";
import { learnMerchantAlias, merchantFuzzyScore, propagateMerchantRename, renameCanonical } from "@/services/merchant-alias";
import { listMerchants, type MerchantSummary } from "@/services/merchants-overview";
import { askNano, extractJsonObject } from "../nano";
import { aiSuggestions, answerAiJob, finishAiJob, failAiJob, queueAiJob, queuedAiJobs } from "../jobs";

export const PAIRS_PER_DAY = 20;
/** When candidate pairs were last looked for (device-only timer). */
const SEARCHED_AT_KEY = "ai_merge_searched_at";
const PAIRS_PER_PROMPT = 5;
const SEP = " ⇄ ";

/** Words too common to make two names the same place. */
const COMMON = new Set(["the", "upi", "payment", "payments", "pay", "india", "indian", "pvt", "ltd", "limited", "private", "store", "stores", "shop", "services", "service", "bank", "new", "sri", "shri", "and", "co", "mr", "mrs", "ms"]);

const firstWord = (name: string) => name.toLowerCase().split(/[^a-z0-9]+/).find((w) => w.length >= 4 && !COMMON.has(w)) ?? null;

/** One key per unordered pair, so A⇄B and B⇄A are one question. Pure. */
export function pairKey(a: string, b: string): string {
  return [a, b].sort((x, y) => x.localeCompare(y)).join(SEP);
}

export interface MergePair {
  a: string;
  b: string;
  why: "similar" | "first_word" | "same_upi";
}

/** Candidate pairs from names and shared UPI IDs. Pure; exported for tests. */
export function candidatePairs(names: string[], vpaByName: Map<string, Set<string>> = new Map()): MergePair[] {
  const out = new Map<string, MergePair>();
  const add = (a: string, b: string, why: MergePair["why"]) => {
    if (a.toLowerCase() === b.toLowerCase()) return;
    const k = pairKey(a, b);
    if (!out.has(k) || why === "same_upi") out.set(k, { a, b, why });
  };
  // Worked out once per name, not once per pair.
  const firsts = names.map(firstWord);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const [a, b] = [names[i], names[j]];
      if (firsts[i] && firsts[i] === firsts[j]) add(a, b, "first_word");
      // Names of very different length are never "close": skip the costly comparison.
      if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) / 2) continue;
      const score = merchantFuzzyScore(a, b);
      if (score >= 0.5 && score < 0.75) add(a, b, "similar");
    }
  }
  // Paid to the same UPI ID under two names.
  const byVpa = new Map<string, string[]>();
  for (const [name, vpas] of vpaByName) for (const v of vpas) byVpa.set(v, [...(byVpa.get(v) ?? []), name]);
  for (const group of byVpa.values()) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) add(group[i], group[j], "same_upi");
  }
  return [...out.values()];
}

const VPA = /\b([a-z0-9][a-z0-9._-]{1,60}@[a-z][a-z0-9]{1,30})\b/gi;

async function vpasByMerchant(): Promise<Map<string, Set<string>>> {
  const rows = await getDatabase().getAllAsync<{ merchant_name: string; raw_source_text: string }>(
    `SELECT merchant_name, raw_source_text FROM expenses
      WHERE user_id = ? AND deleted_at IS NULL AND nature = 'realized' AND merchant_name IS NOT NULL
        AND raw_source_text IS NOT NULL AND raw_source_text LIKE '%@%'
      ORDER BY date DESC LIMIT 2000;`,
    DEFAULT_USER_ID,
  );
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    for (const m of r.raw_source_text.matchAll(VPA)) {
      const v = m[1].toLowerCase();
      out.set(r.merchant_name, (out.get(r.merchant_name) ?? new Set()).add(v));
    }
  }
  return out;
}

/** Queue today's new candidate pairs (pairs already asked or answered are skipped). */
export async function findMergeCandidates(now: number = Date.now()): Promise<number> {
  // Once a day: comparing every pair of names is the costly part, and names change slowly.
  const last = settingsStorage.getNumber(SEARCHED_AT_KEY) ?? 0;
  if (now - last < 86400000) return 0;
  settingsStorage.set(SEARCHED_AT_KEY, now);
  const merchants = (await listMerchants()).filter((m) => m.txCount > 0);
  const pairs = candidatePairs(
    merchants.map((m) => m.name),
    await vpasByMerchant(),
  );
  // Strongest signal first.
  const rank = { same_upi: 0, first_word: 1, similar: 2 } as const;
  pairs.sort((x, y) => rank[x.why] - rank[y.why]);
  let queued = 0;
  for (const p of pairs) {
    if (queued >= PAIRS_PER_DAY) break;
    if (await queueAiJob("merchant_merge", pairKey(p.a, p.b))) queued++;
  }
  return queued;
}

export function buildMergePrompt(pairs: [string, string][]): string {
  return [
    "You know Indian shops, brands and payment names. For each numbered pair, say whether both names are",
    'the same business or place: "same", "different", or "unsure". Reply with one JSON object and nothing else.',
    'Example: {"1":"same","2":"different"}',
    "",
    ...pairs.map(([a, b], i) => `${i + 1}. ${a} | ${b}`),
    "",
    "JSON:",
  ].join("\n");
}

/** Only an explicit "same" counts. Pure. */
export function checkMergeAnswer(answer: string, count: number): boolean[] {
  const obj = extractJsonObject(answer);
  return Array.from({ length: count }, (_, i) => String(obj?.[String(i + 1)] ?? "").toLowerCase().trim() === "same");
}

/** Runner handler: ask about the waiting pairs. */
export async function runMergeJobs(h: { shouldStop: () => boolean; untilActive: () => Promise<void> }): Promise<number> {
  await findMergeCandidates();
  const jobs = await queuedAiJobs("merchant_merge", PAIRS_PER_DAY);
  if (jobs.length === 0) return 0;
  const names = new Set((await listMerchants()).map((m) => m.name));
  let made = 0;
  for (let i = 0; i < jobs.length; i += PAIRS_PER_PROMPT) {
    if (h.shouldStop()) break;
    await h.untilActive();
    const batch = jobs.slice(i, i + PAIRS_PER_PROMPT);
    const pairs = batch.map((j) => j.ref_id.split(SEP) as [string, string]);
    // Merged meanwhile, or renamed: nothing to ask.
    const live = batch.filter((_, k) => names.has(pairs[k][0]) && names.has(pairs[k][1]));
    for (const j of batch) if (!live.includes(j)) await finishAiJob(j.id, null);
    if (live.length === 0) continue;
    const livePairs = live.map((j) => j.ref_id.split(SEP) as [string, string]);
    try {
      const answer = await askNano(buildMergePrompt(livePairs), { maxOutputTokens: 60, timeoutMs: 10000 });
      const same = checkMergeAnswer(answer.text, live.length);
      for (let k = 0; k < live.length; k++) {
        await finishAiJob(live[k].id, same[k] ? { a: livePairs[k][0], b: livePairs[k][1] } : null);
        if (same[k]) made++;
      }
    } catch {
      for (const j of live) await failAiJob(j);
      break;
    }
  }
  return made;
}

export interface MergeOffer {
  key: string;
  /** The name kept: the one with more transactions. */
  keep: MerchantSummary;
  other: MerchantSummary;
}

/** "Same place?" cards: pairs the AI said are one place, both names still there. */
export async function mergeOffers(): Promise<MergeOffer[]> {
  const found = await aiSuggestions<{ a: string; b: string }>("merchant_merge");
  if (found.size === 0) return [];
  const byName = new Map((await listMerchants()).map((m) => [m.name, m]));
  const out: MergeOffer[] = [];
  for (const [key, p] of found) {
    const a = byName.get(p.a);
    const b = byName.get(p.b);
    if (!a || !b) continue;
    const [keep, other] = a.txCount >= b.txCount ? [a, b] : [b, a];
    out.push({ key, keep, other });
  }
  return out;
}

/** Merge, as the merchant screen's "Merge another merchant into…" does. */
export async function acceptMergeOffer(o: MergeOffer): Promise<number> {
  await renameCanonical(DEFAULT_USER_ID, o.other.name, o.keep.name);
  for (const n of o.other.names) if (!n.aliasId) await learnMerchantAlias(DEFAULT_USER_ID, n.smsName, o.keep.name);
  const moved = await propagateMerchantRename(DEFAULT_USER_ID, o.other.name, o.keep.name);
  await answerAiJob("merchant_merge", o.key, "accepted");
  return moved;
}

export async function dismissMergeOffer(key: string): Promise<void> {
  await answerAiJob("merchant_merge", key, "dismissed");
}
