import type { SQLiteDatabase } from "expo-sqlite";

export default {
  version: 59,
  name: "reconciliation_items",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS reconciliation_items (
        id                  TEXT PRIMARY KEY,
        session_id          TEXT NOT NULL REFERENCES reconciliation_sessions(id),
        stmt_date           TEXT NOT NULL,
        stmt_amount         REAL NOT NULL,
        stmt_direction      TEXT NOT NULL,
        stmt_narration      TEXT,
        matched_expense_id  TEXT REFERENCES expenses(id),
        matched_transfer_id TEXT REFERENCES account_transfers(id),
        match_confidence    TEXT,
        status              TEXT NOT NULL DEFAULT 'unmatched',
        exclude_reason      TEXT,
        sort_order          INTEGER,
        created_at          TEXT NOT NULL,
        deleted_at          TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_recon_items_session
        ON reconciliation_items(session_id);
    `);
  },
};
