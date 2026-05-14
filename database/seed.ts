import type { SQLiteDatabase } from "expo-sqlite";
import { DEFAULT_USER_ID } from "@/constants/app";

/** Default user settings */
const DEFAULT_SETTINGS = JSON.stringify({
  currency: "INR",
  theme: "light",
  fiscal_year_start_month: 4,
});

/**
 * Seed a default user record if the users table is empty.
 * This ensures the app always has a primary user on first launch.
 */
export async function seedDefaultUser(db: SQLiteDatabase): Promise<string> {
  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM users LIMIT 1;",
  );

  if (existing) {
    return existing.id;
  }

  const userId = DEFAULT_USER_ID;
  await db.runAsync(
    "INSERT INTO users (id, name, settings) VALUES (?, ?, ?);",
    userId,
    "Me",
    DEFAULT_SETTINGS,
  );

  return userId;
}
