/**
 * What a payment screenshot says, from its recognised text: an expense, money received, a
 * transfer between your own accounts, or a committed payment (EMI, SIP, autopay) - with the
 * amount, date, who was paid or who paid, the account, the reference and the app it came from.
 *
 * Pure: takes the lines the phone's text recognition returned (expo-text-extractor: ML Kit on
 * Android, Vision on iPhone) and guesses. Payment screens label their fields ("Paid to", "Paid
 * from", "UPI transaction ID"), so most of this is "the line after the label". Recognition often
 * reads ₹ as 7, %, Z or F; amounts allow for that. Everything is a suggestion the user confirms on
 * the Add screen.
 */

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
  /** The account the money left (expense, transfer) or arrived in (credit). */
  account: AccountHint | null;
  /** Transfers: the other account. */
  toAccount: AccountHint | null;
  ref: string | null;
  /** Google Pay, PhonePe, Paytm, Amazon Pay, CRED, a bank's app... */
  app: string | null;
  /** True when the screenshot says the payment failed or is pending. */
  notCompleted: boolean;
}

export interface AccountHint {
  /** As written: "HDFC Bank", "Gift Cards", "Kotak Mahindra Bank". */
  label: string;
  last4: string | null;
  /** A wallet / gift card balance rather than a bank account or card. */
  wallet: boolean;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const APPS: [RegExp, string][] = [
  [/\bg\s?pay\b|google\s*pay/i, "Google Pay"],
  [/phone\s*pe/i, "PhonePe"],
  [/\bpaytm\b/i, "Paytm"],
  [/amazon\s*pay/i, "Amazon Pay"],
  [/\bcred\b/i, "CRED"],
  [/\bbhim\b/i, "BHIM"],
  [/mobikwik/i, "MobiKwik"],
  [/\bslice\b/i, "slice"],
  [/whatsapp\s*pay/i, "WhatsApp Pay"],
];

const BANKS = /\b(hdfc|icici|sbi|state bank|axis|kotak|yes bank|indusind|idfc|federal|rbl|au small finance|bank of baroda|canara|pnb|punjab national|union bank|indian bank|bandhan|dbs|hsbc|citi|standard chartered|airtel payments|paytm payments|fino|jupiter|fi\b|niyo)[a-z ]*?(?:bank)?\b/i;

/** Labels whose value is on the next line (or after a colon on the same line). */
const LABEL = {
  party: /^(?:paid to|sent to|payment to|paying|to|payee|merchant|paid successfully to|transferred to|received from|from|sender|money received from)\s*:?$/i,
  partyInline: /^(?:paid to|sent to|payment to|to|payee|merchant|transferred to|received from|money received from)\s*:?\s+(.+)$/i,
  account: /^(?:paid from|debited from|from account|from|pay(?:ment)? (?:using|via|from)|source|bank account|account|credited to|deposited to|to account|received in)\s*:?$/i,
  accountInline: /^(?:paid from|debited from|from account|pay(?:ment)? (?:using|via|from)|credited to|deposited to|received in)\s*:?\s+(.+)$/i,
  ref: /(?:upi\s*(?:transaction\s*|txn\s*|ref(?:erence)?\s*)?(?:id|no\.?|number)|utr(?:\s*no\.?)?|transaction\s*id|txn\s*id|order\s*id|reference\s*(?:id|no\.?|number)|ref\.?\s*no\.?|google\s*transaction\s*id)\s*:?\s*([A-Za-z0-9-]{6,})?/i,
};

const isAmountish = (l: string) => /^[₹%7zZfF*]?\s*(?:rs\.?|inr)?\s*[\d,]+(?:\.\d{1,2})?$/i.test(l.trim());
const isDateish = (l: string) => parseDate(l) != null || /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i.test(l);
const isStatus = (l: string) =>
  /^(?:paid|payment|transaction|money|amount)?\s*(?:successful(?:ly)?|success|completed|done|received|sent|paid|failed|pending|processing|declined)\b/i.test(l) ||
  /^(?:paid|sent|received)\s+successfully$/i.test(l);

function clean(lines: string[]): string[] {
  return lines
    .flatMap((l) => l.split(/\r?\n/))
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
}

function money(raw: string): number | null {
  const n = Number(raw.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 1e9 ? n : null;
}

/** The transaction amount: after ₹ / Rs / INR, or a line that's only an amount - not a balance or cashback. */
function findAmount(lines: string[]): number | null {
  const skip = /balance|bal\b|cashback|reward|limit|coins?|points?|saved|discount|fee waived/i;
  const candidates: { value: number; at: number; strong: boolean }[] = [];
  lines.forEach((l, i) => {
    if (skip.test(l) || skip.test(lines[i - 1] ?? "")) return;
    const re = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/gi;
    for (let m = re.exec(l); m; m = re.exec(l)) {
      const v = money(m[1]);
      if (v) candidates.push({ value: v, at: i, strong: true });
    }
    // A line that's just the amount, possibly with ₹ misread as 7 % Z F *.
    // Without a symbol it needs a comma or decimal point: bare digit runs are ids and phone numbers.
    const only = l.match(/^([₹%zZfF*]|7(?=\s?[\d,]+\.\d{2}$))?\s*([\d,]+(?:\.\d{1,2})?)$/);
    if (only && (only[1] || /[,.]/.test(only[2]))) {
      const v = money(only[2]);
      if (v) candidates.push({ value: v, at: i, strong: !!only[1] });
    }
  });
  if (candidates.length === 0) return null;
  // Near the status line ("Paid successfully") first, then the first strong one.
  const statusAt = lines.findIndex(isStatus);
  if (statusAt >= 0) {
    const near = candidates.filter((c) => Math.abs(c.at - statusAt) <= 2).sort((a, b) => Math.abs(a.at - statusAt) - Math.abs(b.at - statusAt));
    if (near.length) return near[0].value;
  }
  return (candidates.find((c) => c.strong) ?? candidates[0]).value;
}

export function parseDate(text: string, today: Date = new Date()): string | null {
  const t = text.toLowerCase();
  const iso = (y: number, m: number, d: number) =>
    m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  let m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,4})[a-z]*,?\s+(\d{2,4})\b/);
  if (m && MONTHS[m[2]]) return iso(year(m[3]), MONTHS[m[2]], Number(m[1]));
  m = t.match(/\b([a-z]{3,4})[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && MONTHS[m[1]]) return iso(Number(m[3]), MONTHS[m[1]], Number(m[2]));
  m = t.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
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

function parseTime(text: string): string | null {
  const m = text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\b/i);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return h < 24 ? `${String(h).padStart(2, "0")}:${m[2]}` : null;
}

