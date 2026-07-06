import * as XLSX from "xlsx";
import type { StmtDirection, ImportFormat } from "./reconciliation-crud";
import type { StatementRow } from "./statement-matcher";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedStatement {
  rows: StatementRow[];
  detectedBank: string | null;
  detectedAccountSuffix: string | null;   // last 4 digits from sheet headers
  startDate: string | null;
  endDate: string | null;
  closingBalance: number | null;
  format: ImportFormat;
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

// ─── Date normalisation ────────────────────────────────────────────────────────

function parseDate(raw: unknown): string | null {
  if (raw == null || raw === "") return null;

  // Excel serial number
  if (typeof raw === "number") {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) {
      const mm = String(d.m).padStart(2, "0");
      const dd = String(d.d).padStart(2, "0");
      return `${d.y}-${mm}-${dd}`;
    }
  }

  const s = String(raw).trim();

  // dd-mm-yyyy or dd/mm/yyyy
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;

  // dd-Mon-yy (01-Apr-26)
  const dmonYY = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (dmonYY) {
    const monthMap: Record<string, string> = {
      jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
      jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
    };
    const m = monthMap[dmonYY[2].toLowerCase()];
    const yr = parseInt(dmonYY[3], 10) + 2000;
    if (m) return `${yr}-${m}-${dmonYY[1].padStart(2, "0")}`;
  }

  // dd-Mon-yyyy
  const dmonYYYY = s.match(/^(\d{1,2})\s*([A-Za-z]{3})\s*(\d{4})$/);
  if (dmonYYYY) {
    const monthMap: Record<string, string> = {
      jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
      jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
    };
    const m = monthMap[dmonYYYY[2].toLowerCase()];
    if (m) return `${dmonYYYY[3]}-${m}-${dmonYYYY[1].padStart(2, "0")}`;
  }

  // yyyy-mm-dd (already ISO)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  return null;
}

function parseAmount(raw: unknown): number | null {
  if (raw == null || raw === "" || raw === "-") return null;
  const s = String(raw).replace(/,/g, "").replace(/₹/g, "").trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.abs(n);
}

// ─── Column finders ───────────────────────────────────────────────────────────

function findCol(headers: string[], candidates: string[]): number {
  for (const c of candidates) {
    const idx = headers.findIndex(
      (h) => h?.toLowerCase().trim() === c.toLowerCase(),
    );
    if (idx !== -1) return idx;
  }
  return -1;
}

function findColContains(headers: string[], substring: string): number {
  return headers.findIndex(
    (h) => h?.toLowerCase().includes(substring.toLowerCase()),
  );
}

// ─── Bank-specific parsers ────────────────────────────────────────────────────

function parseHDFC(rows: unknown[][], headers: string[]): StatementRow[] {
  const dateCol = findCol(headers, ["date"]);
  const narrationCol = findColContains(headers, "narration");
  const withdrawalCol = findColContains(headers, "withdrawal");
  const depositCol = findColContains(headers, "deposit");

  if (dateCol === -1) throw new ParseError("HDFC: Date column not found");

  const out: StatementRow[] = [];
  for (const row of rows) {
    const date = parseDate(row[dateCol]);
    if (!date) continue;

    const withdrawal = parseAmount(row[withdrawalCol]);
    const deposit = parseAmount(row[depositCol]);
    if (!withdrawal && !deposit) continue;

    const narration = String(row[narrationCol] ?? "").trim();
    if (withdrawal) out.push({ date, amount: withdrawal, direction: "debit", narration });
    if (deposit) out.push({ date, amount: deposit, direction: "credit", narration });
  }
  return out;
}

