import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 036 (v17.5.13): null out auto-populated SMS descriptions.
 *
 * Historical SMS parsing auto-filled `expenses.description` with strings like
 * "Zomato via HDFC ****1234 (UPI Payment)" / "(Credit)" / "(Standing Instruction)"
 * — merchant + account + type all duplicated from other columns. v17.5.13 stops
 * auto-populating these and flips list-row precedence to prefer description
 * over merchant. Without this migration, old auto-populated descriptions
 * would win over merchant as the primary label on old rows.
 *
 * Only targets sms_auto-sourced rows whose description ends in one of the
 * non-informative type markers. Informative markers kept (refund / CC bill /
 * reminder / forecast carry info not derivable from merchant). User-typed
 * notes never end with these exact parenthesized markers, so they survive.
 */
export default {
  version: 36,
  name: "null_auto_populated_descriptions",
  up: async (db: SQLiteDatabase) => {
    await db.runAsync(
      `UPDATE expenses
       SET description = NULL
       WHERE source = 'sms_auto'
         AND description IS NOT NULL
         AND (
           description LIKE '%(Credit)'
           OR description LIKE '%(UPI Credit)'
           OR description LIKE '%(Standing Instruction)'
           OR description LIKE '%(NACH Auto-Debit)'
           OR description LIKE '%(UPI Transfer)'
           OR description LIKE '%(UPI Payment)'
         );`,
    );
  },
};
