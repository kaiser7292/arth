/**
 * One message read by on-device AI, as the reading queue keeps it while it works and as Scan
 * history saves it (sms_scan_runs with source "ai"). Scan history draws these rows with
 * components/ai/LabResultRow.tsx.
 */

import type { ScanDetail, ScanDetailCategory } from "@/services/sms/sms-scan-logging";
import type { ReadSmsOutcome } from "./tasks/read-sms";

export interface RunRow {
  id: string;
  sender: string;
  body: string;
  date?: number;
  outcome?: ReadSmsOutcome;
  raw?: string;
  ms?: number;
  error?: string;
  /** Added to Catch Up: the transaction made, or null when Arth didn't add one. */
  added?: { expenseId: string | null; note: string | null };
}

function categoryOf(row: RunRow): ScanDetailCategory | null {
  if (row.error) return "ai_error";
  switch (row.outcome?.kind) {
    case "transaction":
      return "ai_transaction";
    case "not_transaction":
      return "ai_not_money";
    case "ignored":
      return "ai_ignored";
    case "rejected":
      return "ai_rejected";
    default:
      return null; // not read yet: the run was stopped first
  }
}

/** A read row as a Scan history detail. */
export function readRowToDetail(row: RunRow): ScanDetail | null {
  const category = categoryOf(row);
  if (!category) return null;
  const o = row.outcome;
  return {
    smsAddress: row.sender,
    smsBodyPreview: row.body,
    smsDate: row.date ?? null,
    category,
    filterReason: row.error ?? (o?.kind === "rejected" ? o.problems.join("; ") : null),
    parsedAmount: o?.kind === "transaction" ? o.result.amount : null,
    parsedMerchant: o?.kind === "transaction" ? o.result.merchant : null,
    parsedType: o?.kind === "transaction" ? o.result.type : null,
    messageRef: row.id,
    aiResult: o ?? null,
    aiMs: row.ms ?? null,
    addedExpenseId: row.added?.expenseId ?? null,
    addedNote: row.added?.note ?? null,
  };
}
