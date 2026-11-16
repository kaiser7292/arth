import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 094 - what a fixed deposit does at maturity (docs/FD_IMPROVEMENTS_PROPOSAL.md point 4).
 *
 * investment_products.renewal_mode:
 *   'none'               - pays out to the funding account and closes (the behaviour before this)
 *   'principal'          - pays the interest out, renews the principal for the same term
 *   'principal_interest' - renews the whole maturity amount for the same term
 *
 * Idempotent: PRAGMA table_info guard.
 */
export const migration: Migration = {
  version: 94,
  name: "fd_renewal_mode",
  up: async (db: SQLiteDatabase) => {
    const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(investment_products);");
    if (!cols.some((c) => c.name === "renewal_mode")) {
      await db.execAsync("ALTER TABLE investment_products ADD COLUMN renewal_mode TEXT NOT NULL DEFAULT 'none';");
    }
  },
};

export default migration;
