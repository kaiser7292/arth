import type { SQLiteDatabase } from "expo-sqlite";

export default {
  version: 61,
  name: "applied_rule_ids",
  up: async (db: SQLiteDatabase) => {
    // Track ALL matched rules per expense (JSON array), not just the first one.
    const expenseCols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(expenses)");
    if (!expenseCols.some((c) => c.name === "applied_rule_ids")) {
      await db.runAsync("ALTER TABLE expenses ADD COLUMN applied_rule_ids TEXT");
    }

    // Same for scan details so the SMS detail card can show which rules fired.
    const detailCols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(sms_scan_details)");
    if (!detailCols.some((c) => c.name === "applied_rule_ids")) {
      await db.runAsync("ALTER TABLE sms_scan_details ADD COLUMN applied_rule_ids TEXT");
    }
  },
};
