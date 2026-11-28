/**
 * Payment pictures the reader can't place (docs/ON_DEVICE_AI_PHASE2_PROPOSAL.md, job 5): when
 * readReceipt leaves the amount or the merchant empty, on-device AI reads the text the picture's
 * text reader already pulled out.
 *
 * Checked like a message reading: the amount, the merchant's words, the date and the reference
 * must all be written in the picture's text, and paid / received must agree with the picture's
 * own words. Only fields the reader left empty are filled; its own values are never replaced.
 */

import { parseDate, type ReceiptGuess } from "@/services/receipt/read-receipt";
import { askNano, extractJsonObject } from "../nano";

/** The picture's text, capped: Gemini Nano takes about 4,000 tokens a prompt. */
const MAX_TEXT = 1500;
/** You're waiting on screen: answer quickly or not at all. */
export const PICTURE_TIMEOUT_MS = 4000;

export interface PictureReading {
  amount: number | null;
  party: string | null;
  date: string | null;
  ref: string | null;
  kind: "expense" | "credit" | null;
}

export function buildReadPicturePrompt(text: string): string {
  return [
    "You read the text of an Indian payment app or bank app screenshot. Reply with one JSON object and nothing else.",
    '"amount": the amount paid or received, a number without commas.',
    '"party": who was paid, or who paid the user, as written. Never the app, the bank or "UPI".',
    '"date": the date as written on the screenshot. "ref": the transaction or UPI reference as written.',
    '"kind": "paid" if the user paid, "received" if the user was paid. Leave out what isn\'t shown.',
    "",
    `Screenshot text: ${text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT)}`,
    "",
    "JSON:",
  ].join("\n");
}

// Paid: the ways payment apps say it ("Paid to", "Paid successfully to", "Payment successful", "To: X").
const PAID_WORDS = /\b(?:paid\s+(?:successfully\s+)?to|sent\s+to|payment\s+(?:to|successful)|debited|you\s+paid|money\s+sent)\b|^\s*to\b/im;
// Received: the reader's own wording. A bare "credited" isn't enough ("₹5 cashback credited").
const RECEIVED_WORDS = /\b(?:received\s+from|credited\s+(?:to|in)|you\s+received|money\s+received|paid\s+you)\b/i;

const flat = (t: string) => t.replace(/\s+/g, " ");

/**
 * Numbers on the picture that can be an amount: written with ₹ / Rs / INR, or with paise or
 * Indian grouping ("1,450.00", "1,23,456"). Not the year, the time, an account's last digits or
 * a long reference, which is how a small model goes wrong when the reader found no amount.
 * Exported for tests.
 */
export function amountsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of flat(text).matchAll(/(₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi)) {
    const raw = m[2];
    const marked = !!m[1];
    const formatted = /,\d{2,3}/.test(raw) || /\.\d{1,2}$/.test(raw);
    if (!marked && !formatted) continue;
    const digits = raw.replace(/[,.]/g, "");
    if (digits.length > 9) continue;
    const n = Number(raw.replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

function wordsIn(words: string, text: string): boolean {
  const hay = text.toLowerCase();
  const ws = words.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  return ws.length > 0 && ws.every((w) => hay.includes(w));
}

/** Read and check the answer against the picture's text. Pure. */
export function checkReadPictureAnswer(answer: string, text: string, today: Date = new Date()): PictureReading {
  const out: PictureReading = { amount: null, party: null, date: null, ref: null, kind: null };
  const obj = extractJsonObject(answer);
  if (!obj) return out;

  const n = typeof obj.amount === "number" ? obj.amount : typeof obj.amount === "string" ? Number(obj.amount.replace(/[,₹\s]|rs\.?|inr/gi, "")) : NaN;
  if (Number.isFinite(n) && n > 0 && amountsIn(text).some((m) => Math.abs(m - n) < 0.005)) out.amount = n;

  if (typeof obj.party === "string" && obj.party.trim()) {
    const party = obj.party.trim().slice(0, 80);
    if (wordsIn(party, text) && !/^(?:upi|google pay|phonepe|paytm|bhim|cred)$/i.test(party)) out.party = party;
  }

  // Compared with whitespace flattened, as the prompt saw it ("24 Nov\n2026").
  if (typeof obj.date === "string" && obj.date.trim() && flat(text).toLowerCase().includes(flat(obj.date.trim()).toLowerCase())) {
    out.date = parseDate(flat(obj.date.trim()), today);
  }

  if (obj.ref != null && String(obj.ref).trim().length >= 6 && flat(text).includes(String(obj.ref).trim())) out.ref = String(obj.ref).trim();

  const k = typeof obj.kind === "string" ? obj.kind.toLowerCase() : "";
  if (k === "paid" && PAID_WORDS.test(text) && !RECEIVED_WORDS.test(text)) out.kind = "expense";
  else if (k === "received" && RECEIVED_WORDS.test(text) && !PAID_WORDS.test(text)) out.kind = "credit";
  return out;
}

/** Fill only what the reader left empty. Pure. Returns the guess and what the AI filled. */
export function fillGuess(guess: ReceiptGuess, r: PictureReading): { guess: ReceiptGuess; filled: string[] } {
  const filled: string[] = [];
  const g = { ...guess };
  if (g.amount == null && r.amount != null) {
    g.amount = r.amount;
    filled.push("amount");
  }
  if (!g.party && r.party) {
    g.party = r.party;
    filled.push("merchant");
  }
  if (!g.date && r.date) {
    g.date = r.date;
    filled.push("date");
  }
  if (!g.ref && r.ref) {
    g.ref = r.ref;
    filled.push("reference");
  }
  // Only settle paid / received when the reader had no clue either way (an "expense" default),
  // and only alongside the amount or merchant: a date or reference alone doesn't say which way.
  const core = filled.includes("amount") || filled.includes("merchant");
  if (r.kind === "credit" && g.kind === "expense" && core && !PAID_WORDS.test(g.text)) {
    g.kind = "credit";
    filled.push("money in");
  }
  return { guess: g, filled };
}

/** Does the reader need help with this picture? Pure. */
export function needsAiHelp(g: ReceiptGuess): boolean {
  return !g.notCompleted && g.kind !== "transfer" && (g.amount == null || !g.party) && g.text.trim().length > 0;
}

/** Ask the model. Throws when it can't be asked or doesn't answer in time. */
export async function readPictureWithNano(text: string): Promise<PictureReading> {
  // You're waiting: 4 s from now, however long the AI is busy with something else first.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("On-device AI was busy")), PICTURE_TIMEOUT_MS);
  });
  try {
    const answer = await Promise.race([askNano(buildReadPicturePrompt(text), { maxOutputTokens: 80, timeoutMs: PICTURE_TIMEOUT_MS }), deadline]);
    return checkReadPictureAnswer(answer.text, text);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
