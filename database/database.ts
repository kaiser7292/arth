import { seedMerchantMappings } from "@/services/smart-categorizer";
import { logger } from "@/utils/logger";
import * as SQLite from "expo-sqlite";
import { runMigrations } from "./migrations";
import { seedDefaultUser } from "./seed";

const DB_NAME = "artha.db";
const INIT_TIMEOUT_MS = 30000; // 30 second timeout for database init
const FRESH_INSTALL_TIMEOUT_MS = 120000; // 2 minute timeout for fresh install (migrations take time)

let db: SQLite.SQLiteDatabase | null = null;
/** The start-up in progress, shared by everyone who asks while it runs. */
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

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
 * Safe to call multiple times and from several places at once (root layout, widget, transaction
 * alerts, calendar sync): there is only ever ONE open of the file. expo-sqlite hands a second open
 * of the same file the same native connection, and when either JS handle is garbage-collected it
 * closes that shared connection outright (NativeDatabase.sharedObjectDidRelease). The handle still
 * in use then failed every query with "Call to function 'NativeDatabase.prepareAsync' has been
 * rejected ... NullPointerException" - at start-up ("Database Init Failed") or on any later screen.
 */
export function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  // While start-up runs, everyone waits for it (db is already set then, but not migrated yet).
  if (opening) return opening;
  if (db) return Promise.resolve(db);
  opening = open().then(
    (ready) => {
      db = ready;
      opening = null;
      return ready;
    },
    (e) => {
      // Nothing half-open is kept, so Try Again starts from scratch.
      opening = null;
      throw e;
    },
  );
  return opening;
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  logger.info("Opening database...");
  const conn = await withTimeout(SQLite.openDatabaseAsync(DB_NAME), INIT_TIMEOUT_MS, "Database open");
  // Published at once, as before: migrations and seeds may read it through getDatabase().
  db = conn;
  try {
    // A fresh install has no tables yet; its migrations take longer, so it gets more time.
    const users = await conn.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
    const isFresh = !users;
    const timeoutMs = isFresh ? FRESH_INSTALL_TIMEOUT_MS : INIT_TIMEOUT_MS;
    logger.info(isFresh ? "Fresh install detected - using extended timeout" : "Existing database detected");

    // Enable WAL mode for better concurrent read/write performance
    logger.info("Enabling WAL mode...");
    await withTimeout(conn.execAsync("PRAGMA journal_mode = WAL;"), timeoutMs, "WAL mode setup");

    // Enforce foreign key constraints
    logger.info("Enabling foreign keys...");
    await withTimeout(conn.execAsync("PRAGMA foreign_keys = ON;"), timeoutMs, "Foreign keys setup");

    // Run pending schema migrations
    logger.info("Running migrations...");
    await withTimeout(runMigrations(conn), timeoutMs, "Migrations");

    // Seed default user if none exists
    logger.info("Seeding default user...");
    await withTimeout(seedDefaultUser(conn), timeoutMs, "User seed");

    // Seed merchant keyword mappings for smart categorization
    logger.info("Seeding merchant mappings...");
    await withTimeout(seedMerchantMappings(), timeoutMs, "Merchant mappings seed");

    logger.info("Database initialization complete");
    return conn;
  } catch (e) {
    db = null;
    await conn.closeAsync().catch(() => {});
    throw e;
  }
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
