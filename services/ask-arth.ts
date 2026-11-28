/**
 * Ask Arth (docs/SPEED_AND_VOICE_PROPOSAL.md §2.3): a question in any words, answered in a
 * sentence with the working underneath.
 *
 *   1. Understand: rules (services/ask/plan.ts) read it into a plan: period, subject, measure.
 *      When words are left the rules can't place, on-device AI reads it into the same plan
 *      (services/ai/tasks/read-question.ts), checked by code. Neither sure: say so, with readings.
 *   2. Work it out in code from the same sums the screens use (getSpendingRows: approved spending,
 *      refunds taken off; getBudgetVsActual; getCashFlow). The AI never does arithmetic.
 *   3. Say it: a sentence, figures, a list or month bars, the transactions behind it, and the
 *      plan as "Read as" chips the person can change.
 *
 * `composeAnswer` is pure and tested; `askArth` and `answerPlan` read the database.
 */
import { DEFAULT_USER_ID } from "@/constants/app";
import { getSpendingRows } from "@/services/analytics/spending-rows";
import { getBudgetVsActual } from "@/services/budget";
import { getCashFlow } from "@/services/cash-flow";
import { getCategories, type Category } from "@/services/category";
import type { Expense } from "@/services/expense-types";
import { getDistinctMerchantNames } from "@/services/merchant-alias";
import { getFYStartMonth } from "@/services/settings";
import { getSpendClassificationTotals } from "@/services/spend-classification";
import { isAiJobOn } from "@/services/ai/ai-reading";
import { getNanoStatus } from "@/services/ai/nano";
import { readQuestionWithNano } from "@/services/ai/tasks/read-question";
import { periodFrom, readingChips, readQuestionRules, subjectLabel, type AskContext, type AskPlan, type AskSubject } from "@/services/ask/plan";
import { formatAmount } from "@/utils/format";
import { shortDay } from "@/utils/spoken-date";
import { matchCategory } from "@/utils/voice-parser";

export type { AskPlan } from "@/services/ask/plan";

export interface AskAnswer {
  sentence: string;
  figures: { label: string; value: string }[];
  /** Merchants or categories with amounts. */
  list?: { label: string; value: string }[];
  /** Month bars, oldest first. */
  bars?: { label: string; value: number }[];
  expenseIds: string[];
  seeTitle: string;
  /** The plan as chips ("Read as"); none when Arth wasn't sure. */
  reading?: ReturnType<typeof readingChips>;
  /** Not sure: questions it can answer, to tap. */
  examples?: string[];
  /** Follow-ups worth a tap. */
  suggestions?: string[];
}

export const EXAMPLE_QUESTIONS = [
  "What did I spend by day 15?",
  "How much on food this month?",
  "Did I ever pay Zomato?",
  "Which merchants in Shopping?",
  "Biggest payments this week",
  "What's left in my budget?",
  "Spending by month this year",
];

/** The data an answer is worked out from. */
export interface AskData {
  rows: Expense[];
  previousRows: Expense[];
  categories: Pick<Category, "id" | "name" | "parent_id">[];
  budget?: { budget: number; spent: number } | null;
  earned?: { income: number; cameIn: number; months: string } | null;
}

const money = (n: number) => formatAmount(Math.round(n));
const sum = (rows: Expense[]) => rows.reduce((s, r) => s + (r.amount ?? 0), 0);
const localMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Which rows a subject covers. A category includes its subcategories; a name not in Arth matches loosely. */
export function rowsFor(rows: Expense[], subject: AskSubject, categories: Pick<Category, "id" | "parent_id">[]): Expense[] {
  if (subject.kind === "all") return rows;
  if (subject.kind === "merchant" && subject.known) {
    const n = subject.name.toLowerCase();
    return rows.filter((r) => (r.merchant_name ?? "").toLowerCase() === n);
  }
  if (subject.kind === "merchant" || subject.kind === "text") {
    const w = (subject.kind === "merchant" ? subject.name : subject.words).toLowerCase().replace(/\s+/g, "");
    return rows.filter((r) => `${r.merchant_name ?? ""} ${r.description ?? ""}`.toLowerCase().replace(/\s+/g, "").includes(w));
  }
  const ids = new Set([subject.id, ...categories.filter((c) => c.parent_id === subject.id).map((c) => c.id)]);
  return rows.filter((r) => r.category_id != null && ids.has(r.category_id));
}

