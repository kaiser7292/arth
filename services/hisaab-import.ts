/**
 * Hisaab Import Service
 *
 * Imports hisaab (family ledger) entries from CSV/Excel files.
 * CSV format: Person, Date, Amount, Type, Description, Category, Merchant
 * (Category and Merchant are optional; five-column files from before still import.)
 *
 * Types:
 *   debit           — you paid for them (increases balance)
 *   credit          — they paid you back (decreases balance)
 *   settlement      — formal settlement (decreases balance)
 *   initial_balance — sets the person's opening balance (no entry created)
 */

import { getDatabase } from "@/database";
import { createCategory, getAllCategories } from "@/services/category";
import { fuzzyFindCategory, parseDate } from "@/services/excel-import";
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
  category: string | null;
  merchant: string | null;
}

export interface HisaabImportResult {
  totalRows: number;
  entriesImported: number;
  skipped: number;
  /** Entries left out because the person's ledger already has them. */
  duplicates: number;
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
  "Category",
  "Merchant",
] as const;

/**
 * Generate a CSV template for hisaab imports with sample rows.
 */
export function generateHisaabTemplateCSV(): string {
  const header = HISAAB_TEMPLATE_COLUMNS.join(",");
  const samples = [
    'Jane Doe,,5000,initial_balance,"Opening Balance",,',
    'Jane Doe,2025-04-10,2000,credit,"Paid back",,',
    'Jane Doe,2025-04-12,850,debit,"Dinner share",Food,Barbeque Nation',
    'Jane Doe,2025-04-20,3000,settlement,"Settled by UPI",,',
    'John Doe,,-1500,initial_balance,"Opening Balance",,',
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
 * Expects columns: Person, Date, Amount, Type, Description, Category, Merchant
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
    // Headers are matched loosely: "Person", "person" and "PERSON " are one column.
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      const key = k.toLowerCase().replace(/[^a-z0-9]/g, "");
      // Two columns with the same name: the one with a value wins.
      if (r[key] === undefined || r[key] === null || r[key] === "") r[key] = v;
    }

    // Person (required)
    const rawPerson = r.person;
    if (!rawPerson) continue;
    const person = String(rawPerson).trim().slice(0, 50);
    if (!person) continue;

    // Type (required)
    const rawType = r.type;
    if (!rawType) continue;
    // "Initial Balance" / "initial-balance" as well as initial_balance.
    const typeStr = String(rawType).toLowerCase().trim().replace(/[\s-]+/g, "_");
    if (!validTypes.includes(typeStr)) continue;
    const type = typeStr as HisaabEntryType;

    // Amount (required)
    const rawAmount = r.amount;
    if (rawAmount === null || rawAmount === undefined || rawAmount === "") continue;
    const amount = parseHisaabAmount(rawAmount);
    if (amount === null) continue;

    // Date (required for entries, optional for initial_balance)
    const rawDate = r.date;
    const date = parseDate(rawDate);
    if (type !== "initial_balance" && !date) continue;

    // Description (optional)
    const rawDesc = r.description;
    const optional = (v: unknown, max: number) => (v ? String(v).trim().slice(0, max) || null : null);

    rows.push({
      person,
      date,
      amount,
      type,
      description: optional(rawDesc, 200),
      category: optional(r.category, 50),
      merchant: optional(r.merchant, 100),
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
    duplicates: 0,
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

  // Categories: an existing one by name (or a near match), else a new one.
  const categoryMap = new Map((await getAllCategories(userId)).map((c) => [c.name.toLowerCase(), c.id]));
  const categoryFor = async (name: string | null): Promise<string | null> => {
    if (!name) return null;
    const key = name.toLowerCase();
    const known = categoryMap.get(key) ?? fuzzyFindCategory(key, categoryMap);
    if (known) {
      categoryMap.set(key, known);
      return known;
    }
    const id = await createCategory({ user_id: userId, name });
    categoryMap.set(key, id);
    return id;
  };

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

    // What this person's ledger already holds, counted: importing the same file twice adds
    // nothing, but two genuine same-day entries of the same amount both come in.
    const entryKey = (date: string | null, amount: number, type: string) => `${date}|${amount.toFixed(2)}|${type}`;
    const existing = new Map<string, number>();
    const existingRows = await db.getAllAsync<{ date: string; amount: number; type: string }>(
      `SELECT date, amount, type FROM hisaab_entries WHERE hisaab_person_id = ?;`,
      personId!,
    );
    for (const e of existingRows) {
      const k = entryKey(e.date, e.amount, e.type);
      existing.set(k, (existing.get(k) ?? 0) + 1);
    }

    // Import entries in batches
    const BATCH_SIZE = 100;
    for (let i = 0; i < entryRows.length; i += BATCH_SIZE) {
      const batch = entryRows.slice(i, i + BATCH_SIZE);

      await db.withTransactionAsync(async () => {
        for (const row of batch) {
          try {
            const key = entryKey(row.date, row.amount, row.type);
            const have = existing.get(key) ?? 0;
            if (have > 0) {
              existing.set(key, have - 1);
              result.duplicates++;
              continue;
            }
            const id = generateUUID();
            const now = new Date().toISOString(); // Local time in ISO format
            await db.runAsync(
              `INSERT INTO hisaab_entries (id, hisaab_person_id, amount, description, date, type, category_id, merchant_name, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
              id,
              personId!,
              row.amount,
              row.description,
              row.date,
              row.type,
              await categoryFor(row.category),
              row.merchant,
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
