import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

export const migration: Migration = {
  version: 75,
  name: "integration_credentials",
  up: async (db: SQLiteDatabase) => {
    const tableInfo = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(integration_credentials)"
    );
    if (tableInfo.length > 0) return;

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS integration_credentials (
        service     TEXT NOT NULL,
        key         TEXT NOT NULL,
        value_enc   TEXT NOT NULL,
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (service, key)
      )
    `);
  },
};

export default migration;
