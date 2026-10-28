import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 087 — shared transactions and Hisaab for households (Together rework).
 *
 * household_expense_shares  my choice for one of my transactions: shared with the household (1) or
 *                           kept personal (0), and how a shared one is split ('equal', 'payer_all' =
 *                           I pay all, 'custom' = my_pct is my share). No row = the default: shared
 *                           and split equally when its category counts as household spending.
 *                           expense_id has no FK on purpose (deletes clean it up; sync prunes orphans).
 * household_member_links    which Hisaab person a household member is on this phone, so shared
 *                           spending keeps that Hisaab up to date.
 * hisaab_entries.household_ref / expenses.household_ref
 *                           "<household id>:<item id>" on rows Together writes by itself on this
 *                           phone from what another member shared (my half of their bill, a
 *                           settle-up they recorded). Sync owns those rows: it updates and removes
 *                           them; nothing else does. Leaving a household clears the ref and keeps
 *                           the rows (they're real money).
 *
 * Idempotent: tables use IF NOT EXISTS, column adds are guarded.
 */
export const migration: Migration = {
  version: 87,
  name: "household_shares",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS household_expense_shares (
        expense_id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL REFERENCES households(id),
        shared INTEGER NOT NULL,
        split TEXT NOT NULL DEFAULT 'equal',
        my_pct REAL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS household_member_links (
        household_id TEXT NOT NULL REFERENCES households(id),
        member_id TEXT NOT NULL,
        hisaab_person_id TEXT NOT NULL REFERENCES hisaab_persons(id),
        PRIMARY KEY (household_id, member_id)
      );
    `);
    for (const table of ["hisaab_entries", "expenses"]) {
      const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table});`);
      if (!cols.some((c) => c.name === "household_ref")) {
        await db.execAsync(`ALTER TABLE ${table} ADD COLUMN household_ref TEXT;`);
      }
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_${table}_household_ref ON ${table}(household_ref);`);
    }
  },
};

export default migration;
