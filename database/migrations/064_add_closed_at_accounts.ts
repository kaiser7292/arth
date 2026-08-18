import type { SQLiteDatabase } from "expo-sqlite";

export default {
  version: 64,
  name: "add_closed_at_accounts",
  up: async (db: SQLiteDatabase) => {
    const cols = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(financial_accounts);"
    );
    const names = new Set(cols.map(c => c.name));
    if (!names.has("closed_at")) {
      await db.execAsync("ALTER TABLE financial_accounts ADD COLUMN closed_at TEXT;");
    }
    if (!names.has("closed_note")) {
      await db.execAsync("ALTER TABLE financial_accounts ADD COLUMN closed_note TEXT;");
    }
  },
};
