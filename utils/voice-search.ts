/**
 * A spoken or typed search in plain words, as filters (docs/SPEED_AND_VOICE_PROPOSAL.md §2.2 B6):
 * "Swiggy over 500 last month" is merchant Swiggy, at least 500, last month; not a text search
 * for the words "swiggy over 500". Only words left over become a text search.
 * Pure; the on-device AI (services/ai/tasks/read-search.ts) only sees what this leaves.
 */
import type { DatePreset } from "@/services/saved-filter-views";
import { parseNLQuery } from "@/utils/nl-search";
import { normaliseSpokenNumbers } from "@/utils/spoken-number";
import { matchCategory, matchMerchant } from "@/utils/voice-parser";

export interface SpokenSearch {
  datePreset?: DatePreset;
  min?: number;
  max?: number;
  merchant?: string;
  category?: string;
  nature?: "credit" | "realized";
  /** Words that are none of the above, for a text search. */
  text: string;
}

const NUM = "(\\d+(?:\\.\\d+)?)";
const FILLER = /\b(show me|show|find|search|for|my|all|the|of|in|on|at|from|to|and|with|what|did|i|spend|spent|on|transactions?|payments?|expenses?|spending|rupees?|rs|please)\b/gi;

export function parseSpokenSearch(raw: string, ctx: { merchants?: readonly string[]; categories?: readonly string[] } = {}): SpokenSearch {
  const out: SpokenSearch = { text: "" };
  let s = normaliseSpokenNumbers(raw).replace(/[₹,]/g, " ");

  const between = s.match(new RegExp(`\\bbetween\\s+${NUM}\\s+(?:and|to|-)\\s+${NUM}\\b`, "i"));
  if (between) {
    const a = parseFloat(between[1]);
    const b = parseFloat(between[2]);
    out.min = Math.min(a, b);
    out.max = Math.max(a, b);
    s = s.replace(between[0], " ");
  }
  const over = s.match(new RegExp(`\\b(?:over|above|more than|greater than|at least|min(?:imum)?|bigger than|upar|se zyada)\\s+${NUM}\\b|\\b${NUM}\\s*(?:\\+|and above|or more|plus)`, "i"));
  if (over) {
    out.min = parseFloat(over[1] ?? over[2]);
    s = s.replace(over[0], " ");
  }
  const under = s.match(new RegExp(`\\b(?:under|below|less than|upto|up to|at most|max(?:imum)?|smaller than|within|se kam)\\s+${NUM}\\b|\\b${NUM}\\s*(?:and below|or less)`, "i"));
  if (under) {
    out.max = parseFloat(under[1] ?? under[2]);
    s = s.replace(under[0], " ");
  }

  if (/\b(received|credits?|money in|came in|income|refunds?|cashback|aaya|mila)\b/i.test(s)) {
    out.nature = "credit";
    s = s.replace(/\b(received|credits?|money in|came in|income|refunds?|cashback|aaya|mila)\b/gi, " ");
  } else if (/\b(debits?|money out|went out)\b/i.test(s)) {
    out.nature = "realized";
    s = s.replace(/\b(debits?|money out|went out)\b/gi, " ");
  }

  const nl = parseNLQuery(s);
  if (nl.datePreset) out.datePreset = nl.datePreset;
  s = nl.textSearch;

  const merchant = matchMerchant(s, ctx.merchants ?? []);
  if (merchant) {
    out.merchant = merchant;
    s = removeLoose(s, merchant);
  } else {
    const category = matchCategory(s, ctx.categories ?? []);
    if (category) {
      out.category = category;
      s = removeLoose(s, category);
    }
  }

  out.text = s.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  // A category found from an everyday word ("lunch") already says it: don't also need the word.
  if (out.category && out.text.split(" ").length <= 2 && matchCategory(out.text, ctx.categories ?? []) === out.category) out.text = "";
  return out;
}

/** Take a name out of the words however it was spaced. */
function removeLoose(s: string, name: string): string {
  const target = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const words = s.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    let acc = "";
    for (let j = i; j < Math.min(words.length, i + 4); j++) {
      acc += words[j].toLowerCase().replace(/[^a-z0-9]/g, "");
      if (acc === target) return [...words.slice(0, i), ...words.slice(j + 1)].join(" ");
      if (!target.startsWith(acc)) break;
    }
  }
  return s;
}

/** Anything to apply as a filter. */
export function hasSearchFilters(r: SpokenSearch): boolean {
  return r.min != null || r.max != null || !!r.merchant || !!r.category || !!r.nature;
}
