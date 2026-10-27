/**
 * What a payment screenshot says, from its recognised text: an expense, money received, a
 * transfer between your own accounts, or a committed payment (EMI, SIP, autopay) - with the
 * amount, date, who was paid or who paid, their UPI address, the account, the reference and the app.
 *
 * Pure. Input is what the phone's text recognition returned (modules/arth-text-reader: ML Kit on
 * Android, Vision on iPhone) - lines with their position and size on screen - or plain lines.
 *
 * Label first (the approach that holds up across layouts, after vetrisuriya/ledgerlens): payment
 * receipts print headings ("Paid to", "Debited from", "UPI transaction ID") and the value sits beside
 * or beneath. Lessons from expenseMonster's parser tests: the status bar clock is not the payment
 * time; Google Pay's "From NAME" at the top is money received; a payee's @paytm address doesn't make
 * the screenshot Paytm; PhonePe puts the amount between "Paid to" and the name; recognition reads ₹
 * as 7, %, Z or F. A field that can't be read with confidence is left empty, never guessed - the
 * Add screen shows what was read and the user confirms everything.
 */

import type { TextLine } from "../../modules/arth-text-reader";

export type ReceiptKind = "expense" | "credit" | "transfer" | "committed";

export interface ReceiptGuess {
  kind: ReceiptKind;
  amount: number | null;
  /** YYYY-MM-DD */
  date: string | null;
  /** HH:mm, 24-hour */
  time: string | null;
  /** Who was paid (expense, committed) or who paid you (credit). */
  party: string | null;
  /** The other side's UPI address, when shown ("ramesh.k@okaxis"). */
  vpa: string | null;
  /** The user's own UPI address, when shown (under "From" on a payment) - picks the account. */
  ownVpa: string | null;
  /** The payment's note, when it has one ("Crunch Daycare" under the amount). */
  note: string | null;
  /** The account the money left (expense, transfer) or arrived in (credit). */
  account: AccountHint | null;
  /** Transfers: the other account. */
  toAccount: AccountHint | null;
  ref: string | null;
  /** Google Pay, PhonePe, Paytm, Amazon Pay, CRED, BHIM, a bank's app... */
  app: string | null;
  /** True when the screenshot says the payment failed or is pending. */
  notCompleted: boolean;
  /** Everything that was read, in reading order - for "Show what was read". */
  text: string;
}

export interface AccountHint {
  /** As written: "HDFC Bank", "Gift Cards", "Kotak Mahindra Bank". */
  label: string;
  last4: string | null;
  /** A wallet / gift card balance rather than a bank account or card. */
  wallet: boolean;
}

