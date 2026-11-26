/**
 * What a payment really was (docs/ON_DEVICE_AI_PHASE2_PROPOSAL.md, job 4): for messages the
 * patterns already read, where Arth's own detectors (SIP, FD, money events, loan EMI match) said
 * nothing but the message has a word that hints at more (mandate, EMI, SIP, card...), on-device
 * AI says whether it was an autopay, an EMI, a SIP or a card bill payment.
 *
 * The answer is checked against the message and shown in Catch Up as one suggestion that opens an
 * action that already exists (a reminder, the loan link, the investment link, the transfer).
 * Nothing changes until the person taps it.
 */

import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { askNano, extractJsonObject } from "../nano";
import { failAiJob, finishAiJob, queuedAiJobs } from "../jobs";

/** Words that hint a payment is more than a spend. Without one, nothing is asked. */
export const CONTEXT_HINTS =
  /\b(?:mandate|nach|ecs|auto-?pay|auto-?debit|standing instruction|si\b|recurring|subscription|emi|loan|sip|mutual fund|systematic|folio|credit card|card (?:bill|payment|dues)|insurance|premium)\b/i;
const AUTO_WORDS = /auto-?pay|auto-?debit|e-?mandate|\bmandate\b|\bnach\b|\becs\b|standing instruction|\brecurring\b|\bsubscription\b|\bSI\b/i;

export type ContextEvent = "autopay" | "loan_emi" | "sip" | "card_payment";

export interface PaymentContext {
  event: ContextEvent;
  /** The fund, loan or policy name, as written in the message. */
  scheme: string | null;
}

/** Is this payment worth asking about? Pure. */
export function worthAsking(body: string | null, moneyEvent: string | null): boolean {
  return !!body && !moneyEvent && CONTEXT_HINTS.test(body);
}

export function buildContextPrompt(body: string, hasLoan: boolean): string {
  const lines = [
    "You read Indian bank SMS. Say what this debit was. Reply with one JSON object and nothing else.",
    '"event": "loan_emi" for a loan instalment, "sip" for money into a mutual fund or SIP,',
    '"card_payment" for paying a credit card bill, "autopay" for any other automatic or recurring',
    'charge (mandate, NACH, ECS, standing instruction, subscription), or "none".',
    '"scheme": the fund, loan or policy name as written, or leave it out.',
  ];
  if (!hasLoan) lines.push("The user has no loans in Arth.");
  lines.push("", `SMS: ${body.replace(/\s+/g, " ").trim().slice(0, 600)}`, "", "JSON:");
  return lines.join("\n");
}

const EVENT_WORDS: Record<ContextEvent, RegExp> = {
  autopay: AUTO_WORDS,
  loan_emi: /\b(?:emi|loan|instal?ment)\b/i,
  sip: /\b(?:sip|mutual fund|systematic|folio|amc|nav)\b/i,
  card_payment: /\b(?:credit card|card (?:bill|payment|dues)|cc payment)\b/i,
};

/** Read and check the answer. Pure. Null when there's nothing to suggest. */
export function checkContextAnswer(answer: string, body: string, hasLoan: boolean): PaymentContext | null {
  const obj = extractJsonObject(answer);
  const event = String(obj?.event ?? "").toLowerCase() as ContextEvent;
  if (!(event in EVENT_WORDS)) return null;
  // The message must say it in its own words: the model only picks which.
  if (!EVENT_WORDS[event].test(body)) return null;
  if (event === "loan_emi" && !hasLoan) return null;
  let scheme: string | null = null;
  if (typeof obj?.scheme === "string" && obj.scheme.trim()) {
    const words = obj.scheme.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    if (words.length > 0 && words.every((w) => body.toLowerCase().includes(w))) scheme = obj.scheme.trim().slice(0, 80);
  }
  return { event, scheme };
}

/** Runner handler. */
export async function runContextJobs(h: { shouldStop: () => boolean; untilActive: () => Promise<void> }): Promise<number> {
  const jobs = await queuedAiJobs("context", 20);
  if (jobs.length === 0) return 0;
  const db = getDatabase();
  const loans = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM financial_accounts WHERE user_id = ? AND account_type = 'loan' AND is_active = 1;`,
    DEFAULT_USER_ID,
  );
  const hasLoan = (loans?.n ?? 0) > 0;
  let made = 0;
  for (const job of jobs) {
    if (h.shouldStop()) break;
    await h.untilActive();
    const e = await db.getFirstAsync<{ raw_source_text: string | null; money_event: string | null; status: string }>(
      `SELECT raw_source_text, money_event, status FROM expenses WHERE id = ? AND deleted_at IS NULL;`,
      job.ref_id,
    );
    if (!e || !worthAsking(e.raw_source_text, e.money_event) || e.status === "rejected") {
      await finishAiJob(job.id, null);
      continue;
    }
    try {
      const answer = await askNano(buildContextPrompt(e.raw_source_text!, hasLoan), { maxOutputTokens: 40 });
      const ctx = checkContextAnswer(answer.text, e.raw_source_text!, hasLoan);
      await finishAiJob(job.id, ctx);
      if (ctx) made++;
    } catch {
      await failAiJob(job);
      break;
    }
  }
  return made;
}

/** The Catch Up suggestion for a context: what it says, and which transaction-screen action it opens. */
export function contextAction(c: PaymentContext): { label: string; act: "recurring" | "loan" | "invest" | "transfer" } {
  switch (c.event) {
    case "loan_emi":
      return { label: `Looks like an EMI${c.scheme ? ` for ${c.scheme}` : ""} · Link it to the loan`, act: "loan" };
    case "sip":
      return { label: `Looks like a SIP${c.scheme ? ` into ${c.scheme}` : ""} · Link it to an investment`, act: "invest" };
    case "card_payment":
      return { label: "Looks like a card bill payment · Count it as a transfer", act: "transfer" };
    default:
      return { label: "Looks like an autopay · Add a reminder for it", act: "recurring" };
  }
}
