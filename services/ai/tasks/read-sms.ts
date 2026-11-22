/**
 * Reading a bank SMS that no built-in pattern or user template knows, with on-device AI: the
 * fields (amount, account, merchant, balance) and the context (what it was, how it was paid,
 * whether it was an autopay, which of the user's accounts it moved between, its reference).
 *
 * The model only proposes. Every answer is checked against the message itself before it's kept:
 *  - the amount (and balance, if given) must be a number written in the SMS
 *  - the account digits must be written in the SMS
 *  - debit / credit must agree with the message's own money words, when those are clear
 *  - merchant, reference, time, scheme and foreign currency must be written in the SMS
 *  - "from" / "to" must be accounts from the money map (or "new"). Which of the user's accounts
 *    the SMS names is worked out in code first (namedAccounts) and handed to the model
 *  - the event must fit the direction and the accounts' types (money into a credit card is a
 *    card bill payment, a debit on a credit card never is)
 * A wrong field is dropped with a warning; only a wrong amount, account or direction rejects the
 * reading. Results still go to the review queue as pending.
 *
 * The prompt gets the raw message, not the redacted one: it never leaves the phone, and the
 * redaction removes exactly what has to be read (balances, account digits).
 */

import { inferDirection } from "@/services/sms/money-signals";
import { askNano, extractJsonObject } from "../nano";
import { digitsMatch, moneyMapLines, namedAccounts, type MapAccount, type MoneyMap, type NamedAccount } from "../money-map";

export const SMS_EVENTS = [
  "spend",
  "bill",
  "salary",
  "income",
  "interest",
  "dividend",
  "refund",
  "cashback",
  "reversal",
  "own_transfer",
  "card_payment",
  "loan_emi",
  "fd_open",
  "fd_close",
  "sip",
  "investment",
  "investment_withdrawal",
  "insurance",
  "tax",
  "atm_cash",
  "wallet_topup",
  "fee",
  "not_txn",
] as const;
export type SmsEvent = (typeof SMS_EVENTS)[number];

/** Events that are always money in, or always money out. The rest can be either side. */
const IN_ONLY: ReadonlySet<SmsEvent> = new Set(["salary", "income", "interest", "dividend", "refund", "cashback", "reversal", "investment_withdrawal"]);
const OUT_ONLY: ReadonlySet<SmsEvent> = new Set(["spend", "bill", "loan_emi", "sip", "investment", "insurance", "tax", "atm_cash", "fee"]);

export const CHANNELS = ["upi", "card", "netbanking", "neft", "imps", "rtgs", "nach", "atm", "cheque", "wallet"] as const;
export type Channel = (typeof CHANNELS)[number];

/** The words that show a channel is written in the SMS, not guessed. */
const CHANNEL_WORDS: Record<Channel, RegExp> = {
  upi: /\bupi\b|\bvpa\b|@[a-z]+/i,
  card: /\bcard\b/i,
  netbanking: /net\s*-?banking|\bonline\b|\binb\b/i,
  neft: /\bneft\b/i,
  imps: /\bimps\b/i,
  rtgs: /\brtgs\b/i,
  nach: /\bnach\b|\becs\b|mandate|auto-?debit|standing instruction|\bSI\b/i,
  atm: /\batm\b|cash withdraw/i,
  cheque: /\bche(?:que|ck)\b|\bclg\b|clearing/i,
  wallet: /wallet|paytm|phonepe|amazon pay|mobikwik/i,
};

/** An autopay is written as one of these; without them "auto" is the model's guess. */
const AUTO_WORDS = /auto-?pay|auto-?debit|e-?mandate|\bmandate\b|\bnach\b|\becs\b|standing instruction|\brecurring\b|\bsubscription\b/i;
const SI_WORD = /\bSI\b/;
const REFUND_WORDS = /\b(?:refund(?:ed)?|reversal|reversed|cash\s*back)\b/i;

/** One side of the event: an account from the money map, or one Arth doesn't know yet. */
export interface AccountLink {
  ref: string;
  /** Undefined when the model said "new". */
  account?: MapAccount;
  /** The SMS names this account (otherwise the model worked it out from the map). */
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
  channel: Channel | null;
  /** sure: the SMS says autopay / mandate / NACH...; otherwise a suggestion to confirm. */
  auto: { sure: boolean } | null;
  ref: string | null;
  scheme: string | null;
  /** "HH:MM" */
  time: string | null;
  fx: { amount: number; currency: string } | null;
}

