/**
 * Reading a bank SMS that no built-in pattern or user template knows, with on-device AI.
 *
 * The model only proposes. Every answer is checked against the message itself before it's kept:
 *  - the amount (and balance, if given) must be a number written in the SMS
 *  - the last 4 digits must be written in the SMS
 *  - debit / credit must agree with the message's own money words, when those are clear
 *  - a merchant whose words aren't in the SMS is dropped (the rest can still be kept)
 *  - "from" / "to" must be accounts from the money map (or "new"); the map is how the model tells
 *    an FD closing or a transfer between the user's own accounts from a spend
 * Anything else the model says is ignored. Results still go to the review queue as pending.
 *
 * The prompt gets the raw message, not the redacted one: it never leaves the phone, and the
 * redaction removes exactly what has to be read (balances, last 4 digits).
 */

import { inferDirection } from "@/services/sms/money-signals";
import { askNano, extractJsonObject } from "../nano";
import { moneyMapLines, type MapAccount, type MoneyMap } from "../money-map";

export const SMS_EVENTS = [
  "spend",
  "income",
  "refund",
  "own_transfer",
  "fd_open",
  "fd_close",
  "card_payment",
  "loan_emi",
  "investment",
  "wallet_topup",
  "not_txn",
] as const;
export type SmsEvent = (typeof SMS_EVENTS)[number];

/** One side of the event: an account from the money map, or one Arth doesn't know yet. */
export interface AccountLink {
  ref: string;
  /** Undefined when the model said "new". */
  account?: MapAccount;
  /** Its digits are written in the SMS (otherwise the model worked it out from the map). */
  inSms: boolean;
}

export interface AiReadSms {
  type: "debit" | "credit";
  amount: number;
  last4: string | null;
  merchant: string | null;
  balance: number | null;
  event: SmsEvent | null;
  from: AccountLink | null;
  to: AccountLink | null;
}

export type ReadSmsOutcome =
  | { kind: "transaction"; result: AiReadSms; warnings: string[] }
  | { kind: "not_transaction" }
  | { kind: "rejected"; problems: string[] };

/** The accounts the examples talk about. E-ids, so they can't be mixed up with the user's A-ids. */
const EXAMPLE_ACCOUNTS = [
  "E1 | savings | HDFC | ••1234",
  "E2 | savings | SBI | ••4821",
  "E3 | FD | SBI | ••5512 | funded from E2",
  "E4 | credit card | ICICI | ••4321",
];

const EXAMPLES: { sender: string; body: string; json: string }[] = [
  {
    sender: "AX-HDFCBK",
    body: "Rs.250.00 debited from A/c XX1234 on 12-11-26 to VPA swiggy@icici (UPI Ref 431298765432). Avl Bal Rs 5,000.00",
    json: '{"txn":true,"type":"debit","amount":250,"last4":"1234","merchant":"swiggy","balance":5000,"event":"spend","from":"E1","to":null}',
  },
  {
    sender: "VM-SBIINB",
    body: "Dear Customer, INR 45,000.00 credited to your A/c No XXXXXXX9876 on 01Nov26 by NEFT from ACME PVT LTD.",
    json: '{"txn":true,"type":"credit","amount":45000,"last4":"9876","merchant":"ACME PVT LTD","balance":null,"event":"income","from":null,"to":"new"}',
  },
  {
    sender: "VM-SBIINB",
    body: "Your Term Deposit A/c XXXX5512 is closed. Proceeds Rs 1,05,000.00 credited to A/c XX4821 on 02-11-26.",
    json: '{"txn":true,"type":"credit","amount":105000,"last4":"4821","merchant":null,"balance":null,"event":"fd_close","from":"E3","to":"E2"}',
  },
  {
    sender: "JD-ICICIT",
    body: "Payment of Rs 12,500.00 received towards your ICICI Bank Credit Card XX4321. Thank you.",
    json: '{"txn":true,"type":"credit","amount":12500,"last4":"4321","merchant":null,"balance":null,"event":"card_payment","from":null,"to":"E4"}',
  },
  {
    sender: "JD-ICICIT",
    body: "482913 is the OTP for your txn of INR 1,999.00 at AMAZON on card XX4321. Do not share it with anyone.",
    json: '{"txn":false}',
  },
  {
    sender: "AX-AXISBK",
    body: "UPI mandate successfully created towards NETFLIX for Rs 649.00. INR 649.00 will be debited from A/c XX7788 on 01-12-26.",
    json: '{"txn":false}',
  },
];

