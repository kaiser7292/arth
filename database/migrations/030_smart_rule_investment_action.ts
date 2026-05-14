import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 030 (v17.2.0): Smart Rule action — link to investment bucket.
 *
 * New column `action_link_to_investment_bucket_id` on smart_rules. When set,
 * the rule matcher auto-creates an expense_investment_links row after createExpense
 * (respecting the existing guards in expense-investment-link.ts).
 *
 * Idempotent — guards via PRAGMA table_info.
 */
export default {
  version: 30,
  name: "smart_rule_investment_action",
  up: async (db: SQLiteDatabase) => {
    const cols = (await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(smart_rules);",
    )) as Array<{ name: string }>;
    const has = cols.some((c) => c.name === "action_link_to_investment_bucket_id");
    if (!has) {
      await db.execAsync(
        "ALTER TABLE smart_rules ADD COLUMN action_link_to_investment_bucket_id TEXT;",
      );
    }
  },
};