export type ReadSmsOutcome =
  | { kind: "transaction"; result: AiReadSms; warnings: string[] }
  | { kind: "not_transaction" }
  /** On an account the user ignored: skipped, as the scan skips it. */
  | { kind: "ignored"; account: MapAccount }
  | { kind: "rejected"; problems: string[] };

/** The accounts the examples talk about. E-ids, so they can't be mixed up with the user's A-ids. */
const EXAMPLE_ACCOUNTS = [
  "E1 | savings | HDFC | ••1234",
  "E2 | savings | SBI | ••4821",
  "E3 | FD | SBI | ••5512 | funded from E2",
  "E4 | credit card | ICICI | ••4321",
];

const EXAMPLES: { sender: string; body: string; names: string; json: string }[] = [
  {
    sender: "AX-HDFCBK",
    body: "Rs.250.00 debited from A/c XX1234 on 12-11-26 to VPA swiggy@icici (UPI Ref 431298765432). Avl Bal Rs 5,000.00",
    names: "1234 = E1",
    json: '{"txn":true,"type":"debit","amount":250,"last4":"1234","merchant":"swiggy","balance":5000,"event":"spend","channel":"upi","ref":"431298765432","from":"E1"}',
  },
  {
    sender: "VM-SBIINB",
    body: "Dear Customer, INR 45,000.00 credited to your A/c No XXXXXXX9876 on 01Nov26 by NEFT from ACME PVT LTD SALARY NOV.",
    names: "none",
    json: '{"txn":true,"type":"credit","amount":45000,"last4":"9876","merchant":"ACME PVT LTD","event":"salary","channel":"neft","to":"new"}',
  },
  {
    sender: "VM-SBIINB",
    body: "Your Term Deposit A/c XXXX5512 is closed. Proceeds Rs 1,05,000.00 credited to A/c XX4821 on 02-11-26.",
    names: "5512 = E3, 4821 = E2",
    json: '{"txn":true,"type":"credit","amount":105000,"last4":"4821","event":"fd_close","from":"E3","to":"E2"}',
  },
  {
    sender: "JD-ICICIT",
    body: "Payment of Rs 12,500.00 received towards your ICICI Bank Credit Card XX4321. Thank you.",
    names: "4321 = E4",
    json: '{"txn":true,"type":"credit","amount":12500,"last4":"4321","event":"card_payment","to":"E4"}',
  },
  {
    sender: "JD-ICICIT",
    body: "Rs 199.00 spent on ICICI Bank Card XX4321 at NETFLIX.COM on 03-Nov-26 14:05 via standing instruction.",
    names: "4321 = E4",
    json: '{"txn":true,"type":"debit","amount":199,"last4":"4321","merchant":"NETFLIX.COM","event":"spend","channel":"card","auto":true,"time":"14:05","from":"E4"}',
  },
  {
    sender: "VM-CAMSPL",
    body: "Your SIP of Rs 5,000 in Parag Parikh Flexi Cap Fund is processed through NACH from A/c XX1234.",
    names: "1234 = E1",
    json: '{"txn":true,"type":"debit","amount":5000,"last4":"1234","event":"sip","scheme":"Parag Parikh Flexi Cap Fund","channel":"nach","auto":true,"from":"E1"}',
  },
  {
    sender: "JD-ICICIT",
    body: "482913 is the OTP for your txn of INR 1,999.00 at AMAZON on card XX4321. Do not share it with anyone.",
    names: "4321 = E4",
    json: '{"txn":false}',
  },
  {
    sender: "AX-AXISBK",
    body: "UPI mandate successfully created towards NETFLIX for Rs 649.00. INR 649.00 will be debited from A/c XX7788 on 01-12-26.",
    names: "none",
    json: '{"txn":false}',
  },
];

/** "XX702 = A5 (ICICI savings), 7731 = A2 (HDFC credit card)", or "none". */
function namesLine(named: NamedAccount[]): string {
  return named.length ? named.map((n) => `${n.digits} = ${n.account.ref} (${n.account.name} ${n.account.kind})`).join(", ") : "none";
}

