/**
 * Bank-specific SMS regex patterns for Indian banks.
 *
 * Each pattern extracts: amount, merchant, card/account last digits, date, type.
 * Patterns are ordered by specificity — more specific patterns first.
 *
 * Designed from real SMS samples (see __tests__/fixtures/sms-samples/).
 */

export type TransactionType =
  | "debit"
  | "credit"
  | "emi"
  | "standing_instruction"
  | "payment_received"
  | "standing_instruction_reminder"
  | "emi_reminder"
  | "amount_due_reminder"
  | "refund"
  | "nach_debit"
  | "nach_bounce"
  | "upi_credit"
  | "upi_debit"
  | "balance_inquiry";

export interface ParsedSMS {
  /** Parsed amount in INR */
  amount: number;
  /** Merchant or payee name (may be truncated in SMS) */
  merchant: string | null;
  /** Last 3-4 digits of card/account */
  cardLast4: string | null;
  /** Transaction date (ISO string YYYY-MM-DD) */
  date: string | null;
  /** Bank that sent the SMS */
  bank: string;
  /** Type of transaction */
  type: TransactionType;
  /** Whether this SMS should be skipped (OTP, etc.) */
  skip: boolean;
  /** Confidence score 0-1 */
  confidence: number;
  /** Due date for forecast entries (ISO string YYYY-MM-DD) */
  dueDate: string | null;
  /** Whether this is a forecast (future expected transaction) */
  isForecast: boolean;
  /** UPI reference number */
  upiRef?: string | null;
  /** Available balance mentioned in the SMS */
  availableBalance?: number | null;
  /** Total credit limit (CC only) */
  creditLimit?: number | null;
  /** Available credit limit (CC only) */
  availableCreditLimit?: number | null;
  /** Minimum due amount (CC only) */
  minDue?: number | null;
  /** Account type inferred from SMS context */
  accountType?: "savings" | "credit_card" | "loan" | "wallet" | "pension" | null;
  /** UPI sub-type: P2M (merchant) or P2A (person-to-person) */
  upiSubtype?: "p2m" | "p2a" | null;
  /** Payment mode inferred from SMS context (V4) */
  paymentMode?: "credit_card" | "debit_card" | "upi" | "net_banking" | "wallet" | "auto_debit" | null;
  /** Transaction time extracted from SMS (HH:MM:SS format, V4) */
  transactionTime?: string | null;
  /**
   * v15.10.0 — Text nickname captured when a user template tags the account
   * field as multi-word text (e.g. "Amazon Pay Wallet"). Downstream code
   * resolves this against financial_accounts.account_label instead of the
   * numeric account_identifier. Only populated when cardLast4 is null.
   */
  accountNickname?: string | null;
  /** Internal: which pipeline stage produced this parse (hardcoded patterns or DB template). */
  _matchSource?: "hardcoded" | "template";
  /** Internal: ID of the sms_template_patterns row that matched (template only). */
  _matchedTemplateId?: string | null;
}

export interface BankPattern {
  /** Human-readable name for this pattern */
  name: string;
  /** Bank name */
  bank: string;
  /** Transaction type this pattern detects */
  type: TransactionType;
  /** Regex to test if this pattern matches */
  test: RegExp;
  /** Extract structured data from the SMS body */
  parse: (body: string) => ParsedSMS | null;
}

// ─── Helper: parse INR amounts ───

/** Parse "1,55,855.32" or "492.50" or "22317.00" or "22317" to number */
function parseAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// ─── Helper: detect UPI P2M/P2A ───