function parseICICI(rows: unknown[][], headers: string[]): StatementRow[] {
  const dateCol = findCol(headers, ["transaction date", "date", "value date"]);
  const narrationCol = findCol(headers, ["transaction remarks", "narration", "description", "particulars"]);
  const debitCol = findCol(headers, ["debit", "withdrawal", "dr"]);
  const creditCol = findCol(headers, ["credit", "deposit", "cr"]);
  // ICICI CC: single amount column with DR/CR suffix
  const amountCol = findCol(headers, ["amount"]);

  if (dateCol === -1) throw new ParseError("ICICI: Date column not found");

  const out: StatementRow[] = [];
  for (const row of rows) {
    const date = parseDate(row[dateCol]);
    if (!date) continue;
    const narration = String(row[narrationCol] ?? "").trim();

    if (amountCol !== -1 && debitCol === -1 && creditCol === -1) {
      // CC: "1234.00 DR" or "1234.00 CR"
      const raw = String(row[amountCol] ?? "").trim();
      const drMatch = raw.match(/^([\d,\.]+)\s*DR$/i);
      const crMatch = raw.match(/^([\d,\.]+)\s*CR$/i);
      if (drMatch) {
        const amount = parseAmount(drMatch[1]);
        if (amount) out.push({ date, amount, direction: "debit", narration });
      } else if (crMatch) {
        const amount = parseAmount(crMatch[1]);
        if (amount) out.push({ date, amount, direction: "credit", narration });
      }
    } else {
      const debit = parseAmount(row[debitCol]);
      const credit = parseAmount(row[creditCol]);
      if (debit) out.push({ date, amount: debit, direction: "debit", narration });
      if (credit) out.push({ date, amount: credit, direction: "credit", narration });
    }
  }
  return out;
}

function parseAxis(rows: unknown[][], headers: string[]): StatementRow[] {
  const dateCol = findCol(headers, ["tran date", "transaction date", "date", "value date"]);
  const narrationCol = findCol(headers, ["particulars", "narration", "description", "transaction remarks"]);
  const debitCol = findCol(headers, ["debit", "withdrawal"]);
  const creditCol = findCol(headers, ["credit", "deposit"]);

  if (dateCol === -1) throw new ParseError("Axis: Date column not found");

  const out: StatementRow[] = [];
  for (const row of rows) {
    const date = parseDate(row[dateCol]);
    if (!date) continue;
    const narration = String(row[narrationCol] ?? "").trim();
    const debit = parseAmount(row[debitCol]);
    const credit = parseAmount(row[creditCol]);
    if (debit) out.push({ date, amount: debit, direction: "debit", narration });
    if (credit) out.push({ date, amount: credit, direction: "credit", narration });
  }
  return out;
}

// Generic two-column debit/credit parser as fallback
function parseGeneric(rows: unknown[][], headers: string[]): StatementRow[] {
  const dateCol = findCol(headers, ["date", "transaction date", "tran date", "value date"]);
  const narrationCol = findCol(headers, ["narration", "description", "particulars", "transaction remarks"]);
  const debitCol = findCol(headers, ["debit", "dr", "withdrawal", "withdrawal amt."]);
  const creditCol = findCol(headers, ["credit", "cr", "deposit", "deposit amt."]);

  if (dateCol === -1) throw new ParseError("Could not find a Date column. Please ensure the file has a standard format.");

  const out: StatementRow[] = [];
  for (const row of rows) {
    const date = parseDate(row[dateCol]);
    if (!date) continue;
    const narration = String(row[narrationCol] ?? "").trim();
    const debit = parseAmount(row[debitCol]);
    const credit = parseAmount(row[creditCol]);
    if (debit) out.push({ date, amount: debit, direction: "debit", narration });
    if (credit) out.push({ date, amount: credit, direction: "credit", narration });
  }
  return out;
}

// ─── Bank detector ────────────────────────────────────────────────────────────

function detectBank(sheetText: string, headers: string[]): string | null {
  const text = sheetText.toLowerCase();
  if (text.includes("hdfc")) return "HDFC";
  if (text.includes("icici")) return "ICICI";
  if (text.includes("axis")) return "Axis";
  if (text.includes("sbi") || text.includes("state bank")) return "SBI";
  if (text.includes("kotak")) return "Kotak";
  return null;
}

