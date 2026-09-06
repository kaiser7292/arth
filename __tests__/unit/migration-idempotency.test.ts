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

/**
 * Strip comments before matching. Without this the checks below are satisfied by a comment
 * that merely MENTIONS the thing - which is exactly what happened: the doc comment added to
 * 065 explaining the legacy_alter_table bug made the guard pass even with the pragma deleted.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(new RegExp("//[^" + String.fromCharCode(10) + "]*", "g"), "");
}

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
      const src = code(fs.readFileSync(path.join(DIR, file), "utf8"));
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

  it("set legacy_alter_table when renaming a LIVE table aside", () => {
    // Since SQLite 3.25, `ALTER TABLE ... RENAME TO` also REWRITES references to that table
    // in other objects - including foreign keys in OTHER tables. In the rename/create/copy/
    // drop pattern used to change a CHECK constraint, that silently repoints other tables'
    // keys at the temporary ..._old table, and the DROP then leaves them dangling.
    //
    // That is what migration 065 did to reminder_fulfillments: every INSERT afterwards failed
    // with "no such table: main.recurring_expense_rules_old", so an expense could never be
    // linked to a reminder. `PRAGMA foreign_keys = OFF` does NOT prevent it - it disables
    // enforcement, not the rewrite. Only legacy_alter_table does.
    //
    // Only one DIRECTION is dangerous. `CREATE x_new; DROP x; RENAME x_new -> x` is safe:
    // nothing references the temporary name, and dropping the live table leaves other
    // tables' keys pointing at a name the rename then restores. 044 and 054 do it that way.
    // Renaming a LIVE table aside to a temporary name is what repoints everything at a table
    // about to be dropped.
    const TEMP = /_(old|backup|broken\w*|tmp)$/i;
    const offenders: string[] = [];
    for (const file of files) {
      const src = code(fs.readFileSync(path.join(DIR, file), "utf8"));
      const renames = [...src.matchAll(/ALTER TABLE\s+(\w+)\s+RENAME TO\s+(\w+)/gi)];
      const movesLiveTableAside = renames.some(([, from, to]) => TEMP.test(to) && !TEMP.test(from));
      if (movesLiveTableAside && !/PRAGMA\s+legacy_alter_table\s*=\s*ON/i.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
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