function accountFrom(text: string): AccountHint | null {
  const t = text.trim();
  if (!t) return null;
  const digits = t.match(/(?:[x*•·]{2,}\s*|ending\s*(?:with\s*)?|a\/c\s*(?:no\.?\s*)?|\s)(\d{4})\b/i)?.[1] ?? null;
  const wallet = /gift\s*card|wallet|upi\s*lite|balance|pay\s*later|cash/i.test(t);
  const bank = t.match(BANKS)?.[0]?.trim();
  const label = (bank ?? t.replace(/[x*•·]{2,}\s*\d{4}/i, "").replace(/\s+/g, " ").trim()) || t;
  if (!digits && !wallet && !bank) return null;
  return { label: label.slice(0, 40), last4: digits, wallet };
}

/** The value on the line after a label line, skipping amounts, dates and status lines. */
function after(lines: string[], i: number): string | null {
  for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
    const v = lines[j];
    if (!isAmountish(v) && !isDateish(v) && !isStatus(v) && !Object.values(LABEL).some((re) => re.test(v) && re !== LABEL.ref)) return v;
  }
  return null;
}

export function readReceipt(rawLines: string[], today: Date = new Date()): ReceiptGuess {
  const lines = clean(rawLines);
  const all = lines.join("\n");

  // Kind, from the strongest wording.
  let kind: ReceiptKind = "expense";
  if (/self\s*transfer|to\s*self\b|own\s*account|between\s*your\s*accounts|transferred\s*to\s*your\s*(?:own\s*)?(?:account|a\/c)/i.test(all)) kind = "transfer";
  else if (/\bemi\b|auto\s*-?\s*pay|auto\s*-?\s*debit|e?-?mandate|\bsip\b|systematic\s*investment|mutual\s*fund|loan\s*(?:repayment|instal)|instal+ment/i.test(all)) kind = "committed";
  else if (/received\s*from|money\s*received|you\s*received|credited\s*(?:to|in)|refund(?:ed)?\s*(?:of|to|credited)|cashback\s*(?:of|received)|payment\s*received/i.test(all)) kind = "credit";

  const notCompleted = /\b(?:failed|declined|pending|processing|unsuccessful|cancelled|canceled)\b/i.test(all) && !/\bsuccess(?:ful(?:ly)?)?\b/i.test(all);

  // Party, account, other account.
  let party: string | null = null;
  const accounts: AccountHint[] = [];
  lines.forEach((l, i) => {
    const pin = l.match(LABEL.partyInline);
    if (!party && pin && !LABEL.account.test(l)) {
      const v = pin[1].replace(/^:\s*/, "");
      if (!isAmountish(v)) {
        const acct = accountFrom(v);
        if (kind === "transfer" && acct) accounts.push(acct);
        else party = v;
      }
    } else if (!party && LABEL.party.test(l)) {
      const v = after(lines, i);
      if (v) {
        const acct = accountFrom(v);
        if ((kind === "transfer" || /^from$/i.test(l)) && acct && (acct.last4 || acct.wallet)) accounts.push(acct);
        else party = v;
      }
    }
    const ain = l.match(LABEL.accountInline);
    if (ain) {
      const a = accountFrom(ain[1]);
      if (a) accounts.push(a);
    } else if (LABEL.account.test(l)) {
      const v = after(lines, i);
      const a = v ? accountFrom(v) : null;
      if (a) accounts.push(a);
    }
  });
  // Masked digits anywhere ("HDFC Bank •••• 0221") when no label gave an account.
  if (accounts.length === 0) {
    for (const l of lines) {
      if (/[x*•·]{2,}\s*\d{4}\b/i.test(l)) {
        const a = accountFrom(l);
        if (a) accounts.push(a);
      }
    }
  }
  const uniq = accounts.filter((a, i) => accounts.findIndex((b) => b.label === a.label && b.last4 === a.last4) === i);

  // Reference.
  let ref: string | null = null;
  for (let i = 0; i < lines.length && !ref; i++) {
    const m = lines[i].match(LABEL.ref);
    if (!m) continue;
    ref = m[1] && /\d/.test(m[1]) ? m[1] : (lines[i + 1]?.match(/^[A-Za-z0-9-]{6,}$/)?.[0] ?? null);
  }

  // Date and time: the first line that has them.
  let date: string | null = null;
  let time: string | null = null;
  for (const l of lines) {
    date ??= parseDate(l, today);
    time ??= parseTime(l);
    if (date && time) break;
  }

  const app = APPS.find(([re]) => re.test(all))?.[1] ?? null;

  return {
    kind,
    amount: findAmount(lines),
    date,
    time,
    party: party ? party.replace(/\s*[x*•·]{2,}\s*\d{4}$/, "").slice(0, 60) : null,
    account: uniq[0] ?? null,
    toAccount: kind === "transfer" ? uniq[1] ?? null : null,
    ref,
    app,
    notCompleted,
  };
}