/** A line of the screenshot; position and size are fractions of the image (0..1), when known. */
interface Line {
  text: string;
  y: number;
  height: number;
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * The month a word names: "Oct", "Sept", "October" - any start of a month's name, three letters
 * or more. Null for anything else ("Octopus"). Taking only the first three or four letters missed
 * every month written in full: "24 October 2026" (PhonePe) read as no date.
 */
function monthOf(word: string): number | null {
  if (word.length < 3) return null;
  const i = MONTH_NAMES.findIndex((name) => name.startsWith(word));
  return i >= 0 ? i + 1 : null;
}

const APPS: [RegExp, string][] = [
  [/\bg\s?pay\b|google\s*pay|google\s*transaction\s*id/i, "Google Pay"],
  [/phone\s*pe|transfer\s*details|transaction\s*id\s*:?\s*T\d{18,}/i, "PhonePe"],
  [/amazon\s*pay/i, "Amazon Pay"],
  [/\bpaytm\b/i, "Paytm"],
  [/\bcred\b/i, "CRED"],
  [/\bbhim\b/i, "BHIM"],
  [/mobikwik/i, "MobiKwik"],
  [/whatsapp\s*pay/i, "WhatsApp Pay"],
  [/\bslice\b/i, "slice"],
  [/\bnavi\b/i, "Navi"],
  [/super\.?money/i, "super.money"],
];

const BANKS =
  /\b(?:hdfc|icici|sbi|state bank(?: of india)?|axis|kotak(?: mahindra)?|yes bank|indusind|idfc(?: first)?|federal|rbl|au small finance|bank of baroda|canara|pnb|punjab national|union bank|indian bank|bandhan|dbs|hsbc|citi|standard chartered|airtel payments|paytm payments|fino|jupiter|niyo|equitas|ujjivan)(?:\s*bank)?\b/i;

export const VPA = /\b([a-z0-9][a-z0-9._-]{1,60}@[a-z][a-z0-9.]{1,30})\b/i;

/** Label lines whose value follows on the next line, or after the label on the same line. */
const PARTY_LABEL = /^(?:paid to|sent to|payment to|paying|to|payee|merchant|paid successfully to|transferred to|received from|from|sender|money received from)\s*:?$/i;
const PARTY_INLINE = /^(?:paid to|sent to|payment to|to|payee|merchant|transferred to|received from|money received from|from)\s*:?\s+(.+)$/i;
const ACCOUNT_LABEL = /^(?:paid from|debited from|from account|pay(?:ment)? (?:using|via|from)|source|bank account|credited to|deposited to|to account|received in|paid using)\s*:?$/i;
const ACCOUNT_INLINE = /^(?:paid from|debited from|from account|pay(?:ment)? (?:using|via|from)|credited to|deposited to|received in|paid using)\s*:?\s+(.+)$/i;
const REF =
  /(?:upi\s*(?:transaction\s*|txn\s*|ref(?:erence)?\s*)?(?:id|no\.?|number)|utr(?:\s*no\.?)?|transaction\s*id|txn\s*id|tr\.?\s*id|order\s*id|reference\s*(?:id|no\.?|number)|ref\.?\s*no\.?)\s*:?\s*([A-Za-z0-9-]{6,})?/i;

const AMOUNTISH = /^(?:[₹%zZfF*]|rs\.?|inr)?\s*[\d,]+(?:\.\d{1,2})?$/i;
const isAmountish = (l: string) => AMOUNTISH.test(l.trim());
const isStatus = (l: string) =>
  /^(?:payment|transaction|money|amount|transfer|autopay)?\s*(?:successful(?:ly)?|success|completed|done|received|sent|paid|failed|pending|processing|declined)\b/i.test(l) ||
  /^(?:paid|sent|received)\s+successfully$/i.test(l) ||
  /^(?:transaction|payment)\s+(?:successful|failed|pending)/i.test(l);
const isLabel = (l: string) => PARTY_LABEL.test(l) || ACCOUNT_LABEL.test(l) || /^(?:upi\s*transaction\s*id|transaction\s*id|utr|order\s*id|date|time|date and time|note|message)\s*:?$/i.test(l);

/** Status bar bits at the very top of a screenshot: the clock, network, battery. */
const STATUS_BAR = /^(?:\d{1,2}:\d{2}|vo\s*lte|lte|5g|4g|\d{1,3}%?|[\s|•·⋅*]+|wi-?fi)$/i;

function toLines(input: (string | TextLine)[]): Line[] {
  if (input.length === 0) return [];
  if (typeof input[0] === "string") {
    return (input as string[])
      .flatMap((l) => l.split(/\r?\n/))
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((text, i) => ({ text, y: i / 1000, height: 0 }));
  }
  // Join text on the same row, left to right ("Order ID" .... "P04-266…").
  return pictureRows(input as TextLine[]).map((parts) => ({
    text: parts.map((p) => p.text).join(" "),
    y: parts[0].y,
    height: Math.max(...parts.map((p) => p.height)),
  }));
}

/**
 * The picture's text in reading order, as rows of pieces left to right, without the status bar
 * (short clock / signal / battery bits in the top 4%). Shared with image templates.
 */
export function pictureRows(input: TextLine[]): TextLine[][] {
  const raw = input.filter((l) => l.text.trim()).map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }));
  const body = raw.filter((l) => !(l.y < 0.04 && STATUS_BAR.test(l.text)));
  body.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: TextLine[][] = [];
  for (const l of body) {
    const row = rows[rows.length - 1];
    const ref = row?.[0];
    if (ref && Math.abs(l.y - ref.y) < Math.max(ref.height, l.height) * 0.5) row.push(l);
    else rows.push([l]);
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x));
}

