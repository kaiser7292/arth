/**
 * Ask Arth, step 1: what was asked, as a query plan (docs/SPEED_AND_VOICE_PROPOSAL.md §2.3).
 *
 * A plan is a period, a subject (everything, a merchant, a category, or words to look for) and a
 * measure (total, count, did-I-ever, which merchants, by month…). Code reads the common phrasings
 * here; the on-device AI (services/ai/tasks/read-question.ts) reads the rest into the same plan,
 * and code checks it. Nothing here does arithmetic. Pure and tested.
 */
import type { Category } from "@/services/category";
import { readSpokenPeriod, type SpokenPeriod } from "@/utils/spoken-date";
import { normaliseSpokenNumbers } from "@/utils/spoken-number";
import { BRANDS, compact, matchCategory, matchMerchant } from "@/utils/voice-parser";

export type AskMeasure =
  | "total"
  | "count"
  | "exists"
  | "merchants"
  | "categories"
  | "biggest"
  | "average"
  | "by_month"
  | "first"
  | "last"
  | "budget_left"
  | "earned";

export const MEASURES: AskMeasure[] = ["total", "count", "exists", "merchants", "categories", "biggest", "average", "by_month", "first", "last", "budget_left", "earned"];

export type AskSubject =
  | { kind: "all" }
  /** `known`: one of your merchants; otherwise a name you said that isn't in Arth (yet). */
  | { kind: "merchant"; name: string; known: boolean }
  | { kind: "category"; id: string; name: string }
  /** Words to look for in merchant names and notes ("wedding"). */
  | { kind: "text"; words: string };

export interface AskPeriod extends Omit<SpokenPeriod, "match" | "previous"> {
  /** All time has nothing before it to compare with. */
  previous?: SpokenPeriod["previous"];
  allTime?: boolean;
}

export interface AskPlan {
  period: AskPeriod;
  subject: AskSubject;
  measure: AskMeasure;
  /** The words asked, for the thread. */
  said: string;
}

export interface AskContext {
  merchants: readonly string[];
  categories: readonly Pick<Category, "id" | "name">[];
}

/** The result of reading: a plan, and whether the rules are sure of it. */
export interface Reading {
  plan: AskPlan | null;
  /** False when words were left over that the rules couldn't place: worth asking the AI. */
  sure: boolean;
}

const ALL_TIME_START = "2000-01-01";
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** All time: from the start of your data to today. */
export function allTime(now: Date = new Date()): AskPeriod {
  return { start: ALL_TIME_START, end: ymd(now), label: "all time", allTime: true };
}

/** The periods the "Read as" chip offers, and the AI may name. */
export const PERIOD_KEYS = ["this_month", "last_month", "last_3_months", "this_year", "all", "this_week", "last_week", "today", "yesterday", "last_year"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];
const PERIOD_PHRASE: Record<PeriodKey, string> = {
  this_month: "this month",
  last_month: "last month",
  last_3_months: "last 3 months",
  this_year: "this year",
  all: "all time",
  this_week: "this week",
  last_week: "last week",
  today: "today",
  yesterday: "yesterday",
  last_year: "last year",
};
export const PERIOD_LABEL: Record<PeriodKey, string> = {
  this_month: "This month",
  last_month: "Last month",
  last_3_months: "Last 3 months",
  this_year: "This year",
  all: "All time",
  this_week: "This week",
  last_week: "Last week",
  today: "Today",
  yesterday: "Yesterday",
  last_year: "Last year",
};

/** A period from its key ("all", "last_month"), or a month's name ("October"). */
export function periodFrom(key: string, now: Date = new Date(), fyStartMonth = 4): AskPeriod | undefined {
  if (key === "all") return allTime(now);
  const phrase = (PERIOD_PHRASE as Record<string, string>)[key] ?? (/^[a-z]{3,9}( \d{4})?$/i.test(key) ? `in ${key}` : null);
  if (!phrase) return undefined;
  const p = readSpokenPeriod(phrase, now, fyStartMonth);
  if (!p) return undefined;
  const { match: _m, ...rest } = p;
  return rest;
}

// ── Reading the words ──────────────────────────────────────────────────────

