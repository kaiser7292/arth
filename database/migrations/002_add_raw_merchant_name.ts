import type { SQLiteDatabase } from "expo-sqlite";

export default {
  version: 2,
  name: "002_add_raw_merchant_name",
  up: async (db: SQLiteDatabase) => {
    // Idempotent: migration 001 was updated at some point to include
    // raw_merchant_name in the consolidated schema. On fresh installs the
    // column already exists, and ALTER TABLE ADD COLUMN would throw
    // "duplicate column name". PRAGMA table_info returns the current columns.
    const cols = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(expenses);",
    );
    const hasColumn = cols.some((c) => c.name === "raw_merchant_name");
    if (hasColumn) return;
    await db.execAsync(
      `ALTER TABLE expenses ADD COLUMN raw_merchant_name TEXT;`,
    );
  },
};
