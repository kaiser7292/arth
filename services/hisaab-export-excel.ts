/**
 * Hisaab Excel Export Service — V6.0.1
 *
 * Generates bank-statement-style Excel workbooks:
 * - Per-person: 2 sheets (Statement with Dr/Cr/Balance, Summary)
 *
 * Uses SheetJS (xlsx) with lazy loading.
 */

import type * as XLSXType from "xlsx";

let _xlsx: typeof XLSXType | null = null;
function loadXLSX(): typeof XLSXType {
  if (!_xlsx) _xlsx = require("xlsx") as typeof XLSXType;
  return _xlsx;
}
import { File, Paths } from "expo-file-system";
import {
  getPerson,
  getEntries,
  getBalanceAsOfDate,
  getEntriesByDateRangeAsc,
  enrichEntriesFromExpenses,
} from "@/services/hisaab";
import type { HisaabEntry } from "@/services/hisaab";
import type { ExportDateRange } from "@/components/hisaab/ExportFormatPicker";
import { getCategoryById } from "@/services/category";

// ─── Helpers ───

// v15.9.0: exports honor user's currency + grouping preference.
import { formatNumber } from "@/utils/format";
import { formatDate as formatDateLocale } from "@/utils/date";
import { getCurrency } from "@/services/locale-preferences";
import { getCurrencyDef } from "@/constants/currencies";

function formatNum(n: number): string {
  return formatNumber(n);
}

function currencyPrefix(): string {
  const code = getCurrency();
  if (code === "NONE") return "";
  return getCurrencyDef(code).symbol;
}

function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

function balanceLabel(balance: number): string {
  if (balance > 0) return `${formatNum(balance)} Dr`;
  if (balance < 0) return `${formatNum(Math.abs(balance))} Cr`;
  return "Nil";
}

