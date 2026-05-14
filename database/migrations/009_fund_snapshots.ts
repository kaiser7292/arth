import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 009: Demat fund (idle cash) snapshots.
 *
 * Until now, fund_balance was a single scalar on financial_accounts with no
 * history. This migration adds a dedicated snapshot table that mirrors
 * demat_portfolio_snapshots in structure. Callers record a fund snapshot
 * alongside each portfolio snapshot — or leave it blank, in which case the
 * prior fund value is carried forward.
 *
 * Also one-time backfill: for each active demat account with a non-zero
 * fund_balance, create a today-dated snapshot so the history timeline starts
 * cleanly.
 */
export default {
  version: 9,
  name: "fund_snapshots",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS demat_fund_snapshots (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        fund_value REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(account_id, snapshot_date),
        FOREIGN KEY (account_id) REFERENCES financial_accounts(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_fund_snapshots_account_date
        ON demat_fund_snapshots(account_id, snapshot_date DESC);
    `);

    // One-time backfill: take today's fund_balance as the initial snapshot so
    // the trend timeline has an anchor. Only for demat accounts with a positive
    // or non-zero fund_balance (skip empty/zero accounts).
    const today = new Date().toISOString().split("T")[0];
    await db.runAsync(
      `INSERT OR IGNORE INTO demat_fund_snapshots (id, account_id, snapshot_date, fund_value)
       SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' ||
              lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' ||
              lower(hex(randomblob(6))),
              id, ?, fund_balance
       FROM financial_accounts
       WHERE account_type = 'demat' AND is_active = 1 AND fund_balance != 0;`,
      today,
    );
  },
};
