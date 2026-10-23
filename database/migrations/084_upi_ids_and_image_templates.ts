import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 084 — UPI IDs on accounts, and image templates.
 *
 * financial_accounts.upi_ids: the user's own UPI IDs that pay from / receive into this account, as a
 * JSON array of lowercase strings ('["name@okicici","98xxxxxx@ybl"]'). An account can have several;
 * an ID belongs to one account. A payment picture showing one of them picks that account.
 *
 * image_templates: a payment picture layout the user taught Arth by tapping its fields ("this is the
 * amount", "this is who was paid") - the picture equivalent of Smart SMS templates. anchors is a JSON
 * array of the layout's fixed text; fields a JSON object of how to find each value
 * (services/receipt/image-templates.ts).
 *
 * Idempotent: the column add is guarded, the table uses IF NOT EXISTS.
 */
export const migration: Migration = {
  version: 84,
  name: "upi_ids_and_image_templates",
  up: async (db: SQLiteDatabase) => {
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(financial_accounts);`);
    if (!columns.some((c) => c.name === "upi_ids")) {
      await db.execAsync(`ALTER TABLE financial_accounts ADD COLUMN upi_ids TEXT;`);
    }
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS image_templates (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'expense',
        anchors TEXT NOT NULL,
        fields TEXT NOT NULL,
        sample_text TEXT,
        use_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_image_templates_user ON image_templates(user_id);
    `);
  },
};

export default migration;
