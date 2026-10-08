import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 082 — where a demat snapshot came from, and whether a transfer changed one.
 *
 * demat_portfolio_snapshots.source, demat_fund_snapshots.source:
 *   'broker'  saved by a broker sync (Kite / Angel One / Zebpay) - the broker's own figure
 *   'manual'  typed in by the user
 *   'auto'    created by a transfer's side effect (money added to / withdrawn from the account)
 *   NULL      saved before this migration - treated like 'manual'
 *
 * account_transfers.snapshot_applied:
 *   1     the transfer added to / took from a snapshot (so undo must reverse it)
 *   0     it didn't - a broker figure for that day already included the money
 *   NULL  before this migration - treated as applied (the old behaviour)
 *
 * A broker figure is the truth for its day: transfers don't adjust it, and undoing a transfer
 * doesn't adjust it either (a sync after the transfer already replaced the adjusted value).
 *
 * Idempotent via PRAGMA table_info guard.
 */
export const migration: Migration = {
  version: 82,
  name: "snapshot_source",
  up: async (db: SQLiteDatabase) => {
    for (const table of ["demat_portfolio_snapshots", "demat_fund_snapshots"]) {
      const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table});`);
      if (!columns.some((c) => c.name === "source")) {
        await db.execAsync(`ALTER TABLE ${table} ADD COLUMN source TEXT;`);
      }
    }
    const transferColumns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(account_transfers);`);
    if (!transferColumns.some((c) => c.name === "snapshot_applied")) {
      await db.execAsync(`ALTER TABLE account_transfers ADD COLUMN snapshot_applied INTEGER;`);
    }
  },
};

export default migration;