export function buildReadSmsPrompt(body: string, sender: string, map?: MoneyMap): string {
  const lines = [
    "You read Indian bank and card SMS. Reply with one JSON object and nothing else.",
    'Fields: "txn" true only if money already moved in or out of the user\'s account, card or wallet;',
    "false for OTPs, offers, reminders, due notices, statements, failed or declined payments,",
    'mandates being created or changed, amounts that "will be" debited, and refunds only "initiated".',
    '"type": "debit" for money out, "credit" for money in.',
    '"amount": the amount that moved, a number without commas.',
    '"last4": the digits shown of the user\'s account or card (last 3 or 4), as a string, or null.',
    '"merchant": the person or business paid, or who paid, as written in the SMS, or null.',
    'Never the bank, app or channel used to pay (not "ICICI Bank InstaBIZ", "UPI", "IMPS").',
    '"balance": available balance after the transaction, a number, or null.',
    `"event": one of ${SMS_EVENTS.filter((e) => e !== "not_txn").join(", ")}.`,
    "own_transfer is money between two of the user's own accounts. fd_close is a fixed deposit closing or",
    "maturing, with the money going back to the account that funded it. fd_open is money put into a new FD.",
    '"from" and "to": the user\'s accounts the money left and reached, by id from the account list,',
    '"new" for the user\'s account that isn\'t in the list, or null for someone else or unknown.',
    'If txn is false, reply {"txn":false}.',
    "",
    "Example accounts:",
    ...EXAMPLE_ACCOUNTS,
    "",
  ];
  for (const ex of EXAMPLES) lines.push(`From: ${ex.sender}`, `SMS: ${ex.body}`, `JSON: ${ex.json}`, "");
  const mine = map && map.accounts.length > 0 ? moneyMapLines(map) : ["(none known yet)"];
  lines.push("The user's accounts:", ...mine, "");
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

/** Where the amount is first written in the text, or the end of the text if it isn't. */
function amountIndex(n: number, text: string): number {
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    if (Math.abs(Number(m[0].replace(/,/g, "")) - n) < 0.005) return m.index ?? text.length;
  }
  return text.length;
}

function merchantInText(merchant: string, text: string): boolean {
  const hay = text.toLowerCase();
  const words = merchant.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  return words.length > 0 && words.some((w) => hay.includes(w));
}

