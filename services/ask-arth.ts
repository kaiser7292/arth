/**
 * Ask Arth (docs/SPEED_AND_VOICE_PROPOSAL.md §2.3): a question in plain words, typed or spoken,
 * answered in a sentence, with the working underneath. Not a jump to a filtered list.
 *
 *   1. Understand: rules read the period ("by day 15", "last week", "in October"), the subject
 *      (one of your merchants or categories, or everything) and the measure (spent, how often,
 *      biggest, average, what's left in the budget, what came in, where it went).
 *   2. Work it out in code, from the same sums the screens use: spending = getSpendingRows (the
 *      Budget tab's rule, refunds taken off), budget = getBudgetVsActual, money in = getCashFlow.
 *   3. Say it: a plain sentence, the figures, and the transactions behind it.
 *   4. Follow-ups ("and last month?", "only Swiggy") keep what the last question didn't change.
 *
 * The AI never does the arithmetic. `readQuestion` and `composeAnswer` are pure and tested;
 * `answerQuestion` reads the database.
 */
import { DEFAULT_USER_ID } from "@/constants/app";
import { getSpendingRows } from "@/services/analytics/spending-rows";
import { getBudgetVsActual } from "@/services/budget";
import { getCashFlow } from "@/services/cash-flow";
import { getSpendClassificationTotals } from "@/services/spend-classification";
import { getCategories, type Category } from "@/services/category";
import { getDistinctMerchantNames } from "@/services/merchant-alias";
import { getFYStartMonth } from "@/services/settings";
import type { Expense } from "@/services/expense-types";
import { formatAmount } from "@/utils/format";
import { readSpokenPeriod, shortDay, type SpokenPeriod } from "@/utils/spoken-date";
import { normaliseSpokenNumbers } from "@/utils/spoken-number";
import { matchCategory, matchMerchant } from "@/utils/voice-parser";

export type AskMeasure = "spent" | "count" | "biggest" | "average" | "budget_left" | "earned" | "top";

export type AskSubject = { kind: "all" } | { kind: "merchant"; name: string } | { kind: "category"; id: string; name: string };

export interface AskQuestion {
  period: SpokenPeriod;
  subject: AskSubject;
  measure: AskMeasure;
  /** What was asked, for the thread. */
  said: string;
}

export interface AskFigure {
  label: string;
  value: string;
}

export interface AskAnswer {
  /** The reply, in a sentence or two. */
  sentence: string;
  figures: AskFigure[];
  /** The transactions behind it, for "See these transactions". */
  expenseIds: string[];
  seeTitle: string;
  /** Arth couldn't answer: questions it can. */
  examples?: string[];
}

export const EXAMPLE_QUESTIONS = [
  "What did I spend by day 15?",
  "How much on food this month?",
  "How often did I order from Swiggy last month?",
  "Biggest payments this week",
  "What's left in my budget?",
  "What came in last month?",
  "Where did my money go in October?",
];

const MEASURES: [RegExp, AskMeasure][] = [
  [/\b(how (?:often|many times)|kitni baar|number of times|how many (?:orders|times|payments|transactions))\b/, "count"],
  [/\b(biggest|largest|highest|most expensive|top payments?|big payments?|bade)\b/, "biggest"],
  [/\b(average|avg|per day|a day|daily)\b/, "average"],
  [/\b(left|remaining|bacha|budget)\b/, "budget_left"],
  [/\b(earn(?:ed)?|income|came in|received|salary|money in|kamai|aaya)\b/, "earned"],
  [/\b(where did|where does|where has|what did i spend (?:it )?on|top categor(?:y|ies)|most on|kahan)\b/, "top"],
];

/** "and last month?" / "only Swiggy": a follow-up that keeps the rest of the last question. */
const FOLLOW_UP = /^\s*(and|what about|how about|only|just|same for|aur|now)\b/i;

/** The month this question is about, when it doesn't say: this month so far. */
function thisMonth(now: Date): SpokenPeriod {
  return readSpokenPeriod("this month", now)!;
}

/**
 * Read a question. `previous` is the last question in the thread: a follow-up keeps its period,
 * subject or measure unless it says a new one. Returns null when nothing in it can be answered.
 */
