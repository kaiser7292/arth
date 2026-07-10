import { extractText, extractRows } from "expo-pdf-text-extract";
import type { ImportFormat } from "./reconciliation-crud";
import type { StatementRow } from "./statement-matcher";
import { type ParsedStatement, ParseError } from "./xls-parser";

// ─── Password error ────────────────────────────────────────────────────────────

export class PdfPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfPasswordError";
  }
}

// ─── Text / row extraction ────────────────────────────────────────────────────

export async function extractPdfText(
  fileUri: string,
  password?: string,
): Promise<string> {
  try {
    return await extractText(fileUri, password);
  } catch (err: any) {
    throw mapNativeError(err, password);
  }
}

async function extractPdfRows(
  fileUri: string,
  password?: string,
): Promise<string[][]> {
  try {
    return await extractRows(fileUri, password);
  } catch (err: any) {
    throw mapNativeError(err, password);
  }
}

function mapNativeError(err: any, password?: string): Error {
  const code: string | undefined = err?.code;
  if (code === "PASSWORD_REQUIRED") return new PdfPasswordError("This PDF is password-protected.");
  if (code === "INCORRECT_PASSWORD") return new PdfPasswordError("Wrong password — please try again.");
  if (code === "FILE_NOT_FOUND") return new ParseError("Could not find the PDF file. Please try picking it again.");
  if (code === "CORRUPT_PDF") return new ParseError("This PDF appears to be corrupted or in an unsupported format.");
  return new ParseError("Could not open the PDF file. It may be corrupted or in an unsupported format.");
}

// ─── Date parsing ─────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, string> = {
  jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06",
  jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12",
};

function parsePdfDate(raw: string): string | null {
  const s = raw.trim();
  // dd/mm/yyyy or dd-mm-yyyy
  const dmy4 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy4) return `${dmy4[3]}-${dmy4[2].padStart(2,"0")}-${dmy4[1].padStart(2,"0")}`;
  // dd.mm.yyyy (ICICI savings)
  const dDot = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dDot) return `${dDot[3]}-${dDot[2].padStart(2,"0")}-${dDot[1].padStart(2,"0")}`;
  // dd/mm/yy or dd-mm-yy
  const dmy2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (dmy2) return `${2000 + parseInt(dmy2[3])}-${dmy2[2].padStart(2,"0")}-${dmy2[1].padStart(2,"0")}`;
  // dd Mon yyyy  e.g. "02 Apr 2026"
  const dMonY = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (dMonY) {
    const m = MONTH_MAP[dMonY[2].toLowerCase()];
    if (m) return `${dMonY[3]}-${m}-${dMonY[1].padStart(2,"0")}`;
  }
  // dd Mon yy  e.g. "02 May 26"
  const dMonYY = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2})$/);
  if (dMonYY) {
    const m = MONTH_MAP[dMonYY[2].toLowerCase()];
    if (m) return `${2000 + parseInt(dMonYY[3])}-${m}-${dMonYY[1].padStart(2,"0")}`;
  }
  // dd-Mon-yy or dd-Mon-yyyy  e.g. "25-Apr-2026"
  const dMonDash = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (dMonDash) {
    const m = MONTH_MAP[dMonDash[2].toLowerCase()];
    const yr = dMonDash[3].length === 2 ? 2000 + parseInt(dMonDash[3]) : parseInt(dMonDash[3]);
    if (m) return `${yr}-${m}-${dMonDash[1].padStart(2,"0")}`;
  }
  // ISO already
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

// ─── Amount parsing ───────────────────────────────────────────────────────────

function parsePdfAmount(s: string): number | null {
  // Extract the first decimal number from the string (handles "C 937.05", "9,144.68 CR", etc.)
  const match = s.replace(/[₹\s]/g, "").match(/([\d,]+\.\d{2})/);
  if (!match) return null;
  const n = parseFloat(match[1].replace(/,/g, ""));
  return isNaN(n) || n < 0 ? null : n;
}

// ─── Direction helpers ────────────────────────────────────────────────────────

function balanceDelta(prev: number | null, next: number): "debit" | "credit" | null {
  if (prev === null) return null;
  return next > prev ? "credit" : "debit";
}

