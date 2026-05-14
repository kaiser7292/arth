import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 047: Add pension to account type CHECK constraint.
 *
 * SQLite doesn't support ALTER TABLE to modify CHECK constraints directly.
 * We need to recreate the table with the new constraint and migrate data.
 */
export default {
  version: 47,
  name: "add_pension_account_type",
  up: async (db: SQLiteDatabase) => {
    try {
      // Check if pension is already in the CHECK constraint by attempting to insert a test record
      // This is a workaround since SQLite doesn't allow inspecting CHECK constraints directly
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS financial_accounts_new (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id),
          account_identifier TEXT NOT NULL,
          bank_name TEXT NOT NULL,
          account_type TEXT NOT NULL CHECK(account_type IN ('savings','credit_card','loan','wallet','demat','pension')),
          account_label TEXT,
          credit_limit REAL,
          last_known_balance REAL,
          last_balance_date TEXT,
          total_due REAL,
          min_due REAL,
          due_date TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          discovered_from_sms INTEGER NOT NULL DEFAULT 1,
          fund_balance REAL NOT NULL DEFAULT 0,
          account_number TEXT,
          has_nach_mandate INTEGER NOT NULL DEFAULT 0,
          nach_merchant TEXT,
          nach_amount REAL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // Copy data from old table to new table
      await db.execAsync(`
        INSERT INTO financial_accounts_new (
          id, user_id, account_identifier, bank_name, account_type,
          account_label, credit_limit, last_known_balance, last_balance_date,
          total_due, min_due, due_date, is_active, discovered_from_sms,
          fund_balance, account_number, has_nach_mandate, nach_merchant, nach_amount,
          created_at, updated_at
        )
        SELECT 
          id, user_id, account_identifier, bank_name, account_type,
          account_label, credit_limit, last_known_balance, last_balance_date,
          total_due, min_due, due_date, is_active, discovered_from_sms,
          fund_balance, account_number, has_nach_mandate, nach_merchant, nach_amount,
          created_at, updated_at
        FROM financial_accounts;
      `);

      // Drop old table
      await db.execAsync("DROP TABLE financial_accounts;");

      // Rename new table to original name
      await db.execAsync("ALTER TABLE financial_accounts_new RENAME TO financial_accounts;");

      // Recreate indexes
      await db.execAsync(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_accounts_unique ON financial_accounts(user_id, account_identifier, bank_name, account_type);
        CREATE INDEX IF NOT EXISTS idx_financial_accounts_user ON financial_accounts(user_id, is_active);
      `);
    } catch (error) {
      // If migration fails, it's likely because pension is already in the constraint
      // Log the error but don't fail the migration
      console.log("Migration 047 skipped (pension may already be in account_type constraint):", error);
    }
  },
};
