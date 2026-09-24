import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 076 — recurring_transactions.cancel_requested_at.
 *
 * Set when the user swipes "Cancel this" in the Subscription check. Arth can't cancel anything
 * itself; the date lets the check flag the subscription again if it keeps charging afterwards
 * (last_seen_date later than the request).
 *
 * The recurring detector only ever UPDATEs the columns it owns, so this survives re-detection.
 *
 * Idempotent via PRAGMA table_info guard (plain ALTER, matches migration 071/073/074).
 */
export const migration: Migration = {
  version: 76,
  name: "recurring_cancel_requested",
  up: async (db: SQLiteDatabase) => {
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(recurring_transactions);`);
    if (!columns.some((c) => c.name === "cancel_requested_at")) {
      await db.execAsync(`ALTER TABLE recurring_transactions ADD COLUMN cancel_requested_at TEXT;`);
    }
  },
};

export default migration;
