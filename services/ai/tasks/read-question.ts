/**
 * Ask Arth with on-device AI (docs/SPEED_AND_VOICE_PROPOSAL.md §2.3): when the rules
 * (services/ask/plan.ts) can't place a question, the model reads it into the same query plan.
 *
 * "Model proposes, code decides": the merchant must be one of the person's merchants or words in the
 * question, the category one of theirs, the period and measure from fixed lists. It never sees an
 * amount and never works one out: the answer is computed by code from the database.
 */
import { askNano, extractJsonObject } from "../nano";
import { MEASURES, PERIOD_KEYS, periodFrom, type AskContext, type AskMeasure, type AskPlan, type AskSubject } from "@/services/ask/plan";

export const QUESTION_TIMEOUT_MS = 4000;

const MEASURE_HELP = [
  "total: how much was spent",
  "count: how many times",
  "exists: did a payment ever happen (yes or no)",
  "merchants: which merchants or shops",
  "categories: which categories or where the money went",
  "biggest: the largest payments",
  "average: average spend",
  "by_month: month by month",
  "first: the first payment",
  "last: the latest payment",
  "budget_left: what's left in the budget",
  "earned: money that came in",
].join("; ");

export function buildQuestionPrompt(question: string, ctx: AskContext, previous: AskPlan | null): string {
  const merchants = ctx.merchants.slice(0, 80).join(" | ");
  const categories = ctx.categories.map((c) => c.name).join(" | ");
  return [
    "Someone asked a question about their own spending. Read it into a query. Reply with one JSON object and nothing else.",
    `"merchant": a shop or payee the question is about, from: ${merchants}. If it names one not in that list, give the name as said.`,
    `"category": one of: ${categories}.`,
    `"period": one of: ${PERIOD_KEYS.join(" | ")}, or a month name like "October". "all" means all time or ever.`,
    `"measure": one of: ${MEASURE_HELP}.`,
    "Leave out anything the question doesn't say.",
    previous ? `The previous question was: ${previous.said.slice(0, 160)}` : "",
    "",
    `Question: ${question.replace(/\s+/g, " ").trim().slice(0, 240)}`,
    "",
    "JSON:",
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
}

/**
 * Check the model's answer and turn it into a plan, filling what it left out from the previous
 * question (a follow-up) or the defaults. Null when nothing usable came back. Pure.
 */
export function checkQuestionAnswer(
  answer: string,
  question: string,
  ctx: AskContext,
  previous: AskPlan | null,
  now: Date = new Date(),
  fyStartMonth = 4,
): AskPlan | null {
  const obj = extractJsonObject(answer);
  if (!obj) return null;
  const said = question.toLowerCase();

  let subject: AskSubject | undefined;
  if (typeof obj.merchant === "string" && obj.merchant.trim()) {
    const want = obj.merchant.trim();
    const known = ctx.merchants.find((m) => m.toLowerCase() === want.toLowerCase());
    if (known) subject = { kind: "merchant", name: known, known: true };
    // A name not in Arth only when it's really in the question, so the model can't invent one.
    else if (want.length >= 3 && said.includes(want.toLowerCase())) subject = { kind: "merchant", name: want.replace(/\b[a-z]/g, (c) => c.toUpperCase()), known: false };
  }
  if (!subject && typeof obj.category === "string") {
    const cat = ctx.categories.find((c) => c.name.toLowerCase() === String(obj.category).trim().toLowerCase());
    if (cat) subject = { kind: "category", id: cat.id, name: cat.name };
  }

  const periodKey = typeof obj.period === "string" ? obj.period.trim() : "";
  // A key ("last_month", "all") or a month's name ("October").
  const period = periodKey ? periodFrom(periodKey.toLowerCase().replace(/\s+/g, "_"), now, fyStartMonth) ?? periodFrom(periodKey, now, fyStartMonth) : undefined;

  const m = typeof obj.measure === "string" ? obj.measure.trim().toLowerCase() : "";
  const measure = (MEASURES as string[]).includes(m) ? (m as AskMeasure) : undefined;

  if (!subject && !period && !measure) return null;
  return {
    period: period ?? previous?.period ?? (measure === "exists" || measure === "first" ? periodFrom("all", now, fyStartMonth)! : periodFrom("this_month", now, fyStartMonth)!),
    subject: subject ?? previous?.subject ?? { kind: "all" },
    measure: measure ?? previous?.measure ?? "total",
    said: question.trim(),
  };
}

/** Ask the model; null when it can't answer in time or the answer doesn't check out. */
export async function readQuestionWithNano(question: string, ctx: AskContext, previous: AskPlan | null, fyStartMonth = 4): Promise<AskPlan | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), QUESTION_TIMEOUT_MS);
  });
  try {
    const answer = await Promise.race([
      askNano(buildQuestionPrompt(question, ctx, previous), { maxOutputTokens: 80, timeoutMs: QUESTION_TIMEOUT_MS }),
      deadline,
    ]);
    return answer ? checkQuestionAnswer(answer.text, question, ctx, previous, new Date(), fyStartMonth) : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** PERIOD_KEYS, for tests and the "Read as" chip. */
export { PERIOD_KEYS };
