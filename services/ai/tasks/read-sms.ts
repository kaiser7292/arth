/**
 * Reading a bank SMS that no built-in pattern or user template knows, with on-device AI.
 *
 * The model only proposes. Every answer is checked against the message itself before it's kept:
 *  - the amount (and balance, if given) must be a number written in the SMS
 *  - the last 4 digits must be written in the SMS
 *  - debit / credit must agree with the message's own money words, when those are clear
 *  - a merchant whose words aren't in the SMS is dropped (the rest can still be kept)
 * Anything else the model says is ignored. Results still go to the review queue as pending.
 *
 * The prompt gets the raw message, not the redacted one: it never leaves the phone, and the
 * redaction removes exactly what has to be read (balances, last 4 digits).
 */

import { inferDirection } from "@/services/sms/money-signals";
import { askNano, extractJsonObject } from "../nano";

export interface AiReadSms {
  type: "debit" | "credit";
  amount: number;
  last4: string | null;
  merchant: string | null;
  balance: number | null;
}

export type ReadSmsOutcome =
  | { kind: "transaction"; result: AiReadSms; warnings: string[] }
  | { kind: "not_transaction" }
  | { kind: "rejected"; problems: string[] };

const EXAMPLES: { sender: string; body: string; json: string }[] = [
  {
    sender: "AX-HDFCBK",
    body: "Rs.250.00 debited from A/c XX1234 on 12-11-26 to VPA swiggy@icici (UPI Ref 431298765432). Avl Bal Rs 5,000.00",
    json: '{"txn":true,"type":"debit","amount":250,"last4":"1234","merchant":"swiggy","balance":5000}',
  },
  {
    sender: "VM-SBIINB",
    body: "Dear Customer, INR 45,000.00 credited to your A/c No XXXXXXX9876 on 01Nov26 by NEFT from ACME PVT LTD.",
    json: '{"txn":true,"type":"credit","amount":45000,"last4":"9876","merchant":"ACME PVT LTD","balance":null}',
  },
  {
    sender: "JD-ICICIT",
    body: "482913 is the OTP for your txn of INR 1,999.00 at AMAZON on card XX4321. Do not share it with anyone.",
    json: '{"txn":false}',
  },
];

export function buildReadSmsPrompt(body: string, sender: string): string {
  const lines = [
    "You read Indian bank and card SMS. Reply with one JSON object and nothing else.",
    'Fields: "txn" true only if money already moved in or out of the user\'s account, card or wallet;',
    "false for OTPs, offers, reminders, due notices, statements, failed or declined payments.",
    '"type": "debit" for money out, "credit" for money in.',
    '"amount": the amount that moved, a number without commas.',
    '"last4": last 4 digits of the user\'s account or card as a string, or null.',
    '"merchant": who was paid or who paid, as written in the SMS, or null.',
    '"balance": available balance after the transaction, a number, or null.',
    'If txn is false, reply {"txn":false}.',
    "",
  ];
  for (const ex of EXAMPLES) lines.push(`From: ${ex.sender}`, `SMS: ${ex.body}`, `JSON: ${ex.json}`, "");
  lines.push(`From: ${sender}`, `SMS: ${body.replace(/\s+/g, " ").trim()}`, "JSON:");
  return lines.join("\n");
}

/** Every number written in the text ("1,23,456.50" -> 123456.5). */
export function numbersIn(text: string): number[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])
    .map((s) => Number(s.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
}

function writtenIn(n: number, text: string): boolean {
  return numbersIn(text).some((m) => Math.abs(m - n) < 0.005);
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/[,₹\s]|rs\.?|inr/gi, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function merchantInText(merchant: string, text: string): boolean {
  const hay = text.toLowerCase();
  const words = merchant.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  return words.length > 0 && words.some((w) => hay.includes(w));
}

/** Read and check one model answer against the SMS it was about. Pure. */
export function checkReadSmsAnswer(answer: string, body: string): ReadSmsOutcome {
  const obj = extractJsonObject(answer);
  if (!obj) return { kind: "rejected", problems: ["The answer had no JSON object"] };
  if (obj.txn === false || obj.txn === "false") return { kind: "not_transaction" };
  if (obj.txn !== true && obj.txn !== "true") return { kind: "rejected", problems: ['"txn" was missing'] };

  const problems: string[] = [];
  const warnings: string[] = [];

  const type = typeof obj.type === "string" ? obj.type.toLowerCase() : "";
  if (type !== "debit" && type !== "credit") problems.push(`Type "${String(obj.type)}" isn't debit or credit`);

  const amount = toNumber(obj.amount);
  if (amount == null || amount <= 0) problems.push("No amount");
  else if (!writtenIn(amount, body)) problems.push(`Amount ${amount} isn't written in the SMS`);

  let balance = obj.balance == null ? null : toNumber(obj.balance);
  if (obj.balance != null && balance == null) {
    warnings.push("Balance wasn't a number, dropped");
  } else if (balance != null && !writtenIn(balance, body)) {
    warnings.push(`Balance ${balance} isn't written in the SMS, dropped`);
    balance = null;
  }

  let last4: string | null = null;
  if (obj.last4 != null && obj.last4 !== "") {
    const digits = String(obj.last4).replace(/\D/g, "").slice(-4);
    if (digits.length !== 4) problems.push(`Last 4 "${String(obj.last4)}" isn't 4 digits`);
    else if (!new RegExp(`${digits}(?!\\d)`).test(body)) problems.push(`Last 4 ${digits} isn't written in the SMS`);
    else last4 = digits;
  }

  let merchant: string | null = typeof obj.merchant === "string" && obj.merchant.trim() ? obj.merchant.trim().slice(0, 100) : null;
  if (merchant && !merchantInText(merchant, body)) {
    warnings.push(`Merchant "${merchant}" isn't in the SMS, dropped`);
    merchant = null;
  }

  if (type === "debit" || type === "credit") {
    const said = inferDirection(body);
    const saidType = said.type === "refund" ? "credit" : said.type;
    if (said.confident && saidType !== type) problems.push(`Said ${type}, but the SMS reads as ${saidType}`);
  }

  if (problems.length > 0) return { kind: "rejected", problems };
  return { kind: "transaction", result: { type: type as AiReadSms["type"], amount: amount!, last4, merchant, balance }, warnings };
}

/** Ask the model to read one SMS. Throws when the model can't be asked or doesn't answer. */
export async function readSmsWithNano(
  body: string,
  sender: string,
): Promise<{ outcome: ReadSmsOutcome; raw: string; ms: number }> {
  const answer = await askNano(buildReadSmsPrompt(body, sender), { maxOutputTokens: 128 });
  return { outcome: checkReadSmsAnswer(answer.text, body), raw: answer.text, ms: answer.ms };
}
