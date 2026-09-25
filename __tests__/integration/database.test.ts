/**
 * Database integration tests.
 *
 * Since expo-sqlite is a native module, we mock it to verify:
 * 1. Migration runner executes SQL in correct order
 * 2. Already-applied migrations are skipped
 * 3. Seed creates a default user when table is empty
 * 4. Seed is idempotent (doesn't duplicate user)
 *
 * True on-device integration testing is done via Maestro E2E flows.
 */

import { runMigrations, getCurrentVersion } from "../../database/migrations";
import { seedDefaultUser } from "../../database/seed";
import * as fs from "fs";
import * as path from "path";

/**
 * Migration files on disk ("076_recurring_cancel_requested.ts" -> 76). The runner's list is
 * checked against these, so adding a migration doesn't mean hand-editing counts in this file
 * (the old hardcoded 62 / 39 / version lists went stale at migration 040).
 */
const MIGRATION_FILES = fs
  .readdirSync(path.join(__dirname, "../../database/migrations"))
  .filter((f) => /^\d{3}_.+\.ts$/.test(f));
const FILE_VERSIONS = MIGRATION_FILES.map((f) => parseInt(f.slice(0, 3), 10)).sort((a, b) => a - b);

// Track all SQL statements executed
let executedSQL: string[] = [];
let executedRuns: { sql: string; params: unknown[] }[] = [];
let mockRows: Record<string, unknown[]> = {};

// Mock SQLiteDatabase
function createMockDb() {
  executedSQL = [];
  executedRuns = [];
  mockRows = {};

  return {
    execAsync: jest.fn(async (sql: string) => {
      executedSQL.push(sql.trim());
    }),
    runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
      executedRuns.push({ sql, params });
      return { changes: 1, lastInsertRowId: 1 };
    }),
    getAllAsync: jest.fn(async (sql: string) => {
      return mockRows[sql] ?? [];
    }),
    getFirstAsync: jest.fn(async (sql: string) => {
      const rows = mockRows[sql] ?? [];
      return rows[0] ?? null;
    }),
    closeAsync: jest.fn(),
  };
}

