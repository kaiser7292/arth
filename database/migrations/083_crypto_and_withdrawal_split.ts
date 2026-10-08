import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 083 — crypto as an investment type, and where a withdrawal came from.
 *
 * investment_products.instrument gains 'crypto' (taxed as a virtual digital asset: flat 30%, no
 * set-off - services/realized-gains.ts). SQLite can't alter a CHECK constraint, so the table is
 * rebuilt from its own CREATE statement with the list widened, data copied, indexes recreated.
 *
 * account_transfers.portfolio_delta: for a withdrawal from a market account, how much came out of
 * holdings (sold) rather than idle cash. Before this, the whole amount came off cash, which went
 * negative when the money was really from a sale. NULL = before 083 (all from cash).
 *
 * Idempotent: skips the rebuild when 'crypto' is already allowed, and the column add is guarded.
 */
export const migration: Migration = {
  version: 83,
  name: "crypto_and_withdrawal_split",
  up: async (db: SQLiteDatabase) => {
    const meta = await db.getFirstAsync<{ sql: string }>(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'investment_products';`,
    );
    if (meta?.sql && !meta.sql.includes("'crypto'")) {
      const widened = meta.sql
        .replace(/'other'\)/, "'other','crypto')")
        .replace(/CREATE TABLE\s+(IF NOT EXISTS\s+)?"?investment_products"?/i, "CREATE TABLE investment_products_new");
      if (!widened.includes("'crypto'") || !widened.includes("investment_products_new")) {
        throw new Error("Migration 083: couldn't widen investment_products.instrument");
      }
      const indexes = await db.getAllAsync<{ sql: string }>(
        `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'investment_products' AND sql IS NOT NULL;`,
      );
      await db.execAsync(`PRAGMA foreign_keys = OFF;`);
      try {
        await db.execAsync(`
          ${widened};
          INSERT INTO investment_products_new SELECT * FROM investment_products;
          DROP TABLE investment_products;
          ALTER TABLE investment_products_new RENAME TO investment_products;
        `);
        for (const ix of indexes) await db.execAsync(`${ix.sql};`);
      } finally {
        await db.execAsync(`PRAGMA foreign_keys = ON;`);
      }
    }

    // The account linked to Zebpay holds crypto: move it off the default "equity" type, once.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getBrokerLinkedAccount } = require("@/services/broker-link") as typeof import("@/services/broker-link");
      const zebpay = getBrokerLinkedAccount("zebpay");
      if (zebpay) {
        await db.runAsync(
          `UPDATE investment_products SET instrument = 'crypto' WHERE financial_account_id = ? AND instrument = 'equity';`,
          zebpay,
        );
      }
    } catch {
      // No device settings available (e.g. tests) - the Zebpay link flow marks it later.
    }

    const transferColumns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(account_transfers);`);
    if (!transferColumns.some((c) => c.name === "portfolio_delta")) {
      await db.execAsync(`ALTER TABLE account_transfers ADD COLUMN portfolio_delta REAL;`);
    }
  },
};

export default migration;