/** Extract UPI subtype from SMS body: P2M = merchant, P2A = person transfer */
function detectUpiSubtype(body: string): "p2m" | "p2a" | null {
  const upiMatch = body.match(/UPI\/(P2[MA])\//i);
  if (upiMatch) {
    return upiMatch[1].toUpperCase() === "P2M" ? "p2m" : "p2a";
  }
  return null;
}

// ─── Helper: parse dates ───

const MONTH_MAP: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/** Parse "11-Apr-26" → "2026-04-11" */
function parseDDMMMYY(raw: string): string | null {
  const m = raw.match(/(\d{1,2})-(\w{3})-(\d{2})/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  // v15.3.0: normalise month case — banks send "AUG"/"aug"/"Aug" inconsistently
  // (ICICI CC refund uses upper, Axis uses title-case). MONTH_MAP keys are
  // title-case, so fold the capture before lookup.
  const monthKey = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
  const month = MONTH_MAP[monthKey];
  if (!month) return null;
  const year = parseInt(m[3], 10);
  const fullYear = year < 50 ? 2000 + year : 1900 + year;
  return `${fullYear}-${month}-${day}`;
}

/** Parse "14Jun25" or "26Feb26" (DDMmmYY without hyphens) → "2025-06-14" */
function parseDDMMMYYCompact(raw: string): string | null {
  const m = raw.match(/(\d{1,2})([A-Za-z]{3})(\d{2})/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const monthKey = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
  const month = MONTH_MAP[monthKey];
  if (!month) return null;
  const year = parseInt(m[3], 10);
  const fullYear = year < 50 ? 2000 + year : 1900 + year;
  return `${fullYear}-${month}-${day}`;
}

/** Parse "11-04-26" (DD-MM-YY) → "2026-04-11" */
function parseDDMMYY(raw: string): string | null {
  const m = raw.match(/(\d{2})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = parseInt(m[3], 10);
  const fullYear = year < 50 ? 2000 + year : 1900 + year;
  return `${fullYear}-${m[2]}-${m[1]}`;
}

/** Parse "09-09-25 02:31:10 IST" or "22-06-25 20:14:43" → "2025-06-22" */
function parseDDMMYYTime(raw: string): string | null {
  const m = raw.match(/(\d{2})-(\d{2})-(\d{2})\s+\d{2}:\d{2}:\d{2}/);
  if (!m) return null;
  const year = parseInt(m[3], 10);
  const fullYear = year < 50 ? 2000 + year : 1900 + year;
  return `${fullYear}-${m[2]}-${m[1]}`;
}

/** Parse "2026-04-07:19:25:50" → "2026-04-07" */
function parseYYYYMMDDTime(raw: string): string | null {
  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Parse "11/04/2026" or "01/03/2026" (DD/MM/YYYY) → "2026-04-11" */
function parseDDMMYYYY(raw: string): string | null {
  const m = raw.match(/(\d{1,2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1].padStart(2, "0")}`;
}

/** Parse "2-4-2026" or "26-3-2026" (D-M-YYYY) → "2026-04-02" */
function parseDMYYYY(raw: string): string | null {
  const m = raw.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** Parse "10-03-26" (DD-MM-YY in EMI context) → "2026-03-10" */
function parseDateEMI(raw: string): string | null {
  return parseDDMMYY(raw);
}

/** Parse "25 Apr 2026" or "22 JUN 2025" (DD MMM YYYY, space-separated) → "2026-04-25" */
function parseDDMMMYYYYSpaced(raw: string): string | null {
  const m = raw.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const monthKey = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
  const month = MONTH_MAP[monthKey];
  if (!month) return null;
  return `${m[3]}-${month}-${day}`;
}

/** Parse "JAN 2026" or "JAN-26" or "SEP-25" (month-year) → end-of-month date "2026-01-31" */
function parseMonthYear(raw: string): string | null {
  const m = raw.match(/([A-Za-z]{3})(?:[-/\s](\d{2,4}))?/);
  if (!m) return null;
  const monthKey = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  const month = MONTH_MAP[monthKey];
  if (!month) return null;
  
  let year: string;
  if (m[2]) {
    // Year provided (2 or 4 digits)
    const yearNum = parseInt(m[2], 10);
    year = yearNum < 50 ? `20${yearNum.toString().padStart(2, "0")}` : 
            yearNum < 100 ? `19${yearNum.toString().padStart(2, "0")}` : 
            yearNum.toString();
  } else {
    // No year provided, use current year
    year = new Date().getFullYear().toString();
  }
  
  // Get last day of the month
  const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
  return `${year}-${month}-${lastDay.toString().padStart(2, "0")}`;
}

/**
 * Try all known date formats in order of specificity.
 * Exported so the template matcher can parse captured date groups.
 *
 * Order matters — more-specific patterns first:
 *   YYYY-MM-DD (ISO, exact) before DD-MM-YY (could misread year as day),
 *   DD/MMM/YYYY before DD/MM/YYYY (slash-with-letters vs slash-with-digits),
 *   ordinal ("10th Apr") before plain spaced ("10 Apr") to strip suffix first.
 */
export function parseDateAny(raw: string): string | null {
  return (
    parseYYYYMMDD(raw) ??         // 2026-04-07 (exact ISO, no time)
    parseYYYYMMDDTime(raw) ??     // 2026-04-07:19:25 (ISO with time suffix)
    parseDDMMMYY(raw) ??          // 11-Apr-26
    parseDDMMMYYCompact(raw) ??   // 14Jun25
    parseDDMMMYYYY(raw) ??        // 21/APR/2026
    parseDDOrdMMMYYYY(raw) ??     // 10th Apr 2026
    parseDDMMMYYYYSpaced(raw) ??  // 25 Apr 2026
    parseDMYYYY(raw) ??           // 2-4-2026
    parseDDMMYYYY(raw) ??         // 11/04/2026
    parseDDMMYYYYDot(raw) ??      // 10.04.2026 or 10.04.26
    parseDDMMYY(raw) ??           // 11-04-26
    parseDDMMYYTime(raw) ??       // 09-09-25 02:31:10
    parseMonthYear(raw) ??        // JAN 2026 / JAN-26
    null
  );
}

/** Parse "21/APR/2026" (DD/MMM/YYYY) → "2026-04-21" */
function parseDDMMMYYYY(raw: string): string | null {
  const m = raw.match(/(\d{1,2})\/(\w{3})\/(\d{4})/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = MONTH_MAP[m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${day}`;
}

/** Parse "10.04.2026" or "10.04.26" (DD.MM.YYYY or DD.MM.YY, dot-separated) → "2026-04-10" */
function parseDDMMYYYYDot(raw: string): string | null {
  const m = raw.match(/(\d{1,2})\.(\d{2})\.(\d{2,4})/);
  if (!m) return null;
  const year = parseInt(m[3], 10);
  const fullYear = year < 100 ? (year < 50 ? 2000 + year : 1900 + year) : year;
  return `${fullYear}-${m[2]}-${m[1].padStart(2, "0")}`;
}

/** Parse "2026-04-07" (YYYY-MM-DD, ISO, no time suffix) → "2026-04-07" */
function parseYYYYMMDD(raw: string): string | null {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Strip ordinal suffix from day ("10th" → "10", "1st" → "1") then delegate
 * to parseDDMMMYYYYSpaced. Handles "10th Apr 2026", "1st Jan 2025", etc.
 */
function parseDDOrdMMMYYYY(raw: string): string | null {
  const stripped = raw.replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/i, "$1");
  return parseDDMMMYYYYSpaced(stripped);
}

// ─── Helper: extract time from date strings (V4) ───

/**
 * Extract HH:MM:SS time from various SMS date formats.
 * Returns null if no time component is found.
 *
 * Supported formats:
 *   "11-04-26, 15:39:39"        → "15:39:39"
 *   "09-09-25 02:31:10 IST"     → "02:31:10"
 *   "2026-04-07:19:25:50"       → "19:25:50"
 *   "22-06-25 20:14:43"         → "20:14:43"
 *   "2026-03-30:14:53:13"       → "14:53:13"
 *   "11-Apr-26"                 → null (no time)
 *   "11/04/2026"                → null (no time)
 */
export function extractTime(raw: string): string | null {
  // "DD-MM-YY, HH:MM:SS" (Axis UPI format)
  const commaTime = raw.match(/\d{2}-\d{2}-\d{2},\s*(\d{2}:\d{2}:\d{2})/);
  if (commaTime) return commaTime[1];

  // "YYYY-MM-DD:HH:MM:SS" (HDFC format — colon separator between date and time)
  const colonTime = raw.match(/\d{4}-\d{2}-\d{2}:(\d{2}:\d{2}:\d{2})/);
  if (colonTime) return colonTime[1];

  // "DD-MM-YY HH:MM:SS IST" or "DD-MM-YY HH:MM:SS" (Axis CC format)
  const spaceTime = raw.match(/\d{2}-\d{2}-\d{2}\s+(\d{2}:\d{2}:\d{2})/);
  if (spaceTime) return spaceTime[1];

  // "on DD-MM-YY at HH:MM:SS IST" (Axis NEFT credit format)
  const atTime = raw.match(/at\s+(\d{2}:\d{2}:\d{2})/i);
  if (atTime) return atTime[1];

  return null;
}

// ─── Helper: infer payment mode from parsed SMS (V4) ───

export type PaymentModeType = "credit_card" | "debit_card" | "upi" | "net_banking" | "wallet" | "auto_debit";

/**
 * Infer payment mode from parsed SMS data and the raw SMS body.
 *
 * Decision tree:
 *   1. UPI subtype present → "upi"
 *   2. Transaction type is SI/NACH/EMI → "auto_debit"
 *   3. Account type is wallet → "wallet"
 *   4. Account type is credit_card → "credit_card"
 *   5. SMS has "Card" keyword + credit signals → "credit_card"
 *   6. SMS has "Card" keyword + balance signals → "debit_card"
 *   7. Account type is savings (no UPI, no Card) → "net_banking"
 *   8. Account type is loan → "auto_debit"
 *   9. Unknown → null
 */
export function inferPaymentMode(parsed: ParsedSMS, smsBody: string): PaymentModeType | null {
  // 1. UPI is always clear from the marker
  if (parsed.upiSubtype === "p2m" || parsed.upiSubtype === "p2a") return "upi";
  if (parsed.type === "upi_debit" || parsed.type === "upi_credit") return "upi";

  // 2. Auto-debit types
  if (parsed.type === "standing_instruction" || parsed.type === "nach_debit" || parsed.type === "emi") return "auto_debit";
  if (parsed.type === "standing_instruction_reminder" || parsed.type === "emi_reminder") return "auto_debit";

  // 3. Wallet
  if (parsed.accountType === "wallet") return "wallet";

  // 4. Credit card (from account type — parser already determines this)
  if (parsed.accountType === "credit_card") return "credit_card";

  // 5. Card keyword analysis for cases where accountType may not be set yet
  const upper = smsBody.toUpperCase();
  const hasCardKeyword = /\bCARD\b/i.test(smsBody);
  if (hasCardKeyword) {
    // Credit limit signals → credit card
    if (parsed.creditLimit || parsed.availableCreditLimit) return "credit_card";
    if (/AVL\s*LIMIT|AVAIL\s*LIMIT|CREDIT\s*LIMIT/i.test(smsBody)) return "credit_card";
    // "CC" in BLOCK message (HDFC pattern: "BLOCK CC 8957")
    if (/BLOCK\s*CC/i.test(smsBody)) return "credit_card";
    // Available balance with card → debit card
    if (parsed.availableBalance && !parsed.creditLimit) return "debit_card";
    if (/AVL\s*BAL|AVAIL\s*BAL/i.test(smsBody)) return "debit_card";
    // Card with no other signal — in India, card SMS with limits = CC
    return "credit_card";
  }

  // 6. Savings account debit without UPI or Card → net banking / NEFT / IMPS
  if (parsed.accountType === "savings") return "net_banking";

  // 7. Loan → auto debit
  if (parsed.accountType === "loan") return "auto_debit";

  // 8. Cannot determine
  return null;
}

// ─── Skip patterns (OTPs, reminders, amount due) ───

const SKIP_PATTERNS = [
  /\bOTP\b/i,
  /UPI-Mandate\s+(?:is\s+)?successfully\s+(?:Revoked|created|cancelled)/i,
  /received\s+a\s+UPI-Mandate\s+collect\s+request/i,
  /has\s+been\s+blocked\s+by\s+an\s+amount\s+of/i,
  /Txn\s+of\s+INR\s+[\d,.]+\s+is\s+declined/i,
];

// ─── Bank Patterns ───

export const BANK_PATTERNS: BankPattern[] = [
  // ═══ ICICI Credit Card Spend ═══
  // Accepts both historical and current ICICI CC spend formats:
  //   "INR 492.50 spent using ICICI Bank Card XX3001 on 11-Apr-26 on ZOMATO LIMITED."
  //   "Rs 71,000.00 spent on ICICI Bank Card XX3001 on 22-Apr-26 at Tagmango Pvt Lt. Avl Lmt: Rs 85,911.92."
  // Variations captured:
  //   - Rs / INR / Rs.
  //   - "spent using" / "spent on"
  //   - "on <merchant>" / "at <merchant>"
  //   - "Avl Limit:" / "Avl Lmt:" (amount-end anchor + limit extraction)
  {
    name: "ICICI CC Spend",
    bank: "ICICI Bank",
    type: "debit",
    test: /(?:Rs\.?|INR)\s+[\d,.]+\s+spent\s+(?:using|on)\s+ICICI\s+Bank\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /(?:Rs\.?|INR)\s+([\d,.]+)\s+spent\s+(?:using|on)\s+ICICI\s+Bank\s+Card\s+XX(\d+)\s+on\s+(\d{1,2}-\w{3}-\d{2})\s+(?:on|at)\s+(.+?)\.\s*Avl/i,
      );
      if (!m) return null;
      const limMatch = body.match(/Avl\s*(?:Limit|Lmt)[:\s]*(?:INR|Rs\.?)\s*([\d,]+\.?\d*)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: m[4].trim(),
        cardLast4: m[2],
        date: parseDDMMMYY(m[3]),
        bank: "ICICI Bank",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.95,
        availableCreditLimit: limMatch ? parseAmount(limMatch[1]) : undefined,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ ICICI Account Debit ═══
  // "ICICI Bank Acc XX322 debited Rs. 5,696.00 on 11-Mar-26 InfoEBA*IPO LLOPP."
  // Note: UPI debits are handled by the more specific "ICICI UPI Debit" pattern below.
  {
    name: "ICICI Account Debit",
    bank: "ICICI Bank",
    type: "debit",
    test: /ICICI\s+Bank\s+Acc\s+XX\d+\s+debited(?![\s\S]*?UPI\s+(?:txn|Ref))/i,
    parse: (body) => {
      const m = body.match(
        /ICICI\s+Bank\s+Acc\s+XX(\d+)\s+debited\s+Rs\.\s*([\d,.]+)\s+on\s+(\d{1,2}-\w{3}-\d{2})\s+(.+?)\.?\s*Avl/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[2]),
        merchant: m[4].trim(),
        cardLast4: m[1],
        date: parseDDMMMYY(m[3]),
        bank: "ICICI Bank",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
      };
    },
  },

  // ═══ ICICI Standing Instruction (processed) ═══
  // "We have successfully processed payment of INR 199.00 to Merchant NETFLIX..."
  // "we have successfully processed the payment of INR 499.00 for NETFLIX..."
  {
    name: "ICICI Standing Instruction",
    bank: "ICICI Bank",
    type: "standing_instruction",
    test: /successfully\s+processed\s+(?:the\s+)?payment\s+of\s+INR/i,
    parse: (body) => {
      // Format 1: "processed payment of INR X to Merchant NAME, as per Standing Instruction ... on DD/MM/YYYY for ... Card NNNN"
      const m1 = body.match(
        /processed\s+payment\s+of\s+INR\s+([\d,.]+)\s+to\s+Merchant\s+(.+?),\s*as\s+per\s+Standing\s+Instruction\s+\S+\s+on\s+(\d{1,2}\/\d{2}\/\d{4})\s+for\s+ICICI\s+Bank\s+Credit\s+Card\s+(\d+)/i,
      );
      if (m1) {
        return {
          amount: parseAmount(m1[1]),
          merchant: m1[2].trim(),
          cardLast4: m1[4],
          date: parseDDMMYYYY(m1[3]),
          bank: "ICICI Bank",
          type: "standing_instruction",
          skip: false,
          dueDate: null,
          isForecast: false,
          confidence: 0.95,
        };
      }
      // Format 2: "processed the payment of INR X for NAME, as per the Standing Instruction ... on DD/MM/YYYY for ... Card NNNN"
      const m2 = body.match(
        /processed\s+the\s+payment\s+of\s+INR\s+([\d,.]+)\s+for\s+(.+?),\s*as\s+per\s+the\s+Standing\s+Instruction\s+\S+,?\s+on\s+(\d{1,2}\/\d{2}\/\d{4})\s+for\s+(?:your\s+)?ICICI\s+Bank\s+Credit\s+Card\s+(\d+)/i,
      );
      if (!m2) return null;
      return {
        amount: parseAmount(m2[1]),
        merchant: m2[2].trim(),
        cardLast4: m2[4],
        date: parseDDMMYYYY(m2[3]),
        bank: "ICICI Bank",
        type: "standing_instruction",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.95,
      };
    },
  },

  // ═══ Axis Bank UPI Debit (multiline) ═══
  // "INR 1236.00 debited\nA/c no. XX2836\n11-04-26, 15:39:39\nUPI/P2M/565346001016/Blue Tokai Coffee R"
  {
    name: "Axis UPI Debit",
    bank: "Axis Bank",
    type: "upi_debit",
    test: /INR\s+[\d,.]+\s+debited[\s\S]*?A\/c\s+no\.\s+XX\d+[\s\S]*?UPI\//i,
    parse: (body) => {
      const m = body.match(
        /INR\s+([\d,.]+)\s+debited[\s\S]*?A\/c\s+no\.\s+XX(\d+)[\s\S]*?(\d{2}-\d{2}-\d{2}),\s*\d{2}:\d{2}:\d{2}[\s\S]*?UPI\/\w+\/\d+\/(.+?)(?:\n|Not you)/i,
      );
      if (!m) return null;
      const subtype = detectUpiSubtype(body);
      return {
        amount: parseAmount(m[1]),
        merchant: m[4].trim(),
        cardLast4: m[2],
        date: parseDDMMYY(m[3]),
        bank: "Axis Bank",
        type: "upi_debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        upiSubtype: subtype,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ Axis Bank CC Spend (format 1: "Spent INR 1087") ═══
  // "Spent INR 1087\nAxis Bank Card no. XX2445\n09-09-25 02:31:10 IST\nSTEAMGAMES."
  {
    name: "Axis CC Spend v1",
    bank: "Axis Bank",
    type: "debit",
    test: /Spent\s+INR\s+[\d,.]+[\s\S]*?Axis\s+Bank\s+Card\s+no\./i,
    parse: (body) => {
      const m = body.match(
        /Spent\s+INR\s+([\d,.]+)[\s\S]*?Axis\s+Bank\s+Card\s+no\.\s+XX(\d+)[\s\S]*?(\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})[\s\S]*?(?:IST\s*\n|\n)(.+?)\.?\s*\n/i,
      );
      if (!m) return null;
      const limMatch = body.match(/Avl\s*(?:Limit|Lmt)[:\s]*(?:INR|Rs\.?)\s*([\d,]+\.?\d*)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: m[4].trim(),
        cardLast4: m[2],
        date: parseDDMMYYTime(m[3]),
        bank: "Axis Bank",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        availableCreditLimit: limMatch ? parseAmount(limMatch[1]) : undefined,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ Axis Bank CC Spend (format 2: "Spent\nCard no. XX2445\nINR 566.08") ═══
  // "Spent\nCard no. XX2445\nINR 566.08\n22-06-25 20:14:43\nBOOKMYSHOW"
  {
    name: "Axis CC Spend v2",
    bank: "Axis Bank",
    type: "debit",
    test: /Spent[\s\S]*?Card\s+no\.\s+XX\d+[\s\S]*?INR\s+[\d,.]+/i,
    parse: (body) => {
      const m = body.match(
        /Spent[\s\S]*?Card\s+no\.\s+XX(\d+)[\s\S]*?INR\s+([\d,.]+)[\s\S]*?(\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})[\s\S]*?\n(.+?)(?:\n|Avl)/i,
      );
      if (!m) return null;
      const limMatch = body.match(/Avl\s*(?:Limit|Lmt)[:\s]*(?:INR|Rs\.?)\s*([\d,]+\.?\d*)/i);
      return {
        amount: parseAmount(m[2]),
        merchant: m[4].trim(),
        cardLast4: m[1],
        date: parseDDMMYYTime(m[3]),
        bank: "Axis Bank",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        availableCreditLimit: limMatch ? parseAmount(limMatch[1]) : undefined,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ HDFC CC Spend ═══
  // "Spent Rs.1646.5 On HDFC Bank Card 8957 At TATA PAYMENTS LIMITED On 2026-04-07:19:25:50."
  {
    name: "HDFC CC Spend",
    bank: "HDFC Bank",
    type: "debit",
    test: /Spent\s+Rs\.[\d,.]+\s+On\s+HDFC\s+Bank\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /Spent\s+Rs\.([\d,.]+)\s+On\s+HDFC\s+Bank\s+Card\s+(\d+)\s+At\s+(.+?)\s+On\s+(\d{4}-\d{2}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: m[3].trim(),
        cardLast4: m[2],
        date: parseYYYYMMDDTime(m[4]),
        bank: "HDFC Bank",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.95,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ HDFC Payment Received (credit) ═══
  // "DEAR HDFCBANK CARDMEMBER, PAYMENT OF Rs. 937.05 RECEIVED TOWARDS YOUR CREDIT CARD ENDING WITH 8957 ON 2-4-2026."
  {
    name: "HDFC Payment Received",
    bank: "HDFC Bank",
    type: "payment_received",
    test: /PAYMENT\s+OF\s+Rs\.\s*[\d,.]+\s+RECEIVED\s+TOWARDS/i,
    parse: (body) => {
      const m = body.match(
        /PAYMENT\s+OF\s+Rs\.\s*([\d,.]+)\s+RECEIVED\s+TOWARDS\s+YOUR\s+CREDIT\s+CARD\s+ENDING\s+WITH\s+(\d+)\s+ON\s+(\d{1,2}-\d{1,2}-\d{4})/i,
      );
      if (!m) return null;
      const limMatch = body.match(/AVAILABLE\s+LIMIT\s+IS\s+RS\.?\s*([\d,]+\.?\d*)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: "Credit Card Payment",
        cardLast4: m[2],
        date: parseDMYYYY(m[3]),
        bank: "HDFC Bank",
        type: "payment_received",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.95,
        availableCreditLimit: limMatch ? parseAmount(limMatch[1]) : undefined,
        accountType: "credit_card" as const,
      };
    },
  },
  // ═══ FORECAST PATTERNS ═══
  // These were previously skipped — now they create forecast entries.

  // ═══ ICICI Standing Instruction Reminder (forecast) ═══
  // "Payment of INR 199.00 towards Merchant NETFLIX to be debited from ICICI Bank Credit Card 3001, as per Standing Instruction Y278Vqc4sx, is due by 09/04/2026."
  // "your payment of INR 299.00 for Youtube to be debited from your ICICI Bank Credit Card 3001, as per Standing Instructions XoO5wn2RU4, is due by 01/01/2026."
  {
    name: "ICICI SI Reminder",
    bank: "ICICI Bank",
    type: "standing_instruction_reminder",
    test: /(?:Payment|payment)\s+of\s+INR\s+[\d,.]+\s+(?:towards\s+Merchant|for)\s+.+?is\s+due\s+by/i,
    parse: (body) => {
      // Format 1: "Payment of INR X towards Merchant NAME to be debited from ICICI Bank Credit Card NNNN ... is due by DD/MM/YYYY"
      const m1 = body.match(
        /Payment\s+of\s+INR\s+([\d,.]+)\s+towards\s+Merchant\s+(.+?)\s+to\s+be\s+debited\s+from\s+ICICI\s+Bank\s+Credit\s+Card\s+(\d+)[\s\S]*?is\s+due\s+by\s+(\d{1,2}\/\d{2}\/\d{4})/i,
      );
      if (m1) {
        return {
          amount: parseAmount(m1[1]),
          merchant: m1[2].trim(),
          cardLast4: m1[3],
          date: null,
          bank: "ICICI Bank",
          type: "standing_instruction_reminder",
          skip: false,
          dueDate: parseDDMMYYYY(m1[4]),
          isForecast: true,
          confidence: 0.9,
        };
      }
      // Format 2: "your payment of INR X for NAME to be debited from your ICICI Bank Credit Card NNNN ... is due by DD/MM/YYYY"
      const m2 = body.match(
        /payment\s+of\s+INR\s+([\d,.]+)\s+for\s+(.+?)\s+to\s+be\s+debited\s+from\s+(?:your\s+)?ICICI\s+Bank\s+Credit\s+Card\s+(\d+)[\s\S]*?is\s+due\s+by\s+(\d{1,2}\/\d{2}\/\d{4})/i,
      );
      if (!m2) return null;
      return {
        amount: parseAmount(m2[1]),
        merchant: m2[2].trim(),
        cardLast4: m2[3],
        date: null,
        bank: "ICICI Bank",
        type: "standing_instruction_reminder",
        skip: false,
        dueDate: parseDDMMYYYY(m2[4]),
        isForecast: true,
        confidence: 0.9,
      };
    },
  },

  // ═══ HDFC Amount Due Reminder (forecast) ═══
  // "Amount Due\nRs.937 on HDFC Bank Credit Card 8957. Pay instantly by 21/APR/2026 via PayZapp"
  {
    name: "HDFC Amount Due",
    bank: "HDFC Bank",
    type: "amount_due_reminder",
    test: /Amount\s+Due[\s\S]*?Rs\.[\d,.]+\s+on\s+HDFC\s+Bank\s+Credit\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /Amount\s+Due[\s\S]*?Rs\.([\d,.]+)\s+on\s+HDFC\s+Bank\s+Credit\s+Card\s+(\d+)[\s\S]*?by\s+(\d{1,2}\/\w{3}\/\d{4})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: "Credit Card Amount Due",
        cardLast4: m[2],
        date: null,
        bank: "HDFC Bank",
        type: "amount_due_reminder",
        skip: false,
        dueDate: parseDDMMMYYYY(m[3]),
        isForecast: true,
        confidence: 0.9,
      };
    },
  },

  // ═══ Axis EMI Due Reminder (forecast) ═══
  // "EMI of INR 22317.00 for Axis Bank Loan A/c XX7249 is due on 10-04-26."
  // "EMI of INR 22317.00 is due on 10-01-26 for Axis Bank Loan A/c no. XX7249."
  {
    name: "Axis EMI Reminder",
    bank: "Axis Bank",
    type: "emi_reminder",
    test: /EMI of INR .+ is due on/i,
    parse: (body) => {
      // Format 1: "EMI of INR X for ... A/c XX1234 is due on DD-MM-YY"
      const m1 = body.match(
        /EMI\s+of\s+INR\s+([\d,.]+)\s+for\s+(?:(?:your\s+)?Axis\s+Bank\s+)?(?:Loan\s+)?A\/c\s+(?:no\.\s+)?XX(\d+)\s+is\s+due\s+on\s+(\d{2}-\d{2}-\d{2})/i,
      );
      if (m1) {
        return {
          amount: parseAmount(m1[1]),
          merchant: "EMI Payment",
          cardLast4: m1[2],
          date: null,
          bank: "Axis Bank",
          type: "emi_reminder",
          skip: false,
          dueDate: parseDateEMI(m1[3]),
          isForecast: true,
          confidence: 0.9,
        };
      }
      // Format 2: "EMI of INR X is due on DD-MM-YY for ... A/c no. XX1234"
      const m2 = body.match(
        /EMI\s+of\s+INR\s+([\d,.]+)\s+is\s+due\s+on\s+(\d{2}-\d{2}-\d{2})[\s\S]*?A\/c\s+(?:no\.\s+)?XX(\d+)/i,
      );
      if (!m2) return null;
      return {
        amount: parseAmount(m2[1]),
        merchant: "EMI Payment",
        cardLast4: m2[3],
        date: null,
        bank: "Axis Bank",
        type: "emi_reminder",
        skip: false,
        dueDate: parseDateEMI(m2[2]),
        isForecast: true,
        confidence: 0.9,
      };
    },
  },

  // ═══ Axis Loan EMI Debit (realized debit from savings for EMI) ═══
  // "Debit INR 22717.00\nAxis Bank A/c XX2836\n11-09-25 15:03:48\nPPR000810877249_EMI_11-09-"
  // "Debit INR 22717.00\nAxis Bank A/c XX2836\n11-09-25 10:43:32\nLoan Repayment - PPR0xxxxx"
  {
    name: "Axis Loan EMI Debit",
    bank: "Axis Bank",
    type: "debit",
    test: /Debit\s+INR\s+[\d,.]+[\s\S]*?Axis\s+Bank\s+A\/c\s+XX\d+[\s\S]*?(?:PPR\S*EMI|Loan\s+Repayment)/i,
    parse: (body) => {
      const m = body.match(
        /Debit\s+INR\s+([\d,.]+)[\s\S]*?Axis\s+Bank\s+A\/c\s+XX(\d+)[\s\S]*?(\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})[\s\S]*?(PPR\S*|Loan\s+Repayment\S*)/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: "Loan EMI — " + m[5].trim(),
        cardLast4: m[2],
        date: parseDDMMYY(m[3]),
        bank: "Axis Bank",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        accountType: "savings" as const,
        paymentMode: "auto_debit" as const,
        transactionTime: m[4],
      };
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // EXPANDED PATTERNS (Task 11.4)
  // ═══════════════════════════════════════════════════════════════

  // ─── ICICI Extended ───

  // ═══ ICICI UPI Debit ═══
  // "ICICI Bank Acc XX322 debited Rs. 500.00 on 12-Apr-26 for UPI txn to MERCHANT. UPI Ref: 123456789012."
  // "ICICI Bank Acct XX322 debited for Rs 1500.00 on 25-Sep-25; ICCL ZERODHA CO credited. UPI:101536348787."
  {
    name: "ICICI UPI Debit",
    bank: "ICICI Bank",
    type: "upi_debit",
    test: /ICICI\s+Bank\s+Acc(?:t)?\s+XX\d+\s+debited[\s\S]*?UPI/i,
    parse: (body) => {
      // Format 1: "ICICI Bank Acc XX322 debited Rs. X on DD-MMM-YY ... UPI txn to MERCHANT"
      const m1 = body.match(
        /ICICI\s+Bank\s+Acc\s+XX(\d+)\s+debited\s+Rs\.\s*([\d,.]+)\s+on\s+(\d{1,2}-\w{3}-\d{2})[\s\S]*?(?:UPI\s+txn\s+to|UPI\/\w+\/\d+\/)(.+?)(?:\.|UPI\s+Ref)/i,
      );
      if (m1) {
        const upiRefMatch = body.match(/UPI\s+Ref[:\s]+(\d+)/i);
        return {
          amount: parseAmount(m1[2]),
          merchant: m1[4].trim(),
          cardLast4: m1[1],
          date: parseDDMMMYY(m1[3]),
          bank: "ICICI Bank",
          type: "upi_debit",
          skip: false,
          dueDate: null,
          isForecast: false,
          confidence: 0.9,
          upiRef: upiRefMatch?.[1] ?? null,
          accountType: "savings" as const,
        };
      }
      // Format 2: "ICICI Bank Acct XX322 debited for Rs X on DD-MMM-YY; MERCHANT credited. UPI:NNNN"
      const m2 = body.match(
        /ICICI\s+Bank\s+Acct\s+XX(\d+)\s+debited\s+for\s+Rs\s+([\d,.]+)\s+on\s+(\d{1,2}-\w{3}-\d{2});\s*(.+?)\s+credited[\s\S]*?UPI[:\s]*(\d+)/i,
      );
      if (!m2) return null;
      return {
        amount: parseAmount(m2[2]),
        merchant: m2[4].trim(),
        cardLast4: m2[1],
        date: parseDDMMMYY(m2[3]),
        bank: "ICICI Bank",
        type: "upi_debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        upiRef: m2[5],
        accountType: "savings" as const,
      };
    },
  },

  // ═══ ICICI UPI Credit ═══
  // "ICICI Bank Acc XX322 credited Rs. 5000.00 on 12-Apr-26. UPI Ref: 123456789012. Avl Bal Rs. 15,032.75."
  {
    name: "ICICI UPI Credit",
    bank: "ICICI Bank",
    type: "upi_credit",
    test: /ICICI\s+Bank\s+Acc\s+XX\d+\s+credited\s+Rs\./i,
    parse: (body) => {
      const m = body.match(
        /ICICI\s+Bank\s+Acc\s+XX(\d+)\s+credited\s+Rs\.\s*([\d,.]+)\s+on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      const upiRefMatch = body.match(/UPI\s+Ref[:\s]+(\d+)/i);
      const balMatch = body.match(/Avl\s+Bal\s+Rs\.\s*([\d,.]+)/i);
      return {
        amount: parseAmount(m[2]),
        merchant: null,
        cardLast4: m[1],
        date: parseDDMMMYY(m[3]),
        bank: "ICICI Bank",
        type: "upi_credit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        upiRef: upiRefMatch?.[1] ?? null,
        availableBalance: balMatch ? parseAmount(balMatch[1]) : undefined,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ ICICI Refund ═══
  // "ICICI Bank: Rs.500.00 refund credited to your Card XX3001 on 12-Apr-26. Ref: 123456."
  {
    name: "ICICI Refund",
    bank: "ICICI Bank",
    type: "refund",
    test: /ICICI\s+Bank[\s\S]*?refund\s+credited/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+refund\s+credited\s+to\s+your\s+Card\s+XX(\d+)\s+on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: "Refund",
        cardLast4: m[2],
        date: parseDDMMMYY(m[3]),
        bank: "ICICI Bank",
        type: "refund",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ ICICI CC Payment (bill payment) ═══
  // "ICICI Bank: Payment of Rs.25000.00 received towards your Credit Card XX3001 on 12-Apr-26."
  {
    name: "ICICI CC Payment",
    bank: "ICICI Bank",
    type: "payment_received",
    test: /ICICI\s+Bank[\s\S]*?Payment\s+of\s+Rs\.[\d,.]+\s+received\s+towards\s+your\s+Credit\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /Payment\s+of\s+Rs\.\s*([\d,.]+)\s+received\s+towards\s+your\s+Credit\s+Card\s+XX(\d+)\s+on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: "Credit Card Payment",
        cardLast4: m[2],
        date: parseDDMMMYY(m[3]),
        bank: "ICICI Bank",
        type: "payment_received",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ ICICI CC Payment via BBPS ═══
  // "Payment of Rs 38,304.98 has been received on your ICICI Bank Credit Card XX3001 through Bharat Bill Payment System on 19-DEC-25."
  {
    name: "ICICI CC Payment BBPS",
    bank: "ICICI Bank",
    type: "payment_received",
    test: /Payment\s+of\s+Rs\s+[\d,.]+\s+has\s+been\s+received\s+on\s+your\s+ICICI\s+Bank\s+Credit\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /Payment\s+of\s+Rs\s+([\d,.]+)\s+has\s+been\s+received\s+on\s+your\s+ICICI\s+Bank\s+Credit\s+Card\s+XX(\d+)[\s\S]*?on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: "Credit Card Payment",
        cardLast4: m[2],
        date: parseDDMMMYY(m[3]),
        bank: "ICICI Bank",
        type: "payment_received",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.95,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ ICICI CC Reversal ═══
  // "Reversal of Rs 10.02 credited to ICICI Bank Credit Card XX3001 on 26-DEC-25. Revised total due Rs 0, minimum due Rs .00"
  {
    name: "ICICI CC Reversal",
    bank: "ICICI Bank",
    type: "refund",
    test: /Reversal\s+of\s+Rs\s+[\d,.]+\s+credited\s+to\s+ICICI\s+Bank\s+Credit\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /Reversal\s+of\s+Rs\s+([\d,.]+)\s+credited\s+to\s+ICICI\s+Bank\s+Credit\s+Card\s+XX(\d+)\s+on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: "ICICI CC Reversal",
        cardLast4: m[2],
        date: parseDDMMMYY(m[3]),
        bank: "ICICI Bank",
        type: "refund",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ ICICI Balance Info ═══
  // "ICICI Bank Acc XX322: Avl Bal Rs. 15,032.75 as on 12-Apr-26."
  {
    name: "ICICI Balance Info",
    bank: "ICICI Bank",
    type: "balance_inquiry",
    test: /ICICI\s+Bank\s+Acc\s+XX\d+[\s\S]*?Avl\s+Bal\s+Rs\./i,
    parse: (body) => {
      const m = body.match(
        /ICICI\s+Bank\s+Acc\s+XX(\d+)[\s\S]*?Avl\s+Bal\s+Rs\.\s*([\d,.]+)/i,
      );
      if (!m) return null;
      return {
        amount: 0,
        merchant: null,
        cardLast4: m[1],
        date: null,
        bank: "ICICI Bank",
        type: "balance_inquiry",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        availableBalance: parseAmount(m[2]),
        accountType: "savings" as const,
      };
    },
  },

  // ═══ EPFO Passbook Balance ═══
  // "Dear XXXXXXXX6138, your passbook balance against PUPUN**************1275 is Rs. 3,81,039/-. Contribution of Rs. 14,750/- for due month Mar-26 has been received."
  // Also matches the org-level account format: "APHYD00641440000014984".
  // Two IDs, one per employer. We treat each as a separate pension account.
  // Contribution amount is captured as credit amount, date is parsed as month-end date.
  {
    name: "EPFO Passbook Balance",
    bank: "EPFO",
    type: "credit",
    test: /passbook\s+balance\s+against\s+[A-Z0-9*]+\s+is\s+Rs\.?\s*[\d,]+/i,
    parse: (body) => {
      const m = body.match(
        /Dear\s+([A-Z0-9]+)[,\s]+your\s+passbook\s+balance\s+against\s+([A-Z0-9*]+)\s+is\s+Rs\.?\s*([\d,]+)/i,
      );
      if (!m) return null;
      
      // Extract only numeric digits from the account ID for cardLast4
      const accountId = m[1].replace(/\D/g, ''); // Remove non-digits
      const cardLast4 = accountId.length >= 4 ? accountId.slice(-4) : accountId;
      
      // Extract contribution amount if present
      const contribMatch = body.match(/Contribution\s+of\s+Rs\.?\s*([\d,]+)\s*\/-\s+for\s+due\s+month\s+(\w{3})-(\d{2})/i);
      let contributionAmount = 0;
      let date = null;
      
      if (contribMatch) {
        contributionAmount = parseAmount(contribMatch[1]);
        const monthKey = contribMatch[2].charAt(0).toUpperCase() + contribMatch[2].slice(1).toLowerCase();
        const month = MONTH_MAP[monthKey];
        if (month) {
          const year = parseInt(contribMatch[3], 10);
          const fullYear = year < 50 ? 2000 + year : 1900 + year;
          // Use month-end date (last day of the month)
          const lastDay = new Date(fullYear, parseInt(month, 10), 0).getDate();
          date = `${fullYear}-${month}-${lastDay.toString().padStart(2, '0')}`;
        }
      }
      
      return {
        amount: contributionAmount,
        merchant: m[2], // Store full passbook ID in merchant/notes
        cardLast4: cardLast4, // Use last 4 digits of account ID
        date: date,
        bank: "EPFO",
        type: "credit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.95,
        availableBalance: parseAmount(m[3]),
        accountType: "pension" as const,
      };
    },
  },

  // ─── HDFC Extended ───

  // ═══ HDFC UPI Debit ═══
  // "Rs.500.00 debited from HDFC Bank a/c XX5678 on 12-04-26 for UPI txn to MERCHANT. UPI Ref 123456789012."
  {
    name: "HDFC UPI Debit",
    bank: "HDFC Bank",
    type: "upi_debit",
    test: /Rs\.[\d,.]+\s+debited\s+from\s+HDFC\s+Bank\s+a\/c[\s\S]*?UPI/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+debited\s+from\s+HDFC\s+Bank\s+a\/c\s+XX(\d+)\s+on\s+(\d{1,2}-\d{2}-\d{2})[\s\S]*?(?:UPI\s+txn\s+to|UPI\/\w+\/)\s*(.+?)(?:\.\s*UPI|\.?\s*Avl|\.?\s*Not)/i,
      );
      if (!m) return null;
      const upiRefMatch = body.match(/UPI\s+Ref\s+(\d+)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: m[4].trim(),
        cardLast4: m[2],
        date: parseDDMMYY(m[3]),
        bank: "HDFC Bank",
        type: "upi_debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        upiRef: upiRefMatch?.[1] ?? null,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ HDFC Refund ═══
  // "Refund of Rs.500.00 has been credited to your HDFC Bank Card ending 8957 on 12-04-2026."
  {
    name: "HDFC Refund",
    bank: "HDFC Bank",
    type: "refund",
    test: /Refund\s+of\s+Rs\.[\d,.]+[\s\S]*?HDFC\s+Bank\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /Refund\s+of\s+Rs\.\s*([\d,.]+)[\s\S]*?HDFC\s+Bank\s+Card\s+(?:ending\s+)?(\d+)\s+on\s+(\d{1,2}-\d{1,2}-\d{4})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: "Refund",
        cardLast4: m[2],
        date: parseDMYYYY(m[3]),
        bank: "HDFC Bank",
        type: "refund",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ HDFC NACH Debit ═══
  // "NACH debit of Rs.199.00 from your HDFC Bank A/c XX5678 on 12-04-26 towards NETFLIX."
  {
    name: "HDFC NACH Debit",
    bank: "HDFC Bank",
    type: "nach_debit",
    test: /NACH\s+debit[\s\S]*?HDFC\s+Bank/i,
    parse: (body) => {
      const m = body.match(
        /NACH\s+debit\s+of\s+Rs\.\s*([\d,.]+)\s+from\s+your\s+HDFC\s+Bank\s+A\/c\s+XX(\d+)\s+on\s+(\d{1,2}-\d{2}-\d{2})[\s\S]*?towards\s+(.+?)(?:\.|$)/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: m[4].trim(),
        cardLast4: m[2],
        date: parseDDMMYY(m[3]),
        bank: "HDFC Bank",
        type: "nach_debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ HDFC CC Limit Alert ═══
  // "Your HDFC Bank Credit Card 8957: Credit Limit Rs.1,62,000. Available Limit Rs.1,55,000."
  {
    name: "HDFC CC Limit",
    bank: "HDFC Bank",
    type: "balance_inquiry",
    test: /HDFC\s+Bank\s+Credit\s+Card[\s\S]*?Credit\s+Limit\s+Rs\./i,
    parse: (body) => {
      const m = body.match(
        /HDFC\s+Bank\s+Credit\s+Card\s+(\d+)[\s\S]*?Credit\s+Limit\s+Rs\.\s*([\d,.]+)[\s\S]*?Available\s+Limit\s+Rs\.\s*([\d,.]+)/i,
      );
      if (!m) return null;
      return {
        amount: 0,
        merchant: null,
        cardLast4: m[1],
        date: null,
        bank: "HDFC Bank",
        type: "balance_inquiry",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        creditLimit: parseAmount(m[2]),
        availableCreditLimit: parseAmount(m[3]),
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ HDFC Account Credit ═══
  // "Rs.50000.00 credited to HDFC Bank A/c XX5678 on 12-04-26 by NEFT from ABC. Avl Bal Rs.75000.00."
  {
    name: "HDFC Account Credit",
    bank: "HDFC Bank",
    type: "credit",
    test: /Rs\.[\d,.]+\s+credited\s+to\s+HDFC\s+Bank\s+A\/c/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+credited\s+to\s+HDFC\s+Bank\s+A\/c\s+XX(\d+)\s+on\s+(\d{1,2}-\d{2}-\d{2})/i,
      );
      if (!m) return null;
      const balMatch = body.match(/Avl\s+Bal\s+Rs\.\s*([\d,.]+)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: null,
        cardLast4: m[2],
        date: parseDDMMYY(m[3]),
        bank: "HDFC Bank",
        type: "credit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        availableBalance: balMatch ? parseAmount(balMatch[1]) : undefined,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ Axis IMPS Debit (multiline) ═══
  // "Debit INR 120000.00\nAxis Bank A/c XX2836\n31-03-26 01:35:45\nIMPS/P2A/609038642398/Sour"
  {
    name: "Axis IMPS Debit",
    bank: "Axis Bank",
    type: "debit",
    test: /Debit\s+INR\s+[\d,.]+[\s\S]*?Axis\s+Bank\s+A\/c\s+XX\d+[\s\S]*?IMPS\//i,
    parse: (body) => {
      const m = body.match(
        /Debit\s+INR\s+([\d,.]+)[\s\S]*?Axis\s+Bank\s+A\/c\s+XX(\d+)[\s\S]*?(\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})[\s\S]*?IMPS\/(P2[MA])\/\d+\/(.+?)(?:\n|WhatsApp|Not\s+You|$)/i,
      );
      if (!m) return null;
      const impsType = m[5].toUpperCase();
      return {
        amount: parseAmount(m[1]),
        merchant: m[6].trim(),
        cardLast4: m[2],
        date: parseDDMMYY(m[3]),
        bank: "Axis Bank",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        accountType: "savings" as const,
        paymentMode: "net_banking" as const,
        upiSubtype: impsType === "P2A" ? ("p2a" as const) : ("p2m" as const),
        transactionTime: m[4],
      };
    },
  },

  // ═══ Axis CC Payment Received ═══
  // "Payment of INR 8400 has been received towards your Axis Bank Credit Card XX2445 on 26-03-26 - Axis Bank"
  {
    name: "Axis CC Payment Received",
    bank: "Axis Bank",
    type: "payment_received",
    test: /Payment\s+of\s+INR\s+[\d,.]+\s+has\s+been\s+received\s+towards\s+your\s+Axis\s+Bank\s+Credit\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /Payment\s+of\s+INR\s+([\d,.]+)\s+has\s+been\s+received\s+towards\s+your\s+Axis\s+Bank\s+Credit\s+Card\s+XX(\d+)\s+on\s+(\d{2}-\d{2}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: "Credit Card Payment",
        cardLast4: m[2],
        date: parseDDMMYY(m[3]),
        bank: "Axis Bank",
        type: "payment_received",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.95,
        accountType: "credit_card" as const,
      };
    },
  },

  // ─── Axis Extended ───

  // ═══ Axis UPI Credit (multiline) ═══
  // "INR 45000.00 credited\nA/c no. XX2836\n05-01-26, 16:15:41 IST\nUPI/P2A/600573192993/SOURAV  B/SBIN/UPI - Axis Bank"
  {
    name: "Axis UPI Credit",
    bank: "Axis Bank",
    type: "upi_credit",
    test: /INR\s+[\d,.]+\s+credited[\s\S]*?A\/c\s+no\.\s+XX\d+[\s\S]*?UPI\//i,
    parse: (body) => {
      const m = body.match(
        /INR\s+([\d,.]+)\s+credited[\s\S]*?A\/c\s+no\.\s+XX(\d+)[\s\S]*?(\d{2}-\d{2}-\d{2}),\s*\d{2}:\d{2}:\d{2}[\s\S]*?UPI\/\w+\/(\d+)\/(.+?)(?:\n|$)/i,
      );
      if (!m) return null;
      const subtype = detectUpiSubtype(body);
      return {
        amount: parseAmount(m[1]),
        merchant: m[5].trim().replace(/\s*-\s*Axis\s+Bank\s*$/i, "").replace(/\s{2,}/g, " "),
        cardLast4: m[2],
        date: parseDDMMYY(m[3]),
        bank: "Axis Bank",
        type: "upi_credit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        upiRef: m[4],
        upiSubtype: subtype,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ Axis Account Credit ═══
  // Multiline: "INR 5000.00 credited\nA/c no. XX2836\n12-04-26, 10:30:00\nNEFT/ICICI/SALARY"
  // Single-line NEFT: "INR 145260.00 credited to A/c no. XX2836 on 31-03-26 at 01:31:45 IST. Info - NEFT/CHASH00014169905/Coup."
  {
    name: "Axis Account Credit",
    bank: "Axis Bank",
    type: "credit",
    test: /INR\s+[\d,.]+\s+credited[\s\S]*?A\/c\s+no\.\s+XX\d+/i,
    parse: (body) => {
      // Try single-line NEFT format first: "INR X credited to A/c no. XXnnnn on DD-MM-YY at HH:MM:SS IST. Info - ..."
      const singleLine = body.match(
        /INR\s+([\d,.]+)\s+credited\s+to\s+A\/c\s+no\.\s+XX(\d+)\s+on\s+(\d{2}-\d{2}-\d{2})\s+at\s+\d{2}:\d{2}:\d{2}[\s\S]*?Info\s*-\s*(.+?)(?:\.\s*Chk|\s*-\s*Axis|$)/i,
      );
      if (singleLine) {
        return {
          amount: parseAmount(singleLine[1]),
          merchant: singleLine[4].trim(),
          cardLast4: singleLine[2],
          date: parseDDMMYY(singleLine[3]),
          bank: "Axis Bank",
          type: "credit",
          skip: false,
          dueDate: null,
          isForecast: false,
          confidence: 0.9,
          accountType: "savings" as const,
        };
      }
      // Multiline format: "INR X credited\nA/c no. XXnnnn\nDD-MM-YY, HH:MM:SS\nMERCHANT"
      const m = body.match(
        /INR\s+([\d,.]+)\s+credited[\s\S]*?A\/c\s+no\.\s+XX(\d+)[\s\S]*?(\d{2}-\d{2}-\d{2}),\s*\d{2}:\d{2}:\d{2}[\s\S]*?\n(.+?)(?:\n|$)/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: m[4].trim(),
        cardLast4: m[2],
        date: parseDDMMYY(m[3]),
        bank: "Axis Bank",
        type: "credit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ HDFC CC Refund ═══
  // "Alert! Rs. 1438.2 refunded by HOUSEOFPUREECO NEW DELHI IN on 29/APR/2026 &
  //  adjusted against HDFC Bank Credit Card 8957 View updated balance here: https://..."
  {
    name: "HDFC CC Refund",
    bank: "HDFC Bank",
    type: "refund",
    test: /Alert!?\s+Rs\.?\s*[\d,.]+\s+refunded\s+by[\s\S]*?HDFC\s+Bank\s+Credit\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /Alert!?\s+Rs\.?\s*([\d,.]+)\s+refunded\s+by\s+(.+?)\s+on\s+(\d{1,2}\/[A-Za-z]{3}\/\d{4})[\s\S]*?HDFC\s+Bank\s+Credit\s+Card\s+(\d+)/i,
      );
      if (!m) return null;
      // Merchant capture often has runs of spaces ("HOUSEOFPUREECO       NEW
      // DELHI    IN") from fixed-width bank template padding — normalise.
      const merchant = m[2].trim().replace(/\s+/g, " ");
      return {
        amount: parseAmount(m[1]),
        merchant,
        cardLast4: m[4],
        date: parseDDMMMYYYY(m[3]),
        bank: "HDFC Bank",
        type: "refund",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ ICICI CC Refund ═══
  // "IND*AMAZON refund of Rs 4,936.00 credited to ICICI Bank Credit Card
  //  XX3001 on 19-AUG-25. Revised total due Rs 57,531.50, minimum due Rs 12,094.00"
  // Also matches: "AMAZON PAY IN E COMMERC refund of Rs 454.00 credited to ..."
  {
    name: "ICICI CC Refund",
    bank: "ICICI Bank",
    type: "refund",
    test: /refund\s+of\s+Rs\.?\s*[\d,.]+\s+credited\s+to\s+ICICI\s+Bank\s+Credit\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /^(.+?)\s+refund\s+of\s+Rs\.?\s*([\d,.]+)\s+credited\s+to\s+ICICI\s+Bank\s+Credit\s+Card\s+XX(\d+)\s+on\s+(\d{1,2}-[A-Za-z]{3}-\d{2})/i,
      );
      if (!m) return null;
      const merchant = m[1].trim().replace(/\s+/g, " ");
      return {
        amount: parseAmount(m[2]),
        merchant,
        cardLast4: m[3],
        date: parseDDMMMYY(m[4]),
        bank: "ICICI Bank",
        type: "refund",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ Axis Refund ═══
  // "Refund INR 1087.00 credited to Axis Bank Card XX2445 on 12-04-26."
  {
    name: "Axis Refund",
    bank: "Axis Bank",
    type: "refund",
    test: /Refund\s+INR\s+[\d,.]+\s+credited\s+to\s+Axis\s+Bank\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /Refund\s+INR\s+([\d,.]+)\s+credited\s+to\s+Axis\s+Bank\s+Card\s+XX(\d+)\s+on\s+(\d{2}-\d{2}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: "Refund",
        cardLast4: m[2],
        date: parseDDMMYY(m[3]),
        bank: "Axis Bank",
        type: "refund",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ Axis NACH Debit ═══
  // "NACH mandate debit of INR 1500.00 from A/c XX2836 on 12-04-26 towards TATA AIA LIFE INS. Axis Bank"
  {
    name: "Axis NACH Debit",
    bank: "Axis Bank",
    type: "nach_debit",
    test: /NACH\s+mandate\s+debit[\s\S]*?Axis\s+Bank/i,
    parse: (body) => {
      const m = body.match(
        /NACH\s+mandate\s+debit\s+of\s+INR\s+([\d,.]+)\s+from\s+A\/c\s+XX(\d+)\s+on\s+(\d{2}-\d{2}-\d{2})[\s\S]*?towards\s+(.+?)(?:\.\s*|$)/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: m[4].trim(),
        cardLast4: m[2],
        date: parseDDMMYY(m[3]),
        bank: "Axis Bank",
        type: "nach_debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ Axis NACH Bounce ═══
  // "NACH mandate debit of INR 1500.00 from A/c XX2836 failed on 12-04-26 due to insufficient funds. Axis Bank"
  {
    name: "Axis NACH Bounce",
    bank: "Axis Bank",
    type: "nach_bounce",
    test: /NACH\s+mandate\s+debit[\s\S]*?failed[\s\S]*?Axis\s+Bank/i,
    parse: (body) => {
      const m = body.match(
        /NACH\s+mandate\s+debit\s+of\s+INR\s+([\d,.]+)\s+from\s+A\/c\s+XX(\d+)\s+failed\s+on\s+(\d{2}-\d{2}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: "NACH Bounce",
        cardLast4: m[2],
        date: parseDDMMYY(m[3]),
        bank: "Axis Bank",
        type: "nach_bounce",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        accountType: "savings" as const,
      };
    },
  },

  // ─── SBI ───

  // ═══ SBI Account Debit ═══
  // "Dear SBI Customer, Your a/c no. XXXXXXXX5678 is debited for Rs 2500.00 on 12-04-26 by trf to MERCHANT."
  {
    name: "SBI Account Debit",
    bank: "SBI",
    type: "debit",
    test: /SBI\s+Customer[\s\S]*?debited\s+for\s+Rs/i,
    parse: (body) => {
      const m = body.match(
        /a\/c\s+no\.\s+\w*?(\d{3,4})\s+is\s+debited\s+for\s+Rs\s*([\d,.]+)\s+on\s+(\d{1,2}-\d{2}-\d{2})[\s\S]*?(?:by\s+trf\s+to|towards)\s+(.+?)(?:\.|,\s*Ref)/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[2]),
        merchant: m[4].trim(),
        cardLast4: m[1],
        date: parseDDMMYY(m[3]),
        bank: "SBI",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ SBI Account Credit ═══
  // "Your a/c no. XXXXXXXX5678 is credited with Rs 50000.00 on 12-04-26 by trf from EMPLOYER. Avl Bal Rs 75000.00 - SBI"
  {
    name: "SBI Account Credit",
    bank: "SBI",
    type: "credit",
    test: /a\/c\s+no\.[\s\S]*?credited\s+with\s+Rs[\s\S]*?SBI/i,
    parse: (body) => {
      const m = body.match(
        /a\/c\s+no\.\s+\w*?(\d{3,4})\s+is\s+credited\s+with\s+Rs\s*([\d,.]+)\s+on\s+(\d{1,2}-\d{2}-\d{2})/i,
      );
      if (!m) return null;
      const balMatch = body.match(/Avl\s+Bal\s+Rs\s*([\d,.]+)/i);
      return {
        amount: parseAmount(m[2]),
        merchant: null,
        cardLast4: m[1],
        date: parseDDMMYY(m[3]),
        bank: "SBI",
        type: "credit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        availableBalance: balMatch ? parseAmount(balMatch[1]) : undefined,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ SBI UPI Debit ═══
  // "Dear Customer, Rs.500.00 debited from your SBI A/c XX5678 on 12-04-26 for UPI txn to MERCHANT. UPI Ref 123456."
  {
    name: "SBI UPI Debit",
    bank: "SBI",
    type: "upi_debit",
    test: /Rs\.[\d,.]+\s+debited\s+from\s+your\s+SBI\s+A\/c[\s\S]*?UPI/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+debited\s+from\s+your\s+SBI\s+A\/c\s+XX(\d+)\s+on\s+(\d{1,2}-\d{2}-\d{2})[\s\S]*?UPI\s+txn\s+to\s+(.+?)(?:\.\s*UPI|\.?\s*$)/i,
      );
      if (!m) return null;
      const upiRefMatch = body.match(/UPI\s+Ref\s+(\d+)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: m[4].trim(),
        cardLast4: m[2],
        date: parseDDMMYY(m[3]),
        bank: "SBI",
        type: "upi_debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        upiRef: upiRefMatch?.[1] ?? null,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ SBI Balance Info ═══
  // "Dear SBI Customer, Avl Bal in your A/c no. XXXXXXXX5678 is Rs 75000.00 as on 12-Apr-26."
  {
    name: "SBI Balance Info",
    bank: "SBI",
    type: "balance_inquiry",
    test: /SBI[\s\S]*?Avl\s+Bal\s+in\s+your\s+A\/c/i,
    parse: (body) => {
      const m = body.match(
        /Avl\s+Bal\s+in\s+your\s+A\/c\s+no\.\s+\w*?(\d{3,4})\s+is\s+Rs\s*([\d,.]+)/i,
      );
      if (!m) return null;
      return {
        amount: 0,
        merchant: null,
        cardLast4: m[1],
        date: null,
        bank: "SBI",
        type: "balance_inquiry",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        availableBalance: parseAmount(m[2]),
        accountType: "savings" as const,
      };
    },
  },

  // ═══ SBI Transfer Credit (NEFT/IMPS) ═══
  // "Dear SBI User, your A/c X0006-credited by Rs.35000 on 14Jun25 transfer from MANOJ KUMAR  JAIN Ref No 864260249409 -SBI"
  {
    name: "SBI Transfer Credit",
    bank: "SBI",
    type: "credit",
    test: /Dear\s+SBI\s+User[\s\S]*?A\/c\s+X\d+[\s-]credited\s+by\s+Rs/i,
    parse: (body) => {
      const m = body.match(
        /A\/c\s+X(\d+)[\s-]credited\s+by\s+Rs\.?\s*([\d,.]+)\s+on\s+(\d{1,2}[A-Za-z]{3}\d{2})\s+transfer\s+from\s+(.+?)(?:\s+Ref\s+No|\s+-\s*SBI|$)/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[2]),
        merchant: m[4].replace(/\s{2,}/g, " ").trim(),
        cardLast4: m[1],
        date: parseDDMMMYYCompact(m[3]),
        bank: "SBI",
        type: "credit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ SBI UPI Debit v2 (compact date format) ═══
  // "Dear UPI user A/C X0006 debited by 17870.68 on date 26Feb26 trf to FINZOOM INVESTME Refno 376828772738"
  {
    name: "SBI UPI Debit v2",
    bank: "SBI",
    type: "upi_debit",
    test: /Dear\s+UPI\s+user\s+A\/C\s+X\d+\s+debited\s+by/i,
    parse: (body) => {
      const m = body.match(
        /Dear\s+UPI\s+user\s+A\/C\s+X(\d+)\s+debited\s+by\s+([\d,.]+)\s+on\s+date\s+(\d{1,2}[A-Za-z]{3}\d{2})\s+trf\s+to\s+(.+?)(?:\s+Refno|\s+If\s+not|$)/i,
      );
      if (!m) return null;
      const refMatch = body.match(/Refno\s+(\d+)/i);
      return {
        amount: parseAmount(m[2]),
        merchant: m[4].trim(),
        cardLast4: m[1],
        date: parseDDMMMYYCompact(m[3]),
        bank: "SBI",
        type: "upi_debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        upiRef: refMatch?.[1] ?? null,
        upiSubtype: "p2m",
        accountType: "savings" as const,
      };
    },
  },

  // ═══ SBI Short UPI Debit ═══
  // "Ur 1st UPI Txn of Rs107.0 frm SBIN A/cX0006 is successful."
  {
    name: "SBI Short UPI Debit",
    bank: "SBI",
    type: "upi_debit",
    test: /UPI\s+Txn\s+of\s+Rs[\d,.]+\s+frm\s+SBIN\s+A\/c/i,
    parse: (body) => {
      const m = body.match(
        /UPI\s+Txn\s+of\s+Rs([\d,.]+)\s+frm\s+SBIN\s+A\/cX?(\d+)/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: null,
        cardLast4: m[2],
        date: null,
        bank: "SBI",
        type: "upi_debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.7,
        upiSubtype: "p2m",
        accountType: "savings" as const,
      };
    },
  },

  // ─── Kotak ───

  // ═══ Kotak Debit ═══
  // "Rs.1500.00 debited from your Kotak Bank A/c XX4567 on 12-04-26. Info: UPI/MERCHANT."
  {
    name: "Kotak Debit",
    bank: "Kotak Mahindra Bank",
    type: "debit",
    test: /Rs\.[\d,.]+\s+debited\s+from\s+your\s+Kotak\s+Bank\s+A\/c/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+debited\s+from\s+your\s+Kotak\s+Bank\s+A\/c\s+XX(\d+)\s+on\s+(\d{1,2}-\d{2}-\d{2})[\s\S]*?Info:\s*(.+?)(?:\.\s*|$)/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: m[4].trim(),
        cardLast4: m[2],
        date: parseDDMMYY(m[3]),
        bank: "Kotak Mahindra Bank",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ Kotak UPI Debit ═══
  // "INR 1500.00 debited from a/c XX4567 on 12-04-26 towards UPI/P2M/123456/MERCHANT. Avl Bal: INR 25000.00 -Kotak Mahindra Bank"
  {
    name: "Kotak UPI Debit",
    bank: "Kotak Mahindra Bank",
    type: "upi_debit",
    test: /INR\s+[\d,.]+\s+debited\s+from\s+a\/c\s+XX\d+[\s\S]*?UPI[\s\S]*?Kotak/i,
    parse: (body) => {
      const m = body.match(
        /INR\s+([\d,.]+)\s+debited\s+from\s+a\/c\s+XX(\d+)\s+on\s+(\d{1,2}-\d{2}-\d{2})[\s\S]*?UPI\/\w+\/\d+\/(.+?)(?:\.\s*Avl|\.\s*-|$)/i,
      );
      if (!m) return null;
      const balMatch = body.match(/Avl\s+Bal:\s+INR\s+([\d,.]+)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: m[4].trim(),
        cardLast4: m[2],
        date: parseDDMMYY(m[3]),
        bank: "Kotak Mahindra Bank",
        type: "upi_debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        availableBalance: balMatch ? parseAmount(balMatch[1]) : undefined,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ Kotak CC Alert ═══
  // "Rs.2500.00 charged on your Kotak Credit Card XX1234 at MERCHANT on 12-04-26. Avl Lmt Rs.1,50,000."
  {
    name: "Kotak CC Alert",
    bank: "Kotak Mahindra Bank",
    type: "debit",
    test: /Rs\.[\d,.]+\s+charged\s+on\s+your\s+Kotak\s+Credit\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+charged\s+on\s+your\s+Kotak\s+Credit\s+Card\s+XX(\d+)\s+at\s+(.+?)\s+on\s+(\d{1,2}-\d{2}-\d{2})/i,
      );
      if (!m) return null;
      const limMatch = body.match(/Avl\s+Lmt\s+Rs\.\s*([\d,.]+)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: m[3].trim(),
        cardLast4: m[2],
        date: parseDDMMYY(m[4]),
        bank: "Kotak Mahindra Bank",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        availableCreditLimit: limMatch ? parseAmount(limMatch[1]) : undefined,
        accountType: "credit_card" as const,
      };
    },
  },

  // ─── IDFC First ───

  // ═══ IDFC First Debit ═══
  // "Rs.2000.00 debited from your IDFC FIRST Bank A/c XX1234 on 12-Apr-26. UPI Ref 123456. If not done by you, call 18004190332"
  {
    name: "IDFC First Debit",
    bank: "IDFC FIRST Bank",
    type: "debit",
    test: /debited\s+from\s+your\s+IDFC\s+FIRST\s+Bank\s+A\/c/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+debited\s+from\s+your\s+IDFC\s+FIRST\s+Bank\s+A\/c\s+XX(\d+)\s+on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      const upiRefMatch = body.match(/UPI\s+Ref\s+(\d+)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: null,
        cardLast4: m[2],
        date: parseDDMMMYY(m[3]),
        bank: "IDFC FIRST Bank",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        upiRef: upiRefMatch?.[1] ?? null,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ IDFC First Credit ═══
  // "Rs.10000.00 credited to your IDFC FIRST Bank A/c XX1234 on 12-Apr-26. Avl Bal Rs.35000.00."
  {
    name: "IDFC First Credit",
    bank: "IDFC FIRST Bank",
    type: "credit",
    test: /credited\s+to\s+your\s+IDFC\s+FIRST\s+Bank\s+A\/c/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+credited\s+to\s+your\s+IDFC\s+FIRST\s+Bank\s+A\/c\s+XX(\d+)\s+on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      const balMatch = body.match(/Avl\s+Bal\s+Rs\.\s*([\d,.]+)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: null,
        cardLast4: m[2],
        date: parseDDMMMYY(m[3]),
        bank: "IDFC FIRST Bank",
        type: "credit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        availableBalance: balMatch ? parseAmount(balMatch[1]) : undefined,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ IDFC First UPI ═══
  // "Rs.500.00 debited from IDFC FIRST Bank A/c XX1234 on 12-04-26 for UPI to MERCHANT. UPI Ref 123456."
  {
    name: "IDFC First UPI",
    bank: "IDFC FIRST Bank",
    type: "upi_debit",
    test: /IDFC\s+FIRST\s+Bank\s+A\/c[\s\S]*?UPI/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+debited\s+from\s+IDFC\s+FIRST\s+Bank\s+A\/c\s+XX(\d+)\s+on\s+(\d{1,2}-\d{2}-\d{2})[\s\S]*?UPI\s+to\s+(.+?)(?:\.\s*UPI|\.?\s*$)/i,
      );
      if (!m) return null;
      const upiRefMatch = body.match(/UPI\s+Ref\s+(\d+)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: m[4].trim(),
        cardLast4: m[2],
        date: parseDDMMYY(m[3]),
        bank: "IDFC FIRST Bank",
        type: "upi_debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        upiRef: upiRefMatch?.[1] ?? null,
        accountType: "savings" as const,
      };
    },
  },

  // ─── Federal Bank ───

  // ═══ Federal Bank Debit ═══
  // "Rs.3000.00 debited from your Federal Bank A/c XX9876 on 12-Apr-26. Info: NEFT/MERCHANT."
  {
    name: "Federal Bank Debit",
    bank: "Federal Bank",
    type: "debit",
    test: /debited\s+from\s+your\s+Federal\s+Bank\s+A\/c/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+debited\s+from\s+your\s+Federal\s+Bank\s+A\/c\s+XX(\d+)\s+on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      const infoMatch = body.match(/Info:\s*(.+?)(?:\.|$)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: infoMatch?.[1]?.trim() ?? null,
        cardLast4: m[2],
        date: parseDDMMMYY(m[3]),
        bank: "Federal Bank",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ Federal Bank Credit ═══
  // "Rs.15000.00 credited to your Federal Bank A/c XX9876 on 12-Apr-26. Avl Bal Rs.45000.00."
  {
    name: "Federal Bank Credit",
    bank: "Federal Bank",
    type: "credit",
    test: /credited\s+to\s+your\s+Federal\s+Bank\s+A\/c/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+credited\s+to\s+your\s+Federal\s+Bank\s+A\/c\s+XX(\d+)\s+on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      const balMatch = body.match(/Avl\s+Bal\s+Rs\.\s*([\d,.]+)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: null,
        cardLast4: m[2],
        date: parseDDMMMYY(m[3]),
        bank: "Federal Bank",
        type: "credit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        availableBalance: balMatch ? parseAmount(balMatch[1]) : undefined,
        accountType: "savings" as const,
      };
    },
  },

  // ─── Citi ───

  // ═══ Citi CC Spend ═══
  // "Rs.4500.00 spent on Citi Card XX6789 at MERCHANT on 12-04-26. Avl Credit Limit: Rs.2,50,000."
  {
    name: "Citi CC Spend",
    bank: "Citi Bank",
    type: "debit",
    test: /Rs\.[\d,.]+\s+spent\s+on\s+Citi\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+spent\s+on\s+Citi\s+Card\s+XX(\d+)\s+at\s+(.+?)\s+on\s+(\d{1,2}-\d{2}-\d{2})/i,
      );
      if (!m) return null;
      const limMatch = body.match(/Avl\s+Credit\s+Limit:\s+Rs\.\s*([\d,.]+)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: m[3].trim(),
        cardLast4: m[2],
        date: parseDDMMYY(m[4]),
        bank: "Citi Bank",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        availableCreditLimit: limMatch ? parseAmount(limMatch[1]) : undefined,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ Citi CC Due Reminder ═══
  // "Citi Card XX6789: Min Due Rs.2500, Total Due Rs.45000. Pay by 15-05-26 to avoid late fee."
  {
    name: "Citi CC Due",
    bank: "Citi Bank",
    type: "amount_due_reminder",
    test: /Citi\s+Card\s+XX\d+[\s\S]*?(?:Min\s+Due|Total\s+Due)[\s\S]*?Pay\s+by/i,
    parse: (body) => {
      const m = body.match(
        /Citi\s+Card\s+XX(\d+)[\s\S]*?Total\s+Due\s+Rs\.\s*([\d,.]+)[\s\S]*?Pay\s+by\s+(\d{1,2}-\d{2}-\d{2})/i,
      );
      if (!m) return null;
      const minMatch = body.match(/Min\s+Due\s+Rs\.\s*([\d,.]+)/i);
      return {
        amount: parseAmount(m[2]),
        merchant: "Credit Card Total Due",
        cardLast4: m[1],
        date: null,
        bank: "Citi Bank",
        type: "amount_due_reminder",
        skip: false,
        dueDate: parseDDMMYY(m[3]),
        isForecast: true,
        confidence: 0.85,
        accountType: "credit_card" as const,
        minDue: minMatch ? parseAmount(minMatch[1]) : undefined,
      };
    },
  },

  // ─── Amex ───

  // ═══ Amex Spend Alert ═══
  // "INR 8500.00 charged on your AMEX Card XX5555 at MERCHANT on 12-Apr-26."
  {
    name: "Amex Spend Alert",
    bank: "American Express",
    type: "debit",
    test: /INR\s+[\d,.]+\s+charged\s+on\s+your\s+AMEX\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /INR\s+([\d,.]+)\s+charged\s+on\s+your\s+AMEX\s+Card\s+XX(\d+)\s+at\s+(.+?)\s+on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: m[3].trim(),
        cardLast4: m[2],
        date: parseDDMMMYY(m[4]),
        bank: "American Express",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ Amex Payment Due ═══
  // "Payment of INR 25000.00 due on your AMEX Card XX5555 by 20-05-26."
  {
    name: "Amex Payment Due",
    bank: "American Express",
    type: "amount_due_reminder",
    test: /Payment\s+of\s+INR\s+[\d,.]+\s+due\s+on\s+your\s+AMEX\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /Payment\s+of\s+INR\s+([\d,.]+)\s+due\s+on\s+your\s+AMEX\s+Card\s+XX(\d+)\s+by\s+(\d{1,2}-\d{2}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: "Credit Card Payment Due",
        cardLast4: m[2],
        date: null,
        bank: "American Express",
        type: "amount_due_reminder",
        skip: false,
        dueDate: parseDDMMYY(m[3]),
        isForecast: true,
        confidence: 0.85,
        accountType: "credit_card" as const,
      };
    },
  },

  // ─── RBL ───

  // ═══ RBL CC Spend ═══
  // "Rs.3200.00 spent on RBL Bank Card XX7890 at MERCHANT on 12-04-26."
  {
    name: "RBL CC Spend",
    bank: "RBL Bank",
    type: "debit",
    test: /Rs\.[\d,.]+\s+spent\s+on\s+RBL\s+Bank\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+spent\s+on\s+RBL\s+Bank\s+Card\s+XX(\d+)\s+at\s+(.+?)\s+on\s+(\d{1,2}-\d{2}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: m[3].trim(),
        cardLast4: m[2],
        date: parseDDMMYY(m[4]),
        bank: "RBL Bank",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ RBL CC Due ═══
  // "Payment reminder: Rs.15000 due on RBL CC XX7890 by 20-05-26. Pay now to avoid charges."
  {
    name: "RBL CC Due",
    bank: "RBL Bank",
    type: "amount_due_reminder",
    test: /Payment\s+reminder[\s\S]*?RBL\s+CC\s+XX\d+[\s\S]*?by/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+due\s+on\s+RBL\s+CC\s+XX(\d+)\s+by\s+(\d{1,2}-\d{2}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: "Credit Card Payment Due",
        cardLast4: m[2],
        date: null,
        bank: "RBL Bank",
        type: "amount_due_reminder",
        skip: false,
        dueDate: parseDDMMYY(m[3]),
        isForecast: true,
        confidence: 0.85,
        accountType: "credit_card" as const,
      };
    },
  },

  // ─── HSBC ───

  // ═══ HSBC Debit ═══
  // "Rs.5000.00 debited from HSBC A/c XX3456 on 12-Apr-26. Info: NEFT/MERCHANT."
  {
    name: "HSBC Debit",
    bank: "HSBC",
    type: "debit",
    test: /Rs\.[\d,.]+\s+debited\s+from\s+HSBC\s+A\/c/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+debited\s+from\s+HSBC\s+A\/c\s+XX(\d+)\s+on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      const infoMatch = body.match(/Info:\s*(.+?)(?:\.|$)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: infoMatch?.[1]?.trim() ?? null,
        cardLast4: m[2],
        date: parseDDMMMYY(m[3]),
        bank: "HSBC",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ HSBC CC Alert ═══
  // "Rs.7500.00 spent on HSBC CC XX4567 at MERCHANT on 12-04-26."
  {
    name: "HSBC CC Alert",
    bank: "HSBC",
    type: "debit",
    test: /Rs\.[\d,.]+\s+spent\s+on\s+HSBC\s+CC/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+spent\s+on\s+HSBC\s+CC\s+XX(\d+)\s+at\s+(.+?)\s+on\s+(\d{1,2}-\d{2}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: m[3].trim(),
        cardLast4: m[2],
        date: parseDDMMYY(m[4]),
        bank: "HSBC",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        accountType: "credit_card" as const,
      };
    },
  },

  // ─── AU Small Finance Bank ───

  // ═══ AU Bank Debit ═══
  // "Rs.1500.00 debited from your AU Small Finance Bank A/c XX8901 on 12-Apr-26. Info: UPI/MERCHANT."
  {
    name: "AU Bank Debit",
    bank: "AU Small Finance Bank",
    type: "debit",
    test: /debited\s+from\s+your\s+AU\s+Small\s+Finance\s+Bank\s+A\/c/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+debited\s+from\s+your\s+AU\s+Small\s+Finance\s+Bank\s+A\/c\s+XX(\d+)\s+on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      const infoMatch = body.match(/Info:\s*(.+?)(?:\.|$)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: infoMatch?.[1]?.trim() ?? null,
        cardLast4: m[2],
        date: parseDDMMMYY(m[3]),
        bank: "AU Small Finance Bank",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ AU Bank Credit ═══
  // "Rs.25000.00 credited to your AU Small Finance Bank A/c XX8901 on 12-Apr-26. Avl Bal Rs.50000.00."
  {
    name: "AU Bank Credit",
    bank: "AU Small Finance Bank",
    type: "credit",
    test: /credited\s+to\s+your\s+AU\s+Small\s+Finance\s+Bank\s+A\/c/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+credited\s+to\s+your\s+AU\s+Small\s+Finance\s+Bank\s+A\/c\s+XX(\d+)\s+on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      const balMatch = body.match(/Avl\s+Bal\s+Rs\.\s*([\d,.]+)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: null,
        cardLast4: m[2],
        date: parseDDMMMYY(m[3]),
        bank: "AU Small Finance Bank",
        type: "credit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        availableBalance: balMatch ? parseAmount(balMatch[1]) : undefined,
        accountType: "savings" as const,
      };
    },
  },

  // ─── Google Pay ───

  // ═══ Google Pay UPI Debit ═══
  // "Sent Rs.500 to MERCHANT via Google Pay. UPI Ref: 123456789012."
  {
    name: "Google Pay UPI Debit",
    bank: "Google Pay",
    type: "upi_debit",
    test: /Sent\s+Rs\.[\d,.]+\s+to\s+.+?via\s+Google\s+Pay/i,
    parse: (body) => {
      const m = body.match(
        /Sent\s+Rs\.\s*([\d,.]+)\s+to\s+(.+?)\s+via\s+Google\s+Pay/i,
      );
      if (!m) return null;
      const upiRefMatch = body.match(/UPI\s+Ref[:\s]+(\d+)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: m[2].trim(),
        cardLast4: null,
        date: null,
        bank: "Google Pay",
        type: "upi_debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        upiRef: upiRefMatch?.[1] ?? null,
      };
    },
  },

  // ═══ Google Pay UPI Credit ═══
  // "Received Rs.1000 from NAME via Google Pay. UPI Ref: 123456789012."
  {
    name: "Google Pay UPI Credit",
    bank: "Google Pay",
    type: "upi_credit",
    test: /Received\s+Rs\.[\d,.]+\s+from\s+.+?via\s+Google\s+Pay/i,
    parse: (body) => {
      const m = body.match(
        /Received\s+Rs\.\s*([\d,.]+)\s+from\s+(.+?)\s+via\s+Google\s+Pay/i,
      );
      if (!m) return null;
      const upiRefMatch = body.match(/UPI\s+Ref[:\s]+(\d+)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: m[2].trim(),
        cardLast4: null,
        date: null,
        bank: "Google Pay",
        type: "upi_credit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        upiRef: upiRefMatch?.[1] ?? null,
      };
    },
  },

  // ─── PhonePe ───

  // ═══ PhonePe UPI Debit ═══
  // "Rs 1000 sent to MERCHANT from your HDFC Bank A/c XX5678 via PhonePe. UPI Ref No. 123456789012."
  {
    name: "PhonePe UPI Debit",
    bank: "PhonePe",
    type: "upi_debit",
    test: /Rs\s+[\d,.]+\s+sent\s+to\s+.+?via\s+PhonePe/i,
    parse: (body) => {
      const m = body.match(
        /Rs\s+([\d,.]+)\s+sent\s+to\s+(.+?)\s+from\s+your\s+\w+[\s\w]*?A\/c\s+XX(\d+)\s+via\s+PhonePe/i,
      );
      if (!m) return null;
      const upiRefMatch = body.match(/UPI\s+Ref\s+No\.\s*(\d+)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: m[2].trim(),
        cardLast4: m[3],
        date: null,
        bank: "PhonePe",
        type: "upi_debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        upiRef: upiRefMatch?.[1] ?? null,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ PhonePe UPI Credit ═══
  // "Rs 5000 received from NAME to your ICICI Bank A/c XX322 via PhonePe. UPI Ref No. 123456789012."
  {
    name: "PhonePe UPI Credit",
    bank: "PhonePe",
    type: "upi_credit",
    test: /Rs\s+[\d,.]+\s+received\s+from\s+.+?via\s+PhonePe/i,
    parse: (body) => {
      const m = body.match(
        /Rs\s+([\d,.]+)\s+received\s+from\s+(.+?)\s+to\s+your\s+\w+[\s\w]*?A\/c\s+XX(\d+)\s+via\s+PhonePe/i,
      );
      if (!m) return null;
      const upiRefMatch = body.match(/UPI\s+Ref\s+No\.\s*(\d+)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: m[2].trim(),
        cardLast4: m[3],
        date: null,
        bank: "PhonePe",
        type: "upi_credit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        upiRef: upiRefMatch?.[1] ?? null,
        accountType: "savings" as const,
      };
    },
  },

  // ─── Paytm ───

  // ═══ Paytm UPI Credit ═══
  // "Rs.2000 received from NAME via Paytm UPI. Ref: 123456789012."
  {
    name: "Paytm UPI Credit",
    bank: "Paytm",
    type: "upi_credit",
    test: /Rs\.[\d,.]+\s+received\s+from\s+.+?via\s+Paytm\s+UPI/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+received\s+from\s+(.+?)\s+via\s+Paytm\s+UPI/i,
      );
      if (!m) return null;
      const refMatch = body.match(/Ref[:\s]+(\d+)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: m[2].trim(),
        cardLast4: null,
        date: null,
        bank: "Paytm",
        type: "upi_credit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        upiRef: refMatch?.[1] ?? null,
      };
    },
  },

  // ═══ Paytm Wallet Debit ═══
  // "Rs.350 debited from Paytm Wallet for MERCHANT. Balance: Rs.1500."
  {
    name: "Paytm Wallet Debit",
    bank: "Paytm",
    type: "debit",
    test: /Rs\.[\d,.]+\s+debited\s+from\s+Paytm\s+Wallet/i,
    parse: (body) => {
      const m = body.match(
        /Rs\.\s*([\d,.]+)\s+debited\s+from\s+Paytm\s+Wallet\s+for\s+(.+?)(?:\.\s*Balance|$)/i,
      );
      if (!m) return null;
      const balMatch = body.match(/Balance:\s*Rs\.\s*([\d,.]+)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: m[2].trim(),
        cardLast4: null,
        date: null,
        bank: "Paytm",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.85,
        availableBalance: balMatch ? parseAmount(balMatch[1]) : undefined,
      };
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // TASK 11.6: Refunds, NACH, Extended CC Dues
  // ═══════════════════════════════════════════════════════════════

  // ═══ SBI Refund ═══
  // "SBI: Refund of Rs.1500.00 credited to A/c XX4567 on 12-Apr-26. Ref 789012."
  {
    name: "SBI Refund",
    bank: "SBI",
    type: "refund",
    test: /SBI[\s\S]*?Refund[\s\S]*?credited\s+to\s+A\/c/i,
    parse: (body) => {
      const m = body.match(
        /Refund\s+of\s+Rs\.\s*([\d,.]+)\s+credited\s+to\s+A\/c\s+(?:XX|xx)?(\d+)\s+on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: "Refund",
        cardLast4: m[2],
        date: parseDateAny(m[3]),
        bank: "SBI",
        type: "refund",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ Generic Refund ═══
  // "Rs.500 refund credited to your account XX1234 on 12-04-2026."
  {
    name: "Generic Refund",
    bank: "Unknown",
    type: "refund",
    test: /(?:Rs\.?\s*[\d,.]+\s+refund|refund\s+of\s+Rs\.?\s*[\d,.]+)\s+credited/i,
    parse: (body) => {
      const m = body.match(
        /(?:Rs\.?\s*([\d,.]+)\s+refund|refund\s+of\s+Rs\.?\s*([\d,.]+))\s+credited[\s\S]*?(?:(?:card|a\/c|account)\s*(?:XX|xx|ending\s*)?)(\d{3,4})\s+on\s+(\d{1,2}-\d{1,2}-\d{2,4})/i,
      );
      if (!m) return null;
      const amount = m[1] || m[2];
      return {
        amount: parseAmount(amount),
        merchant: "Refund",
        cardLast4: m[3],
        date: parseDateAny(m[4]),
        bank: "Unknown",
        type: "refund",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.7,
      };
    },
  },

  // ═══ SBI NACH Debit ═══
  // "SBI: NACH debit of Rs.499.00 from A/c XX4567 on 12-Apr-26 towards SPOTIFY INDIA."
  {
    name: "SBI NACH Debit",
    bank: "SBI",
    type: "nach_debit",
    test: /SBI[\s\S]*?NACH\s+debit/i,
    parse: (body) => {
      const m = body.match(
        /NACH\s+debit\s+of\s+Rs\.\s*([\d,.]+)\s+from\s+A\/c\s+(?:XX|xx)?(\d+)\s+on\s+(\d{1,2}-\w{3}-\d{2})[\s\S]*?towards\s+(.+?)(?:\.|$)/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: m[4].trim(),
        cardLast4: m[2],
        date: parseDateAny(m[3]),
        bank: "SBI",
        type: "nach_debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ ICICI CC Total Due ═══
  // "ICICI Bank Credit Card XX3001: Total Due Rs.45000, Min Due Rs.2500. Pay by 15-May-26."
  {
    name: "ICICI CC Total Due",
    bank: "ICICI Bank",
    type: "amount_due_reminder",
    test: /ICICI\s+Bank\s+Credit\s+Card[\s\S]*?Total\s+Due/i,
    parse: (body) => {
      const m = body.match(
        /ICICI\s+Bank\s+Credit\s+Card\s+XX(\d+)[\s\S]*?Total\s+Due\s+Rs\.\s*([\d,.]+)[\s\S]*?Min\s+Due\s+Rs\.\s*([\d,.]+)[\s\S]*?Pay\s+by\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[2]),
        merchant: "ICICI Credit Card Due",
        cardLast4: m[1],
        date: null,
        bank: "ICICI Bank",
        type: "amount_due_reminder",
        skip: false,
        dueDate: parseDateAny(m[4]),
        isForecast: true,
        confidence: 0.95,
        accountType: "credit_card" as const,
        minDue: parseAmount(m[3]),
      };
    },
  },

  // ═══ Kotak CC Payment Reminder ═══
  // "Kotak Bank: Your Credit Card XX5678 payment of Rs.32000 is due on 20-May-26. Min Due Rs.1600."
  {
    name: "Kotak CC Payment Reminder",
    bank: "Kotak Mahindra Bank",
    type: "amount_due_reminder",
    test: /Kotak\s+Bank[\s\S]*?Credit\s+Card[\s\S]*?payment[\s\S]*?due/i,
    parse: (body) => {
      const m = body.match(
        /Credit\s+Card\s+XX(\d+)\s+payment\s+of\s+Rs\.\s*([\d,.]+)\s+is\s+due\s+on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      const minMatch = body.match(/Min\s+Due\s+Rs\.\s*([\d,.]+)/i);
      return {
        amount: parseAmount(m[2]),
        merchant: "Kotak Credit Card Due",
        cardLast4: m[1],
        date: null,
        bank: "Kotak Mahindra Bank",
        type: "amount_due_reminder",
        skip: false,
        dueDate: parseDateAny(m[3]),
        isForecast: true,
        confidence: 0.95,
        accountType: "credit_card" as const,
        minDue: minMatch ? parseAmount(minMatch[1]) : undefined,
      };
    },
  },

  // ═══ SBI CC Statement ═══
  // "SBI Card XX8901: Statement generated. Total Due Rs.28000, Min Due Rs.1400. Pay by 05-May-26."
  {
    name: "SBI CC Statement",
    bank: "SBI",
    type: "amount_due_reminder",
    test: /SBI\s+Card[\s\S]*?Statement\s+generated[\s\S]*?Total\s+Due/i,
    parse: (body) => {
      const m = body.match(
        /SBI\s+Card\s+XX(\d+)[\s\S]*?Total\s+Due\s+Rs\.\s*([\d,.]+)[\s\S]*?Min\s+Due\s+Rs\.\s*([\d,.]+)[\s\S]*?Pay\s+by\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[2]),
        merchant: "SBI Credit Card Due",
        cardLast4: m[1],
        date: null,
        bank: "SBI",
        type: "amount_due_reminder",
        skip: false,
        dueDate: parseDateAny(m[4]),
        isForecast: true,
        confidence: 0.95,
        accountType: "credit_card" as const,
        minDue: parseAmount(m[3]),
      };
    },
  },

  // ═══ Axis CC Outstanding ═══
  // "Axis Bank: Your Credit Card XX2445 outstanding is Rs.18500. Min Due Rs.925. Due date: 10-May-26."
  {
    name: "Axis CC Outstanding",
    bank: "Axis Bank",
    type: "amount_due_reminder",
    test: /Axis\s+Bank[\s\S]*?Credit\s+Card[\s\S]*?outstanding/i,
    parse: (body) => {
      const m = body.match(
        /Credit\s+Card\s+XX(\d+)\s+outstanding\s+is\s+Rs\.\s*([\d,.]+)[\s\S]*?Due\s+date:\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      const minMatch = body.match(/Min\s+Due\s+Rs\.\s*([\d,.]+)/i);
      return {
        amount: parseAmount(m[2]),
        merchant: "Axis Credit Card Due",
        cardLast4: m[1],
        date: null,
        bank: "Axis Bank",
        type: "amount_due_reminder",
        skip: false,
        dueDate: parseDateAny(m[3]),
        isForecast: true,
        confidence: 0.95,
        accountType: "credit_card" as const,
        minDue: minMatch ? parseAmount(minMatch[1]) : undefined,
      };
    },
  },

  // ═══ Airtel Postpaid Bill Due (via ICICI) ═══
  // "AIRTEL POSTPAID bill of Rs 824.82 for 9874059999 is due on 31-12-2025."
  // "AIRTEL POSTPAID bill of Rs 234.82 for 9886709275 is due on 2026-01-06."
  // "AIRTEL POSTPAID bill of Rs 234.82 for 9886709275 is due on 06-01-2026."
  {
    name: "Airtel Postpaid Bill Due",
    bank: "ICICI Bank",
    type: "standing_instruction_reminder",
    test: /AIRTEL\s+POSTPAID\s+bill\s+of\s+Rs\s+[\d,.]+[\s\S]*?is\s+due\s+on/i,
    parse: (body) => {
      const m = body.match(
        /AIRTEL\s+POSTPAID\s+bill\s+of\s+Rs\s+([\d,.]+)\s+for\s+(\d+)\s+is\s+due\s+on\s+(\S+)/i,
      );
      if (!m) return null;
      const dueDate = parseDateAny(m[3]) ?? parseYYYYMMDDTime(m[3]);
      return {
        amount: parseAmount(m[1]),
        merchant: `Airtel Postpaid — ${m[2]}`,
        cardLast4: null,
        date: null,
        bank: "ICICI Bank",
        type: "standing_instruction_reminder",
        skip: false,
        dueDate,
        isForecast: true,
        confidence: 0.85,
      };
    },
  },

  // ═══ Airtel Postpaid Last Day Reminder ═══
  // "Last day to pay AIRTEL POSTPAID bill of Rs 234.82 for 9886709275."
  {
    name: "Airtel Postpaid Last Day",
    bank: "ICICI Bank",
    type: "standing_instruction_reminder",
    test: /Last\s+day\s+to\s+pay\s+AIRTEL\s+POSTPAID/i,
    parse: (body) => {
      const m = body.match(
        /Last\s+day\s+to\s+pay\s+AIRTEL\s+POSTPAID\s+bill\s+of\s+Rs\s+([\d,.]+)\s+for\s+(\d+)/i,
      );
      if (!m) return null;
      const today = new Date().toISOString().split("T")[0];
      return {
        amount: parseAmount(m[1]),
        merchant: `Airtel Postpaid — ${m[2]}`,
        cardLast4: null,
        date: null,
        bank: "ICICI Bank",
        type: "standing_instruction_reminder",
        skip: false,
        dueDate: today,
        isForecast: true,
        confidence: 0.85,
      };
    },
  },

  // ═══ ICICI CC Merchant Refund ═══
  // "IND*AMAZON refund of Rs 4,936.00 credited to ICICI Bank Credit Card XX3001 on 19-AUG-25."
  // "NETFLIX refund of Rs 2.00 credited to ICICI Bank Credit Card XX3001 on 18-JUL-25."
  {
    name: "ICICI CC Merchant Refund",
    bank: "ICICI Bank",
    type: "refund",
    test: /refund\s+of\s+Rs\s+[\d,.]+\s+credited\s+to\s+ICICI\s+Bank\s+Credit\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /(.+?)\s+refund\s+of\s+Rs\s+([\d,.]+)\s+credited\s+to\s+ICICI\s+Bank\s+Credit\s+Card\s+XX(\d+)\s+on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[2]),
        merchant: m[1].trim(),
        cardLast4: m[3],
        date: parseDDMMMYY(m[4]),
        bank: "ICICI Bank",
        type: "refund",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ ICICI CC Statement Due ═══
  // "ICICI Bank Credit Card XX3001 Statement is sent to so*********70@gmail.com. Total of Rs 24,138.86 or minimum of Rs 1,210.00 is due by 30-JUL-25."
  {
    name: "ICICI CC Statement Due",
    bank: "ICICI Bank",
    type: "amount_due_reminder",
    test: /ICICI\s+Bank\s+Credit\s+Card\s+XX\d+\s+Statement\s+is\s+sent/i,
    parse: (body) => {
      const m = body.match(
        /ICICI\s+Bank\s+Credit\s+Card\s+XX(\d+)\s+Statement[\s\S]*?Total\s+of\s+Rs\s+([\d,.]+)\s+or\s+minimum\s+of\s+Rs\s+([\d,.]+)\s+is\s+due\s+by\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[2]),
        merchant: "ICICI Credit Card Due",
        cardLast4: m[1],
        date: null,
        bank: "ICICI Bank",
        type: "amount_due_reminder",
        skip: false,
        dueDate: parseDDMMMYY(m[4]),
        isForecast: true,
        confidence: 0.95,
        accountType: "credit_card" as const,
        minDue: parseAmount(m[3]),
      };
    },
  },

  // ═══ ICICI Account Credit (ACH/NEFT) ═══
  // "ICICI Bank Account XX322 credited:Rs. 22.00 on 25-Jul-25. Info ACH*TITANFINDIV250725*654710."
  {
    name: "ICICI Account Credit",
    bank: "ICICI Bank",
    type: "credit",
    test: /ICICI\s+Bank\s+Account\s+XX\d+\s+credited/i,
    parse: (body) => {
      const m = body.match(
        /ICICI\s+Bank\s+Account\s+XX(\d+)\s+credited[:\s]*Rs\.\s*([\d,.]+)\s+on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      const infoMatch = body.match(/Info\s+(.+?)(?:\.\s*Available|$)/i);
      const balMatch = body.match(/Available\s+Balance\s+is\s+Rs\.\s*([\d,.]+)/i);
      return {
        amount: parseAmount(m[2]),
        merchant: infoMatch?.[1]?.trim() ?? null,
        cardLast4: m[1],
        date: parseDDMMMYY(m[3]),
        bank: "ICICI Bank",
        type: "credit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        availableBalance: balMatch ? parseAmount(balMatch[1]) : undefined,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ ICICI Customer UPI Credit ═══
  // "Dear Customer, Acct XX322 is credited with Rs 2279.00 on 01-Jun-25 from SOURAV BAID. UPI:515214511251-ICICI Bank."
  {
    name: "ICICI Customer UPI Credit",
    bank: "ICICI Bank",
    type: "upi_credit",
    test: /Acct\s+XX\d+\s+is\s+credited\s+with\s+Rs/i,
    parse: (body) => {
      const m = body.match(
        /Acct\s+XX(\d+)\s+is\s+credited\s+with\s+Rs\s+([\d,.]+)\s+on\s+(\d{1,2}-\w{3}-\d{2})\s+from\s+(.+?)(?:\.\s*UPI|$)/i,
      );
      if (!m) return null;
      const upiRefMatch = body.match(/UPI[:\s]*(\d+)/i);
      return {
        amount: parseAmount(m[2]),
        merchant: m[4].trim(),
        cardLast4: m[1],
        date: parseDDMMMYY(m[3]),
        bank: "ICICI Bank",
        type: "upi_credit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.9,
        upiRef: upiRefMatch?.[1] ?? null,
        accountType: "savings" as const,
      };
    },
  },

  // ═══ ICICI CC Payment INR (alternate format) ═══
  // "Dear Customer, Payment of INR 10,000.00 has been received on your ICICI Bank Credit Card Account 4xxx3001 on 27-JUN-25."
  {
    name: "ICICI CC Payment INR",
    bank: "ICICI Bank",
    type: "payment_received",
    test: /Payment\s+of\s+INR\s+[\d,.]+\s+has\s+been\s+received\s+on\s+your\s+ICICI\s+Bank\s+Credit\s+Card\s+Account/i,
    parse: (body) => {
      const m = body.match(
        /Payment\s+of\s+INR\s+([\d,.]+)\s+has\s+been\s+received\s+on\s+your\s+ICICI\s+Bank\s+Credit\s+Card\s+Account\s+\w*?(\d{4})\s+on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: "Credit Card Payment",
        cardLast4: m[2],
        date: parseDDMMMYY(m[3]),
        bank: "ICICI Bank",
        type: "payment_received",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.95,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ Axis CC Statement Generated (forecast) ═══
  // "Your statement for Axis Bank Credit Card no. XX2445 is generated.\nDue on: 05-05-26\nTotal amt: INR  Dr. 10835.73\nMin amt due: INR  Dr. 217.00"
  // Credit balance variant: "Total amt: INR  Cr. 228.00\nMin amt due: INR   0.00" → skip (nothing owed)
  {
    name: "Axis CC Statement",
    bank: "Axis Bank",
    type: "amount_due_reminder",
    test: /Your\s+statement\s+for\s+Axis\s+Bank\s+Credit\s+Card\s+no\.\s+XX\d+\s+is\s+generated/i,
    parse: (body) => {
      const m = body.match(
        /Axis\s+Bank\s+Credit\s+Card\s+no\.\s+XX(\d+)\s+is\s+generated[\s\S]*?Due\s+on:\s+(\d{2}-\d{2}-\d{2})[\s\S]*?Total\s+amt:\s+INR\s+(Dr\.|Cr\.)\s*([\d,.]+)[\s\S]*?Min\s+amt\s+due:\s+INR\s+(?:Dr\.\s*)?([\d,.]+)/i,
      );
      if (!m) return null;
      if (m[3] === "Cr.") return null;
      const totalDue = parseAmount(m[4]);
      if (totalDue === 0) return null;
      return {
        amount: totalDue,
        merchant: "Axis Credit Card Due",
        cardLast4: m[1],
        date: null,
        bank: "Axis Bank",
        type: "amount_due_reminder",
        skip: false,
        dueDate: parseDDMMYY(m[2]),
        isForecast: true,
        confidence: 0.95,
        accountType: "credit_card" as const,
        minDue: parseAmount(m[5]),
      };
    },
  },

  // ═══ Axis CC AutoPay Reminder (forecast) ═══
  // "INR 8400.00 for LinkedIn will be auto debited via Axis Bank Credit Card no. XX2445 by 09-03-26."
  {
    name: "Axis CC AutoPay Reminder",
    bank: "Axis Bank",
    type: "standing_instruction_reminder",
    test: /INR\s+[\d,.]+\s+for\s+.+?\s+will\s+be\s+auto\s+debited\s+via\s+Axis\s+Bank\s+Credit\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /INR\s+([\d,.]+)\s+for\s+(.+?)\s+will\s+be\s+auto\s+debited\s+via\s+Axis\s+Bank\s+Credit\s+Card\s+no\.\s+XX(\d+)\s+by\s+(\d{2}-\d{2}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: m[2].trim(),
        cardLast4: m[3],
        date: null,
        bank: "Axis Bank",
        type: "standing_instruction_reminder",
        skip: false,
        dueDate: parseDDMMYY(m[4]),
        isForecast: true,
        confidence: 0.9,
      };
    },
  },

  // ═══ IDFC First CC Spend ═══
  // "Delicious Purchase! INR 809.00 spent on your IDFC FIRST Bank Credit Card ending XX6284 at 10TH STREET COFFEE on 22 JUN 2025 at 04:12 PM Avbl Limit: INR 135741.84 ..."
  // "Transaction Successful! INR 148.50 spent on your IDFC FIRST Bank Credit Card ending XX6284 at RAZ*CUSTCAP SOLUTIONS on 26 MAR 2026 at 11:20 AM Avbl Limit: INR 127364.67 ..."
  {
    name: "IDFC First CC Spend",
    bank: "IDFC FIRST Bank",
    type: "debit",
    test: /INR\s+[\d,.]+\s+spent\s+on\s+your\s+IDFC\s+FIRST\s+Bank\s+Credit\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /INR\s+([\d,.]+)\s+spent\s+on\s+your\s+IDFC\s+FIRST\s+Bank\s+Credit\s+Card\s+ending\s+XX(\d+)\s+at\s+(.+?)\s+on\s+(\d{1,2}\s+\w{3}\s+\d{4})/i,
      );
      if (!m) return null;
      const limMatch = body.match(/Avbl\s*Limit[:\s]*INR\s*([\d,]+\.?\d*)/i);
      return {
        amount: parseAmount(m[1]),
        merchant: m[3].trim(),
        cardLast4: m[2],
        date: parseDDMMMYYYYSpaced(m[4]),
        bank: "IDFC FIRST Bank",
        type: "debit",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.95,
        availableCreditLimit: limMatch ? parseAmount(limMatch[1]) : undefined,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ IDFC First CC Payment Received ═══
  // "Thank you for payment of INR 889.80 towards your FIRST Select Credit Card XX6284 on 25 Apr 2026. IDFC FIRST Bank"
  {
    name: "IDFC First CC Payment Received",
    bank: "IDFC FIRST Bank",
    type: "payment_received",
    test: /Thank\s+you\s+for\s+payment\s+of\s+INR[\s\S]+?FIRST[\s\S]+?Credit\s+Card/i,
    parse: (body) => {
      const m = body.match(
        /Thank\s+you\s+for\s+payment\s+of\s+INR\s+([\d,.]+)\s+towards\s+your\s+.*?Credit\s+Card\s+XX(\d+)\s+on\s+(\d{1,2}\s+\w{3}\s+\d{4})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[1]),
        merchant: "Credit Card Payment",
        cardLast4: m[2],
        date: parseDDMMMYYYYSpaced(m[3]),
        bank: "IDFC FIRST Bank",
        type: "payment_received",
        skip: false,
        dueDate: null,
        isForecast: false,
        confidence: 0.95,
        accountType: "credit_card" as const,
      };
    },
  },

  // ═══ IDFC First CC Due ═══
  // "IDFC FIRST Bank: Your Credit Card XX3456 bill of Rs.15000 is due on 25-May-26."
  {
    name: "IDFC First CC Due",
    bank: "IDFC First Bank",
    type: "amount_due_reminder",
    test: /IDFC\s+FIRST\s+Bank[\s\S]*?Credit\s+Card[\s\S]*?bill[\s\S]*?due/i,
    parse: (body) => {
      const m = body.match(
        /Credit\s+Card\s+XX(\d+)\s+bill\s+of\s+Rs\.\s*([\d,.]+)\s+is\s+due\s+on\s+(\d{1,2}-\w{3}-\d{2})/i,
      );
      if (!m) return null;
      return {
        amount: parseAmount(m[2]),
        merchant: "IDFC First Credit Card Due",
        cardLast4: m[1],
        date: null,
        bank: "IDFC First Bank",
        type: "amount_due_reminder",
        skip: false,
        dueDate: parseDateAny(m[3]),
        isForecast: true,
        confidence: 0.95,
        accountType: "credit_card" as const,
      };
    },
  },
];

// ─── Main Parse Function ───

/**
 * Parse a raw SMS body through all bank patterns.
 * Returns the parsed result from the first matching pattern,
 * or null if no pattern matches.
 */
export function parseBankSMS(body: string): ParsedSMS | null {
  // Check skip patterns first
  for (const skipRx of SKIP_PATTERNS) {
    if (skipRx.test(body)) {
      // Extract what we can for logging, but mark as skip
      return {
        amount: 0,
        merchant: null,
        cardLast4: null,
        date: null,
        bank: "Unknown",
        type: "debit",
        skip: true,
        dueDate: null,
        isForecast: false,
        confidence: 0,
      };
    }
  }

  // Try each bank pattern
  const MAX_MERCHANT_LENGTH = 200;
  for (const pattern of BANK_PATTERNS) {
    if (pattern.test.test(body)) {
      const result = pattern.parse(body);
      if (result && (result.amount > 0 || result.type === "balance_inquiry")) {
        // Truncate merchant names to prevent oversized strings from malformed SMS
        if (result.merchant && result.merchant.length > MAX_MERCHANT_LENGTH) {
          result.merchant = result.merchant.slice(0, MAX_MERCHANT_LENGTH).trim();
        }
        return result;
      }
    }
  }

  return null;
}
