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

    // execAsync calls:
    //   1 schema_migrations CREATE
    // + 1 each for migrations 001, 002, 003, 004 (5 total so far)
    // + 3 for migration 005 (insert credits, flip refunds, repoint hisaab FKs) — 8 total
    // + 1 each for migrations 006, 007, 008, 009, 010, 011, 013, 014, 015, 016 — 18 total
    //   (migration 012 uses runAsync, not execAsync; counted in inserts test)
    // + 2 for migration 017 (CREATE smart_rules, ALTER expenses ADD applied_rule_id) — 20 total
    // + 5 for migration 018 (4 ALTERs for new columns + CREATE INDEX) — 25 total
    // + 1 for migration 019 (ALTER financial_accounts ADD min_balance) — 26 total
    // + 1 for migration 020 (3 CREATE INDEX IF NOT EXISTS in a single execAsync) — 27 total
    // + 3 for migration 021 (2 ALTERs adding columns + 1 CREATE INDEX via 3 separate execAsyncs) — 30 total
    // + 1 for migration 022 (ALTER hisaab_entries ADD settlement_source) — 31 total
    // + 2 for migration 023 (2 ALTERs on account_transfers for SMS trace) — 33 total
    // + 2 for migration 024 (2 ALTERs on expenses for split mode + exact amount) — 35 total
    // + 1 for migration 025 (single execAsync block: 2 CREATE TABLE + 3 CREATE INDEX for simulator) — 36 total
    // + migration 026 (v16.0.5) = 1 execAsync block (CREATE inclusions TABLE + INDEX) + 2 ALTERs on simulation_entries → 3 total → 39
    // + migration 027 (v16.0.9) = 7 ALTER TABLE execAsyncs on salary_profiles (gratuity_in_ctc, ctc_mode, manual_basic/hra/special/employer_epf/gratuity) → 46
    // + migration 028 (v17.0.0) = 1 execAsync block (CREATE expense_investment_links + 2 indexes) → 47
    // + migration 029 (v17.0.0) = 1 execAsync block (3 CREATE TABLE: loan_accounts, loan_schedule_entries, loan_prepayments + 5 indexes) → 48
    // + migration 030 (v17.2.0) = 1 ALTER TABLE execAsync (smart_rules.action_link_to_investment_bucket_id) → 49
    // + migration 031 (v17.3.0) = 3 execAsyncs (2 ALTER TABLE adding bucket_type + linked_loan_account_id + 1 CREATE INDEX) → 52
    // + migration 032 (v17.4.0) = 1 execAsync block (CREATE expense_loan_links + 4 indexes) → 53
    // + migration 033 (v17.5.1) = 1 execAsync block (CREATE loan_corrections + 1 index) → 54
    // + migration 034 (v17.5.2) = 2 execAsyncs (ALTER TABLE loan_accounts + UPDATE backfill) → 56
    // + migration 035 (v17.5.2) = 1 execAsync block (2 CREATE INDEX IF NOT EXISTS) → 57
    // + migration 036 (v17.5.18) uses runAsync not execAsync — no change to count → 57
    // + migration 038 (v17.5.23) uses runAsync not execAsync — no change to count → 57
    // + migration 039 (v17.6.0) = 4 ALTER TABLE execAsyncs (schedule_source + 3 sms_reminder cols)
    //   (getAllAsync for PRAGMA doesn't count toward execAsync) → 61
    // + migration 040 (v17.5.38) = 1 execAsync block (CREATE TABLE + 2 indexes) → 62
    expect(executedSQL.length).toBe(62);

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
    expect(inserts.length).toBe(39);
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
    mockRows["SELECT version FROM schema_migrations ORDER BY version;"] = [
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
      { version: 12 },
      { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 },
      { version: 17 },
      { version: 18 },
      { version: 19 },
      { version: 20 },
      { version: 21 },
      { version: 22 },
      { version: 23 },
      { version: 24 },
      { version: 25 },
      { version: 26 },
      { version: 27 },
      { version: 28 },
      { version: 29 },
      { version: 30 },
      { version: 31 },
      { version: 32 },
      { version: 33 },
      { version: 34 },
      { version: 35 },
      { version: 36 },
      { version: 38 },
      { version: 39 },
      { version: 40 },
    ];

    await runMigrations(db as never);

    const inserts = executedRuns.filter((r) =>
      r.sql.includes("INSERT INTO schema_migrations"),
    );
    expect(inserts.length).toBe(0);

    // Only schema_migrations CREATE TABLE, no consolidated schema
    expect(executedSQL.length).toBe(1);
  });

  it("does nothing when all migrations are applied", async () => {
    const db = createMockDb();
    mockRows["SELECT version FROM schema_migrations ORDER BY version;"] = [
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
      { version: 12 },
      { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 },
      { version: 17 },
      { version: 18 },
      { version: 19 },
      { version: 20 },
      { version: 21 },
      { version: 22 },
      { version: 23 },
      { version: 24 },
      { version: 25 },
      { version: 26 },
      { version: 27 },
      { version: 28 },
      { version: 29 },
      { version: 30 },
      { version: 31 },
      { version: 32 },
      { version: 33 },
      { version: 34 },
      { version: 35 },
      { version: 36 },
      { version: 38 },
      { version: 39 },
      { version: 40 },
    ];

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
