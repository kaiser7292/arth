import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 086 — households (Together, Phase 1). Design: docs/HOUSEHOLD_PHASE1_DESIGN.md §6.1.
 *
 * households              the household this phone belongs to (one at a time in Phase 1): my member
 *                         id and role, my sharing choices, my next op number, sync state.
 *                         last_device_id: the phone that last sent my ops, to tell "restored here
 *                         from a backup" (carry on) from "now used on another phone" (stop).
 * household_members       everyone in it, with their public keys (to check their signatures).
 * household_categories    the household's own short category list ("Groceries", "Rent", …).
 * household_category_map  which of my categories count as which household category.
 * household_balance_accounts  the accounts whose balance I share.
 * household_items         what members share (theirs and mine): one row per shared transaction,
 *                         monthly total, savings rate or balance. local_ref links my own rows to the
 *                         expense / account they came from.
 * household_outbox        ops waiting to go to the relay (plain here; sealed when sent).
 * household_cursors       per member, the last op of theirs this phone has applied.
 * household_events        the activity feed (joined, left, shared N items, …).
 *
 * Keys are not here: they live in SecureStore (services/household/keys.ts) and travel in the backup
 * next to the Vault key.
 *
 * Idempotent: every table uses IF NOT EXISTS.
 */
export const migration: Migration = {
  version: 86,
  name: "households",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS households (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        my_member_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        relay_url TEXT NOT NULL,
        key_version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        share_household_categories INTEGER NOT NULL DEFAULT 1,
        share_other_totals INTEGER NOT NULL DEFAULT 1,
        share_all_transactions INTEGER NOT NULL DEFAULT 0,
        share_savings_rate INTEGER NOT NULL DEFAULT 0,
        share_balances INTEGER NOT NULL DEFAULT 0,
        next_seq INTEGER NOT NULL DEFAULT 1,
        needs_snapshot INTEGER NOT NULL DEFAULT 1,
        last_device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        joined_at TEXT,
        left_at TEXT,
        last_sync_at TEXT,
        last_sync_error TEXT
      );

      CREATE TABLE IF NOT EXISTS household_members (
        household_id TEXT NOT NULL REFERENCES households(id),
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        colour TEXT,
        box_public TEXT NOT NULL,
        sign_public TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        settings_json TEXT,
        joined_at TEXT,
        removed_at TEXT,
        PRIMARY KEY (household_id, id)
      );

      CREATE TABLE IF NOT EXISTS household_categories (
        household_id TEXT NOT NULL REFERENCES households(id),
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (household_id, id)
      );

      CREATE TABLE IF NOT EXISTS household_category_map (
        household_id TEXT NOT NULL REFERENCES households(id),
        local_category_id TEXT NOT NULL REFERENCES categories(id),
        household_category_id TEXT NOT NULL,
        PRIMARY KEY (household_id, local_category_id)
      );

      CREATE TABLE IF NOT EXISTS household_balance_accounts (
        household_id TEXT NOT NULL REFERENCES households(id),
        account_id TEXT NOT NULL REFERENCES financial_accounts(id),
        PRIMARY KEY (household_id, account_id)
      );

      CREATE TABLE IF NOT EXISTS household_items (
        household_id TEXT NOT NULL REFERENCES households(id),
        id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        month TEXT,
        date TEXT,
        paid REAL,
        my_share REAL,
        category_name TEXT,
        merchant TEXT,
        payload_json TEXT,
        local_ref TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (household_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_household_items_member ON household_items(household_id, member_id, kind);
      CREATE INDEX IF NOT EXISTS idx_household_items_month ON household_items(household_id, month);
      CREATE INDEX IF NOT EXISTS idx_household_items_local ON household_items(local_ref);

      CREATE TABLE IF NOT EXISTS household_outbox (
        household_id TEXT NOT NULL REFERENCES households(id),
        seq INTEGER NOT NULL,
        op_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        sent_at TEXT,
        PRIMARY KEY (household_id, seq)
      );

      CREATE TABLE IF NOT EXISTS household_cursors (
        household_id TEXT NOT NULL REFERENCES households(id),
        member_id TEXT NOT NULL,
        last_seq INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (household_id, member_id)
      );

      CREATE TABLE IF NOT EXISTS household_events (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL REFERENCES households(id),
        member_id TEXT,
        type TEXT NOT NULL,
        payload_json TEXT,
        at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_household_events_at ON household_events(household_id, at);
    `);
  },
};

export default migration;
