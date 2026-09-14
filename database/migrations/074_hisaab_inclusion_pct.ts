import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 074 — hisaab inclusion percentage (live balance tracking).
 *
 * Adds `pct` to simulation_hisaab_inclusions: the percentage (0-100) of a
 * hisaab person's balance the user chose to include in a scenario. Previously
 * only a frozen `amount`/`amount_sign` snapshot was stored, computed once at
 * save time and never revisited — if the person's real hisaab balance changed
 * afterward, the simulator kept showing the stale figure indefinitely.
 *
 * `pct` lets services/simulator.ts's listHisaabInclusions recompute
 * amount/amount_sign live against the person's CURRENT balance on every read
 * (pct/100 * currentBalance), so the inclusion tracks the real ledger instead
 * of a point-in-time snapshot. amount/amount_sign stay as columns — still
 * written at save time as a same-instant snapshot for any reader that hasn't
 * moved to the live recompute — but are no longer the source of truth for
 * display.
 *
 * Backfilled to 100 for existing rows (matches the pre-migration default:
 * every prior inclusion was implicitly "the whole balance" unless the user
 * had typed a smaller figure, and there's no way to recover that original
 * percentage from a frozen amount alone — 100 is the closer default since a
 * partial inclusion was the less common path per the sheet's own default).
 *
 * Idempotent via PRAGMA table_info guard (plain ALTER, matches migration 071/073).
 */
export const migration: Migration = {
  version: 74,
  name: "hisaab_inclusion_pct",
  up: async (db: SQLiteDatabase) => {
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(simulation_hisaab_inclusions);`);
    if (!columns.some((c) => c.name === "pct")) {
      await db.execAsync(`ALTER TABLE simulation_hisaab_inclusions ADD COLUMN pct REAL NOT NULL DEFAULT 100;`);
    }
  },
};

export default migration;