/** The merchant is how the user paid ("using ICICI Bank InstaBIZ"), not who was paid. */
function isPaymentChannel(merchant: string, text: string): boolean {
  const esc = merchant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(?:using|via|through)\\s+(?:the\\s+)?${esc}`, "i").test(text);
}

/** Account or card digits the SMS shows behind a mask ("XX304", "XXXXX903667", "**1234"), last 4 at most. */
export function maskedAccountDigits(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/[Xx*]{2,}(\d{3,})(?!\d)/g)) found.add(m[1].slice(-4));
  return [...found];
}

/**
 * Messages that look like money moving but aren't (yet): a mandate being set up or changed, an
 * amount that "will be" debited, a refund only initiated. Checked in code as well as the prompt,
 * because reading them as transactions would count the money twice when the real one comes.
 */
const NOT_YET_MONEY: RegExp[] = [
  // A bounded gap, not "up to the next full stop": amounts like "Rs 439.0" contain one.
  /\bmandate\b[\s\S]{0,80}?\b(?:created|registered|set\s*up|setup|modified|revoked|cancelled|canceled|paused)\b/i,
  /\bwill\s+be\s+(?:debited|deducted|charged|credited|auto-?debited)\b/i,
  /\brefund\b[\s\S]{0,80}?\binitiated\b/i,
];

export function isNotYetMoney(text: string): boolean {
  return NOT_YET_MONEY.some((rx) => rx.test(text));
}

/** Read and check one model answer against the SMS it was about. Pure. */
export function checkReadSmsAnswer(answer: string, body: string, map?: MoneyMap): ReadSmsOutcome {
  const obj = extractJsonObject(answer);
  if (!obj) return { kind: "rejected", problems: ["The answer had no JSON object"] };
  if (obj.txn === false || obj.txn === "false") return { kind: "not_transaction" };
  if (obj.txn !== true && obj.txn !== "true") return { kind: "rejected", problems: ['"txn" was missing'] };
  if (isNotYetMoney(body)) return { kind: "not_transaction" };
  if (obj.event === "not_txn") return { kind: "not_transaction" };

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

  // Account digits: banks show 3 (ICICI "XX304") or 4. When the model's digits aren't in the SMS
  // but the SMS shows exactly one masked account, that one is the account.
  let last4: string | null = null;
  const masked = maskedAccountDigits(body);
  const given = obj.last4 != null && obj.last4 !== "" ? String(obj.last4).replace(/\D/g, "").slice(-4) : null;
  if (given && given.length >= 3 && new RegExp(`${given}(?!\\d)`).test(body)) {
    last4 = given;
  } else if (masked.length === 1) {
    last4 = masked[0];
    if (given !== null) warnings.push(`Account ${String(obj.last4)} isn't in the SMS, used ${masked[0]} from the SMS`);
  } else if (given !== null) {
    problems.push(
      given.length < 3 ? `Account "${String(obj.last4)}" isn't 3 or 4 digits` : `Account ${given} isn't written in the SMS`,
    );
  }

  let merchant: string | null = typeof obj.merchant === "string" && obj.merchant.trim() ? obj.merchant.trim().slice(0, 100) : null;
  if (merchant && !merchantInText(merchant, body)) {
    warnings.push(`Merchant "${merchant}" isn't in the SMS, dropped`);
    merchant = null;
  } else if (merchant && isPaymentChannel(merchant, body)) {
    warnings.push(`"${merchant}" is how it was paid, not who was paid, dropped`);
    merchant = null;
  }

  if ((type === "debit" || type === "credit") && amount != null) {
    // The money word nearest before the amount decides ("XX304 debited with Rs 9,615 & XX185 credited").
    const said = inferDirection(body, amountIndex(amount, body));
    const saidType = said.type === "refund" ? "credit" : said.type;
    if (said.confident && saidType !== type) problems.push(`Said ${type}, but the SMS reads as ${saidType}`);
  }

  if (problems.length > 0) return { kind: "rejected", problems };

  // What happened, and between which of the user's accounts. Never a reason to reject the
  // amount reading: a wrong label is dropped with a warning and the transaction stays.
  let event: SmsEvent | null = null;
  if (obj.event != null) {
    if ((SMS_EVENTS as readonly unknown[]).includes(obj.event)) event = obj.event as SmsEvent;
    else warnings.push(`Event "${String(obj.event)}" isn't one Arth knows, dropped`);
  }
  const link = (side: "from" | "to"): AccountLink | null => {
    const v = obj[side];
    if (v == null || v === "") return null;
    if (v === "new") return { ref: "new", inSms: true };
    const account = map?.byRef.get(String(v));
    if (!account) {
      warnings.push(`"${side}" ${String(v)} isn't one of your accounts, dropped`);
      return null;
    }
    return { ref: account.ref, account, inSms: account.digits != null && new RegExp(`${account.digits}(?!\\d)`).test(body) };
  };
  const from = link("from");
  let to = link("to");
  if (from && to && from.ref === to.ref && from.ref !== "new") {
    warnings.push(`"from" and "to" are the same account, dropped "to"`);
    to = null;
  }
  // The SMS names one of the user's accounts that the model left out of from/to.
  if (map && last4) {
    const named = map.accounts.filter((a) => a.digits === last4 || (a.digits?.endsWith(last4) ?? false));
    if (named.length === 1 && from?.ref !== named[0].ref && to?.ref !== named[0].ref) {
      warnings.push(`The SMS names ${named[0].ref} (${named[0].name} ••${named[0].digits}), not in from/to`);
    }
  }

  return {
    kind: "transaction",
    result: { type: type as AiReadSms["type"], amount: amount!, last4, merchant, balance, event, from, to },
    warnings,
  };
}

/** Ask the model to read one SMS. Throws when the model can't be asked or doesn't answer. */
export async function readSmsWithNano(
  body: string,
  sender: string,
  map?: MoneyMap,
): Promise<{ outcome: ReadSmsOutcome; raw: string; ms: number }> {
  const answer = await askNano(buildReadSmsPrompt(body, sender, map), { maxOutputTokens: 160 });
  return { outcome: checkReadSmsAnswer(answer.text, body, map), raw: answer.text, ms: answer.ms };
}