export function money(raw: string): number | null {
  const n = Number(raw.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 1e9 ? n : null;
}

/** The payment amount: after ₹/Rs/INR or a line that's only an amount; biggest on screen first; never a balance or cashback. */
function findAmount(lines: Line[]): number | null {
  const skip = /balance|bal\b|cashback|reward|limit|coins?|points?|saved|discount|fee waived|scratch/i;
  const found: { value: number; at: number; strong: boolean; height: number }[] = [];
  lines.forEach((l, i) => {
    if (skip.test(l.text) || skip.test(lines[i - 1]?.text ?? "")) return;
    const re = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/gi;
    for (let m = re.exec(l.text); m; m = re.exec(l.text)) {
      const v = money(m[1]);
      if (v) found.push({ value: v, at: i, strong: true, height: l.height });
    }
    // Just an amount, possibly with ₹ misread as 7 % Z F *. Without a symbol it needs a comma or
    // decimal point: bare digit runs are ids and phone numbers.
    const only = l.text.match(/^([₹%zZfF*]|7(?=\s?[\d,]+\.\d{2}$))?\s*([\d,]+(?:\.\d{1,2})?)$/);
    if (only && (only[1] || /[,.]/.test(only[2]))) {
      const v = money(only[2]);
      if (v) found.push({ value: v, at: i, strong: !!only[1], height: l.height });
    }
  });
  if (found.length === 0) return null;
  // With sizes: the tallest amount is the headline.
  const tallest = Math.max(...found.map((f) => f.height));
  if (tallest > 0) {
    const big = found.filter((f) => f.height >= tallest * 0.85);
    if (big.length) return big[0].value;
  }
  // Without: the one nearest the status line ("Paid successfully"), else the first with a ₹.
  const statusAt = lines.findIndex((l) => isStatus(l.text));
  if (statusAt >= 0) {
    const near = found.filter((f) => Math.abs(f.at - statusAt) <= 2).sort((a, b) => Math.abs(a.at - statusAt) - Math.abs(b.at - statusAt));
    if (near.length) return near[0].value;
  }
  return (found.find((f) => f.strong) ?? found[0]).value;
}

export function parseDate(text: string, today: Date = new Date()): string | null {
  const t = text.toLowerCase();
  const iso = (y: number, m: number, d: number) =>
    m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  // "18 Oct 2026", "18th October, 26", "18 Oct '26" (ICICI iMobile), "24 October 2026 at 3:11 PM"
  // (PhonePe).
  // Every candidate, not just the first: "12 items 2026" earlier on the line mustn't hide the date.
  for (const c of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+['’]?(\d{2,4})\b/g)) {
    const month = monthOf(c[2]);
    if (month) return iso(year(c[3]), month, Number(c[1]));
  }
  // "October 24, 2026", "Oct 24 2026".
  for (const c of t.matchAll(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+['’]?(\d{4})\b/g)) {
    const month = monthOf(c[1]);
    if (month) return iso(Number(c[3]), month, Number(c[2]));
  }
  let m = t.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (m) return iso(year(m[3]), Number(m[2]), Number(m[1]));
  m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  if (/\btoday\b/.test(t)) return iso(today.getFullYear(), today.getMonth() + 1, today.getDate());
  if (/\byesterday\b/.test(t)) {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    return iso(y.getFullYear(), y.getMonth() + 1, y.getDate());
  }
  return null;
}

export function parseTime(text: string): string | null {
  const m = text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\b/i);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return h < 24 ? `${String(h).padStart(2, "0")}:${m[2]}` : null;
}

export function accountFrom(text: string): AccountHint | null {
  const t = text.trim();
  if (!t) return null;
  const digits =
    t.match(/(?:[x*•·]{2,}\s*|ending\s*(?:with\s*)?|a\/c\s*(?:no\.?\s*)?)(\d{4})\b/i)?.[1] ??
    t.match(/\b(?:bank|card)\s+(\d{4})\b/i)?.[1] ??
    null;
  const wallet = /gift\s*card|wallet|upi\s*lite|pay\s*later|\bcash\b/i.test(t);
  const bank = t.match(BANKS)?.[0]?.trim();
  if (!digits && !wallet && !bank) return null;
  const label = (bank ?? t.replace(/[x*•·]{2,}\s*\d{4}/i, "").replace(/\s+/g, " ").trim()) || t;
  return { label: label.slice(0, 40), last4: digits, wallet };
}

/** The value on the line after a label, skipping amounts, dates, statuses, addresses and other labels. */
function after(lines: Line[], i: number, allowAccount = false): string | null {
  for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
    const v = lines[j].text;
    if (isAmountish(v) || isStatus(v) || isLabel(v) || parseDate(v) || /^\+?\d[\d\s-]{8,}$/.test(v) && !allowAccount) continue;
    if (VPA.test(v) && v.match(VPA)![0].length >= v.length - 2) continue;
    return v;
  }
  return null;
}

/** "SHREE GANESH MEDICALS" -> "Shree Ganesh Medicals"; mixed case is left alone. */
export function tidyName(name: string): string {
  const n = name.replace(/\s*[x*•·]{2,}\s*\d{4}$/, "").replace(/\s*\((?:[^)]*bank[^)]*)\)\s*$/i, "").trim();
  if (n !== n.toUpperCase() || !/[A-Z]/.test(n)) return n;
  return n.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

export function readReceipt(input: (string | TextLine)[], today: Date = new Date()): ReceiptGuess {
  const lines = toLines(input);
  const text = lines.map((l) => l.text).join("\n");
  // App and kind are read without UPI addresses ("chaipoint@paytm" isn't a Paytm screenshot).
  const words = text.replace(new RegExp(VPA.source, "gi"), " ");

  // Kind, from the strongest wording; then Google Pay's "To NAME" / "From NAME" headline.
  let kind: ReceiptKind = "expense";
  const top = lines.slice(0, Math.max(4, Math.ceil(lines.length * 0.35)));
  if (/self\s*transfer|to\s*self\b|own\s*account|between\s*your\s*accounts|transferred\s*to\s*your\s*(?:own\s*)?(?:account|a\/c)/i.test(words)) kind = "transfer";
  else if (/\bemi\b|auto\s*-?\s*pay|auto\s*-?\s*debit|e?-?mandate|\bsip\b|systematic\s*investment|mutual\s*fund|loan\s*(?:repayment|instal)|instal+ment/i.test(words)) kind = "committed";
  else if (/received\s*(?:from|successfully)|money\s*received|you\s*received|credited\s*(?:to|in)|refund(?:ed)?\s*(?:of|to|credited)|cashback\s*(?:of|received)|payment\s*received/i.test(words)) kind = "credit";
  else if (top.some((l) => /^from\s+\S/i.test(l.text)) && !top.some((l) => /^(?:to|paid to)\s+\S/i.test(l.text))) kind = "credit";

  const notCompleted = /\b(?:failed|declined|pending|processing|unsuccessful|cancelled|canceled)\b/i.test(words) && !/\bsuccess(?:ful(?:ly)?)?\b|completed/i.test(words);

  // Who: for money received the payer ("from"), otherwise the payee ("to").
  const wantFrom = kind === "credit";
  let party: string | null = null;
  const accounts: AccountHint[] = [];
  lines.forEach((l, i) => {
    const t = l.text;
    const inline = t.match(PARTY_INLINE);
    const isFrom = /^(?:from|received from|money received from|sender)\b/i.test(t);
    const sideOk = kind === "transfer" || isFrom === wantFrom;
    if (inline && !ACCOUNT_INLINE.test(t)) {
      const v = inline[1].replace(/^:\s*/, "").trim();
      const acct = accountFrom(v);
      if (kind === "transfer" && acct) accounts.push(acct);
      else if (!party && sideOk && !isAmountish(v)) party = v;
      else if (acct && (acct.last4 || acct.wallet) && !sideOk) accounts.push(acct);
    } else if (PARTY_LABEL.test(t)) {
      const v = after(lines, i);
      if (v) {
        const acct = accountFrom(v);
        if (kind === "transfer" && acct) accounts.push(acct);
        else if (!party && sideOk) party = v;
        else if (acct && (acct.last4 || acct.wallet)) accounts.push(acct);
      }
    }
    const ain = t.match(ACCOUNT_INLINE);
    if (ain) {
      const a = accountFrom(ain[1]);
      if (a) accounts.push(a);
    } else if (ACCOUNT_LABEL.test(t)) {
      const v = after(lines, i, true);
      const a = v ? accountFrom(v) : null;
      if (a) accounts.push(a);
    }
  });
  // Masked digits anywhere ("HDFC Bank •••• 0221", "XXXXXXXX1234") when no label gave an account.
  if (accounts.length === 0) {
    for (const l of lines) {
      if (/[x*•·]{2,}\s*\d{4}\b|\b(?:bank|card)\s+\d{4}\b/i.test(l.text)) {
        const a = accountFrom(l.text);
        if (a) accounts.push(a);
      }
    }
  }
  // A bank named without digits ("From: PRANAV N (HDFC Bank)") takes them from a line naming the
  // same bank with them ("HDFC Bank 1234").
  for (const acct of accounts) {
    if (acct.last4 || acct.wallet) continue;
    const bank = acct.label.match(BANKS)?.[0]?.toLowerCase();
    if (!bank) continue;
    for (const l of lines) {
      if (!l.text.toLowerCase().includes(bank.split(" ")[0])) continue;
      const d = accountFrom(l.text)?.last4;
      if (d) {
        acct.last4 = d;
        break;
      }
    }
  }
  const distinct = accounts.filter((a, i) => accounts.findIndex((b) => b.label === a.label && b.last4 === a.last4) === i);
  // One with digits (or a wallet) beats a bank name alone - except for transfers, where order is from, then to.
  const uniq = kind === "transfer" ? distinct : [...distinct].sort((a, b) => Number(!!b.last4 || b.wallet) - Number(!!a.last4 || a.wallet));

  // UPI addresses, by whose they are: the nearest "To" / "From" line at or above says. Theirs is the
  // first that doesn't sit under the user's side; the user's own is the one that does (Google Pay and
  // bank apps show both). For a transfer both are the user's: from, then to.
  let vpa: string | null = null;
  let ownVpa: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(VPA);
    if (!m) continue;
    const id = m[1].toLowerCase();
    const owner = [lines[i], lines[i - 1], lines[i - 2]].find((x) => x && /^(?:to|from|paid to|paid from|received from|credited to|debited from)\b/i.test(x.text));
    const ownerIsFrom = owner ? /^(?:from|paid from|received from|debited from)\b/i.test(owner.text) : null;
    if (kind === "transfer") {
      if (!ownVpa && ownerIsFrom !== false) ownVpa = id;
      else if (!vpa && id !== ownVpa) vpa = id;
    } else if (ownerIsFrom !== null && ownerIsFrom !== wantFrom) {
      if (!ownVpa) ownVpa = id;
    } else if (!vpa) {
      vpa = id;
    }
  }

  // The payment's note: a short line right under the amount that isn't a status, label, name line,
  // address, date or number ("Crunch Daycare").
  let note: string | null = null;
  const amountAt = lines.findIndex((l) => /(?:₹|rs\.?|inr)\s*[\d,]+/i.test(l.text) || isAmountish(l.text));
  const next = amountAt >= 0 ? lines[amountAt + 1]?.text : undefined;
  if (
    next &&
    next.length <= 30 &&
    next.split(" ").length <= 4 &&
    /[a-z]/i.test(next) &&
    !isStatus(next) &&
    !isLabel(next) &&
    !isAmountish(next) &&
    !VPA.test(next) &&
    !parseDate(next, today) &&
    !/^(?:to|from|paid|sent|received|you|please|via|on|at)\b/i.test(next) &&
    !/\d{4,}/.test(next)
  ) {
    note = next;
  }

  // Reference: the UTR / UPI reference first (what a bank can trace), else any transaction / order id.
  let ref: string | null = null;
  for (let i = 0; i < lines.length && !ref; i++) {
    const m = lines[i].text.match(REF);
    if (!m) continue;
    ref = m[1] && /\d/.test(m[1]) ? m[1] : (lines[i + 1]?.text.match(/^[A-Za-z0-9-]{6,}$/)?.[0] ?? null);
  }

  // Date, and the time from the same line when it has one (never the status bar clock).
  let date: string | null = null;
  let time: string | null = null;
  for (const l of lines) {
    const d = parseDate(l.text, today);
    if (d) {
      date = d;
      time = parseTime(l.text);
      break;
    }
  }
  if (date && !time) {
    for (const l of lines) {
      if (/\b(?:am|pm)\b|\d{1,2}:\d{2}:\d{2}/i.test(l.text)) {
        time = parseTime(l.text);
        if (time) break;
      }
    }
  }

  let app = APPS.find(([re]) => re.test(words))?.[1] ?? null;
  // A bank's own app (ICICI iMobile, HDFC, SBI YONO...): its name heads the screen and no payment
  // app is named. The money left (or arrived in) an account at that bank.
  const headBank = lines.slice(0, 4).map((l) => l.text.match(BANKS)?.[0]).find(Boolean);
  if (!app && headBank) {
    const name = headBank
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map((w) => (/^(?:hdfc|icici|sbi|idfc|rbl|pnb|dbs|hsbc|au)$/.test(w) ? w.toUpperCase() : w === "of" ? w : w[0].toUpperCase() + w.slice(1)))
      .join(" ");
    const bankName = /\bbank\b/i.test(name) ? name : `${name} Bank`;
    app = bankName;
    if (uniq.length === 0 && kind !== "transfer") uniq.push({ label: bankName, last4: null, wallet: false });
  }

  return {
    kind,
    amount: findAmount(lines),
    date,
    time,
    party: party ? tidyName(party).slice(0, 60) : null,
    vpa,
    ownVpa,
    note,
    account: uniq[0] ?? null,
    toAccount: kind === "transfer" ? (uniq[1] ?? null) : null,
    ref,
    app,
    notCompleted,
    text,
  };
}
