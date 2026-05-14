/**
 * Hisaab Import Service
 *
 * Imports hisaab (family ledger) entries from CSV/Excel files.
 * CSV format: Person, Date, Amount, Type, Description
 *
 * Types:
 *   debit           — you paid for them (increases balance)
 *   credit          — they paid you back (decreases balance)
 *   settlement      — formal settlement (decreases balance)
 *   initial_balance — sets the person's opening balance (no entry created)
 */

import { getDatabase } from "@/database";
import { parseDate } from "@/services/excel-import";
import { bumpDataVersion } from "@/services/settings";
import { generateUUID } from "@/utils/uuid";
import type * as XLSXType from "xlsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HisaabEntryType = "debit" | "credit" | "settlement" | "initial_balance";

export interface ParsedHisaabRow {
  person: string;
  date: string | null; // null for initial_balance
  amount: number;
  type: HisaabEntryType;
  description: string | null;
}

export interface HisaabImportResult {
  totalRows: number;
  entriesImported: number;
  skipped: number;
  errors: string[];
  personsCreated: string[];
  personsUpdated: string[];
}

export interface HisaabImportPreview {
  totalRows: number;
  entryCount: number;
  personCount: number;
  persons: {
    name: string;
    debits: number;
    credits: number;
    entries: number;
    initialBalance: number | null;
  }[];
  dateRange: { from: string; to: string } | null;
  totalDebits: number;
  totalCredits: number;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export const HISAAB_TEMPLATE_COLUMNS = [
  "Person",
  "Date",
  "Amount",
  "Type",
  "Description",
] as const;

/**
 * Generate a CSV template for hisaab imports with sample rows.
 */
export function generateHisaabTemplateCSV(): string {
  const header = HISAAB_TEMPLATE_COLUMNS.join(",");
  const samples = [
    'Tarun,,66761,initial_balance,"Previous Hisaab Total"',
    'Tarun,2023-10-16,70000,credit,"Mama Credit"',
    'Tarun,2023-10-16,250,debit,"Office Doc/Courier/Photo"',
    'Aastha,,5708.50,initial_balance,"Opening Balance"',
    'Rajat,,-1469.13,initial_balance,"Opening Balance"',
  ];
  return `${header}\n${samples.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

let _xlsx: typeof XLSXType | null = null;
function loadXLSX(): typeof XLSXType {
  if (!_xlsx) _xlsx = require("xlsx") as typeof XLSXType;
  return _xlsx;
}

/**
 * Parse hisaab rows from a workbook sheet.
 * Expects columns: Person, Date, Amount, Type, Description
 */
export function parseHisaabRows(
  workbook: XLSXType.WorkBook,
  sheetName: string,
): ParsedHisaabRow[] {
  const XLSX = loadXLSX();
  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });

  const rows: ParsedHisaabRow[] = [];
  const validTypes = ["debit", "credit", "settlement", "initial_balance"];
  const capped = json.slice(0, 5000);

  for (const row of capped) {
    const r = row as Record<string, unknown>;

    // Person (required)
    const rawPerson = r["Person"] ?? r["person"] ?? r["PERSON"];
    if (!rawPerson) continue;
    const person = String(rawPerson).trim().slice(0, 50);
    if (!person) continue;

    // Type (required)
    const rawType = r["Type"] ?? r["type"] ?? r["TYPE"];
    if (!rawType) continue;
    const typeStr = String(rawType).toLowerCase().trim();
    if (!validTypes.includes(typeStr)) continue;
    const type = typeStr as HisaabEntryType;

    // Amount (required)
    const rawAmount = r["Amount"] ?? r["amount"] ?? r["AMOUNT"];
    if (rawAmount === null || rawAmount === undefined || rawAmount === "") continue;
    const amount = parseHisaabAmount(rawAmount);
    if (amount === null) continue;

    // Date (required for entries, optional for initial_balance)
    const rawDate = r["Date"] ?? r["date"] ?? r["DATE"];
    const date = parseDate(rawDate);
    if (type !== "initial_balance" && !date) continue;

    // Description (optional)
    const rawDesc = r["Description"] ?? r["description"] ?? r["DESCRIPTION"];

    rows.push({
      person,
      date,
      amount,
      type,
      description: rawDesc ? String(rawDesc).trim().slice(0, 200) || null : null,
    });
  }

  return rows;
}

/**
 * Parse amount — allows negative values (for initial_balance).
 * Strips currency symbols and commas.
 */
function parseHisaabAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;

  const str = String(value)
    .replace(/[₹Rs.\s]/gi, (match) => (match === "." ? "." : ""))
    .replace(/,/g, "")
    .trim();

  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/**
 * Generate a preview summary of parsed hisaab rows.
 * Shows per-person breakdown, date range, and totals.
 */
export function getHisaabImportPreview(rows: ParsedHisaabRow[]): HisaabImportPreview {
  const persons = new Map<
    string,
    { debits: number; credits: number; entries: number; initialBalance: number | null }
  >();

  for (const row of rows) {
    if (!persons.has(row.person)) {
      persons.set(row.person, { debits: 0, credits: 0, entries: 0, initialBalance: null });
    }
    const p = persons.get(row.person)!;

    if (row.type === "initial_balance") {
      p.initialBalance = row.amount;
    } else {
      p.entries++;
      if (row.type === "debit") {
        p.debits += row.amount;
      } else {
        p.credits += row.amount;
      }
    }
  }

  const entryRows = rows.filter((r) => r.type !== "initial_balance");
  const dates = entryRows.map((r) => r.date!).filter(Boolean).sort();

  return {
    totalRows: rows.length,
    entryCount: entryRows.length,
    personCount: persons.size,
    persons: Array.from(persons.entries()).map(([name, data]) => ({
      name,
      ...data,
    })),
    dateRange:
      dates.length > 0
        ? { from: dates[0], to: dates[dates.length - 1] }
        : null,
    totalDebits: entryRows
      .filter((r) => r.type === "debit")
      .reduce((s, r) => s + r.amount, 0),
    totalCredits: entryRows
      .filter((r) => r.type !== "debit")
      .reduce((s, r) => s + r.amount, 0),
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Import parsed hisaab rows into the database.
 *
 * For each person:
 *  1. Find existing person by name (case-insensitive, then fuzzy).
 *  2. If not found, create a new person.
 *  3. If there's an initial_balance row, set it on the person record.
 *  4. Create all debit/credit/settlement entries.
 */
export async function importHisaabEntries(
  userId: string,
  rows: ParsedHisaabRow[],
): Promise<HisaabImportResult> {
  const db = getDatabase();
  const result: HisaabImportResult = {
    totalRows: rows.length,
    entriesImported: 0,
    skipped: 0,
    errors: [],
    personsCreated: [],
    personsUpdated: [],
  };

  // Build person lookup: lowercase name → id
  const existingPersons = await db.getAllAsync<{ id: string; name: string }>(
    `SELECT id, name FROM hisaab_persons WHERE owner_user_id = ? AND is_active = 1;`,
    userId,
  );
  const personMap = new Map<string, string>();
  for (const p of existingPersons) {
    personMap.set(p.name.toLowerCase(), p.id);
  }

  // Group rows by person name
  const personGroups = new Map<string, ParsedHisaabRow[]>();
  for (const row of rows) {
    if (!personGroups.has(row.person)) personGroups.set(row.person, []);
    personGroups.get(row.person)!.push(row);
  }

  // Process each person
  for (const [personName, personRows] of personGroups) {
    const lowerName = personName.toLowerCase();

    // Find existing person
    let personId = personMap.get(lowerName) ?? fuzzyFindPerson(lowerName, personMap);

    // Extract initial_balance and entry rows
    const initialBalanceRow = personRows.find((r) => r.type === "initial_balance");
    const entryRows = personRows.filter((r) => r.type !== "initial_balance");

    if (!personId) {
      // Create new person
      try {
        const id = generateUUID();
        await db.runAsync(
          `INSERT INTO hisaab_persons (id, owner_user_id, name, initial_balance) VALUES (?, ?, ?, ?);`,
          id,
          userId,
          personName,
          initialBalanceRow ? initialBalanceRow.amount : 0,
        );
        personMap.set(lowerName, id);
        personId = id;
        result.personsCreated.push(personName);
      } catch (e) {
        result.errors.push(
          `Failed to create person "${personName}": ${e instanceof Error ? e.message : String(e)}`,
        );
        result.skipped += entryRows.length;
        continue;
      }
    } else if (initialBalanceRow) {
      // Update existing person's initial_balance
      try {
        await db.runAsync(
          `UPDATE hisaab_persons SET initial_balance = ?, updated_at = datetime('now') WHERE id = ?;`,
          initialBalanceRow.amount,
          personId,
        );
        result.personsUpdated.push(personName);
      } catch (e) {
        result.errors.push(
          `Failed to update initial balance for "${personName}": ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // Import entries in batches
    const BATCH_SIZE = 100;
    for (let i = 0; i < entryRows.length; i += BATCH_SIZE) {
      const batch = entryRows.slice(i, i + BATCH_SIZE);

      await db.withTransactionAsync(async () => {
        for (const row of batch) {
          try {
            const id = generateUUID();
            const now = new Date().toISOString(); // Local time in ISO format
            await db.runAsync(
              `INSERT INTO hisaab_entries (id, hisaab_person_id, amount, description, date, type, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?);`,
              id,
              personId!,
              row.amount,
              row.description,
              row.date,
              row.type,
              now,
            );
            result.entriesImported++;
          } catch (e) {
            result.skipped++;
            result.errors.push(
              `${personName} row ${i + batch.indexOf(row) + 1}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      });
    }
  }

  if (result.entriesImported > 0 || result.personsCreated.length > 0) {
    await bumpDataVersion();
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fuzzy match a person name: substring containment.
 */
function fuzzyFindPerson(
  needle: string,
  personMap: Map<string, string>,
): string | null {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  const normalizedNeedle = normalize(needle);

  for (const [name, id] of personMap) {
    const normalizedName = normalize(name);
    if (
      normalizedName.includes(normalizedNeedle) ||
      normalizedNeedle.includes(normalizedName)
    ) {
      return id;
    }
  }

  return null;
}
