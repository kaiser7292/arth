import type { SQLiteDatabase } from "expo-sqlite";

export default {
  version: 48,
  name: "048_drop_account_type_check_constraint",
  up: async (db: SQLiteDatabase) => {
    // Disable foreign keys during table recreation
    await db.execAsync("PRAGMA foreign_keys = OFF;");

    // Create new table without CHECK constraint
    await db.execAsync(`
      CREATE TABLE financial_accounts_new (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id),
        account_identifier TEXT NOT NULL,
        bank_name TEXT NOT NULL,
        account_type TEXT NOT NULL,
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

    // Copy all data from old table to new table
    await db.execAsync(`
      INSERT INTO financial_accounts_new 
      SELECT * FROM financial_accounts;
    `);

    // Drop old table
    await db.execAsync("DROP TABLE financial_accounts;");

    // Rename new table to original name
    await db.execAsync("ALTER TABLE financial_accounts_new RENAME TO financial_accounts;");

    // Recreate indexes
    await db.execAsync(`
      CREATE UNIQUE INDEX idx_financial_accounts_unique 
      ON financial_accounts(user_id, account_identifier, bank_name, account_type);
    `);

    await db.execAsync(`
      CREATE INDEX idx_financial_accounts_user 
      ON financial_accounts(user_id, is_active);
    `);

    // Re-enable foreign keys
    await db.execAsync("PRAGMA foreign_keys = ON;");
  },
  down: async (db: SQLiteDatabase) => {
    // Reverse migration: Re-add CHECK constraint
    await db.execAsync("PRAGMA foreign_keys = OFF;");

    // Create new table with CHECK constraint
    await db.execAsync(`
      CREATE TABLE financial_accounts_new (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id),
        account_identifier TEXT NOT NULL,
        bank_name TEXT NOT NULL,
        account_type TEXT NOT NULL CHECK(account_type IN ('savings','credit_card','loan','wallet','demat')),
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

    // Copy all data from old table to new table
    await db.execAsync(`
      INSERT INTO financial_accounts_new 
      SELECT * FROM financial_accounts;
    `);

    // Drop old table
    await db.execAsync("DROP TABLE financial_accounts;");

    // Rename new table to original name
    await db.execAsync("ALTER TABLE financial_accounts_new RENAME TO financial_accounts;");

    // Recreate indexes
    await db.execAsync(`
      CREATE UNIQUE INDEX idx_financial_accounts_unique 
      ON financial_accounts(user_id, account_identifier, bank_name, account_type);
    `);

    await db.execAsync(`
      CREATE INDEX idx_financial_accounts_user 
      ON financial_accounts(user_id, is_active);
    `);

    // Re-enable foreign keys
    await db.execAsync("PRAGMA foreign_keys = ON;");
  },
};
