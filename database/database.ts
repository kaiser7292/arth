import { seedMerchantMappings } from "@/services/smart-categorizer";
import { logger } from "@/utils/logger";
import * as SQLite from "expo-sqlite";
import { runMigrations } from "./migrations";
import { seedDefaultUser } from "./seed";

const DB_NAME = "artha.db";
const INIT_TIMEOUT_MS = 30000; // 30 second timeout for database init
const FRESH_INSTALL_TIMEOUT_MS = 120000; // 2 minute timeout for fresh install (migrations take time)

let db: SQLite.SQLiteDatabase | null = null;
let freshInstallChecked = false;
let isFreshInstallCache = false;

async function checkFreshInstall(): Promise<boolean> {
  if (freshInstallChecked) {
    return isFreshInstallCache;
  }
  try {
    // Try to open the DB - if it fails with "no such table", it's a fresh install
    // If it opens successfully, it's not a fresh install
    const testDb = await SQLite.openDatabaseAsync(DB_NAME);
    const result = await testDb.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
    await testDb.closeAsync();
    isFreshInstallCache = !result;
    freshInstallChecked = true;
    return isFreshInstallCache;
  } catch {
    // If we can't open or query, assume it's a fresh install
    isFreshInstallCache = true;
    freshInstallChecked = true;
    return true;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, context: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${context} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Get the database instance. Must call initDatabase() first.
 * Throws if the database has not been initialized.
 */
export function getDatabase(): SQLite.SQLiteDatabase {
  if (!db) {
    throw new Error(
      "Database not initialized. Call initDatabase() before accessing the database.",
    );
  }
  return db;
}

/**
 * Initialize the database: open connection, enable WAL mode + foreign keys,
 * run pending migrations, and seed default data.
 *
 * Safe to call multiple times — returns existing instance if already initialized.
 */
export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) {
    return db;
  }

  const isFresh = await checkFreshInstall();
  const timeoutMs = isFresh ? FRESH_INSTALL_TIMEOUT_MS : INIT_TIMEOUT_MS;
  logger.info(isFresh ? "Fresh install detected - using extended timeout" : "Existing database detected");

  logger.info("Opening database...");
  db = await withTimeout(
    SQLite.openDatabaseAsync(DB_NAME),
    timeoutMs,
    "Database open"
  );

  // Enable WAL mode for better concurrent read/write performance
  logger.info("Enabling WAL mode...");
  await withTimeout(
    db.execAsync("PRAGMA journal_mode = WAL;"),
    timeoutMs,
    "WAL mode setup"
  );

  // Enforce foreign key constraints
  logger.info("Enabling foreign keys...");
  await withTimeout(
    db.execAsync("PRAGMA foreign_keys = ON;"),
    timeoutMs,
    "Foreign keys setup"
  );

  // Run pending schema migrations
  logger.info("Running migrations...");
  await withTimeout(
    runMigrations(db),
    timeoutMs,
    "Migrations"
  );

  // Seed default user if none exists
  logger.info("Seeding default user...");
  await withTimeout(
    seedDefaultUser(db),
    timeoutMs,
    "User seed"
  );

  // Seed merchant keyword mappings for smart categorization
  logger.info("Seeding merchant mappings...");
  await withTimeout(
    seedMerchantMappings(),
    timeoutMs,
    "Merchant mappings seed"
  );

  logger.info("Database initialization complete");
  return db;
}

/**
 * Close the database connection. Used for cleanup and testing.
 */
export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.closeAsync();
    db = null;
  }
}
