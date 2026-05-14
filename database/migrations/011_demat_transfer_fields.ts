import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 011: Demat-aware account transfers.
 *
 * When a user transfers money into a demat account (e.g. savings → broker),
 * the transfer can either land in the **fund** (idle cash with the broker) or
 * directly increase the **portfolio** (if the money was invested immediately).
 * Optionally the same transfer can be logged as a contribution to an
 * investment_bucket, which flows into yearly-plan progress + linked milestones.
 *
 * To make the "delete transfer → undo all side-effects" path correct and
 * deterministic, we persist three decisions on the transfer row:
 *   - demat_target: "fund" | "portfolio" | NULL (NULL = non-demat transfer)
 *   - investment_bucket_id: FK to investment_buckets, NULL if not linked
 *   - linked_contribution_id: the investment_contributions row created for
 *     this transfer (if any). Gives reverse an O(1) PK lookup and prevents
 *     ambiguous matches when two identical transfers exist on the same date.
 *
 * All three columns default NULL so existing rows are unaffected.
 */
export default {
  version: 11,
  name: "demat_transfer_fields",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      ALTER TABLE account_transfers ADD COLUMN demat_target TEXT
        CHECK(demat_target IN ('fund', 'portfolio'));
      ALTER TABLE account_transfers ADD COLUMN investment_bucket_id TEXT
        REFERENCES investment_buckets(id);
      ALTER TABLE account_transfers ADD COLUMN linked_contribution_id TEXT
        REFERENCES investment_contributions(id);
      CREATE INDEX IF NOT EXISTS idx_account_transfers_bucket
        ON account_transfers(investment_bucket_id)
        WHERE investment_bucket_id IS NOT NULL;
    `);
  },
};
