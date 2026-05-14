import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 016: Index on account_transfers.linked_contribution_id.
 *
 * Performance fix identified in the v14.8.0 audit. The v14.7.0 cross-link
 * query in `getInvestmentContributions` LEFT JOINs `account_transfers ON
 * linked_contribution_id = contributions.id`. Without an index, the JOIN
 * was a full scan of `account_transfers` per contribution lookup — fine
 * for small datasets, measurable at 500+ historical transfers.
 *
 * Also speeds up the delete-transfer reverse path and the
 * deleteInvestmentContribution cascade (v14.8.0 G2 guardrail), both of
 * which filter `account_transfers WHERE linked_contribution_id = ?`.
 *
 * Partial index (`WHERE linked_contribution_id IS NOT NULL`) skips the
 * overwhelming majority of transfers that have no contribution link.
 */
export default {
  version: 16,
  name: "linked_contribution_index",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_account_transfers_linked_contribution
        ON account_transfers(linked_contribution_id)
        WHERE linked_contribution_id IS NOT NULL;
    `);
  },
};