describe("Migration Runner", () => {
  it("creates schema_migrations table", async () => {
    const db = createMockDb();
    await runMigrations(db as never);

    const createMigrationTable = executedSQL.find((sql) =>
      sql.includes("schema_migrations"),
    );
    expect(createMigrationTable).toBeDefined();
    expect(createMigrationTable).toContain("CREATE TABLE IF NOT EXISTS");
    expect(createMigrationTable).toContain("version INTEGER PRIMARY KEY");
  });

  it("runs consolidated migration when none are applied", async () => {
    const db = createMockDb();
    await runMigrations(db as never);

    // First the schema_migrations table, then the consolidated schema, then later migrations.
    expect(executedSQL[0]).toContain("schema_migrations");
    expect(executedSQL.length).toBeGreaterThan(2);

    // The consolidated migration should create all tables
    const consolidatedSQL = executedSQL[1];
    expect(consolidatedSQL).toContain("CREATE TABLE IF NOT EXISTS users");
    expect(consolidatedSQL).toContain("CREATE TABLE IF NOT EXISTS categories");
    expect(consolidatedSQL).toContain("CREATE TABLE IF NOT EXISTS payment_modes");
    expect(consolidatedSQL).toContain("CREATE TABLE IF NOT EXISTS expenses");
    expect(consolidatedSQL).toContain("CREATE TABLE IF NOT EXISTS budgets");
    expect(consolidatedSQL).toContain("CREATE TABLE IF NOT EXISTS financial_accounts");
    expect(consolidatedSQL).toContain("CREATE TABLE IF NOT EXISTS hisaab_persons");
    expect(consolidatedSQL).toContain("CREATE TABLE IF NOT EXISTS hisaab_entries");
    expect(consolidatedSQL).toContain("CREATE TABLE IF NOT EXISTS expense_splits");
    expect(consolidatedSQL).toContain("CREATE TABLE IF NOT EXISTS account_transfers");
    expect(consolidatedSQL).toContain("CREATE TABLE IF NOT EXISTS tags");
    expect(consolidatedSQL).toContain("CREATE TABLE IF NOT EXISTS expense_tags");
  });

  it("creates indexes in consolidated migration", async () => {
    const db = createMockDb();
    await runMigrations(db as never);

    const consolidatedSQL = executedSQL[1];
    expect(consolidatedSQL).toContain("CREATE INDEX IF NOT EXISTS idx_expenses_date");
    expect(consolidatedSQL).toContain("CREATE INDEX IF NOT EXISTS idx_expenses_category");
    expect(consolidatedSQL).toContain("CREATE INDEX IF NOT EXISTS idx_expenses_acct_ledger");
    expect(consolidatedSQL).toContain("CREATE INDEX IF NOT EXISTS idx_hisaab_entries_person");
    expect(consolidatedSQL).toContain("CREATE INDEX IF NOT EXISTS idx_expense_splits_expense_id");
    expect(consolidatedSQL).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_unique");
  });

  it("records migration in schema_migrations", async () => {
    const db = createMockDb();
    await runMigrations(db as never);

    const inserts = executedRuns.filter((r) =>
      r.sql.includes("INSERT INTO schema_migrations"),
    );
    // One row per migration file, in increasing version order, ending at the newest file.
    expect(inserts.length).toBe(MIGRATION_FILES.length);
    const versions = inserts.map((r) => r.params[0] as number);
    expect(versions).toEqual(FILE_VERSIONS);
    expect(new Set(versions).size).toBe(versions.length);

    expect(inserts[0].params).toEqual([1, "001_consolidated_schema"]);
    expect(inserts[4].params).toEqual([5, "005_credits_into_expenses"]);
    expect(inserts[9].params).toEqual([10, "purchase_group"]);
    expect(inserts[10].params).toEqual([11, "demat_transfer_fields"]);
    expect(inserts[11].params).toEqual([12, "fund_balance_backfill"]);
    expect(inserts[12].params).toEqual([13, "recurring_expense_rules"]);
    expect(inserts[13].params).toEqual([14, "recurring_reminders"]);
    expect(inserts[14].params).toEqual([15, "public_data_tables"]);
    expect(inserts[15].params).toEqual([16, "linked_contribution_index"]);
    expect(inserts[16].params).toEqual([17, "smart_rules"]);
    expect(inserts[17].params).toEqual([18, "user_sms_templates"]);
    expect(inserts[18].params).toEqual([19, "min_balance"]);
    expect(inserts[19].params).toEqual([20, "expense_filter_indexes"]);
    expect(inserts[20].params).toEqual([21, "sms_template_sender_pattern"]);
    expect(inserts[21].params).toEqual([22, "hisaab_settlement_source"]);
    expect(inserts[22].params).toEqual([23, "transfer_sms_trace"]);
    expect(inserts[23].params).toEqual([24, "split_mode_persistence"]);
    expect(inserts[24].params).toEqual([25, "simulation_tables"]);
    expect(inserts[25].params).toEqual([26, "simulator_hisaab"]);
    expect(inserts[26].params).toEqual([27, "salary_profile_breakdown"]);
    expect(inserts[27].params).toEqual([28, "expense_investment_links"]);
    expect(inserts[28].params).toEqual([29, "loan_management"]);
    expect(inserts[29].params).toEqual([30, "smart_rule_investment_action"]);
    expect(inserts[30].params).toEqual([31, "debt_reduction_bucket"]);
    expect(inserts[31].params).toEqual([32, "expense_loan_links"]);
    expect(inserts[32].params).toEqual([33, "loan_corrections"]);
    expect(inserts[33].params).toEqual([34, "loan_round_mode"]);
    expect(inserts[34].params).toEqual([35, "loan_perf_indexes"]);
    expect(inserts[35].params).toEqual([36, "null_auto_populated_descriptions"]);
    expect(inserts[36].params).toEqual([38, "null_masked_account_descriptions"]);
    expect(inserts[37].params).toEqual([39, "loan_account_number_and_sms_reminder"]);
    expect(inserts[38].params).toEqual([40, "040_expense_edit_history"]);
  });

  it("skips already-applied migrations", async () => {
    const db = createMockDb();
    // Everything up to 040 applied: only the migrations after it should run.
    mockRows["SELECT version FROM schema_migrations ORDER BY version;"] = FILE_VERSIONS.filter((v) => v <= 40).map(
      (version) => ({ version }),
    );

    await runMigrations(db as never);

    const inserts = executedRuns.filter((r) =>
      r.sql.includes("INSERT INTO schema_migrations"),
    );
    expect(inserts.map((r) => r.params[0])).toEqual(FILE_VERSIONS.filter((v) => v > 40));

    // No consolidated schema re-run: the first statement is the schema_migrations table only.
    expect(executedSQL.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS users"))).toBe(false);
  });

  it("does nothing when all migrations are applied", async () => {
    const db = createMockDb();
    mockRows["SELECT version FROM schema_migrations ORDER BY version;"] = FILE_VERSIONS.map((version) => ({ version }));

    await runMigrations(db as never);

    const inserts = executedRuns.filter((r) =>
      r.sql.includes("INSERT INTO schema_migrations"),
    );
    expect(inserts.length).toBe(0);

    // Only 1 execAsync (schema_migrations table)
    expect(executedSQL.length).toBe(1);
  });
});

describe("getCurrentVersion", () => {
  it("returns 0 when no migrations applied", async () => {
    const db = createMockDb();
    const version = await getCurrentVersion(db as never);
    expect(version).toBe(0);
  });

  it("returns highest version when migrations exist", async () => {
    const db = createMockDb();
    mockRows["SELECT MAX(version) as version FROM schema_migrations;"] = [
      { version: 2 },
    ];
    const version = await getCurrentVersion(db as never);
    expect(version).toBe(2);
  });
});

describe("Schema Structure", () => {
  it("expenses table has correct CHECK constraints", async () => {
    const db = createMockDb();
    await runMigrations(db as never);

    const consolidatedSQL = executedSQL[1];
    expect(consolidatedSQL).toContain(
      "CHECK(source IN ('manual','sms_auto','email_auto'))",
    );
    expect(consolidatedSQL).toContain(
      "CHECK(status IN ('approved','pending_review','rejected'))",
    );
  });

  it("payment_modes table has type CHECK constraint", async () => {
    const db = createMockDb();
    await runMigrations(db as never);

    const consolidatedSQL = executedSQL[1];
    expect(consolidatedSQL).toContain(
      "CHECK(type IN ('credit_card','debit_card','upi','cash','wallet','bank_transfer'))",
    );
  });

  it("categories table has foreign key to users", async () => {
    const db = createMockDb();
    await runMigrations(db as never);

    const consolidatedSQL = executedSQL[1];
    expect(consolidatedSQL).toContain("user_id TEXT NOT NULL REFERENCES users(id)");
  });

  it("expenses table has foreign keys to categories and payment_modes", async () => {
    const db = createMockDb();
    await runMigrations(db as never);

    const consolidatedSQL = executedSQL[1];
    expect(consolidatedSQL).toContain("category_id TEXT REFERENCES categories(id)");
    expect(consolidatedSQL).toContain("payment_mode_id TEXT REFERENCES payment_modes(id)");
  });

  it("budgets has unique constraint on user + category + month", async () => {
    const db = createMockDb();
    await runMigrations(db as never);

    const consolidatedSQL = executedSQL[1];
    expect(consolidatedSQL).toContain("idx_budgets_unique");
    expect(consolidatedSQL).toContain("user_id, category_id, month");
  });

  it("does not contain household tables", async () => {
    const db = createMockDb();
    await runMigrations(db as never);

    const consolidatedSQL = executedSQL[1];
    expect(consolidatedSQL).not.toContain("household_expenses");
    expect(consolidatedSQL).not.toContain("household_splits");
    expect(consolidatedSQL).not.toContain("household_expense_links");
  });
});

describe("Seed Default User", () => {
  it("creates a default user when table is empty", async () => {
    const db = createMockDb();

    const userId = await seedDefaultUser(db as never);

    expect(userId).toBeDefined();
    expect(typeof userId).toBe("string");
    expect(userId.length).toBeGreaterThan(0);

    const insert = executedRuns.find((r) =>
      r.sql.includes("INSERT INTO users"),
    );
    expect(insert).toBeDefined();
    expect(insert!.params[1]).toBe("Me");
    // Verify default settings include fiscal_year_start_month
    const settings = JSON.parse(insert!.params[2] as string);
    expect(settings.currency).toBe("INR");
    expect(settings.fiscal_year_start_month).toBe(4);
  });

  it("returns existing user ID when user already exists", async () => {
    const db = createMockDb();
    mockRows["SELECT id FROM users LIMIT 1;"] = [
      { id: "existing-user-id" },
    ];

    const userId = await seedDefaultUser(db as never);

    expect(userId).toBe("existing-user-id");
    // Should NOT insert a new user
    const insert = executedRuns.find((r) =>
      r.sql.includes("INSERT INTO users"),
    );
    expect(insert).toBeUndefined();
  });
});
