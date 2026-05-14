/**
 * Manual loan schedule import via CSV (v17.6.0, Change 4).
 *
 * Lets the user override Artha's computed amortization schedule with one
 * they paste from their bank statement. Useful when Artha's formula can't
 * match the bank's exact numbers (rate resets, unusual interest-day
 * conventions, flat / simple interest for gold / FD loans).
 *
 * Expected CSV columns (header row required, exact names — case insensitive):
 *   installment_num, due_date, opening_principal, emi_amount,
 *   principal_component, interest_component, closing_principal
 *
 * `due_date` must be `YYYY-MM-DD`.
 *
 * On apply:
 *   - Wipes every existing row in `loan_schedule_entries` for the loan.
 *   - Wipes every prepayment (user warned in preview — prepayments are
 *     relative to the engine-generated schedule and would double-apply
 *     against the user's CSV).
 *   - Wipes every manual correction (the CSV IS the override now).
 *   - Sets `loan_accounts.schedule_source = 'manual_csv'` so
 *     `rebuildLoanSchedule` becomes a no-op.
 *   - Bulk-inserts the CSV rows as scheduled installments.
 *
 * To revert to engine-generated schedule: set schedule_source back to
 * 'generated' and edit the loan (triggers updateLoan's regen path).
 */

import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import { generateUUID } from "@/utils/uuid";

export interface ParsedScheduleRow {
  installment_num: number;
  due_date: string; // YYYY-MM-DD
  opening_principal: number;
  emi_amount: number;
  principal_component: number;
  interest_component: number;
  closing_principal: number;
}

export interface ParseResult {
  rows: ParsedScheduleRow[];
  errors: string[];
}

const REQUIRED_COLUMNS = [
  "installment_num",
  "due_date",
  "opening_principal",
  "emi_amount",
  "principal_component",
  "interest_component",
  "closing_principal",
] as const;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse raw CSV text into normalised schedule rows.
 *
 * Tolerant to:
 *   - BOM at file start
 *   - Windows (\r\n) and Unix (\n) line endings
 *   - commas inside quoted values
 *   - Blank trailing lines
 *   - Case-insensitive headers (`Installment_Num` == `installment_num`)
 *   - `₹`, `Rs.`, `,` in numeric values (all stripped before parsing)
 *
 * Not tolerant to:
 *   - Missing required columns
 *   - Non-integer installment_num
 *   - Negative amounts
 *   - Non-ISO date format (user's bank statement dates need to be normalised
 *     to YYYY-MM-DD BEFORE import — we don't guess the locale).
 */
export function parseScheduleCsv(raw: string): ParseResult {
  const errors: string[] = [];
  const rows: ParsedScheduleRow[] = [];

  const stripped = raw.replace(/^﻿/, "").trim();
  if (!stripped) {
    return { rows, errors: ["The file is empty."] };
  }

  const lines = stripped
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    return { rows, errors: ["The file needs a header row and at least one data row."] };
  }

  const headerCells = splitCsvLine(lines[0]).map((h) =>
    h.toLowerCase().trim().replace(/\s+/g, "_"),
  );
  const colIndex: Record<string, number> = {};
  for (const col of REQUIRED_COLUMNS) {
    const idx = headerCells.indexOf(col);
    if (idx < 0) {
      errors.push(`Missing required column: ${col}`);
    } else {
      colIndex[col] = idx;
    }
  }
  if (errors.length > 0) {
    return { rows, errors };
  }

  const seenInstallments = new Set<number>();

  for (let i = 1; i < lines.length; i++) {
    const lineNum = i + 1;
    const cells = splitCsvLine(lines[i]);
    const rowErrors: string[] = [];

    const numRaw = cells[colIndex.installment_num];
    const n = parseInt((numRaw ?? "").trim(), 10);
    if (!Number.isFinite(n) || n <= 0) {
      rowErrors.push(`Row ${lineNum}: installment_num must be a positive integer.`);
    } else if (seenInstallments.has(n)) {
      rowErrors.push(`Row ${lineNum}: installment_num ${n} is duplicated.`);
    } else {
      seenInstallments.add(n);
    }

    const dateRaw = (cells[colIndex.due_date] ?? "").trim();
    if (!ISO_DATE_RE.test(dateRaw)) {
      rowErrors.push(`Row ${lineNum}: due_date "${dateRaw}" isn't in YYYY-MM-DD format.`);
    }

    const openingP = parseNum(cells[colIndex.opening_principal]);
    const emi = parseNum(cells[colIndex.emi_amount]);
    const principal = parseNum(cells[colIndex.principal_component]);
    const interest = parseNum(cells[colIndex.interest_component]);
    const closing = parseNum(cells[colIndex.closing_principal]);

    if (openingP === null || openingP < 0)
      rowErrors.push(`Row ${lineNum}: opening_principal must be a non-negative number.`);
    if (emi === null || emi < 0)
      rowErrors.push(`Row ${lineNum}: emi_amount must be a non-negative number.`);
    if (principal === null || principal < 0)
      rowErrors.push(`Row ${lineNum}: principal_component must be a non-negative number.`);
    if (interest === null || interest < 0)
      rowErrors.push(`Row ${lineNum}: interest_component must be a non-negative number.`);
    if (closing === null || closing < 0)
      rowErrors.push(`Row ${lineNum}: closing_principal must be a non-negative number.`);

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    rows.push({
      installment_num: n,
      due_date: dateRaw,
      opening_principal: openingP ?? 0,
      emi_amount: emi ?? 0,
      principal_component: principal ?? 0,
      interest_component: interest ?? 0,
      closing_principal: closing ?? 0,
    });
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push("No valid rows found.");
  }

  // Sort by installment_num so UI previews ordered.
  rows.sort((a, b) => a.installment_num - b.installment_num);

  return { rows, errors };
}