/** Totals by merchant or by top-level category, biggest first. */
function groups(rows: Expense[], by: "category" | "merchant", categories: Pick<Category, "id" | "name" | "parent_id">[]) {
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
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

function subjectWords(s: AskSubject): string {
  return s.kind === "all" ? "" : s.kind === "category" ? ` on ${s.name}` : s.kind === "text" ? ` mentioning “${s.words}”` : ` at ${s.name}`;
}

/** The period at the start of a sentence: "By 15 Nov", "This month", "In October", "In all". */
function lead(plan: AskPlan): string {
  const p = plan.period;
  if (p.allTime) return "In all";
  if (p.label.startsWith("1–")) return `By ${p.label.slice(2)}`;
  if (/^[A-Z][a-z]+( \d{4})?$/.test(p.label)) return `In ${p.label}`;
  return p.label[0].toUpperCase() + p.label.slice(1);
}
const inPeriod = (plan: AskPlan) => (plan.period.allTime ? "" : ` ${/^[A-Z]/.test(plan.period.label) ? `in ${plan.period.label}` : plan.period.label}`);

/** Follow-ups worth offering after this answer. */
function suggestionsFor(plan: AskPlan): string[] {
  const out: string[] = [];
  if (!plan.period.allTime) out.push("All time?");
  if (plan.period.label === "this month") out.push("And last month?");
  if (plan.measure !== "by_month") out.push("By month");
  if (plan.subject.kind === "category" && plan.measure !== "merchants") out.push("Which merchants?");
  if (plan.subject.kind === "all" && plan.measure === "total") out.push("Where did it go?");
  return out.slice(0, 3);
}

/** Work out the reply. Pure. */
export function composeAnswer(plan: AskPlan, d: AskData): AskAnswer {
  const rows = rowsFor(d.rows, plan.subject, d.categories);
  const prev = plan.period.previous ? rowsFor(d.previousRows, plan.subject, d.categories) : [];
  const total = sum(rows);
  const prevTotal = sum(prev);
  const L = lead(plan);
  const sub = subjectWords(plan.subject);
  const seeTitle = `${subjectLabel(plan.subject)} · ${plan.period.label}`;
  const base = { expenseIds: rows.map((r) => r.id), seeTitle, reading: readingChips(plan), suggestions: suggestionsFor(plan) };
  const nothing = (): AskAnswer => ({
    ...base,
    sentence: `${L}, no payments${sub}.`,
    figures: [],
  });

  switch (plan.measure) {
    case "exists": {
      if (rows.length === 0) {
        // Never paid them: say what was used instead, when the name points to a category ("Zomato" → Food).
        let instead = "";
        if (plan.subject.kind === "merchant" && !plan.subject.known) {
          const catName = matchCategory(plan.subject.name, d.categories.map((c) => c.name));
          const cat = catName ? d.categories.find((c) => c.name === catName) : undefined;
          if (cat) {
            const g = groups(rowsFor(d.rows, { kind: "category", id: cat.id, name: cat.name }, d.categories), "merchant", d.categories);
            if (g.length > 0) instead = ` For ${cat.name} you've paid ${g[0][0]} (${money(g[0][1])}${plan.period.allTime ? " in all" : ""}).`;
          }
        }
        return { ...base, sentence: `No, there's no payment${sub}${plan.period.allTime ? " in Arth" : inPeriod(plan)}.${instead}`, figures: [] };
      }
      const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
      return {
        ...base,
        sentence: `Yes: ${rows.length} payment${rows.length === 1 ? "" : "s"}${sub}${inPeriod(plan)}, ${money(total)} in all. The last was ${shortDay(sorted[sorted.length - 1].date)}.`,
        figures: [
          { label: "Payments", value: String(rows.length) },
          { label: "Total", value: money(total) },
          { label: "First", value: shortDay(sorted[0].date) },
        ],
      };
    }
    case "merchants":
    case "categories": {
      const by = plan.measure === "merchants" ? "merchant" : "category";
      const g = groups(rows, by, d.categories);
      if (g.length === 0) return nothing();
      const noun = by === "merchant" ? "merchant" : "categor";
      const plural = by === "merchant" ? (g.length === 1 ? "merchant" : "merchants") : g.length === 1 ? "category" : "categories";
      return {
        ...base,
        sentence:
          by === "merchant"
            ? `${g.length} ${plural}${sub}${inPeriod(plan)}, ${money(total)} in all. ${g[0][0]} is the biggest at ${money(g[0][1])}.`
            : `${L}, ${money(total)}${sub}. Most went on ${g.slice(0, 3).map(([k, v]) => `${k} (${money(v)})`).join(", ")}.`,
        figures: [],
        list: g.map(([k, v]) => ({ label: k, value: money(v) })),
        seeTitle: `${noun === "merchant" ? "Merchants" : "Categories"} · ${plan.period.label}`,
      };
    }
    case "by_month": {
      if (rows.length === 0) return nothing();
      const byMonth = new Map<string, number>();
      for (const r of rows) byMonth.set(r.date.slice(0, 7), (byMonth.get(r.date.slice(0, 7)) ?? 0) + (r.amount ?? 0));
      const months = [...byMonth.keys()].sort();
      // Every month between the first and the last, so a month with nothing shows as a gap.
      const all: string[] = [];
      let [y, m] = months[0].split("-").map(Number);
      const last = months[months.length - 1];
      while (all.length < 240) {
        const key = `${y}-${String(m).padStart(2, "0")}`;
        all.push(key);
        if (key >= last) break;
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }
      const bars = all.slice(-24).map((k) => ({ label: MONTHS[Number(k.slice(5)) - 1], value: byMonth.get(k) ?? 0 }));
      const peak = all.reduce((a, b) => ((byMonth.get(b) ?? 0) > (byMonth.get(a) ?? 0) ? b : a));
      return {
        ...base,
        sentence: `${L}, ${money(total)}${sub} across ${all.length} month${all.length === 1 ? "" : "s"}. The biggest was ${MONTHS[Number(peak.slice(5)) - 1]} ${peak.slice(0, 4)}, at ${money(byMonth.get(peak) ?? 0)}.`,
        figures: [
          { label: "Payments", value: String(rows.length) },
          { label: "A month, on average", value: money(total / all.length) },
        ],
        bars,
      };
    }
    case "first":
    case "last": {
      if (rows.length === 0) return nothing();
      const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
      const r = plan.measure === "first" ? sorted[0] : sorted[sorted.length - 1];
      return {
        ...base,
        expenseIds: [r.id],
        sentence: `The ${plan.measure} payment${sub}${inPeriod(plan)} was ${money(r.amount)}${r.merchant_name && plan.subject.kind !== "merchant" ? ` at ${r.merchant_name}` : ""} on ${shortDay(r.date)} ${r.date.slice(0, 4)}.`,
        figures: [],
      };
    }
    case "count": {
      if (rows.length === 0) return nothing();
      return {
        ...base,
        sentence: `${L}: ${rows.length} payment${rows.length === 1 ? "" : "s"}${sub}, ${money(total)} in all${prev.length ? ` (${prev.length} ${plan.period.previous!.label})` : ""}.`,
        figures: [
          { label: "Payments", value: String(rows.length) },
          { label: "Total", value: money(total) },
          { label: "Each, on average", value: money(total / rows.length) },
        ],
      };
    }
    case "biggest": {
      const top = [...rows].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, 5);
      if (top.length === 0) return nothing();
      const name = (r: Expense) => r.merchant_name?.trim() || "a payment";
      return {
        ...base,
        expenseIds: top.map((r) => r.id),
        sentence: `${L}, the biggest${sub} was ${money(top[0].amount)} at ${name(top[0])} on ${shortDay(top[0].date)}.`,
        figures: [],
        list: top.map((r) => ({ label: `${name(r)} · ${shortDay(r.date)}`, value: money(r.amount) })),
      };
    }
    case "average": {
      if (rows.length === 0) return nothing();
      const [sy, sm, sd] = (plan.period.allTime && rows.length ? [...rows].sort((a, b) => a.date.localeCompare(b.date))[0].date : plan.period.start).split("-").map(Number);
      const [ey, em, ed] = plan.period.end.split("-").map(Number);
      const days = Math.max(1, Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 864e5) + 1);
      return {
        ...base,
        sentence: `${L}, about ${money(total / days)} a day${sub} (${money(total)} over ${days} day${days === 1 ? "" : "s"}).`,
        figures: [
          { label: "A day", value: money(total / days) },
          { label: "Per payment", value: rows.length ? money(total / rows.length) : "—" },
        ],
      };
    }
    case "budget_left": {
      const b = d.budget;
      const when = plan.period.end.slice(0, 7) === localMonth() ? "this month" : `in ${plan.period.label.replace(/^1–\d+ /, "")}`;
      const monthSpent = sum(rows.filter((r) => r.date.startsWith(plan.period.end.slice(0, 7))));
      if (!b || b.budget <= 0) return { ...base, sentence: `There's no budget set${sub} ${when === "this month" ? "for this month" : when}. Spent: ${money(monthSpent)}.`, figures: [] };
      const left = b.budget - b.spent;
      return {
        ...base,
        sentence:
          left >= 0
            ? `${money(left)} left${sub} ${when}: ${money(b.spent)} spent of ${money(b.budget)}.`
            : `${money(-left)} over budget${sub} ${when}: ${money(b.spent)} spent of ${money(b.budget)}.`,
        figures: [
          { label: "Budget", value: money(b.budget) },
          { label: "Spent", value: money(b.spent) },
          { label: left >= 0 ? "Left" : "Over", value: money(Math.abs(left)) },
        ],
      };
    }
    case "earned": {
      const e = d.earned;
      if (!e || e.cameIn <= 0) return { ...base, expenseIds: [], sentence: `Nothing came in ${e?.months ?? plan.period.label}.`, figures: [] };
      return {
        ...base,
        expenseIds: [],
        sentence: `${money(e.cameIn)} came in during ${e.months}${e.income > 0 ? `, ${money(e.income)} of it income` : ""}.`,
        figures: [{ label: "Came in", value: money(e.cameIn) }, ...(e.income > 0 ? [{ label: "Income", value: money(e.income) }] : [])],
      };
    }
    default: {
      if (rows.length === 0) {
        return {
          ...base,
          sentence: `${L}, nothing spent${sub}${prevTotal > 0 ? ` (${money(prevTotal)} ${plan.period.previous!.label})` : ""}.`,
          figures: [],
        };
      }
      const diff = total - prevTotal;
      const versus = prevTotal > 0 ? (Math.abs(diff) < 1 ? `, the same as ${plan.period.previous!.label}` : `, ${money(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than ${plan.period.previous!.label}`) : "";
      const g = plan.subject.kind === "merchant" ? [] : groups(rows, plan.subject.kind === "category" ? "merchant" : "category", d.categories).slice(0, 2);
      const most = g.length ? ` Most of it went on ${g.map(([k, v]) => `${k} (${money(v)})`).join(" and ")}.` : "";
      const opener = plan.period.allTime ? `In all, you've spent ${money(total)}${sub} across ${rows.length} payment${rows.length === 1 ? "" : "s"}` : /^(By|In) /.test(L) ? `${L} you'd spent ${money(total)}${sub}` : `${L}, you've spent ${money(total)}${sub}`;
      return {
        ...base,
        sentence: `${opener}${versus}.${most}`,
        figures: [
          { label: plan.period.allTime ? "All time" : plan.period.label, value: money(total) },
          ...(prevTotal > 0 ? [{ label: plan.period.previous!.label, value: money(prevTotal) }] : []),
          { label: "Payments", value: String(rows.length) },
        ],
      };
    }
  }
}

