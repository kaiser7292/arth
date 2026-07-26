import type { SQLiteDatabase } from "expo-sqlite";

export default {
  version: 63,
  name: "insurance_policies",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS insurance_policies (
        id                    TEXT PRIMARY KEY NOT NULL,
        user_id               INTEGER NOT NULL DEFAULT 1,
        policy_type           TEXT NOT NULL,
        provider_name         TEXT NOT NULL,
        policy_number         TEXT,
        sum_insured           REAL NOT NULL DEFAULT 0,
        annual_premium        REAL NOT NULL DEFAULT 0,
        premium_frequency     TEXT NOT NULL DEFAULT 'annual',
        start_date            TEXT,
        expiry_date           TEXT,
        is_active             INTEGER NOT NULL DEFAULT 1,
        notes                 TEXT,
        covers_family         INTEGER NOT NULL DEFAULT 0,
        family_members_covered INTEGER NOT NULL DEFAULT 1,
        created_at            TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at            TEXT
      );
    `);
  },
};
