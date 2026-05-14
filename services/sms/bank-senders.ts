/**
 * Known Indian bank SMS sender IDs.
 * Android SMS sender addresses match these patterns (case-insensitive).
 *
 * Format: sender IDs typically look like "AD-ICICIB", "VM-HDFCBK", "JD-AXISBK"
 * with a 2-letter prefix followed by a dash and the bank code.
 * We match on the bank code portion.
 */

export interface BankSender {
  /** Short code found in SMS sender address (e.g. "ICICIB") */
  code: string;
  /** Human-readable bank name */
  bank: string;
  /** Type: bank account, credit card, UPI, wallet */
  type: "bank" | "cc" | "upi" | "wallet";
}

/**
 * Known bank sender codes for Indian banks.
 * These are matched case-insensitively against the SMS sender address.
 */
export const BANK_SENDERS: BankSender[] = [
  // ICICI
  { code: "ICICIB", bank: "ICICI Bank", type: "bank" },
  { code: "ICICIS", bank: "ICICI Bank", type: "bank" },
  { code: "iCICIB", bank: "ICICI Bank", type: "bank" },

  // HDFC
  { code: "HDFCBK", bank: "HDFC Bank", type: "bank" },
  { code: "HDFCBN", bank: "HDFC Bank", type: "bank" },

  // Axis
  { code: "AXISBK", bank: "Axis Bank", type: "bank" },
  { code: "ABORIG", bank: "Axis Bank", type: "bank" },

  // SBI
  { code: "SBIINB", bank: "SBI", type: "bank" },
  { code: "SBIPSG", bank: "SBI", type: "bank" },
  { code: "SBIBNK", bank: "SBI", type: "bank" },

  // Kotak
  { code: "KOTAKB", bank: "Kotak Mahindra Bank", type: "bank" },

  // Yes Bank
  { code: "YESBK", bank: "Yes Bank", type: "bank" },

  // IndusInd
  // v15 fix: INDBNK belonged here by mistake — real IndusInd DLT codes are
  // INDUSB / INDSIN / INDBKL. INDBNK is Indian Bank (PSU). See below.
  { code: "INDUSB", bank: "IndusInd Bank", type: "bank" },
  { code: "INDSIN", bank: "IndusInd Bank", type: "bank" },
  { code: "INDBKL", bank: "IndusInd Bank", type: "bank" },

  // PNB (Punjab National Bank)
  { code: "PNBSMS", bank: "PNB", type: "bank" },
  { code: "PNBBNK", bank: "PNB", type: "bank" },
  { code: "PUNBN", bank: "PNB", type: "bank" },

  // BOB (Bank of Baroda)
  { code: "BOBNEW", bank: "Bank of Baroda", type: "bank" },
  { code: "BOBSMS", bank: "Bank of Baroda", type: "bank" },
  { code: "BOBTXN", bank: "Bank of Baroda", type: "bank" },
  { code: "BOBIBN", bank: "Bank of Baroda", type: "bank" },
  { code: "BABORB", bank: "Bank of Baroda", type: "bank" },
  { code: "BOBCRD", bank: "Bank of Baroda", type: "cc" },

  // Canara Bank
  { code: "CANBNK", bank: "Canara Bank", type: "bank" },
  { code: "CANARA", bank: "Canara Bank", type: "bank" },
  { code: "CANABN", bank: "Canara Bank", type: "bank" },

  // Union Bank of India
  { code: "UNIONB", bank: "Union Bank of India", type: "bank" },
  { code: "UBOISL", bank: "Union Bank of India", type: "bank" },
  { code: "UBOI", bank: "Union Bank of India", type: "bank" },

  // Indian Bank (PSU) — INDBNK (not to be confused with IndusInd which uses INDUSB)
  { code: "INDBNK", bank: "Indian Bank", type: "bank" },
  { code: "INDBSM", bank: "Indian Bank", type: "bank" },

  // Central Bank of India
  { code: "CENTBK", bank: "Central Bank of India", type: "bank" },
  { code: "CBISMS", bank: "Central Bank of India", type: "bank" },
  { code: "CBIBNK", bank: "Central Bank of India", type: "bank" },

  // Indian Overseas Bank
  { code: "IOBCHN", bank: "Indian Overseas Bank", type: "bank" },
  { code: "IOBSMS", bank: "Indian Overseas Bank", type: "bank" },
  { code: "IOBBNK", bank: "Indian Overseas Bank", type: "bank" },

  // UCO Bank
  { code: "UCOBNK", bank: "UCO Bank", type: "bank" },
  { code: "UCOBANK", bank: "UCO Bank", type: "bank" },
  { code: "UCOBSM", bank: "UCO Bank", type: "bank" },

  // Bank of India
  { code: "BOIIND", bank: "Bank of India", type: "bank" },
  { code: "BOIBNK", bank: "Bank of India", type: "bank" },

  // Bank of Maharashtra
  { code: "BOMBNK", bank: "Bank of Maharashtra", type: "bank" },
  { code: "BOMSMS", bank: "Bank of Maharashtra", type: "bank" },
  { code: "MAHABK", bank: "Bank of Maharashtra", type: "bank" },

  // Punjab & Sind Bank
  { code: "PSBANK", bank: "Punjab & Sind Bank", type: "bank" },
  { code: "PSBBNK", bank: "Punjab & Sind Bank", type: "bank" },
  { code: "PSBSMS", bank: "Punjab & Sind Bank", type: "bank" },

  // IDFC First
  { code: "IDFCFB", bank: "IDFC FIRST Bank", type: "bank" },

  // Federal Bank
  { code: "FEDBNK", bank: "Federal Bank", type: "bank" },

  // Citi
  { code: "CITIBK", bank: "Citi Bank", type: "bank" },

  // Amex
  { code: "AMEXIN", bank: "American Express", type: "cc" },

  // RBL
  { code: "RBLBNK", bank: "RBL Bank", type: "bank" },

  // HSBC
  { code: "HSBCBK", bank: "HSBC", type: "bank" },

  // AU Small Finance Bank
  { code: "AUBANK", bank: "AU Small Finance Bank", type: "bank" },

  // UPI / Wallets
  { code: "PAYTMB", bank: "Paytm Payments Bank", type: "wallet" },
  { code: "PYTM", bank: "Paytm", type: "wallet" },
  { code: "JIOPAY", bank: "Jio Payments", type: "wallet" },
  { code: "GOOGLP", bank: "Google Pay", type: "upi" },
  { code: "GPAYIN", bank: "Google Pay", type: "upi" },
  { code: "PHNEPE", bank: "PhonePe", type: "upi" },
];