function detectAccountSuffix(sheetText: string): string | null {
  const m = sheetText.match(/\*{3,4}(\d{4})/);
  return m ? m[1] : null;
}

function findHeaderRow(sheet: XLSX.WorkSheet): { headers: string[]; dataStart: number } | null {
  const ref = sheet["!ref"];
  if (!ref) return null;
  const range = XLSX.utils.decode_range(ref);

  const commonHeaders = ["date", "narration", "withdrawal", "deposit", "debit", "credit",
    "transaction", "particulars", "amount", "balance"];

  for (let r = range.s.r; r <= Math.min(range.s.r + 15, range.e.r); r++) {
    const rowVals: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      rowVals.push(cell ? String(cell.v ?? "").toLowerCase().trim() : "");
    }
    const matchCount = rowVals.filter((v) =>
      commonHeaders.some((h) => v.includes(h)),
    ).length;
    if (matchCount >= 2) {
      return { headers: rowVals, dataStart: r + 1 };
    }
  }
  return null;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function parseXlsFile(
  fileData: ArrayBuffer,
  filename: string,
): ParsedStatement {
  const format: ImportFormat = filename.toLowerCase().endsWith(".xlsx") ? "xlsx" : "xls";

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(fileData, { type: "array", cellDates: false });
  } catch {
    throw new ParseError("Could not open the file. It may be corrupted or in an unsupported format.");
  }

  // Use the first sheet that looks like it has transaction data
  let sheet: XLSX.WorkSheet | null = null;
  let sheetName = "";
  for (const name of workbook.SheetNames) {
    const s = workbook.Sheets[name];
    const ref = s["!ref"];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      if (range.e.r - range.s.r > 3) {
        sheet = s;
        sheetName = name;
        break;
      }
    }
  }
  if (!sheet) throw new ParseError("No data found in the file.");

  // Full sheet as plain text for bank detection
  const sheetText = Object.values(sheet)
    .filter((cell): cell is XLSX.CellObject => typeof cell === "object" && "v" in cell)
    .map((cell) => String(cell.v ?? ""))
    .join(" ");

  const headerInfo = findHeaderRow(sheet);
  if (!headerInfo) throw new ParseError("Could not identify the transaction table header row. Please check the file.");

  const { headers, dataStart } = headerInfo;
  const range = XLSX.utils.decode_range(sheet["!ref"]!);

  // Extract all data rows after the header
  const dataRows: unknown[][] = [];
  for (let r = dataStart; r <= range.e.r; r++) {
    const row: unknown[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      row.push(cell ? cell.v : null);
    }
    dataRows.push(row);
  }

  const bank = detectBank(sheetText, headers);
  const accountSuffix = detectAccountSuffix(sheetText);

  let rows: StatementRow[];
  try {
    if (bank === "HDFC") rows = parseHDFC(dataRows, headers);
    else if (bank === "ICICI") rows = parseICICI(dataRows, headers);
    else if (bank === "Axis") rows = parseAxis(dataRows, headers);
    else rows = parseGeneric(dataRows, headers);
  } catch (e) {
    if (e instanceof ParseError) throw e;
    rows = parseGeneric(dataRows, headers);
  }

  if (rows.length === 0) throw new ParseError("No transactions found in the file. Please check the format.");

  const dates = rows.map((r) => r.date).sort();
  const startDate = dates[0] ?? null;
  const endDate = dates[dates.length - 1] ?? null;

  // Try to find closing balance from a "Balance" column
  const balCol = findCol(headers, ["closing balance", "balance", "bal"]);
  let closingBalance: number | null = null;
  if (balCol !== -1 && dataRows.length > 0) {
    // Last non-null balance value
    for (let i = dataRows.length - 1; i >= 0; i--) {
      const v = parseAmount(dataRows[i][balCol]);
      if (v !== null) { closingBalance = v; break; }
    }
  }

  return { rows, detectedBank: bank, detectedAccountSuffix: accountSuffix, startDate, endDate, closingBalance, format };
}