/**
 * Minimal CSV cell splitter. Handles quoted cells ("a,b,c") and quote
 * escaping (""text"") — RFC 4180-ish, good enough for bank statements.
 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        cells.push(cur);
        cur = "";
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  cells.push(cur);
  return cells;
}

function parseNum(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw)
    .replace(/[₹$€£]/g, "")
    .replace(/\bRs\.?/gi, "")
    .replace(/\bINR\b/gi, "")
    .replace(/,/g, "")
    .trim();
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Apply parsed rows as the loan's authoritative schedule.
 *
 * Wipes existing schedule + prepayments + corrections (destructive — UI
 * warns user in the preview). Bulk-inserts the new rows in chunks of 50.
 * Sets schedule_source to 'manual_csv' so rebuildLoanSchedule no-ops.
 */
export async function applyScheduleCsv(
  loanId: string,
  rows: ParsedScheduleRow[],
): Promise<void> {
  if (rows.length === 0) throw new Error("No rows to import.");
  const db = getDatabase();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "DELETE FROM loan_prepayments WHERE loan_account_id = ?;",
      loanId,
    );
    await db.runAsync(
      "DELETE FROM loan_corrections WHERE loan_account_id = ?;",
      loanId,
    );
    await db.runAsync(
      "DELETE FROM loan_schedule_entries WHERE loan_account_id = ?;",
      loanId,
    );

    const CHUNK = 50;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const placeholders = chunk
        .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .join(", ");
      const values: (string | number | null)[] = [];
      for (const row of chunk) {
        values.push(
          generateUUID(),
          loanId,
          row.installment_num,
          row.due_date,
          row.opening_principal,
          row.emi_amount,
          row.principal_component,
          row.interest_component,
          row.closing_principal,
          "scheduled",
        );
      }
      await db.runAsync(
        `INSERT INTO loan_schedule_entries (
          id, loan_account_id, installment_num, due_date, opening_principal, emi_amount,
          principal_component, interest_component, closing_principal, status
        ) VALUES ${placeholders};`,
        ...values,
      );
    }

    await db.runAsync(
      `UPDATE loan_accounts SET schedule_source = 'manual_csv', updated_at = datetime('now')
        WHERE id = ?;`,
      loanId,
    );
  });

  bumpDataVersion();
}

/**
 * Revert a manual_csv loan back to engine-generated schedule. Wipes the
 * schedule + flips schedule_source back to 'generated'; caller should
 * follow with `updateLoan` (or re-save the loan from the add form) to
 * trigger schedule regeneration.
 */
export async function revertToGeneratedSchedule(loanId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE loan_accounts SET schedule_source = 'generated', updated_at = datetime('now')
      WHERE id = ?;`,
    loanId,
  );
  bumpDataVersion();
}
