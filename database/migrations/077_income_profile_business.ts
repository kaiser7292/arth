import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 077 — salary_profiles: business / freelance income, side income, and receipts tracking.
 *
 * The Income Calculator only modelled a salary (CTC) or a post-tax monthly figure. Self-employed
 * users had to work out their own tax. This adds:
 *
 *   - income_type: 'salaried' (default, every existing row) | 'business'. A separate column rather
 *     than a new input_mode value because input_mode has a CHECK ('ctc','direct') that SQLite can't
 *     alter without rebuilding the table. Business rows keep input_mode='direct' — so an older app
 *     restoring a newer backup still reads computed_monthly_in_hand as a post-tax figure.
 *   - business_*: scheme (presumptive_profession | presumptive_business | regular), annual receipts
 *     (excluding GST), % digital receipts, annual expenses, % TDS withheld by clients, % GST charged.
 *     Used as the primary income when income_type='business', and as a side business for a
 *     salaried profile when side_business_enabled=1.
 *   - rental_*: let-out property rent, municipal tax paid, and home-loan interest on it.
 *   - business_receipt_account_ids: JSON array of account ids whose credits count as business
 *     receipts, for the actual-vs-expected comparison.
 *
 * All additive with defaults; existing rows behave exactly as before.
 * Idempotent via PRAGMA table_info guard.
 */
const COLUMNS: Array<[name: string, ddl: string]> = [
  ["income_type", "TEXT NOT NULL DEFAULT 'salaried'"],
  ["business_scheme", "TEXT NOT NULL DEFAULT 'presumptive_profession'"],
  ["business_receipts", "REAL NOT NULL DEFAULT 0"],
  ["business_digital_pct", "REAL NOT NULL DEFAULT 100"],
  ["business_expenses", "REAL NOT NULL DEFAULT 0"],
  ["business_tds_pct", "REAL NOT NULL DEFAULT 0"],
  ["business_gst_pct", "REAL NOT NULL DEFAULT 0"],
  ["side_business_enabled", "INTEGER NOT NULL DEFAULT 0"],
  ["rental_annual_rent", "REAL NOT NULL DEFAULT 0"],
  ["rental_municipal_tax", "REAL NOT NULL DEFAULT 0"],
  ["rental_loan_interest", "REAL NOT NULL DEFAULT 0"],
  ["business_receipt_account_ids", "TEXT"],
];

export const migration: Migration = {
  version: 77,
  name: "income_profile_business",
  up: async (db: SQLiteDatabase) => {
    const existing = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(salary_profiles);`);
    const has = new Set(existing.map((c) => c.name));
    for (const [name, ddl] of COLUMNS) {
      if (!has.has(name)) {
        await db.execAsync(`ALTER TABLE salary_profiles ADD COLUMN ${name} ${ddl};`);
      }
    }
  },
};

export default migration;
