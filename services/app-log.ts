/**
 * Production crash/error logging to the local SQLite app_logs table.
 *
 * Uses a lazy dynamic import for getDatabase to avoid the circular init
 * dependency: logger → app-log → database → logger (which would cause
 * getDatabase() to throw during module evaluation before initDatabase runs).
 */

export async function writeAppLog(
  level: "error" | "warn",
  message: string,
  context?: unknown,
): Promise<void> {
  try {
    const { getDatabase } = await import("@/database");
    const db = getDatabase();
    await db.runAsync(
      `INSERT INTO app_logs (level, message, context, created_at)
       VALUES (?, ?, ?, datetime('now'));`,
      level,
      message,
      context != null ? JSON.stringify(context) : null,
    );
    await db.runAsync(
      `DELETE FROM app_logs WHERE id NOT IN (
         SELECT id FROM app_logs ORDER BY created_at DESC LIMIT 200
       );`,
    );
  } catch {
    // Never throw from logger — silent fail
  }
}
