import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 073 — FD investment-bucket linking + manual maturity correction.
 *
 * Extends investment_products (migration 072) with:
 *   - investment_bucket_id / linked_contribution_id — same pairing
 *     account_transfers already uses for demat transfers (migration 011), so an
 *     FD's deposit can count toward a yearly-plan investment bucket the same way.
 *   - maturity_amount_override — lets the user correct the computed maturity
 *     value (bank rounding/TDS rarely matches the formula exactly) without
 *     losing the original computed schedule row.
 *
 * Idempotent via PRAGMA table_info guard (plain ALTER, no CHECK — matches the
 * pattern migration 071 already established for this kind of additive column).
 */
export const migration: Migration = {
  version: 73,
  name: "fd_bucket_override",
  up: async (db: SQLiteDatabase) => {
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(investment_products);`);
    const names = new Set(columns.map((c) => c.name));

    if (!names.has("investment_bucket_id")) {
      await db.execAsync(`ALTER TABLE investment_products ADD COLUMN investment_bucket_id TEXT REFERENCES investment_buckets(id) ON DELETE SET NULL;`);
    }
    if (!names.has("linked_contribution_id")) {
      await db.execAsync(`ALTER TABLE investment_products ADD COLUMN linked_contribution_id TEXT REFERENCES investment_contributions(id) ON DELETE SET NULL;`);
    }
    if (!names.has("maturity_amount_override")) {
      await db.execAsync(`ALTER TABLE investment_products ADD COLUMN maturity_amount_override REAL;`);
    }

    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_investment_products_bucket ON investment_products(investment_bucket_id);`,
    );
  },
};

export default migration;
