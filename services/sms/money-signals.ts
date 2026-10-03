/**
 * Money signals — pure helpers that read "what kind of money movement is this?"
 * out of a bank SMS, on top of what the bank pattern already extracted.
 *
 *   - FD/TD events: a debit that funds a deposit, a credit that closes one.
 *   - Counterparty names: "transfer from Mr. SOURAVBAID", "linked to mobile …-SOURAV BAI".
 *   - Self-name matching: banks truncate and squash names, so "SOURAV BAI",
 *     "SOURAVBAID" and "Mr. SOURAV BAID" must all match "Sourav Baid".
 *
 * No DB access here — sms-to-expense and the settings layer decide what to do.
 */

export type FdEvent = "open" | "closure";

const FD_OPEN_PATTERNS: RegExp[] = [
  /\bFD\s+through\b/i,
  /\bFD\s+booked\b/i,
  /\btowards\s+(?:FD|fixed\s+deposit|TD|term\s+deposit)\b/i,
  /\bto\s+(?:TD|FD)\s+A\/c\b/i,
  /\be-?TDR\b/i,
  /\bfixed\s+deposit\b[\s\S]{0,40}?\b(?:opened|created|booked)\b/i,
  /\b(?:TD|FD|term\s+deposit)\b[\s\S]{0,20}?\bopened\b/i,
  /\bRD\s+instal/i,
];

const FD_CLOSURE_PATTERNS: RegExp[] = [
  /\bclosure\s+of\s+(?:TD|FD|RD|term\s+deposit|fixed\s+deposit)\b/i,
  /\b(?:TD|FD|fixed\s+deposit|term\s+deposit)\b[\s\S]{0,40}?\b(?:matured|maturity|closed|closure)\b/i,
  /\bmaturity\s+proceeds\b/i,
  /\bpremature\s+(?:closure|withdrawal)\b/i,
];

const DEBIT_TYPES = new Set(["debit", "upi_debit", "nach_debit", "standing_instruction"]);
const CREDIT_TYPES = new Set(["credit", "upi_credit"]);

/**
 * Classify a parsed SMS as an FD funding debit or an FD closure credit.
 * `fdNumber` is the deposit account's trailing digits when the SMS names it
 * ("Closure of TD A/c XXXXX031705" → "031705").
 */
export function detectFdEvent(
  body: string,
  type: string,
): { fdEvent: FdEvent | null; fdNumber: string | null } {
  let fdEvent: FdEvent | null = null;
  if (DEBIT_TYPES.has(type) && FD_OPEN_PATTERNS.some((rx) => rx.test(body))) fdEvent = "open";
  else if (CREDIT_TYPES.has(type) && FD_CLOSURE_PATTERNS.some((rx) => rx.test(body))) fdEvent = "closure";
  if (!fdEvent) return { fdEvent: null, fdNumber: null };

  const num = body.match(/\b(?:TD|FD|RD|deposit)\s*(?:A\/c|Acc(?:ount)?|No\.?)\s*(?:no\.?\s*)?[X*x]*(\d{3,})/i);
  return { fdEvent, fdNumber: num ? num[1] : null };
}

const HONORIFIC = /^(?:mr|mrs|ms|miss|dr|shri|smt|m\/s)\.?\s+/i;