/** Resolve category IDs to names for a set of entries. */
async function buildCategoryMap(entries: HisaabEntry[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniqueIds = new Set(entries.map((e) => e.category_id).filter(Boolean) as string[]);
  for (const id of uniqueIds) {
    const cat = await getCategoryById(id);
    if (cat) map.set(id, cat.name);
  }
  return map;
}

// ─── Person Export ───

export interface PersonExportResult {
  filePath: string;
  fileName: string;
}

/**
 * Generate a bank-statement-style Excel workbook for one hisaab person.
 *
 * Sheet 1 — Statement: Opening balance, Date/Description/Dr/Cr/Balance rows, Totals, Closing balance
 * Sheet 2 — Summary: Totals by type, opening & closing balance
 */
export async function generatePersonExcel(
  personId: string,
  userId: string,
  dateRange?: ExportDateRange,
): Promise<PersonExportResult> {
  const XLSX = loadXLSX();
  const person = await getPerson(personId);
  if (!person) throw new Error("Person not found");

  let openingBalance: number;
  let entries: HisaabEntry[];
  let startDate: string;
  let endDate: string;
  let periodLabel: string;

  if (dateRange) {
    startDate = dateRange.startDate;
    endDate = dateRange.endDate;
    periodLabel = dateRange.label;

    const [ob, rangeEntries] = await Promise.all([
      getBalanceAsOfDate(personId, startDate),
      getEntriesByDateRangeAsc(personId, startDate, endDate),
    ]);
    openingBalance = ob;
    entries = rangeEntries;
  } else {
    startDate = "2000-01-01";
    endDate = "2099-12-31";
    periodLabel = "All Time";
    openingBalance = person.initial_balance;
    const allEntries = await getEntries(personId);
    entries = [...allEntries].reverse();
  }

  // Compute totals
  const totalDebits = entries
    .filter((e) => e.type === "debit")
    .reduce((s, e) => s + e.amount, 0);
  const totalCredits = entries
    .filter((e) => e.type !== "debit")
    .reduce((s, e) => s + e.amount, 0);
  const closingBalance = openingBalance + totalDebits - totalCredits;

  const accountMap = await enrichEntriesFromExpenses(entries);
  const categoryMap = await buildCategoryMap(entries);
  const wb = XLSX.utils.book_new();

  // Verdict: from the account holder's (recipient's) perspective
  let verdict: string;
  if (closingBalance > 0) {
    verdict = `Balance Due: ${currencyPrefix()}${formatNum(closingBalance)}`;
  } else if (closingBalance < 0) {
    verdict = `Credit Balance: ${currencyPrefix()}${formatNum(Math.abs(closingBalance))}`;
  } else {
    verdict = "All Settled — No Balance Due";
  }

  // ── Sheet 1: Statement ──
  const stmtRows: (string | number)[][] = [];

  // Header rows
  stmtRows.push(["HISAAB STATEMENT"]);
  stmtRows.push([`Account of: ${person.name}`]);
  stmtRows.push([`Period: ${periodLabel}`]);
  stmtRows.push([`Generated: ${todayString()}`]);
  stmtRows.push([verdict]);
  stmtRows.push([]); // blank row

  // Opening balance row
  stmtRows.push(["", "Opening Balance", "", "", "", "", "", "", balanceLabel(openingBalance)]);
  stmtRows.push([]); // blank row

  // Column headers
  stmtRows.push(["Date", "Description", "Category", "Merchant", "Account", "Type", "Debit (Dr)", "Credit (Cr)", "Balance"]);

  // Transaction rows with running balance
  let runningBalance = openingBalance;
  for (const e of entries) {
    const isDr = e.type === "debit";
    if (isDr) {
      runningBalance += e.amount;
    } else {
      runningBalance -= e.amount;
    }

    const desc = e.description || (e.type === "settlement" ? "Settlement" : "—");
    const typeLabel = e.type === "debit" ? "Debit" : e.type === "settlement" ? "Settlement" : "Credit";
    const statusSuffix = e.status !== "confirmed" ? ` [${e.status.toUpperCase()}]` : "";
    const categoryName = e.category_id ? (categoryMap.get(e.category_id) ?? "") : "";
    const accountName = accountMap.get(e.id) ?? "";

    stmtRows.push([
      // v15.9.0: honor user's date-format preference for exports.
      formatDateLocale(e.date),
      desc + statusSuffix,
      categoryName,
      e.merchant_name ?? "",
      accountName,
      typeLabel,
      isDr ? e.amount : "",
      !isDr ? e.amount : "",
      balanceLabel(runningBalance),
    ]);
  }

  // Blank row before totals
  stmtRows.push([]);

  // Totals row
  stmtRows.push(["", "TOTALS", "", "", "", "", totalDebits, totalCredits, ""]);

  // Closing balance row
  stmtRows.push(["", "CLOSING BALANCE", "", "", "", "", "", "", balanceLabel(closingBalance)]);

  // Blank row + legend + branding
  stmtRows.push([]);
  stmtRows.push(["Note: Dr (Debit) = they owe you more. Cr (Credit) = you paid them back. Balance Dr = net amount they owe you. Balance Cr = net amount you owe them."]);
  stmtRows.push([]);
  stmtRows.push(["अर्थ (Arth) — Your Finance, Your Way | Created by Sourav Baid"]);

  const stmtSheet = XLSX.utils.aoa_to_sheet(stmtRows);

  // Set column widths
  stmtSheet["!cols"] = [
    { wch: 12 },  // Date
    { wch: 28 },  // Description
    { wch: 16 },  // Category
    { wch: 16 },  // Merchant
    { wch: 20 },  // Account
    { wch: 12 },  // Type
    { wch: 15 },  // Dr
    { wch: 15 },  // Cr
    { wch: 18 },  // Balance
  ];

  XLSX.utils.book_append_sheet(wb, stmtSheet, "Statement");

  // ── Sheet 2: Summary ──
  const pendingCount = entries.filter((e) => e.status === "pending").length;
  const disputedCount = entries.filter((e) => e.status === "disputed").length;

  const summaryData = [
    { Item: "Account Name", Value: person.name },
    { Item: "Period", Value: periodLabel },
    { Item: "Verdict", Value: verdict },
    { Item: "", Value: "" },
    { Item: "Opening Balance", Value: balanceLabel(openingBalance) },
    { Item: "Total Debits (Spent on Your Behalf)", Value: formatNum(totalDebits) },
    { Item: "Total Credits (You Paid Back / Settled)", Value: formatNum(totalCredits) },
    { Item: "Closing Balance", Value: balanceLabel(closingBalance) },
    { Item: "", Value: "" },
    { Item: "Total Transactions", Value: entries.length },
    ...(pendingCount > 0 ? [{ Item: "Pending Transactions", Value: pendingCount }] : []),
    ...(disputedCount > 0 ? [{ Item: "Disputed Transactions", Value: disputedCount }] : []),
    { Item: "", Value: "" },
    { Item: "Phone", Value: person.phone || "—" },
    { Item: "Email", Value: person.email || "—" },
    { Item: "Notes", Value: person.notes || "—" },
    { Item: "Generated", Value: todayString() },
  ];

  const summarySheet = XLSX.utils.json_to_sheet(summaryData);
  summarySheet["!cols"] = [{ wch: 25 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

  // Write to file
  const wbOut = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  const safeName = person.name.replace(/[^a-zA-Z0-9]/g, "_");
  const safePeriod = periodLabel.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_");
  // v16.0.8 — second-level timestamp avoids FileAlreadyExistsException on
  // back-to-back exports. In-file "Generated" label still shows date-only
  // via todayString() above.
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `Hisaab_${safeName}_${safePeriod}_${timestamp}.xlsx`;
  const file = new File(Paths.cache, fileName);
  // Defensive: drop any pre-existing file with the same name first.
  try {
    if (file.exists) file.delete();
  } catch {
    // Non-fatal.
  }
  file.write(wbOut, { encoding: "base64" });

  return { filePath: file.uri, fileName };
}

