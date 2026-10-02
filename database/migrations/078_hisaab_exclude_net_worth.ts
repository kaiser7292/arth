import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 078 — hisaab_persons.exclude_from_net_worth.
 *
 * Every Hisaab person's balance counted towards net worth ("People owe me" asset / "I owe"
 * liability). Some balances aren't money the user expects to see again (or repay), e.g. a
 * family member's running tab. 1 = leave this person out of the balance sheet and every net
 * worth figure built on it. The Hisaab ledger itself is unaffected.
 *
 * Idempotent via PRAGMA table_info guard (plain ALTER, matches migration 071/073/074).
 */
export const migration: Migration = {
  version: 78,
  name: "hisaab_exclude_net_worth",
  up: async (db: SQLiteDatabase) => {
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(hisaab_persons);`);
    if (!columns.some((c) => c.name === "exclude_from_net_worth")) {
      await db.execAsync(`ALTER TABLE hisaab_persons ADD COLUMN exclude_from_net_worth INTEGER NOT NULL DEFAULT 0;`);
    }
  },
};

export default migration;