function directionFromText(text: string): "debit" | "credit" | null {
  const n = text.toLowerCase();
  const creditKw = [
    "payment received", "refund", "reversal", "cashback", "credit interest",
    "salary", "neft credit", "imps credit", "rtgs credit", "by transfer", "by clearing",
    "bbps payment received",
    // ACH/NACH credits (GAIL, NALCO dividends, pension, salary via NACH)
    "ach/", "nach credit", "achcr",
    // Inward NEFT/IMPS/UPI
    "neft transfer from", "transfer from", "upi/cr/", "upi/p2p/", "upi/p2a/",
    "incoming", "credited by", "interest paid",
  ];
  const debitKw = [
    "purchase", "pos ", "atm ", "withdrawal", "neft debit", "imps debit",
    "rtgs debit", "to transfer", "emi ", "payment to",
    // CC payment from savings is a debit
    "creditcard payment", "credit card payment",
    // Loan, NACH debit
    "nach debit", "loan a/c payment", "mb/part loan",
    // UPI outward
    "upi/dr/", "upi/p2m/",
  ];
  if (creditKw.some((k) => n.includes(k))) return "credit";
  if (debitKw.some((k) => n.includes(k))) return "debit";
  return null;
}

// ─── Universal structured-row parser ─────────────────────────────────────────
//
// Works on the coordinate-extracted rows from extractRows().
// Each row is an array of column strings, split by 15pt X-gaps in the PDF.
//
// Algorithm per row:
//  1. Find the leftmost column that parses as a date (up to col 4)
//  2. Scan from right for decimal amounts (ignoring DR/CR/+ markers)
//     – 1 decimal amount  → that's the transaction amount (CC, no balance)
//     – 2 decimal amounts → first = tx amount, second = running balance
//     – 3+ decimals       → treat last as balance, find non-zero of the two before it
//  3. Direction: CR/DR markers → +/- sign column → balance delta → narration keywords
//  4. Narration: columns between date and first amount, excluding time, markers, serials

function parseStructuredRows(
  allRows: string[][]
): { rows: StatementRow[]; closing: number | null } {
  const results: StatementRow[] = [];
  let prevBalance: number | null = null;
  let closing: number | null = null;

  const isTime = (s: string) => /^\d{2}:\d{2}$/.test(s.trim());
  const isSign = (s: string) => /^[+\-]$/.test(s.trim());
  const isDirMark = (s: string) => /^(DR|CR)$/i.test(s.trim());
  const isTinyGlyph = (s: string) => s.trim().length <= 1;
  const isLongSerial = (s: string) => /^\d{7,}$/.test(s.trim()); // 7+ digit serial/ref numbers

  for (const cols of allRows) {
    const rowFlat = cols.join(" ");

    // ── Opening/closing balance marker rows (no transaction to extract) ──
    // B/F (Balance Forward) — ICICI Savings: date | "B/F" | opening_balance
    // Opening Balance — Axis Bank: "Opening Balance" | amount
    // Your Opening Balance — SBI: "Your Opening Balance on DD-MM-YY: amount"
    if (/\bB[\/\.]F\b/i.test(rowFlat) || /(?:your\s+)?opening\s+balance/i.test(rowFlat)) {
      for (const c of cols) {
        const n = parsePdfAmount(c);
        if (n !== null) { prevBalance = n; break; }
      }
      continue;
    }
    // Closing balance rows — skip but capture balance (last real txn already captured it)
    if (/(?:your\s+)?closing\s+balance/i.test(rowFlat)) {
      for (let i = cols.length - 1; i >= 0; i--) {
        const n = parsePdfAmount(cols[i]);
        if (n !== null && n >= 0) { closing = n; break; }
      }
      continue;
    }

    // ── 1. Date ──
    let dateIdx = -1;
    let parsedDate: string | null = null;
    for (let i = 0; i < Math.min(cols.length, 4); i++) {
      // HDFC CC puts "02/04/2026|" with a pipe — strip everything from | onward
      const raw = cols[i].split("|")[0].trim();
      const d = parsePdfDate(raw);
      if (d) { dateIdx = i; parsedDate = d; break; }
    }
    if (dateIdx === -1 || !parsedDate) continue;

    // ── 2. Amounts ──
    const decimalAmts: Array<{ idx: number; val: number }> = [];
    for (let i = dateIdx + 1; i < cols.length; i++) {
      const c = cols[i].trim();
      if (isDirMark(c) || isSign(c) || isTinyGlyph(c)) continue;
      const n = parsePdfAmount(c);
      if (n !== null && n > 0) decimalAmts.push({ idx: i, val: n });
    }
    if (!decimalAmts.length) continue;

    let txAmount: number;
    let balance: number | null = null;

    if (decimalAmts.length === 1) {
      txAmount = decimalAmts[0].val;
    } else if (decimalAmts.length === 2) {
      txAmount = decimalAmts[0].val;
      balance = decimalAmts[1].val;
    } else {
      // 3+: savings style — last = balance, find non-zero of the prior two
      balance = decimalAmts[decimalAmts.length - 1].val;
      const d = decimalAmts[decimalAmts.length - 3].val;
      const c2 = decimalAmts[decimalAmts.length - 2].val;
      txAmount = d > 0 ? d : c2;
    }

    // ── 3. Direction ──
    const rowText = cols.join(" ");
    const hasCR = /\bCR\b/i.test(rowText);
    // Exclude "0.00 Dr" / "1,234.56 Dr" balance suffixes — only match DR when
    // NOT immediately preceded by a decimal amount (e.g. "0.00 Dr" is a balance
    // annotation, not a direction marker).
    const hasDR = /(?<![\d,]\s*)\bDR\b/i.test(rowText);
    const hasPlus = cols.some((c) => isSign(c) && c.trim() === "+");
    const kwDirection = directionFromText(rowText);

    let direction: "debit" | "credit";
    if (hasCR && !hasDR) {
      direction = "credit";
    } else if (hasDR) {
      // Keyword match (e.g. "cashback", "refund") overrides the DR marker —
      // handles narrations like "CASHBACK CREDIT ... 0.00 Dr" where "Dr" is a
      // balance suffix rather than a true debit indicator.
      direction = kwDirection === "credit" ? "credit" : "debit";
    } else if (hasPlus) {
      direction = "credit";
    } else if (balance !== null) {
      direction = balanceDelta(prevBalance, balance) ?? kwDirection ?? "debit";
    } else {
      direction = kwDirection ?? "debit";
    }

    // ── 4. Narration ──
    const amtSet = new Set(decimalAmts.map((a) => a.idx));
    const narration = cols
      .slice(dateIdx + 1)
      .filter((c, ri) => {
        const absIdx = dateIdx + 1 + ri;
        if (amtSet.has(absIdx)) return false;
        const v = c.trim();
        if (isTime(v)) return false;
        if (isSign(v)) return false;
        if (isDirMark(v)) return false;
        if (isTinyGlyph(v)) return false;
        if (isLongSerial(v)) return false;
        return true;
      })
      .join(" ")
      .trim()
      .replace(/\s{2,}/g, " ");

    if (txAmount > 0) {
      results.push({ date: parsedDate, amount: txAmount, direction, narration });
    }
    if (balance !== null) { prevBalance = balance; closing = balance; }
  }

  return { rows: results, closing };
}

