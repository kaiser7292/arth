import type { SQLiteDatabase } from "expo-sqlite";

export default {
  version: 60,
  name: "reconciliation_pre_arth_cutoff",
  up: async (db: SQLiteDatabase) => {
    const cols = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(reconciliation_sessions)",
    );
    if (!cols.some((c) => c.name === "pre_arth_cutoff")) {
      await db.runAsync(
        "ALTER TABLE reconciliation_sessions ADD COLUMN pre_arth_cutoff TEXT",
      );
    }
  },
};
