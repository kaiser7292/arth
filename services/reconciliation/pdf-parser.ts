import { extractText } from "expo-pdf-text-extract";
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

// ─── Text extraction ───────────────────────────────────────────────────────────

export async function extractPdfText(
  fileUri: string,
  password?: string,
): Promise<string> {
  try {
    return await extractText(fileUri, password);
  } catch (err: any) {
    const code: string | undefined = err?.code;
    if (code === "PASSWORD_REQUIRED") {
      throw new PdfPasswordError("This PDF is password-protected.");
    }
    if (code === "INCORRECT_PASSWORD") {
      throw new PdfPasswordError("Wrong password — please try again.");
    }
    if (code === "FILE_NOT_FOUND") {
      throw new ParseError("Could not find the PDF file. Please try picking it again.");
    }
    if (code === "CORRUPT_PDF") {
      throw new ParseError(
        "This PDF appears to be corrupted or in an unsupported format.",
      );
    }
    throw new ParseError(
      "Could not open the PDF file. It may be corrupted or in an unsupported format.",
    );
  }
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, string> = {
  jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06",
  jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12",
};

function parsePdfDate(raw: string): string | null {
  const s = raw.trim();
  const dmy4 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy4) return `${dmy4[3]}-${dmy4[2].padStart(2,"0")}-${dmy4[1].padStart(2,"0")}`;
  // dd.mm.yyyy (ICICI savings PDF)
  const dDot = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dDot) return `${dDot[3]}-${dDot[2].padStart(2,"0")}-${dDot[1].padStart(2,"0")}`;
  const dmy2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (dmy2) return `${2000 + parseInt(dmy2[3])}-${dmy2[2].padStart(2,"0")}-${dmy2[1].padStart(2,"0")}`;
  const dMonY = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (dMonY) {
    const m = MONTH_MAP[dMonY[2].toLowerCase()];
    if (m) return `${dMonY[3]}-${m}-${dMonY[1].padStart(2,"0")}`;
  }
  const dMonDash = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (dMonDash) {
    const m = MONTH_MAP[dMonDash[2].toLowerCase()];
    const yr = dMonDash[3].length === 2 ? 2000 + parseInt(dMonDash[3]) : parseInt(dMonDash[3]);
    if (m) return `${yr}-${m}-${dMonDash[1].padStart(2,"0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function parsePdfAmount(s: string): number | null {
  const cleaned = s.replace(/[₹,\s]/g, "").replace(/\(([^)]+)\)/, "-$1");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : Math.abs(n);
}

function extractAmounts(text: string): number[] {
  const matches = text.match(/[\d,]+\.\d{2}/g) ?? [];
  return matches.map((m) => parsePdfAmount(m)).filter((n): n is number => n !== null);
}

function detectSuffix(text: string): string | null {
  const patterns = [
    /\*{4}(\d{4})/,
    /[Xx]{4}[\s\-]?(\d{4})/,
    /card\s+(?:no|number)[.\s:]+[\dX\s\-]+?(\d{4})\b/i,
    /account\s+(?:no|number)[.\s:]+[\dX\s\-]+?(\d{4})\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

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

function isCreditCard(text: string): boolean {
  const t = text.toLowerCase();
  return t.includes("credit card") || t.includes("card statement") || t.includes("card account");
}

function directionFromNarration(narration: string): "debit" | "credit" | null {
  const n = narration.toLowerCase();
  const creditKw = ["payment received", "refund", "reversal", "cashback", "credit interest", "salary", "neft credit", "imps credit", "rtgs credit", "by transfer", "by clearing"];
  const debitKw = ["purchase", "pos ", "atm ", "withdrawal", "neft debit", "imps debit", "rtgs debit", "to transfer", "emi ", "payment to"];
  if (creditKw.some((k) => n.includes(k))) return "credit";
  if (debitKw.some((k) => n.includes(k))) return "debit";
  return null;
}

// ─── Balance-delta direction helper ───────────────────────────────────────────

function balanceDeltaDirection(
  prevBalance: number | null,
  newBalance: number,
): "debit" | "credit" | null {
  if (prevBalance === null) return null;
  return newBalance > prevBalance ? "credit" : "debit";
}

// ─── HDFC Savings ─────────────────────────────────────────────────────────────

function parseHdfcSavings(lines: string[]): { rows: StatementRow[]; closing: number | null } {
  const rows: StatementRow[] = [];
  let prevBalance: number | null = null;
  let closing: number | null = null;
  const dateRe = /^(\d{2}\/\d{2}\/\d{2,4})\s+(.+)$/;

  for (const line of lines) {
    const dm = line.match(dateRe);
    if (!dm) continue;
    const date = parsePdfDate(dm[1]);
    if (!date) continue;
    const rest = dm[2];
    const amounts = extractAmounts(rest);
    if (amounts.length < 1) continue;
    const balance = amounts[amounts.length - 1];
    const txAmt = amounts.length >= 2 ? amounts[amounts.length - 2] : null;
    const narration = rest.replace(/[\d,]+\.\d{2}/g, "").trim().replace(/\s{2,}/g, " ");
    const direction = balanceDeltaDirection(prevBalance, balance) ?? directionFromNarration(narration) ?? "debit";
    if (txAmt !== null && txAmt > 0) rows.push({ date, amount: txAmt, direction, narration });
    prevBalance = balance;
    closing = balance;
  }
  return { rows, closing };
}

// ─── HDFC Credit Card ─────────────────────────────────────────────────────────

function parseHdfcCC(lines: string[]): { rows: StatementRow[]; closing: number | null } {
  const rows: StatementRow[] = [];
  let closing: number | null = null;
  const dateRe1 = /^(\d{2}\s+[A-Za-z]{3}\s+\d{4})\s+(.+)$/;
  const dateRe2 = /^(\d{2}\/\d{2}\/\d{4})\s+(.+)$/;

  for (const line of lines) {
    if (/closing\s+balance|total\s+amount\s+due/i.test(line)) {
      const amounts = extractAmounts(line);
      if (amounts.length) closing = amounts[amounts.length - 1];
      continue;
    }
    const dm = line.match(dateRe1) ?? line.match(dateRe2);
    if (!dm) continue;
    const date = parsePdfDate(dm[1]);
    if (!date) continue;
    const rest = dm[2];
    const amounts = extractAmounts(rest);
    if (!amounts.length) continue;
    const txAmt = amounts[0];
    const narration = rest.replace(/[\d,]+\.\d{2}/g, "").replace(/\bCr\b|\bDr\b/g, "").trim().replace(/\s{2,}/g, " ");
    const isCr = /\bCr\b/.test(rest);
    const isPayment = /payment|credit\s+received|refund|reversal|cashback/i.test(narration);
    const direction: "debit" | "credit" = isCr || isPayment ? "credit" : "debit";
    if (txAmt > 0) rows.push({ date, amount: txAmt, direction, narration });
  }
  return { rows, closing };
}

// ─── ICICI Savings ────────────────────────────────────────────────────────────

function parseIciciSavings(lines: string[]): { rows: StatementRow[]; closing: number | null } {
  const rows: StatementRow[] = [];
  let prevBalance: number | null = null;
  let closing: number | null = null;
  // Handles dd/mm/yyyy AND dd.mm.yyyy, with optional leading serial number
  const dateRe = /^(?:\d+\s+)?(\d{2}[\/\.]\d{2}[\/\.]\d{4})\s+(.+)$/;

  for (const line of lines) {
    const dm = line.match(dateRe);
    if (!dm) continue;
    const date = parsePdfDate(dm[1]);
    if (!date) continue;
    const rest = dm[2];
    const amounts = extractAmounts(rest);
    if (!amounts.length) continue;
    const balance = amounts[amounts.length - 1];
    const txAmt = amounts.length >= 2 ? amounts[amounts.length - 2] : null;
    const narration = rest.replace(/[\d,]+\.\d{2}/g, "").trim().replace(/\s{2,}/g, " ");
    const direction = balanceDeltaDirection(prevBalance, balance) ?? directionFromNarration(narration) ?? "debit";
    if (txAmt !== null && txAmt > 0) rows.push({ date, amount: txAmt, direction, narration });
    prevBalance = balance;
    closing = balance;
  }
  return { rows, closing };
}

// ─── ICICI Credit Card ────────────────────────────────────────────────────────

function parseIciciCC(lines: string[]): { rows: StatementRow[]; closing: number | null } {
  const rows: StatementRow[] = [];
  let closing: number | null = null;
  const dateRe = /^(\d{2}\/\d{2}\/\d{4}|\d{2}-\d{2}-\d{4})\s+(.+)$/;

  for (const line of lines) {
    if (/total\s+amount\s+due|minimum\s+amount\s+due|closing\s+balance/i.test(line)) {
      const amounts = extractAmounts(line);
      if (amounts.length) closing = amounts[amounts.length - 1];
      continue;
    }
    const dm = line.match(dateRe);
    if (!dm) continue;
    const date = parsePdfDate(dm[1]);
    if (!date) continue;
    const rest = dm[2];
    const amounts = extractAmounts(rest);
    if (!amounts.length) continue;
    const txAmt = amounts[0];
    const isCr = /\bCr\b/.test(rest);
    const narration = rest.replace(/[\d,]+\.\d{2}\s*(?:Cr)?/g, "").trim().replace(/\s{2,}/g, " ");
    const isPayment = /payment|refund|reversal|cashback/i.test(narration);
    const direction: "debit" | "credit" = isCr || isPayment ? "credit" : "debit";
    if (txAmt > 0) rows.push({ date, amount: txAmt, direction, narration });
  }
  return { rows, closing };
}

// ─── Axis Savings ─────────────────────────────────────────────────────────────

function parseAxisSavings(lines: string[]): { rows: StatementRow[]; closing: number | null } {
  const rows: StatementRow[] = [];
  let prevBalance: number | null = null;
  let closing: number | null = null;
  const dateRe = /^(\d{2}-\d{2}-\d{4})\s+(.+)$/;

  for (const line of lines) {
    const dm = line.match(dateRe);
    if (!dm) continue;
    const date = parsePdfDate(dm[1]);
    if (!date) continue;
    const rest = dm[2];
    const amounts = extractAmounts(rest);
    if (!amounts.length) continue;
    const balance = amounts[amounts.length - 1];
    const txAmt = amounts.length >= 2 ? amounts[amounts.length - 2] : null;
    const narration = rest.replace(/[\d,]+\.\d{2}/g, "").trim().replace(/\s{2,}/g, " ");
    const direction = balanceDeltaDirection(prevBalance, balance) ?? directionFromNarration(narration) ?? "debit";
    if (txAmt !== null && txAmt > 0) rows.push({ date, amount: txAmt, direction, narration });
    prevBalance = balance;
    closing = balance;
  }
  return { rows, closing };
}

// ─── Axis Credit Card ─────────────────────────────────────────────────────────

function parseAxisCC(lines: string[]): { rows: StatementRow[]; closing: number | null } {
  const rows: StatementRow[] = [];
  let closing: number | null = null;
  const dateRe = /^(\d{2}-\d{2}-\d{4}|\d{2}\/\d{2}\/\d{4})\s+(.+)$/;

  for (const line of lines) {
    if (/closing\s+balance|total\s+amount\s+due/i.test(line)) {
      const amounts = extractAmounts(line);
      if (amounts.length) closing = amounts[amounts.length - 1];
      continue;
    }
    const dm = line.match(dateRe);
    if (!dm) continue;
    const date = parsePdfDate(dm[1]);
    if (!date) continue;
    const rest = dm[2];
    const amounts = extractAmounts(rest);
    if (!amounts.length) continue;
    const txAmt = amounts[0];
    const isCr = /\bCr\b|\bcredit\b/i.test(rest);
    const narration = rest.replace(/[\d,]+\.\d{2}/g, "").replace(/\b(Dr|Cr)\b/gi, "").trim().replace(/\s{2,}/g, " ");
    const isPayment = /payment|refund|reversal|cashback/i.test(narration);
    const direction: "debit" | "credit" = isCr || isPayment ? "credit" : "debit";
    if (txAmt > 0) rows.push({ date, amount: txAmt, direction, narration });
  }
  return { rows, closing };
}

// ─── SBI Savings ──────────────────────────────────────────────────────────────

function parseSbiSavings(lines: string[]): { rows: StatementRow[]; closing: number | null } {
  const rows: StatementRow[] = [];
  let prevBalance: number | null = null;
  let closing: number | null = null;
  const dateRe = /^(\d{2}\/\d{2}\/\d{4})\s+(.+)$/;

  for (const line of lines) {
    const dm = line.match(dateRe);
    if (!dm) continue;
    const date = parsePdfDate(dm[1]);
    if (!date) continue;
    const rest = dm[2].replace(/^\d{2}\/\d{2}\/\d{4}\s+/, ""); // strip value date
    const amounts = extractAmounts(rest);
    if (!amounts.length) continue;
    const balance = amounts[amounts.length - 1];
    const txAmt = amounts.length >= 2 ? amounts[amounts.length - 2] : null;
    const narration = rest.replace(/[\d,]+\.\d{2}/g, "").replace(/\d{6,}/g, "").trim().replace(/\s{2,}/g, " ");
    const direction = balanceDeltaDirection(prevBalance, balance) ?? directionFromNarration(narration) ?? "debit";
    if (txAmt !== null && txAmt > 0) rows.push({ date, amount: txAmt, direction, narration });
    prevBalance = balance;
    closing = balance;
  }
  return { rows, closing };
}

// ─── IDFC FIRST Credit Card ───────────────────────────────────────────────────

function parseIdfcFirstCC(lines: string[]): { rows: StatementRow[]; closing: number | null } {
  const rows: StatementRow[] = [];
  let closing: number | null = null;
  const dateRe = /^(\d{2}[\/\-]\d{2}[\/\-]\d{4})\s+(.+)$/;

  for (const line of lines) {
    if (/convert\s+to\s+emi|emi\s+conversion|emi\s+breakup/i.test(line)) continue;
    if (/card\s+number\s*:/i.test(line)) continue;
    if (/closing\s+balance|total\s+amount\s+due|statement\s+balance/i.test(line)) {
      const amounts = extractAmounts(line);
      if (amounts.length) closing = amounts[amounts.length - 1];
      continue;
    }
    const dm = line.match(dateRe);
    if (!dm) continue;
    const date = parsePdfDate(dm[1]);
    if (!date) continue;
    const rest = dm[2];
    const amounts = extractAmounts(rest);
    if (!amounts.length) continue;
    const txAmt = amounts[0];
    const isCr = /\bCr\b/.test(rest);
    const narration = rest.replace(/[\d,]+\.\d{2}\s*(?:Cr)?/g, "").trim().replace(/\s{2,}/g, " ");
    const isPayment = /payment|refund|reversal|cashback/i.test(narration);
    const direction: "debit" | "credit" = isCr || isPayment ? "credit" : "debit";
    if (txAmt > 0) rows.push({ date, amount: txAmt, direction, narration });
  }
  return { rows, closing };
}

// ─── Generic fallback ─────────────────────────────────────────────────────────

function parseGeneric(lines: string[]): { rows: StatementRow[]; closing: number | null } {
  const rows: StatementRow[] = [];
  let prevBalance: number | null = null;
  let closing: number | null = null;
  const dateRe = /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{2}\s+[A-Za-z]{3}\s+\d{4}|\d{2}-[A-Za-z]{3}-\d{2,4})\s+(.+)$/;

  for (const line of lines) {
    const dm = line.match(dateRe);
    if (!dm) continue;
    const date = parsePdfDate(dm[1]);
    if (!date) continue;
    const rest = dm[2];
    const amounts = extractAmounts(rest);
    if (!amounts.length) continue;
    const balance = amounts.length >= 2 ? amounts[amounts.length - 1] : null;
    const txAmt = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0];
    const narration = rest.replace(/[\d,]+\.\d{2}/g, "").replace(/\b(Dr|Cr)\b/gi, "").trim().replace(/\s{2,}/g, " ");
    const isCr = /\bCr\b/.test(rest);
    let direction: "debit" | "credit" = "debit";
    if (isCr) {
      direction = "credit";
    } else if (balance !== null) {
      direction = balanceDeltaDirection(prevBalance, balance) ?? directionFromNarration(narration) ?? "debit";
    } else {
      direction = directionFromNarration(narration) ?? "debit";
    }
    if (txAmt > 0) rows.push({ date, amount: txAmt, direction, narration });
    if (balance !== null) { prevBalance = balance; closing = balance; }
  }
  return { rows, closing };
}

// ─── Date range ────────────────────────────────────────────────────────────────

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
  const fullText = await extractPdfText(fileUri, password);

  if (fullText.replace(/\s/g, "").length < 50) {
    throw new ParseError(
      "This PDF appears to be a scanned image with no extractable text. " +
      "Please export a digital statement from your bank's internet banking portal.",
    );
  }

  const bank = detectBank(fullText);
  const suffix = detectSuffix(fullText);
  const isCC = isCreditCard(fullText);

  const lines = fullText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && !l.startsWith("--- PAGE ---"));

  let result: { rows: StatementRow[]; closing: number | null };

  if (bank === "HDFC" && isCC) {
    result = parseHdfcCC(lines);
  } else if (bank === "HDFC") {
    result = parseHdfcSavings(lines);
  } else if (bank === "ICICI" && isCC) {
    result = parseIciciCC(lines);
  } else if (bank === "ICICI") {
    result = parseIciciSavings(lines);
  } else if (bank === "Axis" && isCC) {
    result = parseAxisCC(lines);
  } else if (bank === "Axis") {
    result = parseAxisSavings(lines);
  } else if (bank === "SBI") {
    result = parseSbiSavings(lines);
  } else if (bank === "IDFC FIRST") {
    result = parseIdfcFirstCC(lines);
  } else {
    result = parseGeneric(lines);
  }

  if (!result.rows.length) {
    throw new ParseError(
      "Could not find any transactions in this PDF. " +
      "Please check that it is a digital bank statement with a transaction table.",
    );
  }

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
