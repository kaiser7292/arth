/**
 * Search in plain words (docs/ON_DEVICE_AI_PHASE2_PROPOSAL.md, job 6b): "Swiggy over 500",
 * "what did I spend on fuel" in the Transactions search. Dates are read by code first
 * (utils/nl-search.ts parseNLQuery); on-device AI maps the rest onto the filters the screen already
 * has: merchant, category, amount range, money in or out.
 *
 * Checked: the merchant must be one of the person's merchants, the category one of theirs, the
 * amounts numbers in the query. The results are the normal filtered list, never figures from the
 * model.
 */

import { askNano, extractJsonObject } from "../nano";

export const SEARCH_TIMEOUT_MS = 3000;

export interface SearchFilters {
  merchant: string | null;
  category: string | null;
  min: number | null;
  max: number | null;
  type: "debits" | "credits" | null;
}

/** Worth asking: three or more words that aren't just a number. Pure. */
export function worthAskingSearch(text: string): boolean {
  return text.trim().split(/\s+/).filter((w) => /[a-z]/i.test(w)).length >= 3;
}

export function buildSearchPrompt(text: string, categories: string[]): string {
  return [
    "Turn a search of someone's bank transactions into filters. Reply with one JSON object and nothing else.",
    '"merchant": a shop or payee name in the search. "category": one of: ' + categories.join(" | ") + ".",
    '"min" and "max": amount limits from words like "over", "under", "between". "type": "debits" for spending',
    'or "credits" for money received. Leave out anything the search doesn\'t say.',
    "",
    `Search: ${text.replace(/\s+/g, " ").trim().slice(0, 200)}`,
    "",
    "JSON:",
  ].join("\n");
}

/** Read and check the answer. Pure. */
export function checkSearchAnswer(answer: string, text: string, merchants: string[], categories: string[]): SearchFilters {
  const out: SearchFilters = { merchant: null, category: null, min: null, max: null, type: null };
  const obj = extractJsonObject(answer);
  if (!obj) return out;
  const said = text.toLowerCase();
  if (typeof obj.merchant === "string" && obj.merchant.trim()) {
    const want = obj.merchant.trim().toLowerCase();
    // One of their merchants, and the search says it.
    const hit = merchants.find((m) => m.toLowerCase() === want) ?? merchants.find((m) => m.toLowerCase().startsWith(want) && want.length >= 3);
    if (hit && said.includes(want.split(/\s+/)[0])) out.merchant = hit;
  }
  const wantCat = typeof obj.category === "string" ? obj.category.trim().toLowerCase() : "";
  if (wantCat) out.category = categories.find((c) => c.toLowerCase() === wantCat) ?? null;
  const nums = (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((x) => Number(x.replace(/,/g, "")));
  const num = (v: unknown) => {
    const n = Number(String(v ?? "").replace(/[,₹\s]/g, ""));
    return Number.isFinite(n) && n > 0 && nums.some((m) => Math.abs(m - n) < 0.005) ? n : null;
  };
  out.min = num(obj.min);
  out.max = num(obj.max);
  if (out.min != null && out.max != null && out.min > out.max) out.max = null;
  const t = String(obj.type ?? "").toLowerCase();
  if (t === "credits" && /\b(?:received|credit|credits|income|got|money in|refund)/i.test(text)) out.type = "credits";
  else if (t === "debits" && /\b(?:spent|spend|paid|debit|debits|bought|money out)/i.test(text)) out.type = "debits";
  return out;
}

/** True when the answer gave at least one filter. Pure. */
export function anyFilter(f: SearchFilters): boolean {
  return !!(f.merchant || f.category || f.min != null || f.max != null || f.type);
}

export async function readSearchWithNano(text: string, merchants: string[], categories: string[]): Promise<SearchFilters | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SEARCH_TIMEOUT_MS);
  });
  try {
    const answer = await Promise.race([askNano(buildSearchPrompt(text, categories), { maxOutputTokens: 60, timeoutMs: SEARCH_TIMEOUT_MS }), deadline]);
    return answer ? checkSearchAnswer(answer.text, text, merchants, categories) : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