/** "I asked", "no,", "I meant": what someone says when correcting the last answer. */
const CORRECTION = /^\s*(?:no+[,.!]?\s+|nope\s+|not that[,.]?\s+|wrong[,.]?\s+|i\s+(?:asked|meant|said|wanted|want)(?:\s+(?:about|for))?\s+|i'm\s+asking(?:\s+(?:about|for))?\s+)/i;
/** Words that make a question a follow-up of the last one. */
const FOLLOW_UP = /^\s*(?:and|what about|how about|only|just|same for|aur|now|but|also)\b/i;

const ALL_TIME = /\b(ever|all[- ]?time|all (?:the )?months|across (?:all )?months|every month|all of it|till date|to date|so far(?! this)|since (?:i |we )?(?:started|began|the start|day one)|overall|lifetime|in total|history|all years)\b/i;

const MEASURE_RULES: [RegExp, AskMeasure][] = [
  [/\b(?:did|have|has|had)\s+i\s+(?:ever\s+)?(?:pa(?:y|id)|spen[dt]|b(?:uy|ought)|order(?:ed)?|use[d]?|shop(?:ped)?)\b|\bever\s+(?:paid|spent|ordered|bought|shopped)\b|\bany\s+(?:payments?|transactions?|spend)\b/i, "exists"],
  [/\b(?:which|what|list|all|other|show|name)\b.{0,40}\b(?:merchants?|shops?|stores?|places?|payees?|brands?|apps?|restaurants?)\b|\bwhere\s+(?:all|else)\b|\bwho\s+(?:all\s+)?did\s+i\s+pay\b|\bpaid\s+to\s+whom\b/i, "merchants"],
  [/\b(?:which|what)\b.{0,20}\bcategor(?:y|ies)\b|\bby\s+categor|\bcategory[- ]wise\b|\bwhere\s+(?:did|does|has|is)\b.{0,20}\b(?:money|it|spend|spending)\b.{0,10}\bgo|\bwhat\s+did\s+i\s+spend\s+(?:it\s+)?on\b|\btop\s+categor/i, "categories"],
  [/\bmonth[- ](?:by|on)[- ]month\b|\b(?:by|per|each|every)\s+month\b|\bmonthly\b|\bmonth[- ]?wise\b|\btrend\b/i, "by_month"],
  [/\b(?:first|earliest)\s+(?:time|payment|order|transaction)\b|\bwhen\s+did\s+i\s+first\b|\bsince\s+when\b/i, "first"],
  [/\b(?:last|latest|most\s+recent)\s+(?:time|payment|order|transaction)\b|\bwhen\s+did\s+i\s+last\b|\bwhen\s+was\s+(?:the\s+)?last\b/i, "last"],
  [/\b(?:how\s+(?:often|many\s+times)|kitni\s+baar|number\s+of\s+(?:times|orders|payments)|how\s+many\s+(?:orders|times|payments|transactions))\b/i, "count"],
  [/\b(?:biggest|largest|highest|most\s+expensive|top\s+payments?|big\s+payments?|bade)\b/i, "biggest"],
  [/\b(?:average|avg|per\s+day|a\s+day|daily)\b/i, "average"],
  [/\b(?:left|remaining|bacha|budget)\b/i, "budget_left"],
  [/\b(?:earn(?:ed)?|income|came\s+in|received|salary|money\s+in|kamai|aaya)\b/i, "earned"],
  [/\b(?:spen[dt]|spending|kharcha|kharch|paid|pay|cost|expense|total|how\s+much)\b/i, "total"],
];

/** Words that carry no subject: question words, filler, money words. */
const FILLER = new Set(
  "a an the i me my mine we our you your is are was were am be been do does did have has had will would can could should what which who whom where when why how much many much more less than to at in on for of from with by and or but if so it its this that these those there here all any some ever every each month months year years week weeks day days today yesterday last next this so far time times spend spent spending pay paid payment payments money total rupees rs order ordered bought buy use used shop shopped category categories merchant merchants shop shops store stores place places list show tell give see only just also again about across since till until up please kitna kitni kya mera meri mere hai tha the ko ka ki ke se me main ne".split(" "),
);

function stripCorrection(text: string): string {
  let t = text.trim();
  for (let i = 0; i < 2; i++) t = t.replace(CORRECTION, "");
  return t;
}

/** A name said after "to", "at", "from", "on" or "with" that isn't a known word: a merchant you said. */
function saidName(t: string, ctx: AskContext): string | undefined {
  const m = t.match(/\b(?:to|at|from|on|with|for|in)\s+([a-z][a-z0-9&'.-]{2,}(?:\s+[a-z][a-z0-9&'.-]{2,})?)/i);
  if (!m) return undefined;
  const words = m[1].split(/\s+/).filter((w) => !FILLER.has(w.toLowerCase()));
  if (words.length === 0) return undefined;
  const name = words.join(" ");
  if (matchCategory(name, ctx.categories.map((c) => c.name)) && !BRANDS.has(compact(name))) return undefined;
  if (readSpokenPeriod(name)) return undefined;
  return name;
}

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * Read a question with rules. `previous` is the last question in the thread: a follow-up or a
 * correction keeps its period, subject or measure unless it says a new one.
 */