// ─── Fallback: raw-text regex parser (used if extractRows fails) ───────────────
//
// Kept as a safety net for PDFs where coordinate extraction is unreliable
// (scanned-to-text, oddly ordered glyphs, etc.).

function parseRawTextFallback(
  rawText: string
): { rows: StatementRow[]; closing: number | null } {
  const rows: StatementRow[] = [];
  let prevBalance: number | null = null;
  let closing: number | null = null;

  // Strip (cid:N) PDF encoding artifacts (Axis Bank statements)
  rawText = rawText.replace(/\(cid:\d+\)/g, " ").replace(/\s{2,}/g, " ");

  const lines = rawText.split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && !l.startsWith("--- PAGE ---"));

  // Generic: finds lines starting with a date in any common format
  const dateRe = /^(?:\d+\s+)?(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4})\|?(?:\s+\d{2}:\d{2})?\s+(.+)$/;

  for (const line of lines) {
    // Opening/closing balance header lines — seed prevBalance, don't emit a row
    if (/(?:your\s+)?opening\s+balance|\bB\/F\b/i.test(line)) {
      const nums = (line.match(/([\d,]+\.\d{2})/g) ?? []).map((s) => parseFloat(s.replace(/,/g, ""))).filter((n) => !isNaN(n));
      if (nums.length) prevBalance = nums[0];
      continue;
    }
    if (/(?:your\s+)?closing\s+balance/i.test(line)) {
      const nums = (line.match(/([\d,]+\.\d{2})/g) ?? []).map((s) => parseFloat(s.replace(/,/g, ""))).filter((n) => !isNaN(n));
      if (nums.length) closing = nums[nums.length - 1];
      continue;
    }

    const dm = line.match(dateRe);
    if (!dm) continue;
    const date = parsePdfDate(dm[1]);
    if (!date) continue;
    const rest = dm[2];
    const amounts = (rest.match(/([\d,]+\.\d{2})/g) ?? [])
      .map((m) => parseFloat(m.replace(/,/g, "")))
      .filter((n) => !isNaN(n) && n > 0);
    if (!amounts.length) continue;

    const balance = amounts.length >= 2 ? amounts[amounts.length - 1] : null;
    const txAmt = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0];
    const narration = rest.replace(/([\d,]+\.\d{2})/g, "").replace(/\b(DR|CR)\b/gi, "").trim().replace(/\s{2,}/g, " ");

    const hasCR = /\bCR\b/i.test(rest);
    const hasDR = /(?<![\d,]\s*)\bDR\b/i.test(rest);
    const hasPlus = /\+\s*(?:[^\d]|$)/.test(rest);
    const kwDir = directionFromText(narration);

    let direction: "debit" | "credit";
    if (hasCR && !hasDR) direction = "credit";
    else if (hasDR) direction = kwDir === "credit" ? "credit" : "debit";
    else if (hasPlus) direction = "credit";
    else if (balance !== null) direction = balanceDelta(prevBalance, balance) ?? kwDir ?? "debit";
    else direction = kwDir ?? "debit";

    if (txAmt > 0) rows.push({ date, amount: txAmt, direction, narration });
    if (balance !== null) { prevBalance = balance; closing = balance; }
  }

  return { rows, closing };
}

