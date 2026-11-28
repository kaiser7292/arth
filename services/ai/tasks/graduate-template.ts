/**
 * AI-read formats become templates (docs/ON_DEVICE_AI_PHASE2_PROPOSAL.md, job 3). After the
 * person approves the second message on-device AI read in the same format (same sender, same
 * opening words), Arth drafts a template from the two and offers it: "Read these automatically
 * from now on?" Accepted, the template reads that format at once, without the AI, also on phones
 * without it and after a restore.
 *
 * No model call: the AI's approved readings already say what each value is. guessSpans places the
 * parts it recognises; the approved amount (and merchant) fill in what it left. The draft is kept
 * only if it compiles and reads BOTH messages with the approved amounts.
 */

import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { compileTemplate, type TaggedSpan } from "@/services/sms/template-compiler";
import { normalizeSms } from "@/services/sms/sms-normalize";
import { formatKey, formatLabel, guessSpans, senderCode } from "@/services/sms/template-guess";
import { createUserTemplate, listUserTemplates, type UserTxType } from "@/services/sms/user-sms-templates";
import { identifyBank } from "@/services/sms/bank-senders";
import { logger } from "@/utils/logger";
import { isAiJobOn } from "../ai-reading";
import { aiSuggestions, answerAiJob, putAiJobResult } from "../jobs";

/** Approved AI reads in one format before Arth offers a template. */
export const READS_TO_LEARN = 2;

export interface TemplateOffer {
  address: string;
  bank: string;
  kind: UserTxType;
  sample: string;
  extra: string;
  spans: TaggedSpan[];
  extraSpans: TaggedSpan[];
  pattern: string;
  /** "HDFC · Rs 0 spent on card" */
  label: string;
}

interface AiRead {
  id: string;
  amount: number;
  nature: string;
  merchant: string | null;
  address: string;
  body: string;
}

/** Where `amount` is written in the body ("1,250.50" for 1250.5), or null. Pure. */
export function amountSpan(body: string, amount: number): TaggedSpan | null {
  for (const m of body.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    if (Math.abs(Number(m[0].replace(/,/g, "")) - amount) < 0.005) {
      return { field: "amount", start: m.index ?? 0, end: (m.index ?? 0) + m[0].length };
    }
  }
  return null;
}

/** Spans for one approved read: the guesser's, with the approved amount and merchant made sure of. Pure. */
export function spansFor(read: Pick<AiRead, "body" | "amount" | "merchant">, other: string): TaggedSpan[] {
  let spans = guessSpans(read.body, [other]).filter((s) => s.field !== "amount");
  const amt = amountSpan(read.body, read.amount);
  if (!amt) return [];
  const overlaps = (a: TaggedSpan) => spans.some((s) => a.start < s.end && a.end > s.start);
  spans = spans.filter((s) => !(amt.start < s.end && amt.end > s.start));
  spans.push(amt);
  if (read.merchant && !spans.some((s) => s.field === "merchant")) {
    const at = read.body.toLowerCase().indexOf(read.merchant.toLowerCase());
    const m: TaggedSpan = { field: "merchant", start: at, end: at + read.merchant.length };
    if (at >= 0 && !overlaps(m)) spans.push(m);
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** Draft from two approved reads of one format. Null when it doesn't read both correctly. Pure. */
export function draftTemplate(a: AiRead, b: AiRead): TemplateOffer | null {
  const spans = spansFor(a, b.body);
  if (spans.length === 0) return null;
  const compiled = compileTemplate({ smsBody: a.body, spans, style: "flexible" });
  if (!compiled.ok) return null;
  const rx = new RegExp(compiled.patternRegex, "i");
  // It must read both messages, each with its own approved amount. Templates match the normalised
  // message (sms-normalize.ts), as the scan and the backlog do.
  for (const r of [a, b]) {
    const m = rx.exec(normalizeSms(r.body).text);
    const got = m?.groups?.amount ?? null;
    if (!m || got == null || Math.abs(Number(got.replace(/,/g, "")) - r.amount) >= 0.005) return null;
  }
  const extraSpans = spansFor(b, a.body);
  const code = senderCode(a.address);
  const bank = identifyBank(a.address)?.bank ?? code;
  const kind: UserTxType = a.nature === "credit" && b.nature === "credit" ? "credit" : a.nature === "realized" && b.nature === "realized" ? "debit" : "auto";
  return {
    address: a.address,
    bank,
    kind,
    sample: a.body,
    extra: b.body,
    spans,
    extraSpans,
    pattern: compiled.patternRegex,
    label: `${bank} · ${formatLabel(a.body)}`,
  };
}

async function approvedAiReads(): Promise<AiRead[]> {
  return getDatabase().getAllAsync<AiRead>(
    `SELECT e.id, e.amount, e.nature, COALESCE(e.raw_merchant_name, e.merchant_name) AS merchant, p.address, p.body
       FROM expenses e JOIN pending_sms p ON p.expense_id = e.id
      WHERE e.user_id = ? AND e.parse_source = 'ai' AND e.status = 'approved' AND e.deleted_at IS NULL
      ORDER BY e.date DESC LIMIT 300;`,
    DEFAULT_USER_ID,
  );
}

/** After approving: offer a template for any format that now has enough approved AI reads. */
export async function considerGraduating(approvedIds: string[]): Promise<number> {
  if (!isAiJobOn("template") || approvedIds.length === 0) return 0;
  const reads = await approvedAiReads();
  const touched = new Set(approvedIds);
  const byKey = new Map<string, AiRead[]>();
  for (const r of reads) {
    const k = formatKey(r.address, r.body);
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  // A format a template already reads needs no offer.
  const templates = await listUserTemplates().catch(() => []);
  let offered = 0;
  for (const [key, group] of byKey) {
    if (group.length < READS_TO_LEARN || !group.some((r) => touched.has(r.id))) continue;
    if (templates.some((t) => t.pattern_regex && new RegExp(t.pattern_regex, "i").test(normalizeSms(group[0].body).text))) continue;
    const draft = draftTemplate(group[0], group[1]);
    if (!draft) continue;
    await putAiJobResult("template", key, draft);
    offered++;
  }
  return offered;
}

export async function templateOffers(): Promise<Map<string, TemplateOffer>> {
  return aiSuggestions<TemplateOffer>("template");
}

/** "Yes, read them automatically": save the template, then let it read what's waiting. */
export async function acceptTemplateOffer(key: string, offer: TemplateOffer): Promise<{ read: number }> {
  const t = await createUserTemplate({
    bankName: offer.bank,
    txType: offer.kind,
    sampleSms: offer.sample,
    spans: offer.spans,
    label: offer.label.slice(0, 60),
    senderPattern: senderCode(offer.address),
    senderMatchMode: "code",
    matchStyle: "flexible",
    extraSamples: offer.extraSpans.length ? [{ body: offer.extra, spans: offer.extraSpans }] : [],
  });
  await answerAiJob("template", key, "accepted");
  let read = 0;
  try {
    const { applyTemplateToBacklog } = await import("@/services/sms/template-backlog");
    read = await applyTemplateToBacklog({
      id: t.id,
      patternRegex: t.pattern_regex,
      txType: t.tx_type,
      bankName: t.bank_name,
      senderMatchMode: t.sender_match_mode,
      senderPattern: t.sender_pattern,
    });
  } catch (e) {
    logger.warn("Template from AI reads: reading the backlog failed (non-fatal)", e);
  }
  return { read };
}

export async function dismissTemplateOffer(key: string): Promise<void> {
  await answerAiJob("template", key, "dismissed");
}
