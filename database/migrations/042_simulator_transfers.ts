import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

export const migration: Migration = {
  version: 42,
  name: "simulator_transfers",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      ALTER TABLE simulation_entries ADD COLUMN from_account_id TEXT;
      ALTER TABLE simulation_entries ADD COLUMN to_account_id TEXT;
    `);
  },
};

export default migration;
