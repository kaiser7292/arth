import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import { toIsoDate as formatDate } from "@/utils/date";
import { generateUUID } from "@/utils/uuid";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import type * as XLSXType from "xlsx";
import { createCategory, getAllCategories } from "./category";
import type { PaymentModeType } from "./payment-mode";
import { createPaymentMode, getAllPaymentModes } from "./payment-mode";

let _xlsx: typeof XLSXType | null = null;
function loadXLSX(): typeof XLSXType {
  if (!_xlsx) _xlsx = require("xlsx") as typeof XLSXType;
  return _xlsx;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single sheet detected in the workbook. */
export interface DetectedSheet {
  name: string;
  rowCount: number;
  columns: string[];
  sampleRows: Record<string, string | number | null>[];
  sheetType: SheetType;
}

export type SheetType =
  | "daily_expenses"
  | "forecast"
  | "actuals"
  | "non_personal"
  | "summary"
  | "unknown";

/** Column mapping from Excel column → app field. */
export interface ColumnMapping {
  excelColumn: string;
  appField: string;
}

/** Fields that an expense row can map to. */
export const EXPENSE_FIELDS = [
  { key: "date", label: "Date", required: true },
  { key: "amount", label: "Amount", required: true },
  { key: "description", label: "Description", required: false },
  { key: "merchant", label: "Merchant", required: false },
  { key: "category", label: "Category", required: false },
  { key: "payment_mode", label: "Payment Mode", required: false },
  { key: "is_right_spend", label: "Right Spend", required: false },
  { key: "skip", label: "- Skip -", required: false },
] as const;

export type ExpenseField = (typeof EXPENSE_FIELDS)[number]["key"];

/** Result of parsing an expense sheet. */
export interface ParsedExpenseRow {
  date: string; // YYYY-MM-DD
  amount: number;
  description: string | null;
  merchantName: string | null;
  categoryName: string | null;
  paymentModeName: string | null;
  isRightSpend: number | null; // 0 or 1
}

/** Import result summary. */
export interface ImportResult {
  totalRows: number;
  imported: number;
  skipped: number;
  errors: string[];
  categoriesCreated: string[];
  paymentModesCreated: string[];
}

// ---------------------------------------------------------------------------
// File picking
// ---------------------------------------------------------------------------

/** Max field lengths for imported data — matches manual entry limits. */
const MAX_LEN = { description: 200, merchant: 100, category: 50, paymentMode: 50 } as const;

/** Truncate a string to a max length, or return null if empty. */
function truncate(val: unknown, maxLen: number): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s ? s.slice(0, maxLen) : null;
}

/** Max file size for Excel/CSV imports: 10 MB. */
const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024;

/** Allowed extensions for Excel/CSV imports. */
const ALLOWED_IMPORT_EXTENSIONS = [".xlsx", ".xls", ".csv"];

/** Max rows to import from a single sheet. */
export const MAX_IMPORT_ROWS = 5000;

/**
 * Opens the document picker and returns file URI + name, or null if cancelled.
 * Validates file extension and size (max 10 MB).
 */
