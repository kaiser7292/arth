import fs from "fs";
import path from "path";

/**
 * SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
 *
 * So an unguarded ADD COLUMN throws "duplicate column name" if the column is already there — and
 * when it sits inside an `execAsync` batch alongside other statements, that error aborts the whole
 * batch. Everything after it, including a CREATE TABLE, silently never runs. The damage shows up
 * much later as "no such table" or "no such column" at runtime, with nothing to connect it back to
 * the migration.
 *
 * CLAUDE.md's database checklist already requires a `PRAGMA table_info` guard on every ALTER.
 * Seven migrations predate that rule; migration 069 repairs their columns, and this test stops an
 * eighth being written.
 *
 * The rule: if a migration file contains ALTER TABLE ADD COLUMN, it must also read table_info.
 */
const DIR = path.join("database", "migrations");

/** Grandfathered: written before the rule existed, repaired by 069. Do not add to this list. */
const LEGACY = new Set([
  "010_purchase_group.ts",
  "011_demat_transfer_fields.ts",
  "013_recurring_expense_rules.ts",
  "014_recurring_reminders.ts",
  "042_simulator_transfers.ts",
  "043_loan_corrections_deleted_at.ts",
  "067_smart_rule_applies_to.ts",
]);

describe("migrations", () => {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".ts") && f !== "index.ts");

  it("guard every ALTER TABLE ADD COLUMN with a table_info check", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (LEGACY.has(file)) continue;
      const src = fs.readFileSync(path.join(DIR, file), "utf8");
      const hasAlter = /ALTER TABLE\s+\w+\s+ADD COLUMN/i.test(src);
      if (hasAlter && !/table_info/i.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("keep the grandfathered list from growing", () => {
    // Every legacy entry must still exist; a rename should update the list, not silently drop the
    // exemption and leave the file unguarded.
    const missing = [...LEGACY].filter((f) => !files.includes(f));
    expect(missing).toEqual([]);
    expect(LEGACY.size).toBe(7);
  });

  it("register every migration file in the index", () => {
    // A migration that exists but is never added to the array runs on nobody's device - the same
    // end state as one that failed, and just as silent.
    const index = fs.readFileSync(path.join(DIR, "index.ts"), "utf8");
    const unregistered = files.filter((f) => {
      const mod = f.replace(/\.ts$/, "");
      return !index.includes(`"./${mod}"`);
    });
    expect(unregistered).toEqual([]);
  });
});
