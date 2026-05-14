import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 023: SMS traceability on account_transfers.
 *
 * Before v15.12.1, a transfer created by "Mark as CC Bill Payment" / "Pay now"
 * / "Mark as Transfer" lost the raw SMS body. The original credit/debit row
 * carried `raw_source_text`, but that row was soft-deleted on reclassify —
 * leaving the resulting transfer orphaned from its SMS origin and the user
 * with no way to inspect "which bank SMS triggered this?"
 *
 * Adds two additive columns to account_transfers:
 *   - raw_source_text     — full normalized SMS body copied from the source
 *                            expense at reclassify time.
 *   - source_sms_address  — the DLT sender ID (e.g. "VM-HDFCBK-S").
 *
 * Both nullable; NULL = manual transfer with no SMS origin. Populated by
 * reclassifyCreditAsTransfer / markRepaymentAsPaid / reclassifyExpenseAsTransfer
 * when the source expense had `source='sms_auto'` and a raw body.
 *
 * Idempotent via PRAGMA table_info guard.
 */
export default {
  version: 23,
  name: "transfer_sms_trace",
  up: async (db: SQLiteDatabase) => {
    const cols = (await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(account_transfers);",
    )) as Array<{ name: string }>;
    const hasRaw = cols.some((c) => c.name === "raw_source_text");
    const hasAddr = cols.some((c) => c.name === "source_sms_address");
    if (!hasRaw) {
      await db.execAsync(
        "ALTER TABLE account_transfers ADD COLUMN raw_source_text TEXT;",
      );
    }
    if (!hasAddr) {
      await db.execAsync(
        "ALTER TABLE account_transfers ADD COLUMN source_sms_address TEXT;",
      );
    }
  },
};
