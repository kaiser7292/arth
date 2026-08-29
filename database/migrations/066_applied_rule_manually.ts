import type { SQLiteDatabase } from "expo-sqlite";

export default {
  version: 66,
  name: "applied_rule_manually",
  up: async (db: SQLiteDatabase): Promise<void> => {
    const cols = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(expenses);",
    );
    const names = cols.map((c) => c.name);
    if (!names.includes("applied_rule_manually")) {
      await db.runAsync(
        "ALTER TABLE expenses ADD COLUMN applied_rule_manually INTEGER NOT NULL DEFAULT 0;",
      );
    }
  },
};
