/**
 * Guessing a template for the user, so teaching Arth a message is usually one "Looks right".
 *
 * Three sources, strongest first:
 *  1. What the user taught before: in their saved templates, the words right before each field
 *     ("avl bal" -> balance, "info: upi/" -> merchant). Reused on new senders.
 *  2. Shape rules: amounts next to money words (not the balance), balances after "Bal" (or a
 *     card's "Avl limit"), masked
 *     account digits, dates (spaces allowed), merchants after at / to / towards / Info / VPA,
 *     references, the other account, the other party's name.
 *  3. Other messages in the same format: parts that change between them are fields. Used to find
 *     the merchant when nothing else did.
 *
 * Pure apart from the inputs passed in - no database here. Used by the confirmation screen
 * (app/settings/sms-templates/confirm.tsx).
 */

import { autoTag, type TaggedField, type TaggedSpan } from "./template-compiler";
import { parseSamples, type UserSmsTemplate } from "./user-sms-templates";

// ── Formats ──

/** DLT sender code ("VM-HDFCBK-S" -> "HDFCBK"). */
export function senderCode(address: string): string {
  return address.toUpperCase().match(/[A-Z]{4,}/)?.[0] ?? address.toUpperCase();
}

/** Same sender and same opening words (numbers aside) = same format. */
export function formatKey(address: string, body: string): string {
  const opening = body.replace(/\d+/g, "0").toLowerCase().split(/\s+/).slice(0, 4).join(" ");
  return `${senderCode(address)}|${opening}`;
}

/** A short readable label for a format: its opening words with the numbers taken out. */
export function formatLabel(body: string): string {
  const words = body.replace(/[\d,]+(?:\.\d+)?/g, "…").split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  return words.length > 48 ? `${words.slice(0, 47)}…` : words;
}

export interface MessageLike {
  id: string;
  address: string;
  body: string;
  sms_date: number;
}

export interface FormatGroup<M extends MessageLike = MessageLike> {
  key: string;
  sender: string;
  label: string;
  /** Newest first. */
  messages: M[];
}

export function groupByFormat<M extends MessageLike>(rows: M[]): FormatGroup<M>[] {
  const map = new Map<string, M[]>();
  for (const r of rows) {
    const k = formatKey(r.address, r.body);
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return [...map.entries()]
    .map(([key, msgs]) => {
      const messages = [...msgs].sort((a, b) => b.sms_date - a.sms_date);
      return { key, sender: senderCode(messages[0].address), label: formatLabel(messages[0].body), messages };
    })
    .sort((a, b) => b.messages.length - a.messages.length || b.messages[0].sms_date - a.messages[0].sms_date);
}

// ── Shapes ──

const NUM = String.raw`\d[\d,]*(?:\s*,\s*\d+)*(?:\s*\.\s*\d{1,2})?`;
const DATE = String.raw`(?:\d{4}\s*-\s*\d{1,2}\s*-\s*\d{1,2}|\d{1,2}\s*[-/.]\s*(?:[A-Za-z]{3}|\d{1,2})\s*[-/.]\s*\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3}\s+\d{2,4}|\d{1,2}[A-Za-z]{3}\d{2,4})`;
const MONEY_WORD = String.raw`(?:debited|credited|spent|paid|sent|received|withdrawn|transferred|deposited|charged|refunded|txn\s+of|transaction\s+of|purchase\s+of)`;
const STOP = String.raw`(?=\s*(?:/|\bon\b|\bref\b|\bavl\b|\bbal\b|\bvia\b|\bfrom\b|\bfor\b|\busing\b|\.\s|\.$|,|\(|$))`;

function spanOf(body: string, field: TaggedField, re: RegExp, group = 1): TaggedSpan | null {
  const m = re.exec(body);
  if (!m || m[group] == null) return null;
  const value = m[group].replace(/\s+$/, "");
  if (!value) return null;
  const start = m.index + m[0].indexOf(m[group]);
  return { field, start, end: start + value.length };
}

/** The transaction amount: next to a money word, or the first currency amount that isn't a balance or limit. */
function guessAmount(body: string): TaggedSpan | null {
  const near =
    spanOf(body, "amount", new RegExp(String.raw`${MONEY_WORD}\s*(?:by|of|for|with|:)?\s*(?:rs\.?|inr|₹)\s*(${NUM})`, "i")) ??
    spanOf(body, "amount", new RegExp(String.raw`(?:rs\.?|inr|₹)\s*(${NUM})\s*(?:has\s+been\s+|is\s+|was\s+)?${MONEY_WORD}`, "i"));
  if (near) return near;
  const re = new RegExp(String.raw`(?:rs\.?|inr|₹)\s*(${NUM})`, "gi");
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const before = body.slice(Math.max(0, m.index - 18), m.index).toLowerCase();
    if (/\b(bal|balance|limit|avl|available)\b/.test(before)) continue;
    const start = m.index + m[0].indexOf(m[1]);
    return { field: "amount", start, end: start + m[1].length };
  }
  return null;
}

function guessMerchant(body: string): TaggedSpan | null {
  const re = new RegExp(
    String.raw`(?:\bat\s+|\btowards\s+|\bto\s+(?:vpa\s+)?|\binfo:?\s*(?:upi/)?|\bvpa\s+|\bupi/(?:p2[am]/)?(?:\d+/)?)([A-Za-z][A-Za-z0-9 &.'*\-@]{1,40}?)${STOP}`,
    "gi",
  );
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const v = m[1].trim();
    // "to A/c xx1234", "to your account", "at 10:42" aren't merchants.
    if (/^(a\/?c|acct|account|your|you|mobile|card|the|bank)\b/i.test(v)) continue;
    const start = m.index + m[0].indexOf(m[1]);
    return { field: "merchant", start, end: start + v.length };
  }
  return null;
}