export function readQuestion(
  text: string,
  ctx: { merchants: readonly string[]; categories: readonly Pick<Category, "id" | "name">[] },
  previous: AskQuestion | null = null,
  now: Date = new Date(),
  fyStartMonth = 4,
): AskQuestion | null {
  const said = text.trim();
  if (!said) return null;
  const t = normaliseSpokenNumbers(said).toLowerCase();
  const followUp = !!previous && (FOLLOW_UP.test(t) || t.split(/\s+/).length <= 4);

  const period = readSpokenPeriod(t, now, fyStartMonth);
  let measure: AskMeasure | undefined;
  for (const [re, m] of MEASURES) {
    if (re.test(t)) {
      measure = m;
      break;
    }
  }
  if (!measure && /\b(spen[dt]|spending|kharcha|kharch|paid|cost|expense)\b/.test(t)) measure = "spent";

  let subject: AskSubject | undefined;
  const merchant = matchMerchant(t, ctx.merchants);
  if (merchant) subject = { kind: "merchant", name: merchant };
  else {
    const catName = matchCategory(t, ctx.categories.map((c) => c.name));
    const cat = catName ? ctx.categories.find((c) => c.name === catName) : undefined;
    if (cat) subject = { kind: "category", id: cat.id, name: cat.name };
  }
  if (!subject && /\b(everything|overall|in total|total|all)\b/.test(t)) subject = { kind: "all" };

  if (followUp && previous) {
    if (!period && !measure && !subject) return null;
    return {
      period: period ?? previous.period,
      subject: subject ?? previous.subject,
      measure: measure ?? (previous.measure === "budget_left" && subject?.kind === "merchant" ? "spent" : previous.measure),
      said,
    };
  }
  // A new question needs to be about money somehow: a measure, a subject or a period.
  if (!measure && !subject && !period) return null;
  return { period: period ?? thisMonth(now), subject: subject ?? { kind: "all" }, measure: measure ?? "spent", said };
}

/** The data an answer is worked out from. */
export interface AskData {
  rows: Expense[];
  previousRows: Expense[];
  categories: Pick<Category, "id" | "name" | "parent_id">[];
  /** budget_left only. */
  budget?: { budget: number; spent: number } | null;
  /** earned only. */
  earned?: { income: number; cameIn: number; months: string } | null;
}

const money = (n: number) => formatAmount(Math.round(n));
/** This month, YYYY-MM, in local time (never UTC: just after midnight in India that is yesterday). */
const localMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** Which rows a subject covers. A category includes its subcategories. */
export function rowsFor(rows: Expense[], subject: AskSubject, categories: Pick<Category, "id" | "parent_id">[]): Expense[] {
  if (subject.kind === "all") return rows;
  if (subject.kind === "merchant") {
    const n = subject.name.toLowerCase();
    return rows.filter((r) => (r.merchant_name ?? "").toLowerCase() === n);
  }
  const ids = new Set([subject.id, ...categories.filter((c) => c.parent_id === subject.id).map((c) => c.id)]);
  return rows.filter((r) => r.category_id != null && ids.has(r.category_id));
}

const sum = (rows: Expense[]) => rows.reduce((s, r) => s + (r.amount ?? 0), 0);