export async function pickExcelFile(): Promise<{
  uri: string;
  name: string;
} | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
      "text/comma-separated-values",
      "application/csv",
    ],
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.length) {
    return null;
  }

  const asset = result.assets[0];

  // Validate extension
  const ext = asset.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  if (!ALLOWED_IMPORT_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported file type "${ext}". Use .xlsx, .xls, or .csv files.`);
  }

  // Validate file size
  if (asset.size && asset.size > MAX_IMPORT_FILE_SIZE) {
    const sizeMB = (asset.size / (1024 * 1024)).toFixed(1);
    throw new Error(`File is too large (${sizeMB} MB). Maximum allowed size is 10 MB.`);
  }

  return { uri: asset.uri, name: asset.name };
}

// ---------------------------------------------------------------------------
// Workbook parsing
// ---------------------------------------------------------------------------

/**
 * Read an Excel or CSV file from URI and return the XLSX workbook.
 * CSV files are parsed as a single-sheet workbook.
 */
export async function readWorkbook(uri: string): Promise<XLSXType.WorkBook> {
  const XLSX = loadXLSX();
  const file = new File(uri);
  const base64 = await file.base64();
  // XLSX.read handles both .xlsx and .csv formats automatically
  return XLSX.read(base64, { type: "base64", cellDates: true });
}

// ---------------------------------------------------------------------------
// Template columns (fixed schema — no mapping needed)
// ---------------------------------------------------------------------------

/** The fixed column names used in the import template. */
export const TEMPLATE_COLUMNS = [
  "Date",
  "Amount",
  "Description",
  "Merchant",
  "Category",
  "Payment Mode",
  "Right Spend",
] as const;

/**
 * Generate a CSV template string with the fixed column headers.
 * Includes 2 sample rows to guide the user.
 */
export function generateTemplateCSV(): string {
  const header = TEMPLATE_COLUMNS.join(",");
  const sample1 = "2025-05-15,450,Swiggy order,Swiggy,Food & Dining,UPI,Yes";
  const sample2 = "2025-05-16,1200,Uber ride,Uber,Transport,Credit Card,No";
  return `${header}\n${sample1}\n${sample2}\n`;
}

/**
 * Parse expense rows from a workbook using the fixed template column names.
 * No user mapping needed — columns must match the template exactly.
 */
export function parseTemplateRows(
  workbook: XLSXType.WorkBook,
  sheetName: string,
): ParsedExpenseRow[] {
  const XLSX = loadXLSX();
  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });

  const rows: ParsedExpenseRow[] = [];
  const capped = json.slice(0, MAX_IMPORT_ROWS);

  for (const row of capped) {
    const r = row as Record<string, unknown>;

    // Try exact column names from template
    const rawDate = r["Date"] ?? r["date"] ?? r["DATE"];
    const rawAmount = r["Amount"] ?? r["amount"] ?? r["AMOUNT"];
    const rawDesc = r["Description"] ?? r["description"] ?? r["DESCRIPTION"];
    const rawMerchant = r["Merchant"] ?? r["merchant"] ?? r["MERCHANT"];
    const rawCat = r["Category"] ?? r["category"] ?? r["CATEGORY"];
    const rawPM = r["Payment Mode"] ?? r["payment mode"] ?? r["Payment_Mode"] ?? r["PAYMENT MODE"];
    const rawRS = r["Right Spend"] ?? r["right spend"] ?? r["Right_Spend"] ?? r["RIGHT SPEND"];

    const date = parseDate(rawDate);
    const amount = parseAmount(rawAmount);

    if (!date || !amount) continue;

    rows.push({
      date,
      amount,
      description: truncate(rawDesc, MAX_LEN.description),
      merchantName: truncate(rawMerchant, MAX_LEN.merchant),
      categoryName: truncate(rawCat, MAX_LEN.category),
      paymentModeName: truncate(rawPM, MAX_LEN.paymentMode),
      isRightSpend: parseRightSpend(rawRS),
    });
  }

  return rows;
}

/**
 * Detect sheets in a workbook and classify them by type.
 */
export function detectSheets(workbook: XLSXType.WorkBook): DetectedSheet[] {
  const XLSX = loadXLSX();
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
    });

    const columns =
      json.length > 0 ? Object.keys(json[0] as Record<string, unknown>) : [];

    // Take first 3 rows as sample
    const sampleRows = json.slice(0, 3).map((row) => {
      const mapped: Record<string, string | number | null> = {};
      for (const col of columns) {
        const val = (row as Record<string, unknown>)[col];
        mapped[col] =
          val === null || val === undefined
            ? null
            : val instanceof Date
              ? formatDateForDisplay(val)
              : String(val);
      }
      return mapped;
    });

    return {
      name,
      rowCount: json.length,
      columns,
      sampleRows,
      sheetType: classifySheet(name, columns),
    };
  });
}

/**
 * Classify a sheet based on its name and column headers.
 */
function classifySheet(name: string, columns: string[]): SheetType {
  const lower = name.toLowerCase();
  const colsLower = columns.map((c) => c.toLowerCase());

  // Daily Expenses: has Date, Amount columns
  if (
    (lower.includes("daily") || lower.includes("expense")) &&
    colsLower.some((c) => c.includes("date")) &&
    colsLower.some((c) => c.includes("amount"))
  ) {
    return "daily_expenses";
  }

  // Forecast sheets
  if (lower.includes("forecast")) {
    return "forecast";
  }

  // Actuals sheets
  if (lower.includes("actual")) {
    return "actuals";
  }

  // Non Personal Expenses
  if (lower.includes("non personal") || lower.includes("hisaab")) {
    return "non_personal";
  }

  // Summary sheet
  if (lower.includes("summary")) {
    return "summary";
  }

  // Fallback: try to detect by columns
  if (
    colsLower.some((c) => c.includes("date")) &&
    colsLower.some((c) => c.includes("amount"))
  ) {
    return "daily_expenses";
  }

  return "unknown";
}

// ---------------------------------------------------------------------------
// Auto-mapping columns
// ---------------------------------------------------------------------------

/**
 * Suggest column mappings based on column name heuristics.
 */
export function suggestColumnMappings(
  columns: string[],
): Record<string, ExpenseField> {
  const mappings: Record<string, ExpenseField> = {};

  for (const col of columns) {
    const lower = col.toLowerCase().trim();

    if (lower === "date" || lower.includes("date") || lower === "dt") {
      if (!Object.values(mappings).includes("date")) {
        mappings[col] = "date";
      }
    } else if (
      lower === "amount" ||
      lower === "amt" ||
      lower.includes("amount")
    ) {
      if (!Object.values(mappings).includes("amount")) {
        mappings[col] = "amount";
      }
    } else if (
      lower === "description" ||
      lower === "desc" ||
      lower.includes("description") ||
      lower === "particulars" ||
      lower === "narration"
    ) {
      if (!Object.values(mappings).includes("description")) {
        mappings[col] = "description";
      }
    } else if (
      lower === "merchant" ||
      lower.includes("merchant") ||
      lower === "vendor" ||
      lower === "payee" ||
      lower === "shop"
    ) {
      if (!Object.values(mappings).includes("merchant")) {
        mappings[col] = "merchant";
      }
    } else if (
      lower === "category" ||
      lower === "cat" ||
      lower.includes("category")
    ) {
      if (!Object.values(mappings).includes("category")) {
        mappings[col] = "category";
      }
    } else if (
      lower === "payment mode" ||
      lower === "payment" ||
      lower === "mode" ||
      lower.includes("payment") ||
      lower === "paid via" ||
      lower === "paid by"
    ) {
      if (!Object.values(mappings).includes("payment_mode")) {
        mappings[col] = "payment_mode";
      }
    } else if (
      lower === "right spend" ||
      lower.includes("right") ||
      lower === "rs" ||
      lower === "right_spend"
    ) {
      if (!Object.values(mappings).includes("is_right_spend")) {
        mappings[col] = "is_right_spend";
      }
    } else {
      mappings[col] = "skip";
    }
  }

  return mappings;
}

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

/**
 * Parse various date formats into YYYY-MM-DD.
 * Handles: DD-MM-YYYY, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, Date objects, Excel serial dates.
 */
export function parseDate(value: unknown): string | null {
  if (!value) return null;

  // Already a Date object (xlsx cellDates: true)
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return formatDate(value);
  }

  // Excel serial date number
  if (typeof value === "number") {
    const date = excelSerialToDate(value);
    return date ? formatDate(date) : null;
  }

  const str = String(value).trim();
  if (!str) return null;

  // Try YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Try DD-MM-YYYY or DD/MM/YYYY (Indian format — day first)
  const dmyMatch = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    const day = parseInt(d, 10);
    const month = parseInt(m, 10);
    // If day > 12, it's definitely DD-MM-YYYY
    // If month > 12, it's MM-DD-YYYY
    // Default to DD-MM-YYYY (Indian format)
    if (month > 12 && day <= 12) {
      // Actually MM/DD/YYYY
      return `${y}-${d.padStart(2, "0")}-${m.padStart(2, "0")}`;
    }
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Try parsing as a general date string
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return formatDate(parsed);
  }

  return null;
}

function excelSerialToDate(serial: number): Date | null {
  if (serial < 1) return null;
  // Excel epoch: Jan 1, 1900 (with the Lotus 1-2-3 bug)
  const utcDays = serial - 25569; // days from Unix epoch
  const date = new Date(utcDays * 86400 * 1000);
  return isNaN(date.getTime()) ? null : date;
}

function formatDateForDisplay(date: Date): string {
  return formatDate(date);
}

// ---------------------------------------------------------------------------
// Amount parsing
// ---------------------------------------------------------------------------

/**
 * Parse an amount value — handles strings with commas, Rs prefix, etc.
 */
export function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value > 0 ? value : null;

  const str = String(value)
    .replace(/[₹Rs.,\s]/gi, (match) => (match === "." ? "." : ""))
    .replace(/,/g, "")
    .trim();

  const num = parseFloat(str);
  return isNaN(num) || num <= 0 ? null : num;
}

// ---------------------------------------------------------------------------
// Right Spend parsing
// ---------------------------------------------------------------------------

function parseRightSpend(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const str = String(value).toLowerCase().trim();
  if (str === "yes" || str === "y" || str === "1" || str === "true") return 1;
  if (str === "no" || str === "n" || str === "0" || str === "false") return 0;
  return null;
}

// ---------------------------------------------------------------------------
// Expense import
// ---------------------------------------------------------------------------

/**
 * Parse expense rows from a sheet using the provided column mappings.
 */
export function parseExpenseRows(
  workbook: XLSXType.WorkBook,
  sheetName: string,
  mappings: Record<string, ExpenseField>,
): ParsedExpenseRow[] {
  const XLSX = loadXLSX();
  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });

  const rows: ParsedExpenseRow[] = [];
  const capped = json.slice(0, MAX_IMPORT_ROWS);

  // Build reverse mapping: field → column
  const fieldToCol: Partial<Record<ExpenseField, string>> = {};
  for (const [col, field] of Object.entries(mappings)) {
    if (field !== "skip") {
      fieldToCol[field] = col;
    }
  }

  for (const row of capped) {
    const rawDate = fieldToCol.date
      ? (row as Record<string, unknown>)[fieldToCol.date]
      : null;
    const rawAmount = fieldToCol.amount
      ? (row as Record<string, unknown>)[fieldToCol.amount]
      : null;

    const date = parseDate(rawDate);
    const amount = parseAmount(rawAmount);

    // Skip rows without valid date or amount
    if (!date || !amount) continue;

    const description = fieldToCol.description
      ? truncate((row as Record<string, unknown>)[fieldToCol.description], MAX_LEN.description)
      : null;

    const merchantName = fieldToCol.merchant
      ? truncate((row as Record<string, unknown>)[fieldToCol.merchant], MAX_LEN.merchant)
      : null;

    const categoryName = fieldToCol.category
      ? truncate((row as Record<string, unknown>)[fieldToCol.category], MAX_LEN.category)
      : null;

    const paymentModeName = fieldToCol.payment_mode
      ? truncate((row as Record<string, unknown>)[fieldToCol.payment_mode], MAX_LEN.paymentMode)
      : null;

    const rawRS = fieldToCol.is_right_spend
      ? (row as Record<string, unknown>)[fieldToCol.is_right_spend]
      : null;
    const isRightSpend = parseRightSpend(rawRS);

    rows.push({
      date,
      amount,
      description,
      merchantName,
      categoryName,
      paymentModeName,
      isRightSpend,
    });
  }

  return rows;
}

/**
 * Import parsed expense rows into the database.
 * Auto-creates categories and payment modes that don't exist.
 */
export async function importExpenses(
  userId: string,
  rows: ParsedExpenseRow[],
): Promise<ImportResult> {
  const db = getDatabase();
  const result: ImportResult = {
    totalRows: rows.length,
    imported: 0,
    skipped: 0,
    errors: [],
    categoriesCreated: [],
    paymentModesCreated: [],
  };

  // Build lookup maps for categories and payment modes
  const categories = await getAllCategories(userId);
  const categoryMap = new Map<string, string>(); // name (lowercase) → id
  for (const cat of categories) {
    categoryMap.set(cat.name.toLowerCase(), cat.id);
  }

  const paymentModes = await getAllPaymentModes(userId);
  const pmMap = new Map<string, string>(); // name (lowercase) → id
  for (const pm of paymentModes) {
    pmMap.set(pm.name.toLowerCase(), pm.id);
  }

  // Process in batches of 100 within a single transaction
  const BATCH_SIZE = 100;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    await db.withTransactionAsync(async () => {
      for (const row of batch) {
        try {
          // Resolve category (exact match → fuzzy match → auto-create)
          let categoryId: string | null = null;
          if (row.categoryName) {
            const key = row.categoryName.toLowerCase();
            if (categoryMap.has(key)) {
              categoryId = categoryMap.get(key)!;
            } else {
              // Try fuzzy match
              const fuzzyMatch = fuzzyFindCategory(key, categoryMap);
              if (fuzzyMatch) {
                categoryId = fuzzyMatch;
                // Cache for future rows
                categoryMap.set(key, categoryId);
              } else {
                // Auto-create category
                categoryId = await createCategory({
                  user_id: userId,
                  name: row.categoryName,
                });
                categoryMap.set(key, categoryId);
                result.categoriesCreated.push(row.categoryName);
              }
            }
          }

          // Resolve payment mode
          let paymentModeId: string | null = null;
          if (row.paymentModeName) {
            const key = row.paymentModeName.toLowerCase();
            if (pmMap.has(key)) {
              paymentModeId = pmMap.get(key)!;
            } else {
              // Auto-create payment mode with best-guess type
              const type = guessPaymentModeType(row.paymentModeName);
              paymentModeId = await createPaymentMode({
                user_id: userId,
                name: row.paymentModeName,
                type,
              });
              pmMap.set(key, paymentModeId);
              result.paymentModesCreated.push(row.paymentModeName);
            }
          }

          // Insert expense
          const id = generateUUID();
          const now = new Date().toISOString(); // Local time in ISO format
          await db.runAsync(
            `INSERT INTO expenses (id, user_id, amount, currency, description, merchant_name, category_id, payment_mode_id, date, is_right_spend, source, status, created_at)
             VALUES (?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, 'manual', 'approved', ?);`,
            id,
            userId,
            row.amount,
            row.description,
            row.merchantName,
            categoryId,
            paymentModeId,
            row.date,
            row.isRightSpend,
            now,
          );

          result.imported++;
        } catch (e) {
          result.skipped++;
          result.errors.push(
            `Row ${i + batch.indexOf(row) + 1}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    });
  }

  if (result.imported > 0) await bumpDataVersion();
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fuzzy match a category name against existing categories.
 * Matches: substring containment, trailing "s" variance, "&" vs "and".
 */
