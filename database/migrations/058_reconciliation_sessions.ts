import type { SQLiteDatabase } from "expo-sqlite";

export default {
  version: 58,
  name: "reconciliation_sessions",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS reconciliation_sessions (
        id                TEXT PRIMARY KEY,
        account_id        TEXT NOT NULL REFERENCES financial_accounts(id),
        stmt_start_date   TEXT NOT NULL,
        stmt_end_date     TEXT NOT NULL,
        stmt_closing_bal  REAL,
        arth_closing_bal  REAL,
        total_stmt_count  INTEGER,
        matched_count     INTEGER,
        status            TEXT NOT NULL DEFAULT 'in_progress',
        import_format     TEXT,
        import_filename   TEXT,
        created_at        TEXT NOT NULL,
        completed_at      TEXT,
        deleted_at        TEXT
      );
    `);
  },
};