/** Clean a captured name: drop honorifics and trailing punctuation/refs, squash spaces. */
export function cleanCounterpartyName(raw: string): string | null {
  let s = raw.replace(/\s{2,}/g, " ").trim();
  s = s.replace(/\s*\((?:IMPS|NEFT|UPI|RTGS)?\s*Ref[\s\S]*$/i, "");
  s = s.replace(/[.\s-]+$/, "").trim();
  // "Mr. SOURAVBAID" and "Mr.SOURAVBAID" both lose the title.
  s = s.replace(HONORIFIC, "").replace(/^(?:mr|mrs|ms)\.(?=\S)/i, "").trim();
  if (s.length < 3 || !/[A-Za-z]{3}/.test(s)) return null;
  return s;
}

/**
 * Pull the other party's name out of a narration fragment such as
 * "-Deposit by transfer from Mr. SOURAVBAID", "Transferred to Mr. X",
 * "by a/c linked to mobile 9XXXXXX963-SOURAV BAI (IMPS Ref# …)".
 */
export function extractCounterpartyName(text: string): string | null {
  const linked = text.match(/linked\s+to\s+mobile\s+[\dX*x]+\s*-\s*([^()\n]+)/i);
  if (linked) return cleanCounterpartyName(linked[1]);
  const fromTo = text.match(/(?:transfer(?:red)?\s+(?:from|to)|trf\s+(?:from|to)|deposit\s+by\s+transfer\s+from)\s+([^.\n(]+(?:\.\s?[A-Za-z][^.\n(]*)?)/i);
  if (fromTo) return cleanCounterpartyName(fromTo[1]);
  return null;
}

/** Uppercase, strip honorifics and everything that isn't a letter. */
export function normalizeName(name: string): string {
  return name
    .trim()
    .replace(HONORIFIC, "")
    .replace(/^(?:mr|mrs|ms)\.(?=\S)/i, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

/** Shortest normalised length at which a prefix match counts (avoids "RAM" matching "RAMESH"). */
const MIN_PREFIX_LEN = 8;

/**
 * Does `candidate` (from an SMS) refer to the same person as `selfName`?
 * Equal after normalising, or one is a prefix of the other with ≥ 8 letters
 * (bank truncation: "SOURAV BAI" for "SOURAV BAID").
 */
export function namesMatch(candidate: string, selfName: string): boolean {
  const a = normalizeName(candidate);
  const b = normalizeName(selfName);
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= MIN_PREFIX_LEN && longer.startsWith(shorter);
}

export function matchesAnySelfName(candidate: string | null | undefined, selfNames: readonly string[]): boolean {
  if (!candidate) return false;
  return selfNames.some((n) => namesMatch(candidate, n));
}

// ─── SIP detection ───────────────────────────────────────────────────────────

/** Fund houses as they appear in NACH / autopay narrations. Matched as whole words. */
const AMC_NAMES = [
  "ADITYA BIRLA SUN LIFE", "ABSL", "AXIS", "BAJAJ FINSERV", "BANDHAN", "BANK OF INDIA", "BARODA BNP PARIBAS",
  "CANARA ROBECO", "DSP", "EDELWEISS", "FRANKLIN TEMPLETON", "GROWW", "HDFC", "HELIOS", "HSBC", "ICICI PRUDENTIAL",
  "ICICI PRU", "INVESCO", "ITI", "JM FINANCIAL", "KOTAK", "LIC", "MAHINDRA MANULIFE", "MIRAE ASSET", "MIRAE",
  "MOTILAL OSWAL", "NAVI", "NIPPON INDIA", "NJ", "OLD BRIDGE", "PGIM INDIA", "PPFAS", "PARAG PARIKH", "QUANT",
  "QUANTUM", "SAMCO", "SBI", "SHRIRAM", "SUNDARAM", "TATA", "TAURUS", "TRUST", "UNION", "UTI", "WHITEOAK", "ZERODHA",
];

/** Clearing houses, registrars and MF platforms that only ever collect for mutual funds. */
const MF_COLLECTORS: RegExp[] = [
  /\bBSE\s*STAR\s*MF\b/i,
  /\bBSE\s*LTD\b/i,
  /\bNSE\s*(?:MFSS|CLEARING)\b/i,
  /\bNSE\s*CLG\b/i,
  /\bICCL\b/i,
  /\bINDIAN\s+CLEARING\s+CORP/i,
  /\bCAMS\b/i,
  /\bKFIN/i,
  /\bKARVY\b/i,
  /\bMF\s*UTILIT/i,
  /\bZERODHA\s*COIN\b/i,
  /\bKUVERA\b/i,
  /\bPAYTM\s*MONEY\b/i,
  /\bET\s*MONEY\b/i,
  /\bGROWW\b/i,
];

const AMC_RX = new RegExp(
  `\\b(?:${AMC_NAMES.map((n) => n.replace(/\s+/g, "\\s*")).join("|")})\\s*(?:MUTUAL\\s*FUND|MF|AMC|ASSET\\s+MANAGEMENT)\\b`,
  "i",
);

const SIP_ELIGIBLE_TYPES = new Set(["nach_debit", "standing_instruction", "debit", "upi_debit"]);

/**
 * Is this debit a mutual-fund SIP? Auto-debit (NACH / SI / UPI autopay) types
 * qualify on a collector or "<AMC> Mutual Fund/MF" match; a plain debit only
 * when the SMS also says SIP / mandate / autopay, so a one-off lump-sum
 * purchase on a fund website isn't misread as a SIP.
 */
export function detectSip(type: string, merchant: string | null, body: string): boolean {
  if (!SIP_ELIGIBLE_TYPES.has(type)) return false;
  const text = `${merchant ?? ""} ${body}`;
  const isMf = MF_COLLECTORS.some((rx) => rx.test(text)) || AMC_RX.test(text);
  if (!isMf) return false;
  if (type === "nach_debit" || type === "standing_instruction") return true;
  return /\b(?:SIP|NACH|ACH|mandate|auto-?pay|e-?mandate)\b/i.test(body);
}

/** Best display name for the fund house / platform behind a SIP debit. */
export function sipFundLabel(merchant: string | null, body: string): string {
  const text = `${merchant ?? ""} ${body}`;
  const amc = text.match(AMC_RX);
  if (amc) return amc[0].replace(/\s+/g, " ").trim();
  return merchant?.trim() || "Mutual fund";
}

// ─── Credit type ─────────────────────────────────────────────────────────────

/**
 * Best guess at what a credit is, from its SMS / payer / description. Null when
 * nothing stands out — the user picks in the form or review queue.
 */
export function inferCreditKind(text: string | null | undefined): "salary" | "interest" | "refund" | "cashback" | null {
  if (!text) return null;
  if (/\bcash\s*back\b/i.test(text)) return "cashback";
  if (/\brefund(?:ed)?\b|\breversal\b|\breversed\b/i.test(text)) return "refund";
  if (/\binterest\b|\bint\.?\s*p(?:ai)?d\b|\bint\s+cr\b|\bsb\s*int\b/i.test(text)) return "interest";
  if (/\bsalary\b|\bsal\s+(?:for|cr)\b|\bpayroll\b/i.test(text)) return "salary";
  return null;
}
