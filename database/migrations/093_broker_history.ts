import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 093 - real broker records, replacing the estimate of gains from withdrawals.
 *
 *   broker_trades          - individual trades, from each day's API capture or a tradebook file
 *   broker_gains           - each sale as the broker's own tax report states it
 *   broker_money_moves     - money added to or withdrawn from the broker
 *   broker_capture_days    - which days were saved, with holdings to spot what's missing
 *   broker_report_imports  - which reports were imported, and the period each covers
 *
 * Also a typed crypto gain on the income profile, since crypto has no other source until trades are saved.
 */
export const migration: Migration = {
  version: 93,
  name: "broker_history",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS broker_trades (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        broker TEXT NOT NULL,
        segment TEXT NOT NULL DEFAULT 'EQ',
        symbol TEXT NOT NULL,
        isin TEXT,
        exchange TEXT,
        product TEXT,
        side TEXT NOT NULL,
        quantity REAL NOT NULL,
        price REAL NOT NULL,
        trade_date TEXT NOT NULL,
        trade_time TEXT,
        order_id TEXT,
        trade_id TEXT,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_broker_trades_account_date ON broker_trades(account_id, trade_date);

      CREATE TABLE IF NOT EXISTS broker_gains (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        broker TEXT NOT NULL,
        symbol TEXT NOT NULL,
        isin TEXT,
        quantity REAL NOT NULL,
        buy_date TEXT,
        sell_date TEXT NOT NULL,
        buy_value REAL NOT NULL DEFAULT 0,
        sell_value REAL NOT NULL DEFAULT 0,
        taxable REAL NOT NULL DEFAULT 0,
        charges REAL NOT NULL DEFAULT 0,
        stt REAL NOT NULL DEFAULT 0,
        category TEXT NOT NULL,
        asset_class TEXT NOT NULL DEFAULT 'equity',
        check_reason TEXT,
        cost_override REAL,
        class_override TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_broker_gains_account_date ON broker_gains(account_id, sell_date);

      CREATE TABLE IF NOT EXISTS broker_money_moves (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        broker TEXT NOT NULL,
        move_date TEXT NOT NULL,
        direction TEXT NOT NULL,
        amount REAL NOT NULL,
        reference TEXT,
        narration TEXT,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_broker_money_account_date ON broker_money_moves(account_id, move_date);

      CREATE TABLE IF NOT EXISTS broker_capture_days (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        broker TEXT NOT NULL,
        capture_date TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        trade_count INTEGER NOT NULL DEFAULT 0,
        holdings_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_broker_capture_broker_date ON broker_capture_days(broker, capture_date);

      CREATE TABLE IF NOT EXISTS broker_report_imports (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        broker TEXT NOT NULL,
        kind TEXT NOT NULL,
        period_from TEXT NOT NULL,
        period_to TEXT NOT NULL,
        file_name TEXT,
        row_count INTEGER NOT NULL DEFAULT 0,
        charges_total REAL,
        imported_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_broker_imports_account ON broker_report_imports(account_id, kind);
    `);

    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(salary_profiles);`);
    if (columns.length > 0 && !columns.some((c) => c.name === "capital_gains_crypto")) {
      await db.execAsync(`ALTER TABLE salary_profiles ADD COLUMN capital_gains_crypto REAL NOT NULL DEFAULT 0;`);
    }
  },
};

export default migration;