// ─── Bank / account detection ─────────────────────────────────────────────────

function detectBank(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("hdfc bank")) return "HDFC";
  if (t.includes("icici bank")) return "ICICI";
  if (t.includes("axis bank")) return "Axis";
  if (t.includes("state bank of india") || (t.includes(" sbi ") && t.includes("account statement"))) return "SBI";
  if (t.includes("idfc first bank") || t.includes("idfcfirst")) return "IDFC FIRST";
  if (t.includes("kotak mahindra")) return "Kotak";
  if (t.includes("yes bank")) return "Yes Bank";
  if (t.includes("indusind bank")) return "IndusInd";
  if (t.includes("federal bank")) return "Federal";
  if (t.includes("punjab national bank")) return "PNB";
  if (t.includes("bank of baroda")) return "BOB";
  return null;
}

function detectSuffix(text: string): string | null {
  // Standard fully-masked: XXXXXXXX7322, XXXXXXX0006 (4+ X's then 4–6 digits)
  let m = text.match(/[Xx]{4,}(\d{4,6})\b/);
  if (m) return m[1].slice(-4);
  // Axis-style mixed: 92201XXXXX22836 (digits, then 3+ X's, then digits)
  m = text.match(/\b\d{3,}[Xx]{3,}(\d{4,6})\b/);
  if (m) return m[1].slice(-4);
  // Star-masked: ****7322
  m = text.match(/\*{4}(\d{4})/);
  if (m) return m[1];
  // "card no. ...7322" / "account no. ...7322"
  m = text.match(/(?:card|account)\s+(?:no|number)[.\s:]+[\dX\s\-*]+?(\d{4})\b/i);
  if (m) return m[1];
  return null;
}

function dateRangeFromRows(rows: StatementRow[]): { startDate: string | null; endDate: string | null } {
  if (!rows.length) return { startDate: null, endDate: null };
  const dates = rows.map((r) => r.date).sort();
  return { startDate: dates[0], endDate: dates[dates.length - 1] };
}

// ─── Main entry point ──────────────────────────────────────────────────────────

export async function parsePdfStatement(
  fileUri: string,
  filename: string,
  password?: string,
): Promise<ParsedStatement> {

  // Primary path: coordinate-based structured extraction
  let result: { rows: StatementRow[]; closing: number | null } | null = null;
  let fullText = "";

  try {
    const rows = await extractPdfRows(fileUri, password);

    // Flatten to text for bank/suffix detection
    fullText = rows.map((r) => r.join(" ")).join("\n");

    if (fullText.replace(/\s/g, "").length < 50) {
      throw new ParseError(
        "This PDF appears to be a scanned image with no extractable text. " +
        "Please export a digital statement from your bank's internet banking portal.",
      );
    }

    result = parseStructuredRows(rows);
  } catch (e) {
    // Re-throw password and parse errors immediately — no fallback possible
    if (e instanceof PdfPasswordError || e instanceof ParseError) throw e;
    // Unexpected native failure — fall through to raw-text fallback
  }

  // Fallback: raw text + generic regex (handles weird PDF coordinate layouts)
  if (!result || result.rows.length === 0) {
    try {
      fullText = fullText || await extractPdfText(fileUri, password);

      if (fullText.replace(/\s/g, "").length < 50) {
        throw new ParseError(
          "This PDF appears to be a scanned image with no extractable text. " +
          "Please export a digital statement from your bank's internet banking portal.",
        );
      }

      result = parseRawTextFallback(fullText);
    } catch (e) {
      if (e instanceof PdfPasswordError || e instanceof ParseError) throw e;
      throw new ParseError("Could not open the PDF file. It may be corrupted or in an unsupported format.");
    }
  }

  if (!result.rows.length) {
    throw new ParseError(
      "Could not find any transactions in this PDF. " +
      "Please check that it is a digital bank statement with a transaction table.",
    );
  }

  const bank = detectBank(fullText);
  const suffix = detectSuffix(fullText);
  const { startDate, endDate } = dateRangeFromRows(result.rows);

  return {
    rows: result.rows,
    detectedBank: bank,
    detectedAccountSuffix: suffix,
    startDate,
    endDate,
    closingBalance: result.closing,
    format: "pdf" as ImportFormat,
  };
}
