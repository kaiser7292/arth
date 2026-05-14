import type { SQLiteDatabase } from "expo-sqlite";

export default {
  version: 43,
  name: "loan_corrections_deleted_at",
  up: async (db: SQLiteDatabase): Promise<void> => {
    await db.execAsync(`
      ALTER TABLE loan_corrections ADD COLUMN deleted_at TEXT;
    `);
  },
};
