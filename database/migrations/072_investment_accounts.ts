import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 072 — Investment accounts (docs/INVESTMENT_ACCOUNTS_PROPOSAL.md).
 *
 * Two tables extending `financial_accounts` (account_type='investment'), modeled
 * directly on migration 029's loan_accounts / loan_schedule_entries — an FD is a
 * loan in reverse, and this reuses that shape:
 *
 *   - investment_products — 1:1 sibling carrying instrument + valuation strategy.
 *     `valuation` decides how the account's value is computed: 'market' (demat-style
 *     snapshots, unused by this table's own columns), 'contribution' (pension-style
 *     balance chain, likewise no extra columns needed), or 'contract' (FD-style,
 *     computed from principal/rate/dates — the only strategy this migration adds
 *     real schema for).
 *   - investment_schedule_entries — generated maturity/payout schedule for
 *     'contract' products only. UNIQUE(product_id, event_num) + status is the
 *     idempotency key, same mechanism loan_schedule_entries already uses.
 *
 * v1 scope is FD only (`instrument='fd'`, `payout_mode='cumulative'`) — RD and
 * bonds are out of scope per the proposal; the schema leaves room for them
 * without requiring a rebuild later.
 *
 * Idempotent via IF NOT EXISTS; safe to re-run.
 */
export const migration: Migration = {
  version: 72,
  name: "investment_accounts",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS investment_products (
        id                       TEXT PRIMARY KEY,
        financial_account_id     TEXT NOT NULL UNIQUE REFERENCES financial_accounts(id) ON DELETE CASCADE,
        instrument               TEXT NOT NULL CHECK(instrument IN ('equity','mutual_fund','gold','fd','bond','epf','nps','ppf','other')),
        valuation                TEXT NOT NULL CHECK(valuation IN ('market','contract','contribution')),
        principal                REAL,
        interest_rate_pa         REAL,
        interest_method          TEXT CHECK(interest_method IN ('simple','compound')),
        compounding_freq         TEXT CHECK(compounding_freq IN ('monthly','quarterly','annually')),
        start_date               TEXT,
        maturity_date            TEXT,
        payout_mode              TEXT CHECK(payout_mode IN ('cumulative','periodic')),
        source_account_id        TEXT REFERENCES financial_accounts(id),
        auto_credit_on_maturity  INTEGER NOT NULL DEFAULT 1,
        status                   TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','matured','closed')),
        created_at               TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_investment_products_fa ON investment_products(financial_account_id);
      CREATE INDEX IF NOT EXISTS idx_investment_products_status ON investment_products(status);

      CREATE TABLE IF NOT EXISTS investment_schedule_entries (
        id                    TEXT PRIMARY KEY,
        product_id            TEXT NOT NULL REFERENCES investment_products(id) ON DELETE CASCADE,
        event_num             INTEGER NOT NULL,
        event_date            TEXT NOT NULL,
        kind                  TEXT NOT NULL CHECK(kind IN ('maturity','interest_payout')),
        principal_component   REAL,
        interest_component    REAL,
        status                TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','materialised','skipped')),
        linked_expense_id     TEXT REFERENCES expenses(id) ON DELETE SET NULL,
        linked_transfer_id    TEXT REFERENCES account_transfers(id) ON DELETE SET NULL,
        UNIQUE(product_id, event_num)
      );
      CREATE INDEX IF NOT EXISTS idx_investment_sched_product ON investment_schedule_entries(product_id, status);
      CREATE INDEX IF NOT EXISTS idx_investment_sched_date ON investment_schedule_entries(event_date, status);
    `);
  },
};

export default migration;
