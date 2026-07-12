import type { DatePreset } from "@/services/saved-filter-views";

export interface NLParseResult {
  textSearch: string;
  datePreset?: DatePreset;
}

const DATE_RULES: [RegExp, DatePreset][] = [
  [/\b(last 3 months|past 3 months|last three months)\b/i, "last_3_months"],
  [/\b(last 30 days|past 30 days)\b/i, "last_30_days"],
  [/\b(last 7 days|past 7 days|this week|last week|past week)\b/i, "last_7_days"],
  [/\b(this fy|this financial year|current fy)\b/i, "this_fy"],
  [/\b(last fy|last financial year|previous fy)\b/i, "last_fy"],
  [/\b(last month|previous month)\b/i, "last_month"],
  [/\b(this month|current month)\b/i, "this_month"],
  [/\b(all time|ever|all)\b/i, "all"],
  [/\b(today)\b/i, "today"],
];

const FILLER = /\b(show me|show|expenses?|spending|payments?|transactions?|my|in|for|on|from)\b/gi;

export function parseNLQuery(query: string): NLParseResult {
  let remaining = query;
  let datePreset: DatePreset | undefined;

  for (const [pattern, preset] of DATE_RULES) {
    if (pattern.test(remaining)) {
      datePreset = preset;
      remaining = remaining.replace(pattern, "");
      break;
    }
  }

  const textSearch = remaining.replace(FILLER, "").replace(/\s+/g, " ").trim();

  return { textSearch, datePreset };
}
