import type { SQLiteDatabase } from "expo-sqlite";

export default {
  version: 57,
  name: "vault_entries",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS vault_entries (
        id                TEXT PRIMARY KEY,
        title             TEXT NOT NULL,
        category          TEXT NOT NULL,
        login_method      TEXT NOT NULL DEFAULT 'password',
        username          TEXT,
        email             TEXT,
        phone             TEXT,
        password_enc      TEXT,
        pin_enc           TEXT,
        url               TEXT,
        notes             TEXT,
        custom_fields     TEXT,
        renewal_date      TEXT,
        linked_account_id TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT,
        deleted_at        TEXT
      );
    `);
  },
};
