import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 055: Add default_payment_mode_id to sms_template_patterns.
 *
 * Stores the UUID of a payment_modes row that should be applied to
 * expenses created from this template when the parsed SMS doesn't carry
 * explicit payment mode information.
 */
export default {
  version: 55,
  name: "template_payment_mode",
  up: async (db: SQLiteDatabase) => {
    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(sms_template_patterns);`,
    );
    const has = cols.some((c) => c.name === "default_payment_mode_id");
    if (!has) {
      await db.execAsync(
        `ALTER TABLE sms_template_patterns ADD COLUMN default_payment_mode_id TEXT;`,
      );
    }
  },
};