/**
 * Regex pattern that matches any known bank sender address.
 * Used to quickly filter SMS at the reader level.
 *
 * Also matches common bank SMS keywords in the body as a fallback
 * (some banks use numeric senders).
 */
export const BANK_SENDER_CODES = BANK_SENDERS.map((s) => s.code);

/**
 * Check if an SMS sender address belongs to a known bank.
 * Matches the sender code portion (case-insensitive).
 */
export function isBankSender(address: string): boolean {
  const upper = address.toUpperCase();
  return BANK_SENDER_CODES.some((code) => upper.includes(code.toUpperCase()));
}

/**
 * Identify which bank sent the SMS based on sender address.
 * Returns the BankSender info or null if unknown.
 */
export function identifyBank(address: string): BankSender | null {
  const upper = address.toUpperCase();
  return (
    BANK_SENDERS.find((s) => upper.includes(s.code.toUpperCase())) ?? null
  );
}

/**
 * Keywords in SMS body that indicate a financial transaction,
 * used as fallback when sender is a numeric number.
 */
export const TRANSACTION_KEYWORDS = [
  "debited",
  "credited",
  "spent",
  "withdrawn",
  "transferred",
  "payment",
  "received",
  "INR",
  "Rs.",
  "Rs ",
  "EMI",
  "UPI",
  "NEFT",
  "IMPS",
  "Avl Limit",
  "Avl Bal",
  "Avl Lmt",
  "A/c",
  "Credit Card",
  "refund",
  "reversed",
  "cashback",
  "NACH",
  "mandate",
  "auto-debit",
  "Credit Limit",
  "Min Due",
  "Total Due",
] as const;

/**
 * Check if an SMS body looks like a financial transaction
 * by scanning for transaction keywords.
 * Requires at least 2 keyword matches to reduce false positives.
 */
export function looksLikeTransaction(body: string): boolean {
  const upper = body.toUpperCase();
  let matches = 0;
  for (const kw of TRANSACTION_KEYWORDS) {
    if (upper.includes(kw.toUpperCase())) {
      matches++;
      if (matches >= 2) return true;
    }
  }
  return false;
}