/** The top groups of rows by total: categories (rolled up to the top level) or merchants. */
function topGroups(rows: Expense[], by: "category" | "merchant", categories: Pick<Category, "id" | "name" | "parent_id">[], n: number) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const totals = new Map<string, number>();
  for (const r of rows) {
    let key: string;
    if (by === "merchant") key = r.merchant_name?.trim() || "Unnamed";
    else {
      const c = r.category_id ? byId.get(r.category_id) : undefined;
      const top = c?.parent_id ? byId.get(c.parent_id) ?? c : c;
      key = top?.name ?? "Uncategorised";
    }
    totals.set(key, (totals.get(key) ?? 0) + (r.amount ?? 0));
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function subjectWords(s: AskSubject): string {
  return s.kind === "all" ? "" : s.kind === "merchant" ? ` at ${s.name}` : ` on ${s.name}`;
}

/** The period in a sentence: "By 15 Nov", "This month", "In October". */
function periodLead(p: SpokenPeriod): string {
  if (p.label.startsWith("1–")) return `By ${p.label.slice(2)}`;
  if (/^[A-Z][a-z]+( \d{4})?$/.test(p.label)) return `In ${p.label}`;
  return p.label[0].toUpperCase() + p.label.slice(1);
}

/** Work out the reply. Pure. */
export function composeAnswer(q: AskQuestion, d: AskData): AskAnswer {
  const rows = rowsFor(d.rows, q.subject, d.categories);
  const prev = rowsFor(d.previousRows, q.subject, d.categories);
  const total = sum(rows);
  const prevTotal = sum(prev);
  const lead = periodLead(q.period);
  const sub = subjectWords(q.subject);
  const seeTitle = `${q.subject.kind === "all" ? "Spending" : q.subject.name} · ${q.period.label}`;
  const ids = rows.map((r) => r.id);
  const base = { expenseIds: ids, seeTitle };

  const versus = () => {
    if (prevTotal <= 0) return "";
    const diff = total - prevTotal;
    if (Math.abs(diff) < 1) return `, the same as ${q.period.previous.label}`;
    return `, ${money(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than ${q.period.previous.label}`;
  };

  switch (q.measure) {
    case "count": {
      if (rows.length === 0) return { ...base, sentence: `${lead}, nothing${sub || " spent"}.`, figures: [] };
      return {
        ...base,
        sentence: `${lead}: ${rows.length} payment${rows.length === 1 ? "" : "s"}${sub}, ${money(total)} in all${prev.length ? ` (${prev.length} ${q.period.previous.label})` : ""}.`,
        figures: [
          { label: "Payments", value: String(rows.length) },
          { label: "Total", value: money(total) },
          { label: "Each, on average", value: money(total / rows.length) },
        ],
      };
    }
    case "biggest": {
      const top = [...rows].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, 3);
      if (top.length === 0) return { ...base, sentence: `${lead}, nothing${sub || " spent"}.`, figures: [] };
      const name = (r: Expense) => r.merchant_name?.trim() || "a payment";
      return {
        expenseIds: top.map((r) => r.id),
        seeTitle: `Biggest · ${q.period.label}`,
        sentence: `${lead}, the biggest${sub} was ${money(top[0].amount)} at ${name(top[0])} on ${shortDay(top[0].date)}.`,
        figures: top.map((r) => ({ label: `${name(r)} · ${shortDay(r.date)}`, value: money(r.amount) })),
      };
    }
    case "average": {
      const [sy, sm, sd] = q.period.start.split("-").map(Number);
      const [ey, em, ed] = q.period.end.split("-").map(Number);
      const days = Math.max(1, Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 864e5) + 1);
      return {
        ...base,
        sentence: `${lead}, about ${money(total / days)} a day${sub} (${money(total)} over ${days} day${days === 1 ? "" : "s"}).`,
        figures: [
          { label: "A day", value: money(total / days) },
          { label: "Per payment", value: rows.length ? money(total / rows.length) : "—" },
          { label: "Total", value: money(total) },
        ],
      };
    }
    case "budget_left": {
      const b = d.budget;
      // "this month", or the month asked about ("in October").
      const thisOne = q.period.end.slice(0, 7) === localMonth() ? "this month" : `in ${q.period.label.replace(/^1–\d+ /, "")}`;
      if (!b || b.budget <= 0) {
        return { ...base, sentence: `There's no budget set${sub} ${thisOne === "this month" ? "for this month" : thisOne}, so there's nothing to compare with. Spent: ${money(total)}.`, figures: [] };
      }
      const left = b.budget - b.spent;
      return {
        ...base,
        sentence:
          left >= 0
            ? `${money(left)} left${sub} ${thisOne}: ${money(b.spent)} spent of ${money(b.budget)}.`
            : `${money(-left)} over budget${sub} ${thisOne}: ${money(b.spent)} spent of ${money(b.budget)}.`,
        figures: [
          { label: "Budget", value: money(b.budget) },
          { label: "Spent", value: money(b.spent) },
          { label: left >= 0 ? "Left" : "Over", value: money(Math.abs(left)) },
        ],
      };
    }
    case "earned": {
      const e = d.earned;
      if (!e || e.cameIn <= 0) return { expenseIds: [], seeTitle, sentence: `Nothing came in ${q.period.label === "this month" ? "this month" : `in ${e?.months ?? q.period.label}`} so far.`, figures: [] };
      return {
        expenseIds: [],
        seeTitle,
        sentence: `${money(e.cameIn)} came in during ${e.months}${e.income > 0 ? `, ${money(e.income)} of it income` : ""}.`,
        figures: [
          { label: "Came in", value: money(e.cameIn) },
          ...(e.income > 0 ? [{ label: "Income", value: money(e.income) }] : []),
        ],
      };
    }
    case "top": {
      const groups = topGroups(rows, q.subject.kind === "category" ? "merchant" : "category", d.categories, 3);
      if (groups.length === 0) return { ...base, sentence: `${lead}, nothing${sub || " spent"}.`, figures: [] };
      const words = groups.map(([k, v]) => `${k} (${money(v)})`);
      return {
        ...base,
        sentence: `${lead}, ${money(total)}${sub}. Most went on ${words.slice(0, -1).join(", ")}${words.length > 1 ? " and " : ""}${words[words.length - 1]}.`,
        figures: groups.map(([k, v]) => ({ label: k, value: money(v) })),
      };
    }
    default: {
      if (rows.length === 0) return { ...base, sentence: `${lead}, nothing spent${sub}${prevTotal > 0 ? ` (${money(prevTotal)} ${q.period.previous.label})` : ""}.`, figures: [] };
      const groups = q.subject.kind === "merchant" ? [] : topGroups(rows, q.subject.kind === "category" ? "merchant" : "category", d.categories, 2);
      const most = groups.length ? ` Most of it went on ${groups.map(([k, v]) => `${k} (${money(v)})`).join(" and ")}.` : "";
      return {
        ...base,
        sentence: `${lead} you'd spent ${money(total)}${sub}${versus()}.${most}`.replace(/^(This month|Today|Yesterday|This week|Last week|The last \d+ \w+|This financial year|\d{4}( so far)?|Last financial year) you'd/, (_m, p: string) => `${p}, you've`),
        figures: [
          { label: q.period.label, value: money(total) },
          ...(prevTotal > 0 ? [{ label: q.period.previous.label, value: money(prevTotal) }] : []),
          { label: "Payments", value: String(rows.length) },
        ],
      };
    }
  }
}

/** When nothing in the question could be answered. */
export function cannotAnswer(): AskAnswer {
  return {
    sentence: "I couldn't work that one out. I can answer questions about your spending, budget and money in, for example:",
    figures: [],
    expenseIds: [],
    seeTitle: "",
    examples: EXAMPLE_QUESTIONS.slice(0, 4),
  };
}

/** What Arth knows your names as, for reading questions. */
export async function loadAskContext(userId: string = DEFAULT_USER_ID) {
  const [categories, merchants] = await Promise.all([getCategories(userId), getDistinctMerchantNames(userId).catch(() => [] as string[])]);
  return { categories, merchants };
}

/** Answer a question: read its data and compose the reply. */
export async function answerQuestion(q: AskQuestion, categories: Category[], userId: string = DEFAULT_USER_ID): Promise<AskAnswer> {
  const [rows, previousRows] = await Promise.all([
    getSpendingRows(userId, q.period.start, q.period.end),
    getSpendingRows(userId, q.period.previous.start, q.period.previous.end),
  ]);
  const data: AskData = { rows, previousRows, categories };
  const month = q.period.end.slice(0, 7);
  if (q.measure === "budget_left") {
    const today = q.period.end;
    const bva = await getBudgetVsActual(userId, month, month, `${month}-01`, today);
    if (q.subject.kind === "category") {
      const id = q.subject.id;
      const row = bva.rows.find((r) => r.categoryId === id);
      data.budget = row ? { budget: row.totalBudget, spent: row.totalActual } : null;
    } else if (q.subject.kind === "all") {
      // Everything spent, categorised or not: the Budget tab's figure (BudgetPeriodView).
      const all = await getSpendClassificationTotals(userId, `${month}-01`, today).catch(() => null);
      data.budget = { budget: bva.totalBudget, spent: Math.max(all?.total ?? 0, bva.totalActual) };
    } else {
      data.budget = null;
    }
  }
  if (q.measure === "earned") {
    const startMonth = q.period.start.slice(0, 7);
    const flow = await getCashFlow(userId, startMonth, month, month);
    const months = startMonth === month ? q.period.label.replace(/^1–\d+ /, "") : q.period.label;
    data.earned = { income: flow.income, cameIn: flow.cameIn, months: months === "this month" ? "this month" : months };
  }
  return composeAnswer(q, data);
}

/** The FY start for reading questions. */
export const askFyStart = () => getFYStartMonth();