/** When Arth can't work a question out: say so, with questions it can answer. */
export function notSure(said: string): AskAnswer {
  const words = said.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  return {
    sentence: "I'm not sure what you're asking. Try one of these, or ask it another way:",
    figures: [],
    expenseIds: [],
    seeTitle: "",
    examples: [...(words[0] ? [`Payments mentioning “${words[words.length - 1]}”`] : []), ...EXAMPLE_QUESTIONS.slice(0, 3)],
  };
}

export async function loadAskContext(userId: string = DEFAULT_USER_ID): Promise<AskContext & { categories: Category[] }> {
  const [categories, merchants] = await Promise.all([getCategories(userId), getDistinctMerchantNames(userId).catch(() => [] as string[])]);
  return { categories, merchants };
}

/** Work out the answer for a plan: read its data, then compose. */
export async function answerPlan(plan: AskPlan, categories: Category[], userId: string = DEFAULT_USER_ID): Promise<AskAnswer> {
  const [rows, previousRows] = await Promise.all([
    getSpendingRows(userId, plan.period.start, plan.period.end),
    plan.period.previous ? getSpendingRows(userId, plan.period.previous.start, plan.period.previous.end) : Promise.resolve([] as Expense[]),
  ]);
  const data: AskData = { rows, previousRows, categories };
  const month = plan.period.end.slice(0, 7);
  if (plan.measure === "budget_left") {
    const bva = await getBudgetVsActual(userId, month, month, `${month}-01`, plan.period.end);
    if (plan.subject.kind === "category") {
      const id = plan.subject.id;
      const row = bva.rows.find((r) => r.categoryId === id);
      data.budget = row ? { budget: row.totalBudget, spent: row.totalActual } : null;
    } else if (plan.subject.kind === "all") {
      // Everything spent, categorised or not: the Budget tab's figure.
      const all = await getSpendClassificationTotals(userId, `${month}-01`, plan.period.end).catch(() => null);
      data.budget = { budget: bva.totalBudget, spent: Math.max(all?.total ?? 0, bva.totalActual) };
    } else data.budget = null;
  }
  if (plan.measure === "earned") {
    const startMonth = plan.period.allTime ? month : plan.period.start.slice(0, 7);
    const flow = await getCashFlow(userId, startMonth, month, month);
    // Money in comes by whole months: a period inside one month is named as that month.
    const monthName = month === localMonth() ? "this month" : `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
    data.earned = { income: flow.income, cameIn: flow.cameIn, months: plan.period.allTime || startMonth === month ? monthName : plan.period.label };
  }
  return composeAnswer(plan, data);
}

/**
 * Ask a question: rules first; when they aren't sure, on-device AI; when neither is, say so.
 * Returns the plan used (for the next follow-up and the "Read as" chips) and the answer.
 */
export async function askArth(
  said: string,
  ctx: AskContext & { categories: Category[] },
  previous: AskPlan | null,
): Promise<{ plan: AskPlan | null; answer: AskAnswer }> {
  const fy = getFYStartMonth();
  const rules = readQuestionRules(said, ctx, previous, new Date(), fy);
  let plan = rules.plan;
  if (!rules.sure && isAiJobOn("voice") && (await getNanoStatus().catch(() => "unavailable")) === "available") {
    const ai = await readQuestionWithNano(said, ctx, previous, fy);
    if (ai) plan = ai;
  }
  if (!plan) {
    // A word Arth can look for in payments ("wedding") is still worth offering.
    return { plan: null, answer: notSure(said) };
  }
  return { plan, answer: await answerPlan(plan, ctx.categories) };
}

/** Change one part of a plan from the "Read as" chips. */
export function withPeriod(plan: AskPlan, key: string): AskPlan {
  const p = periodFrom(key, new Date(), getFYStartMonth());
  return p ? { ...plan, period: p } : plan;
}
