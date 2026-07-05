import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 054: Widen demat_target CHECK constraint to include 'withdrawal'.
 *
 * Migration 011 added demat_target CHECK(demat_target IN ('fund', 'portfolio'))
 * to account_transfers. v1.13.0 introduced demat-as-source transfers that stamp
 * demat_target = 'withdrawal', which the old constraint rejects.
 *
 * SQLite doesn't support ALTER COLUMN, so we recreate the table with the
 * updated constraint, copy all data, then rename. Foreign keys are disabled
 * for the duration so the DROP + RENAME don't cascade.
 */
export default {
  version: 54,
  name: "demat_target_withdrawal",
  up: async (db: SQLiteDatabase) => {
    // Idempotency: skip if 'withdrawal' is already in the constraint.
    const meta = await db.getFirstAsync<{ sql: string }>(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='account_transfers';`,
    );
    if (meta?.sql?.includes("'withdrawal'")) return;

    await db.execAsync(`PRAGMA foreign_keys = OFF;`);
    try {
      await db.execAsync(`
        CREATE TABLE account_transfers_new (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          from_account_id TEXT NOT NULL REFERENCES financial_accounts(id),
          to_account_id TEXT NOT NULL REFERENCES financial_accounts(id),
          amount REAL NOT NULL,
          description TEXT,
          date TEXT NOT NULL,
          linked_forecast_id TEXT REFERENCES expenses(id),
          linked_expense_id TEXT REFERENCES expenses(id),
          source TEXT NOT NULL DEFAULT 'manual',
          raw_source_text TEXT,
          source_sms_address TEXT,
          demat_target TEXT CHECK(demat_target IN ('fund', 'portfolio', 'withdrawal')),
          investment_bucket_id TEXT REFERENCES investment_buckets(id),
          linked_contribution_id TEXT REFERENCES investment_contributions(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          deleted_at TEXT
        );

        INSERT INTO account_transfers_new
          SELECT id, user_id, from_account_id, to_account_id, amount, description, date,
                 linked_forecast_id, linked_expense_id, source, raw_source_text, source_sms_address,
                 demat_target, investment_bucket_id, linked_contribution_id,
                 created_at, updated_at, deleted_at
          FROM account_transfers;

        DROP TABLE account_transfers;
        ALTER TABLE account_transfers_new RENAME TO account_transfers;

        CREATE INDEX IF NOT EXISTS idx_transfers_from_account_date ON account_transfers(from_account_id, date);
        CREATE INDEX IF NOT EXISTS idx_transfers_to_account_date ON account_transfers(to_account_id, date);
        CREATE INDEX IF NOT EXISTS idx_transfers_user_date ON account_transfers(user_id, date);
        CREATE INDEX IF NOT EXISTS idx_account_transfers_forecast ON account_transfers(linked_forecast_id);
        CREATE INDEX IF NOT EXISTS idx_account_transfers_expense ON account_transfers(linked_expense_id);
        CREATE INDEX IF NOT EXISTS idx_account_transfers_user ON account_transfers(user_id);
        CREATE INDEX IF NOT EXISTS idx_account_transfers_bucket
          ON account_transfers(investment_bucket_id)
          WHERE investment_bucket_id IS NOT NULL;
      `);
    } finally {
      await db.execAsync(`PRAGMA foreign_keys = ON;`);
    }
  },
};
