import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 025: Cash-flow Simulator tables (v16.0.0).
 *
 * Two new tables:
 *   - simulation_scenarios: named what-if plans (default + user-saved)
 *   - simulation_entries:   planned expenses + incomes within a scenario
 *
 * Fully isolated from existing tables. No FK writes into `expenses`.
 * `simulation_entries.scenario_id` cascades DELETE.
 *
 * Both tables are included in BACKUP_TABLES (see services/backup.ts) so
 * scenarios + entries round-trip through the encrypted backup file.
 *
 * Idempotent via IF NOT EXISTS; safe to re-run.
 */
export default {
  version: 25,
  name: "simulation_tables",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS simulation_scenarios (
        id            TEXT PRIMARY KEY NOT NULL,
        user_id       TEXT NOT NULL,
        name          TEXT NOT NULL,
        horizon_date  TEXT NOT NULL,
        is_default    INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at   TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sim_scen_user ON simulation_scenarios(user_id, archived_at);

      CREATE TABLE IF NOT EXISTS simulation_entries (
        id                      TEXT PRIMARY KEY NOT NULL,
        scenario_id             TEXT NOT NULL REFERENCES simulation_scenarios(id) ON DELETE CASCADE,
        direction               TEXT NOT NULL CHECK (direction IN ('out','in')),
        amount                  REAL NOT NULL,
        date                    TEXT NOT NULL,
        originally_planned_for  TEXT,
        account_id              TEXT,
        category_id             TEXT,
        merchant_name           TEXT,
        description             TEXT,
        source                  TEXT NOT NULL CHECK (source IN ('manual','seeded_reminder','seeded_forecast')),
        seed_source_id          TEXT,
        fulfilled_expense_id    TEXT,
        status                  TEXT NOT NULL DEFAULT 'upcoming'
                                CHECK (status IN ('upcoming','fulfilled','stale','dismissed')),
        created_at              TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_sim_entries_scenario ON simulation_entries(scenario_id, status);
      CREATE INDEX IF NOT EXISTS idx_sim_entries_date ON simulation_entries(scenario_id, date);
    `);
  },
};