export function buildReadSmsPrompt(body: string, sender: string, map?: MoneyMap): string {
  const lines = [
    "You read Indian bank and card SMS. Reply with one JSON object and nothing else. Leave out keys that are null.",
    'Fields: "txn" true only if money already moved in or out of the user\'s account, card or wallet;',
    "false for OTPs, offers, reminders, due notices, statements, failed or declined payments,",
    'mandates being created or changed, amounts that "will be" debited, and refunds only "initiated".',
    '"type": "debit" for money out, "credit" for money in.',
    '"amount": the amount that moved, a number without commas.',
    '"last4": the digits shown of the user\'s account or card (last 3 or 4), as a string.',
    '"merchant": the person or business paid, or who paid, as written in the SMS.',
    'Never the bank, app or channel used to pay (not "ICICI Bank InstaBIZ", "UPI", "IMPS").',
    '"balance": available balance after the transaction, a number.',
    `"event": one of ${SMS_EVENTS.filter((e) => e !== "not_txn").join(", ")}.`,
    "own_transfer is money between two of the user's own accounts. card_payment is paying a credit card bill:",
    "money INTO a credit card. A debit ON a credit card is a spend or bill, never card_payment.",
    "fd_close is a fixed deposit closing or maturing; fd_open is money put into a new FD.",
    "sip and investment are money into funds, shares, NPS, PPF or RD; loan_emi is a loan instalment.",
    `"channel": one of ${CHANNELS.join(", ")}.`,
    '"auto": true for an autopay, NACH or ECS debit, e-mandate, standing instruction or recurring charge.',
    '"ref": the transaction or UPI reference as written. "scheme": the fund, policy or loan name.',
    '"time": the time as HH:MM if written. "fx": {"amount":n,"currency":"USD"} for a foreign-currency spend.',
    '"from" and "to": the user\'s accounts the money left and reached, by id. Use "SMS names" for the accounts',
    'the SMS shows; "new" for the user\'s account that isn\'t listed; leave out for someone else or unknown.',
    'If txn is false, reply {"txn":false}.',
    "",
    "Example accounts:",
    ...EXAMPLE_ACCOUNTS,
    "",
  ];
  for (const ex of EXAMPLES) lines.push(`From: ${ex.sender}`, `SMS: ${ex.body}`, `SMS names: ${ex.names}`, `JSON: ${ex.json}`, "");
  const mine = map && map.accounts.length > 0 ? moneyMapLines(map) : ["(none known yet)"];
  lines.push("The user's accounts:", ...mine, "");
  lines.push(
    `From: ${sender}`,
    `SMS: ${body.replace(/\s+/g, " ").trim()}`,
    `SMS names: ${map ? namesLine(namedAccounts(body, map)) : "none"}`,
    "JSON:",
  );
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

function wordsInText(words: string, text: string): boolean {
  const hay = text.toLowerCase();
  const ws = words.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  return ws.length > 0 && ws.some((w) => hay.includes(w));
}

/** The merchant is how the user paid ("using ICICI Bank InstaBIZ"), not who was paid. */
function isPaymentChannel(merchant: string, text: string): boolean {
  const esc = merchant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(?:using|via|through)\\s+(?:the\\s+)?${esc}`, "i").test(text);
}

/** Account or card digits the SMS shows behind a mask ("XX702", "XXXXX708142", "**1234"), last 4 at most. */
export function maskedAccountDigits(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/[Xx*]{2,}(\d{3,})(?!\d)/g)) found.add(m[1].slice(-4));
  return [...found];
}

/** Money that has already moved: "was processed", "debited from", "spent on" (not "will be debited"). */
const COMPLETED_MONEY = /(?<!will\s+be\s+)(?<!will\s+be\s+auto-)\b(?:processed|debited|deducted|charged|spent|paid|credited)\b/i;

/**
 * Messages that look like money moving but aren't (yet): a mandate being set up or changed (when
 * nothing was charged), an amount that "will be" debited, a refund only initiated. Checked in code
 * as well as the prompt, because reading them as transactions would count the money twice when
 * the real one comes. "Autopay txn ... processed as per the e-mandate set up by you" is money that
 * moved, so a mandate only counts when nothing in the message says money moved.
 */
const MANDATE_CHANGE =
  // A bounded gap, not "up to the next full stop": amounts like "Rs 439.0" contain one.
  /\bmandate\b[\s\S]{0,80}?\b(?:created|registered|set\s*up|setup|modified|revoked|cancelled|canceled|paused)\b/i;
const WILL_BE = /\bwill\s+be\s+(?:debited|deducted|charged|credited|auto-?debited)\b/i;
const REFUND_INITIATED = /\brefund\b[\s\S]{0,80}?\binitiated\b/i;

export function isNotYetMoney(text: string): boolean {
  if (WILL_BE.test(text) || REFUND_INITIATED.test(text)) return true;
  return MANDATE_CHANGE.test(text) && !COMPLETED_MONEY.test(text.replace(WILL_BE, ""));
}

/**
 * The ignored account an SMS is about, when every account it names is one the user ignored: no
 * need to ask the model at all.
 */
export function ignoredAccountIn(body: string, map: MoneyMap): MapAccount | null {
  const named = namedAccounts(body, map);
  return named.length > 0 && named.every((n) => n.account.ignored) ? named[0].account : null;
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
  const named = map ? namedAccounts(body, map) : [];

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

  // Account digits: banks show 3 (ICICI "XX702") or 4. When the model's digits aren't in the SMS
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
  if (merchant && !wordsInText(merchant, body)) {
    warnings.push(`Merchant "${merchant}" isn't in the SMS, dropped`);
    merchant = null;
  } else if (merchant && isPaymentChannel(merchant, body)) {
    warnings.push(`"${merchant}" is how it was paid, not who was paid, dropped`);
    merchant = null;
  }

  if ((type === "debit" || type === "credit") && amount != null) {
    // The money word nearest before the amount decides ("XX702 debited with Rs 7,340 & XX419 credited").
    const said = inferDirection(body, amountIndex(amount, body));
    const saidType = said.type === "refund" ? "credit" : said.type;
    if (said.confident && saidType !== type) problems.push(`Said ${type}, but the SMS reads as ${saidType}`);
  }

  if (problems.length > 0) return { kind: "rejected", problems };
  const isCredit = type === "credit";

  // The account the money moved on is one the user ignored: skip it, as the scan does.
  const own = last4 ? named.find((n) => digitsMatch(last4!, n.account.digits)) : undefined;
  if (own?.account.ignored) return { kind: "ignored", account: own.account };
  const allIgnored = map ? ignoredAccountIn(body, map) : null;
  if (allIgnored) return { kind: "ignored", account: allIgnored };

  // ── Which of the user's accounts it moved between ──
  const link = (side: "from" | "to"): AccountLink | null => {
    const v = obj[side];
    if (v == null || v === "") return null;
    if (v === "new") return { ref: "new", inSms: true };
    const account = map?.byRef.get(String(v));
    if (!account) {
      warnings.push(`"${side}" ${String(v)} isn't one of your accounts, dropped`);
      return null;
    }
    return { ref: account.ref, account, inSms: named.some((n) => n.account.ref === account.ref) };
  };
  let from = link("from");
  let to = link("to");
  if (from && to && from.ref === to.ref && from.ref !== "new") {
    warnings.push(`"from" and "to" are the same account, dropped "to"`);
    to = null;
  }
  // The SMS names exactly one of the user's accounts: that's the side the money moved on.
  if (named.length === 1) {
    const n = named[0].account;
    const own: AccountLink = { ref: n.ref, account: n, inSms: true };
    const sideNow = isCredit ? to : from;
    const otherSide = isCredit ? from : to;
    if (sideNow?.ref !== n.ref && otherSide?.ref !== n.ref) {
      if (sideNow?.account) warnings.push(`The SMS names ${n.name} ${n.kind} ••${n.digits}, not ${sideNow.account.name}; used the SMS`);
      if (isCredit) to = own;
      else from = own;
    }
  }

  // ── What it was ──
  let event: SmsEvent | null = null;
  if (obj.event != null) {
    if ((SMS_EVENTS as readonly unknown[]).includes(obj.event)) event = obj.event as SmsEvent;
    else warnings.push(`Event "${String(obj.event)}" isn't one Arth knows, dropped`);
  }
  // The account's type settles what the words don't: money into a credit card pays its bill;
  // a debit on a credit card is a purchase.
  const intoCard = isCredit && to?.account?.kind === "credit card";
  if (intoCard && event !== "card_payment" && event !== "refund" && event !== "cashback" && event !== "reversal" && !REFUND_WORDS.test(body)) {
    if (event) warnings.push(`Money into a credit card: card bill paid, not ${event}`);
    event = "card_payment";
  }
  if (!isCredit && event === "card_payment" && from?.account?.kind === "credit card") {
    warnings.push("A debit on a credit card is a purchase, not a card bill payment");
    event = "spend";
  }
  if (event && ((IN_ONLY.has(event) && !isCredit) || (OUT_ONLY.has(event) && isCredit))) {
    warnings.push(`"${event}" is money ${IN_ONLY.has(event) ? "in" : "out"}, but this is a ${type}; dropped`);
    event = null;
  }

  // ── How, when and with what reference ──
  let channel: Channel | null = null;
  if (obj.channel != null) {
    const c = String(obj.channel).toLowerCase() as Channel;
    if (!(CHANNELS as readonly string[]).includes(c)) warnings.push(`Channel "${String(obj.channel)}" isn't one Arth knows, dropped`);
    else if (!CHANNEL_WORDS[c].test(body)) warnings.push(`Channel ${c} isn't written in the SMS, dropped`);
    else channel = c;
  }

  const autoWritten = AUTO_WORDS.test(body) || SI_WORD.test(body);
  const auto = obj.auto === true || obj.auto === "true" ? { sure: autoWritten } : null;

  let ref: string | null = null;
  if (obj.ref != null && String(obj.ref).trim()) {
    const r = String(obj.ref).trim();
    if (r.length >= 6 && body.toLowerCase().includes(r.toLowerCase())) ref = r;
    else warnings.push(`Reference ${r} isn't written in the SMS, dropped`);
  }

  let scheme: string | null = null;
  if (typeof obj.scheme === "string" && obj.scheme.trim()) {
    if (wordsInText(obj.scheme, body)) scheme = obj.scheme.trim().slice(0, 100);
    else warnings.push(`Scheme "${obj.scheme}" isn't in the SMS, dropped`);
  }

  let time: string | null = null;
  if (obj.time != null && String(obj.time).trim()) {
    const t = String(obj.time).trim().match(/^(\d{1,2}):(\d{2})/);
    if (t && Number(t[1]) < 24 && Number(t[2]) < 60 && body.includes(`${t[1]}:${t[2]}`)) time = `${t[1].padStart(2, "0")}:${t[2]}`;
    else warnings.push(`Time ${String(obj.time)} isn't written in the SMS, dropped`);
  }

  let fx: AiReadSms["fx"] = null;
  if (obj.fx && typeof obj.fx === "object") {
    const f = obj.fx as Record<string, unknown>;
    const cur = typeof f.currency === "string" ? f.currency.toUpperCase() : "";
    const amt = toNumber(f.amount);
    if (/^[A-Z]{3}$/.test(cur) && cur !== "INR" && new RegExp(`\\b${cur}\\b`, "i").test(body) && amt != null && writtenIn(amt, body)) {
      fx = { amount: amt, currency: cur };
    } else {
      warnings.push("Foreign currency isn't written in the SMS, dropped");
    }
  }

  return {
    kind: "transaction",
    result: { type: type as AiReadSms["type"], amount: amount!, last4, merchant, balance, event, from, to, channel, auto, ref, scheme, time, fx },
    warnings,
  };
}

/** Ask the model to read one SMS. Throws when the model can't be asked or doesn't answer. */
export async function readSmsWithNano(
  body: string,
  sender: string,
  map?: MoneyMap,
): Promise<{ outcome: ReadSmsOutcome; raw: string; ms: number }> {
  const ignored = map ? ignoredAccountIn(body, map) : null;
  if (ignored) return { outcome: { kind: "ignored", account: ignored }, raw: "", ms: 0 };
  const answer = await askNano(buildReadSmsPrompt(body, sender, map), { maxOutputTokens: 200 });
  return { outcome: checkReadSmsAnswer(answer.text, body, map), raw: answer.text, ms: answer.ms };
}