function fuzzyFindCategory(
  needle: string,
  categoryMap: Map<string, string>,
): string | null {
  // Normalize: remove extra spaces, & → and
  const normalize = (s: string) =>
    s
      .replace(/&/g, "and")
      .replace(/\s+/g, " ")
      .trim();

  const normalizedNeedle = normalize(needle);

  for (const [existingName, id] of categoryMap) {
    const normalizedExisting = normalize(existingName);

    // Check: one contains the other
    if (
      normalizedExisting.includes(normalizedNeedle) ||
      normalizedNeedle.includes(normalizedExisting)
    ) {
      return id;
    }

    // Check: trailing "s" difference (e.g., "Subscription" vs "Subscriptions")
    if (
      normalizedNeedle + "s" === normalizedExisting ||
      normalizedNeedle === normalizedExisting + "s"
    ) {
      return id;
    }
  }

  return null;
}

/**
 * Guess payment mode type from the name.
 */
function guessPaymentModeType(name: string): PaymentModeType {
  const lower = name.toLowerCase();
  if (lower.includes("cc") || lower.includes("credit")) return "credit_card";
  if (lower.includes("debit")) return "debit_card";
  if (
    lower.includes("upi") ||
    lower.includes("gpay") ||
    lower.includes("phonepe") ||
    lower.includes("paytm")
  )
    return "upi";
  if (lower.includes("cash")) return "cash";
  if (
    lower.includes("wallet") ||
    lower.includes("amazon") ||
    lower.includes("pay")
  )
    return "wallet";
  return "bank_transfer";
}

/**
 * Get a quick preview: how many rows, date range, total amount.
 */
export function getImportPreview(rows: ParsedExpenseRow[]): {
  count: number;
  dateRange: { from: string; to: string } | null;
  totalAmount: number;
  uniqueCategories: string[];
  uniquePaymentModes: string[];
} {
  if (rows.length === 0) {
    return {
      count: 0,
      dateRange: null,
      totalAmount: 0,
      uniqueCategories: [],
      uniquePaymentModes: [],
    };
  }

  const dates = rows.map((r) => r.date).sort();
  const totalAmount = rows.reduce((sum, r) => sum + r.amount, 0);
  const categories = [
    ...new Set(rows.map((r) => r.categoryName).filter(Boolean)),
  ] as string[];
  const paymentModes = [
    ...new Set(rows.map((r) => r.paymentModeName).filter(Boolean)),
  ] as string[];

  return {
    count: rows.length,
    dateRange: { from: dates[0], to: dates[dates.length - 1] },
    totalAmount,
    uniqueCategories: categories,
    uniquePaymentModes: paymentModes,
  };
}