export function readQuestionRules(text: string, ctx: AskContext, previous: AskPlan | null = null, now: Date = new Date(), fyStartMonth = 4): Reading {
  const said = text.trim();
  if (!said) return { plan: null, sure: true };
  const corrected = CORRECTION.test(said);
  const body = stripCorrection(said);
  const t = normaliseSpokenNumbers(body).toLowerCase();
  const followUp = !!previous && (corrected || FOLLOW_UP.test(t) || t.split(/\s+/).length <= 5);
  const used: string[] = [];

  // Period: all time first ("ever", "across all months"), then the spoken periods.
  let period: AskPeriod | undefined;
  const allMatch = t.match(ALL_TIME);
  if (allMatch) {
    period = allTime(now);
    used.push(allMatch[0]);
  } else {
    const p = readSpokenPeriod(t, now, fyStartMonth);
    if (p) {
      const { match, ...rest } = p;
      period = rest;
      used.push(match);
    }
  }

  let measure: AskMeasure | undefined;
  // "What did I spend", "how many times did I…" are amounts and counts, not yes-or-no.
  const wh = /^\s*(?:what|how|where|which|when|kitna|kitni)\b/.test(t);
  for (const [re, m] of MEASURE_RULES) {
    if (m === "exists" && wh) continue;
    const hit = t.match(re);
    if (hit) {
      measure = m;
      used.push(hit[0]);
      break;
    }
  }

  // Subject: one of your merchants; then a category by its own name; then a brand or a name you
  // said ("pay to Zomato") that isn't in Arth; then everyday words for a category ("lunch").
  let subject: AskSubject | undefined;
  const words = t.match(/\b(?:mentioning|with the word|containing|that say|tagged|notes? (?:say|with))\s+["“']?([a-z][a-z0-9-]{2,})/);
  if (words) {
    subject = { kind: "text", words: words[1].trim() };
    used.push(words[0]);
  }
  const merchant = subject ? undefined : matchMerchant(t, ctx.merchants);
  if (merchant) {
    subject = { kind: "merchant", name: merchant, known: true };
    used.push(merchant.toLowerCase());
  }
  const catNames = ctx.categories.map((c) => c.name);
  if (!subject) {
    const named = [...ctx.categories].sort((a, b) => b.name.length - a.name.length).find((c) => c.name.length > 2 && t.includes(c.name.toLowerCase()));
    if (named) {
      subject = { kind: "category", id: named.id, name: named.name };
      used.push(named.name.toLowerCase());
    }
  }
  if (!subject) {
    const brand = t.split(/[^a-z0-9]+/).find((w) => BRANDS.has(w));
    const name = brand ?? saidName(t, ctx);
    if (name && !(measure === "merchants" && /merchant|shop|store|place/.test(name))) {
      subject = { kind: "merchant", name: titleCase(name), known: false };
      used.push(name);
    }
  }
  if (!subject) {
    const everyday = matchCategory(t, catNames);
    const cat = everyday ? ctx.categories.find((c) => c.name === everyday) : undefined;
    if (cat) subject = { kind: "category", id: cat.id, name: cat.name };
  }
  if (!subject && /\b(?:everything|overall|all\s+(?:my\s+)?(?:spending|expenses|categories)|in\s+total|altogether)\b/.test(t)) subject = { kind: "all" };

  // Words not placed: content the rules didn't understand.
  let rest = ` ${t} `;
  for (const u of used) rest = rest.replace(u.toLowerCase(), " ");
  const leftover = rest
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !FILLER.has(w) && !/^\d+$/.test(w));

  if (followUp && previous) {
    if (!period && !measure && !subject && leftover.length > 0) return { plan: null, sure: false };
    return {
      plan: {
        period: period ?? previous.period,
        subject: subject ?? previous.subject,
        measure: measure ?? (previous.measure === "exists" && subject ? "total" : previous.measure),
        said,
      },
      sure: leftover.length <= 1,
    };
  }
  if (!measure && !subject && !period) return { plan: null, sure: leftover.length === 0 };
  return {
    plan: {
      period: period ?? (measure === "exists" || measure === "first" ? allTime(now) : periodFrom("this_month", now, fyStartMonth)!),
      subject: subject ?? { kind: "all" },
      measure: measure ?? "total",
      said,
    },
    sure: leftover.length <= 1,
  };
}

// ── Saying the plan back ("Read as") ───────────────────────────────────────

export const MEASURE_LABEL: Record<AskMeasure, string> = {
  total: "Total",
  count: "How often",
  exists: "Any payment?",
  merchants: "Which merchants",
  categories: "Where it went",
  biggest: "Biggest",
  average: "Average",
  by_month: "By month",
  first: "First time",
  last: "Last time",
  budget_left: "Budget left",
  earned: "Money in",
};

export function subjectLabel(s: AskSubject): string {
  return s.kind === "all" ? "Everything" : s.kind === "text" ? `“${s.words}”` : s.name;
}

/** The plan as three short chips: subject, period, measure. */
export function readingChips(plan: AskPlan): { key: "subject" | "period" | "measure"; label: string }[] {
  const p = plan.period.label;
  return [
    { key: "subject", label: subjectLabel(plan.subject) },
    { key: "period", label: p[0].toUpperCase() + p.slice(1) },
    { key: "measure", label: MEASURE_LABEL[plan.measure] },
  ];
}
