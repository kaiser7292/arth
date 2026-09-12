import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 071 — recurring simulator entries.
 *
 * New columns on `simulation_entries` let a planned entry describe its own
 * relative-frequency cadence (same shape as recurring_expense_rules from
 * migration 065): frequency, repeat_ordinal, repeat_weekday, repeat_until.
 * When set, services/simulator.ts expands the entry into one concrete row
 * per cycle across the scenario horizon, reusing the cycle math extracted
 * to utils/recurrence.ts.
 *
 * No CHECK constraint on `frequency` here (unlike recurring_expense_rules) —
 * this is a plain ALTER ADD COLUMN, so no table rebuild is needed.
 *
 * Idempotent via PRAGMA table_info guard.
 */
export const migration: Migration = {
  version: 71,
  name: "simulator_recurring_entries",
  up: async (db: SQLiteDatabase) => {
    const cols = (await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(simulation_entries);",
    )) as Array<{ name: string }>;
    const has = (name: string) => cols.some((c) => c.name === name);

    if (!has("frequency")) {
      await db.execAsync("ALTER TABLE simulation_entries ADD COLUMN frequency TEXT;");
    }
    if (!has("repeat_ordinal")) {
      await db.execAsync("ALTER TABLE simulation_entries ADD COLUMN repeat_ordinal INTEGER;");
    }
    if (!has("repeat_weekday")) {
      await db.execAsync("ALTER TABLE simulation_entries ADD COLUMN repeat_weekday INTEGER;");
    }
    if (!has("repeat_until")) {
      await db.execAsync("ALTER TABLE simulation_entries ADD COLUMN repeat_until TEXT;");
    }
  },
};

export default migration;
