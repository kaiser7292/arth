/**
 * Your month in words, at the top of Insights (docs/ON_DEVICE_AI_PHASE2_PROPOSAL.md, job 7).
 *
 * Code finds the facts: this month's spending against last month's, and the top insights Insights
 * already ranks (insight-engine.ts). The model only writes them as plain sentences. A sentence is
 * kept only if every number in it is a number in the facts and every name is a name in the facts;
 * otherwise the fact shows as Insights already words it. Written once per change, kept in ai_jobs.
 */

import { DEFAULT_USER_ID } from "@/constants/app";
import { getInsights, type Insight } from "@/services/insight-engine";
import { getThisVsLastMonthTotals } from "@/services/comparison-insights";
import { formatAmount } from "@/utils/format";
import { askNano, extractJsonObject } from "../nano";
import { aiSuggestions, putAiJobResult } from "../jobs";

export interface MonthFact {
  /** Plain wording, used when there's no AI sentence. */
  text: string;
  /** Where tapping it goes. */
  href: { pathname: string; params?: Record<string, string> };
}

export interface MonthNote {
  facts: MonthFact[];
  /** One per fact, or null where the plain wording shows. */
  sentences: (string | null)[];
}

const MAX_FACTS = 3;

/** The facts for a month: code only. Exported for tests via factsFrom. */
export function factsFrom(insights: Insight[], totals: { currentMonth: number; previousMonth: number } | null, month?: string): MonthFact[] {
  const facts: MonthFact[] = [];
  if (totals && totals.currentMonth > 0 && totals.previousMonth > 0) {
    facts.push({
      text: `Spent ${formatAmount(totals.currentMonth)} so far this month, against ${formatAmount(totals.previousMonth)} last month`,
      href: { pathname: "/insights/compare" },
    });
  }
  for (const i of [...insights].sort((a, b) => b.score - a.score)) {
    if (facts.length >= MAX_FACTS) break;
    facts.push({
      text: `${i.title}. ${i.detail}`.replace(/\.\.$/, "."),
      // The month goes along, so a past month's line opens that month's details.
      href: i.href
        ? { pathname: i.href }
        : { pathname: "/insights/insight-detail", params: { insightId: i.id, title: i.title, ...(month ? { month } : {}) } },
    });
  }
  return facts;
}

export async function loadMonthFacts(month: string, thisMonth: boolean): Promise<MonthFact[]> {
  const [insights, totals] = await Promise.all([
    getInsights(DEFAULT_USER_ID, month).catch(() => [] as Insight[]),
    thisMonth ? getThisVsLastMonthTotals(DEFAULT_USER_ID).catch(() => null) : Promise.resolve(null),
  ]);
  return factsFrom(insights, totals, month);
}

/** Every number written in a text ("₹2,400", "40%", "1,23,456.50"), as numbers. Pure. */
export function numbersOf(text: string): number[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((s) => Number(s.replace(/,/g, ""))).filter((n) => Number.isFinite(n));
}

/** Names: capitalised words of 3+ letters that aren't the first word of the sentence. */
function namesOf(text: string): string[] {
  return text
    .split(/\s+/)
    .slice(1)
    .map((w) => w.replace(/[^A-Za-z0-9&'-]/g, ""))
    .filter((w) => /^[A-Z][A-Za-z0-9&'-]{2,}$/.test(w));
}

/** A sentence is kept only if its numbers and names all come from its fact. Pure. */
export function sentenceHolds(sentence: string, fact: string): boolean {
  if (!sentence.trim() || sentence.length > 220) return false;
  const factNums = numbersOf(fact);
  const near = (n: number) => factNums.some((m) => Math.abs(m - n) < 0.005 || (m >= 1000 && Math.abs(Math.round(m) - n) < 1));
  if (!numbersOf(sentence).every(near)) return false;
  const hay = fact.toLowerCase();
  return namesOf(sentence).every((w) => hay.includes(w.toLowerCase()));
}

export function buildMonthPrompt(facts: MonthFact[]): string {
  return [
    "Rewrite each numbered fact about someone's money as one short, friendly sentence in plain English.",
    "Use only the numbers and names in that fact. Don't add advice, other numbers or new names.",
    'Reply with one JSON object and nothing else, like {"1":"...","2":"..."}.',
    "",
    ...facts.map((f, i) => `${i + 1}. ${f.text}`),
    "",
    "JSON:",
  ].join("\n");
}

/** Read and check the answer. Pure. */
export function checkMonthAnswer(answer: string, facts: MonthFact[]): (string | null)[] {
  const obj = extractJsonObject(answer);
  return facts.map((f, i) => {
    const s = obj?.[String(i + 1)];
    return typeof s === "string" && sentenceHolds(s.trim(), f.text) ? s.trim() : null;
  });
}

/** A short fingerprint of the facts, so the sentences are rewritten when the month changes. Pure. */
export function factsKey(facts: MonthFact[]): string {
  return facts.map((f) => f.text).join("|");
}

/** Sentences saved for exactly these facts, or null. */
export async function savedSentences(month: string, facts: MonthFact[]): Promise<(string | null)[] | null> {
  const saved = (await aiSuggestions<{ key: string; sentences: (string | null)[] }>("month_note", [month]).catch(() => new Map())).get(month);
  return saved && saved.key === factsKey(facts) ? saved.sentences : null;
}

/** Ask the model for these facts and save what holds up. */
export async function writeMonthNote(month: string, facts: MonthFact[]): Promise<(string | null)[]> {
  const answer = await askNano(buildMonthPrompt(facts), { maxOutputTokens: 180, timeoutMs: 12000 });
  const sentences = checkMonthAnswer(answer.text, facts);
  await putAiJobResult("month_note", month, { key: factsKey(facts), sentences });
  return sentences;
}