// ── Learned from the user's templates ──

interface Hint {
  field: TaggedField;
  /** The one or two lower-cased words right before the field in a saved example. */
  before: string;
}

export function learnHints(templates: UserSmsTemplate[]): Hint[] {
  const hints: Hint[] = [];
  const seen = new Set<string>();
  for (const t of templates) {
    for (const sample of parseSamples(t.samples ?? null)) {
      for (const s of sample.spans) {
        const words = sample.body.slice(0, s.start).trim().split(/\s+/).slice(-2).join(" ").toLowerCase();
        const before = words.replace(/[^a-z/:. ]/g, "").trim();
        if (before.length < 3) continue;
        const key = `${s.field}|${before}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hints.push({ field: s.field, before });
      }
    }
  }
  return hints;
}

const FIELD_SHAPE: Partial<Record<TaggedField, string>> = {
  amount: NUM,
  balance: NUM,
  account: String.raw`\d{3,6}`,
  date: DATE,
  merchant: String.raw`[A-Za-z][A-Za-z0-9 &.'*\-@]{1,40}?${STOP}`,
  ref: String.raw`[A-Za-z0-9]{6,}`,
};

function fromHints(body: string, hints: Hint[], have: Set<TaggedField>): TaggedSpan[] {
  const out: TaggedSpan[] = [];
  for (const h of hints) {
    if (have.has(h.field)) continue;
    const shape = FIELD_SHAPE[h.field];
    if (!shape) continue;
    const escaped = h.before.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&").replace(/\s+/g, String.raw`\s+`);
    const re = new RegExp(String.raw`${escaped}\s*(?:rs\.?|inr|₹|x+|\*+)?\s*(${shape})`, "i");
    const s = spanOf(body, h.field, re);
    if (s) {
      out.push(s);
      have.add(h.field);
    }
  }
  return out;
}

// ── From other messages in the same format ──

/** Character ranges of `a` whose words don't appear in order in `b` - the parts that change. */
export function changingParts(a: string, b: string): { start: number; end: number }[] {
  const tok = (s: string) => {
    const out: { w: string; start: number; end: number }[] = [];
    const re = /\S+/g;
    for (let m = re.exec(s); m; m = re.exec(s)) out.push({ w: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
    return out;
  };
  const ta = tok(a);
  const tb = tok(b);
  const n = ta.length;
  const m = tb.length;
  // Longest common subsequence of words.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = ta[i].w === tb[j].w ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const common = new Array(n).fill(false);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (ta[i].w === tb[j].w) {
      common[i] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const parts: { start: number; end: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (common[i]) continue;
    const last = parts[parts.length - 1];
    if (last && i > 0 && !common[i - 1]) last.end = ta[i].end;
    else parts.push({ start: ta[i].start, end: ta[i].end });
  }
  return parts;
}

function merchantFromChanges(body: string, others: string[], taken: TaggedSpan[]): TaggedSpan | null {
  for (const other of others.slice(0, 3)) {
    for (const p of changingParts(body, other)) {
      const text = body.slice(p.start, p.end);
      // A changing run of words that isn't a number, a date or an already-tagged field.
      const word = text.match(/[A-Za-z][A-Za-z0-9 &.'*\-]{1,40}/);
      if (!word || /^(rs|inr|on|at|to|ref|avl|bal)$/i.test(word[0].trim())) continue;
      const start = p.start + (word.index ?? 0);
      const end = start + word[0].trim().replace(/[.,/]+$/, "").length;
      if (end - start < 2) continue;
      if (taken.some((t) => !(end <= t.start || start >= t.end))) continue;
      return { field: "merchant", start, end };
    }
  }
  return null;
}

// ── All together ──

/**
 * Best guess at the fields of `body`. `others` are more messages in the same format (newest
 * first); `templates` are the user's saved templates to learn from.
 */
export function guessSpans(body: string, others: string[] = [], templates: UserSmsTemplate[] = []): TaggedSpan[] {
  const out: TaggedSpan[] = [];
  const have = new Set<TaggedField>();
  const add = (s: TaggedSpan | null) => {
    if (!s || have.has(s.field)) return;
    if (out.some((o) => !(s.end <= o.start || s.start >= o.end))) return;
    out.push(s);
    have.add(s.field);
  };

  // 1. What the user taught before.
  for (const s of fromHints(body, learnHints(templates), new Set())) add(s);
  // 2. Shapes.
  add(guessAmount(body));
  add(spanOf(body, "balance", new RegExp(String.raw`(?:avl\.?\s*bal|available\s*bal(?:ance)?|\bbal(?:ance)?|\b(?:avl|avail(?:able)?)\.?\s*(?:limit|lmt))\b[^0-9]{0,12}(${NUM})`, "i")));
  add(spanOf(body, "date", new RegExp(String.raw`\b(${DATE})`, "i")));
  add(guessMerchant(body));
  // The older helper only for the fields the rules above don't cover. Its date rule took any three
  // letters - "com" in "zomato.com" became a date - and its amount / balance rules are weaker.
  const FROM_AUTOTAG = new Set<TaggedField>(["account", "ref", "other_account", "counterparty"]);
  for (const s of autoTag(body)) if (FROM_AUTOTAG.has(s.field)) add(s);
  // 3. Parts that change between messages of the same format.
  if (!have.has("merchant") && !have.has("counterparty")) add(merchantFromChanges(body, others, out));

  return out.sort((a, b) => a.start - b.start);
}
