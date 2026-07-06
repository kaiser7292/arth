import type { SQLiteDatabase } from "expo-sqlite";
import migration001 from "./001_consolidated_schema";
import migration002 from "./002_add_raw_merchant_name";
import migration003 from "./003_add_monthly_overrides";
import migration004 from "./004_expense_classifications";
import migration005 from "./005_credits_into_expenses";
import migration006 from "./006_drop_sms_rules";
import migration007 from "./007_salary_credit_day";
import migration008 from "./008_account_balance_sms_ref";
import migration009 from "./009_fund_snapshots";
import migration010 from "./010_purchase_group";
import migration011 from "./011_demat_transfer_fields";
import migration012 from "./012_fund_balance_backfill";
import migration013 from "./013_recurring_expense_rules";
import migration014 from "./014_recurring_reminders";
import migration015 from "./015_public_data_tables";
import migration016 from "./016_linked_contribution_index";
import migration017 from "./017_smart_rules";
import migration018 from "./018_user_sms_templates";
import migration019 from "./019_min_balance";
import migration020 from "./020_expense_filter_indexes";
import migration021 from "./021_sms_template_sender_pattern";
import migration022 from "./022_hisaab_settlement_source";
import migration023 from "./023_transfer_sms_trace";
import migration024 from "./024_split_mode_persistence";
import migration025 from "./025_simulation_tables";
import migration026 from "./026_simulator_hisaab";
import migration027 from "./027_salary_profile_breakdown";
import migration028 from "./028_expense_investment_links";
import migration029 from "./029_loan_management";
import migration030 from "./030_smart_rule_investment_action";
import migration031 from "./031_debt_reduction_bucket";
import migration032 from "./032_expense_loan_links";
import migration033 from "./033_loan_corrections";
import migration034 from "./034_loan_round_mode";
import migration035 from "./035_loan_perf_indexes";
import migration036 from "./036_null_auto_populated_descriptions";
// 037: removed in v17.5.x — notification_collector_events migration deleted with feature
// 038: present ↓
import migration038 from "./038_null_masked_account_descriptions";
import migration039 from "./039_loan_account_number_and_sms_reminder";
import migration040 from "./040_expense_edit_history";
// 041: removed in v17.5.x — notification_collector_triggers migration deleted with feature
import migration042 from "./042_simulator_transfers";
import migration043 from "./043_loan_corrections_deleted_at";
// 045: removed — app_logs migration deleted with feature (unused local crash log, never wired up; services/app-log.ts + pii-redactor.ts deleted alongside)
import migration046 from "./046_reclassification_flag";
import migration047 from "./047_sms_scan_runs";
import migration048 from "./048_expenses_source_sms_address";
import migration049 from "./049_simulation_entry_fulfillments";
import migration050 from "./050_loan_correction_rate";
import migration051 from "./051_loan_drop_manual_csv";
import migration052 from "./052_sms_template_patterns_timestamps";
import migration053 from "./053_smart_rules_conditions_model";
import migration054 from "./054_demat_target_withdrawal";
import migration055 from "./055_template_payment_mode";
import migration056 from "./056_recurring_rule_amount";
import migration057 from "./057_vault_entries";

export interface Migration {
  version: number;
  name: string;
  up: (db: SQLiteDatabase) => Promise<void>;
}

/** All migrations in order. Add new migrations to the end of this array. */
const migrations: Migration[] = [migration001, migration002, migration003, migration004, migration005, migration006, migration007, migration008, migration009, migration010, migration011, migration012, migration013, migration014, migration015, migration016, migration017, migration018, migration019, migration020, migration021, migration022, migration023, migration024, migration025, migration026, migration027, migration028, migration029, migration030, migration031, migration032, migration033, migration034, migration035, migration036, migration038, migration039, migration040, migration042, migration043, migration046, migration047, migration048, migration049, migration050, migration051, migration052, migration053, migration054, migration055, migration056, migration057];

/**
 * Run all pending schema migrations.
 * Creates the schema_migrations tracking table if it doesn't exist,
 * then applies any migrations whose version hasn't been recorded yet.
 */
export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  // Create the migration tracking table
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Get already-applied versions
  const applied = await db.getAllAsync<{ version: number }>(
    "SELECT version FROM schema_migrations ORDER BY version;",
  );
  const appliedVersions = new Set(applied.map((row) => row.version));

  // Run pending migrations in order
  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      await migration.up(db);
      await db.runAsync(
        "INSERT INTO schema_migrations (version, name) VALUES (?, ?);",
        migration.version,
        migration.name,
      );
    }
  }
}

/**
 * Get the current schema version (highest applied migration).
 * Returns 0 if no migrations have been applied.
 */
export async function getCurrentVersion(db: SQLiteDatabase): Promise<number> {
  try {
    const row = await db.getFirstAsync<{ version: number }>(
      "SELECT MAX(version) as version FROM schema_migrations;",
    );
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}
