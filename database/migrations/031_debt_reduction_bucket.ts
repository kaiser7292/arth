import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 031 (v17.3.0): Debt Reduction bucket + FX on loans.
 *
 * `investment_buckets` gains:
 *   - bucket_type TEXT DEFAULT 'investment' CHECK in ('investment','debt_payoff')
 *   - linked_loan_account_id TEXT nullable (FK to loan_accounts.id)
 *
 * The `fx_rate` + `fx_rate_date` columns on `loan_accounts` already exist from
 * migration 029; v17.3.0 just starts using them (no ALTER needed).
 *
 * Idempotent via PRAGMA checks.
 */
export default {
  version: 31,
  name: "debt_reduction_bucket",
  up: async (db: SQLiteDatabase) => {
    const cols = (await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(investment_buckets);",
    )) as Array<{ name: string }>;
    const has = (name: string) => cols.some((c) => c.name === name);

    if (!has("bucket_type")) {
      await db.execAsync(
        "ALTER TABLE investment_buckets ADD COLUMN bucket_type TEXT DEFAULT 'investment';",
      );
    }
    if (!has("linked_loan_account_id")) {
      await db.execAsync(
        "ALTER TABLE investment_buckets ADD COLUMN linked_loan_account_id TEXT;",
      );
    }

    await db.execAsync(
      "CREATE INDEX IF NOT EXISTS idx_investment_buckets_loan ON investment_buckets(linked_loan_account_id);",
    );
  },
};
