import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 038 (v17.5.23): null out descriptions that embed a masked account
 * number (e.g. "Zomato via HDFC ****1234", "HDFC ****9628 (UPI Payment)").
 *
 * The "****NNNN" fragment duplicates account context already carried by
 * account_id — redundant on list rows and hero cards. Stripped going forward
 * from buildDescription; this migration cleans up historical rows.
 *
 * Preserves descriptions carrying informative markers the user cannot derive
 * from other columns: Refund, Upcoming SI, CC Bill Payment. User-typed notes
 * wouldn't match the "****" literal pattern, so they survive.
 */
export default {
  version: 38,
  name: "null_masked_account_descriptions",
  up: async (db: SQLiteDatabase) => {
    await db.runAsync(
      `UPDATE expenses
       SET description = NULL
       WHERE source = 'sms_auto'
         AND description IS NOT NULL
         AND description LIKE '%****%'
         AND description NOT LIKE '%Refund%'
         AND description NOT LIKE '%Upcoming SI%'
         AND description NOT LIKE '%CC Bill Payment%';`,
    );
  },
};
