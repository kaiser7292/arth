import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 068: Composite partial index for expense queries filtered by
 * user, nature, status, and date — the dominant access pattern in:
 *   - Budget category actuals (getCategoryActuals in expense-queries.ts)
 *   - Forecast engine (getSpentByCategory in forecast-engine.ts)
 *   - Analytics / insights drilldowns
 *
 * Without this, those queries use idx_expenses_user_date and then apply
 * nature/status/deleted_at as in-memory filters over the full date-range
 * result set. The composite index lets SQLite resolve the WHERE clause
 * entirely in the index scan, returning only the rows that match.
 *
 * Partial (WHERE deleted_at IS NULL) keeps the index compact — soft-deleted
 * rows are never queried in aggregate paths.
 */
export default {
  version: 68,
  name: "expense_composite_index",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_expenses_user_nature_status_date
        ON expenses(user_id, nature, status, date)
        WHERE deleted_at IS NULL;
    `);
  },
};
