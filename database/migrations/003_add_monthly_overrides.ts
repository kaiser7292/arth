import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

const migration: Migration = {
  version: 3,
  name: "add_monthly_overrides_to_salary_profiles",
  up: async (db: SQLiteDatabase) => {
    // Idempotent — see 002 comment for rationale.
    const cols = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(salary_profiles);",
    );
    if (cols.some((c) => c.name === "monthly_overrides")) return;
    await db.execAsync(
      "ALTER TABLE salary_profiles ADD COLUMN monthly_overrides TEXT;",
    );
  },
};

export default migration;
