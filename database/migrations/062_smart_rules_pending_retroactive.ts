import type { SQLiteDatabase } from "expo-sqlite";

export default {
  version: 62,
  name: "smart_rules_pending_retroactive",
  up: async (db: SQLiteDatabase) => {
    const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(smart_rules)");
    if (!cols.some((c) => c.name === "pending_retroactive")) {
      // Default 1 so existing rules are immediately eligible for retroactive apply.
      await db.runAsync(
        "ALTER TABLE smart_rules ADD COLUMN pending_retroactive INTEGER NOT NULL DEFAULT 1",
      );
    }
  },
};
